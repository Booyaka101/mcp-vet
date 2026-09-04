import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Finding,
  Token,
  PatternId,
  PySdkRuleId,
  TsSdkRuleId,
  ALL_PY_SDK_RULE_IDS,
  ALL_TS_SDK_RULE_IDS,
  Confidence,
} from './types';
import { applyRules, applyPySdkRules, applyTsSdkRules } from './rules';
import { analyzeTs } from './ts-analyzer';
import { analyzePyBatch, pythonAvailable } from './py-analyzer';
import { regexFallbackTokens } from './py-fallback';
import { parseSuppressions } from './suppress';
import { IgnoreMatcher } from './ignore';
import { detectMcpSdk, detectTsSdk, SdkDetection, TsSdkDetection } from './sdk-detect';

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build']);
const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXT = new Set(['.py']);

const CONF_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

export type PySdkMode = 'auto' | 'v1' | 'v2' | 'off';
export type TsSdkMode = 'auto' | 'v1' | 'v2' | 'off';

export interface ScanOptions {
  enabled: Set<PatternId>;
  ignore: IgnoreMatcher;
  /** 0 = no limit */
  maxFileSizeKb: number;
  pythonFallback: boolean;
  minConfidence: Confidence;
  /**
   * Gate for the PY_SDK_V1 rule group (0.12.0). 'auto' resolves the declared
   * `mcp` major per file from the nearest pyproject.toml / requirements*.txt /
   * uv.lock; 'v1'/'v2' force it; 'off' (the API default, and `--no-py-sdk`)
   * reproduces pre-0.12.0 output exactly.
   */
  pySdkMode?: PySdkMode;
  /** the PY_SDK_V1 rules to evaluate; defaults to all of them */
  pySdkEnabled?: Set<PySdkRuleId>;
  /**
   * Gate for the TS_SDK_V1 rule group (0.14.0), the mirror of `pySdkMode`.
   * 'auto' resolves the declared MCP TypeScript SDK family per file from the
   * nearest package.json / package-lock.json / pnpm-lock.yaml / yarn.lock;
   * 'v1'/'v2' force it; 'off' (the API default, and `--no-ts-sdk`) reproduces
   * pre-0.14.0 output exactly.
   */
  tsSdkMode?: TsSdkMode;
  /** the TS_SDK_V1 rules to evaluate; defaults to all of them */
  tsSdkEnabled?: Set<TsSdkRuleId>;
}

export type PythonMode = 'ast' | 'regex' | 'none' | 'n/a';

/** Where a declaration was read from, quoted in the informational report lines. */
export interface SdkDeclaration {
  specifier?: string;
  source?: string;
}

/** How an SDK migration group resolved this scan — drives the extra report lines. */
export interface SdkGroupStatus {
  mode: 'auto' | 'v1' | 'v2';
  /** at least one file was evaluated against the group */
  evaluated: boolean;
  /** set when at least one file was suppressed because the project declares v1 */
  v1?: SdkDeclaration;
  /** true when at least one file ran with an undetermined declared major */
  undetermined: boolean;
}

export type PySdkStatus = SdkGroupStatus;

export interface TsSdkStatus extends SdkGroupStatus {
  /** set when at least one project declares BOTH the v1 monolith and a v2 package */
  half?: SdkDeclaration;
}

/**
 * The gate both SDK groups share: a project declaring v1 suppresses the group
 * (and gets one informational line instead), v2 runs it clean, and anything
 * unresolved runs it with every finding annotated. Returns null when the file
 * is suppressed.
 */
function gateSdkGroup(
  status: SdkGroupStatus,
  mode: 'auto' | 'v1' | 'v2',
  detected: string,
  declaration: SdkDeclaration,
): { undetermined: boolean } | null {
  const resolved = mode === 'auto' ? detected : mode;
  if (resolved === 'v1') {
    status.v1 = status.v1 ?? declaration;
    return null;
  }
  status.evaluated = true;
  // 'half' is a staged migration: determined, and exactly what the group is for.
  const undetermined = resolved !== 'v2' && resolved !== 'half';
  if (undetermined) status.undetermined = true;
  return { undetermined };
}

export interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  pythonFilesFound: number;
  pythonMode: PythonMode;
  suppressedCount: number;
  skippedLargeFiles: string[];
  roots: string[];
  /** present only when the PY_SDK_V1 group was on and Python files were found */
  pySdkStatus?: PySdkStatus;
  /** present only when the TS_SDK_V1 group was on and TS/JS files were found */
  tsSdkStatus?: TsSdkStatus;
}

export class ScanError extends Error {}

interface ScanFile {
  abs: string;
  rel: string;
  lang: 'ts' | 'py';
}

/** Strip a leading UTF-8 BOM so line 1 and AST parsing behave correctly. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function classify(name: string): 'ts' | 'py' | null {
  const ext = path.extname(name).toLowerCase();
  if (TS_EXT.has(ext)) return 'ts';
  if (PY_EXT.has(ext)) return 'py';
  return null;
}

function walk(root: string, ignore: IgnoreMatcher): ScanFile[] {
  const files: ScanFile[] = [];
  const stack: string[] = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = toPosix(path.relative(root, full));
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (ignore.matches(rel)) continue;
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const lang = classify(e.name);
      if (!lang) continue;
      if (ignore.matches(rel)) continue;
      files.push({ abs: full, rel, lang });
    }
  }
  return files;
}

function collectFiles(roots: string[], ignore: IgnoreMatcher): ScanFile[] {
  const all: ScanFile[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const abs = path.resolve(root);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new ScanError(`path does not exist: ${root}`);
    }
    let found: ScanFile[];
    if (stat.isFile()) {
      const lang = classify(abs);
      found = lang ? [{ abs, rel: path.basename(abs), lang }] : [];
    } else {
      found = walk(abs, ignore);
    }
    for (const f of found) {
      const key = path.normalize(f.abs).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(f);
    }
  }
  all.sort((a, b) => a.rel.localeCompare(b.rel));
  return all;
}

export function scan(roots: string[], opts: ScanOptions): ScanResult {
  const files = collectFiles(roots, opts.ignore);
  const maxBytes = opts.maxFileSizeKb > 0 ? opts.maxFileSizeKb * 1024 : Infinity;
  const skippedLargeFiles: string[] = [];

  const readText = (f: ScanFile): string | null => {
    try {
      if (Number.isFinite(maxBytes)) {
        const size = fs.statSync(f.abs).size;
        if (size > maxBytes) {
          skippedLargeFiles.push(f.rel);
          return null;
        }
      }
      return stripBom(fs.readFileSync(f.abs, 'utf8'));
    } catch {
      return null;
    }
  };

  const rawFindings: Finding[] = [];
  let suppressedCount = 0;

  const pushFindings = (lines: string[], found: Finding[]) => {
    if (found.length === 0) return;
    const supp = parseSuppressions(lines);
    for (const finding of found) {
      if (supp.isSuppressed(finding.line, finding.patternId)) {
        suppressedCount++;
        continue;
      }
      rawFindings.push(finding);
    }
  };

  const emitForFile = (f: ScanFile, lines: string[], tokens: Token[], source: Finding['source']) => {
    pushFindings(
      lines,
      applyRules(f.rel, lines, tokens, {
        enabled: opts.enabled,
        absPath: f.abs,
        source: source!,
      }),
    );
  };

  // --- PY_SDK_V1 group (0.12.0) — Python files only, gated on the declared
  // mcp major. The pre-existing protocol rules above are NEVER gated by this:
  // a v2 server importing mcp.server.sse still gets its SSE findings.
  const pySdkMode: PySdkMode = opts.pySdkMode ?? 'off';
  const pySdkEnabled = opts.pySdkEnabled ?? new Set<PySdkRuleId>(ALL_PY_SDK_RULE_IDS);
  const pySdkStatus: PySdkStatus | undefined =
    pySdkMode === 'off' ? undefined : { mode: pySdkMode, evaluated: false, undetermined: false };

  const emitPySdkForFile = (f: ScanFile, lines: string[], tokens: Token[], source: Finding['source']) => {
    if (!pySdkStatus || pySdkEnabled.size === 0) return;
    const detection: SdkDetection = detectMcpSdk(path.dirname(f.abs));
    const gate = gateSdkGroup(pySdkStatus, pySdkMode as 'auto' | 'v1' | 'v2', detection.major, {
      specifier: detection.specifier,
      source: detection.source,
    });
    if (!gate) return;
    pushFindings(
      lines,
      applyPySdkRules(f.rel, lines, tokens, {
        enabled: pySdkEnabled,
        absPath: f.abs,
        source: source!,
        undetermined: gate.undetermined,
        httpxDeclared: detection.httpxDeclared,
      }),
    );
  };

  // --- TS_SDK_V1 group (0.14.0) — TypeScript/JavaScript files only, gated on
  // the declared MCP SDK family. Like the Python group, the pre-existing
  // protocol rules are NEVER gated by it.
  const tsSdkMode: TsSdkMode = opts.tsSdkMode ?? 'off';
  const tsSdkEnabled = opts.tsSdkEnabled ?? new Set<TsSdkRuleId>(ALL_TS_SDK_RULE_IDS);
  const tsSdkStatus: TsSdkStatus | undefined =
    tsSdkMode === 'off' ? undefined : { mode: tsSdkMode, evaluated: false, undetermined: false };

  const emitTsSdkForFile = (f: ScanFile, lines: string[], tokens: Token[]) => {
    if (!tsSdkStatus || tsSdkEnabled.size === 0) return;
    const detection: TsSdkDetection = detectTsSdk(path.dirname(f.abs));
    const declaration = { specifier: detection.specifier, source: detection.source };
    const gate = gateSdkGroup(tsSdkStatus, tsSdkMode as 'auto' | 'v1' | 'v2', detection.major, declaration);
    if (!gate) return;
    if (detection.major === 'half') tsSdkStatus.half = tsSdkStatus.half ?? declaration;
    pushFindings(
      lines,
      applyTsSdkRules(f.rel, lines, tokens, {
        enabled: tsSdkEnabled,
        absPath: f.abs,
        source: 'ts-morph',
        undetermined: gate.undetermined,
        zodBelowFloor: detection.zodBelowFloor,
        zodSpecifier: detection.zodSpecifier,
      }),
    );
  };

  // TypeScript / JavaScript
  const tsFiles = files.filter((f) => f.lang === 'ts');
  for (const f of tsFiles) {
    const text = readText(f);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    let tokens: Token[] = [];
    try {
      tokens = analyzeTs(f.abs, text);
    } catch {
      tokens = [];
    }
    emitForFile(f, lines, tokens, 'ts-morph');
    emitTsSdkForFile(f, lines, tokens);
  }

  // Python
  const pyFiles = files.filter((f) => f.lang === 'py');
  let pythonMode: PythonMode = 'n/a';
  if (pyFiles.length) {
    const hasPython = pythonAvailable();
    if (hasPython) {
      pythonMode = 'ast';
      const batch = analyzePyBatch(pyFiles.map((f) => f.abs));
      for (const f of pyFiles) {
        const text = readText(f);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        emitForFile(f, lines, batch[f.abs] || [], 'python-ast');
        emitPySdkForFile(f, lines, batch[f.abs] || [], 'python-ast');
      }
    } else if (opts.pythonFallback) {
      pythonMode = 'regex';
      for (const f of pyFiles) {
        const text = readText(f);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        const tokens = regexFallbackTokens(text);
        emitForFile(f, lines, tokens, 'regex');
        emitPySdkForFile(f, lines, tokens, 'regex');
      }
    } else {
      pythonMode = 'none';
    }
  }

  // Confidence filter
  const minRank = CONF_RANK[opts.minConfidence];
  const findings = rawFindings
    .filter((fnd) => CONF_RANK[fnd.confidence] >= minRank)
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        (a.column ?? 0) - (b.column ?? 0) ||
        a.patternId.localeCompare(b.patternId),
    );

  const result: ScanResult = {
    findings,
    filesScanned: files.length,
    pythonFilesFound: pyFiles.length,
    pythonMode,
    suppressedCount,
    skippedLargeFiles,
    roots,
  };
  // Only surface pySdkStatus when the group could have said something —
  // no Python files means the group is silently skipped.
  if (pySdkStatus && pyFiles.length > 0 && pythonMode !== 'none') {
    result.pySdkStatus = pySdkStatus;
  }
  // Same rule for TS: no TypeScript/JavaScript files means no group to report.
  if (tsSdkStatus && tsFiles.length > 0) {
    result.tsSdkStatus = tsSdkStatus;
  }
  return result;
}

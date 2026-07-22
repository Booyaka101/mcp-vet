import * as fs from 'node:fs';
import * as path from 'node:path';
import { Finding, Token, PatternId, Confidence } from './types';
import { applyRules } from './rules';
import { analyzeTs } from './ts-analyzer';
import { analyzePyBatch, pythonAvailable } from './py-analyzer';
import { regexFallbackTokens } from './py-fallback';
import { parseSuppressions } from './suppress';
import { IgnoreMatcher } from './ignore';

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build']);
const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXT = new Set(['.py']);

const CONF_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

export interface ScanOptions {
  enabled: Set<PatternId>;
  ignore: IgnoreMatcher;
  /** 0 = no limit */
  maxFileSizeKb: number;
  pythonFallback: boolean;
  minConfidence: Confidence;
}

export type PythonMode = 'ast' | 'regex' | 'none' | 'n/a';

export interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  pythonFilesFound: number;
  pythonMode: PythonMode;
  suppressedCount: number;
  skippedLargeFiles: string[];
  roots: string[];
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

  const emitForFile = (f: ScanFile, lines: string[], tokens: Token[], source: Finding['source']) => {
    const found = applyRules(f.rel, lines, tokens, {
      enabled: opts.enabled,
      absPath: f.abs,
      source: source!,
    });
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

  // TypeScript / JavaScript
  for (const f of files) {
    if (f.lang !== 'ts') continue;
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
      }
    } else if (opts.pythonFallback) {
      pythonMode = 'regex';
      for (const f of pyFiles) {
        const text = readText(f);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        emitForFile(f, lines, regexFallbackTokens(text), 'regex');
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

  return {
    findings,
    filesScanned: files.length,
    pythonFilesFound: pyFiles.length,
    pythonMode,
    suppressedCount,
    skippedLargeFiles,
    roots,
  };
}

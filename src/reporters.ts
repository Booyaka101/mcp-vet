import * as fs from 'node:fs';
import * as path from 'node:path';
import { createColors } from './colors';
import {
  Finding,
  Severity,
  ALL_PATTERN_IDS,
  ALL_PY_SDK_RULE_IDS,
  RuntimeRuleId,
  PluginRuleId,
  PySdkRuleId,
} from './types';
import { RULES, RUNTIME_RULES, PLUGIN_RULES, PY_SDK_RULES } from './rules';
import { ScanResult } from './scanner';
import type { ProbeResult } from './probe';
import type { PluginVetResult } from './inputs/plugin';
import {
  SPEC_URL,
  SPEC_DATE,
  MANUAL_REVIEW,
  getVersion,
  PY_SDK_MIGRATION_URL,
  PY_SDK_LATEST_V2,
  PY_SDK_LATEST_V2_DATE,
} from './constants';

function makeChalk(color: boolean | undefined) {
  // color === true -> force on; false -> force off; undefined -> auto-detect
  if (color === true) return createColors(1);
  if (color === false) return createColors(0);
  return createColors();
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function countBySeverity(findings: Finding[]) {
  const breaking = findings.filter((f) => f.severity === 'BREAKING').length;
  return { breaking, deprecated: findings.length - breaking };
}

const isPySdkFinding = (f: Finding): boolean => f.patternId in PY_SDK_RULES;

/** "22 spec rules, 0 breaking; 12 Python SDK rules, 2 advisory" */
function pySdkSummaryLine(findings: Finding[]): string {
  const spec = findings.filter((f) => !isPySdkFinding(f));
  const breaking = spec.filter((f) => f.severity === 'BREAKING').length;
  const advisory = findings.length - spec.length;
  return `${ALL_PATTERN_IDS.length} spec rules, ${breaking} breaking; ${ALL_PY_SDK_RULE_IDS.length} Python SDK rules, ${advisory} advisory`;
}

/** The extra PY_SDK_V1 report lines (group summary + v1 informational note). */
function printPySdkStatus(result: ScanResult, c: any): void {
  const st = result.pySdkStatus;
  if (!st) return;
  if (st.evaluated) {
    console.log(c.gray(pySdkSummaryLine(result.findings)));
  }
  if (st.v1) {
    const from = st.v1.specifier ? ` (mcp ${st.v1.specifier}${st.v1.source ? `, ${st.v1.source}` : ''})` : '';
    console.error(
      c.gray(
        `note: this project declares Python SDK v1${from}. SDK ${PY_SDK_LATEST_V2} (${PY_SDK_LATEST_V2_DATE}) is available; the PY_SDK_V1 migration rules activate when the declared mcp major is 2. Preview with --py-sdk v2, or see ${PY_SDK_MIGRATION_URL}`,
      ),
    );
  }
}

export interface TerminalOptions {
  color?: boolean;
}

/** (a) Terminal report — red for BREAKING, yellow for DEPRECATED, compiler-style. */
export function reportTerminal(result: ScanResult, opts: TerminalOptions = {}): void {
  const c = makeChalk(opts.color);
  const { findings } = result;

  if (result.pythonMode === 'none') {
    console.error(
      c.yellow(
        `warning: ${result.pythonFilesFound} Python file(s) found but no Python interpreter was available and --no-py-fallback was set — .py files were not scanned.`,
      ),
    );
  } else if (result.pythonMode === 'regex') {
    console.error(
      c.yellow(
        `warning: no Python interpreter found — scanned ${result.pythonFilesFound} .py file(s) with the regex fallback (reduced precision).`,
      ),
    );
  }
  for (const rel of result.skippedLargeFiles) {
    console.error(c.yellow(`warning: skipped large file ${rel} (exceeds --max-file-size).`));
  }

  if (findings.length === 0) {
    const suffix =
      result.suppressedCount > 0 ? ` (${result.suppressedCount} suppressed)` : '';
    console.log(
      c.green('✔ mcp-vet: no matching 2026-07-28 breaking or deprecated patterns found') +
        c.gray(` — ${result.filesScanned} file(s) scanned${suffix}`),
    );
    printPySdkStatus(result, c);
    printManualReview(c);
    return;
  }

  let currentFile = '';
  for (const f of findings) {
    if (f.file !== currentFile) {
      currentFile = f.file;
      console.log('');
      console.log(c.underline(f.file));
    }
    const sev =
      f.severity === 'BREAKING' ? c.red.bold('BREAKING') : c.yellow.bold('DEPRECATED');
    const loc = c.cyan(`${f.file}:${f.line}${f.column ? ':' + f.column : ''}`);
    const conf = c.gray(`[${f.confidence}]`);
    console.log(`${loc}  ${sev}  ${c.bold(f.patternId)} ${conf}`);
    console.log(indent(f.explanation, '    '));
    console.log(c.gray('    — before:'));
    console.log(indent(f.before, '      '));
    console.log(c.gray('    + after:'));
    console.log(c.green(indent(f.after, '      ')));
  }

  console.log('');
  const { breaking, deprecated } = countBySeverity(findings);
  const summary = `${findings.length} finding(s): ${breaking} BREAKING, ${deprecated} DEPRECATED`;
  const suppressed =
    result.suppressedCount > 0 ? c.gray(` (${result.suppressedCount} suppressed)`) : '';
  console.log((breaking > 0 ? c.red.bold(summary) : c.yellow.bold(summary)) + suppressed);
  printPySdkStatus(result, c);
  console.log(c.gray(`See ${SPEC_URL}`));
  printManualReview(c);
}

/** One-line pointer to the changes static analysis can't catch — keeps the tool honest. */
function printManualReview(c: any): void {
  console.error(
    c.gray(
      `note: ${MANUAL_REVIEW.length} more 2026-07-28 changes need manual review (SSE push, required headers, JSON Schema 2020-12) — see the README "Needs manual review" section.`,
    ),
  );
  console.error(
    c.gray(
      'note: July 28 is a spec release, not a remote kill switch — breakage appears when a client/server pair negotiates the new revision. Test both 2025-11-25 and 2026-07-28 paths during rollout (`mcp-vet fixtures`).',
    ),
  );
}

/**
 * Escape a value for a markdown table cell. The backslash has to go first, in
 * the same pass as the pipe: escaping only the pipe leaves `\` untouched, so a
 * path like `dir\|x.py` became `dir\\|x.py`, which markdown reads as an escaped
 * backslash followed by a LIVE cell delimiter (CodeQL js/incomplete-sanitization).
 * Scanned file paths are attacker-controllable input on a hostile repo.
 */
function mdEscape(s: string): string {
  return s.replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/** (b) Markdown table report. */
export function renderMarkdown(result: ScanResult): string {
  const { findings } = result;
  const { breaking, deprecated } = countBySeverity(findings);
  const lines: string[] = [];
  lines.push('# mcp-vet report');
  lines.push('');
  lines.push(
    `Scan for patterns that break under the [MCP 2026-07-28 spec release candidate](${SPEC_URL}) (ships final **${SPEC_DATE}**).`,
  );
  lines.push('');
  lines.push(
    `**${findings.length} finding(s):** ${breaking} BREAKING, ${deprecated} DEPRECATED` +
      (result.suppressedCount ? ` · ${result.suppressedCount} suppressed` : '') +
      `.`,
  );
  lines.push('');
  lines.push('| File | Line | Pattern | Severity | Confidence | Explanation |');
  lines.push('| --- | ---: | --- | --- | --- | --- |');
  for (const f of findings) {
    lines.push(
      `| \`${mdEscape(f.file)}\` | ${f.line} | ${f.patternId} | ${f.severity} | ${f.confidence} | ${mdEscape(
        f.explanation,
      )} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function writeMarkdown(result: ScanResult, outDir: string): string {
  const outPath = path.join(outDir, 'mcp-vet-report.md');
  fs.writeFileSync(outPath, renderMarkdown(result), 'utf8');
  return outPath;
}

/** Public projection of a finding for serialized output (drops internal fields). */
export function toPublicFinding(f: Finding) {
  return {
    file: f.file,
    line: f.line,
    column: f.column ?? null,
    endColumn: f.endColumn ?? null,
    patternId: f.patternId,
    patternLabel: f.patternLabel,
    severity: f.severity,
    section: f.section ?? null,
    confidence: f.confidence,
    explanation: f.explanation,
    docUrl: f.docUrl,
    source: f.source ?? null,
    before: f.before,
    after: f.after,
  };
}

/** (c) Structured JSON array of all findings (scan and probe share this shape). */
export function renderJson(result: Pick<ScanResult, 'findings'>): string {
  return JSON.stringify(result.findings.map(toPublicFinding), null, 2);
}

export function writeJson(result: ScanResult, outDir: string): string {
  const outPath = path.join(outDir, 'mcp-vet-results.json');
  fs.writeFileSync(outPath, renderJson(result), 'utf8');
  return outPath;
}

/** (d) GitHub Actions native annotations. ::error for BREAKING/ERROR/FATAL, ::warning otherwise. */
export function printGithubAnnotations(findings: Finding[]): void {
  for (const f of findings) {
    const level =
      f.severity === 'BREAKING' || f.severity === 'ERROR' || f.severity === 'FATAL'
        ? 'error'
        : f.severity === 'TOLERATED' || f.severity === 'INFO'
          ? 'notice'
          : 'warning';
    const msg = `${f.patternId} - ${f.explanation}`.replace(/\r?\n/g, ' ');
    const col = f.column ? `,col=${f.column}` : '';
    console.log(`::${level} file=${f.file},line=${f.line}${col}::${msg}`);
  }
}

function sarifLevel(sev: Severity): 'error' | 'warning' | 'note' {
  if (sev === 'BREAKING' || sev === 'ERROR' || sev === 'FATAL') return 'error';
  if (sev === 'TOLERATED' || sev === 'INFO') return 'note';
  return 'warning';
}

/** (e) SARIF 2.1.0 for GitHub code scanning / other SARIF consumers. */
export function renderSarif(result: Pick<ScanResult, 'findings'>): string {
  const cwd = process.cwd();
  const rules: object[] = ALL_PATTERN_IDS.map((id) => {
    const r = RULES[id];
    return {
      id,
      name: r.label.replace(/\s+/g, ''),
      shortDescription: { text: r.label },
      fullDescription: { text: r.explanation },
      helpUri: SPEC_URL,
      defaultConfiguration: { level: sarifLevel(r.severity) },
      properties: { severity: r.severity },
    };
  });
  // Runtime-probe, plugin, and Python-SDK rules join the driver metadata only
  // when they actually fired, so static-scan SARIF keeps its stable rule shape.
  type FiredRuleMeta = {
    label: string;
    explanation: string;
    docUrl: string;
    severity: Severity;
    section?: string;
  };
  const pushFiredRules = (registry: Record<string, FiredRuleMeta>) => {
    const used = [
      ...new Set(result.findings.map((f) => f.patternId).filter((id) => id in registry)),
    ];
    for (const id of used) {
      const r = registry[id];
      rules.push({
        id,
        name: r.label.replace(/[^A-Za-z0-9]+/g, ''),
        shortDescription: { text: r.label },
        fullDescription: { text: r.explanation },
        helpUri: r.docUrl,
        defaultConfiguration: { level: sarifLevel(r.severity) },
        properties: { severity: r.severity, ...(r.section && { section: r.section }) },
      });
    }
  };
  pushFiredRules(RUNTIME_RULES);
  pushFiredRules(PLUGIN_RULES);
  pushFiredRules(PY_SDK_RULES);

  const results = result.findings.map((f) => {
    // Prefer a cwd-relative posix uri; if the file lives outside cwd (relative
    // path escapes with "..") fall back to the scan-root-relative path, which
    // GitHub code scanning accepts.
    let uri = f.file;
    if (f.absPath) {
      const relToCwd = toPosix(path.relative(cwd, f.absPath));
      if (relToCwd && !relToCwd.startsWith('..')) uri = relToCwd;
    }
    const region: Record<string, number> = { startLine: f.line };
    if (f.column) region.startColumn = f.column;
    if (f.endColumn) region.endColumn = f.endColumn;
    return {
      ruleId: f.patternId,
      level: sarifLevel(f.severity),
      message: { text: `${f.patternId}: ${f.explanation}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            region,
          },
        },
      ],
      properties: {
        confidence: f.confidence,
        severity: f.severity,
        ...(f.section && { section: f.section }),
      },
    };
  });

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mcp-vet',
            informationUri: SPEC_URL,
            version: getVersion(),
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export function writeSarif(result: Pick<ScanResult, 'findings'>, outPath: string): string {
  fs.writeFileSync(outPath, renderSarif(result), 'utf8');
  return outPath;
}

/** (f) Terminal report for `mcp-vet probe` — runtime violations on a live server. */
export function reportProbeTerminal(result: ProbeResult, opts: TerminalOptions = {}): void {
  const c = makeChalk(opts.color);
  const { findings } = result;

  console.log(
    c.bold(`mcp-vet probe`) +
      c.gray(
        ` — ${result.target} · spec ${result.specVersion} · ${result.transport} · ${result.toolCount} tool(s) listed`,
      ),
  );
  for (const n of result.notes) console.log(c.gray(`  ${n}`));

  if (findings.length === 0) {
    console.log(
      c.green(
        `✔ no runtime violations — ` +
          (result.specVersion === '2026-07-28'
            ? 'the server answers stateless 2026-07-28 requests, implements server/discover, uses the new resource error code, and all tool schemas are JSON Schema 2020-12 compatible'
            : 'all tool schemas are JSON Schema 2020-12 compatible'),
      ),
    );
    return;
  }

  console.log('');
  for (const f of findings) {
    const sev = f.severity === 'ERROR' ? c.red.bold('ERROR') : c.yellow.bold('WARN');
    console.log(`${sev}  ${c.bold(f.patternId)} ${c.gray(`[${f.confidence}]`)}`);
    console.log(indent(f.explanation, '    '));
    console.log(c.gray('    — evidence:'));
    console.log(indent(f.before, '      '));
    console.log(c.gray('    + recommended fix:'));
    console.log(c.green(indent(f.after, '      ')));
  }

  console.log('');
  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  const warns = findings.length - errors;
  const summary = `${findings.length} violation(s): ${errors} ERROR, ${warns} WARN`;
  console.log(errors > 0 ? c.red.bold(summary) : c.yellow.bold(summary));
  console.log(c.gray(`See ${SPEC_URL}`));
}

/** (g) Terminal report for `mcp-vet plugin` — Agent Plugins 1.0 package findings. */
export function reportPluginTerminal(result: PluginVetResult, opts: TerminalOptions = {}): void {
  const c = makeChalk(opts.color);
  const { findings } = result;

  const scannedNote =
    result.sourceFilesScanned > 0
      ? ` · ${result.sourceFilesScanned} bundled source file(s) scanned`
      : '';
  console.log(
    c.bold('mcp-vet plugin') +
      c.gray(
        ` — ${result.pluginDir} · ${result.pluginName ?? '(unnamed)'} · ${result.servers.length} MCP server(s) · ${result.skillCount} skill(s)${scannedNote}`,
      ),
  );
  for (const n of result.notes) console.log(c.gray(`  note: ${n}`));

  if (findings.length === 0) {
    console.log(
      c.green(
        '✔ mcp-vet: the plugin envelope conforms to Agent Plugins 1.0.0 and no bundled server source matches a 2026-07-28 breaking or deprecated pattern',
      ),
    );
    return;
  }

  let currentFile = '';
  for (const f of findings) {
    if (f.file !== currentFile) {
      currentFile = f.file;
      console.log('');
      console.log(c.underline(f.file));
    }
    const sev =
      f.severity === 'BREAKING' || f.severity === 'FATAL'
        ? c.red.bold(f.severity)
        : f.severity === 'INFO'
          ? c.cyan.bold('INFO')
          : c.yellow.bold(f.severity);
    const loc = c.cyan(`${f.file}:${f.line}${f.column ? ':' + f.column : ''}`);
    const sec = f.section ? c.gray(`§${f.section}`) + ' ' : '';
    const conf = c.gray(`[${f.confidence}]`);
    console.log(`${loc}  ${sev}  ${c.bold(f.patternId)} ${sec}${conf}`);
    console.log(indent(f.explanation, '    '));
    console.log(c.gray('    — before:'));
    console.log(indent(f.before, '      '));
    console.log(c.gray('    + after:'));
    console.log(c.green(indent(f.after, '      ')));
  }

  console.log('');
  const order: Severity[] = ['FATAL', 'BREAKING', 'DEPRECATED', 'TOLERATED', 'INFO'];
  const parts = order
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  const summary = `${findings.length} finding(s): ${parts.join(', ')}`;
  const failing = findings.some((f) => f.severity === 'FATAL' || f.severity === 'BREAKING');
  console.log(failing ? c.red.bold(summary) : c.yellow.bold(summary));
  console.log(c.gray(`See https://agent-plugins.org/specification and ${SPEC_URL}`));
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

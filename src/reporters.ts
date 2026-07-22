import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { Finding, Severity, ALL_PATTERN_IDS } from './types';
import { RULES } from './rules';
import { ScanResult } from './scanner';
import { SPEC_URL, SPEC_DATE, MANUAL_REVIEW, getVersion } from './constants';

function makeChalk(color: boolean | undefined) {
  // color === true -> force on; false -> force off; undefined -> auto-detect
  if (color === true) return new (chalk as any).Instance({ level: 1 });
  if (color === false) return new (chalk as any).Instance({ level: 0 });
  return new (chalk as any).Instance({});
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
  console.log(c.gray(`See ${SPEC_URL}`));
  printManualReview(c);
}

/** One-line pointer to the changes static analysis can't catch — keeps the tool honest. */
function printManualReview(c: any): void {
  console.error(
    c.gray(
      `note: ${MANUAL_REVIEW.length} more 2026-07-28 changes need manual review (SSE push, required headers, auth, JSON Schema 2020-12) — see the README "Needs manual review" section.`,
    ),
  );
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
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
    confidence: f.confidence,
    explanation: f.explanation,
    docUrl: f.docUrl,
    source: f.source ?? null,
    before: f.before,
    after: f.after,
  };
}

/** (c) Structured JSON array of all findings. */
export function renderJson(result: ScanResult): string {
  return JSON.stringify(result.findings.map(toPublicFinding), null, 2);
}

export function writeJson(result: ScanResult, outDir: string): string {
  const outPath = path.join(outDir, 'mcp-vet-results.json');
  fs.writeFileSync(outPath, renderJson(result), 'utf8');
  return outPath;
}

/** (d) GitHub Actions native annotations. ::error for BREAKING, ::warning for DEPRECATED. */
export function printGithubAnnotations(findings: Finding[]): void {
  for (const f of findings) {
    const level = f.severity === 'BREAKING' ? 'error' : 'warning';
    const msg = `${f.patternId} - ${f.explanation}`.replace(/\r?\n/g, ' ');
    const col = f.column ? `,col=${f.column}` : '';
    console.log(`::${level} file=${f.file},line=${f.line}${col}::${msg}`);
  }
}

function sarifLevel(sev: Severity): 'error' | 'warning' {
  return sev === 'BREAKING' ? 'error' : 'warning';
}

/** (e) SARIF 2.1.0 for GitHub code scanning / other SARIF consumers. */
export function renderSarif(result: ScanResult): string {
  const cwd = process.cwd();
  const rules = ALL_PATTERN_IDS.map((id) => {
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
      properties: { confidence: f.confidence, severity: f.severity },
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

export function writeSarif(result: ScanResult, outPath: string): string {
  fs.writeFileSync(outPath, renderSarif(result), 'utf8');
  return outPath;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

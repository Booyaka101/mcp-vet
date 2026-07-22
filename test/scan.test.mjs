import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const fixtures = join(repoRoot, 'test', 'fixtures');

const { scan } = require('../dist/scanner.js');
const { IgnoreMatcher } = require('../dist/ignore.js');
const { ALL_PATTERN_IDS } = require('../dist/types.js');

const ALL = [
  'MCP_SESSION_ID',
  'INITIALIZE_HANDLER',
  'ERROR_CODE_32002',
  'TASKS_LEGACY',
  'ROOTS_CAP',
  'SAMPLING_CAP',
  'LOGGING_CAP',
];

function scanTarget(target, overrides = {}) {
  return scan([join(fixtures, target)], {
    enabled: new Set(overrides.enabled ?? ALL_PATTERN_IDS),
    ignore: new IgnoreMatcher(overrides.ignore ?? []),
    maxFileSizeKb: overrides.maxFileSizeKb ?? 0,
    pythonFallback: overrides.pythonFallback ?? true,
    minConfidence: overrides.minConfidence ?? 'low',
  });
}

function runCli(args, env = {}) {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-'));
  const res = spawnSync('node', [cli, ...args, '--out-dir', out, '--quiet'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let findings = [];
  try {
    findings = JSON.parse(readFileSync(join(out, 'mcp-vet-results.json'), 'utf8'));
  } catch {
    /* some runs use --no-files */
  }
  rmSync(out, { recursive: true, force: true });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, findings };
}

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

test('detects all 7 pattern types across the fixtures (exit 1)', () => {
  const res = runCli([fixtures]);
  const detected = new Set(res.findings.map((f) => f.patternId));
  for (const pid of ALL) {
    assert.ok(detected.has(pid), `expected ${pid} (got: ${[...detected].join(', ')})`);
  }
  assert.equal(res.status, 1, 'exit 1 when BREAKING findings exist');
  for (const f of res.findings) {
    assert.ok(f.file && f.line > 0, 'file + line present');
    assert.ok(['BREAKING', 'DEPRECATED'].includes(f.severity), 'valid severity');
    assert.ok(['high', 'medium', 'low'].includes(f.confidence), 'valid confidence');
    assert.ok(f.explanation && f.before && f.after && f.docUrl, 'rich fields present');
  }
});

test('severity classification is correct', () => {
  const { findings } = scanTarget('.');
  const sev = (pid) => new Set(findings.filter((f) => f.patternId === pid).map((f) => f.severity));
  for (const pid of ['MCP_SESSION_ID', 'INITIALIZE_HANDLER', 'ERROR_CODE_32002', 'TASKS_LEGACY']) {
    assert.deepEqual([...sev(pid)], ['BREAKING'], `${pid} is BREAKING`);
  }
  for (const pid of ['ROOTS_CAP', 'SAMPLING_CAP', 'LOGGING_CAP']) {
    assert.deepEqual([...sev(pid)], ['DEPRECATED'], `${pid} is DEPRECATED`);
  }
});

test('both TypeScript and Python files are scanned', () => {
  const { findings } = scanTarget('.');
  const files = new Set(findings.map((f) => f.file));
  assert.ok([...files].some((f) => f.endsWith('.ts')), 'has TS findings');
  assert.ok([...files].some((f) => f.endsWith('.py')), 'has Python findings');
});

test('clean fixture has zero violations and exit code 0', () => {
  const res = runCli([join(fixtures, 'clean')]);
  assert.equal(res.findings.length, 0, 'no findings');
  assert.equal(res.status, 0, 'exit 0');
});

// ---------------------------------------------------------------------------
// Precision: true negatives + confidence
// ---------------------------------------------------------------------------

test('true-negative fixtures produce zero findings', () => {
  const { findings } = scanTarget('negatives');
  assert.equal(findings.length, 0, `expected 0, got ${JSON.stringify(findings.map((f) => `${f.file}:${f.line}:${f.patternId}`))}`);
});

test('confidence gradient filters correctly', () => {
  const low = scanTarget('confidence/conf.ts', { minConfidence: 'low' }).findings;
  const med = scanTarget('confidence/conf.ts', { minConfidence: 'medium' }).findings;
  const high = scanTarget('confidence/conf.ts', { minConfidence: 'high' }).findings;
  assert.equal(low.length, 4, `low=${low.map((f) => f.patternId + f.confidence)}`);
  assert.equal(med.length, 3, `medium=${med.map((f) => f.patternId + f.confidence)}`);
  assert.equal(high.length, 2, `high=${high.map((f) => f.patternId + f.confidence)}`);
  // structural capability + method-compared initialize are the high ones
  assert.deepEqual(
    high.map((f) => f.patternId).sort(),
    ['INITIALIZE_HANDLER', 'SAMPLING_CAP'],
  );
});

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

test('inline suppression removes findings and counts them', () => {
  const res = scanTarget('suppress/suppressed.ts');
  assert.equal(res.findings.length, 1, 'only the un-suppressed finding survives');
  assert.equal(res.findings[0].patternId, 'TASKS_LEGACY');
  assert.equal(res.suppressedCount, 3, 'three suppressed');
});

test('mcp-vet-disable-file suppresses the whole file', () => {
  const res = scanTarget('suppress/all-off.ts');
  assert.equal(res.findings.length, 0, 'file fully suppressed');
});

// ---------------------------------------------------------------------------
// Rule selection + ignore
// ---------------------------------------------------------------------------

test('--only / enabled subset restricts rules', () => {
  const { findings } = scanTarget('.', { enabled: ['MCP_SESSION_ID'] });
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.patternId === 'MCP_SESSION_ID'));
});

test('ignore matcher skips matched paths', () => {
  const { findings } = scanTarget('.', { ignore: ['**/*.py'] });
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.file.endsWith('.ts')), 'no python findings');
});

// ---------------------------------------------------------------------------
// CLI: exit codes, fail-on, formats
// ---------------------------------------------------------------------------

test('--github-annotations emits ::error for BREAKING', () => {
  const res = runCli([fixtures, '--github-annotations', '--no-files']);
  const errs = res.stdout.split('\n').filter((l) => l.startsWith('::error file='));
  assert.ok(errs.length > 0, 'has ::error lines');
  assert.ok(errs.some((l) => l.includes('MCP_SESSION_ID')));
});

test('exit code 2 on a nonexistent path', () => {
  const res = runCli([join(fixtures, 'nope-does-not-exist'), '--no-files']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /path does not exist/);
});

test('--fail-on none never fails; --fail-on any fails on deprecated', () => {
  const none = runCli([fixtures, '--no-files', '--fail-on', 'none']);
  assert.equal(none.status, 0, 'fail-on none -> 0 even with breaking');
  const any = runCli([join(fixtures, 'clean'), '--no-files']); // clean -> 0
  assert.equal(any.status, 0);
  const dep = runCli([join(fixtures, 'server-capabilities.ts'), '--no-files', '--fail-on', 'any']);
  assert.equal(dep.status, 1, 'deprecated-only with fail-on any -> 1');
  const depDefault = runCli([join(fixtures, 'server-capabilities.ts'), '--no-files']);
  assert.equal(depDefault.status, 0, 'deprecated-only default -> 0');
});

test('SARIF output is valid 2.1.0 with rules and results', () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-'));
  const sarifPath = join(out, 'r.sarif');
  spawnSync('node', [cli, fixtures, '--no-files', '--quiet', '--sarif', sarifPath], {
    encoding: 'utf8',
  });
  const s = JSON.parse(readFileSync(sarifPath, 'utf8'));
  rmSync(out, { recursive: true, force: true });
  assert.equal(s.version, '2.1.0');
  assert.equal(s.runs[0].tool.driver.name, 'mcp-vet');
  assert.equal(s.runs[0].tool.driver.rules.length, 7);
  assert.ok(s.runs[0].results.length > 0);
  for (const r of s.runs[0].results) {
    assert.ok(['error', 'warning'].includes(r.level));
    assert.ok(r.locations[0].physicalLocation.region.startLine > 0);
  }
});

// ---------------------------------------------------------------------------
// Analyzer resilience
// ---------------------------------------------------------------------------

test('regex fallback detects patterns when Python is forced off', () => {
  const res = runCli(
    [join(fixtures, 'server_session.py'), '--no-files', '--github-annotations'],
    { MCP_VET_NO_PYTHON: '1' },
  );
  const anns = res.stdout.split('\n').filter((l) => l.startsWith('::'));
  const joined = anns.join('\n');
  assert.match(joined, /MCP_SESSION_ID/);
  assert.match(joined, /ERROR_CODE_32002/);
  assert.match(joined, /INITIALIZE_HANDLER/);
});

test('BOM + CRLF files are scanned with correct line numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-bom-'));
  const content = ['// header', "const s = 'Mcp-Session-Id';", 'const n = -32002;'].join('\r\n');
  writeFileSync(join(dir, 'bom.ts'), '﻿' + content, 'utf8');
  const res = scan([dir], {
    enabled: new Set(ALL_PATTERN_IDS),
    ignore: new IgnoreMatcher([]),
    maxFileSizeKb: 0,
    pythonFallback: true,
    minConfidence: 'low',
  });
  rmSync(dir, { recursive: true, force: true });
  const mcp = res.findings.find((f) => f.patternId === 'MCP_SESSION_ID');
  const err = res.findings.find((f) => f.patternId === 'ERROR_CODE_32002');
  assert.ok(mcp && mcp.line === 2, `MCP on line 2 (got ${mcp?.line})`);
  assert.ok(err && err.line === 3, `error code on line 3 (got ${err?.line})`);
});

test('a syntax-error file does not crash the scan; siblings still scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-syn-'));
  writeFileSync(join(dir, 'broken.py'), 'def (:\n  x = -32002\n', 'utf8');
  writeFileSync(join(dir, 'ok.py'), 'code = -32002\n', 'utf8');
  writeFileSync(join(dir, 'broken.ts'), 'const x = = = ;', 'utf8');
  writeFileSync(join(dir, 'ok.ts'), "const s = 'tasks/get';\n", 'utf8');
  const res = scan([dir], {
    enabled: new Set(ALL_PATTERN_IDS),
    ignore: new IgnoreMatcher([]),
    maxFileSizeKb: 0,
    pythonFallback: true,
    minConfidence: 'low',
  });
  rmSync(dir, { recursive: true, force: true });
  const files = new Set(res.findings.map((f) => f.file));
  assert.ok(files.has('ok.py'), 'valid python sibling scanned');
  assert.ok(files.has('ok.ts'), 'valid ts sibling scanned');
});

test('--max-file-size skips oversized files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-big-'));
  const big = "const s = 'Mcp-Session-Id';\n" + '// pad\n'.repeat(2000);
  writeFileSync(join(dir, 'big.ts'), big, 'utf8');
  const res = scan([dir], {
    enabled: new Set(ALL_PATTERN_IDS),
    ignore: new IgnoreMatcher([]),
    maxFileSizeKb: 1, // 1 KB limit
    pythonFallback: true,
    minConfidence: 'low',
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.findings.length, 0, 'oversized file skipped');
  assert.equal(res.skippedLargeFiles.length, 1);
});

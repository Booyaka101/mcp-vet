import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
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
  'ERROR_CODE_RENUMBERED',
  'TASKS_LEGACY',
  'TASKS_LIST_REMOVED',
  'TASKS_RESULT_REMOVED',
  'PING_REMOVED',
  'RESOURCE_SUBSCRIBE_REMOVED',
  'ROOTS_LIST_CHANGED_REMOVED',
  'LOGGING_SETLEVEL_REMOVED',
  'SSE_RESUMABILITY_REMOVED',
  'ELICITATION_COMPLETE_REMOVED',
  'ROOTS_CAP',
  'SAMPLING_CAP',
  'LOGGING_CAP',
  'INCLUDE_CONTEXT_VALUES',
  'OAUTH_DCR',
  'AUTH_ISS_UNVALIDATED',
  'AUTH_DCR_NO_APPLICATION_TYPE',
  'AUTH_CREDENTIALS_NOT_ISSUER_KEYED',
];

// The three authorization-hardening rules added in 0.10.0 (final changelog
// Minor changes 7/8/9 — SEP-2468 / SEP-837 / SEP-2352).
const AUTH_IDS = [
  'AUTH_ISS_UNVALIDATED',
  'AUTH_DCR_NO_APPLICATION_TYPE',
  'AUTH_CREDENTIALS_NOT_ISSUER_KEYED',
];

// The nine rule ids added or reclassified for the FINAL 2026-07-28 changelog.
const NEW_IDS = [
  'PING_REMOVED',
  'RESOURCE_SUBSCRIBE_REMOVED',
  'ROOTS_LIST_CHANGED_REMOVED',
  'LOGGING_SETLEVEL_REMOVED',
  'SSE_RESUMABILITY_REMOVED',
  'ELICITATION_COMPLETE_REMOVED',
  'ERROR_CODE_RENUMBERED',
  'INCLUDE_CONTEXT_VALUES',
  'OAUTH_DCR',
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

test('detects all 21 pattern types across the fixtures (exit 1)', () => {
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
  for (const pid of [
    'MCP_SESSION_ID',
    'INITIALIZE_HANDLER',
    'ERROR_CODE_32002',
    'ERROR_CODE_RENUMBERED',
    'TASKS_LEGACY',
    'TASKS_LIST_REMOVED',
    'TASKS_RESULT_REMOVED',
    'PING_REMOVED',
    'RESOURCE_SUBSCRIBE_REMOVED',
    'ROOTS_LIST_CHANGED_REMOVED',
    'LOGGING_SETLEVEL_REMOVED',
    'SSE_RESUMABILITY_REMOVED',
    'ELICITATION_COMPLETE_REMOVED',
  ]) {
    assert.deepEqual([...sev(pid)], ['BREAKING'], `${pid} is BREAKING`);
  }
  for (const pid of [
    'ROOTS_CAP',
    'SAMPLING_CAP',
    'LOGGING_CAP',
    'INCLUDE_CONTEXT_VALUES',
    'OAUTH_DCR',
    'AUTH_ISS_UNVALIDATED',
    'AUTH_DCR_NO_APPLICATION_TYPE',
    'AUTH_CREDENTIALS_NOT_ISSUER_KEYED',
  ]) {
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

test('tasks/list is flagged as a BREAKING removal (high confidence)', () => {
  const { findings } = scanTarget('server-tasks.ts');
  const list = findings.filter((f) => f.patternId === 'TASKS_LIST_REMOVED');
  assert.equal(list.length, 1, 'exactly one tasks/list finding');
  assert.equal(list[0].severity, 'BREAKING');
  assert.equal(list[0].confidence, 'high');
});

test('tasks/result is flagged as a BREAKING removal', () => {
  const { findings } = scanTarget('server-tasks.ts');
  const r = findings.filter((f) => f.patternId === 'TASKS_RESULT_REMOVED');
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, 'BREAKING');
});

// ---------------------------------------------------------------------------
// Real-SDK patterns: schema constants, method strings, sessionIdGenerator
// ---------------------------------------------------------------------------

test('SDK schema-constant handler registration is detected', () => {
  const { findings } = scanTarget('sdk-patterns.ts');
  const ids = new Set(findings.map((f) => f.patternId));
  // InitializeRequestSchema etc. must map to the right rules even with no string literal.
  assert.ok(ids.has('INITIALIZE_HANDLER'), 'InitializeRequestSchema → INITIALIZE_HANDLER');
  assert.ok(ids.has('SAMPLING_CAP'), 'CreateMessageRequestSchema → SAMPLING_CAP');
  assert.ok(ids.has('ROOTS_CAP'), 'ListRootsRequestSchema → ROOTS_CAP');
  // RECLASSIFIED for the final changelog: setLevel is a hard removal now.
  assert.ok(ids.has('LOGGING_SETLEVEL_REMOVED'), 'SetLevelRequestSchema → LOGGING_SETLEVEL_REMOVED');
  assert.ok(ids.has('LOGGING_CAP'), 'notifications/message → LOGGING_CAP');
  assert.ok(ids.has('TASKS_LIST_REMOVED'), 'ListTasksRequestSchema → TASKS_LIST_REMOVED');
  assert.ok(ids.has('TASKS_RESULT_REMOVED'), 'GetTaskResultRequestSchema → TASKS_RESULT_REMOVED');
});

test('deprecated-capability method strings are flagged (DEPRECATED, high)', () => {
  const { findings } = scanTarget('sdk-patterns.ts');
  const byPattern = (p) => findings.filter((f) => f.patternId === p && f.confidence === 'high');
  assert.ok(
    byPattern('SAMPLING_CAP').some((f) => f.severity === 'DEPRECATED'),
    'sampling/createMessage flagged',
  );
  assert.ok(byPattern('ROOTS_CAP').length > 0, 'roots/list flagged');
  assert.ok(byPattern('LOGGING_CAP').length > 0, 'notifications/message flagged');
});

test('Python SDK capability constructors are high confidence (structural)', () => {
  const { pythonAvailable } = require('../dist/py-analyzer.js');
  if (!pythonAvailable()) return; // structural context needs the AST path
  const { findings } = scanTarget('sdk_caps.py');
  const roots = findings.filter((f) => f.patternId === 'ROOTS_CAP');
  const sampling = findings.filter((f) => f.patternId === 'SAMPLING_CAP');
  assert.ok(roots.length > 0 && roots.some((f) => f.confidence === 'high'), 'roots high');
  assert.ok(sampling.length > 0 && sampling.some((f) => f.confidence === 'high'), 'sampling high');
});

test('sessionIdGenerator is flagged only when it is a real generator', () => {
  const { findings } = scanTarget('sdk-patterns.ts');
  const session = findings.filter((f) => f.patternId === 'MCP_SESSION_ID');
  // Exactly one: the active generator. `sessionIdGenerator: undefined` must NOT fire.
  assert.equal(session.length, 1, `expected 1 session finding, got ${session.length}`);
  assert.equal(session[0].confidence, 'medium');
  assert.equal(session[0].severity, 'BREAKING');
});

// ---------------------------------------------------------------------------
// v0.9.0: the nine rules added/reclassified for the FINAL 2026-07-28 changelog
// ---------------------------------------------------------------------------

test('dirty fixtures: every new/reclassified rule fires in BOTH analyzers (exit 1)', () => {
  const res = runCli([join(fixtures, 'dirty')]);
  assert.equal(res.status, 1, 'BREAKING findings exit 1');
  const tsIds = new Set(res.findings.filter((f) => f.file.endsWith('.ts')).map((f) => f.patternId));
  const pyIds = new Set(res.findings.filter((f) => f.file.endsWith('.py')).map((f) => f.patternId));
  for (const pid of NEW_IDS) {
    assert.ok(tsIds.has(pid), `TS analyzer detects ${pid} (got: ${[...tsIds].join(', ')})`);
    assert.ok(pyIds.has(pid), `Python analyzer detects ${pid} (got: ${[...pyIds].join(', ')})`);
  }
  // The migrated sessionIdGenerator: undefined in the dirty file must NOT fire.
  assert.ok(!tsIds.has('MCP_SESSION_ID'), 'benign sessionIdGenerator: undefined stays clean');
});

test('SEVERITY SPLIT LOCK: removed METHODS are BREAKING (exit 1) while the capability KEYS stay DEPRECATED (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-split-'));
  // A server using the two hard-removed method strings…
  const removed = join(dir, 'removed.ts');
  writeFileSync(
    removed,
    [
      "server.setRequestHandler('logging/setLevel', h);",
      "server.notification({ method: 'notifications/roots/list_changed' });",
    ].join('\n'),
    'utf8',
  );
  const r1 = runCli([removed]);
  const ids1 = new Set(r1.findings.map((f) => f.patternId));
  assert.equal(r1.status, 1, 'hard removals fail the build');
  assert.ok(ids1.has('LOGGING_SETLEVEL_REMOVED'), `LOGGING_SETLEVEL_REMOVED (got ${[...ids1]})`);
  assert.ok(ids1.has('ROOTS_LIST_CHANGED_REMOVED'), 'ROOTS_LIST_CHANGED_REMOVED');
  assert.ok(!ids1.has('LOGGING_CAP') && !ids1.has('ROOTS_CAP'), 'no double-count as DEPRECATED');
  assert.ok(
    r1.findings.every((f) => (ids1.has(f.patternId) ? f.severity === 'BREAKING' : true)),
    'removed methods are BREAKING',
  );
  // …versus a server merely declaring the capability keys.
  const caps = join(dir, 'caps.ts');
  writeFileSync(caps, 'export const s = { capabilities: { logging: {}, roots: {} } };\n', 'utf8');
  const r2 = runCli([caps]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r2.status, 0, 'capability keys alone stay exit 0');
  const ids2 = new Set(r2.findings.map((f) => f.patternId));
  assert.ok(ids2.has('LOGGING_CAP') && ids2.has('ROOTS_CAP'), 'still reported as DEPRECATED');
  assert.ok(r2.findings.every((f) => f.severity === 'DEPRECATED'), 'DEPRECATED only');
});

// ---------------------------------------------------------------------------
// v0.10.0: the three auth-hardening rules (SEP-2468 / SEP-837 / SEP-2352)
// ---------------------------------------------------------------------------

test('auth-hardening rules fire in BOTH analyzers at the DEPRECATED tier', () => {
  const res = runCli([join(fixtures, 'dirty')]);
  const tsIds = new Set(res.findings.filter((f) => f.file.endsWith('.ts')).map((f) => f.patternId));
  const pyIds = new Set(res.findings.filter((f) => f.file.endsWith('.py')).map((f) => f.patternId));
  for (const pid of AUTH_IDS) {
    assert.ok(tsIds.has(pid), `TS analyzer detects ${pid} (got: ${[...tsIds].join(', ')})`);
    assert.ok(pyIds.has(pid), `Python analyzer detects ${pid} (got: ${[...pyIds].join(', ')})`);
  }
  // MUSTs about correctness, not removals — they warn (exit 0 tier), never exit 1.
  for (const f of res.findings.filter((x) => AUTH_IDS.includes(x.patternId))) {
    assert.equal(f.severity, 'DEPRECATED', `${f.patternId} stays at the exit-0 tier`);
    assert.equal(f.confidence, 'medium');
  }
});

test('WORKED EXAMPLE: DCR body without application_type + redemption without iss = exactly two findings, exit 0', () => {
  const res = runCli([join(fixtures, 'auth', 'worked-example.ts')]);
  assert.equal(res.status, 0, `no BREAKING rule fired — exit 0\n${res.stderr}`);
  const ids = res.findings.map((f) => f.patternId).sort();
  assert.deepEqual(ids, ['AUTH_DCR_NO_APPLICATION_TYPE', 'AUTH_ISS_UNVALIDATED'],
    JSON.stringify(res.findings.map((f) => `${f.file}:${f.line}:${f.patternId}`)));
  for (const f of res.findings) {
    assert.equal(f.severity, 'DEPRECATED');
    assert.equal(f.confidence, 'medium');
    assert.ok(f.line > 0 && f.column > 0, 'line and column are present');
  }
  const dcr = res.findings.find((f) => f.patternId === 'AUTH_DCR_NO_APPLICATION_TYPE');
  assert.ok(dcr.docUrl.endsWith('/pull/837'), `SEP-837 docUrl (got ${dcr.docUrl})`);
  assert.match(dcr.after, /application_type/, 'fix sets application_type explicitly');
  assert.match(dcr.after, /2858/, 'fix notes the DCR deprecation via PR #2858');
  assert.match(dcr.before, /redirect_uris/, 'anchored at the registration body');
  const iss = res.findings.find((f) => f.patternId === 'AUTH_ISS_UNVALIDATED');
  assert.ok(iss.docUrl.endsWith('/pull/2468'), `SEP-2468 docUrl (got ${iss.docUrl})`);
  assert.match(iss.explanation, /RFC 9207/, 'explanation cites RFC 9207');
  assert.match(iss.before, /authorization_code/, 'anchored at the code redemption');
});

test('WORKED EXAMPLE migrated (application_type + iss guard) produces zero findings', () => {
  const res = runCli([join(fixtures, 'auth', 'worked-example-migrated.ts')]);
  assert.equal(res.status, 0);
  assert.equal(
    res.findings.length,
    0,
    `expected 0, got ${JSON.stringify(res.findings.map((f) => `${f.file}:${f.line}:${f.patternId}`))}`,
  );
});

test('REGRESSION (0.10.1): SDK-routed registration supplies application_type and stays clean', () => {
  // Both official SDKs fill the parameter in — python-sdk defaults it on
  // OAuthClientMetadata, typescript-sdk derives it from redirect_uris — so a
  // body routed through either is already SEP-837 correct. v0.10.0 flagged
  // these (and miscounted the corpus hits as true positives); this locks it.
  for (const f of ['negatives/sdk_dcr_defaults.py', 'negatives/sdk-dcr-defaults.ts']) {
    const { findings } = scanTarget(f);
    assert.equal(
      findings.length,
      0,
      `${f} must stay clean, got ${JSON.stringify(findings.map((x) => `${x.line}:${x.patternId}`))}`,
    );
  }
  // ...while a HAND-ROLLED registration POST still fires.
  const { findings } = scanTarget('auth/worked-example.ts');
  assert.ok(
    findings.some((x) => x.patternId === 'AUTH_DCR_NO_APPLICATION_TYPE'),
    'hand-rolled registration body is still flagged',
  );
});

test('a plain OAuth client (no MCP context) stays clean — TS', () => {
  const { findings } = scanTarget('negatives/plain-oauth-client.ts');
  assert.equal(findings.length, 0, JSON.stringify(findings.map((f) => `${f.line}:${f.patternId}`)));
});

test('a plain OAuth client (no MCP context) stays clean — Python', () => {
  const { findings } = scanTarget('negatives/plain_oauth_client.py');
  assert.equal(findings.length, 0, JSON.stringify(findings.map((f) => `${f.line}:${f.patternId}`)));
});

test('credentials keyed by the ISSUER stay clean; a bare-constant key fires (TS + Python)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-auth-'));
  const bad = join(dir, 'bad.ts');
  writeFileSync(
    bad,
    [
      '// persists credentials for an MCP server connection',
      "store.set('mcp-connector', { client_id, client_secret });",
    ].join('\n'),
    'utf8',
  );
  const good = join(dir, 'good.ts');
  writeFileSync(
    good,
    [
      '// persists credentials for an MCP server connection, keyed by issuer',
      'store.set(issuer, { client_id, client_secret });',
    ].join('\n'),
    'utf8',
  );
  const goodPy = join(dir, 'good.py');
  writeFileSync(
    goodPy,
    [
      '# persists credentials for an MCP server connection, keyed by issuer',
      'store.set(issuer, {"client_id": cid, "client_secret": secret})',
    ].join('\n'),
    'utf8',
  );
  const r1 = runCli([bad]);
  const r2 = runCli([good]);
  const r3 = runCli([goodPy]);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(
    r1.findings.map((f) => f.patternId),
    ['AUTH_CREDENTIALS_NOT_ISSUER_KEYED'],
    JSON.stringify(r1.findings),
  );
  assert.equal(r1.status, 0, 'warns without failing the build');
  assert.equal(r2.findings.length, 0, 'issuer-keyed TS store is the migrated form');
  assert.equal(r3.findings.length, 0, 'issuer-keyed Python store is the migrated form');
});

test('no rule docUrl points at the /draft/ specification tree (dated permalinks only)', () => {
  const { RULES, RUNTIME_RULES } = require('../dist/rules.js');
  const { SPEC_URL, CHANGELOG_URL, DEPRECATED_REGISTRY_URL } = require('../dist/constants.js');
  for (const [id, r] of Object.entries(RULES)) {
    const url = r.docUrl ?? SPEC_URL;
    assert.ok(!url.includes('/draft/'), `${id} cites a /draft/ URL: ${url}`);
  }
  for (const [id, r] of Object.entries(RUNTIME_RULES)) {
    assert.ok(!r.docUrl.includes('/draft/'), `${id} cites a /draft/ URL: ${r.docUrl}`);
  }
  assert.match(CHANGELOG_URL, /\/2026-07-28\/changelog$/, 'changelog pinned to the dated permalink');
  assert.match(DEPRECATED_REGISTRY_URL, /\/2026-07-28\/deprecated$/, 'registry pinned to the dated permalink');
});

test('deprecated findings cite the registry removal window, not a hardcoded 12 months', () => {
  const { findings } = scanTarget('server-capabilities.ts');
  const roots = findings.find((f) => f.patternId === 'ROOTS_CAP');
  assert.ok(roots, 'roots capability finding present');
  assert.match(roots.explanation, /First revision released on or after 2027-07-28/);
  assert.ok(!/12-month/.test(roots.explanation), 'no hardcoded 12-month window');
});

// ---------------------------------------------------------------------------
// Autofix (--fix) and JSON stdout (--json)
// ---------------------------------------------------------------------------

test('--fix rewrites the renumbered codes (-32001/-32003/-32004) alongside -32002', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-renum-'));
  const file = join(dir, 'srv.ts');
  writeFileSync(
    file,
    [
      "const a = { error: { code: -32001, message: 'Header mismatch' } };",
      "const b = { error: { code: -32003, message: 'Missing capability' } };",
      'const c = err.code === -32004;',
      "const d = { error: { code: -32002, message: 'not found' } };",
      'const keep = -32001; // NOT in a code position — grandfathered, untouched',
    ].join('\n'),
    'utf8',
  );
  const res = spawnSync('node', [cli, file, '--fix', '--no-files', '--quiet'], { encoding: 'utf8' });
  const after = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  assert.ok(after.includes('code: -32020'), '-32001 → -32020');
  assert.ok(after.includes('code: -32021'), '-32003 → -32021');
  assert.ok(after.includes('=== -32022'), '-32004 → -32022');
  assert.ok(after.includes('code: -32602'), '-32002 → -32602 still works');
  assert.ok(after.includes('const keep = -32001;'), 'implementation-defined constant untouched');
  assert.equal(res.status, 0, 'exit 0 once every breaking finding was auto-fixed');
});

test('--fix --dry-run lists all three renumber rewrites plus the -32002 rewrite', () => {
  const res = spawnSync(
    'node',
    [cli, join(fixtures, 'dirty'), '--fix', '--dry-run', '--no-files'],
    { encoding: 'utf8' },
  );
  assert.match(res.stdout, /dry-run/i);
  for (const to of ['-32020', '-32021', '-32022', '-32602']) {
    assert.ok(res.stdout.includes(to), `dry-run lists the ${to} rewrite:\n${res.stdout}`);
  }
  assert.equal(res.status, 1, 'nothing fixed in dry-run — findings still gate');
});

test('--fix rewrites -32002 -> -32602 in place and clears those findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-fix-'));
  const file = join(dir, 'srv.ts');
  writeFileSync(
    file,
    ['const a = -32002;', "const b = { code: -32002 };", 'const keep = -32601;'].join('\n'),
    'utf8',
  );
  const res = spawnSync('node', [cli, file, '--fix', '--no-files', '--quiet'], { encoding: 'utf8' });
  const after = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  assert.ok(!after.includes('-32002'), 'no -32002 remains');
  assert.equal((after.match(/-32602/g) || []).length, 2, 'both occurrences rewritten');
  assert.ok(after.includes('-32601'), 'unrelated code untouched');
  assert.equal(res.status, 0, 'exit 0 after the only breaking findings were auto-fixed');
});

test('--json prints a JSON array of findings to stdout', () => {
  const res = spawnSync('node', [cli, join(fixtures, 'server-tasks.ts'), '--json', '--no-files'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(res.stdout); // stdout must be pure JSON
  assert.ok(Array.isArray(parsed), 'stdout is a JSON array');
  assert.ok(parsed.length > 0, 'has findings');
  assert.ok(parsed.some((f) => f.patternId === 'TASKS_LIST_REMOVED'), 'includes tasks/list');
  assert.ok(
    parsed.every((f) => f.patternId && f.severity && f.line > 0),
    'each finding is well-formed',
  );
});

test('--fix --dry-run previews the rewrite but changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-dry-'));
  const file = join(dir, 'x.ts');
  writeFileSync(file, 'const a = -32002;\n', 'utf8');
  const res = spawnSync('node', [cli, file, '--fix', '--dry-run', '--no-files'], { encoding: 'utf8' });
  const after = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  assert.ok(after.includes('-32002'), 'file left unchanged in dry-run');
  assert.match(res.stdout, /dry-run/i, 'announces dry-run');
  assert.match(res.stdout, /-32602/, 'shows the proposed replacement');
  assert.equal(res.status, 1, 'finding still counts (nothing was fixed)');
});

test('--fix never corrupts an unrelated -32002 on a column mismatch (no blind fallback)', () => {
  const { applyFixes } = require('../dist/autofix.js');
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-fix2-'));
  const file = join(dir, 'x.ts');
  writeFileSync(file, 'const s = "keep -32002 keep";\n', 'utf8');
  // A finding whose column points nowhere near a numeric -32002 (a skewed offset).
  const res = applyFixes([{ patternId: 'ERROR_CODE_32002', absPath: file, line: 1, column: 1 }]);
  const after = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.fixedCount, 0, 'nothing fixed when the column does not match');
  assert.ok(after.includes('keep -32002 keep'), 'string literal left untouched');
});

test('Python multibyte line: --fix rewrites the numeric code, not a -32002 inside a string', () => {
  const { pythonAvailable } = require('../dist/py-analyzer.js');
  if (!pythonAvailable()) return; // AST-only guarantee; the regex fallback lacks context
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-py-'));
  const file = join(dir, 'srv.py');
  writeFileSync(file, 'def f():\n    raise ValueError("éé -32002 here", -32002)\n', 'utf8');
  spawnSync('node', [cli, file, '--fix', '--no-files', '--quiet'], { encoding: 'utf8' });
  const after = readFileSync(file, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  assert.ok(after.includes('"éé -32002 here"'), 'string literal preserved (byte/char column fix)');
  assert.ok(after.includes(', -32602)'), 'numeric error code rewritten');
});

test('CLI --disable applies on top of a config `only` (CLI wins)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-cfg-'));
  const cfg = join(dir, 'rc.json');
  writeFileSync(cfg, JSON.stringify({ only: ['MCP_SESSION_ID', 'ERROR_CODE_32002'] }), 'utf8');
  const src = join(dir, 'srv.ts');
  writeFileSync(src, "const h = 'Mcp-Session-Id';\nconst n = -32002;\n", 'utf8');
  const res = runCli([src, '--config', cfg, '--disable', 'ERROR_CODE_32002']);
  const ids = new Set(res.findings.map((f) => f.patternId));
  rmSync(dir, { recursive: true, force: true });
  assert.ok(ids.has('MCP_SESSION_ID'), 'config only kept MCP_SESSION_ID');
  assert.ok(!ids.has('ERROR_CODE_32002'), 'CLI --disable removed ERROR_CODE_32002 despite config only');
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
  assert.equal(s.runs[0].tool.driver.rules.length, 21);
  assert.ok(s.runs[0].results.length > 0);
  for (const r of s.runs[0].results) {
    assert.ok(['error', 'warning'].includes(r.level));
    assert.ok(r.locations[0].physicalLocation.region.startLine > 0);
  }
});

// ---------------------------------------------------------------------------
// Adversarial suite: obfuscated usages — locks in hits AND documented misses
// ---------------------------------------------------------------------------

test('aliased TS imports are flagged at the import AND the aliased usage site', () => {
  const { findings } = scanTarget('adversarial/caught/aliased-imports.ts');
  const init = findings.filter((f) => f.patternId === 'INITIALIZE_HANDLER');
  const list = findings.filter((f) => f.patternId === 'TASKS_LIST_REMOVED');
  assert.equal(init.length, 2, `import + usage (got ${init.length})`);
  assert.equal(list.length, 2, `import + usage (got ${list.length})`);
});

test('namespace-qualified SDK constants (types.InitializeRequestSchema) are flagged', () => {
  const { findings } = scanTarget('adversarial/caught/namespace-import.ts');
  assert.ok(findings.some((f) => f.patternId === 'INITIALIZE_HANDLER'));
});

test('Python import aliases are resolved (import line + usage site)', () => {
  const { pythonAvailable } = require('../dist/py-analyzer.js');
  if (!pythonAvailable()) return; // alias resolution needs the AST path
  const { findings } = scanTarget('adversarial/caught/aliased_imports.py');
  const roots = findings.filter((f) => f.patternId === 'ROOTS_CAP');
  assert.equal(roots.length, 2, `import + usage (got ${roots.length})`);
});

test('client-side session ownership is flagged (TS); migrated/unrelated forms are not', () => {
  const { findings } = scanTarget('adversarial/caught/client-session.ts');
  const session = findings.filter((f) => f.patternId === 'MCP_SESSION_ID');
  assert.equal(session.length, 2, `constructor sessionId + transport read (got ${session.length})`);
  assert.ok(session.every((f) => f.confidence === 'medium'), 'client-session findings are medium');
});

test('client-side session ownership is flagged (Python); None/unrelated are not', () => {
  const { pythonAvailable } = require('../dist/py-analyzer.js');
  if (!pythonAvailable()) return; // needs the AST path for call/attribute context
  const { findings } = scanTarget('adversarial/caught/client_session.py');
  const session = findings.filter((f) => f.patternId === 'MCP_SESSION_ID');
  assert.equal(session.length, 2, `kwarg + attribute read (got ${session.length})`);
});

test('known-miss adversarial fixtures produce zero findings (documented limitations)', () => {
  const { findings } = scanTarget('adversarial/missed');
  // If this ever fails because findings appeared, detection improved:
  // move the fixture to caught/ and update README "Known limitations".
  assert.equal(
    findings.length,
    0,
    `expected 0, got ${JSON.stringify(findings.map((f) => `${f.file}:${f.line}:${f.patternId}`))}`,
  );
});

// ---------------------------------------------------------------------------
// Conformance fixtures command
// ---------------------------------------------------------------------------

test('`mcp-vet fixtures <dir>` writes the conformance fixtures and checklist', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'mcp-vet-conf-')), 'out');
  const res = spawnSync('node', [cli, 'fixtures', dir], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const names = readdirSync(dir);
  assert.equal(names.filter((n) => n.endsWith('.json')).length, 11, 'eleven fixture files');
  const listen = JSON.parse(readFileSync(join(dir, '10-subscriptions-listen.json'), 'utf8'));
  assert.equal(listen.steps[0].send.body.method, 'subscriptions/listen');
  assert.equal(listen.steps[0].send.body.params.subscriptions.toolsListChanged, true);
  assert.match(listen.description, /io\.modelcontextprotocol\/subscriptionId/);
  const mrtr = JSON.parse(readFileSync(join(dir, '11-mrtr.json'), 'utf8'));
  assert.match(mrtr.steps[0].expect, /input_required/);
  assert.ok('inputResponses' in mrtr.steps[1].send.body.params, 'retry carries inputResponses');
  assert.ok(names.includes('CHECKLIST.md'));
  const checklist = readFileSync(join(dir, 'CHECKLIST.md'), 'utf8');
  assert.match(checklist, /2025-11-25/, 'dual-version matrix names the old revision');
  assert.match(checklist, /not a switch/i, 'spec-date nuance is explicit');
  const discover = JSON.parse(readFileSync(join(dir, '01-discover.json'), 'utf8'));
  assert.equal(discover.steps[0].send.body.method, 'server/discover');
  assert.equal(discover.steps[0].send.body.params._meta.protocolVersion, '2026-07-28');
  const headers = JSON.parse(readFileSync(join(dir, '03-http-routing-headers.json'), 'utf8'));
  assert.equal(headers.steps[0].send.headers['Mcp-Method'], 'tools/call');
  rmSync(dirname(dir), { recursive: true, force: true });
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

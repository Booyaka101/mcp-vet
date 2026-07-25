// Tests for `mcp-vet probe` — the runtime prober behind the four 2026-07-28
// wire-level checks: json-schema-dialect (SEP-2106), requires-initialize-
// handshake (stateless protocol readiness), missing-server-discover (the
// required server/discover RPC, SEP-2575), and legacy-resource-error-code
// (-32002 → -32602).
//
// The CLI is spawned ASYNC (never spawnSync) per LESSONS 2026-07-21: the HTTP
// tests run a fixture server as a sibling process and must keep the event loop
// free while the probe talks to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const fixtures = join(repoRoot, 'test', 'probe-fixtures');

const { analyzeSchemaDialect } = require('../dist/schema-dialect.js');

const BRIEF_DIALECT_FIX =
  'Set $schema to https://json-schema.org/draft/2020-12/schema and replace "definitions" with "$defs". If using TypeScript SDK, upgrade to @modelcontextprotocol/server and configure zod-to-json-schema for draft 2020-12.';
const BRIEF_HANDSHAKE_FIX =
  'Update your SDK to @modelcontextprotocol/server (the new 2026-07-28 package) and remove any initialize handler assumptions';

/** Run `mcp-vet <subcommand> <args>` asynchronously; resolve with status + output. */
function runCli(subcommand, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, subcommand, '--no-color', ...args], {
      encoding: 'utf8',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Run `mcp-vet probe <args>` asynchronously; resolve with status + output. */
function runProbe(args) {
  return runCli('probe', args);
}

/** Probe with --json and parse the findings array printed to stdout. */
async function runProbeJson(args) {
  const res = await runProbe(['--json', ...args]);
  let findings = [];
  try {
    findings = JSON.parse(res.stdout);
  } catch {
    /* leave [] — callers assert on it */
  }
  return { ...res, findings };
}

/** Start the HTTP fixture in `mode`; resolve with { url, kill } once listening. */
function startHttpFixture(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(fixtures, 'server-http.mjs'), mode]);
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('HTTP fixture did not print PORT within 10 s'));
    }, 10_000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /PORT=(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ url: `http://127.0.0.1:${m[1]}`, kill: () => child.kill() });
      }
    });
    child.on('exit', () => clearTimeout(timer));
  });
}

const draft07 = join(fixtures, 'server-draft07.mjs');
const requiresInit = join(fixtures, 'server-requires-init.mjs');
const stateless = join(fixtures, 'server-stateless.mjs');
const partial = join(fixtures, 'server-partial.mjs');
const sessionful = join(fixtures, 'server-sessionful.mjs');
const deprecated = join(fixtures, 'server-deprecated.mjs');
// Small window keeps the deprecated-traffic listen (checks 4 & 6) snappy in CI;
// emitting fixtures resolve early, and the fixtures here respond instantly.
const SPEC = ['--spec', '2026-07-28', '--timeout', '1200'];

// ---------------------------------------------------------------------------
// Check 1 — json-schema-dialect
// ---------------------------------------------------------------------------

test('probe flags draft-07 tool schemas (explicit high + inferred medium), skips modern/edge tools', async () => {
  const res = await runProbeJson([draft07]);
  assert.equal(res.status, 0, `WARNs alone must not fail the default gate\n${res.stderr}`);
  assert.equal(res.findings.length, 2, JSON.stringify(res.findings, null, 2));
  for (const f of res.findings) {
    assert.equal(f.patternId, 'json-schema-dialect');
    assert.equal(f.severity, 'WARN');
    assert.equal(f.after, BRIEF_DIALECT_FIX, 'fix message matches the brief verbatim');
  }
  const explicit = res.findings.find((f) => f.before.includes('lookup_user'));
  assert.ok(explicit, 'explicit $schema draft-07 tool flagged');
  assert.equal(explicit.confidence, 'high');
  assert.ok(explicit.before.includes('draft-07'));
  const inferred = res.findings.find((f) => f.before.includes('legacy_search'));
  assert.ok(inferred, 'keyword-inferred draft-07 tool flagged');
  assert.equal(inferred.confidence, 'medium');
  assert.ok(inferred.before.includes('definitions'));
  // modern 2020-12 tool and the property-literally-named-"definitions" tool stay clean
  assert.ok(!res.findings.some((f) => f.before.includes('modern_find')));
  assert.ok(!res.findings.some((f) => f.before.includes('edge_props')));
});

test('probe --fail-on any exits 1 on WARN-only findings', async () => {
  const res = await runProbe(['--fail-on', 'any', draft07]);
  assert.equal(res.status, 1);
});

test('probe --fail-on none always exits 0', async () => {
  const res = await runProbe(['--fail-on', 'none', '--spec-version', '2026-07-28', requiresInit]);
  assert.equal(res.status, 0);
});

// ---------------------------------------------------------------------------
// Check 2 — requires-initialize-handshake (--spec-version 2026-07-28)
// ---------------------------------------------------------------------------

test('probe --spec-version 2026-07-28 flags a server that requires initialize (ERROR, exit 1)', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', requiresInit]);
  assert.equal(res.status, 1, `ERROR must fail the default gate\n${res.stderr}`);
  // a 2025-era server misses the handshake removal AND the required
  // server/discover RPC — the probe reports the complete migration picture
  assert.equal(res.findings.length, 2, JSON.stringify(res.findings, null, 2));
  const f = res.findings.find((x) => x.patternId === 'requires-initialize-handshake');
  assert.ok(f, 'requires-initialize-handshake finding present');
  assert.equal(f.severity, 'ERROR');
  assert.equal(f.confidence, 'high');
  assert.equal(f.after, BRIEF_HANDSHAKE_FIX, 'fix message matches the brief verbatim');
  assert.ok(f.before.includes('rejected'), 'evidence records the stateless rejection');
  const d = res.findings.find((x) => x.patternId === 'missing-server-discover');
  assert.ok(d, 'missing-server-discover finding present');
  assert.equal(d.severity, 'ERROR');
});

test('the same server is CLEAN under the default 2025-11-25 spec (handshake is still legal there)', async () => {
  const res = await runProbeJson([requiresInit]);
  assert.equal(res.status, 0);
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings, null, 2));
});

test('a correctly migrated 2026-07-28 server passes ALL checks (stateless, discover, error code)', async () => {
  const res = await runProbe(['--spec-version', '2026-07-28', stateless]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(
    res.stdout.includes('server/discover: capabilities advertised'),
    `discover check ran and passed:\n${res.stdout}`,
  );
  assert.ok(
    res.stdout.includes('resource error code: -32602'),
    `error-code check ran and passed:\n${res.stdout}`,
  );
  assert.ok(/no runtime violations/.test(res.stdout), res.stdout);
});

test('the same migrated server emits zero findings as JSON', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', stateless]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings, null, 2));
});

test('a stateless-only server under the 2025-11-25 spec is an operational error (exit 2), not a violation', async () => {
  const res = await runProbe([stateless]);
  assert.equal(res.status, 2);
  assert.ok(/initialize/.test(res.stderr), `stderr explains the failed handshake: ${res.stderr}`);
});

test('an unreachable target is an operational error (exit 2)', async () => {
  const res = await runProbe(['http://127.0.0.1:9', '--timeout', '2000']);
  assert.equal(res.status, 2);
});

// ---------------------------------------------------------------------------
// Streamable HTTP transport
// ---------------------------------------------------------------------------

test('HTTP probe catches all violation categories on a legacy sessionful server', async () => {
  const srv = await startHttpFixture('requires-init');
  try {
    const res = await runProbeJson(['--spec-version', '2026-07-28', srv.url]);
    assert.equal(res.status, 1, res.stderr);
    const ids = res.findings.map((f) => f.patternId).sort();
    assert.deepEqual(ids, [
      'json-schema-dialect',
      'missing-server-discover',
      'requires-initialize-handshake',
    ]);
  } finally {
    srv.kill();
  }
});

test('HTTP probe of a stateless 2026-07-28 server is clean', async () => {
  const srv = await startHttpFixture('stateless');
  try {
    const res = await runProbeJson(['--spec-version', '2026-07-28', srv.url]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.findings.length, 0, JSON.stringify(res.findings, null, 2));
  } finally {
    srv.kill();
  }
});

// ---------------------------------------------------------------------------
// Report formats (JSON + SARIF carry the new categories)
// ---------------------------------------------------------------------------

test('probe --sarif emits SARIF 2.1.0 with both runtime rules and correct levels', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-probe-'));
  const sarifPath = join(out, 'probe.sarif');
  try {
    const res = await runProbe([
      '--spec-version',
      '2026-07-28',
      '--sarif',
      sarifPath,
      '--quiet',
      draft07,
    ]);
    // draft07 fixture answers stateless requests, so only dialect WARNs fire
    assert.equal(res.status, 0, res.stderr);
    const sarif = JSON.parse(readFileSync(sarifPath, 'utf8'));
    assert.equal(sarif.version, '2.1.0');
    const run = sarif.runs[0];
    const ruleIds = run.tool.driver.rules.map((r) => r.id);
    assert.ok(ruleIds.includes('json-schema-dialect'), 'runtime rule joins driver metadata');
    const results = run.results;
    assert.ok(results.length >= 2);
    for (const r of results) {
      assert.equal(r.ruleId, 'json-schema-dialect');
      assert.equal(r.level, 'warning', 'WARN maps to SARIF warning');
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('probe --sarif on a handshake violation maps ERROR to SARIF error level', async () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-probe-'));
  const sarifPath = join(out, 'probe.sarif');
  try {
    const res = await runProbe([
      '--spec-version',
      '2026-07-28',
      '--sarif',
      sarifPath,
      '--quiet',
      requiresInit,
    ]);
    assert.equal(res.status, 1);
    const sarif = JSON.parse(readFileSync(sarifPath, 'utf8'));
    const results = sarif.runs[0].results;
    const ids = results.map((r) => r.ruleId).sort();
    assert.deepEqual(ids, ['missing-server-discover', 'requires-initialize-handshake']);
    for (const r of results) {
      assert.equal(r.level, 'error', 'ERROR maps to SARIF error');
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('probe --json emits machine-readable findings with the documented shape', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', requiresInit]);
  const f = res.findings[0];
  for (const key of ['file', 'line', 'patternId', 'severity', 'confidence', 'explanation', 'docUrl', 'before', 'after']) {
    assert.ok(key in f, `finding has ${key}`);
  }
  assert.ok(f.file.includes('server-requires-init.mjs'), 'file records the probed target');
});

// ---------------------------------------------------------------------------
// Checks 3 & 4 — missing-server-discover and legacy-resource-error-code
// (each server-partial.mjs mode has exactly ONE migration defect)
// ---------------------------------------------------------------------------

test('a server still returning -32002 for a missing resource is flagged (legacy-resource-error-code)', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', partial, 'legacy-error-code']);
  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.findings.length, 1, JSON.stringify(res.findings, null, 2));
  const f = res.findings[0];
  assert.equal(f.patternId, 'legacy-resource-error-code');
  assert.equal(f.severity, 'ERROR');
  assert.equal(f.confidence, 'high');
  assert.ok(f.before.includes('-32002'), 'evidence records the legacy code');
});

test('a server without server/discover is flagged (missing-server-discover)', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', partial, 'no-discover']);
  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.findings.length, 1, JSON.stringify(res.findings, null, 2));
  const f = res.findings[0];
  assert.equal(f.patternId, 'missing-server-discover');
  assert.equal(f.severity, 'ERROR');
  assert.ok(f.before.includes('rejected'), 'evidence records the -32601 rejection');
});

test('a server/discover result WITHOUT a capabilities key is flagged too', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', partial, 'bad-discover']);
  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.findings.length, 1, JSON.stringify(res.findings, null, 2));
  const f = res.findings[0];
  assert.equal(f.patternId, 'missing-server-discover');
  assert.ok(f.before.includes('capabilities'), 'evidence names the missing key');
});

test('the new checks are GATED behind --spec-version 2026-07-28 (default probe stays clean)', async () => {
  // Same defective server, default 2025-11-25 spec: existing behavior unchanged.
  const res = await runProbeJson([partial, 'legacy-error-code']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings, null, 2));
});

// ---------------------------------------------------------------------------
// `run` alias
// ---------------------------------------------------------------------------

test('`mcp-vet run` is an alias for probe (migrated server passes, exit 0)', async () => {
  const res = await runCli('run', ['--json', '--spec-version', '2026-07-28', stateless]);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), []);
});

test('`mcp-vet run` flags a legacy server under 2026-07-28 (exit 1)', async () => {
  const res = await runCli('run', ['--spec-version', '2026-07-28', requiresInit]);
  assert.equal(res.status, 1, res.stderr);
  assert.ok(res.stdout.includes('requires-initialize-handshake'), res.stdout);
});

// ---------------------------------------------------------------------------
// CLI guardrails
// ---------------------------------------------------------------------------

test('invalid --spec-version is an operational error (exit 2) naming the valid values', async () => {
  const res = await runProbe(['--spec-version', '2024-01-01', draft07]);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('2025-11-25') && res.stderr.includes('2026-07-28'));
});

test('invalid --timeout is an operational error (exit 2)', async () => {
  const res = await runProbe(['--timeout', 'soon', draft07]);
  assert.equal(res.status, 2);
});

// ---------------------------------------------------------------------------
// `--spec 2026-07-28` compliance suite (checks 1-6, added on top of the above)
// ---------------------------------------------------------------------------

test('--spec runs the compliance suite IN ADDITION to the existing checks (migrated server stays clean)', async () => {
  const res = await runProbeJson([...SPEC, stateless]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings, null, 2));
});

test('--spec: the passing/skip notes for all six checks are surfaced on a clean stateless server', async () => {
  const res = await runProbe([...SPEC, stateless]);
  assert.equal(res.status, 0, res.stderr);
  for (const note of [
    'stateless-no-session: passed',
    'stateless-no-init: passed',
    'required-headers: skipped', // stdio has no request headers
    'deprecated-roots: clean',
    'deprecated-sampling: clean',
    'deprecated-logging: clean',
  ]) {
    assert.ok(res.stdout.includes(note), `missing note "${note}":\n${res.stdout}`);
  }
});

test('stateless-no-session: a server that requires a session is flagged (ERROR, exit 1)', async () => {
  const res = await runProbeJson([...SPEC, sessionful]);
  assert.equal(res.status, 1, res.stderr);
  const f = res.findings.find((x) => x.patternId === 'stateless-no-session');
  assert.ok(f, `stateless-no-session present:\n${JSON.stringify(res.findings, null, 2)}`);
  assert.equal(f.severity, 'ERROR');
  assert.ok(/session/i.test(f.before), 'evidence records the session rejection');
});

test('stateless-no-init: a server requiring the handshake is flagged, WITHOUT a false stateless-no-session', async () => {
  const res = await runProbeJson([...SPEC, requiresInit]);
  assert.equal(res.status, 1, res.stderr);
  const ids = res.findings.map((f) => f.patternId);
  assert.ok(ids.includes('stateless-no-init'), `stateless-no-init present:\n${JSON.stringify(res.findings, null, 2)}`);
  // "Server not initialized" is not a session error — no-session must not fire.
  assert.ok(!ids.includes('stateless-no-session'), 'no-session must not false-positive on a non-session rejection');
});

test('deprecated-sampling/roots/logging: a migrated-but-deprecated server yields exactly three WARNs (exit 0)', async () => {
  const res = await runProbeJson([...SPEC, deprecated]);
  assert.equal(res.status, 0, `WARN-only must not fail the default gate\n${res.stderr}`);
  const ids = res.findings.map((f) => f.patternId).sort();
  assert.deepEqual(ids, ['deprecated-logging', 'deprecated-roots', 'deprecated-sampling']);
  for (const f of res.findings) assert.equal(f.severity, 'WARN');
  const sampling = res.findings.find((f) => f.patternId === 'deprecated-sampling');
  assert.ok(/July 2027/.test(sampling.after), 'sampling fix names the removal date');
});

test('--spec --fail-on any exits 1 on the WARN-only deprecated findings', async () => {
  const res = await runProbe([...SPEC, '--fail-on', 'any', deprecated]);
  assert.equal(res.status, 1, res.stderr);
});

test('the compliance suite is GATED behind --spec (plain --spec-version 2026-07-28 does not run it)', async () => {
  const res = await runProbeJson(['--spec-version', '2026-07-28', '--timeout', '1200', sessionful]);
  assert.equal(res.status, 1, res.stderr);
  const ids = res.findings.map((f) => f.patternId);
  // existing checks still fire...
  assert.ok(ids.includes('requires-initialize-handshake'));
  // ...but none of the new compliance-suite checks do
  for (const id of ['stateless-no-session', 'stateless-no-init', 'required-headers']) {
    assert.ok(!ids.includes(id), `${id} must not run without --spec`);
  }
});

test('required-headers: an HTTP server that accepts Mcp-Method/Mcp-Name passes (note surfaced)', async () => {
  const srv = await startHttpFixture('stateless');
  try {
    const res = await runProbe([...SPEC, srv.url]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(
      res.stdout.includes('required-headers: passed'),
      `required-headers ran and passed on HTTP:\n${res.stdout}`,
    );
  } finally {
    srv.kill();
  }
});

test('invalid --spec is an operational error (exit 2) naming the valid values', async () => {
  const res = await runProbe(['--spec', '2099-01-01', stateless]);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('--spec') && res.stderr.includes('2026-07-28'));
});

// ---------------------------------------------------------------------------
// analyzeSchemaDialect unit coverage (the walker's precision guarantees)
// ---------------------------------------------------------------------------

test('analyzeSchemaDialect: explicit old drafts and 2019-09 are flagged; 2020-12 and unknown dialects are trusted', () => {
  for (const [url, dialect] of [
    ['http://json-schema.org/draft-04/schema#', 'draft-04'],
    ['http://json-schema.org/draft-06/schema#', 'draft-06'],
    ['http://json-schema.org/draft-07/schema#', 'draft-07'],
    ['https://json-schema.org/draft-07/schema', 'draft-07'],
    ['https://json-schema.org/draft/2019-09/schema', 'draft 2019-09'],
  ]) {
    const issue = analyzeSchemaDialect({ $schema: url, type: 'object' });
    assert.ok(issue && issue.kind === 'explicit', url);
    assert.equal(issue.dialect, dialect);
  }
  assert.equal(
    analyzeSchemaDialect({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }),
    null,
  );
  // a declared 2020-12 dialect is trusted even when old keywords linger
  assert.equal(
    analyzeSchemaDialect({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      definitions: { X: { type: 'string' } },
    }),
    null,
  );
  assert.equal(analyzeSchemaDialect({ $schema: 'https://example.com/custom', type: 'object' }), null);
});

test('analyzeSchemaDialect: draft-07 keywords are inferred, including inside applicators', () => {
  const nested = analyzeSchemaDialect({
    type: 'object',
    allOf: [{ definitions: { X: { type: 'string' } } }],
  });
  assert.ok(nested && nested.kind === 'inferred');
  assert.ok(nested.keywords.some((k) => k.startsWith('definitions')));

  const boolExcl = analyzeSchemaDialect({
    type: 'object',
    properties: { n: { type: 'number', minimum: 0, exclusiveMinimum: true } },
  });
  assert.ok(boolExcl && boolExcl.keywords.some((k) => k.includes('exclusiveMinimum')));

  const arrayItems = analyzeSchemaDialect({
    type: 'object',
    properties: { t: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] } },
  });
  assert.ok(arrayItems && arrayItems.keywords.some((k) => k.startsWith('array-form items')));

  const refDefs = analyzeSchemaDialect({
    type: 'object',
    properties: { u: { $ref: '#/definitions/User' } },
  });
  assert.ok(refDefs && refDefs.keywords.some((k) => k.includes('#/definitions/')));
});

test('analyzeSchemaDialect: a *property* named "definitions" or modern schemas produce no issue', () => {
  assert.equal(
    analyzeSchemaDialect({
      type: 'object',
      properties: { definitions: { type: 'object' }, dependencies: { type: 'array' } },
    }),
    null,
  );
  assert.equal(
    analyzeSchemaDialect({
      type: 'object',
      properties: { limit: { $ref: '#/$defs/Limit' } },
      $defs: { Limit: { type: 'integer', exclusiveMinimum: 0 } },
    }),
    null,
  );
  assert.equal(analyzeSchemaDialect(undefined), null);
  assert.equal(analyzeSchemaDialect('not-an-object'), null);
});

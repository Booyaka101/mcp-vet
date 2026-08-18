import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const plugins = join(repoRoot, 'test', 'fixtures', 'plugins');

const { vetPlugin } = require('../dist/inputs/plugin.js');
const { PLUGIN_RULES } = require('../dist/rules.js');
const { ALL_PLUGIN_RULE_IDS } = require('../dist/types.js');

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

function runPlugin(dir, extraArgs = []) {
  const res = spawnSync('node', [cli, 'plugin', dir, '--json', '--no-color', ...extraArgs], {
    encoding: 'utf8',
  });
  let findings = [];
  try {
    findings = JSON.parse(res.stdout);
  } catch {
    /* exit-2 runs print no JSON */
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, findings };
}

/** id/severity pairs, sorted, for exact-match assertions */
function idsOf(findings) {
  return findings.map((f) => `${f.patternId}/${f.severity}`).sort();
}

function tempPlugin(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-plugin-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

const validManifest = { $schema: PLUGIN_SCHEMA, name: 'temp-plugin' };

// ---------------------------------------------------------------------------
// The brief's fixture matrix — exact rule ids, severities, and exit codes.
// ---------------------------------------------------------------------------

test('clean plugin: exit 0, zero findings (reverse-domain dir ignored)', () => {
  const res = runPlugin(join(plugins, 'clean'));
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), []);
});

test('sse-transport (https url): exactly one DEPRECATED finding, exit 0', () => {
  const res = runPlugin(join(plugins, 'sse-transport'));
  assert.equal(res.status, 0, 'DEPRECATED alone must not fail the build');
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_SSE_TRANSPORT/DEPRECATED']);
  const f = res.findings[0];
  assert.match(f.explanation, /SSE_TRANSPORT_DEPRECATED/, 'names the source-side rule');
  assert.match(f.explanation, /2026-07-28/, 'names the spec revision');
});

test('cwd-escape: PLUGIN_CWD_ESCAPE BREAKING, exit 1', () => {
  const res = runPlugin(join(plugins, 'cwd-escape'));
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_CWD_ESCAPE/BREAKING']);
});

test('reserved-env: PLUGIN_ENV_RESERVED BREAKING, exit 1', () => {
  const res = runPlugin(join(plugins, 'reserved-env'));
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_ENV_RESERVED/BREAKING']);
});

test('multi-token-command: PLUGIN_CMD_NOT_SINGLE_TOKEN BREAKING, exit 1', () => {
  const res = runPlugin(join(plugins, 'multi-token-command'));
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_CMD_NOT_SINGLE_TOKEN/BREAKING']);
});

test('insecure-url: PLUGIN_REMOTE_INSECURE_URL BREAKING, exit 1', () => {
  const res = runPlugin(join(plugins, 'insecure-url'));
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_REMOTE_INSECURE_URL/BREAKING']);
});

test('loopback-http: localhost, 127.0.0.1 and [::1] over http are all clean, exit 0', () => {
  const res = runPlugin(join(plugins, 'loopback-http'));
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), []);
});

test('nested-skill: PLUGIN_SKILL_LAYOUT DEPRECATED on the deep SKILL.md only, exit 0', () => {
  const res = runPlugin(join(plugins, 'nested-skill'));
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_SKILL_LAYOUT/DEPRECATED']);
  assert.equal(res.findings[0].file, 'skills/group/deploy/SKILL.md');
});

test('empty-mcpservers: legally empty, exit 0, zero findings', () => {
  const res = runPlugin(join(plugins, 'empty-mcpservers'));
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), []);
});

test('no-mcp-json: absent mcp.json is valid and silent, exit 0', () => {
  const res = runPlugin(join(plugins, 'no-mcp-json'));
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), []);
});

// ---------------------------------------------------------------------------
// The README worked example, locked end to end.
// ---------------------------------------------------------------------------

test('WORKED EXAMPLE: 3 BREAKING + 1 DEPRECATED with the exact ids, exit 1', () => {
  const res = runPlugin(join(plugins, 'worked-example'));
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), [
    'PLUGIN_CMD_NOT_SINGLE_TOKEN/BREAKING',
    'PLUGIN_CWD_ESCAPE/BREAKING',
    'PLUGIN_REMOTE_INSECURE_URL/BREAKING',
    'PLUGIN_SSE_TRANSPORT/DEPRECATED',
  ]);
  for (const f of res.findings) {
    assert.equal(f.file, 'mcp.json');
    assert.ok(f.line > 1, 'anchored to a real line in mcp.json');
    assert.equal(f.confidence, 'high');
    assert.ok(f.explanation && f.before && f.after && f.docUrl, 'rich fields present');
  }
});

// ---------------------------------------------------------------------------
// Depth: bundled server source gets the existing 22 rules, verbatim.
// ---------------------------------------------------------------------------

test('bundled ./server.js is scanned with the source rules and fails the build', () => {
  const res = runPlugin(join(plugins, 'bundled-server'));
  assert.equal(res.status, 1);
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('MCP_SESSION_ID'), 'session-header pattern found in bundled source');
  assert.ok(ids.has('ERROR_CODE_32002'), 'legacy error code found in bundled source');
  for (const f of res.findings) {
    assert.equal(f.file, 'server.js', 'reported plugin-relative');
  }
});

test('bare launcher token is reported unscannable-by-design, never silently skipped', () => {
  const res = runPlugin(join(plugins, 'bare-token'));
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), []);
  assert.match(res.stderr, /unscannable by design/, 'reason printed even in --json mode');
  assert.match(res.stderr, /"npx"/, 'names the bare token');
});

test('remote servers are noted as not-scannable with a probe pointer', () => {
  const res = runPlugin(join(plugins, 'clean'));
  assert.match(res.stderr, /mcp-vet probe https:\/\/example\.com\/mcp/);
});

// ---------------------------------------------------------------------------
// Manifest schema failures (the root schema is closed).
// ---------------------------------------------------------------------------

test('unknown top-level field in plugin.json fails PLUGIN_MANIFEST_INVALID, exit 1', () => {
  const res = runPlugin(join(plugins, 'manifest-invalid'));
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_MANIFEST_INVALID/BREAKING']);
  assert.match(res.findings[0].explanation, /unknown field "commands"/);
});

test('name containing "--" or ".." fails PLUGIN_MANIFEST_INVALID', () => {
  for (const bad of ['my--plugin', 'my..plugin', 'My-Plugin', '-leading']) {
    const dir = tempPlugin({ 'plugin.json': { $schema: PLUGIN_SCHEMA, name: bad } });
    const res = runPlugin(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(res.status, 1, `${bad} must fail`);
    assert.deepEqual(idsOf(res.findings), ['PLUGIN_MANIFEST_INVALID/BREAKING'], bad);
  }
});

test('missing plugin.json and malformed plugin.json both fail PLUGIN_MANIFEST_INVALID', () => {
  const missing = tempPlugin({ 'mcp.json': { $schema: MCP_SCHEMA, mcpServers: {} } });
  const resMissing = runPlugin(missing);
  rmSync(missing, { recursive: true, force: true });
  assert.equal(resMissing.status, 1);
  assert.deepEqual(idsOf(resMissing.findings), ['PLUGIN_MANIFEST_INVALID/BREAKING']);

  const malformed = tempPlugin({ 'plugin.json': '{ not json' });
  const resMalformed = runPlugin(malformed);
  rmSync(malformed, { recursive: true, force: true });
  assert.equal(resMalformed.status, 1);
  assert.deepEqual(idsOf(resMalformed.findings), ['PLUGIN_MANIFEST_INVALID/BREAKING']);
});

test('missing $schema in plugin.json fails (it is required)', () => {
  const dir = tempPlugin({ 'plugin.json': { name: 'no-schema-plugin' } });
  const res = runPlugin(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_MANIFEST_INVALID/BREAKING']);
});

// ---------------------------------------------------------------------------
// mcp.json schema failures.
// ---------------------------------------------------------------------------

test('unknown server type / unknown fields / missing $schema fail PLUGIN_MCP_INVALID', () => {
  const cases = [
    // unknown type value
    { $schema: MCP_SCHEMA, mcpServers: { s: { type: 'websocket', url: 'https://x.example/mcp' } } },
    // field from another variant on stdio
    { $schema: MCP_SCHEMA, mcpServers: { s: { type: 'stdio', command: 'npx', url: 'https://x.example/mcp' } } },
    // missing required $schema
    { mcpServers: {} },
    // unknown top-level field (root is closed)
    { $schema: MCP_SCHEMA, mcpServers: {}, servers: {} },
  ];
  for (const [i, mcp] of cases.entries()) {
    const dir = tempPlugin({ 'plugin.json': validManifest, 'mcp.json': mcp });
    const res = runPlugin(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(res.status, 1, `case ${i}`);
    assert.ok(
      res.findings.some((f) => f.patternId === 'PLUGIN_MCP_INVALID' && f.severity === 'BREAKING'),
      `case ${i}: ${JSON.stringify(idsOf(res.findings))}`,
    );
  }
});

test('url with user information or a fragment fails PLUGIN_REMOTE_INSECURE_URL even over https', () => {
  for (const url of [
    'https://user:pass@example.com/mcp',
    'https://example.com/mcp#frag',
    'relative/path',
    'ftp://example.com/mcp',
  ]) {
    const dir = tempPlugin({
      'plugin.json': validManifest,
      'mcp.json': { $schema: MCP_SCHEMA, mcpServers: { r: { type: 'streamable-http', url } } },
    });
    const res = runPlugin(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(res.status, 1, url);
    assert.deepEqual(idsOf(res.findings), ['PLUGIN_REMOTE_INSECURE_URL/BREAKING'], url);
  }
});

test('http to a non-exact localhost host (subdomain, 128.x) is NOT loopback', () => {
  for (const url of ['http://foo.localhost/mcp', 'http://128.0.0.1/mcp']) {
    const dir = tempPlugin({
      'plugin.json': validManifest,
      'mcp.json': { $schema: MCP_SCHEMA, mcpServers: { r: { type: 'streamable-http', url } } },
    });
    const res = runPlugin(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(idsOf(res.findings), ['PLUGIN_REMOTE_INSECURE_URL/BREAKING'], url);
  }
});

test('cwd "./../shared" passes the prefix pattern but escapes the root — still PLUGIN_CWD_ESCAPE', () => {
  const dir = tempPlugin({
    'plugin.json': validManifest,
    'mcp.json': {
      $schema: MCP_SCHEMA,
      mcpServers: { s: { type: 'stdio', command: 'npx', cwd: './../shared' } },
    },
  });
  const res = runPlugin(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 1);
  assert.deepEqual(idsOf(res.findings), ['PLUGIN_CWD_ESCAPE/BREAKING']);
});

test('${PLUGIN_ROOT} and ${PLUGIN_DATA} cwd forms are accepted', () => {
  const dir = tempPlugin({
    'plugin.json': validManifest,
    'mcp.json': {
      $schema: MCP_SCHEMA,
      mcpServers: {
        a: { type: 'stdio', command: 'npx', cwd: '${PLUGIN_ROOT}' },
        b: { type: 'stdio', command: 'npx', cwd: '${PLUGIN_ROOT}/sub' },
        c: { type: 'stdio', command: 'npx', cwd: '${PLUGIN_DATA}/cache' },
        d: { type: 'stdio', command: 'npx', cwd: './' },
      },
    },
  });
  const res = runPlugin(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 0);
  assert.deepEqual(idsOf(res.findings), []);
});

test('absolute and ../ commands are not single ./-relative tokens', () => {
  for (const command of ['../bin/tool', '/usr/bin/node', 'C:\\tools\\node.exe']) {
    const dir = tempPlugin({
      'plugin.json': validManifest,
      'mcp.json': { $schema: MCP_SCHEMA, mcpServers: { s: { type: 'stdio', command } } },
    });
    const res = runPlugin(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(idsOf(res.findings), ['PLUGIN_CMD_NOT_SINGLE_TOKEN/BREAKING'], command);
  }
});

// ---------------------------------------------------------------------------
// CLI contract: exit 2 on unusable input, SARIF sharing, severity lock.
// ---------------------------------------------------------------------------

test('nonexistent or non-directory target exits 2 with a clear message', () => {
  const missing = runPlugin(join(plugins, 'does-not-exist'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /does not exist/);

  const file = runPlugin(join(plugins, 'clean', 'plugin.json'));
  assert.equal(file.status, 2);
  assert.match(file.stderr, /not a directory/);
});

test('--sarif carries the fired PLUGIN_ rules', () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-sarif-'));
  const sarifPath = join(out, 'plugin.sarif');
  const res = runPlugin(join(plugins, 'worked-example'), ['--sarif', sarifPath]);
  assert.equal(res.status, 1);
  const sarif = JSON.parse(readFileSync(sarifPath, 'utf8'));
  rmSync(out, { recursive: true, force: true });
  const ruleIds = new Set(sarif.runs[0].tool.driver.rules.map((r) => r.id));
  for (const id of ['PLUGIN_SSE_TRANSPORT', 'PLUGIN_CWD_ESCAPE', 'PLUGIN_CMD_NOT_SINGLE_TOKEN', 'PLUGIN_REMOTE_INSECURE_URL']) {
    assert.ok(ruleIds.has(id), id);
  }
  assert.equal(sarif.runs[0].results.length, 4);
});

test('SEVERITY LOCK: 6 plugin rules are BREAKING, 2 are DEPRECATED', () => {
  assert.equal(ALL_PLUGIN_RULE_IDS.length, 8);
  const bySev = (sev) => ALL_PLUGIN_RULE_IDS.filter((id) => PLUGIN_RULES[id].severity === sev);
  assert.deepEqual(bySev('BREAKING').sort(), [
    'PLUGIN_CMD_NOT_SINGLE_TOKEN',
    'PLUGIN_CWD_ESCAPE',
    'PLUGIN_ENV_RESERVED',
    'PLUGIN_MANIFEST_INVALID',
    'PLUGIN_MCP_INVALID',
    'PLUGIN_REMOTE_INSECURE_URL',
  ]);
  assert.deepEqual(bySev('DEPRECATED').sort(), ['PLUGIN_SKILL_LAYOUT', 'PLUGIN_SSE_TRANSPORT']);
});

test('programmatic API: vetPlugin returns servers, skills, and notes', () => {
  const res = vetPlugin(join(plugins, 'clean'));
  assert.equal(res.pluginName, 'clean-plugin');
  assert.equal(res.hasMcpJson, true);
  assert.equal(res.servers.length, 1);
  assert.equal(res.skillCount, 1);
  assert.equal(res.findings.length, 0);

  const bundled = vetPlugin(join(plugins, 'bundled-server'));
  assert.equal(bundled.servers[0].scanned, true);
  assert.deepEqual(bundled.servers[0].scannedFiles, ['server.js']);
  assert.equal(bundled.sourceFilesScanned, 1);
});

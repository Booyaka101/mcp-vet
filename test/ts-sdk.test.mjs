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
const tsFixtures = join(repoRoot, 'test', 'ts-sdk-fixtures');

const { detectTsSdk, npmRangeFloor, clearSdkDetectionCache } = require('../dist/sdk-detect.js');
const { ALL_TS_SDK_RULE_IDS } = require('../dist/types.js');
const { TS_SDK_RULES } = require('../dist/rules.js');

function runCli(args, env = {}) {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-tssdk-'));
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

const show = (findings) =>
  JSON.stringify(findings.map((f) => `${f.file}:${f.line}:${f.patternId}`));

/** A throwaway project directory with the given files, cleaned up by the caller. */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-tsproj-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  clearSdkDetectionCache();
  return dir;
}

// ---------------------------------------------------------------------------
// sdk-detect: npm range floors and manifest resolution
// ---------------------------------------------------------------------------

test('npmRangeFloor reads the lowest version an npm range admits', () => {
  assert.deepEqual(npmRangeFloor('^1.19.0'), [1, 19, 0]);
  assert.deepEqual(npmRangeFloor('~1.2'), [1, 2, 0]);
  assert.deepEqual(npmRangeFloor('1.30.0'), [1, 30, 0]);
  assert.deepEqual(npmRangeFloor('>=1.0.0 <2.0.0'), [1, 0, 0]);
  assert.deepEqual(npmRangeFloor('^3.25 || ^4.0'), [3, 25, 0], 'the lowest alternative wins');
  assert.deepEqual(npmRangeFloor('^4.2.0'), [4, 2, 0]);
  assert.deepEqual(npmRangeFloor('3.0.0 - 4.1.0'), [3, 0, 0]);
  assert.deepEqual(npmRangeFloor('1.x'), [1, 0, 0]);
  assert.deepEqual(npmRangeFloor('<2.0.0'), [0, 0, 0], 'an upper bound alone has no floor');
  // Specifiers that name no version at all stay unknown rather than guessing.
  for (const r of ['*', 'latest', 'workspace:*', 'file:../sdk', 'npm:zod@4.1.0', '']) {
    assert.equal(npmRangeFloor(r), null, r);
  }
});

test('detectTsSdk classifies the declared package family', () => {
  clearSdkDetectionCache();
  const v2 = detectTsSdk(join(tsFixtures, 'v2-server'));
  assert.equal(v2.major, 'v2');
  assert.equal(v2.source, 'package.json');
  assert.equal(v2.zodBelowFloor, true, 'zod ^3.25 || ^4.0 dips below the 4.2.0 floor');

  const v1 = detectTsSdk(join(tsFixtures, 'v1-server'));
  assert.equal(v1.major, 'v1');
  assert.equal(v1.specifier, '@modelcontextprotocol/sdk@^1.19.0');

  const half = detectTsSdk(join(tsFixtures, 'half-migrated'));
  assert.equal(half.major, 'half');
  assert.match(half.specifier, /@modelcontextprotocol\/sdk@\^1\.19\.0 \+ @modelcontextprotocol\/server@\^2\.0\.0/);
  assert.equal(half.zodBelowFloor, false, 'zod ^4.2.0 is at the floor');

  // No manifest anywhere up the tree → undetermined, never a guess.
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-tsnone-'));
  clearSdkDetectionCache();
  const none = detectTsSdk(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(none.major, 'undetermined');
});

test('all three lockfile formats resolve the family when package.json is silent', () => {
  const pkg = '{"name":"x","version":"1.0.0","dependencies":{"zod":"^4.2.0"}}';

  clearSdkDetectionCache();
  assert.equal(detectTsSdk(join(tsFixtures, 'pnpm-project')).major, 'v2', 'pnpm-lock.yaml');

  const npmDir = project({
    'package.json': pkg,
    'package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/@modelcontextprotocol/sdk': { version: '1.30.0' } },
    }),
  });
  const npmRes = detectTsSdk(npmDir);
  rmSync(npmDir, { recursive: true, force: true });
  assert.equal(npmRes.major, 'v1');
  assert.equal(npmRes.specifier, '1.30.0 (locked)');
  assert.equal(npmRes.source, 'package-lock.json');

  const yarnDir = project({
    'package.json': pkg,
    'yarn.lock': [
      '"@modelcontextprotocol/client@^2.0.0":',
      '  version "2.0.0"',
      '  resolved "https://registry.yarnpkg.com/@modelcontextprotocol/client/-/client-2.0.0.tgz"',
      '',
    ].join('\n'),
  });
  const yarnRes = detectTsSdk(yarnDir);
  rmSync(yarnDir, { recursive: true, force: true });
  assert.equal(yarnRes.major, 'v2');
  assert.equal(yarnRes.source, 'yarn.lock');
});

test('the manifest walk stops at the repository boundary', () => {
  // An unrelated parent package.json (a home directory, a monorepo sibling)
  // must never decide the gate — 'undetermined' is the honest answer instead.
  const root = mkdtempSync(join(tmpdir(), 'mcp-vet-tsboundary-'));
  writeFileSync(
    join(root, 'package.json'),
    '{"dependencies":{"@modelcontextprotocol/sdk":"^1.19.0"}}',
    'utf8',
  );
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  clearSdkDetectionCache();
  const inner = detectTsSdk(join(repo, 'src'));
  rmSync(root, { recursive: true, force: true });
  assert.equal(inner.major, 'undetermined', "the parent's v1 pin must not leak in");
});

// ---------------------------------------------------------------------------
// WORKED EXAMPLE: v1 imports in a project declaring @modelcontextprotocol/server ^2
// ---------------------------------------------------------------------------

test('WORKED EXAMPLE: McpError/ErrorCode from types.js = MONOLITH + MCPERROR, exit 0', () => {
  const res = runCli([join(tsFixtures, 'v2-server', 'server.ts')]);
  assert.equal(res.status, 0, `advisory tier never fails the build\n${res.stderr}`);
  const ids = res.findings.map((f) => f.patternId).sort();
  assert.deepEqual(ids, ['TS_SDK_V1_MCPERROR', 'TS_SDK_V1_MONOLITH'], show(res.findings));
  for (const f of res.findings) {
    assert.equal(f.line, 4, 'both anchored on the import line');
    assert.equal(f.severity, 'DEPRECATED');
    assert.equal(
      f.docUrl,
      'https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html',
      'the versioned permalink, not /draft/',
    );
    assert.ok(!/undetermined/.test(f.explanation), 'v2 is resolved, no annotation');
  }
  const monolith = res.findings.find((f) => f.patternId === 'TS_SDK_V1_MONOLITH');
  assert.match(monolith.explanation, /types\.js schemas moved to @modelcontextprotocol\/core/);
  const mcpError = res.findings.find((f) => f.patternId === 'TS_SDK_V1_MCPERROR');
  assert.match(mcpError.explanation, /McpError → ProtocolError; ErrorCode → ProtocolErrorCode/);

  const shown = spawnSync(
    'node',
    [cli, join(tsFixtures, 'v2-server', 'server.ts'), '--no-files', '--no-color'],
    { encoding: 'utf8' },
  );
  assert.match(shown.stdout, /22 spec rules, 0 breaking; 13 TypeScript SDK rules, 2 advisory/);
});

test('all 13 TS_SDK_V1 rules fire on the kitchen sink, all DEPRECATED, exit 0', () => {
  const res = runCli([join(tsFixtures, 'v2-server', 'kitchen-sink.ts')]);
  assert.equal(res.status, 0);
  const ids = new Set(res.findings.map((f) => f.patternId));
  for (const id of ALL_TS_SDK_RULE_IDS) {
    assert.ok(ids.has(id), `expected ${id} (got: ${[...ids].join(', ')})`);
  }
  for (const f of res.findings) {
    assert.equal(f.severity, 'DEPRECATED', `${f.patternId} stays advisory`);
    assert.ok(f.docUrl && f.before && f.after, 'rich fields present');
  }
});

test('every TS_SDK rule quotes the guide and carries the versioned docUrl', () => {
  for (const id of ALL_TS_SDK_RULE_IDS) {
    const r = TS_SDK_RULES[id];
    assert.equal(r.severity, 'DEPRECATED', `${id} must be advisory`);
    assert.ok(!r.docUrl.includes('/draft/'), `${id} cites a /draft/ URL`);
    assert.match(r.docUrl, /ts\.sdk\.modelcontextprotocol\.io\/v2\//, id);
    // The guide sets no end-of-support date for v1.x, so no message may imply one.
    assert.ok(
      !/end of (life|support)|sunset|will be removed on|EOL/i.test(r.explanation),
      `${id} invents a support deadline`,
    );
  }
});

// ---------------------------------------------------------------------------
// Gating: v1 suppression, half-migrated, undetermined, forced modes, --no-ts-sdk
// ---------------------------------------------------------------------------

test('a project declaring v1 gets zero TS_SDK findings and the informational line', () => {
  const res = spawnSync('node', [cli, join(tsFixtures, 'v1-server'), '--no-files', '--no-color'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.ok(!/TS_SDK_V1/.test(res.stdout), 'group suppressed');
  assert.match(
    res.stderr,
    /declares TypeScript SDK v1 \(@modelcontextprotocol\/sdk@\^1\.19\.0, package\.json\)/,
  );
  assert.match(
    res.stderr,
    /@modelcontextprotocol\/client, @modelcontextprotocol\/server and @modelcontextprotocol\/core 2\.0\.0 shipped 2026-07-27/,
    'names the v2 packages and their npm publish date',
  );
});

test('--ts-sdk v2 forces the group on for a v1-declaring project', () => {
  const res = runCli([join(tsFixtures, 'v1-server'), '--ts-sdk', 'v2']);
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('TS_SDK_V1_MONOLITH'), `got: ${[...ids].join(', ')}`);
  assert.ok(ids.has('TS_SDK_V1_MCPERROR'));
  assert.ok(ids.has('TS_SDK_V1_NODE_HTTP_TRANSPORT'));
  assert.equal(res.status, 0);
});

test('--ts-sdk v1 suppresses the group for a v2-declaring project', () => {
  const res = runCli([join(tsFixtures, 'v2-server', 'server.ts'), '--ts-sdk', 'v1']);
  assert.equal(res.findings.length, 0, show(res.findings));
});

test('no manifest → rules active, findings annotated "(SDK version undetermined)"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-tsundet-'));
  writeFileSync(
    join(dir, 'server.ts'),
    "import { McpError } from '@modelcontextprotocol/sdk/types.js';\nexport const e = McpError;\n",
    'utf8',
  );
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  const f = res.findings.find((x) => x.patternId === 'TS_SDK_V1_MCPERROR');
  assert.ok(f, show(res.findings));
  assert.match(f.explanation, /\(SDK version undetermined\)$/);
});

test('--no-ts-sdk reproduces the pre-0.14.0 output exactly on a TS_SDK-firing input', () => {
  const on = runCli([join(tsFixtures, 'v2-server', 'server.ts')]);
  const off = runCli([join(tsFixtures, 'v2-server', 'server.ts'), '--no-ts-sdk']);
  assert.ok(on.findings.length > 0, 'default emits the group');
  assert.equal(off.findings.length, 0, 'suppressed entirely');
  assert.equal(off.status, 0);
  const shown = spawnSync(
    'node',
    [cli, join(tsFixtures, 'v2-server'), '--no-ts-sdk', '--no-files', '--no-color'],
    { encoding: 'utf8' },
  );
  assert.ok(!/TypeScript SDK rules/.test(shown.stdout), 'no group summary line');
  assert.ok(!/TS_SDK/.test(shown.stdout + shown.stderr));
});

test('--only/--disable accept TS_SDK ids; --only spec-rules-only turns the group off', () => {
  const kitchen = join(tsFixtures, 'v2-server', 'kitchen-sink.ts');
  const only = runCli([kitchen, '--only', 'TS_SDK_V1_MONOLITH']);
  assert.deepEqual([...new Set(only.findings.map((f) => f.patternId))], ['TS_SDK_V1_MONOLITH']);
  const disabled = runCli([kitchen, '--disable', 'TS_SDK_V1_MONOLITH']);
  assert.ok(!disabled.findings.some((f) => f.patternId === 'TS_SDK_V1_MONOLITH'));
  assert.ok(disabled.findings.some((f) => f.patternId === 'TS_SDK_V1_MCPERROR'));
  const specOnly = runCli([kitchen, '--only', 'MCP_SESSION_ID']);
  assert.equal(specOnly.findings.length, 0, 'TS_SDK group off when --only names no TS_SDK rule');
});

test('the tsSdk config key gates the group, and --ts-sdk overrides it', () => {
  const dir = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0"}}',
    'server.ts': "import { McpError } from '@modelcontextprotocol/sdk/types.js';\nexport const e = McpError;\n",
    '.mcpvetrc.json': '{"tsSdk":"off"}',
  });
  const res = spawnSync('node', [cli, 'server.ts', '--no-files', '--quiet', '--json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  const forced = spawnSync('node', [cli, 'server.ts', '--ts-sdk', 'auto', '--no-files', '--quiet', '--json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(JSON.parse(res.stdout).length, 0, 'config off');
  assert.ok(JSON.parse(forced.stdout).length > 0, 'CLI wins over config');
});

test('an invalid --ts-sdk value exits 2 with a usable message', () => {
  const res = runCli([join(tsFixtures, 'v2-server'), '--ts-sdk', 'v3']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /invalid --ts-sdk "v3"/);
  assert.match(res.stderr, /auto, v1, v2/);
});

// ---------------------------------------------------------------------------
// Edge cases from the spec
// ---------------------------------------------------------------------------

test('half-migrated file reports ONLY the v1 import', () => {
  const res = runCli([join(tsFixtures, 'half-migrated')]);
  assert.equal(res.findings.length, 2, show(res.findings));
  for (const f of res.findings) assert.equal(f.line, 5, 'the leftover v1 import line');
  assert.deepEqual(
    res.findings.map((f) => f.patternId).sort(),
    ['TS_SDK_V1_JSONRPC_ERROR', 'TS_SDK_V1_MONOLITH'],
  );
  const shown = spawnSync('node', [cli, join(tsFixtures, 'half-migrated'), '--no-files', '--no-color'], {
    encoding: 'utf8',
  });
  assert.match(shown.stderr, /declares BOTH TypeScript SDK families/);
});

test('TS_SDK_V1_MONOLITH suppresses on the paths SSE_TRANSPORT_DEPRECATED owns', () => {
  const res = runCli([join(tsFixtures, 'v2-server', 'sse-collision.ts')]);
  assert.ok(
    !res.findings.some((f) => f.patternId === 'TS_SDK_V1_MONOLITH'),
    `one import must not produce two findings: ${show(res.findings)}`,
  );
  assert.ok(res.findings.some((f) => f.patternId === 'SSE_TRANSPORT_DEPRECATED'));
  // The client-side twin, and the frozen legacy package, behave the same way.
  const dir = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0"}}',
    'a.ts': [
      "import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';",
      "import { mcpAuthRouter } from '@modelcontextprotocol/server-legacy/auth';",
      'export const x = [SSEClientTransport, mcpAuthRouter];',
    ].join('\n'),
  });
  const other = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(!other.findings.some((f) => f.patternId === 'TS_SDK_V1_MONOLITH'), show(other.findings));
});

test('following TS_SDK_V1_AUTH_MOVED does not trip SSE_TRANSPORT_DEPRECATED', () => {
  // @modelcontextprotocol/server-legacy ships BOTH the frozen v1 SSE transport
  // and the frozen v1 auth module. TS_SDK_V1_AUTH_MOVED points people at
  // /auth, so matching the bare package name told them their fix was a
  // deprecated transport. The SSE rule is scoped to the /sse entry point.
  const dir = project({
    'package.json':
      '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0","@modelcontextprotocol/server-legacy":"^2.0.0"}}',
    'auth.ts': [
      "import { mcpAuthRouter } from '@modelcontextprotocol/server-legacy/auth';",
      'export const router = mcpAuthRouter;',
    ].join('\n'),
  });
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.findings.length, 0, `the migrated form is clean: ${show(res.findings)}`);

  // The transport itself still reports, by path and by symbol.
  const sse = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/server-legacy":"^2.0.0"}}',
    'byPath.ts': "import { SSEServerTransport } from '@modelcontextprotocol/server-legacy/sse';\nexport const t = SSEServerTransport;\n",
    // A root-barrel import is caught by the ungated symbol match instead.
    'bySymbol.ts': "import { SSEServerTransport } from '@modelcontextprotocol/server-legacy';\nexport const t = SSEServerTransport;\n",
  });
  const sseRes = runCli([sse]);
  rmSync(sse, { recursive: true, force: true });
  const files = new Set(
    sseRes.findings.filter((f) => f.patternId === 'SSE_TRANSPORT_DEPRECATED').map((f) => f.file),
  );
  assert.ok(files.has('byPath.ts'), show(sseRes.findings));
  assert.ok(files.has('bySymbol.ts'), show(sseRes.findings));
});

test('a narrow SDK-group suppression does not silently disable the spec rules', () => {
  // The directive parser only recognized the 22 PatternIds, so naming any
  // PY_SDK/TS_SDK/PLUGIN id left it with an empty set, which means "suppress
  // everything on this line". A one-rule advisory suppression was swallowing
  // BREAKING findings and turning exit 1 into exit 0.
  const dir = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0"}}',
    'a.ts': [
      "import { McpError } from '@modelcontextprotocol/sdk/types.js';",
      "const sid = req.headers['mcp-session-id']; const code = -32002; // mcp-vet-disable-line TS_SDK_V1_MCPERROR",
    ].join('\n'),
  });
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('MCP_SESSION_ID'), `BREAKING survives: ${show(res.findings)}`);
  assert.ok(ids.has('ERROR_CODE_32002'), show(res.findings));
  assert.equal(res.status, 1, 'and the build still fails');

  // The id it names is suppressed, precisely, on its own line.
  const one = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0"}}',
    'b.ts': [
      "import { McpError } from '@modelcontextprotocol/sdk/types.js'; // mcp-vet-disable-line TS_SDK_V1_MCPERROR",
      'export const e = McpError;',
    ].join('\n'),
  });
  const oneRes = runCli([one]);
  rmSync(one, { recursive: true, force: true });
  assert.deepEqual(oneRes.findings.map((f) => f.patternId), ['TS_SDK_V1_MONOLITH'], show(oneRes.findings));
});

test('a local class named McpError with no MCP import stays clean', () => {
  const res = runCli([join(tsFixtures, 'negatives', 'local-mcperror.ts')]);
  assert.equal(res.findings.length, 0, show(res.findings));
});

test('a below-floor zod range fires only in a file that imports the SDK', () => {
  const plain = runCli([join(tsFixtures, 'negatives', 'plain-zod.ts')]);
  assert.equal(plain.findings.length, 0, `no MCP import: ${show(plain.findings)}`);

  const kitchen = runCli([join(tsFixtures, 'v2-server', 'kitchen-sink.ts')]);
  const zod3 = kitchen.findings.find((f) => f.patternId === 'TS_SDK_V1_ZOD3');
  assert.ok(zod3, show(kitchen.findings));
  assert.match(zod3.explanation, /\^4\.2\.0/, 'names the v2 floor');
  assert.match(zod3.explanation, /The project declares zod \^3\.25 \|\| \^4\.0\./);

  // At the floor, nothing fires.
  const ok = runCli([join(tsFixtures, 'v2-ported')]);
  assert.ok(!ok.findings.some((f) => f.patternId === 'TS_SDK_V1_ZOD3'), show(ok.findings));
});

test('a correctly ported v2 server produces no TS_SDK findings at all', () => {
  const res = runCli([join(tsFixtures, 'v2-ported')]);
  assert.equal(res.findings.length, 0, show(res.findings));
  assert.equal(res.status, 0);
});

test('aliased and namespace imports resolve to their canonical SDK names', () => {
  const dir = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/core":"^2.0.0"}}',
    'server.ts': [
      "import { McpError as Boom, ErrorCode as Codes } from '@modelcontextprotocol/sdk/types.js';",
      "import * as sdk from '@modelcontextprotocol/sdk/client/streamableHttp.js';",
      'export const fail = (m: string) => new Boom(Codes.InvalidParams, m);',
      'export const E = sdk.StreamableHTTPError;',
    ].join('\n'),
  });
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('TS_SDK_V1_MCPERROR'), `alias resolved: ${show(res.findings)}`);
  assert.ok(ids.has('TS_SDK_V1_HTTP_ERROR'), `namespace read resolved: ${show(res.findings)}`);
});

test('require() and export-from carry the same module evidence as import', () => {
  const dir = project({
    'package.json': '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0"}}',
    'a.cjs': "const { McpError } = require('@modelcontextprotocol/sdk/types.js');\nmodule.exports = { McpError };\n",
    'b.ts': "export { McpError } from '@modelcontextprotocol/sdk/types.js';\n",
  });
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  const files = new Set(res.findings.filter((f) => f.patternId === 'TS_SDK_V1_MONOLITH').map((f) => f.file));
  assert.ok(files.has('a.cjs'), `require(): ${show(res.findings)}`);
  assert.ok(files.has('b.ts'), `export-from: ${show(res.findings)}`);
});

test('REGRESSION: pre-existing protocol rules still fire on a fully v2-ported server', () => {
  // THE bug this release fixes: the TypeScript matcher table was v1-only, so a
  // full v2 port under-reported. Protocol rules must never gate on v1/v2.
  const res = runCli([join(tsFixtures, 'v2-regression')]);
  assert.equal(res.status, 1, 'BREAKING protocol findings still exit 1 on v2 code');
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('SSE_TRANSPORT_DEPRECATED'), 'server-legacy/sse is a real v2 module');
  assert.ok(ids.has('ERROR_CODE_32002'));
  assert.ok(ids.has('LOGGING_SETLEVEL_REMOVED'));
  assert.ok(!res.findings.some((f) => f.patternId.startsWith('TS_SDK_')), 'fully migrated');
});

test('no TypeScript/JavaScript files → the group is silently skipped', () => {
  const shown = spawnSync(
    'node',
    [cli, join(repoRoot, 'test', 'py-sdk-fixtures', 'v1-project'), '--no-files', '--no-color'],
    { encoding: 'utf8' },
  );
  assert.ok(!/TypeScript SDK rules/.test(shown.stdout), 'no group line for a Python-only scan');
});

test('SARIF carries fired TS_SDK rules in the driver (and only fired ones)', () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-tssarif-'));
  const sarifPath = join(out, 'r.sarif');
  spawnSync(
    'node',
    [cli, join(tsFixtures, 'v2-server', 'server.ts'), '--no-files', '--quiet', '--sarif', sarifPath],
    { encoding: 'utf8' },
  );
  const s = JSON.parse(readFileSync(sarifPath, 'utf8'));
  rmSync(out, { recursive: true, force: true });
  const ruleIds = s.runs[0].tool.driver.rules.map((r) => r.id);
  assert.ok(ruleIds.includes('TS_SDK_V1_MONOLITH'));
  assert.ok(ruleIds.includes('TS_SDK_V1_MCPERROR'));
  assert.ok(!ruleIds.includes('TS_SDK_V1_WEBSOCKET'), 'unfired TS_SDK rules stay out of the driver');
  assert.equal(
    ruleIds.filter((id) => !id.startsWith('TS_SDK_')).length,
    22,
    'the 22 spec rules keep their stable shape',
  );
  for (const r of s.runs[0].results) assert.equal(r.level, 'warning', 'DEPRECATED maps to warning');
});

test('markdown and GitHub annotations carry TS_SDK findings like any other rule', () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-tsmd-'));
  const res = spawnSync(
    'node',
    [cli, join(tsFixtures, 'v2-server', 'server.ts'), '--out-dir', out, '--quiet', '--github-annotations'],
    { encoding: 'utf8' },
  );
  const md = readFileSync(join(out, 'mcp-vet-report.md'), 'utf8');
  rmSync(out, { recursive: true, force: true });
  assert.match(md, /\| TS_SDK_V1_MONOLITH \| DEPRECATED \|/);
  assert.match(res.stdout, /^::warning file=server\.ts,line=4,col=\d+::TS_SDK_V1_MONOLITH - /m);
});

test('--no-ts-sdk output over the whole pre-0.14.0 fixture tree is unchanged', () => {
  // The 0.12.0 discipline: the new group must be additive, never a rewrite of
  // what the scanner already said. `test/fixtures` predates this release.
  const res = spawnSync('node', [cli, fixtures, '--no-files', '--quiet', '--json', '--no-ts-sdk'], {
    encoding: 'utf8',
  });
  const findings = JSON.parse(res.stdout);
  assert.ok(findings.length > 100, 'the tree really is being scanned');
  assert.ok(!findings.some((f) => f.patternId.startsWith('TS_SDK_')), 'group fully off');
});

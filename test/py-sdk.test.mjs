import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const fixtures = join(repoRoot, 'test', 'fixtures');
const pyFixtures = join(repoRoot, 'test', 'py-sdk-fixtures');

const { classifySpecifier, detectMcpSdk, clearSdkDetectionCache } = require('../dist/sdk-detect.js');
const { ALL_PY_SDK_RULE_IDS } = require('../dist/types.js');

function runCli(args, env = {}) {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-pysdk-'));
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
// sdk-detect: specifier classification and manifest resolution
// ---------------------------------------------------------------------------

test('classifySpecifier reads declared majors correctly', () => {
  assert.equal(classifySpecifier('>=2.1'), 'v2');
  assert.equal(classifySpecifier('==2.0.0'), 'v2');
  assert.equal(classifySpecifier('~=2.1'), 'v2');
  assert.equal(classifySpecifier('^2.0'), 'v2');
  assert.equal(classifySpecifier('>=1.9,<2'), 'v1');
  assert.equal(classifySpecifier('==1.29.1'), 'v1');
  assert.equal(classifySpecifier('~=1.26'), 'v1');
  assert.equal(classifySpecifier('^1.9'), 'v1');
  assert.equal(classifySpecifier('<=1.30'), 'v1');
  // Ranges a fresh install could resolve either way stay undetermined.
  assert.equal(classifySpecifier('>=1.26'), 'undetermined');
  assert.equal(classifySpecifier(''), 'undetermined');
});

test('detectMcpSdk resolves pyproject, requirements.txt, and uv.lock (lock wins)', () => {
  clearSdkDetectionCache();
  const v2 = detectMcpSdk(join(pyFixtures, 'v2-project'));
  assert.equal(v2.major, 'v2');
  assert.equal(v2.source, 'pyproject.toml');
  assert.equal(v2.httpxDeclared, false);

  const v1 = detectMcpSdk(join(pyFixtures, 'v1-project'));
  assert.equal(v1.major, 'v1');
  assert.equal(v1.specifier, '>=1.9,<2');

  const req = detectMcpSdk(join(pyFixtures, 'requirements-project'));
  assert.equal(req.major, 'v2');
  assert.equal(req.source, 'requirements.txt');
  assert.equal(req.httpxDeclared, true, 'httpx==0.28.1 is a direct declaration');

  // The bare "mcp" in pyproject is undetermined; the uv.lock 2.1.1 pin decides.
  const uv = detectMcpSdk(join(pyFixtures, 'uv-project'));
  assert.equal(uv.major, 'v2');
  assert.equal(uv.source, 'uv.lock');
  assert.match(uv.specifier, /2\.1\.1/);

  // No manifest anywhere up the tree of a temp dir → undetermined.
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-nomanifest-'));
  const none = detectMcpSdk(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(none.major, 'undetermined');
});

// ---------------------------------------------------------------------------
// WORKED EXAMPLE: v1 code in a project declaring mcp>=2.1
// ---------------------------------------------------------------------------

test('WORKED EXAMPLE: v1 FastMCP server against mcp>=2.1 = FASTMCP + GET_CONTEXT, exit 0', () => {
  const res = runCli([join(pyFixtures, 'v2-project', 'server.py')]);
  assert.equal(res.status, 0, `advisory tier never fails the build\n${res.stderr}`);
  const ids = res.findings.map((f) => f.patternId).sort();
  assert.deepEqual(ids, ['PY_SDK_V1_FASTMCP', 'PY_SDK_V1_GET_CONTEXT'],
    JSON.stringify(res.findings.map((f) => `${f.file}:${f.line}:${f.patternId}`)));
  const fastmcp = res.findings.find((f) => f.patternId === 'PY_SDK_V1_FASTMCP');
  assert.equal(fastmcp.line, 1);
  assert.equal(fastmcp.column, 1);
  assert.equal(fastmcp.severity, 'DEPRECATED');
  assert.match(fastmcp.explanation, /renamed to `MCPServer`/, 'quotes the migration guide');
  assert.match(fastmcp.explanation, /ModuleNotFoundError/, 'carries the hard-crash fact');
  assert.match(fastmcp.after, /from mcp\.server\.mcpserver import MCPServer/);
  assert.equal(
    fastmcp.docUrl,
    'https://py.sdk.modelcontextprotocol.io/v2/migration/#fastmcp-renamed-to-mcpserver',
    "the SDK's own error-message pointer",
  );
  const ctx = res.findings.find((f) => f.patternId === 'PY_SDK_V1_GET_CONTEXT');
  assert.match(ctx.before, /get_context\(\)/, 'anchored at the call, not the ctx parameter');
  assert.match(ctx.after, /ctx: Context/, 'shows the parameter-injection replacement');
  // Summary line exactly as specified.
  const shown = spawnSync('node', [cli, join(pyFixtures, 'v2-project', 'server.py'), '--no-files', '--no-color'], {
    encoding: 'utf8',
  });
  assert.match(shown.stdout, /22 spec rules, 0 breaking; 12 Python SDK rules, 2 advisory/);
});

test('all 12 PY_SDK_V1 rules fire on the kitchen sink, all DEPRECATED, exit 0', () => {
  const res = runCli([join(pyFixtures, 'v2-project', 'kitchen_sink.py')]);
  assert.equal(res.status, 0);
  const ids = new Set(res.findings.map((f) => f.patternId));
  for (const id of ALL_PY_SDK_RULE_IDS) {
    assert.ok(ids.has(id), `expected ${id} (got: ${[...ids].join(', ')})`);
  }
  for (const f of res.findings) {
    assert.equal(f.severity, 'DEPRECATED', `${f.patternId} stays advisory`);
    assert.ok(f.docUrl && f.before && f.after, 'rich fields present');
    assert.ok(!/undetermined/.test(f.explanation), 'v2 is resolved, no annotation');
  }
});

// ---------------------------------------------------------------------------
// Gating: v1 suppression, undetermined annotation, forced modes, --no-py-sdk
// ---------------------------------------------------------------------------

test('a project declaring v1 gets zero PY_SDK findings and the informational line', () => {
  const res = spawnSync('node', [cli, join(pyFixtures, 'v1-project'), '--no-files', '--no-color'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.ok(!/PY_SDK_V1/.test(res.stdout), 'group suppressed');
  assert.match(res.stderr, /declares Python SDK v1 \(mcp >=1\.9,<2, pyproject\.toml\)/);
  assert.match(res.stderr, /v2\.1\.1 \(2026-08-25\)/, 'names the available v2 release and date');
});

test('--py-sdk v2 forces the group on for a v1-declaring project', () => {
  const res = runCli([join(pyFixtures, 'v1-project'), '--py-sdk', 'v2']);
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('PY_SDK_V1_FASTMCP'), `got: ${[...ids].join(', ')}`);
  assert.ok(ids.has('PY_SDK_V1_GET_CONTEXT'));
  assert.ok(ids.has('PY_SDK_V1_MCPERROR'));
  assert.equal(res.status, 0);
});

test('no manifest → rules active, findings annotated "(mcp version undetermined)"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-undet-'));
  writeFileSync(join(dir, 'server.py'), 'from mcp.server.fastmcp import FastMCP\nmcp = FastMCP("x")\n', 'utf8');
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  const f = res.findings.find((x) => x.patternId === 'PY_SDK_V1_FASTMCP');
  assert.ok(f, JSON.stringify(res.findings.map((x) => x.patternId)));
  assert.match(f.explanation, /\(mcp version undetermined\)$/);
});

test('--no-py-sdk reproduces the pre-0.12.0 output exactly on a PY_SDK-firing input', () => {
  const on = runCli([join(pyFixtures, 'v2-project')]);
  const off = runCli([join(pyFixtures, 'v2-project'), '--no-py-sdk']);
  assert.ok(on.findings.length > 0, 'default emits the group');
  assert.equal(off.findings.length, 0, 'suppressed entirely');
  assert.equal(off.status, 0);
  const shown = spawnSync('node', [cli, join(pyFixtures, 'v2-project'), '--no-py-sdk', '--no-files', '--no-color'], {
    encoding: 'utf8',
  });
  assert.ok(!/Python SDK rules/.test(shown.stdout), 'no group summary line');
  assert.ok(!/PY_SDK/.test(shown.stdout + shown.stderr));
});

test('--only/--disable accept PY_SDK ids; --only spec-rules-only turns the group off', () => {
  const only = runCli([join(pyFixtures, 'v2-project', 'kitchen_sink.py'), '--only', 'PY_SDK_V1_FASTMCP']);
  assert.deepEqual([...new Set(only.findings.map((f) => f.patternId))], ['PY_SDK_V1_FASTMCP']);
  const disabled = runCli([join(pyFixtures, 'v2-project', 'kitchen_sink.py'), '--disable', 'PY_SDK_V1_HTTPX']);
  assert.ok(!disabled.findings.some((f) => f.patternId === 'PY_SDK_V1_HTTPX'));
  assert.ok(disabled.findings.some((f) => f.patternId === 'PY_SDK_V1_FASTMCP'));
  const specOnly = runCli([join(pyFixtures, 'v2-project'), '--only', 'MCP_SESSION_ID']);
  assert.equal(specOnly.findings.length, 0, 'PY_SDK group off when --only names no PY_SDK rule');
});

// ---------------------------------------------------------------------------
// Edge cases from the spec
// ---------------------------------------------------------------------------

test('half-migrated file reports ONLY the v1 import, once', () => {
  const res = runCli([join(pyFixtures, 'half-migrated')]);
  assert.equal(res.findings.length, 1, JSON.stringify(res.findings.map((f) => `${f.line}:${f.patternId}`)));
  assert.equal(res.findings[0].patternId, 'PY_SDK_V1_FASTMCP');
  assert.equal(res.findings[0].line, 2, 'anchored at the leftover v1 import');
});

test('REGRESSION: pre-existing protocol rules still fire on a fully v2-ported server', () => {
  // THE bug this release fixes: 0.11.0's Python matcher table was v1-only, so a
  // full v2 port under-reported. Protocol rules must never gate on v1/v2.
  const res = runCli([join(pyFixtures, 'v2-regression')]);
  assert.equal(res.status, 1, 'BREAKING protocol findings still exit 1 on v2 code');
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(ids.has('SSE_TRANSPORT_DEPRECATED'), 'mcp.server.sse is still a real module in v2.1.1');
  assert.ok(ids.has('ERROR_CODE_32002'));
  assert.ok(ids.has('LOGGING_SETLEVEL_REMOVED'));
  assert.ok(!res.findings.some((f) => f.patternId.startsWith('PY_SDK_')), 'fully migrated — no SDK findings');
});

test('symbols in comments/docstrings do not fire on the AST path', () => {
  const { pythonAvailable } = require('../dist/py-analyzer.js');
  if (!pythonAvailable()) return;
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-doc-'));
  writeFileSync(
    join(dir, 'server.py'),
    [
      '"""Mentions mcp.server.fastmcp and FastMCP and get_context() in prose only."""',
      '# from mcp.server.fastmcp import FastMCP',
      'from mcp.server.mcpserver import MCPServer',
      'server = MCPServer("clean")',
    ].join('\n'),
    'utf8',
  );
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings.map((f) => `${f.line}:${f.patternId}`)));
});

test('a local class named FastMCP with no mcp import stays clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-vet-local-'));
  writeFileSync(
    join(dir, 'notmcp.py'),
    ['class FastMCP:', '    pass', '', 'class MCPServer:', '    pass', '', 'x = FastMCP()'].join('\n'),
    'utf8',
  );
  const res = runCli([dir]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.findings.length, 0, JSON.stringify(res.findings.map((f) => f.patternId)));
});

test('declared httpx suppresses PY_SDK_V1_HTTPX; the v1 vocabulary still fires', () => {
  const res = runCli([join(pyFixtures, 'requirements-project')]);
  const ids = new Set(res.findings.map((f) => f.patternId));
  assert.ok(!ids.has('PY_SDK_V1_HTTPX'), 'httpx==0.28.1 is declared — no finding');
  assert.ok(ids.has('PY_SDK_V1_FASTMCP'), 'v2 resolved via requirements.txt');
});

test('uv.lock decides the major when pyproject is unconstrained', () => {
  const res = runCli([join(pyFixtures, 'uv-project')]);
  const f = res.findings.find((x) => x.patternId === 'PY_SDK_V1_FASTMCP');
  assert.ok(f, JSON.stringify(res.findings.map((x) => x.patternId)));
  assert.ok(!/undetermined/.test(f.explanation), 'locked 2.1.1 → determined');
});

test('regex fallback (no Python) still detects the PY_SDK_V1 surfaces', () => {
  const res = runCli(
    [join(pyFixtures, 'v2-project', 'kitchen_sink.py'), '--no-files', '--github-annotations'],
    { MCP_VET_NO_PYTHON: '1' },
  );
  for (const id of ['PY_SDK_V1_FASTMCP', 'PY_SDK_V1_MCPERROR', 'PY_SDK_V1_HTTPX', 'PY_SDK_V1_GET_CONTEXT', 'PY_SDK_V1_TIMEDELTA']) {
    assert.match(res.stdout, new RegExp(id), `${id} in the degraded path`);
  }
});

test('no Python files → the group is silently skipped (no summary line)', () => {
  const shown = spawnSync(
    'node',
    [cli, join(fixtures, 'server-tasks.ts'), '--no-files', '--no-color'],
    { encoding: 'utf8' },
  );
  assert.ok(!/Python SDK rules/.test(shown.stdout), 'no group line for a TS-only scan');
});

test('SARIF carries fired PY_SDK rules in the driver (and only fired ones)', () => {
  const out = mkdtempSync(join(tmpdir(), 'mcp-vet-sarif-'));
  const sarifPath = join(out, 'r.sarif');
  spawnSync('node', [cli, join(pyFixtures, 'v2-project', 'server.py'), '--no-files', '--quiet', '--sarif', sarifPath], {
    encoding: 'utf8',
  });
  const s = JSON.parse(readFileSync(sarifPath, 'utf8'));
  rmSync(out, { recursive: true, force: true });
  const ruleIds = s.runs[0].tool.driver.rules.map((r) => r.id);
  assert.ok(ruleIds.includes('PY_SDK_V1_FASTMCP'));
  assert.ok(ruleIds.includes('PY_SDK_V1_GET_CONTEXT'));
  assert.ok(!ruleIds.includes('PY_SDK_V1_HTTPX'), 'unfired PY_SDK rules stay out of the driver');
  assert.equal(ruleIds.filter((id) => !id.startsWith('PY_SDK_')).length, 22, 'the 22 spec rules keep their stable shape');
});

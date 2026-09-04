// Recall benchmark: feed every v1 symbol / module path the official codemod
// knows about through mcp-vet, and report which produce a finding.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const PKG = '{"dependencies":{"@modelcontextprotocol/server":"^2.0.0","zod":"^4.2.0"}}';

function scanSource(src) {
  const dir = mkdtempSync(join(tmpdir(), 'recall-'));
  writeFileSync(join(dir, 'package.json'), PKG, 'utf8');
  writeFileSync(join(dir, 'a.ts'), src, 'utf8');
  const r = spawnSync('node', [cli, dir, '--no-files', '--quiet', '--json'], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return [];
  }
}

// --- 1. SIMPLE_RENAMES from packages/codemod/.../mappings/symbolMap.ts -----
const SIMPLE_RENAMES = {
  McpError: 'ProtocolError',
  JSONRPCError: 'JSONRPCErrorResponse',
  JSONRPCErrorSchema: 'JSONRPCErrorResponseSchema',
  isJSONRPCError: 'isJSONRPCErrorResponse',
  isJSONRPCResponse: 'isJSONRPCResultResponse',
  JSONRPCResponse: 'JSONRPCResultResponse',
  JSONRPCResponseSchema: 'JSONRPCResultResponseSchema',
  ResourceReference: 'ResourceTemplateReference',
  ResourceReferenceSchema: 'ResourceTemplateReferenceSchema',
};

// --- 2. CONTEXT_PROPERTY_MAP ----------------------------------------------
const CONTEXT_PROPS = [
  'signal', 'requestId', '_meta', 'sendRequest', 'sendNotification',
  'authInfo', 'sessionId', 'requestInfo', 'closeSSEStream', 'closeStandaloneSSEStream',
];

// --- 3. IMPORT_MAP keys ---------------------------------------------------
const IMPORT_KEYS = [
  'client/index.js', 'client/auth.js', 'client/auth-extensions.js', 'client/streamableHttp.js',
  'client/sse.js', 'client/stdio.js', 'client/websocket.js', 'client/middleware.js',
  'server/mcp.js', 'server/index.js', 'server/stdio.js', 'server/streamableHttp.js',
  'server/webStandardStreamableHttp.js', 'server/sse.js', 'server/middleware.js',
  'server/middleware/hostHeaderValidation.js', 'server/express.js', 'server/zod-compat.js',
  'server/auth/types.js', 'server/auth/provider.js', 'server/auth/router.js',
  'server/auth/middleware.js', 'server/auth/errors.js', 'server/completable.js',
  'types.js', 'shared/protocol.js', 'shared/transport.js', 'shared/auth-utils.js',
  'shared/uriTemplate.js', 'shared/auth.js', 'shared/stdio.js',
  'experimental/tasks', 'experimental/tasks.js', 'inMemory.js',
];

// --- 4. Removed zod helpers (REMOVED_ZOD_HELPERS) -------------------------
const ZOD_HELPERS = [
  'schemaToJson', 'parseSchemaAsync', 'getSchemaShape',
  'getSchemaDescription', 'isOptionalSchema', 'unwrapOptionalSchema',
];

const rows = [];
const rec = (group, item, findings, note = '') => {
  const ids = [...new Set(findings.map((f) => f.patternId))];
  const caught = ids.length > 0;
  rows.push({ group, item, caught, ids: ids.join(','), note });
};

console.log('scanning...');

for (const sym of Object.keys(SIMPLE_RENAMES)) {
  const src = `import { ${sym} } from '@modelcontextprotocol/sdk/types.js';\nexport const x: any = ${sym};\n`;
  const f = scanSource(src).filter((x) => x.patternId.startsWith('TS_SDK_'));
  // MONOLITH always fires on the path; the question is whether the SYMBOL is named.
  const bySymbol = f.filter((x) => x.patternId !== 'TS_SDK_V1_MONOLITH');
  rec('symbol rename', sym, bySymbol);
}

for (const p of CONTEXT_PROPS) {
  const src = `import { MCPServer } from '@modelcontextprotocol/server';\nexport function h(s: any) { s.setRequestHandler('tools/call', async (req: any, extra: any) => { return extra.${p}; }); }\nexport const S = MCPServer;\n`;
  const f = scanSource(src).filter((x) => x.patternId === 'TS_SDK_V1_HANDLER_EXTRA');
  rec('ctx property', 'extra.' + p, f);
}

for (const k of IMPORT_KEYS) {
  const spec = '@modelcontextprotocol/sdk/' + k;
  const src = `import * as m from '${spec}';\nexport const x = m;\n`;
  const all = scanSource(src);
  const f = all.filter((x) => x.patternId.startsWith('TS_SDK_') || x.patternId === 'SSE_TRANSPORT_DEPRECATED');
  const mono = all.find((x) => x.patternId === 'TS_SDK_V1_MONOLITH');
  // Does the monolith message name a real destination, or fall back to generic?
  const generic = mono && /Import from the v2 package that owns the symbol instead/.test(mono.explanation);
  rec('import path', k, f, generic ? 'GENERIC destination' : '');
}

for (const h of ZOD_HELPERS) {
  const src = `import { ${h} } from '@modelcontextprotocol/sdk/server/zod-compat.js';\nexport const x: any = ${h};\n`;
  const f = scanSource(src).filter((x) => x.patternId === 'TS_SDK_V1_ZOD_COMPAT');
  rec('zod helper', h, f);
}

// --- report ---------------------------------------------------------------
const groups = [...new Set(rows.map((r) => r.group))];
for (const g of groups) {
  const gr = rows.filter((r) => r.group === g);
  const hit = gr.filter((r) => r.caught).length;
  console.log(`\n=== ${g}: ${hit}/${gr.length} caught ===`);
  for (const r of gr) {
    const mark = r.caught ? 'HIT ' : 'MISS';
    console.log(`  ${mark}  ${r.item.padEnd(38)} ${r.ids}${r.note ? '  << ' + r.note : ''}`);
  }
}
const total = rows.length;
const hits = rows.filter((r) => r.caught).length;
console.log(`\nOVERALL: ${hits}/${total} (${((hits / total) * 100).toFixed(1)}%)`);

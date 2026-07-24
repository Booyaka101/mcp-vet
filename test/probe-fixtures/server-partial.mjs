// Probe fixture: a PARTIALLY migrated MCP stdio server. It answers both the
// classic initialize handshake and stateless 2026-07-28 requests (like real
// SDK servers mid-transition), with exactly ONE migration defect per mode:
//
//   node server-partial.mjs legacy-error-code  — everything migrated EXCEPT
//     resources/read of an unknown URI still returns the removed -32002.
//   node server-partial.mjs no-discover        — everything migrated EXCEPT
//     server/discover answers -32601 Method not found.
//   node server-partial.mjs bad-discover       — server/discover answers, but
//     its result is missing the required `capabilities` key.
//
// Each mode must produce exactly one violation under --spec-version 2026-07-28
// and probe CLEAN under the default 2025-11-25 (the new checks are gated).
import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'legacy-error-code';

const TOOLS = [
  {
    name: 'ping',
    description: 'Ping (clean 2020-12 schema).',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { host: { type: 'string', minLength: 1 } },
      required: ['host'],
    },
  },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id == null) return; // notifications
  if (msg.method === 'initialize') {
    return reply(msg.id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: `fixture-partial-${mode}`, version: '1.0.0' },
    });
  }
  if (msg.method === 'tools/list') return reply(msg.id, { tools: TOOLS });
  if (msg.method === 'server/discover') {
    if (mode === 'no-discover') {
      return replyError(msg.id, -32601, 'Method not found');
    }
    if (mode === 'bad-discover') {
      // Answers, but forgot the required capabilities key.
      return reply(msg.id, {
        resultType: 'complete',
        serverInfo: { name: 'fixture-partial-bad-discover', version: '1.0.0' },
      });
    }
    return reply(msg.id, {
      resultType: 'complete',
      supportedVersions: ['2025-11-25', '2026-07-28'],
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'fixture-partial', version: '1.0.0' },
      ttlMs: 60000,
      cacheScope: 'private',
    });
  }
  if (msg.method === 'resources/read') {
    if (mode === 'legacy-error-code') {
      return replyError(msg.id, -32002, `Resource not found: ${msg.params?.uri}`);
    }
    return replyError(msg.id, -32602, `Invalid params: unknown resource ${msg.params?.uri}`);
  }
  replyError(msg.id, -32601, 'Method not found');
});

// Probe fixture: a fully 2026-07-28-native stateless MCP stdio server.
// It has NO initialize handler (that method is removed) and it *requires* the
// per-request _meta (protocolVersion/clientInfo/capabilities) — which also
// proves the prober actually sends a well-formed stateless first request.
// Tool schemas are clean 2020-12 → probing it must produce zero violations.
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'list_users',
    description: 'List users (2020-12 schema with $defs + composition).',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { limit: { $ref: '#/$defs/Limit' } },
      $defs: { Limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    outputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
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
  if (msg.id == null) return;
  if (msg.method === 'initialize') {
    return replyError(msg.id, -32601, 'Method not found: initialize was removed in 2026-07-28');
  }
  if (msg.method === 'tools/list') {
    if (!msg.params || typeof msg.params._meta !== 'object' || msg.params._meta === null) {
      return replyError(msg.id, -32602, 'missing _meta (protocolVersion/clientInfo/capabilities)');
    }
    return reply(msg.id, { tools: TOOLS });
  }
  replyError(msg.id, -32601, 'Method not found');
});

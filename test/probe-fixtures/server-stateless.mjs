// Probe fixture: a fully 2026-07-28-native stateless MCP stdio server — the
// "correctly migrated" reference. It has NO initialize handler (that method is
// removed), *requires* the namespaced per-request _meta keys (which proves the
// prober sends a well-formed stateless request with the RC's exact key names),
// implements the required server/discover RPC (SEP-2575), and answers a read of
// a nonexistent resource with the new -32602 code (was -32002).
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

const RESOURCES = { 'demo://users/readme': 'known resource' };

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

/** 2026-07-28: every request must carry the namespaced _meta keys. */
function hasStatelessMeta(msg) {
  const meta = msg.params?._meta;
  return (
    meta &&
    typeof meta === 'object' &&
    typeof meta['io.modelcontextprotocol/protocolVersion'] === 'string' &&
    typeof meta['io.modelcontextprotocol/clientCapabilities'] === 'object'
  );
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
  if (!hasStatelessMeta(msg)) {
    return replyError(
      msg.id,
      -32602,
      'missing _meta (io.modelcontextprotocol/protocolVersion + clientCapabilities)',
    );
  }
  if (msg.method === 'tools/list') {
    return reply(msg.id, { tools: TOOLS });
  }
  if (msg.method === 'server/discover') {
    return reply(msg.id, {
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'fixture-stateless', version: '2.0.0' },
      ttlMs: 60000,
      cacheScope: 'private',
    });
  }
  if (msg.method === 'resources/read') {
    const uri = msg.params?.uri;
    if (typeof uri !== 'string' || !(uri in RESOURCES)) {
      return replyError(msg.id, -32602, `Invalid params: unknown resource ${uri}`);
    }
    return reply(msg.id, {
      resultType: 'complete',
      contents: [{ uri, mimeType: 'text/plain', text: RESOURCES[uri] }],
    });
  }
  replyError(msg.id, -32601, 'Method not found');
});

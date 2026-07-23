// Probe fixture: a lenient MCP stdio server whose tools/list returns DRAFT-07
// JSON Schemas — one explicit ($schema declared), one inferable (no $schema but
// draft-07 keywords), one fully modern 2020-12 tool, and one edge case whose
// *property* is literally named "definitions" (must NOT be flagged).
// It answers tools/list with or without an initialize handshake, so it can be
// probed under both --spec-version values.
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'lookup_user',
    description: 'Look up a user by reference (explicit draft-07 schema).',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { ref: { $ref: '#/definitions/UserRef' } },
      required: ['ref'],
      definitions: { UserRef: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'legacy_search',
    description: 'Search (no $schema, but draft-07/-04 keyword forms).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { $ref: '#/definitions/Query' },
        limit: { type: 'integer', minimum: 0, exclusiveMinimum: true },
      },
      required: ['query'],
      definitions: { Query: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'modern_find',
    description: 'Find by id or name (proper JSON Schema 2020-12).',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      oneOf: [
        { properties: { id: { $ref: '#/$defs/Id' } }, required: ['id'] },
        { properties: { name: { type: 'string', minLength: 1 } }, required: ['name'] },
      ],
      $defs: { Id: { type: 'string', pattern: '^[a-z0-9-]+$' } },
    },
  },
  {
    name: 'edge_props',
    description: 'Has a *property* named "definitions" — a data field, not the draft-07 keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        definitions: { type: 'object' },
        count: { type: 'integer', exclusiveMinimum: 0 },
      },
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
  if (msg.id == null) return; // notification — no response
  if (msg.method === 'initialize') {
    return reply(msg.id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture-draft07', version: '1.0.0' },
    });
  }
  if (msg.method === 'tools/list') return reply(msg.id, { tools: TOOLS });
  replyError(msg.id, -32601, 'Method not found');
});

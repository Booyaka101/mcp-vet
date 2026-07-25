// Probe fixture: a stdio MCP server that requires a protocol-level SESSION.
// A bare request (no session established) is rejected with a *session* error —
// distinct from the "not initialized" error of server-requires-init.mjs — so it
// trips the `stateless-no-session` compliance check under `--spec 2026-07-28`.
// It still answers the classic initialize handshake (issuing a session), so the
// existing prober can reach it via the 2025-11-25 path (exit 2 is avoided) and
// the new checks run.
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo (clean 2020-12 schema).',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
];

let hasSession = false;

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
    hasSession = true; // the handshake establishes a session
    return reply(msg.id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture-sessionful', version: '1.0.0' },
    });
  }
  if (!hasSession) {
    // A session error (NOT an "initialized" error) — the signal the
    // stateless-no-session check looks for.
    return replyError(msg.id, -32600, 'Bad Request: No valid session ID provided');
  }
  if (msg.method === 'tools/list') return reply(msg.id, { tools: TOOLS });
  replyError(msg.id, -32601, 'Method not found');
});

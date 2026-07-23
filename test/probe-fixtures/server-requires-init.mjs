// Probe fixture: a 2025-11-25-era MCP stdio server that REQUIRES the initialize
// handshake — any request before initialize/initialized is rejected with the
// classic "Server not initialized" error (mirroring the official SDK behavior).
// Its tool schemas are clean 2020-12, so the only 2026-07-28 violation it
// produces is `requires-initialize-handshake`.
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'get_weather',
    description: 'Get the weather for a city.',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { city: { type: 'string', minLength: 1 } },
      required: ['city'],
    },
  },
];

let initialized = false;

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
  if (msg.method === 'notifications/initialized') {
    initialized = true;
    return;
  }
  if (msg.id == null) return; // other notifications
  if (msg.method === 'initialize') {
    return reply(msg.id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture-requires-init', version: '1.0.0' },
    });
  }
  if (!initialized) {
    return replyError(msg.id, -32002, 'Server not initialized');
  }
  if (msg.method === 'tools/list') return reply(msg.id, { tools: TOOLS });
  replyError(msg.id, -32601, 'Method not found');
});

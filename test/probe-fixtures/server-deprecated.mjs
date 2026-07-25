// Probe fixture: a fully 2026-07-28-migrated stateless stdio server that is
// nonetheless still USING the three deprecated features. It passes every ERROR
// check (stateless, server/discover, -32602, no session, no handshake) but:
//   - answers roots/list with a result           -> deprecated-roots  (WARN)
//   - issues a sampling/createMessage request     -> deprecated-sampling (WARN)
//   - emits a notifications/message log message   -> deprecated-logging (WARN)
// so `--spec 2026-07-28` reports exactly the three deprecation warnings.
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'summarize',
    description: 'Summarize text (clean 2020-12 schema).',
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** Proactively emit the deprecated server→client traffic the probe listens for. */
function emitDeprecatedTraffic() {
  // A server-initiated sampling request (deprecated in 2026-07-28).
  send({
    jsonrpc: '2.0',
    id: 'srv-sample-1',
    method: 'sampling/createMessage',
    params: {
      messages: [{ role: 'user', content: { type: 'text', text: 'summarize this' } }],
      maxTokens: 64,
    },
  });
  // An MCP logging notification (deprecated in 2026-07-28).
  send({
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level: 'info', logger: 'fixture', data: 'processing request' },
  });
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
    return replyError(msg.id, -32601, 'Method not found: initialize was removed in 2026-07-28');
  }
  if (msg.method === 'tools/list') {
    emitDeprecatedTraffic(); // uses sampling + logging while handling the request
    return reply(msg.id, { tools: TOOLS });
  }
  if (msg.method === 'server/discover') {
    return reply(msg.id, {
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {}, resources: {}, roots: {} },
      serverInfo: { name: 'fixture-deprecated', version: '2.0.0' },
      ttlMs: 60000,
      cacheScope: 'private',
    });
  }
  if (msg.method === 'roots/list') {
    // Still relying on the deprecated roots capability.
    return reply(msg.id, {
      roots: [{ uri: 'file:///workspace', name: 'workspace' }],
    });
  }
  if (msg.method === 'resources/read') {
    return replyError(msg.id, -32602, `Invalid params: unknown resource ${msg.params?.uri}`);
  }
  replyError(msg.id, -32601, 'Method not found');
});

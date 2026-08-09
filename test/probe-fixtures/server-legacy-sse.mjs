// Probe fixture: a REAL HTTP+SSE server (SEP-2596's deprecated two-endpoint
// transport) whose POST half is already migrated to stateless 2026-07-28
// Streamable HTTP — the exact population `legacy-sse-transport` targets: the
// modern path works, but GET on the endpoint still opens a text/event-stream
// and announces the legacy POST endpoint with an `event: endpoint` frame.
//
// The legacy half genuinely works end to end: a legacy client can GET /sse (or
// /), receive `event: endpoint` → `data: /messages?sessionId=<id>`, POST a
// JSON-RPC request there (answered 202), and read the result off the stream as
// an `event: message` frame.
//
//   node server-legacy-sse.mjs               — endpoint event sent immediately
//   node server-legacy-sse.mjs no-endpoint   — SSE stream opens but never names
//     an endpoint (heartbeat comments only) — the inconclusive-note case.
//
// Prints "PORT=<n>" on stdout once listening.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const mode = process.argv[2] === 'no-endpoint' ? 'no-endpoint' : 'legacy';

const MODERN_TOOL = {
  name: 'lookup_order',
  description: 'Look up an order (2020-12 schema).',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { order: { $ref: '#/$defs/OrderRef' } },
    required: ['order'],
    $defs: { OrderRef: { type: 'string' } },
  },
};

/** sessionId -> the open SSE response stream of the legacy transport */
const sseStreams = new Map();

function handleModernPost(msg, res) {
  const json = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const rpcError = (code, message) =>
    json({ jsonrpc: '2.0', id: msg.id, error: { code, message } });

  if (msg.id == null) {
    res.writeHead(202);
    return res.end(); // notification
  }
  if (msg.method === 'initialize')
    return rpcError(-32601, 'Method not found: initialize was removed in 2026-07-28');
  const meta = msg.params && msg.params._meta;
  if (
    !meta ||
    typeof meta !== 'object' ||
    typeof meta['io.modelcontextprotocol/protocolVersion'] !== 'string' ||
    typeof meta['io.modelcontextprotocol/clientCapabilities'] !== 'object'
  ) {
    return rpcError(-32602, 'missing _meta (protocolVersion + clientCapabilities)');
  }
  const version = meta['io.modelcontextprotocol/protocolVersion'];
  if (version !== '2026-07-28') {
    return rpcError(-32022, `Unsupported protocol version: ${version}`);
  }
  if (msg.method === 'tools/list') {
    return json({
      jsonrpc: '2.0',
      id: msg.id,
      result: { resultType: 'complete', tools: [MODERN_TOOL], ttlMs: 60000, cacheScope: 'private' },
    });
  }
  if (msg.method === 'server/discover') {
    return json({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture-legacy-sse', version: '1.0.0' },
        ttlMs: 60000,
        cacheScope: 'private',
      },
    });
  }
  if (msg.method === 'resources/read') {
    return rpcError(-32602, `Invalid params: unknown resource ${msg.params.uri}`);
  }
  return rpcError(-32601, 'Method not found');
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // The legacy GET half: open an SSE stream and (in legacy mode) announce the
  // POST endpoint as the transport's first event.
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/sse')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (mode === 'no-endpoint') {
      res.write(': heartbeat\n\n');
      const beat = setInterval(() => res.write(': heartbeat\n\n'), 250);
      res.on('close', () => clearInterval(beat));
      return;
    }
    const sessionId = randomUUID();
    sseStreams.set(sessionId, res);
    res.on('close', () => sseStreams.delete(sessionId));
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }

  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad json');
    }

    // The legacy POST half: 202-ack and answer over the SSE stream.
    if (url.pathname === '/messages') {
      const stream = sseStreams.get(url.searchParams.get('sessionId'));
      if (!stream) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('unknown session');
      }
      res.writeHead(202);
      res.end();
      if (msg.id != null) {
        const result =
          msg.method === 'tools/list'
            ? { jsonrpc: '2.0', id: msg.id, result: { tools: [MODERN_TOOL] } }
            : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
        stream.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      }
      return;
    }

    // The migrated Streamable HTTP half.
    handleModernPost(msg, res);
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});

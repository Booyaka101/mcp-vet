// Probe fixture: a Streamable-HTTP MCP server with two modes:
//   node server-http.mjs requires-init   — 2025-11-25 style: initialize issues an
//     Mcp-Session-Id; requests without a valid session are rejected -32002.
//     tools/list returns a DRAFT-07 tool (so an HTTP probe exercises BOTH new
//     violation categories at once).
//   node server-http.mjs stateless       — 2026-07-28 style: no initialize,
//     namespaced _meta required, server/discover implemented, -32602 for
//     unknown resources, clean 2020-12 tool.
//   node server-http.mjs auth-legacy     — stateless MCP + RFC 8414 metadata at
//     /.well-known/oauth-authorization-server that still advertises
//     registration_endpoint with NO client_id_metadata_document_supported and
//     omits authorization_response_iss_parameter_supported (both auth WARNs).
//   node server-http.mjs auth-migrated   — stateless MCP + metadata advertising
//     CIMD support and RFC 9207 iss support (both auth checks pass).
// Prints "PORT=<n>" on stdout once listening.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const MODES = ['stateless', 'auth-legacy', 'auth-migrated'];
const mode = MODES.includes(process.argv[2]) ? process.argv[2] : 'requires-init';

const DRAFT07_TOOL = {
  name: 'lookup_order',
  description: 'Look up an order (explicit draft-07 schema).',
  inputSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { order: { $ref: '#/definitions/OrderRef' } },
    required: ['order'],
    definitions: { OrderRef: { type: 'string' } },
  },
};

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

const sessions = new Set();

const server = createServer((req, res) => {
  // OAuth well-known metadata (GET) for the auth-* modes. Other modes 404 the
  // whole /.well-known/ tree — the probe reports that as inconclusive.
  if (req.method === 'GET') {
    if (
      (mode === 'auth-legacy' || mode === 'auth-migrated') &&
      req.url.startsWith('/.well-known/oauth-authorization-server')
    ) {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const metadata = {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
      };
      if (mode === 'auth-migrated') {
        metadata.client_id_metadata_document_supported = true;
        metadata.authorization_response_iss_parameter_supported = true;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(metadata));
    }
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
    const json = (obj, extraHeaders = {}) => {
      res.writeHead(200, { 'content-type': 'application/json', ...extraHeaders });
      res.end(JSON.stringify(obj));
    };
    const rpcError = (code, message) =>
      json({ jsonrpc: '2.0', id: msg.id, error: { code, message } });

    if (msg.id == null) {
      res.writeHead(202);
      return res.end(); // notification
    }

    if (mode === 'requires-init') {
      if (msg.method === 'initialize') {
        const sid = randomUUID();
        sessions.add(sid);
        return json(
          {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture-http-legacy', version: '1.0.0' },
            },
          },
          { 'mcp-session-id': sid },
        );
      }
      const sid = req.headers['mcp-session-id'];
      if (!sid || !sessions.has(sid)) return rpcError(-32002, 'Server not initialized');
      if (msg.method === 'tools/list')
        return json({ jsonrpc: '2.0', id: msg.id, result: { tools: [DRAFT07_TOOL] } });
      return rpcError(-32601, 'Method not found');
    }

    // stateless / auth-* modes — fully migrated MCP: namespaced _meta required,
    // server/discover implemented, nonexistent resources answered with -32602.
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
      // Final 2026-07-28: required resultType + ttlMs/cacheScope.
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
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'fixture-http-stateless', version: '2.0.0' },
          ttlMs: 60000,
          cacheScope: 'private',
        },
      });
    }
    if (msg.method === 'resources/read') {
      return rpcError(-32602, `Invalid params: unknown resource ${msg.params.uri}`);
    }
    return rpcError(-32601, 'Method not found');
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});

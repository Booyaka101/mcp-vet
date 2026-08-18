// Bundled MCP server carrying pre-2026-07-28 patterns on purpose (fixture).
const http = require('node:http');

const server = http.createServer((req, res) => {
  const sessionId = req.headers['Mcp-Session-Id'];
  if (!sessionId) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: -32002, message: 'Resource not found' } }));
    return;
  }
  res.end('{}');
});

server.listen(3000);

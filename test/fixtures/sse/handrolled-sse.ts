// A hand-rolled MCP server on the legacy two-endpoint HTTP+SSE transport: a
// GET route that opens a text/event-stream and announces the POST endpoint
// with an `event: endpoint` frame, plus the POST /messages half. No SDK class,
// no SDK module path — only the file-level two-endpoint shape can catch it.
// Expected: exactly ONE SSE_TRANSPORT_DEPRECATED finding, anchored at the
// endpoint-event write.

import express from 'express';

const app = express();
const streams = new Map<string, { write(chunk: string): void }>();

app.get('/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const sessionId = String(Date.now());
  streams.set(sessionId, res);
  res.write('event: endpoint\n');
  res.write(`data: /messages?sessionId=${sessionId}\n\n`);
});

app.post('/messages', express.json(), (req, res) => {
  const stream = streams.get(String(req.query.sessionId));
  if (!stream) {
    res.status(404).end();
    return;
  }
  res.status(202).end();
  const reply = { jsonrpc: '2.0', id: req.body.id, result: { tools: [] } };
  stream.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
});

export { app };

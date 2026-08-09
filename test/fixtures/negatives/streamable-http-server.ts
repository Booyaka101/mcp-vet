// A correctly migrated Streamable HTTP MCP server. It legitimately mentions
// text/event-stream — Streamable HTTP frames POST responses as SSE — but it
// serves ONE endpoint and never writes an `event: endpoint` frame, so the
// HTTP+SSE transport rule must NOT fire (nor any other rule).

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

const app = express();

app.post('/mcp', express.json(), async (req, res) => {
  res.setHeader('Accept', 'application/json, text/event-stream');
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await handle(transport, req, res);
});

declare function handle(t: unknown, req: unknown, res: unknown): Promise<void>;

export { app };

// An MCP server still on the deprecated HTTP+SSE transport, via the TS SDK's
// legacy class. Expected: SSE_TRANSPORT_DEPRECATED on the import line (class
// name + module path) and at the construction site — nothing else.

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

const app = express();

app.get('/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  await connectServer(transport);
});

declare function connectServer(t: unknown): Promise<void>;

export { app };

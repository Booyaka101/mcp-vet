// Every TS_SDK_V1 rule in one file, in a project that declares the v2 packages.
// Deliberately free of 2026-07-28 protocol violations, so a test can assert the
// whole file reports at DEPRECATED and exits 0.
import { z } from 'zod';
import { McpError, ErrorCode, JSONRPCError, ResourceReference } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { schemaToJson } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function register(server: any, transport: StreamableHTTPServerTransport) {
  server.tool('greet', 'Greet a user', { name: z.string() }, async (args: any) => args);

  server.setRequestHandler(CallToolRequestSchema, async (request: any, extra: RequestHandlerExtra) => {
    extra.signal.throwIfAborted();
    const id = extra.requestId;
    const info = extra.requestInfo;
    await extra.sendRequest({ method: 'x' });
    return { content: [{ type: 'text', text: String(id ?? info) }] };
  });

  return { transport, mcpAuthRouter, schemaToJson, WebSocketClientTransport };
}

export type Wire = JSONRPCError | ResourceReference;
export const oops = (m: string) => new McpError(ErrorCode.InvalidParams, m);

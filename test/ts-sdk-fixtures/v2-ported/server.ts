// A correctly ported v2 server: registerTool, a method-string handler, the ctx
// parameter, the node transport package, zod at the v2 floor. It imports MCP,
// so the group is active — and finds nothing.
import { z } from 'zod';
import { MCPServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/core';

export const server = new MCPServer({ name: 'demo', version: '2.0.0' });

server.registerTool(
  'greet',
  { description: 'Greet a user', inputSchema: z.object({ name: z.string() }) },
  async ({ name }: { name: string }) => ({ content: [{ type: 'text', text: `hi ${name}` }] }),
);

server.setRequestHandler('resources/read', async (request: any, ctx: any) => {
  ctx.mcpReq.signal.throwIfAborted();
  if (!request.params.uri) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'uri required');
  return { contents: [], resultType: 'complete' };
});

export const transport = new NodeStreamableHTTPServerTransport({});

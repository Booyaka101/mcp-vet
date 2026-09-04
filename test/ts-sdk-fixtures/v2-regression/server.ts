// A fully v2-ported server that still breaks the 2026-07-28 protocol. The
// pre-existing spec rules are never gated on the SDK family, so these keep
// firing (and keep exiting 1) while the TS_SDK_V1 group says nothing.
import { MCPServer } from '@modelcontextprotocol/server';
import { SSEServerTransport } from '@modelcontextprotocol/server-legacy/sse';

export const server = new MCPServer({ name: 'legacy', version: '2.0.0' });

server.setRequestHandler('logging/setLevel', async () => ({ resultType: 'complete' }));

export function missingResource() {
  return { error: { code: -32002, message: 'Resource not found' } };
}

export const sse = (res: any) => new SSEServerTransport('/messages', res);

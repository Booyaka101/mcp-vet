// package.json declares no MCP package; the pnpm lock resolved the v2 pair, so
// the group activates from the lock.
import { McpError } from '@modelcontextprotocol/sdk/types.js';

export const oops = (m: string) => new McpError(-32602, m);

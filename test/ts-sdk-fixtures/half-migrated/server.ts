// Both families in one file, which the guide supports during a staged
// migration. Only the leftover v1 import is reported.
import { MCPServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { JSONRPCError } from '@modelcontextprotocol/sdk/types.js';

export const server = new MCPServer({ name: 'demo', version: '1.0.0' });
export const transport = new StdioServerTransport();
export type Wire = JSONRPCError;

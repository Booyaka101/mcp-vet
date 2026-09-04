// A project that has not migrated. Pinning back to @modelcontextprotocol/sdk@^1
// stays valid, so the TS_SDK_V1 group is suppressed and one informational line
// is printed instead. Zero group findings, exit 0.
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const transport = () => new StreamableHTTPServerTransport({});
export const oops = (m: string) => new McpError(ErrorCode.InvalidParams, m);

// The brief's worked example: a project declaring @modelcontextprotocol/server ^2
// whose code still imports the v1 monolith. Exactly two findings on the import
// line — TS_SDK_V1_MONOLITH and TS_SDK_V1_MCPERROR — both DEPRECATED, exit 0.
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export function badParams(): never {
  throw new McpError(ErrorCode.InvalidParams, 'unknown resource');
}

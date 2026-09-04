// A local class that happens to share a v1 SDK name, in a file that imports no
// MCP package. The group is gated per file on an actual SDK import, so this is
// silent no matter what the project declares.
export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export enum ErrorCode {
  InvalidParams = -32602,
}

export class StreamableHTTPError extends McpError {}

export function boom(): never {
  throw new McpError(ErrorCode.InvalidParams, 'local, not the SDK');
}

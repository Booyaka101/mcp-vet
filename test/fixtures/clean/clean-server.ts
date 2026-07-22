// Clean fixture: a server already migrated to the 2026-07-28 spec.
// Must produce ZERO findings.

export const serverInfo = {
  name: 'clean-mcp-server',
  version: '2.0.0',
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true },
    prompts: { listChanged: true },
  },
};

// Handshake data now arrives in per-request _meta — no initialize handler.
export function handle(req: { params?: { _meta?: Record<string, unknown> } }) {
  const meta = req.params?._meta ?? {};
  const protocolVersion = meta.protocolVersion;
  if (!protocolVersion) {
    // JSON-RPC standard invalid-params code.
    return { error: { code: -32602, message: 'Invalid params' } };
  }
  return { ok: true };
}

// Handle-based Tasks lifecycle uses the same method names but new shapes; this
// clean file simply doesn't reference the legacy string method names at all.
export function makeTaskHandle(id: string) {
  return { taskId: id, poll: () => ({ status: 'working' }) };
}

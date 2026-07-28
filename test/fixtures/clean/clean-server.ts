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

// --- Migrated forms from the FINAL changelog — all of these must stay clean ---

// subscriptions/listen replaces resources/subscribe|unsubscribe.
export function handleSubscriptions(req: any) {
  if (req.method === 'subscriptions/listen') {
    return {
      resultType: 'complete', // required on every result (SEP-2322)
      subscriptions: { toolsListChanged: true, resourcesListChanged: true },
    };
  }
  return null;
}

// The renumbered 2026-07-28 error codes are the CORRECT ones.
export function headerMismatch() {
  return { error: { code: -32020, message: 'Header mismatch' } };
}

// Cacheable list results (SEP-2549) with the stateless session migration.
export const listResult = {
  resultType: 'complete',
  tools: [],
  ttlMs: 60000,
  cacheScope: 'private',
};
export const migratedTransportOptions = { sessionIdGenerator: undefined };

// The migrated includeContext value.
export const samplingDefaults = { includeContext: 'none' };

// Adversarial-but-caught: aliasing the legacy transport class must not hide
// it. Expected: SSE_TRANSPORT_DEPRECATED on the import line (class name +
// module path) AND at the aliased usage site.

import { SSEClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export function connect(url: URL) {
  return new LegacyTransport(url);
}

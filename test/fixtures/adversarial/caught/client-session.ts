// Adversarial fixture (CAUGHT): CLIENT-side session ownership. The server may
// scan clean while the client still resumes a session — these are the client
// patterns that break against a stateless 2026-07-28 server.

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

declare const url: URL;
declare function loadStoredSessionId(): string;
declare function persist(id: string | undefined): void;

// A transport constructed with a stored session id = the client owns a session.
const transport = new StreamableHTTPClientTransport(url, {
  sessionId: loadStoredSessionId(), // BREAKING (medium) — client session resume
});

persist(transport.sessionId); // BREAKING (medium) — client reads its session id

// The migrated, stateless form must NOT fire.
const migrated = new StreamableHTTPClientTransport(url, { sessionId: undefined });

// A sessionId key on a plain object with no transport/client context: not ours.
const unrelated = { sessionId: 'app-level-concept' };

export { transport, migrated, unrelated };

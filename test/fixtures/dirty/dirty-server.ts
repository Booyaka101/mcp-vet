// Dirty fixture: one instance of every rule ADDED or RECLASSIFIED for the
// FINAL 2026-07-28 changelog (v0.9.0). Must produce at least one finding per:
// PING_REMOVED, RESOURCE_SUBSCRIBE_REMOVED, ROOTS_LIST_CHANGED_REMOVED,
// LOGGING_SETLEVEL_REMOVED, SSE_RESUMABILITY_REMOVED,
// ELICITATION_COMPLETE_REMOVED, ERROR_CODE_RENUMBERED, INCLUDE_CONTEXT_VALUES,
// OAUTH_DCR — and exit 1 (plus the -32002 the acceptance dry-run expects).

import {
  PingRequestSchema,
  SubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

declare const server: any;
declare const store: any;
declare function handlePing(): unknown;

// PING_REMOVED — SDK schema constant AND the literal method registration.
server.setRequestHandler(PingRequestSchema, async () => ({})); // BREAKING
server.setRequestHandler('ping', handlePing); // BREAKING

// RESOURCE_SUBSCRIBE_REMOVED — schema constant + both method strings.
server.setRequestHandler(SubscribeRequestSchema, async () => ({})); // BREAKING
export function dispatch(method: string) {
  switch (method) {
    case 'resources/subscribe': // BREAKING — replaced by subscriptions/listen
      return { ok: true };
    case 'resources/unsubscribe': // BREAKING
      return { ok: true };
    case 'logging/setLevel': // BREAKING — hard removal, NOT the deprecated capability
      return { level: 'set' };
  }
  return null;
}

// ROOTS_LIST_CHANGED_REMOVED — hard removal, NOT the deprecated roots capability.
server.notification({ method: 'notifications/roots/list_changed', params: {} }); // BREAKING

// SSE_RESUMABILITY_REMOVED — eventStore into a transport, the header, the field.
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // migrated form — must NOT fire MCP_SESSION_ID
  eventStore: store, // BREAKING — SSE resumability is removed
});
export function resume(req: any) {
  const lastEventId = req.headers['last-event-id']; // BREAKING (string + identifier)
  return transport.start({ resumptionToken: lastEventId }); // BREAKING
}

// AUTH_DCR_NO_APPLICATION_TYPE — a DCR body with redirect_uris + client_name
// but no application_type (SEP-837), posted to the RFC7591 registration
// endpoint (which itself fires OAUTH_DCR).
export async function registerClient(metadata: any) {
  const body = {
    redirect_uris: ['http://127.0.0.1:33418/callback'], // DEPRECATED tier (medium)
    client_name: 'dirty-fixture-client',
  };
  return fetch(metadata.registration_endpoint, { method: 'POST', body: JSON.stringify(body) }); // OAUTH_DCR
}

// AUTH_ISS_UNVALIDATED — redeems the authorization code without ever reading
// or comparing iss (SEP-2468 / RFC 9207).
export async function redeemCode(tokenEndpoint: string, code: string) {
  return fetch(tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code }), // DEPRECATED tier (medium)
  });
}

// AUTH_CREDENTIALS_NOT_ISSUER_KEYED — persisted under the SERVER url, not the
// AS its registration came from (SEP-2352).
export function persistCredentials(serverUrl: string, client_id: string, client_secret: string) {
  store.set(serverUrl, { client_id, client_secret }); // DEPRECATED tier (medium)
}

// ELICITATION_COMPLETE_REMOVED — the notification and the correlation field.
server.notification({ method: 'notifications/elicitation/complete', params: {} }); // BREAKING
export const pendingElicitation = { elicitationId: 'elic-1', mode: 'url' }; // BREAKING (medium)

// ERROR_CODE_RENUMBERED — all three, strictly in error-code positions.
export function errors(err: { code: number }) {
  if (err.code === -32004) {
    // BREAKING — UnsupportedProtocolVersion is -32022 now
    return { error: { code: -32001, message: 'Header mismatch' } }; // BREAKING → -32020
  }
  return new McpError(-32003, 'Missing required client capability'); // BREAKING → -32021
}
export const legacyNotFound = { error: { code: -32002, message: 'Resource not found' } }; // BREAKING (existing rule)

// INCLUDE_CONTEXT_VALUES — deprecated sampling context values.
export const samplingParams = {
  includeContext: 'thisServer', // DEPRECATED — omit or use "none"
  maxTokens: 64,
};

// OAUTH_DCR — RFC7591 dynamic client registration metadata.
export const authMetadata = {
  registration_endpoint: 'https://auth.example.com/oauth/register', // DEPRECATED
};

declare class StreamableHTTPServerTransport {
  constructor(opts: Record<string, unknown>);
  start(opts: Record<string, unknown>): unknown;
}
declare class McpError {
  constructor(code: number, message: string);
}

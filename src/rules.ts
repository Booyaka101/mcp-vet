import { Token, Finding, PatternId, RuntimeRuleId, PluginRuleId, PySdkRuleId, Severity, Confidence } from './types';
import {
  SPEC_URL,
  SEP_2106_URL,
  CHANGELOG_URL,
  DEPRECATED_REGISTRY_URL,
  SEP_2468_URL,
  SEP_837_URL,
  SEP_2352_URL,
  AGENT_PLUGINS_SPEC_URL,
  AGENT_PLUGINS_PLUGIN_SCHEMA_URL,
  AGENT_PLUGINS_MCP_SCHEMA_URL,
  AGENT_PLUGINS_ISSUE_77_URL,
  AGENT_PLUGINS_ISSUE_76_URL,
  PY_SDK_MIGRATION_URL,
  PY_SDK_RELEASES_URL,
} from './constants';

interface RuleMeta {
  id: PatternId;
  label: string;
  severity: Severity;
  explanation: string;
  after: string;
  /** canonical docs anchor; defaults to the RC announcement when omitted */
  docUrl?: string;
}

/**
 * Canonical metadata for each pattern. The `after` strings are the corrected
 * 2026-07-28 patterns, authored from the FINAL changelog
 * (modelcontextprotocol.io/specification/draft/changelog) and the deprecated
 * features registry — every quote is pinned verbatim in docs/SPEC-2026-07-28.md.
 */
export const RULES: Record<PatternId, RuleMeta> = {
  MCP_SESSION_ID: {
    id: 'MCP_SESSION_ID',
    label: 'Mcp-Session-Id',
    severity: 'BREAKING',
    explanation:
      'The Mcp-Session-Id header and protocol-level sessions are removed on 2026-07-28; client info and capabilities now travel in per-request _meta.',
    after: [
      "// 2026-07-28: sessions removed — stop reading/writing the 'Mcp-Session-Id' header.",
      '// Client info & capabilities now arrive in each request’s params._meta.',
      'function handle(req) { const meta = req.params?._meta ?? {}; /* route on meta, not a session id */ }',
    ].join('\n'),
  },
  INITIALIZE_HANDLER: {
    id: 'INITIALIZE_HANDLER',
    label: 'initialize handshake',
    severity: 'BREAKING',
    explanation:
      'The initialize/notifications-initialized handshake is removed on 2026-07-28; protocolVersion, clientInfo and capabilities now travel in _meta on every request.',
    after: [
      '// 2026-07-28: no initialize / notifications/initialized handshake.',
      '// Read handshake data from _meta on every request instead of registering an initialize handler.',
      'function handle(req) { const { protocolVersion, clientInfo, capabilities } = req.params?._meta ?? {}; }',
    ].join('\n'),
  },
  ERROR_CODE_32002: {
    id: 'ERROR_CODE_32002',
    label: 'error code -32002',
    severity: 'BREAKING',
    explanation:
      'The missing-resource error code changes from the MCP-custom -32002 to the JSON-RPC standard -32602 (Invalid Params).',
    after: "return { error: { code: -32602, message: 'Invalid params' } }; // was -32002",
  },
  TASKS_LEGACY: {
    id: 'TASKS_LEGACY',
    label: 'legacy Tasks method',
    severity: 'BREAKING',
    explanation:
      'The experimental Tasks API is redesigned to a handle-based lifecycle on 2026-07-28; tasks/get, tasks/update and tasks/cancel argument shapes change and need manual review.',
    after: [
      '// 2026-07-28: Tasks is now a handle-based extension.',
      '// tools/call returns a task handle; drive it with tasks/get | tasks/update | tasks/cancel',
      '// using the NEW argument shapes — review your params against the RC schema.',
    ].join('\n'),
  },
  TASKS_LIST_REMOVED: {
    id: 'TASKS_LIST_REMOVED',
    label: 'removed tasks/list method',
    severity: 'BREAKING',
    explanation:
      'The tasks/list method is removed entirely on 2026-07-28 (unsafe once protocol-level sessions are gone); there is no drop-in replacement — stop calling/handling it and track task handles yourself.',
    after: [
      '// 2026-07-28: tasks/list is REMOVED — there is no server-side task listing.',
      '// A client tracks the task handles it received from tools/call; there is nothing to enumerate.',
    ].join('\n'),
  },
  TASKS_RESULT_REMOVED: {
    id: 'TASKS_RESULT_REMOVED',
    label: 'removed tasks/result method',
    severity: 'BREAKING',
    explanation:
      'The blocking tasks/result method is removed on 2026-07-28 (SEP-2663); poll for completion and read the result with tasks/get instead.',
    after: [
      '// 2026-07-28: tasks/result is REMOVED — the blocking result call is gone.',
      '// Poll tasks/get until the task is terminal and read its result from there.',
    ].join('\n'),
  },
  PING_REMOVED: {
    id: 'PING_REMOVED',
    label: 'removed ping method',
    severity: 'BREAKING',
    explanation:
      'The 2026-07-28 changelog removes the method outright: "Remove `ping`, `logging/setLevel`, and `notifications/roots/list_changed`." A ping handler or ping request is dead protocol surface — a compliant peer answers it -32601.',
    after: [
      '// 2026-07-28: the MCP ping method is REMOVED (SEP-2575).',
      '// Liveness is transport-level now — rely on the HTTP request/response itself',
      '// (or process supervision on stdio); remove the ping handler/request.',
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  RESOURCE_SUBSCRIBE_REMOVED: {
    id: 'RESOURCE_SUBSCRIBE_REMOVED',
    label: 'removed resources/subscribe / resources/unsubscribe',
    severity: 'BREAKING',
    explanation:
      'The 2026-07-28 changelog replaces per-resource subscriptions: "Replace the HTTP GET endpoint and `resources/subscribe`/`resources/unsubscribe` with `subscriptions/listen`" (SEP-2575). Servers/clients still speaking the old methods get -32601 from compliant peers.',
    after: [
      "// 2026-07-28: use subscriptions/listen — one long-lived POST-response stream.",
      "// The client opts in to specific types: toolsListChanged, promptsListChanged,",
      "// resourcesListChanged, resourceSubscriptions; the server acknowledges and tags",
      "// notifications with _meta['io.modelcontextprotocol/subscriptionId'].",
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  ROOTS_LIST_CHANGED_REMOVED: {
    id: 'ROOTS_LIST_CHANGED_REMOVED',
    label: 'removed notifications/roots/list_changed',
    severity: 'BREAKING',
    explanation:
      'notifications/roots/list_changed is a HARD REMOVAL on 2026-07-28 — the changelog lists it in "Remove `ping`, `logging/setLevel`, and `notifications/roots/list_changed`" (SEP-2575). This is stronger than the roots capability itself, which is only Deprecated: the notification stops working outright.',
    after: [
      '// 2026-07-28: notifications/roots/list_changed is REMOVED (SEP-2575).',
      '// Roots itself is deprecated — pass directories/files via tool parameters,',
      '// resource URIs, or server configuration instead of the roots capability.',
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  LOGGING_SETLEVEL_REMOVED: {
    id: 'LOGGING_SETLEVEL_REMOVED',
    label: 'removed logging/setLevel method',
    severity: 'BREAKING',
    explanation:
      'logging/setLevel is a HARD REMOVAL on 2026-07-28 — the changelog lists it in "Remove `ping`, `logging/setLevel`, and `notifications/roots/list_changed`", adding: "Log level is now set per-request via `io.modelcontextprotocol/logLevel` in `_meta`" (SEP-2575). This is stronger than the logging capability itself, which is only Deprecated.',
    after: [
      "// 2026-07-28: logging/setLevel is REMOVED (SEP-2575).",
      "// Read the per-request level instead: req.params._meta['io.modelcontextprotocol/logLevel'];",
      '// servers MUST NOT emit notifications/message for requests that did not include it.',
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  SSE_RESUMABILITY_REMOVED: {
    id: 'SSE_RESUMABILITY_REMOVED',
    label: 'removed SSE stream resumability',
    severity: 'BREAKING',
    explanation:
      'The 2026-07-28 changelog: "Remove SSE stream resumability and message redelivery (the `Last-Event-ID` header and SSE event IDs) from the Streamable HTTP transport." Event stores, resumption tokens and Last-Event-ID handling are dead code against 2026-07-28 peers.',
    after: [
      '// 2026-07-28: SSE resumability is REMOVED — no Last-Event-ID, no event IDs,',
      '// no eventStore/resumptionToken. "A broken response stream loses the in-flight',
      '// request; clients MUST re-issue it as a new request with a new request ID."',
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  ELICITATION_COMPLETE_REMOVED: {
    id: 'ELICITATION_COMPLETE_REMOVED',
    label: 'removed elicitation completion signal',
    severity: 'BREAKING',
    explanation:
      'The 2026-07-28 changelog removes "the `notifications/elicitation/complete` notification and the `elicitationId` field of URL mode elicitation requests, both introduced in `2025-11-25`" — under MRTR the client learns the outcome by retrying the original request.',
    after: [
      '// 2026-07-28: no notifications/elicitation/complete, no elicitationId.',
      '// MRTR (SEP-2322): return resultType "input_required" with inputRequests; the',
      '// client retries the original request with inputResponses. Correlate across',
      '// retries with your own identifier in requestState.',
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  ERROR_CODE_RENUMBERED: {
    id: 'ERROR_CODE_RENUMBERED',
    label: 'renumbered MCP error code (-32001/-32003/-32004)',
    severity: 'BREAKING',
    explanation:
      'The 2026-07-28 error-code allocation policy renumbers the codes this draft introduced: HeaderMismatch -32001 → -32020, MissingRequiredClientCapability -32003 → -32021, UnsupportedProtocolVersion -32004 → -32022. (-32000..-32019 stays implementation-defined, so only JSON-RPC error `code` positions are flagged.)',
    after: [
      '// 2026-07-28: -32020..-32099 is reserved for the MCP specification.',
      '// HeaderMismatch: -32001 → -32020 · MissingRequiredClientCapability: -32003 → -32021',
      '// UnsupportedProtocolVersion: -32004 → -32022. `mcp-vet --fix` rewrites these in place.',
    ].join('\n'),
    docUrl: CHANGELOG_URL,
  },
  ROOTS_CAP: {
    id: 'ROOTS_CAP',
    label: 'roots capability',
    severity: 'DEPRECATED',
    explanation:
      'The Roots feature is Deprecated in 2026-07-28 (SEP-2577). Registry earliest removal: "First revision released on or after 2027-07-28". It still works, but new implementations should not adopt it. (Note: notifications/roots/list_changed is already a hard removal — see ROOTS_LIST_CHANGED_REMOVED.)',
    after:
      "// 'roots' is Deprecated (earliest removal: first revision released on or after 2027-07-28).\n// Pass directories or files via tool parameters, resource URIs, or server configuration.",
    docUrl: DEPRECATED_REGISTRY_URL,
  },
  SAMPLING_CAP: {
    id: 'SAMPLING_CAP',
    label: 'sampling capability',
    severity: 'DEPRECATED',
    explanation:
      'The Sampling feature is Deprecated in 2026-07-28 (SEP-2577). Registry earliest removal: "First revision released on or after 2027-07-28". Integrate directly with LLM provider APIs instead.',
    after:
      "// 'sampling' is Deprecated (earliest removal: first revision released on or after 2027-07-28).\n// Integrate directly with LLM provider APIs instead of asking the client to sample.",
    docUrl: DEPRECATED_REGISTRY_URL,
  },
  LOGGING_CAP: {
    id: 'LOGGING_CAP',
    label: 'logging capability',
    severity: 'DEPRECATED',
    explanation:
      'The Logging feature is Deprecated in 2026-07-28 (SEP-2577). Registry earliest removal: "First revision released on or after 2027-07-28". Log to stderr (stdio) or use OpenTelemetry. (Note: logging/setLevel is already a hard removal — see LOGGING_SETLEVEL_REMOVED.)',
    after:
      "// 'logging' is Deprecated (earliest removal: first revision released on or after 2027-07-28).\n// Log to stderr for stdio transports; use OpenTelemetry for observability.",
    docUrl: DEPRECATED_REGISTRY_URL,
  },
  INCLUDE_CONTEXT_VALUES: {
    id: 'INCLUDE_CONTEXT_VALUES',
    label: 'deprecated includeContext values',
    severity: 'DEPRECATED',
    explanation:
      'The includeContext values "thisServer" and "allServers" are Deprecated (SEP-2596): "Omit the field or use `\"none\"`; these values will be removed no later than the Sampling feature itself." Registry earliest removal: "Follows Sampling (SEP-2577)".',
    after:
      '// includeContext "thisServer"/"allServers" are Deprecated (removal follows Sampling).\n// Omit the field or use "none".',
    docUrl: DEPRECATED_REGISTRY_URL,
  },
  OAUTH_DCR: {
    id: 'OAUTH_DCR',
    label: 'deprecated OAuth Dynamic Client Registration',
    severity: 'DEPRECATED',
    explanation:
      'The OAuth 2.0 Dynamic Client Registration Protocol (RFC7591) is Deprecated as a client registration mechanism in favor of Client ID Metadata Documents (PR #2858). Registry earliest removal: "First revision released on or after 2027-07-28". It remains available for authorization servers without CIMD support.',
    after:
      '// RFC7591 dynamic registration is Deprecated (earliest removal: first revision released\n// on or after 2027-07-28). Prefer Client ID Metadata Documents; keep DCR only as a\n// fallback for authorization servers that do not support them.',
    docUrl: DEPRECATED_REGISTRY_URL,
  },
  // --- 0.10.0: the three authorization-hardening MUSTs (final changelog Minor
  // changes 7/8/9). These are correctness requirements, not removals — reported
  // like the DEPRECATED tier (exit 0) so they warn without failing the build.
  AUTH_ISS_UNVALIDATED: {
    id: 'AUTH_ISS_UNVALIDATED',
    label: 'authorization code redeemed without iss validation',
    severity: 'DEPRECATED',
    explanation:
      'The 2026-07-28 changelog (SEP-2468): "Authorization servers SHOULD include the `iss` parameter in authorization responses per RFC 9207, and MCP clients MUST validate a present `iss` against the recorded issuer before redeeming the authorization code." This file redeems an authorization code (grant_type authorization_code) but never reads or compares an iss/issuer value — a mix-up attack can trick it into sending the code to the wrong server.',
    after: [
      '// 2026-07-28 (SEP-2468 / RFC 9207): validate iss BEFORE redeeming the code.',
      "// RFC 9207: compare the response's iss to the recorded issuer by simple string",
      '// comparison, and abort on mismatch:',
      "if (params.iss !== undefined && params.iss !== recordedIssuer) throw new Error('iss mismatch');",
      '// ...only then POST the token-endpoint request with grant_type authorization_code.',
    ].join('\n'),
    docUrl: SEP_2468_URL,
  },
  AUTH_DCR_NO_APPLICATION_TYPE: {
    id: 'AUTH_DCR_NO_APPLICATION_TYPE',
    label: 'DCR registration without application_type',
    severity: 'DEPRECATED',
    explanation:
      'The 2026-07-28 changelog (SEP-837): "Require MCP clients to specify an appropriate `application_type` during Dynamic Client Registration to avoid OpenID Connect redirect URI conflicts." This registration body has redirect_uris/client_name but no application_type — under OIDC it defaults to "web", which conflicts with native-style (localhost) redirect URIs.',
    after: [
      "// 2026-07-28 (SEP-837): set application_type explicitly — 'native' for desktop/CLI/",
      "// localhost redirect URIs, 'web' for remote browser apps; non-OIDC servers ignore it.",
      "const body = { redirect_uris, client_name, application_type: 'native' };",
      '// NOTE: DCR itself is now Deprecated (changelog Deprecated item 4, PR #2858) in favour',
      '// of Client ID Metadata Documents — prefer a hosted CIMD client_id URL where the',
      '// authorization server advertises client_id_metadata_document_supported.',
    ].join('\n'),
    docUrl: SEP_837_URL,
  },
  AUTH_CREDENTIALS_NOT_ISSUER_KEYED: {
    id: 'AUTH_CREDENTIALS_NOT_ISSUER_KEYED',
    label: 'client credentials not keyed by issuer',
    severity: 'DEPRECATED',
    explanation:
      'The 2026-07-28 changelog (SEP-2352): "clients MUST key persisted credentials by the issuer identifier, MUST NOT reuse them with a different authorization server, and MUST re-register when the authorization server changes." These credentials are persisted under a key that is not the issuer identifier (a bare constant, or a server/resource URL) — when the resource\'s authorization server changes, they would be replayed against the wrong AS.',
    after: [
      '// 2026-07-28 (SEP-2352): key persisted client credentials by the ISSUER identifier.',
      'store.set(issuer, { client_id, client_secret });',
      '// When protected-resource metadata names a different AS, do not reuse these',
      '// credentials — re-register with the new authorization server.',
    ].join('\n'),
    docUrl: SEP_2352_URL,
  },
  // --- 0.10.4: the sixth (and last uncovered) row of the deprecated-features
  // registry — the HTTP+SSE transport, reclassified as Deprecated by SEP-2596.
  SSE_TRANSPORT_DEPRECATED: {
    id: 'SSE_TRANSPORT_DEPRECATED',
    label: 'deprecated HTTP+SSE transport',
    severity: 'DEPRECATED',
    explanation:
      'The HTTP+SSE transport is Deprecated (SEP-2596): "Reclassify the HTTP+SSE transport (deprecated since protocol version `2025-03-26`) as Deprecated under the feature lifecycle policy." Registry earliest removal: "Three months after SEP-2596 reaches Final". Migrate to Streamable HTTP: one endpoint, POST with an optional SSE response body.',
    after: [
      '// HTTP+SSE transport is Deprecated (earliest removal: three months after SEP-2596 reaches Final).',
      '// Migrate to Streamable HTTP: replace SSEServerTransport with StreamableHTTPServerTransport',
      '// and collapse the GET /sse + POST /messages pair into a single POST endpoint.',
    ].join('\n'),
    docUrl: DEPRECATED_REGISTRY_URL,
  },
};

export interface RuntimeRuleMeta {
  id: RuntimeRuleId;
  label: string;
  severity: Severity;
  explanation: string;
  /** the recommended fix, rendered as the finding's `after` */
  after: string;
  docUrl: string;
}

/**
 * Runtime-probe violation categories (`mcp-vet probe`). These are observed on a
 * *running* server's wire behavior — they have no static-source signal.
 */
export const RUNTIME_RULES: Record<RuntimeRuleId, RuntimeRuleMeta> = {
  'json-schema-dialect': {
    id: 'json-schema-dialect',
    label: 'pre-2020-12 JSON Schema dialect',
    severity: 'WARN',
    explanation:
      'SEP-2106 (2026-07-28) lifts tool inputSchema/outputSchema to full JSON Schema 2020-12; this tool schema declares or uses an older draft (draft-04/-06/-07), which 2020-12 validators interpret differently or silently ignore (e.g. "definitions" instead of "$defs").',
    after:
      'Set $schema to https://json-schema.org/draft/2020-12/schema and replace "definitions" with "$defs". If using TypeScript SDK, upgrade to @modelcontextprotocol/server and configure zod-to-json-schema for draft 2020-12.',
    docUrl: SEP_2106_URL,
  },
  'requires-initialize-handshake': {
    id: 'requires-initialize-handshake',
    label: 'requires the removed initialize handshake',
    severity: 'ERROR',
    explanation:
      'The server rejected (or hung on) a stateless 2026-07-28-style first request that carries capabilities in _meta instead of an initialize handshake; 2026-07-28 clients will not be able to talk to it.',
    after:
      'Update your SDK to @modelcontextprotocol/server (the new 2026-07-28 package) and remove any initialize handler assumptions',
    docUrl: SPEC_URL,
  },
  'missing-server-discover': {
    id: 'missing-server-discover',
    label: 'server/discover not implemented',
    severity: 'ERROR',
    explanation:
      'The 2026-07-28 spec requires every server to implement the server/discover RPC (SEP-2575) — it replaces the removed initialize handshake as the way clients fetch supported protocol versions, capabilities, and identity. This server did not answer it with a result containing a capabilities key.',
    after:
      'Implement server/discover returning { capabilities, supportedVersions, ... } — @modelcontextprotocol/server (the 2026-07-28 SDK) answers it for you automatically.',
    docUrl: SPEC_URL,
  },
  'legacy-resource-error-code': {
    id: 'legacy-resource-error-code',
    label: 'legacy -32002 resource error code',
    severity: 'ERROR',
    explanation:
      'Reading a nonexistent resource returned the MCP-custom error code -32002; the 2026-07-28 spec changes it to the JSON-RPC standard -32602 (Invalid Params). Clients matching on the new code will misclassify this error.',
    after:
      "return { error: { code: -32602, message: 'Invalid params' } }; // was -32002 — the static scan's --fix rewrites source occurrences",
    docUrl: SPEC_URL,
  },

  // --- `--spec 2026-07-28` compliance suite (added on top of the four above) ---

  'stateless-no-session': {
    id: 'stateless-no-session',
    label: 'requires a protocol-level session',
    severity: 'ERROR',
    explanation:
      'A stateless tools/list sent with no Mcp-Session-Id was rejected with a session error. The 2026-07-28 spec removes the Mcp-Session-Id header and the protocol-level session (SEP-2567); the server must serve requests without one.',
    after:
      'Stop requiring a session: remove sessionIdGenerator / the Mcp-Session-Id gate and serve each request statelessly (client identity & capabilities arrive in per-request _meta).',
    docUrl: SPEC_URL,
  },
  'stateless-no-init': {
    id: 'stateless-no-init',
    label: 'requires initialization before requests',
    severity: 'ERROR',
    explanation:
      'A tools/list sent without a prior initialize/initialized handshake was rejected as uninitialized. The 2026-07-28 spec removes the handshake (SEP-2575); a compliant server answers the first request directly.',
    after:
      'Remove the initialize/initialized gate and answer requests immediately; read protocolVersion/clientInfo/capabilities from params._meta on every request.',
    docUrl: SPEC_URL,
  },
  'required-headers': {
    id: 'required-headers',
    label: 'rejects the required Mcp-Method / Mcp-Name headers',
    severity: 'ERROR',
    explanation:
      'The 2026-07-28 Streamable HTTP transport requires each request to carry Mcp-Method and Mcp-Name routing headers that mirror the JSON-RPC body. This server errored on a request that set them, so it will reject conforming 2026-07-28 clients.',
    after:
      'Accept (and, per spec, validate against the body) the Mcp-Method and Mcp-Name request headers rather than rejecting them.',
    docUrl: SPEC_URL,
  },
  'deprecated-sampling': {
    id: 'deprecated-sampling',
    label: 'uses deprecated sampling (sampling/createMessage)',
    severity: 'WARN',
    explanation:
      'The server issued a sampling/createMessage request. Sampling is deprecated in 2026-07-28 and eligible for removal in July 2027; the server-driven LLM call is being phased out.',
    after:
      'Migrate off sampling: call your LLM provider’s API directly from the server instead of asking the client to sample. Eligible for removal July 2027.',
    docUrl: SPEC_URL,
  },
  'deprecated-roots': {
    id: 'deprecated-roots',
    label: 'uses deprecated roots',
    severity: 'WARN',
    explanation:
      'The server answered roots/list with a result, indicating it relies on the roots capability, which is deprecated in 2026-07-28.',
    after:
      'Migrate off roots: pass the paths/URIs the server needs as explicit tool parameters instead of discovering them via the roots capability.',
    docUrl: SPEC_URL,
  },
  'deprecated-logging': {
    id: 'deprecated-logging',
    label: 'uses deprecated MCP logging (notifications/message)',
    severity: 'WARN',
    explanation:
      'The server emitted a notifications/message log notification. The MCP logging protocol is deprecated in 2026-07-28.',
    after:
      'Migrate off MCP logging: write logs to stderr (stdio transport) or emit OpenTelemetry instead of notifications/message.',
    docUrl: SPEC_URL,
  },

  // --- added in 0.9.0 from the FINAL 2026-07-28 changelog ---

  'missing-result-type': {
    id: 'missing-result-type',
    label: 'results missing the required resultType field',
    severity: 'ERROR',
    explanation:
      'The final 2026-07-28 changelog (SEP-2322): "All results now carry a required `resultType` field: `\"complete\"` for ordinary results and `\"input_required\"` for multi round-trip request interim results." This server returned results without it, so strict 2026-07-28 clients will reject them.',
    after:
      'Add resultType to every result: "complete" for ordinary results, "input_required" for MRTR interim results (with inputRequests). The 2026-07-28 SDKs set it automatically.',
    docUrl: CHANGELOG_URL,
  },
  'missing-cacheable-fields': {
    id: 'missing-cacheable-fields',
    label: 'list results missing ttlMs / cacheScope',
    severity: 'WARN',
    explanation:
      'The final 2026-07-28 changelog (SEP-2549): "Require `ttlMs` and `cacheScope` fields on results returned by `tools/list`, `prompts/list`, `resources/list`, `resources/read`, and `resources/templates/list` via a new `CacheableResult` interface." `cacheScope` must be "public" or "private". Without them clients cannot cache and will re-poll.',
    after:
      "Return { ..., ttlMs: <freshness hint in ms>, cacheScope: 'public' | 'private' } on tools/list, prompts/list, resources/list, resources/read and resources/templates/list results.",
    docUrl: CHANGELOG_URL,
  },
  'legacy-error-code-renumbered': {
    id: 'legacy-error-code-renumbered',
    label: 'server still uses the pre-final -32001/-32003/-32004 codes',
    severity: 'ERROR',
    explanation:
      'The final 2026-07-28 changelog renumbers the codes introduced in this draft: HeaderMismatch -32001 → -32020, MissingRequiredClientCapability -32003 → -32021, UnsupportedProtocolVersion -32004 → -32022 (-32020..-32099 is now reserved for the MCP specification). This server answered with one of the old numbers, so 2026-07-28 clients matching the final codes will misclassify the error.',
    after:
      'Renumber: -32001 → -32020 (HeaderMismatch), -32003 → -32021 (MissingRequiredClientCapability), -32004 → -32022 (UnsupportedProtocolVersion). The static scan\'s --fix rewrites source occurrences.',
    docUrl: CHANGELOG_URL,
  },
  'ping-still-answered': {
    id: 'ping-still-answered',
    label: 'answers the removed ping method',
    severity: 'WARN',
    explanation:
      'The final 2026-07-28 changelog removes the method: "Remove `ping`, `logging/setLevel`, and `notifications/roots/list_changed`." This server answered a ping request with a result instead of -32601 (method not found), so it is still carrying removed protocol surface.',
    after:
      'Remove the ping handler and answer ping with -32601. Liveness is transport-level on 2026-07-28 (the HTTP request/response itself, or process supervision on stdio).',
    docUrl: CHANGELOG_URL,
  },

  // --- added in 0.10.0 — authorization-server metadata (auth hardening) ---

  'dcr-still-advertised': {
    id: 'dcr-still-advertised',
    label: 'authorization server still advertises DCR with no CIMD alternative',
    severity: 'WARN',
    explanation:
      'The 2026-07-28 spec deprecates the OAuth 2.0 Dynamic Client Registration Protocol (RFC7591) in favor of Client ID Metadata Documents (changelog Deprecated item 4, PR #2858). This authorization server metadata advertises a registration_endpoint but not client_id_metadata_document_supported, so clients have no CIMD alternative and are forced onto the deprecated path.',
    after:
      'Advertise "client_id_metadata_document_supported": true in the OAuth authorization server metadata and accept HTTPS-URL client_ids; keep registration_endpoint only as a backwards-compatibility fallback.',
    docUrl: CHANGELOG_URL,
  },
  'auth-metadata-missing-iss': {
    id: 'auth-metadata-missing-iss',
    label: 'authorization server metadata omits RFC 9207 iss support',
    severity: 'WARN',
    explanation:
      'The 2026-07-28 changelog (SEP-2468): "Authorization servers SHOULD include the `iss` parameter in authorization responses per RFC 9207, and MCP clients MUST validate a present `iss` against the recorded issuer before redeeming the authorization code." This authorization server metadata omits authorization_response_iss_parameter_supported, so clients cannot rely on the iss mix-up protection.',
    after:
      'Include the iss parameter in authorization responses (RFC 9207) and advertise "authorization_response_iss_parameter_supported": true in the authorization server metadata.',
    docUrl: SEP_2468_URL,
  },

  // --- added in 0.10.4 — the deprecated HTTP+SSE transport (SEP-2596) ---

  'legacy-sse-transport': {
    id: 'legacy-sse-transport',
    label: 'serves the deprecated HTTP+SSE transport',
    severity: 'WARN',
    explanation:
      'target serves the legacy two-endpoint HTTP+SSE transport (GET returned an SSE stream whose first event is `endpoint`); 2026-07-28 removes the HTTP GET endpoint (SEP-2575) and HTTP+SSE is Deprecated in the registry (SEP-2596)',
    after:
      'Migrate to Streamable HTTP: one endpoint, POST with an optional SSE response body — replace SSEServerTransport with StreamableHTTPServerTransport and collapse the GET /sse + POST /messages pair into a single POST endpoint.',
    docUrl: DEPRECATED_REGISTRY_URL,
  },
};

export interface PluginRuleMeta {
  id: PluginRuleId;
  label: string;
  severity: Severity;
  /** Agent Plugins 1.0.0 spec section the rule enforces; overridable per finding */
  section: string;
  explanation: string;
  /** the corrected Agent Plugins 1.0.0 form, rendered as the finding's `after` */
  after: string;
  docUrl: string;
}

/**
 * Agent Plugins 1.0 package rules (`mcp-vet plugin <dir>`, added in 0.11.0).
 * These vet the plugin envelope — plugin.json, mcp.json, and the skills/
 * layout — against the vendored 1.0.0 schemas and the spec's semantic
 * requirements (schemas/agent-plugins/1.0.0/, fetched 2026-08-18).
 *
 * Severities follow what a conformant client does with the condition, not what
 * the published schema says (the two disagree — agent-plugins-spec#77): FATAL
 * means the client rejects the plugin, TOLERATED means §5.2/§8.1 require it to
 * report the condition and keep loading, INFO is context only. mcp.json
 * findings keep the scan tiers (BREAKING exits 1, DEPRECATED exits 0) because
 * §7.2.1's variants are closed and a bad entry genuinely invalidates it.
 */
export const PLUGIN_RULES: Record<PluginRuleId, PluginRuleMeta> = {
  PLUGIN_MANIFEST_INVALID: {
    id: 'PLUGIN_MANIFEST_INVALID',
    label: 'plugin.json violates a fatal 1.0.0 manifest requirement',
    severity: 'FATAL',
    section: '5.2',
    explanation:
      'plugin.json fails the Agent Plugins 1.0.0 manifest requirements in a way conformant clients reject: no manifest at the plugin root (§5.1), unparsable JSON, a missing / wrong-typed / empty required field (§5.3: "the manifest is invalid"), an unrecognized $schema version (§5.2: clients "MUST reject the plugin"), or a name outside §5.5\'s constraints (1-64 chars of lowercase alphanumerics, hyphens and periods, no "--" or ".."). The spec-tolerated schema violations — an unknown top-level field, a non-object extensions — are NOT this rule; they report as TOLERATED and do not fail the run.',
    after: [
      '{',
      '  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",',
      '  "name": "my-plugin"',
      '}',
      '// client-specific data belongs under "extensions": { "com.example.client": { ... } }',
    ].join('\n'),
    docUrl: AGENT_PLUGINS_PLUGIN_SCHEMA_URL,
  },
  PLUGIN_UNKNOWN_FIELD: {
    id: 'PLUGIN_UNKNOWN_FIELD',
    label: 'unknown top-level manifest field (spec-tolerated)',
    severity: 'TOLERATED',
    section: '5.2',
    explanation:
      'The published schema closes the manifest root ("additionalProperties": false), but spec §5.2 overrides it: "Clients MUST report and ignore each unknown field and MUST continue loading the plugin if the manifest otherwise satisfies this section." Schema-valid and spec-conformant part ways here (agent-plugins-spec#77) — every conformant client loads this plugin and reports the field, so mcp-vet reports it and exits 0.',
    after:
      '// delete the field, or move client-specific data under "extensions": { "com.example.client": { ... } }',
    docUrl: AGENT_PLUGINS_ISSUE_77_URL,
  },
  PLUGIN_EXTENSIONS_NOT_OBJECT: {
    id: 'PLUGIN_EXTENSIONS_NOT_OBJECT',
    label: 'extensions is not an object (spec-tolerated)',
    severity: 'TOLERATED',
    section: '8.1',
    explanation:
      'The published schema types extensions as an object, but spec §8.1 overrides a mistyped value: "If extensions is not an object, the client MUST report and ignore the field and continue loading components." Reported exactly once for the field, never per interior key (agent-plugins-spec#77). The data itself is lost — no conformant client reads a non-object extensions.',
    after: '"extensions": { "com.example.client": { } }  // reverse-domain namespace → object',
    docUrl: AGENT_PLUGINS_ISSUE_77_URL,
  },
  PLUGIN_NAME_RE2_LOOKAHEAD: {
    id: 'PLUGIN_NAME_RE2_LOOKAHEAD',
    label: 'name pattern is uncheckable by RE2-based (Go) validators',
    severity: 'INFO',
    section: '5.5',
    explanation:
      'Context for the §5.5 name violation above: the official schema expresses the no-"--"/".." rule with a negative lookahead ((?!.*(?:--|\\.\\.))) that RE2 — Go\'s regexp, and every RE2-based JSON Schema validator — cannot compile at all. The failure is at schema compile time, so a Go-based tool refuses to load plugin.schema.json entirely instead of reporting the name (agent-plugins-spec#76). If your Go tooling errored out on this plugin rather than flagging the name, that is why.',
    after:
      '// fix the name per §5.5 and every validator agrees again: 1-64 chars of [a-z0-9.-],\n// starting and ending alphanumeric, no "--" or ".."',
    docUrl: AGENT_PLUGINS_ISSUE_76_URL,
  },
  PLUGIN_MCP_INVALID: {
    id: 'PLUGIN_MCP_INVALID',
    label: 'mcp.json fails the 1.0.0 MCP configuration schema',
    severity: 'BREAKING',
    section: '7.2.1',
    explanation:
      'mcp.json does not validate against the Agent Plugins 1.0.0 MCP configuration schema: the root requires exactly $schema and mcpServers, and every server entry must match exactly one closed transport variant (stdio, streamable-http, or sse). An unknown field, an unknown type value, or a field belonging to another variant makes the server entry invalid, and conformant clients will not start it.',
    after: [
      '{',
      '  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",',
      '  "mcpServers": {',
      '    "example": { "type": "stdio", "command": "npx", "args": ["-y", "@example/mcp-server"] }',
      '  }',
      '}',
    ].join('\n'),
    docUrl: AGENT_PLUGINS_MCP_SCHEMA_URL,
  },
  PLUGIN_CMD_NOT_SINGLE_TOKEN: {
    id: 'PLUGIN_CMD_NOT_SINGLE_TOKEN',
    label: 'stdio command is not a single executable token',
    severity: 'BREAKING',
    section: '7.2.1',
    explanation:
      'The Agent Plugins spec: "The command field MUST contain a single executable token, not a shell command string. It MUST be either a bare executable name or a plugin-relative path beginning with ./". Clients do not shell-split this value — a command like "node server.js" is looked up verbatim as an executable named "node server.js" and fails to launch.',
    after: '"command": "node", "args": ["${PLUGIN_ROOT}/server.js"]  // or bundle it: "command": "./server.js"',
    docUrl: AGENT_PLUGINS_SPEC_URL,
  },
  PLUGIN_CWD_ESCAPE: {
    id: 'PLUGIN_CWD_ESCAPE',
    label: 'stdio cwd escapes the allowed roots',
    severity: 'BREAKING',
    section: '7.2.1',
    explanation:
      'The Agent Plugins spec allows exactly three cwd forms: a plugin-relative path beginning with ./, exactly ${PLUGIN_ROOT} or a path beginning with ${PLUGIN_ROOT}/, or exactly ${PLUGIN_DATA} or a path beginning with ${PLUGIN_DATA}/ — and the resolved path must stay inside that root. A cwd outside these forms fails containment, and conformant clients treat the server entry as invalid (spec §7.2.2).',
    after: '"cwd": "./"  // or "./sub/dir", "${PLUGIN_ROOT}", "${PLUGIN_ROOT}/sub", "${PLUGIN_DATA}", "${PLUGIN_DATA}/sub"',
    docUrl: AGENT_PLUGINS_SPEC_URL,
  },
  PLUGIN_ENV_RESERVED: {
    id: 'PLUGIN_ENV_RESERVED',
    label: 'env sets a reserved PLUGIN_ROOT / PLUGIN_DATA variable',
    severity: 'BREAKING',
    section: '9.2',
    explanation:
      'The Agent Plugins spec: "An MCP server\'s env object MUST NOT contain entries named PLUGIN_ROOT or PLUGIN_DATA. Such an entry makes that server configuration invalid." Clients supply both reserved variables themselves after applying configured overlays, so a plugin-set value is rejected, not honored.',
    after: '// remove the entry — the client provides PLUGIN_ROOT and PLUGIN_DATA itself;\n// reference them as ${PLUGIN_ROOT}/... or ${PLUGIN_DATA}/... in args, env values, and cwd.',
    docUrl: AGENT_PLUGINS_SPEC_URL,
  },
  PLUGIN_REMOTE_INSECURE_URL: {
    id: 'PLUGIN_REMOTE_INSECURE_URL',
    label: 'remote server url violates the spec URL rules',
    severity: 'BREAKING',
    section: '7.2.1',
    explanation:
      'The Agent Plugins spec: "The url value MUST be an absolute HTTP or HTTPS URL and MUST NOT contain user information or a fragment. Non-loopback endpoints MUST use HTTPS." HTTP is allowed only when the host is exactly localhost or an IP literal in a loopback range (127.0.0.0/8, ::1). Conformant clients refuse to connect to a URL that breaks these rules.',
    after: '"url": "https://example.com/mcp"  // http:// only for localhost / 127.0.0.0/8 / [::1]; never user:pass@ or #fragment',
    docUrl: AGENT_PLUGINS_SPEC_URL,
  },
  PLUGIN_SSE_TRANSPORT: {
    id: 'PLUGIN_SSE_TRANSPORT',
    label: 'declares the deprecated HTTP+SSE transport',
    severity: 'DEPRECATED',
    section: '7.2.1',
    explanation:
      'This mcp.json entry declares type "sse" — the legacy HTTP+SSE transport. The Agent Plugins 1.0.0 schema still accepts it, but the MCP 2026-07-28 spec reclassifies HTTP+SSE as Deprecated under the feature lifecycle policy (SEP-2596, the same change mcp-vet\'s SSE_TRANSPORT_DEPRECATED source rule covers) and removes SSE stream resumability (SSE_RESUMABILITY_REMOVED). The plugin format is one protocol revision behind the protocol it packages.',
    after: '"type": "streamable-http"  // same url field; migrate the server off HTTP+SSE (see SSE_TRANSPORT_DEPRECATED)',
    docUrl: CHANGELOG_URL,
  },
  PLUGIN_SKILL_LAYOUT: {
    id: 'PLUGIN_SKILL_LAYOUT',
    label: 'SKILL.md outside the discoverable skills layout',
    severity: 'DEPRECATED',
    section: '7.1',
    explanation:
      'The Agent Plugins spec: "Each immediate child directory containing a path named exactly SKILL.md that resolves to a regular file is treated as one skill. Clients MUST NOT recursively search deeper descendants for additional skills." This SKILL.md is not at skills/<name>/SKILL.md, so every conformant client silently ignores it.',
    after: 'skills/\n└── my-skill/\n    └── SKILL.md   // exactly one level below skills/',
    docUrl: AGENT_PLUGINS_SPEC_URL,
  },
};

export interface PySdkRuleMeta {
  id: PySdkRuleId;
  label: string;
  severity: Severity;
  explanation: string;
  /** the v2 form, rendered as the finding's `after` */
  after: string;
  docUrl: string;
}

/**
 * Python SDK v1→v2 migration rules (added in 0.12.0). SDK-level, not
 * protocol-level: MCP Python SDK v2.0.0 went stable 2026-07-28 (v2.1.1 shipped
 * 2026-08-25) and renamed/removed the v1 API surface. Every explanation quotes
 * the migration guide (py.sdk.modelcontextprotocol.io/v2/migration/,
 * re-verified 2026-08-26) or a release body verbatim.
 *
 * All DEPRECATED tier — warn, exit 0, never fail a build — even
 * PY_SDK_V1_FASTMCP, whose failure mode under a v2-resolved `mcp` is a hard
 * import-time crash: the tier stays advisory because a declared range can
 * still be pinned back (`mcp<2`) without touching the code, and the message
 * carries the crash fact so nobody mistakes it for a soft deprecation.
 */
export const PY_SDK_RULES: Record<PySdkRuleId, PySdkRuleMeta> = {
  PY_SDK_V1_FASTMCP: {
    id: 'PY_SDK_V1_FASTMCP',
    label: 'v1 FastMCP import (renamed to MCPServer)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "The `FastMCP` class has been renamed to `MCPServer`" and moved from mcp.server.fastmcp to mcp.server.mcpserver. Under SDK v2 this import is a hard import-time crash, not a soft deprecation. v2.1.1 ships mcp/server/fastmcp.py as a stub whose whole body raises ModuleNotFoundError: "This is mcp 2.x, where FastMCP was renamed to MCPServer ... or pin \'mcp<2\' to keep running v1 code."',
    after: [
      '# SDK v2: from mcp.server.mcpserver import MCPServer, Context',
      'from mcp.server.mcpserver import MCPServer',
      'mcp = MCPServer("demo")',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#fastmcp-renamed-to-mcpserver`,
  },
  PY_SDK_V1_MCPERROR: {
    id: 'PY_SDK_V1_MCPERROR',
    label: 'v1 McpError (renamed to MCPError)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "The `McpError` exception class has been renamed to `MCPError` for consistent naming." Under SDK v2 the old name no longer exists, so an except clause or raise using it fails at import/attribute time.',
    after: 'from mcp.shared.exceptions import MCPError  # was: McpError',
    docUrl: `${PY_SDK_MIGRATION_URL}#mcperror-renamed-to-mcperror`,
  },
  PY_SDK_V1_CAMEL_FIELDS: {
    id: 'PY_SDK_V1_CAMEL_FIELDS',
    label: 'v1 camelCase model field access',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "All Pydantic model fields in the protocol types now use snake_case names for Python attribute access": inputSchema → input_schema, isError → is_error, nextCursor → next_cursor. "The JSON wire format is unchanged — traffic the SDK sends still uses camelCase via Pydantic aliases", so only Python attribute/keyword access changes; raw JSON dicts stay camelCase and are not flagged.',
    after: [
      'tool.input_schema      # was tool.inputSchema',
      'result.is_error        # was result.isError',
      'tool.model_dump(by_alias=True, mode="json")  # wire-format camelCase when you need it',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#field-names-changed-from-camelcase-to-snake_case`,
  },
  PY_SDK_V1_STREAMABLEHTTP_CLIENT: {
    id: 'PY_SDK_V1_STREAMABLEHTTP_CLIENT',
    label: 'v1 streamablehttp_client (removed)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide lists "streamablehttp_client removed" under Transports (its get_session_id callback is gone with it). SDK v2 exposes streamable_http_client instead.',
    after: 'from mcp.client.streamable_http import streamable_http_client  # was: streamablehttp_client',
    docUrl: `${PY_SDK_MIGRATION_URL}#streamablehttp_client-removed`,
  },
  PY_SDK_V1_WEBSOCKET: {
    id: 'PY_SDK_V1_WEBSOCKET',
    label: 'v1 WebSocket transport (removed)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "WebSocket transport removed". The ws extra (websockets>=15.0.1) is gone with it. SDK v2 offers no WebSocket transport; migrate to Streamable HTTP or stdio.',
    after: [
      '# no WebSocket transport in SDK v2. Use Streamable HTTP:',
      'from mcp.client.streamable_http import streamable_http_client',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#websocket-transport-removed`,
  },
  PY_SDK_V1_GET_CONTEXT: {
    id: 'PY_SDK_V1_GET_CONTEXT',
    label: 'v1 get_context() (removed; context is injected)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "MCPServer.get_context() has been removed. Context is now injected by the framework and passed explicitly". Declare a ctx: Context parameter on the handler instead of pulling context off the server object.',
    after: [
      'from mcp.server.mcpserver import Context',
      '',
      '@mcp.tool()',
      'async def my_tool(x: int, ctx: Context) -> str:',
      '    await ctx.report_progress(1, 2)  # was: ctx = mcp.get_context()',
      '    return str(x)',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#mcpserverget_context-removed`,
  },
  PY_SDK_V1_TIMEDELTA: {
    id: 'PY_SDK_V1_TIMEDELTA',
    label: 'v1 timedelta timeout (float seconds now)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "Timeouts take float seconds instead of timedelta", and "Client request timeouts now raise -32001 (REQUEST_TIMEOUT) instead of 408". A timedelta handed to a v2 timeout parameter is the wrong type.',
    after: 'session.call_tool("slow", args, read_timeout_seconds=30.0)  # was: timedelta(seconds=30)',
    docUrl: `${PY_SDK_MIGRATION_URL}#timeouts-take-float-seconds-instead-of-timedelta`,
  },
  PY_SDK_V1_ENV: {
    id: 'PY_SDK_V1_ENV',
    label: 'MCP_* environment variables (never read by v2)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "Settings is now a plain Pydantic model rather than a pydantic-settings BaseSettings, and pydantic-settings is no longer a dependency of the SDK." On MCP_* variables it notes "constructor arguments have always taken precedence, so those environment variables never took effect". They were silently inert in v1 too, so this is a cleanup, not a behavior change.',
    after: [
      'import os',
      'mcp = MCPServer("Demo", debug=os.environ.get("MCP_DEBUG") == "true")  # read the env yourself',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#mcp_-environment-variables-and-env-files-are-no-longer-read`,
  },
  PY_SDK_V1_OAUTH: {
    id: 'PY_SDK_V1_OAUTH',
    label: 'v1 OAuth surface (RFC7523 provider / scopes= / timeout=)',
    severity: 'DEPRECATED',
    explanation:
      'The v2.0.0rc1 release notes: "Remove the deprecated RFC7523OAuthClientProvider" (JWTParameters goes with it), "Rename scopes= to scope= on the client-credentials OAuth providers", and "Remove the unused timeout parameter from OAuthClientProvider".',
    after: [
      'ClientCredentialsProvider(..., scope="read write")  # was: scopes=["read", "write"]',
      'OAuthClientProvider(server_url=..., client_metadata=..., storage=...)  # no timeout=',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#rfc7523oauthclientprovider-and-jwtparameters-removed`,
  },
  PY_SDK_V1_CACHE_FALSE: {
    id: 'PY_SDK_V1_CACHE_FALSE',
    label: 'v1 Client(cache=False) (None is the off switch)',
    severity: 'DEPRECATED',
    explanation:
      'The v2.0.0rc1 release notes: "Make CacheConfig() the Client cache default and None the off switch". Client(cache=False) was replaced by Client(cache=None).',
    after: 'client = Client(..., cache=None)  # was: cache=False',
    docUrl: PY_SDK_RELEASES_URL,
  },
  PY_SDK_V1_FILERESOURCE: {
    id: 'PY_SDK_V1_FILERESOURCE',
    label: 'v1 FileResource(is_binary=) (replaced by encoding)',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: FileResource\'s is_binary: bool is replaced by encoding: str | None (binary when None, text decoded as UTF-8 by default). "Passing the removed `is_binary=` argument now raises a `ValidationError`."',
    after: [
      'FileResource(uri="file:///logo.png", path=logo, mime_type="image/png")  # bytes, from mime_type',
      'FileResource(uri="file:///notes.txt", path=notes, encoding="latin-1")   # non-UTF-8 text',
    ].join('\n'),
    docUrl: `${PY_SDK_MIGRATION_URL}#fileresourceis_binary-replaced-by-encoding`,
  },
  PY_SDK_V1_HTTPX: {
    id: 'PY_SDK_V1_HTTPX',
    label: 'httpx imported but no longer installed by mcp v2',
    severity: 'DEPRECATED',
    explanation:
      'The migration guide: "The SDK now depends on httpx2 instead of httpx and httpx-sse" (httpx2>=2.5.0), and "httpx2 is API-compatible with httpx, so usually only the import name changes." This file imports httpx in a project whose mcp no longer installs it, so declare httpx as a direct dependency or port the import to httpx2.',
    after: 'import httpx2  # API-compatible; or declare httpx as a direct dependency',
    docUrl: `${PY_SDK_MIGRATION_URL}#httpx-and-httpx-sse-replaced-by-httpx2`,
  },
};

// --- PY_SDK_V1 matcher tables ---------------------------------------------

// v1-only module paths, matched against import-module tokens (exact or prefix).
const PY_V1_MODULES: Record<string, PySdkRuleId> = {
  'mcp.server.fastmcp': 'PY_SDK_V1_FASTMCP',
  'mcp.client.websocket': 'PY_SDK_V1_WEBSOCKET',
  'mcp.server.websocket': 'PY_SDK_V1_WEBSOCKET',
};

// v1-only names that no longer exist in v2, matched on import or usage.
const PY_V1_NAMES: Record<string, PySdkRuleId> = {
  McpError: 'PY_SDK_V1_MCPERROR',
  streamablehttp_client: 'PY_SDK_V1_STREAMABLEHTTP_CLIENT',
  websocket_client: 'PY_SDK_V1_WEBSOCKET',
  RFC7523OAuthClientProvider: 'PY_SDK_V1_OAUTH',
  JWTParameters: 'PY_SDK_V1_OAUTH',
};

// camelCase model fields renamed to snake_case — only the attribute/kwarg
// forms count (wire JSON stays camelCase in v2 and must not be flagged).
const PY_V1_CAMEL_FIELDS = new Set(['inputSchema', 'outputSchema', 'isError', 'nextCursor']);

const MCP_ENV_RE = /^MCP_[A-Z][A-Z0-9_]*$/;
const OAUTHISH_CALLEE_RE = /oauth|clientcredentials/i;

export interface PySdkEngineOptions {
  enabled: Set<PySdkRuleId>;
  absPath: string;
  source: NonNullable<Finding['source']>;
  /** true when the declared mcp major could not be resolved — annotates findings */
  undetermined: boolean;
  /** true when the project declares httpx as a direct dependency (suppresses PY_SDK_V1_HTTPX) */
  httpxDeclared: boolean;
}

/**
 * Apply the PY_SDK_V1 rules to a Python file's tokens. The whole group is
 * gated on the file importing `mcp` (or any `mcp.*` module) — a local class
 * coincidentally named FastMCP in a non-MCP file must stay silent. The caller
 * gates on the DECLARED mcp major (v2 → active, v1 → suppressed).
 */
export function applyPySdkRules(
  relPath: string,
  lines: string[],
  tokens: Token[],
  opts: PySdkEngineOptions,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const importsMcp = tokens.some(
    (t) =>
      (t.importModule || t.importName) &&
      (t.value === 'mcp' || t.value.startsWith('mcp.')),
  );
  if (!importsMcp) return findings;
  const sawEnvAccess = tokens.some(
    (t) => t.kind === 'name' && (t.value === 'environ' || t.value === 'getenv'),
  );

  const push = (id: PySdkRuleId, t: Token, confidence: Confidence) => {
    if (!opts.enabled.has(id)) return;
    const key = `${t.line}|${t.col ?? 0}|${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const m = PY_SDK_RULES[id];
    const column = t.col;
    findings.push({
      file: relPath,
      line: t.line,
      column,
      endColumn: column !== undefined ? column + t.value.length : undefined,
      patternId: id,
      patternLabel: m.label,
      severity: m.severity,
      confidence,
      explanation: opts.undetermined ? `${m.explanation} (mcp version undetermined)` : m.explanation,
      docUrl: m.docUrl,
      before: snippet(lines, t.line),
      after: m.after,
      absPath: opts.absPath,
      source: opts.source,
    });
  };

  for (const t of tokens) {
    const v = t.value;

    // v1-only module paths (`from mcp.server.fastmcp import FastMCP`). Fires
    // once per import line; usage sites of the imported names are not
    // re-flagged, so a half-migrated file reports only its v1 import.
    if (t.importModule) {
      for (const [mod, id] of Object.entries(PY_V1_MODULES)) {
        if (v === mod || v.startsWith(mod + '.')) push(id, t, 'high');
      }
    }

    // v1-only names — on the import line or at a usage site.
    if (t.kind === 'name' && PY_V1_NAMES[v]) {
      push(PY_V1_NAMES[v], t, t.importName ? 'high' : 'medium');
    }

    // `import httpx` in a project whose mcp no longer installs it. Import
    // statements only — a variable named httpx is not a dependency.
    if (
      !opts.httpxDeclared &&
      (t.importName || t.importModule) &&
      (v === 'httpx' || v.startsWith('httpx.'))
    ) {
      push('PY_SDK_V1_HTTPX', t, 'medium');
    }

    // camelCase model fields — attribute access (`tool.inputSchema`) and call
    // kwargs (`Tool(inputSchema=...)`) only. Dict keys / string literals build
    // wire JSON, which is still camelCase in v2, and stay clean.
    if ((t.attr || t.kwarg) && PY_V1_CAMEL_FIELDS.has(v)) {
      push('PY_SDK_V1_CAMEL_FIELDS', t, 'medium');
    }

    // `server.get_context()` — attribute form only; the injected `ctx`
    // parameter is the MIGRATED form and a bare local get_context() is not
    // the SDK method.
    if (t.kind === 'name' && v === 'get_context' && t.attr) {
      push('PY_SDK_V1_GET_CONTEXT', t, 'medium');
    }

    // timeout kwargs still passing timedelta(...).
    if (t.kwarg && t.timedeltaValue && /timeout/i.test(v)) {
      push('PY_SDK_V1_TIMEDELTA', t, 'high');
    }

    // MCP_* environment variables (only next to environ/getenv access).
    if (t.kind === 'string' && MCP_ENV_RE.test(v) && sawEnvAccess) {
      push('PY_SDK_V1_ENV', t, 'medium');
    }

    // scopes= on an OAuth-ish provider; timeout= on OAuthClientProvider.
    if (t.kwarg && t.callee) {
      if (v === 'scopes' && OAUTHISH_CALLEE_RE.test(t.callee)) {
        push('PY_SDK_V1_OAUTH', t, 'medium');
      }
      if (v === 'timeout' && t.callee === 'OAuthClientProvider') {
        push('PY_SDK_V1_OAUTH', t, 'high');
      }
      // The SDK type is `Client`; `endsWith('Client')` would also claim
      // httpx.AsyncClient(cache=False) and friends, which this change does
      // not touch.
      if (v === 'cache' && t.isFalse && (t.callee === 'Client' || t.callee === 'MCPClient')) {
        push('PY_SDK_V1_CACHE_FALSE', t, 'high');
      }
      if (v === 'is_binary' && t.callee === 'FileResource') {
        push('PY_SDK_V1_FILERESOURCE', t, 'high');
      }
    }
  }

  return findings.sort(
    (a, b) =>
      a.line - b.line ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.patternId.localeCompare(b.patternId),
  );
}

const CAP_RE = /capabilities/i;
const CAP_NAMES: Record<string, PatternId> = {
  roots: 'ROOTS_CAP',
  sampling: 'SAMPLING_CAP',
  logging: 'LOGGING_CAP',
};

// Method-name strings of the deprecated capabilities (SEP-2577). The methods are
// deprecated, not just the capability keys — a server that references these by
// method string (with no literal `capabilities` object nearby) is caught here.
//
// SEVERITY SPLIT (final 2026-07-28 changelog): `logging/setLevel` and
// `notifications/roots/list_changed` are HARD REMOVALS ("Remove `ping`,
// `logging/setLevel`, and `notifications/roots/list_changed`") and live in
// REMOVED_METHODS below at BREAKING. Only the still-functional deprecated
// surfaces stay here at DEPRECATED.
const DEPRECATED_METHODS: Record<string, PatternId> = {
  'roots/list': 'ROOTS_CAP',
  'sampling/createMessage': 'SAMPLING_CAP',
  'notifications/message': 'LOGGING_CAP',
};

// Method-name strings REMOVED outright by the final 2026-07-28 changelog.
// Exact string literals, BREAKING, high confidence (except `ping`, which is so
// generic it additionally requires method-registration context — see below).
const REMOVED_METHODS: Record<string, PatternId> = {
  'notifications/roots/list_changed': 'ROOTS_LIST_CHANGED_REMOVED',
  'logging/setLevel': 'LOGGING_SETLEVEL_REMOVED',
  'resources/subscribe': 'RESOURCE_SUBSCRIBE_REMOVED',
  'resources/unsubscribe': 'RESOURCE_SUBSCRIBE_REMOVED',
  'notifications/elicitation/complete': 'ELICITATION_COMPLETE_REMOVED',
};

// -32001/-32003/-32004 → -32020/-32021/-32022 (error-code allocation policy).
// Only flagged in a JSON-RPC error `code` position (t.errorCode) — the changelog
// grandfathers -32000..-32019 for implementation-defined SDK codes, so a bare
// negative constant is never evidence.
export const RENUMBERED_ERROR_CODES: Record<string, string> = {
  '-32001': '-32020',
  '-32003': '-32021',
  '-32004': '-32022',
};

// SSE-resumability surfaces (SEP-2575 removal). Normalized lowercase, separators
// stripped, so eventStore/event_store/Last-Event-ID/lastEventId all match.
const SSE_RESUMABILITY_TOKENS = new Set([
  'lasteventid', // 'Last-Event-ID' header string, lastEventId, last_event_id
  'eventstore',
  'resumptiontoken',
  'onresumptiontoken',
]);

// RFC7591/RFC8414 dynamic-client-registration field names (OAUTH_DCR).
const DCR_TOKENS = new Set([
  'registration_endpoint',
  'registration_access_token',
  'client_id_issued_at',
]);

// includeContext values deprecated by SEP-2596.
const INCLUDE_CONTEXT_BAD_VALUES = new Set(['thisServer', 'allServers']);
const INCLUDE_CONTEXT_RE = /includeContext|include_context/;

// SSE/ping tokens are generic enough that they only count inside a file that is
// actually MCP-related — a plain SSE client reading Last-Event-ID, or a /ping
// health route, must stay clean.
const MCP_CONTEXT_RE = /\bmcp\b|mcp[-_]|modelcontextprotocol|model context protocol/i;

// HTTP+SSE transport surfaces (SSE_TRANSPORT_DEPRECATED, SEP-2596). The class
// names normalize (lowercase, -/_ stripped) to values unique to the MCP SDKs —
// TS `SSEServerTransport`/`SSEClientTransport` and Python `SseServerTransport`
// all land on the same two strings — so they and the SDK module paths are
// ungated. The generic helper names (python-sdk's sse module surface) are gated
// on MCP file context like the other SSE rule.
const SSE_TRANSPORT_CLASSES = new Set(['sseservertransport', 'sseclienttransport']);
const SSE_TRANSPORT_MODULE_PATHS = [
  '@modelcontextprotocol/sdk/server/sse',
  '@modelcontextprotocol/sdk/client/sse',
  '@modelcontextprotocol/server-legacy',
  'mcp.server.sse',
  'mcp.client.sse',
];
const SSE_TRANSPORT_HELPERS = new Set(['sse_client', 'sse_app', 'connect_sse', 'handle_post_message']);
// The endpoint-event write inside a single string literal, e.g.
// res.write('event: endpoint\ndata: /messages?...'). The field/kwarg form
// ({"event": "endpoint"}) is marked by the analyzers as t.sseEndpointEvent.
const SSE_ENDPOINT_EVENT_RE = /event:\s*endpoint/;

// Any token that shows the file is iss-aware: the `iss` parameter itself, an
// `issuer` field, or a variable like recordedIssuer/expectedIssuer. Reading OR
// comparing any of these counts — the AUTH_ISS_UNVALIDATED rule is deliberately
// conservative (it flags only files that never touch the concept at all).
const issAware = (lower: string): boolean =>
  lower === 'iss' || lower === 'issuer' || lower.includes('issuer');

// SDK symbols that SUPPLY `application_type` for you, so a registration body
// that omits it is already correct and must NOT be flagged (SEP-837):
//   python-sdk  src/mcp/shared/auth.py — `application_type: Literal["web",
//               "native"] = "native"` on OAuthClientMetadata (comment cites SEP-837)
//   typescript-sdk packages/client/src/client/auth.ts:902 —
//               `application_type: clientMetadata.application_type ??
//                deriveApplicationType(clientMetadata.redirect_uris)`
// Only a HAND-ROLLED registration POST — one that never routes through these —
// can actually put a body on the wire without the parameter.
// SEP-2468/837/2352 all constrain what an MCP **client** does. Code implementing
// the authorization SERVER side — a registration endpoint storing an incoming
// client, a token issuer — has `client_name`/`redirect_uris`/`client_id` all
// over it and must not be flagged. These signals only appear on the server side:
// hashing a secret you ISSUED, reading a registration OUT of a request body, or
// importing the SDK's server-auth provider surface.
const SERVER_AUTH_CONTEXT_RE =
  /client_secret_hash|hashed_client_secret|mcp\.server\.auth|OAuthAuthorizationServerProvider|AuthorizationServerProvider|register_client_endpoint|(?:body|payload|request|req)\s*(?:\.\s*get\s*\(\s*|\[\s*)['"]client_(?:name|id)['"]/i;

// The token-request `grant_type` (singular) — the actual code redemption. NOT
// `grant_types` (plural), which is DCR *metadata* declaring what a client
// supports. Both contain the literal 'authorization_code', so anchoring an
// AUTH_ISS_UNVALIDATED finding needs to tell them apart or it reports the
// registration body's line instead of the line that redeems the code.
const GRANT_TYPE_SINGULAR_RE = /\bgrant_type\b/;
// Lines that mark the registration REQUEST, used to anchor the DCR finding at
// the body actually posted rather than the first redirect_uris-shaped dict.
const REGISTRATION_SITE_RE = /registration_endpoint|registration_request|register_client|\bregister\b/i;

const SDK_SUPPLIES_APP_TYPE = new Set([
  'OAuthClientMetadata',
  'OAuthClientMetadataBase',
  'OAuthClientProvider',
  'OAuthClientInformationFull',
]);

// SDK request/notification *schema constants* — how real MCP SDK servers register
// handlers (e.g. `server.setRequestHandler(InitializeRequestSchema, ...)`). Matching
// the exact string literal alone misses these entirely.
const SCHEMA_CONSTANTS: Record<string, PatternId> = {
  InitializeRequestSchema: 'INITIALIZE_HANDLER',
  InitializedNotificationSchema: 'INITIALIZE_HANDLER',
  ListRootsRequestSchema: 'ROOTS_CAP',
  // RE-CLASSIFIED for the final changelog: the list_changed notification and
  // logging/setLevel are hard removals, not deprecations.
  RootsListChangedNotificationSchema: 'ROOTS_LIST_CHANGED_REMOVED',
  SetLevelRequestSchema: 'LOGGING_SETLEVEL_REMOVED',
  CreateMessageRequestSchema: 'SAMPLING_CAP',
  LoggingMessageNotificationSchema: 'LOGGING_CAP',
  ListTasksRequestSchema: 'TASKS_LIST_REMOVED',
  GetTaskResultRequestSchema: 'TASKS_RESULT_REMOVED',
  GetTaskRequestSchema: 'TASKS_LEGACY',
  CancelTaskRequestSchema: 'TASKS_LEGACY',
  // ping is removed outright (SEP-2575) — TS SDK schema constant + the Python
  // SDK type (`types.PingRequest`), both unambiguous.
  PingRequestSchema: 'PING_REMOVED',
  PingRequest: 'PING_REMOVED',
  // resources/subscribe/unsubscribe are replaced by subscriptions/listen.
  SubscribeRequestSchema: 'RESOURCE_SUBSCRIBE_REMOVED',
  UnsubscribeRequestSchema: 'RESOURCE_SUBSCRIBE_REMOVED',
};

// SDK capability *constructor* identifiers (esp. the Python SDK:
// `ClientCapabilities(roots=RootsCapability())`). Unambiguous deprecated-feature use.
const CAP_CONSTRUCTORS: Record<string, PatternId> = {
  RootsCapability: 'ROOTS_CAP',
  SamplingCapability: 'SAMPLING_CAP',
  LoggingCapability: 'LOGGING_CAP',
};

function snippet(lines: string[], line: number): string {
  const idx = line - 1;
  const out: string[] = [];
  if (lines[idx] !== undefined) out.push(`${line}: ${lines[idx].trim()}`);
  if (lines[idx + 1] !== undefined) out.push(`${line + 1}: ${lines[idx + 1].trim()}`);
  return out.join('\n');
}

export interface EngineOptions {
  /** the set of pattern IDs to evaluate (already resolved from only/disable) */
  enabled: Set<PatternId>;
  absPath: string;
  source: NonNullable<Finding['source']>;
}

/**
 * Apply the enabled detection rules to the tokens of a single file, producing
 * findings with a confidence score.
 */
export function applyRules(
  relPath: string,
  lines: string[],
  tokens: Token[],
  opts: EngineOptions,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const { enabled } = opts;

  // Lines that mention "capabilities" — drive the medium-confidence heuristic
  // for the DEPRECATED capability rules (5-7).
  const capLines: number[] = [];
  const includeContextLines: number[] = [];
  let mcpContext = false;
  // Anchor-selection and client/server discrimination for the auth rules.
  const grantTypeLines: number[] = [];
  const registrationLines: number[] = [];
  let serverAuthContext = false;
  for (let i = 0; i < lines.length; i++) {
    if (CAP_RE.test(lines[i])) capLines.push(i + 1);
    if (INCLUDE_CONTEXT_RE.test(lines[i])) includeContextLines.push(i + 1);
    if (!mcpContext && MCP_CONTEXT_RE.test(lines[i])) mcpContext = true;
    if (GRANT_TYPE_SINGULAR_RE.test(lines[i])) grantTypeLines.push(i + 1);
    if (REGISTRATION_SITE_RE.test(lines[i])) registrationLines.push(i + 1);
    if (!serverAuthContext && SERVER_AUTH_CONTEXT_RE.test(lines[i])) serverAuthContext = true;
  }
  /** The candidate closest to any marker line; the first candidate if none. */
  const anchorNearest = (candidates: Token[], markers: number[]): Token | null => {
    if (candidates.length === 0) return null;
    if (markers.length === 0) return candidates[0];
    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.min(...markers.map((m) => Math.abs(m - c.line)));
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  };
  const nearCapabilities = (line: number) =>
    capLines.some((cl) => Math.abs(cl - line) <= 5);
  const nearIncludeContext = (line: number) =>
    includeContextLines.some((cl) => Math.abs(cl - line) <= 5);

  // File-level signals for the three auth-hardening rules (0.10.0). Like
  // SSE_RESUMABILITY_REMOVED, they are gated on MCP file context so a plain
  // OAuth client in an unrelated file stays clean.
  // Candidate anchors are collected, not first-wins: a file typically contains
  // several 'authorization_code' literals and several redirect_uris dicts, and
  // the finding must point at the one that actually redeems / actually posts.
  const authCodeTokens: Token[] = [];
  let sawGrantType = false;
  let sawIss = false;
  const dcrBodyTokens: Token[] = [];
  let sawClientName = false;
  let sawApplicationType = false;
  // File-level signals for the hand-rolled two-endpoint HTTP+SSE shape (8l).
  // `text/event-stream` ALONE must never fire — Streamable HTTP frames POST
  // responses as SSE, so every correct server contains that string.
  let sawTextEventStream = false;
  const sseEndpointTokens: Token[] = [];

  const push = (id: PatternId, t: Token, confidence: Confidence) => {
    if (!enabled.has(id)) return;
    const key = `${t.line}|${t.col ?? 0}|${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const m = RULES[id];
    const column = t.col;
    findings.push({
      file: relPath,
      line: t.line,
      column,
      endColumn: column !== undefined ? column + t.value.length : undefined,
      patternId: id,
      patternLabel: m.label,
      severity: m.severity,
      confidence,
      explanation: m.explanation,
      docUrl: m.docUrl ?? SPEC_URL,
      before: snippet(lines, t.line),
      after: m.after,
      absPath: opts.absPath,
      source: opts.source,
    });
  };

  for (const t of tokens) {
    const v = t.value;
    const lower = v.toLowerCase();

    // Rule 1 — Mcp-Session-Id (string literal, header key, or variable name)
    if (
      (t.kind === 'string' || t.kind === 'name' || t.kind === 'key') &&
      (lower.includes('mcp-session-id') || lower.includes('mcpsessionid'))
    ) {
      push('MCP_SESSION_ID', t, 'high');
    }

    // Rule 2 — initialize handshake (exact method-name string literal)
    if (t.kind === 'string' && (v === 'initialize' || v === 'notifications/initialized')) {
      push('INITIALIZE_HANDLER', t, t.registration ? 'high' : 'low');
    }

    // Rule 3 — legacy error code -32002 (numeric literal)
    if (t.kind === 'number' && v === '-32002') {
      push('ERROR_CODE_32002', t, 'high');
    }

    // Rule 4 — legacy Tasks methods (exact string literals)
    if (
      t.kind === 'string' &&
      (v === 'tasks/get' || v === 'tasks/update' || v === 'tasks/cancel')
    ) {
      push('TASKS_LEGACY', t, 'high');
    }

    // Rule 4b — tasks/list is removed entirely (exact string literal)
    if (t.kind === 'string' && v === 'tasks/list') {
      push('TASKS_LIST_REMOVED', t, 'high');
    }

    // Rule 4c — tasks/result is removed (exact string literal)
    if (t.kind === 'string' && v === 'tasks/result') {
      push('TASKS_RESULT_REMOVED', t, 'high');
    }

    // Rule 8 — deprecated-capability method strings (exact, high confidence)
    if (t.kind === 'string' && DEPRECATED_METHODS[v]) {
      push(DEPRECATED_METHODS[v], t, 'high');
    }

    // Rule 8b — method strings REMOVED outright by the final changelog
    // (notifications/roots/list_changed, logging/setLevel, resources/subscribe,
    // resources/unsubscribe, notifications/elicitation/complete).
    if (t.kind === 'string' && REMOVED_METHODS[v]) {
      push(REMOVED_METHODS[v], t, 'high');
    }

    // Rule 8c — `ping` is removed, but the bare word is far too generic to
    // match on its own (health-check routes, tool names). Only the exact string
    // in MCP method-registration context counts (switch case, method
    // comparison, `method:` key, handler registration — never a `name:` key).
    if (t.kind === 'string' && v === 'ping' && t.registration) {
      push('PING_REMOVED', t, 'high');
    }

    // Rule 8d — the removed elicitation correlation field. The method string is
    // handled by REMOVED_METHODS; the field name is distinctive but could in
    // principle exist in app code, so it reports at medium.
    if ((t.kind === 'key' || t.kind === 'name') && (v === 'elicitationId' || v === 'elicitation_id')) {
      push('ELICITATION_COMPLETE_REMOVED', t, 'medium');
    }

    // Rule 8e — SSE resumability surfaces. `Last-Event-ID`/`lastEventId` and the
    // SDK option names (eventStore, resumptionToken, onresumptiontoken) are also
    // used by plain non-MCP SSE code, so they require either transport context
    // (high) or an MCP-related file (string forms high, identifier forms medium).
    {
      const norm = lower.replace(/[-_]/g, '');
      if (SSE_RESUMABILITY_TOKENS.has(norm)) {
        if (t.transportCtx) push('SSE_RESUMABILITY_REMOVED', t, 'high');
        else if (mcpContext) {
          push('SSE_RESUMABILITY_REMOVED', t, norm === 'lasteventid' && t.kind === 'string' ? 'high' : 'medium');
        }
      }
    }

    // Rule 8f — renumbered MCP error codes, strictly guarded on an error-code
    // position (`code:` key/kwarg, *Error(...) construction, comparison against
    // something named code). -32000..-32019 stays implementation-defined.
    if (t.kind === 'number' && t.errorCode && RENUMBERED_ERROR_CODES[v]) {
      push('ERROR_CODE_RENUMBERED', t, 'high');
    }

    // Rule 8g — deprecated includeContext values. The bare strings are guarded
    // by proximity to an includeContext mention (same shape as the capability
    // proximity heuristic), so unrelated "thisServer" strings stay clean.
    if (t.kind === 'string' && INCLUDE_CONTEXT_BAD_VALUES.has(v) && nearIncludeContext(t.line)) {
      push('INCLUDE_CONTEXT_VALUES', t, 'medium');
    }

    // Rule 8h — RFC7591 dynamic client registration. The RFC's own field names
    // are the concrete signal; medium confidence per the registry's
    // "remains available for backwards compatibility" framing.
    if (DCR_TOKENS.has(lower)) {
      push('OAUTH_DCR', t, 'medium');
    } else if (
      t.kind === 'name' &&
      lower.replace(/[-_]/g, '').includes('dynamicclientregistration')
    ) {
      push('OAUTH_DCR', t, 'medium');
    }

    // Rules 8i-8k — file-level signals for the auth-hardening rules, gathered
    // here and resolved after the loop (they depend on what the file NEVER
    // contains, which no single token can decide).
    {
      const norm = lower.replace(/[-_]/g, '');
      if (t.kind === 'string' && v === 'authorization_code') authCodeTokens.push(t);
      if (norm === 'granttype') sawGrantType = true;
      if (issAware(lower)) sawIss = true;
      if (norm === 'redirecturis' && (t.kind === 'key' || t.kind === 'string')) {
        dcrBodyTokens.push(t);
      }
      if (norm === 'clientname') sawClientName = true;
      if (norm === 'applicationtype') sawApplicationType = true;
      // An SDK metadata model / auth provider fills the parameter in itself.
      if (t.kind === 'name' && SDK_SUPPLIES_APP_TYPE.has(v)) sawApplicationType = true;
    }

    // Rule 8k — a credential-store write whose key the analyzer classified as
    // NOT issuer-derived (bare constant, or a server/resource URL variable).
    if (t.credKey && mcpContext && !serverAuthContext) {
      push('AUTH_CREDENTIALS_NOT_ISSUER_KEYED', t, 'medium');
    }

    // Rule 8l — the deprecated HTTP+SSE transport (SEP-2596). HIGH ungated:
    // the SDK transport classes (unique normalized symbols) and the SDK sse
    // module paths — these name MCP explicitly. MEDIUM, gated on MCP file
    // context: the python-sdk sse helper surface, and a transport key/kwarg
    // whose value is the literal 'sse' (HIGH when the key is literally
    // `transport`). The hand-rolled two-endpoint shape is a file-level
    // post-pass below.
    {
      const norm = lower.replace(/[-_]/g, '');
      if ((t.kind === 'name' || t.kind === 'string') && SSE_TRANSPORT_CLASSES.has(norm)) {
        push('SSE_TRANSPORT_DEPRECATED', t, 'high');
      } else if (
        (t.kind === 'name' || t.kind === 'string') &&
        SSE_TRANSPORT_MODULE_PATHS.some((p) => lower.includes(p))
      ) {
        push('SSE_TRANSPORT_DEPRECATED', t, 'high');
      }
      if (mcpContext && t.kind === 'name' && SSE_TRANSPORT_HELPERS.has(lower)) {
        push('SSE_TRANSPORT_DEPRECATED', t, 'medium');
      }
      if (mcpContext && t.transportSse) {
        push('SSE_TRANSPORT_DEPRECATED', t, lower === 'transport' ? 'high' : 'medium');
      }
      if (t.kind === 'string' && lower.includes('text/event-stream')) sawTextEventStream = true;
      if ((t.kind === 'string' && SSE_ENDPOINT_EVENT_RE.test(v)) || t.sseEndpointEvent) {
        sseEndpointTokens.push(t);
      }
    }

    // Rule 9 — SDK schema-constant identifiers used to register handlers
    if (t.kind === 'name' && SCHEMA_CONSTANTS[v]) {
      push(SCHEMA_CONSTANTS[v], t, 'high');
    }

    // Rule 9b — SDK capability constructor identifiers (RootsCapability, ...)
    if (t.kind === 'name' && CAP_CONSTRUCTORS[v]) {
      push(CAP_CONSTRUCTORS[v], t, 'high');
    }

    // Rule 10 — `sessionIdGenerator` option (TS SDK session usage). The correct
    // migration is `sessionIdGenerator: undefined`, so the analyzer marks that
    // benign; only a real generator is flagged, at medium confidence. TS only.
    if (
      opts.source === 'ts-morph' &&
      t.kind === 'key' &&
      v === 'sessionIdGenerator' &&
      !t.benign
    ) {
      push('MCP_SESSION_ID', t, 'medium');
    }

    // Rule 11 — client-side session ownership. A client transport constructed
    // with a real sessionId / session_id, or a read of transport.sessionId,
    // means the client still behaves as if it owns a session — which breaks
    // against a stateless 2026-07-28 server even when the server scans clean.
    if (
      (t.kind === 'key' || t.kind === 'name') &&
      (v === 'sessionId' || v === 'session_id') &&
      t.clientSession &&
      !t.benign
    ) {
      push('MCP_SESSION_ID', t, 'medium');
    }

    // Rules 5-7 — deprecated capabilities.
    // High confidence when structurally inside a `capabilities` object (AST);
    // medium when only within 5 lines of a "capabilities" mention.
    if ((t.kind === 'key' || t.kind === 'string') && CAP_NAMES[v]) {
      if (t.inCapabilities) push(CAP_NAMES[v], t, 'high');
      else if (nearCapabilities(t.line)) push(CAP_NAMES[v], t, 'medium');
    }
  }

  // Rule 8i — AUTH_ISS_UNVALIDATED (SEP-2468 / RFC 9207). A file that redeems
  // an authorization code (a token request with grant_type 'authorization_code')
  // but never reads or compares any iss/issuer value. Anchored at the
  // 'authorization_code' literal. AST analyzers only — the regex fallback can't
  // see unquoted `params.iss` reads, so it would over-report.
  // Anchored at the 'authorization_code' literal nearest a singular `grant_type`
  // — the line that redeems — not the DCR body's `grant_types` declaration.
  const authCodeToken = anchorNearest(authCodeTokens, grantTypeLines);
  if (
    mcpContext &&
    !serverAuthContext &&
    opts.source !== 'regex' &&
    authCodeToken &&
    sawGrantType &&
    !sawIss
  ) {
    push('AUTH_ISS_UNVALIDATED', authCodeToken, 'medium');
  }

  // Rule 8j — AUTH_DCR_NO_APPLICATION_TYPE (SEP-837). A registration body
  // (redirect_uris + client_name) with no application_type anywhere in the
  // file. Anchored at the redirect_uris key.
  // Anchored at the redirect_uris nearest the registration REQUEST, so the
  // finding points at the body that is actually posted.
  const dcrBodyToken = anchorNearest(dcrBodyTokens, registrationLines);
  if (mcpContext && !serverAuthContext && dcrBodyToken && sawClientName && !sawApplicationType) {
    push('AUTH_DCR_NO_APPLICATION_TYPE', dcrBodyToken, 'medium');
  }

  // Rule 8l post-pass — the hand-rolled two-endpoint HTTP+SSE shape (SEP-2596).
  // The file must contain BOTH a `text/event-stream` content-type string AND an
  // SSE endpoint-event write; the finding anchors at the endpoint-event line.
  // `text/event-stream` alone never fires (Streamable HTTP frames POST
  // responses as SSE), and the whole shape is gated on MCP file context.
  if (mcpContext && sawTextEventStream && sseEndpointTokens.length > 0) {
    push('SSE_TRANSPORT_DEPRECATED', sseEndpointTokens[0], 'medium');
  }

  return findings.sort(
    (a, b) =>
      a.line - b.line ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.patternId.localeCompare(b.patternId),
  );
}

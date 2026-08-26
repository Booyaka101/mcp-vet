# Changelog

All notable changes to `mcp-vet` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0]

MCP Python SDK v2 awareness. The Python SDK's v2.0.0 went stable on
2026-07-28 and v2.1.1 shipped 2026-08-25, renaming `FastMCP` to `MCPServer`
(moved to `mcp.server.mcpserver`), `McpError` to `MCPError`, converting every
protocol model field to snake_case for Python access (`inputSchema` becomes
`input_schema`; the wire JSON stays camelCase), deleting
`streamablehttp_client` and the WebSocket transport, removing
`MCPServer.get_context()`, switching timeouts to float seconds, dropping
`pydantic-settings` along with the MCP_* environment variables (which never
took effect in v1 either), and replacing `httpx`/`httpx-sse` with
`httpx2>=2.5.0`. mcp-vet's Python matcher table was v1-only, so a server that
took the full v2 port presented nothing it recognized and a clean exit read as
compliant. That silent under-report is what this release fixes, and it adds an
advisory migration surface on top.

### Added

- **12 `PY_SDK_V1_*` rules** at the DEPRECATED tier (warn, exit 0, never fail
  a build): `PY_SDK_V1_FASTMCP`, `PY_SDK_V1_MCPERROR`,
  `PY_SDK_V1_CAMEL_FIELDS`, `PY_SDK_V1_STREAMABLEHTTP_CLIENT`,
  `PY_SDK_V1_WEBSOCKET`, `PY_SDK_V1_GET_CONTEXT`, `PY_SDK_V1_TIMEDELTA`,
  `PY_SDK_V1_ENV`, `PY_SDK_V1_OAUTH`, `PY_SDK_V1_CACHE_FALSE`,
  `PY_SDK_V1_FILERESOURCE`, `PY_SDK_V1_HTTPX`. Every message quotes the
  migration guide (py.sdk.modelcontextprotocol.io/v2/migration/, re-verified
  2026-08-26) or a release body verbatim. `PY_SDK_V1_FASTMCP` stays advisory
  even though the failure under a v2-resolved `mcp` is a hard import-time
  crash (v2.1.1 ships `mcp/server/fastmcp.py` as a raising stub), because the
  declared range can still be pinned back with `mcp<2` without touching the
  code. The message carries the crash fact and the stub's own migration-guide
  pointer.
- **`src/sdk-detect.ts`** resolves the DECLARED mcp major from the nearest
  `uv.lock` / `poetry.lock` (exact, wins), `pyproject.toml` (PEP 621
  dependencies, optional-dependency extras, PEP 735 groups, poetry tables), or
  `requirements*.txt`, walking up from each Python file and stopping at the
  repository boundary so an unrelated parent manifest cannot decide the gate.
- **`--py-sdk auto|v1|v2` and `--no-py-sdk`** (`pySdk` in `.mcpvetrc.json`).
  `auto` is the default: v2 activates the group, v1 suppresses it and prints
  one informational line naming v2.1.1 (2026-08-25), and an unresolvable
  declaration runs the rules with every finding annotated "(mcp version
  undetermined)". `--no-py-sdk` reproduces 0.11.0 output byte for byte,
  verified against a captured baseline of every fixture on both the AST and
  the regex-fallback paths. No Python files means the group is silently
  skipped. `--only`/`--disable` accept the new ids.
- The group is gated per FILE on an actual `mcp` import, so a local class
  coincidentally named `FastMCP` stays clean, and per PROJECT on the declared
  major. A half-migrated file that imports both `mcp.server.fastmcp` and
  `mcp.server.mcpserver` reports only the v1 import. `PY_SDK_V1_HTTPX` stays
  quiet when the project declares httpx directly.
- Terminal reports gain a split summary when the group ran:
  `22 spec rules, N breaking; 12 Python SDK rules, M advisory`. JSON, SARIF
  and markdown carry the findings with the same shape as every other rule,
  and fired PY_SDK rules join the SARIF driver the way probe and plugin rules
  already do.
- The library API exports the new surface: `PY_SDK_RULES`,
  `ALL_PY_SDK_RULE_IDS`, `PySdkRuleId`, `PySdkMode`, `PySdkStatus`,
  `detectMcpSdk`, `classifySpecifier`, `clearSdkDetectionCache`.

### Fixed

- **The v2 under-report.** The pre-existing protocol rules were never behind
  the new gating, and now a regression fixture proves it: a fully v2-ported
  server (`mcp.server.mcpserver`) importing `mcp.server.sse`, still a real
  module in v2.1.1, keeps its `SSE_TRANSPORT_DEPRECATED`, `ERROR_CODE_32002`
  and `LOGGING_SETLEVEL_REMOVED` findings and its exit code.

## [0.11.0]

Adds a second input surface: **Agent Plugins 1.0 packages** (`mcp-vet plugin
<dir>`). Agent Plugins 1.0 went GA on 2026-08-12 in VS Code, Copilot CLI, the
GitHub Copilot SDK, and the Copilot app, installed by default from the Awesome
Copilot marketplace, which makes a plugin's `mcp.json` a first-class
distribution channel for MCP servers. That format is one protocol revision
behind the protocol it packages: the 1.0.0 schema still accepts `type: "sse"`,
which the MCP 2026-07-28 spec reclassifies as Deprecated (SEP-2596) and whose
stream resumability it removes. Envelope validators exist; nothing audited the
protocol inside the envelope until now.

### Added

- **`mcp-vet plugin <dir>`** vets a plugin directory: `plugin.json` and
  `mcp.json` against the canonical 1.0.0 schemas (vendored under
  `schemas/agent-plugins/1.0.0/`, fetched 2026-08-18, so validation is offline
  and reproducible), the spec's semantic rules the schemas can't express, and
  the skills discovery layout. Shares the scan's reporters (`--json`,
  `--sarif`, colored terminal) and exit-code contract: any BREAKING finding
  exits 1, DEPRECATED-only exits 0, unusable input exits 2.
- **Six BREAKING rules**: `PLUGIN_MANIFEST_INVALID` (closed-root manifest
  schema failures: unknown top-level fields, bad names with `--`/`..`,
  missing `$schema`), `PLUGIN_MCP_INVALID` (mcp.json root/variant schema
  failures, unknown transport types, cross-variant fields, containment
  failures), `PLUGIN_CMD_NOT_SINGLE_TOKEN` (a stdio `command` that is not a
  single executable token, bare or `./`-relative; `"node server.js"` is two
  tokens), `PLUGIN_CWD_ESCAPE` (`cwd` outside `./`, `${PLUGIN_ROOT}` or
  `${PLUGIN_DATA}`, including `./../x` traversal that passes the schema's
  prefix pattern but escapes the root), `PLUGIN_ENV_RESERVED` (`env` entries
  named `PLUGIN_ROOT`/`PLUGIN_DATA`), and `PLUGIN_REMOTE_INSECURE_URL`
  (a `streamable-http`/`sse` url that is not absolute HTTP(S), carries user
  information or a fragment, or uses plain HTTP on a non-loopback host;
  loopback means exactly `localhost`, `127.0.0.0/8`, or `[::1]`, per the
  spec's "Non-loopback endpoints MUST use HTTPS").
- **Two DEPRECATED rules**: `PLUGIN_SSE_TRANSPORT` (any `type: "sse"` entry;
  the message names `SSE_TRANSPORT_DEPRECATED` and the 2026-07-28 spec) and
  `PLUGIN_SKILL_LAYOUT` (a `SKILL.md` outside `skills/<name>/SKILL.md`;
  clients MUST NOT recurse, so it is silently ignored, not an error).
- **Depth**: a stdio server whose `command` is a `./`-relative path into the
  plugin gets its bundled TS/JS/Python source scanned with the existing 22
  static rules, verbatim, so a plugin shipping its own server gets a real
  2026-07-28 protocol audit, reported plugin-relative with file:line:col.
  Servers that cannot be scanned are never silently skipped: bare launcher
  tokens (`npx`, `node`, `python`) are reported unscannable-by-design with
  the reason printed, and remote entries point at `mcp-vet probe <url>`.
- Programmatic API: `vetPlugin()`, `PLUGIN_RULES`, `ALL_PLUGIN_RULE_IDS`.
- 16 plugin fixtures under `test/fixtures/plugins/` and 28 new tests
  (exact rule ids, severities, and exit codes; 133 total).

### Unchanged (verified)

- The server-scanning path's output is byte-identical to 0.10.4 on the same
  input (JSON output diffed over the full fixture tree), and all 105
  pre-existing tests pass unmodified except one whole-tree assertion updated
  to account for the new fixture files.

## [0.10.4]

Closes the last uncovered row of the deprecated-features registry. Five of its
six rows already had rules; the sixth — the HTTP+SSE transport, reclassified as
Deprecated by SEP-2596 — did not. One new static rule and one new probe check,
nothing else touched.

### Added

- **`SSE_TRANSPORT_DEPRECATED`** (DEPRECATED tier, exit 0) in both analyzers
  and the regex fallback. Ungated, high confidence: the SDK transport classes
  (`SSEServerTransport` / `SSEClientTransport` / Python's `SseServerTransport`
  — the normalized names are unique to the MCP SDKs) and the SDK module paths
  (`@modelcontextprotocol/sdk/server/sse`, `…/client/sse`,
  `@modelcontextprotocol/server-legacy`, `mcp.server.sse`, `mcp.client.sse`),
  flagged at the import line and every usage site, aliases included. Gated on
  file-level MCP context: the python-sdk helper surface (`sse_client`,
  `sse_app`, `connect_sse`, `handle_post_message`), a literal
  `transport: 'sse'` / `transport="sse"` (high when the key is literally
  `transport`), and the hand-rolled two-endpoint shape — a `text/event-stream`
  content type **plus** an `event: endpoint` write, anchored at the
  endpoint-event line. `text/event-stream` alone never fires: Streamable HTTP
  frames POST responses as SSE, and flagging it would false-positive on every
  correct server (locked by three new negatives).
- **`legacy-sse-transport`** (WARN), the thirteenth check in the opt-in
  `probe --spec 2026-07-28` suite. After the standard probe completes it issues
  a fresh `GET` on the endpoint with `Accept: text/event-stream` and warns only
  when a 2xx `text/event-stream` response actually delivers an
  `event: endpoint` frame — the legacy transport's defining handshake. A
  405/404/non-SSE/JSON answer is a clean note; an SSE stream that never names
  an endpoint before `--timeout` is an inconclusive note, never a violation;
  stdio targets skip. Gated behind `--spec` exactly like the other twelve
  (test-locked), and the sniffed stream is aborted with its socket so the
  event loop drains.

### Why the removal date is quoted, not computed

SEP-2596 is Final (the PR is merged and labeled `final`), but the registry's
earliest-removal cell still reads *"Three months after SEP-2596 reaches
Final"* — a relative clause, not a date. Every finding quotes that sentence
verbatim; the day the registry prints a date, the finding will print that
instead. Computing "Final + three months" ourselves would put words in the
registry's mouth.

### Benchmark

Same pinned corpus: **258 findings, 256 true positives, 2 false positives
(0.8%)** — 15 new `SSE_TRANSPORT_DEPRECATED` findings, every one hand-labeled
a true positive (the typescript-sdk's own legacy SSE transport example and
guide, and two python-sdk `sse_client` clients), and a byte-for-byte diff
confirms zero drift in the other 21 rules. The two FPs are the pre-existing
v0.9.0 pair. 105 tests (was 92).

## [0.10.3]

Precision fixes from the first real-world hand-rolled OAuth clients. The 447-file
benchmark corpus is almost entirely SDK-routed, so it surfaced none of these —
they only appeared once the auth rules met code that does OAuth by hand, which is
the population they exist for.

### Fixed

- **Findings now anchor at the line that matters.** A real client contains
  several `authorization_code` literals and several `redirect_uris` dicts; the
  rules took the first of each. `AUTH_ISS_UNVALIDATED` reported the DCR body's
  `grant_types: ["authorization_code"]` declaration instead of the singular
  `grant_type` line that actually redeems the code (58 lines away in the wild
  sample), and `AUTH_DCR_NO_APPLICATION_TYPE` reported an unposted local dict
  instead of the body handed to the registration endpoint. For a tool whose
  claim is `file:line:col`, sending you to the wrong line is a defect in the
  product, not a rounding error.
- **An authorization SERVER implementing DCR is no longer treated as a client.**
  SEP-2468/837/2352 all constrain what an MCP *client* does, but a registration
  endpoint that receives and stores a client has `client_name`, `redirect_uris`
  and `client_id` throughout. Server-side context (hashing a secret you issued,
  reading a registration out of a request body, the SDK's server-auth provider
  surface) now suppresses all three rules. This is the third instance of one
  root cause — the rules could not tell whose side of the exchange they were
  reading — and it is now handled once rather than patched per-rule.
- **Filling a token-request body is not a credential store.**
  `data["client_secret"] = self.client_secret` populates an outgoing request;
  the key is the OAuth field name. A subscript key that is itself a credential
  field name no longer counts as a store key.

### Verified against real code

Three hand-rolled MCP OAuth clients found via GitHub code search (saved as
reduced fixtures). Before: 4 findings, 2 true positives, 2 false positives, and
both true positives on the wrong line. After: **2 findings, 2 true positives,
0 false positives, both correctly anchored** — including the first real-world
`AUTH_ISS_UNVALIDATED` true positive, a client that redeems an authorization
code with no `iss` handling anywhere in the file.

Benchmark corpus re-run and byte-diffed: **243 findings, unchanged, zero drift**
— these fixes touch only code shapes the corpus does not contain. 92 tests
(was 90).

## [0.10.2]

Closes the last counted false positive from the auth-hardening release.

### Fixed

- **`AUTH_CREDENTIALS_NOT_ISSUER_KEYED` no longer flags a server-side
  access-token cache.** SEP-2352 governs the credentials a *client* persists
  after registration; an authorization server caching
  `AccessToken(…, client_id=…)` under the token it just minted is not that.
  A token-shaped container or stored value is now exempt — unless the value
  carries a `client_secret`, which only registration hands out, so a real
  client credential store still fires. This was the FP counted against us in
  0.10.0/0.10.1 (`simple_auth_provider.py:217`); locked by
  `negatives/server_token_cache.py`.

### Changed — benchmark

- Same pinned corpus, re-measured: **243 findings, 241 true positives, 2 false
  positives (0.8%)** — one finding fewer than 0.10.1, and a byte-for-byte
  diff confirms the only change is the removed FP. The two remaining FPs are
  the pre-existing v0.9.0 pair; the three auth rules contribute **zero**
  corpus findings, which is the correct result on a corpus of compliant SDK
  examples. Their positive behaviour is proven by `test/fixtures/auth/` and
  `test/fixtures/dirty/` instead — BENCHMARK.md says so explicitly rather than
  letting a quiet corpus imply the rules are inert. 90 tests (was 89).

## [0.10.1]

A precision fix and a correction to a published number. 0.10.0's
`AUTH_DCR_NO_APPLICATION_TYPE` fired on the correct, migrated form — and the
benchmark then counted those hits as true positives, overstating precision.
Both are fixed here.

### Fixed

- **`AUTH_DCR_NO_APPLICATION_TYPE` no longer flags SDK-routed registration.**
  Both official SDKs supply `application_type` themselves: python-sdk
  `src/mcp/shared/auth.py` defaults it on `OAuthClientMetadata` (*"SEP-837:
  OIDC application_type. Defaults to `"native"` since MCP clients typically use
  loopback redirect URIs"*), and typescript-sdk
  `packages/client/src/client/auth.ts:902` derives it
  (`clientMetadata.application_type ?? deriveApplicationType(clientMetadata.redirect_uris)`).
  A body handed to either already carries the parameter, so the rule now
  recognizes those symbols and fires only on a **hand-rolled** registration
  POST. This was the single most common way Python MCP clients do DCR — every
  such user would have seen a false positive on correct code. Locked as true
  negatives: `negatives/sdk_dcr_defaults.py`, `negatives/sdk-dcr-defaults.ts`.

### Changed — benchmark correction

- **0.10.0 reported 247 findings / 244 TP / 3 FP (1.2%). That was wrong.** The
  three `AUTH_DCR_NO_APPLICATION_TYPE` findings in the python-sdk examples were
  false positives, not true ones — the examples are correct. With the rule
  fixed, the same pinned corpus measures **244 findings, 241 true positives,
  3 false positives (1.2%)**. The percentage coincidentally matches; the
  composition does not. BENCHMARK.md carries the correction in full, and the
  remaining `AUTH_CREDENTIALS_NOT_ISSUER_KEYED` FP (a server-side access-token
  cache read as a credential store) is still counted, not suppressed.

## [0.10.0]

The authorization-hardening release. 0.3.0 promised that changes with no
static signal — "SSE push-channel removal, required Mcp-Method/Mcp-Name
headers, auth hardening, JSON Schema 2020-12 schemas" — would at least be
named after every scan. Headers and schemas got probe checks; auth hardening
never got anything. But the final changelog's three authorization paragraphs
(Minor changes 7/8/9) ARE statically visible, so this release covers them and
removes "auth hardening" from the post-scan needs-manual-review notice.

### Added — three auth-hardening static rules (exit-0 warn tier), in BOTH analyzers

These are MUSTs about *correctness*, not removals — they report at the
DEPRECATED tier (exit 0) and never fail the build. All three are gated on
file-level MCP context the same way `SSE_RESUMABILITY_REMOVED` is, so a plain
OAuth client in an unrelated file stays clean (locked by
`negatives/plain-oauth-client.ts` + `negatives/plain_oauth_client.py`).

- **`AUTH_ISS_UNVALIDATED`** (SEP-2468) — a file that redeems an authorization
  code (a token request with `grant_type` `'authorization_code'`) but never
  reads or compares any `iss`/`issuer` value: *"MCP clients MUST validate a
  present `iss` against the recorded issuer before redeeming the authorization
  code"* (RFC 9207). Deliberately conservative: any iss/issuer-named token
  counts as awareness, so only files that never touch the concept are flagged.
- **`AUTH_DCR_NO_APPLICATION_TYPE`** (SEP-837) — a registration body with
  `redirect_uris` + `client_name` but no `application_type` anywhere in the
  file: *"Require MCP clients to specify an appropriate `application_type`
  during Dynamic Client Registration."* The fix also notes DCR itself is now
  Deprecated in favour of Client ID Metadata Documents (changelog Deprecated
  item 4 — PR #2858; there is no SEP number for the deprecation).
- **`AUTH_CREDENTIALS_NOT_ISSUER_KEYED`** (SEP-2352) — persisted
  `client_id`/`client_secret` written to a store under a bare constant key or
  a server/resource-URL variable: *"clients MUST key persisted credentials by
  the issuer identifier, MUST NOT reuse them with a different authorization
  server, and MUST re-register when the authorization server changes."* A key
  mentioning iss/issuer is the migrated form and never flagged.

What deliberately stays clean: computed store keys and helper-indirected
redemptions (`oauth.authorizationCodeGrantRequest(...)`) are outside the recall
boundary — two new `adversarial/missed/` fixtures lock that honestly.

### Added — two probe checks (the `--spec 2026-07-28` suite is now twelve)

- **`dcr-still-advertised`** (WARN) — the authorization-server metadata
  (RFC 9728 protected-resource → RFC 8414 lookup, falling back to the MCP
  origin) still advertises `registration_endpoint` with no
  `client_id_metadata_document_supported` alternative.
- **`auth-metadata-missing-iss`** (WARN) — that metadata omits
  `authorization_response_iss_parameter_supported` (RFC 9207 / SEP-2468).
- Suite discipline is unchanged: stdio targets skip both (metadata is an HTTP
  concern), a server with no OAuth metadata is an inconclusive note, and a
  dead server is exit 2 — never a false violation. Both are gated behind
  `--spec`; plain `--spec-version 2026-07-28` behaves exactly as before.

### Changed — every docUrl repointed to the dated permalink

The dated URL `https://modelcontextprotocol.io/specification/2026-07-28/…`
404'd on release day (0.9.0 recorded that and cited `/specification/draft/`);
it resolves now (re-verified 2026-08-01, full final Key Changes list including
the three authorization paragraphs). Every rule docUrl now cites the dated
permalink — a `/draft/` URL silently drifts at the next revision — and a test
asserts no rule docUrl contains `/draft/`.

### Benchmark

Re-run on the same pinned corpus with the 21-rule engine: **247 findings,
244 true positives, 3 false positives (1.2%)**. The three new DCR findings in
the python-sdk examples are real (`client_name` + `redirect_uris` bodies with
no `application_type`); the one NEW false positive — a server-side
access-token cache keyed by `mcp_token`, which the credential-key heuristic
mistook for a client-credential store — is counted in BENCHMARK.md, not
suppressed. 88 tests (was 78), none skipped.

## [0.9.0]

The final-specification release. mcp-vet was built against the 2026-07-28
release candidate; the FINAL Key Changes list published 2026-07-28 at
<https://modelcontextprotocol.io/specification/draft/changelog> is materially
longer, so a clean 0.8.0 scan was a false all-clear. This release closes that
gap — every rule now cites a sentence pinned verbatim in
`docs/SPEC-2026-07-28.md`. (The dated URL
`/specification/2026-07-28` still returns 404; the final text is served under
`/specification/draft/`.)

### Added — seven BREAKING static rules (exit 1), in BOTH analyzers

- **`PING_REMOVED`** — `ping` in MCP method-registration context,
  `PingRequestSchema`, Python `types.PingRequest`. A `/ping` health route, a
  bare `'ping'` string, or a tool merely *named* ping stays clean.
- **`RESOURCE_SUBSCRIBE_REMOVED`** — `resources/subscribe`,
  `resources/unsubscribe`, `SubscribeRequestSchema`,
  `UnsubscribeRequestSchema`; the fix points at `subscriptions/listen` and its
  four opt-in types.
- **`ROOTS_LIST_CHANGED_REMOVED`** and **`LOGGING_SETLEVEL_REMOVED`** — a
  RECLASSIFICATION: 0.8.0 mapped `notifications/roots/list_changed` and
  `logging/setLevel` (+ their SDK schema constants) to the DEPRECATED
  capability rules, reporting two hard removals as exit-0 warnings with a
  grace-period label. They are BREAKING now; the `roots`/`logging` capability
  *keys* stay DEPRECATED, and a test locks the severity split.
- **`SSE_RESUMABILITY_REMOVED`** — the `Last-Event-ID` header string,
  `lastEventId`, and `eventStore`/`resumptionToken`/`onresumptiontoken` passed
  to a Streamable HTTP transport. Gated on file-level MCP context, so a plain
  SSE client stays clean (locked by `negatives/sse-client.ts`).
- **`ELICITATION_COMPLETE_REMOVED`** — `notifications/elicitation/complete`
  and the `elicitationId` field.
- **`ERROR_CODE_RENUMBERED`** — `-32001`/`-32003`/`-32004` → `-32020`/`-32021`/
  `-32022`, flagged ONLY in a JSON-RPC error `code` position (`code:` key,
  `*Error(...)` construction, comparison against `code`) — the changelog
  grandfathers `-32000..-32019` for implementation-defined codes, so a bare
  negative constant is never flagged.

### Added — two DEPRECATED static rules (exit 0)

- **`INCLUDE_CONTEXT_VALUES`** — `includeContext` set to `"thisServer"` /
  `"allServers"` (medium; removal "Follows Sampling").
- **`OAUTH_DCR`** — RFC7591 dynamic-client-registration surfaces
  (`registration_endpoint`, `registration_access_token`,
  `client_id_issued_at`) in favour of Client ID Metadata Documents (medium).

### Added — probe & fixtures

- Four checks join the opt-in `mcp-vet probe --spec 2026-07-28` suite (now ten):
  **`missing-result-type`** (ERROR, SEP-2322), **`missing-cacheable-fields`**
  (WARN, SEP-2549 `ttlMs` + `cacheScope`), **`legacy-error-code-renumbered`**
  (ERROR — still answering `-32001`/`-32003`/`-32004`), and
  **`ping-still-answered`** (WARN — `ping` returns a result instead of
  `-32601`). All cross-checked: a dead or non-MCP server is exit 2, never a
  false violation, and every inconclusive outcome is a note.
- `mcp-vet fixtures` gains **`10-subscriptions-listen`** (opt-in +
  `io.modelcontextprotocol/subscriptionId` tagging + `resources/subscribe` →
  -32601) and **`11-mrtr`** (`resultType: "input_required"` + `inputRequests`,
  retry with `inputResponses`) — eleven fixtures total.
- `--fix` now rewrites the renumbered codes next to the existing `-32002` →
  `-32602` (same-length, column-anchored); `--dry-run` lists every rewrite.
- DEPRECATED findings now print the registry's exact removal window ("First
  revision released on or after 2027-07-28", "Follows Sampling") instead of a
  hardcoded 12 months.
- New `test/fixtures/dirty/` (TS + Python, one instance of every new pattern),
  migrated forms in `clean/`, new true-negatives, computed/split forms in
  `adversarial/missed/`. 78 tests (was 71), none skipped.
- BENCHMARK.md re-measured with the 18-rule engine on the same pinned corpus.

## [0.8.0]

Maintenance release — dependency and CI currency; no rule or probe changes.

### Changed

- Dropped `chalk` for a local colouriser; moved to `commander` 15,
  `ts-morph` 28, `@types/node` 26.
- CI tests on supported Node only (22/24/26); `engines.node` >= 22.
- `mcp-vet probe` lets the event loop drain instead of calling
  `process.exit()` — fixes an intermittent Windows libuv crash (0xC0000409)
  on process teardown.
- GitHub Actions moved to latest majors; Dependabot groups minor/patch and
  splits majors; the blocked TypeScript 7 major is ignored until the
  Compiler-API crash upstream clears; our own guards (npm-script-lens audit +
  allowlist drift, ts7-compat-guard, pnpm11-ci-guard) run against this repo.

## [0.7.0]

An opt-in `--spec 2026-07-28` compliance suite for `mcp-vet probe` — six
wire-level checks that run *in addition to* the existing ones, covering the
stateless-protocol requirements and the three newly-deprecated features. Purely
additive: no existing check changed, and plain `--spec-version 2026-07-28`
behaves exactly as before.

### Added

- **`--spec <version>`** on `mcp-vet probe` — a shorthand for `--spec-version`
  that ALSO runs the new compliance suite. `--spec 2026-07-28` vets against the
  2026-07-28 revision *and* adds the six checks below.
- **`stateless-no-session` (ERROR)** — sends a `tools/list` with no
  `Mcp-Session-Id` and flags a server that rejects it with a session error
  (sessions are removed, SEP-2567).
- **`stateless-no-init` (ERROR)** — sends a `tools/list` with no
  `initialize`/`initialized` handshake and flags a server that rejects it as
  uninitialized (the handshake is removed, SEP-2575).
- **`required-headers` (ERROR)** — sends a request carrying the now-required
  `Mcp-Method` / `Mcp-Name` routing headers (Streamable HTTP) and flags a
  server that errors on them; skipped for stdio targets (no request headers).
- **`deprecated-sampling` (WARN)** — observes a server-initiated
  `sampling/createMessage` request. Sampling is deprecated in 2026-07-28 and
  eligible for removal July 2027; migrate to a direct LLM provider API.
- **`deprecated-roots` (WARN)** — flags a `roots/list` that returns a result
  (the roots capability is deprecated).
- **`deprecated-logging` (WARN)** — observes a server-emitted
  `notifications/message` (the MCP logging protocol is deprecated; migrate to
  stderr or OpenTelemetry).
- **`test/probe-fixtures/server-sessionful.mjs`** and
  **`server-deprecated.mjs`** — new stdio fixtures isolating a session
  requirement and the three deprecated features; 9 new tests (71 total),
  including proof that the suite is gated behind `--spec` (plain
  `--spec-version 2026-07-28` never runs it) and that a migrated server passes
  every new check.

### How it works

The suite runs on its own fresh connection(s) after the existing probe path
completes, so nothing above it changed. The prober's stdio/HTTP transports gain
an optional server-message observer (used to catch the deprecated
`sampling/createMessage` and `notifications/message` traffic) and per-request
header support (used to send `Mcp-Method`/`Mcp-Name`).

## [0.6.0]

The full 2026-07-28 compliance suite — `mcp-vet probe --spec-version 2026-07-28`
now covers all three breaking changes the release candidate makes to server
behavior, not just the removed handshake.

### Added

- **`missing-server-discover` (ERROR, `--spec-version 2026-07-28`)** — calls
  the `server/discover` RPC that every 2026-07-28 server MUST implement
  (SEP-2575; it replaces the removed initialize handshake for up-front
  capability discovery) and flags a server whose answer is an error, a hang, or
  a result missing the required `capabilities` key. The spec defines
  `server/discover` as JSON-RPC only — 2026-07-28 removes the HTTP GET
  endpoint, so no `GET /mcp/discover` variant is probed.
- **`legacy-resource-error-code` (ERROR, `--spec-version 2026-07-28`)** — reads
  a deliberately nonexistent resource URI (`mcp-vet://probe/...`) and flags a
  server that still answers `-32002` instead of the JSON-RPC standard `-32602`
  (Invalid Params). Servers without `resources/read` (`-32601`) are skipped,
  not flagged; unexpected codes are reported as inconclusive notes.
- **`mcp-vet run`** — an alias for `mcp-vet probe`.
- **`test/probe-fixtures/server-partial.mjs`** — a hybrid (handshake +
  stateless) fixture with exactly one migration defect per mode
  (`legacy-error-code` / `no-discover` / `bad-discover`), isolating each new
  rule; 7 new tests (62 total), including proof that the new checks are gated
  behind `--spec-version 2026-07-28` and the default probe is unchanged.

### Changed

- The stateless first request now sends the RC's exact namespaced `_meta` key
  `io.modelcontextprotocol/clientCapabilities` (was the incorrect
  `io.modelcontextprotocol/capabilities`); the stateless fixtures now *require*
  the namespaced keys, locking the wire format into the tests.
- The new checks run on whichever contact path succeeded (stateless or classic
  fallback), so a handshake-only legacy server gets its complete 2026-07-28
  migration report — handshake + discover findings — in a single probe.
- `ProbeResult` gains `discoverOk` and `errorCodeOk` verdict fields.

## [0.5.0]

The runtime-probe release — `mcp-vet probe` connects to a *running* MCP server
(stdio command or Streamable HTTP URL) and detects the two 2026-07-28 violation
categories that only exist on the wire, not in source.

### Added

- **`mcp-vet probe [options] <url | command...>`** — a runtime prober with two
  new violation categories, reported in the same JSON + SARIF formats as the
  static scan:
  - **`json-schema-dialect` (WARN)** — calls `tools/list` and inspects every
    tool's `inputSchema`/`outputSchema` (SEP-2106 lifts both to full JSON
    Schema 2020-12). Flags an explicit draft-04/-06/-07 (or 2019-09) `$schema`
    at high confidence, and — when `$schema` is absent — draft-only keyword
    forms (`definitions`, `$ref: "#/definitions/…"`, boolean
    `exclusiveMinimum`/`exclusiveMaximum`, array-form `items`, schema-form
    `dependencies`) at medium confidence. The walker recurses only into schema
    positions, so a *property* named `definitions` is never a false positive,
    and an explicit 2020-12 `$schema` is trusted.
  - **`requires-initialize-handshake` (ERROR)** — with
    `--spec-version 2026-07-28`, makes a stateless first request (no
    `initialize`; protocolVersion/clientInfo/capabilities travel in `_meta`
    per the RC) and flags a server that rejects it or hangs. Cross-checked:
    only emitted when the classic 2025-11-25 handshake path *does* work, so a
    dead server is an operational error (exit 2), never a false violation.
- **`--spec-version <2025-11-25|2026-07-28>`** (default `2025-11-25`) selects
  the revision to vet against; `--timeout <ms>` bounds each request and doubles
  as the hang-detection window; `--json` / `--sarif [file]` / `--fail-on` /
  `--quiet` / `--color` work as in the scan.
- **Runtime rules in SARIF** — probe rules join the driver metadata when they
  fire (`ERROR` → `error`, `WARN` → `warning`); the static-scan SARIF keeps its
  stable 9-rule shape.
- **`test/probe-fixtures/`** — minimal real MCP servers used by 18 new tests:
  `server-draft07.mjs` (explicit + inferable draft-07 tools, a modern 2020-12
  tool, and a property literally named `definitions`), `server-requires-init.mjs`
  (rejects pre-initialize requests with `-32002`), `server-stateless.mjs`
  (2026-07-28-native, requires `_meta`, no initialize), and `server-http.mjs`
  (Streamable HTTP, sessionful *and* stateless modes).
- Verified against the official `@modelcontextprotocol/server-everything@2026.7.4`:
  it answers stateless requests, but all of its tool schemas still declare
  draft-07 — `probe` reports 14 true `json-schema-dialect` findings.

## [0.4.0]

The community-feedback release — everything in it traces to reader comments on
the launch post (issues #1–#6). Static analysis got sharper, and the tool now
ships the runtime half it was honest about not covering.

### Added

- **Client-side session-ownership detection** (#1) — a client transport
  constructed with a real `sessionId`/`session_id` and reads of
  `transport.sessionId` are flagged (`MCP_SESSION_ID`, medium). The migrated
  `sessionId: undefined` / `session_id=None` forms are recognized as benign.
  Servers going stateless is only half the migration; clients that still behave
  as if they own a session break too.
- **Aliased-import resolution** (#2) — `import { InitializeRequestSchema as Init }`
  (TS) and `from mcp.types import RootsCapability as RC` (Python) now flag both
  the import line and the aliased usage sites. Python import lines surface
  imported names even when only the alias is used later.
- **Adversarial regression suite** (#3) — `test/fixtures/adversarial/` locks in
  what the scanner catches (`caught/`) *and* what it is known to miss
  (`missed/`, asserted zero findings): computed strings, computed capability
  keys, generated registration, framework adapters, cross-module renames.
- **`mcp-vet fixtures [dir]`** (#4) — emits nine protocol-level conformance
  fixtures + `CHECKLIST.md`: `server/discover`, per-request `_meta`,
  `Mcp-Method`/`Mcp-Name` routing headers (incl. mismatch rejection), stateless
  auth, task-handle lifecycle, duplicate deliveries, retry on another instance,
  `tools/list` cache invalidation, and downgrade/refusal behavior. Also exported
  programmatically (`CONFORMANCE_FIXTURES`, `emitConformanceFixtures`).
- **BENCHMARK.md** (#5) — the precision claim is now evidence: pinned corpus
  SHAs, 447 files / ~44k LOC, every finding labeled (105 findings, 104 TP,
  1 FP), labeled negatives, and an explicit recall discussion.

### Changed

- **Docs: spec-date semantics** (#6) — July 28 is a specification release, not
  a remote kill switch; breakage appears when a client/server pair negotiates
  the new revision. README and the post-scan notice now say so, and recommend
  the dual-version (2025-11-25 + 2026-07-28) rollout test matrix.
- The README "0 false positives" claim is replaced by the measured, reproducible
  numbers in BENCHMARK.md (1 FP in 44k LOC — an already-migrated negative
  assertion in test code).

## [0.3.0]

The completeness release — full detection coverage, a real migration path, and a
programmatic API. Informed by a deep audit of the spec and the codebase.

### Added

- **Two removed-method rules**: `TASKS_LIST_REMOVED` and `TASKS_RESULT_REMOVED`
  (both BREAKING). `tasks/list` and `tasks/result` are removed on 2026-07-28
  (SEP-2663); previously `tasks/list` was (incorrectly) treated as a non-issue.
- **Deprecated-capability *method* strings** — `roots/list`,
  `notifications/roots/list_changed`, `sampling/createMessage`, `logging/setLevel`,
  `notifications/message` are now flagged (SEP-2577 deprecates the methods, not just
  the capability keys), catching servers that reference them without a literal
  `capabilities` object nearby.
- **SDK schema-constant detection** — `server.setRequestHandler(InitializeRequestSchema, …)`
  and friends are how real SDK servers register handlers; these are now mapped to the
  right rule (previously only bare string literals matched — a major false negative).
- **SDK capability-constructor detection** — the Python SDK's
  `ClientCapabilities(roots=RootsCapability())` is now recognized structurally (high
  confidence, not proximity-medium), and `RootsCapability`/`SamplingCapability`/
  `LoggingCapability` are matched directly. (Found by validating against the official
  reference servers — a broad real-corpus run measured **0 false positives**.)
- **`--fix --dry-run`** — preview the rewrites `--fix` would make without touching files.
- **`sessionIdGenerator`** detection (value-aware) — flagged only when it is a real
  generator, not the migrated `sessionIdGenerator: undefined`.
- **`--fix`** — auto-applies the safe mechanical rewrites in place (`-32002` →
  `-32602`). Fixed findings are dropped from the report and the exit code.
- **`--json`** — prints findings as a JSON array to stdout (pure JSON; notices go to
  stderr), for piping in CI.
- **Programmatic API** — the package now exposes `main`/`types`/`exports` with
  bundled `.d.ts`: `scan`, `applyFixes`, `renderJson`/`renderMarkdown`/`renderSarif`,
  `RULES`, and the public types.
- **"Needs manual review" awareness** — changes that can't be found statically (SSE
  push-channel removal, required `Mcp-Method`/`Mcp-Name` headers, auth hardening,
  JSON Schema 2020-12 schemas) are documented and the CLI prints a reminder after
  every scan.
- Config JSON Schema (`schema/mcpvetrc.schema.json`), a tag-triggered `release.yml`
  with npm provenance, and README husky/pre-commit examples.

### Fixed

- **`--fix` file corruption on Python (multibyte lines)** — the bundled `ast`
  scanner emitted UTF-8 *byte* column offsets; on a line with non-ASCII characters
  autofix could rewrite an unrelated `-32002` inside a string. Columns are now
  character-accurate, and autofix requires an exact column match (no blind
  `indexOf` fallback).
- **`--fix` false success** — findings were marked fixed even when the file write
  failed; they are now only cleared after a successful write.
- **Config precedence** — a config-file `only` no longer silently cancels a CLI
  `--disable`; `--disable` always applies on top.
- Negative numeric literals are anchored consistently at the `-` across the TS and
  Python analyzers (correct SARIF regions and autofix positions).

### Changed

- Rule count is now 9 (was 7); SARIF advertises all 9 rules.

## [0.2.0]

The robustness and precision release. Everything below is covered by the test suite.

### Added

- **Confidence scoring** (`high` / `medium` / `low`) on every finding, plus
  `--min-confidence` to tune signal-to-noise. Capability findings are `high` only
  when the key is *structurally* inside a `capabilities` object (AST-verified),
  `medium` when merely near a `capabilities` mention. `initialize` is `high` only
  in a registration / `switch` / `req.method ===` context, `low` as a bare string.
- **SARIF 2.1.0 output** (`--sarif [file]`) for GitHub Advanced Security code
  scanning, with per-rule metadata, levels, and line/column regions.
- **Inline suppression**: `mcp-vet-disable-line`, `-next-line`, and `-file`
  comments, with optional pattern-id lists and a suppressed-count summary.
- **Rule selection & gating**: `--only`, `--disable`, and `--fail-on
  breaking|any|none`.
- **Config file** support (`.mcpvetrc.json` / `mcp-vet.config.json`) and a
  `.mcpvetignore` file; CLI flags override config.
- **Ignore globs** (`--ignore`, repeatable) and `--max-file-size`.
- **Richer findings**: column / end-column, `docUrl`, and the source analyzer
  (`ts-morph` / `python-ast` / `regex`) on every finding.
- Distinct **exit code `2`** for operational errors (bad path, bad config,
  invalid flag) — separate from `1` (findings tripped the gate).
- `--color` / `--no-color` and `--quiet`.

### Changed

- Python scanning runs in a **chunked subprocess** so one unparseable file can't
  sink the batch, with a **regex fallback** when no interpreter is present
  (`--no-py-fallback` to require the AST path).
- UTF-8 BOM and CRLF files are scanned with correct line numbers.
- Findings are de-duplicated per `(line, column, rule)`.

## [0.1.0]

Initial release.

- Detects the 7 patterns affected by the MCP `2026-07-28` specification: the
  `Mcp-Session-Id` header, the `initialize` / `notifications/initialized`
  handshake, the `-32002` error code, the legacy `tasks/get|update|cancel`
  methods, and the deprecated `roots` / `sampling` / `logging` capabilities.
- AST analysis for TypeScript / JavaScript (`ts-morph`) and Python (`ast`), a
  shared rule engine, and four report formats (terminal, Markdown, JSON, GitHub
  Actions annotations).

[0.3.0]: https://github.com/Booyaka101/mcp-vet/releases/tag/v0.3.0
[0.2.0]: https://github.com/Booyaka101/mcp-vet/releases/tag/v0.2.0
[0.1.0]: https://github.com/Booyaka101/mcp-vet/releases/tag/v0.1.0

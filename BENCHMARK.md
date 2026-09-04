# Benchmark: corpus, methodology, and honest limits

The README claims high precision on real MCP code. This file is the evidence
behind that claim — corpus, pinned commits, counts, labels, and what the
scanner is *known to miss* — so the claim is checkable rather than vibes.

> Prompted by community feedback on the launch post: *"'0 false positives' is
> encouraging but incomplete without corpus size, commit SHAs, labeled
> negatives, and recall."* Correct. Here they are.

## Corpus (pinned)

Originally scanned with `mcp-vet` v0.4.0 (re-scanned with v0.9.0 above) (`node dist/cli.js <roots> --json`), all rules
enabled, default confidence (`low`), on 2026-07-23:

| Repo | Commit | Scanned root | Files | LOC |
| --- | --- | --- | --- | --- |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | `d31124c982401739917fd817c2a59db344529c16` | `src/` | 78 | 14,742 |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | `1e1392e3f91583884fe82a0b4b91335875c3fba6` | `examples/` | 144 | 17,224 |
| [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk) | `3a6f2996cdd8358957479791e8b26198c07d6a75` | `examples/` | 225 | 12,013 |
| **Total** | | | **447** | **43,979** |

File counts are candidate files (`.ts/.tsx/.js/.mjs/.cjs/.py`) under the
scanned roots, excluding `node_modules`.

## Validation against real-world hand-rolled OAuth clients (v0.10.3)

The pinned corpus above is almost entirely **SDK-routed** code, so it cannot
exercise the auth-hardening rules: the SDKs satisfy the requirements for you.
The rules exist for clients that do OAuth **by hand**, so that population was
sampled separately — three MCP OAuth clients found via GitHub code search
(`mcp-use/mcp-use`, `greeves89/AI-Employee`, `ogx-ai/ogx`), each read against
source.

| | v0.10.2 | v0.10.3 |
| --- | --- | --- |
| Findings | 4 | 2 |
| True positives | 2 (both on the **wrong line**) | **2, correctly anchored** |
| False positives | 2 | **0** |

The exercise found three defects the 447-file corpus never surfaced:

1. **Wrong anchor line.** `AUTH_ISS_UNVALIDATED` reported the DCR body's
   `grant_types: ["authorization_code"]` at `ogx…:85`; the code is actually
   redeemed at `:143`. `AUTH_DCR_NO_APPLICATION_TYPE` reported an unposted
   local dict at `:58` instead of the posted body at `:83`. Both now anchor
   correctly.
2. **Server-side DCR read as client-side.** `AI-Employee`'s registration
   *endpoint* — which receives and stores an incoming client — was flagged
   under rules that constrain clients.
3. **Request-body population read as a credential store.**
   `data["client_secret"] = self.client_secret` at `ogx…:150`.

`ogx-ai/ogx` is the first real-world **`AUTH_ISS_UNVALIDATED` true positive**:
a hand-rolled `requests.post(token_endpoint, data={"grant_type":
"authorization_code", ...})` with no `iss` or `issuer` token anywhere in the
file — precisely the SEP-2468 MUST. The other two clients are `iss`-aware (12
and 9 mentions) and correctly stay clean.

Sample size is three files, so this is not a precision *rate* — it is evidence
that the rules work on the population they target, and that the SDK-heavy
corpus was systematically blind to a whole class of defect. Both wild false
positives are now regression fixtures (`negatives/server_dcr_handler.py`,
`auth/handrolled-client.py`).

## TS_SDK_V1 group — precision and measured recall (v0.14.0 → v0.15.0)

Run 2026-09-04, after 0.14.0 shipped. The pinned corpus above cannot exercise
this group at all: every repo in it declares `@modelcontextprotocol/sdk` ^1, so
`--ts-sdk auto` correctly suppresses the rules. Same blind spot the v0.10.3
OAuth exercise found, same fix — sample the population the rules actually
target.

### Precision: the SDK's own v2 examples

| Repo | Commit | Root | Files |
| --- | --- | --- | --- |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | `5119ee7fd7790e335a3fb60ef36f85334e2a6326` | `examples/` | 144 |

`examples/package.json` declares the full v2 set (`client`, `core`, `express`,
`fastify`, `hono`, `node`, `server`, `server-legacy`), so the gate resolves to
**v2** and the whole group is live. This is correct v2 code written by the SDK
authors, so every TS_SDK finding here would be a false positive.

**Result: 0 TS_SDK findings across 144 files. 0 false positives.** Re-verified
after the 0.15.0 rules were added: still 0.

That re-verification earned its keep. The first cut of `TS_SDK_V1_FINISH_AUTH`
flagged any single-argument `finishAuth()` call that did not mention `params`,
and produced **six false positives** here — `finishAuth(params)`,
`finishAuth(callbackParams)`, `finishAuth(await followAuthorize(...))`, all
passing `URLSearchParams` through a variable. The guide calls the two
one-argument forms "statically indistinguishable", so the rule was rewritten to
need positive evidence of a code string. Absence of the word "params" is not
evidence.

One near-miss worth recording: `examples/cli-client/host/host.ts` has a private
method `resolveResourceReference()` called three times. A substring matcher
would have produced three `TS_SDK_V1_RESOURCE_REF` false positives. The rule
keys on the (imported name, source module) pair, so a method name that merely
contains a v1 symbol never fires.

The 134 findings on that root are all pre-existing protocol rules
(`SSE_TRANSPORT_DEPRECATED` on the deliberate legacy-transport examples,
deprecated-capability method strings, and so on), unrelated to this group.

### Recall: measured against the codemod's own tables

The header of the recall section below says a corpus-wide recall percentage
would need "a labeled set of every legacy usage in the wild, which nobody has."
For **this group** that set does exist: the official
`@modelcontextprotocol/codemod` package ships the v1→v2 mappings as data, and
they are the reference implementation's own definition of what needs migrating.

Every entry was fed through mcp-vet as a synthetic file in a v2-declaring
project (`scripts/ts-sdk-recall.mjs`):

| Table (source) | Entries | Caught | Recall |
| --- | ---: | ---: | ---: |
| `mappings/symbolMap.ts` → `SIMPLE_RENAMES` | 9 | 4 | 44% |
| `mappings/contextPropertyMap.ts` → `CONTEXT_PROPERTY_MAP` | 10 | 9 | 90% |
| `mappings/importMap.ts` → `IMPORT_MAP` keys | 34 | 34 | **100%** |
| `transforms/removedApis.ts` → `REMOVED_ZOD_HELPERS` | 6 | 6 | **100%** |
| **Total** | **59** | **53** | **89.8%** |

Re-run after the 0.15.0 additions: **59/59, 100%.** Every row above is now a
HIT. `node scripts/ts-sdk-recall.mjs` reproduces it.

Import-path recall is 100% because `TS_SDK_V1_MONOLITH` is a catch-all on
`@modelcontextprotocol/sdk/…`; the two SSE paths are reported by
`SSE_TRANSPORT_DEPRECATED` instead, by design.

### The six misses, and one defect (all fixed in v0.15.0)

Symbol renames (5 of the 6 misses), all from `SIMPLE_RENAMES`:

| Missed symbol | v2 name |
| --- | --- |
| `JSONRPCErrorSchema` | `JSONRPCErrorResponseSchema` |
| `isJSONRPCError` | `isJSONRPCErrorResponse` |
| `isJSONRPCResponse` | `isJSONRPCResultResponse` |
| `JSONRPCResponse` | `JSONRPCResultResponse` |
| `JSONRPCResponseSchema` | `JSONRPCResultResponseSchema` |

The last two matter more than a rename. The codemod's own comment: v1's
`JSONRPCResponse` / `JSONRPCResponseSchema` validated only *result* responses,
and v2 reuses both names for the `result | error` union, so a migrated
`JSONRPCResponseSchema.parse(...)` **silently widens** to accept error
responses it used to reject. That is a compiles-clean, tests-pass behaviour
change, which is exactly the class this tool exists to catch.

Sixth miss: `extra.closeStandaloneSSEStream` → `ctx.http?.closeStandaloneSSE`,
the one entry of `CONTEXT_PROPERTY_MAP` not in `TS_EXTRA_PROPS`.

Three further gaps the tables surfaced that are not symbol lookups:

- **`completable(z.string().optional(), cb)`** — v2 resolves completion
  metadata after unwrapping the optional, so the v1 nesting registers it one
  level too deep. Per the codemod: completions come back empty and the server
  may stop advertising the capability. Compiles fine. No rule.
- **`client.request(req, SomeResultSchema)` / `callTool(..., Schema)`** — v2
  removes the schema parameter (`transforms/schemaParamRemoval.ts`).
  `TS_SDK_V1_SCHEMA_HANDLER` only covers `setRequestHandler` /
  `setNotificationHandler`. No rule.
- **`finishAuth(code)` with one argument** — stays type-correct, but the v2
  `iss` verification then has no input. The codemod emits an advisory. No rule.

And one **defect, not a gap**: `@modelcontextprotocol/sdk/experimental/tasks`
is `status: 'removed'` in `IMPORT_MAP` (SEP-2663, moved to the Extensions
Track, no v2 equivalent). `TS_SDK_V1_MONOLITH` falls through to its generic
detail and advises *"Import from the v2 package that owns the symbol instead"*
— pointing at a package that does not exist. Same generic fallback fires for
`inMemory.js`. Wrong advice is worse than no advice.

### Two rules the audit stopped from shipping

Both were on the plan; the source said otherwise. Both would have fired on
correct v2 code, which is the failure this project already has a scar from
(v0.10.0 → v0.10.1).

- **The "removed" runtime APIs.** A summary of the guide listed
  `Server.createMessage` / `listRoots` / `sendLoggingMessage`,
  `Client.setLoggingLevel` / `sendRootsListChanged` and `registerClient` under
  "Removed entirely". Grepping the v2 source found all five still present
  (`packages/server/src/server/server.ts:1042`, `:1278`, `:1294`;
  `packages/client/src/client/client.ts:1571`, `:2626`), and the guide files
  them under *Deprecated in v2 (SEP-2577)*: "still fully functional in v2 …
  The deprecation is annotation-only." The same grep caught a factual error in
  a message that had already shipped in 0.14.0, corrected in 0.15.0.
- **The schema argument to `client.request(req, ResultSchema)`.** The codemod
  removes it only for spec methods whose result type v2 infers from the method
  string; the guide shows the identical two-argument call as a "v1-identical
  passthrough" for custom methods. Not statically separable, so no rule.

### How large is the population today

GitHub code search, same day, `filename:package.json`:

| Query | Matching files |
| --- | ---: |
| `@modelcontextprotocol/sdk` (v1 monolith) | ~101,600 |
| `@modelcontextprotocol/server` | ~5,000 |
| `@modelcontextprotocol/client` | ~1,600 |

Order-of-magnitude only: code search counts files, not repos, indexes a subset,
and the v2 counts include the SDK monorepo, forks and `server-legacy`
substring hits. The shape is what matters — five weeks after the v2 release the
v1 population is roughly **twenty times** the v2 one. The group's audience is
small today and nearly all of it is still ahead, which is the argument for
closing the gaps above now rather than after the bulk of the migration.

## Results — v0.10.4 (22-rule engine, HTTP+SSE transport rule added)

Re-run 2026-08-09 with `mcp-vet` v0.10.4 on the SAME pinned corpus:
**258 findings across 68 files** — the 243 findings of the v0.10.2/0.10.3 run
plus **15 new `SSE_TRANSPORT_DEPRECATED` findings**. A byte-for-byte diff of
the non-SSE findings against the 0.10.3 run is **identical** — zero drift in
the other 21 rules.

Every new finding, hand-labeled against source (all 15 are true positives, 0
false positives):

| File | Findings | Label | What it is |
| --- | ---: | --- | --- |
| typescript-sdk `everything/transports/sse.ts` | 7 | **TP ×7** | the SDK's own legacy SSE transport example: `SSEServerTransport` import from `@modelcontextprotocol/sdk/server/sse.js` (class + module path on the import line) and five usage sites (type annotations, `transports.get(...) as SSEServerTransport`, `new SSEServerTransport("/message", res)`) |
| typescript-sdk `guides/clients/connect.examples.ts` | 2 | **TP ×2** | `SSEClientTransport` imported and passed to `client.connect(new SSEClientTransport(new URL(url)))` |
| python-sdk `clients/simple-auth-client/…/main.py` | 3 | **TP ×3** | `from mcp.client.sse import sse_client` (module path + helper name) and the `async with sse_client(...)` usage |
| python-sdk `snippets/clients/url_elicitation_client.py` | 3 | **TP ×3** | same shape: `from mcp.client.sse import sse_client` + usage |

Two findings each on the two Python import lines and the two TS import lines
are the documented column-level (not line-level) dedup: the module path and
the imported symbol are separate signals at separate columns.

So the v0.10.4 headline on this corpus is **256/258 true positives (2 FP,
0.8%)** — the two FPs are the pre-existing v0.9.0 pair, untouched. The
hand-rolled two-endpoint shape (`text/event-stream` + an `event: endpoint`
write) and the `transport="sse"` literal contribute zero corpus findings —
correctly, since the corpus's SSE usage is all SDK-routed — and their positive
behaviour is proven by `test/fixtures/sse/` instead (`handrolled-sse.ts`,
`fastmcp_sse.py`), with `negatives/streamable-http-server.ts` /
`negatives/streamable_http_server.py` / `negatives/plain_sse_feed.py` locking
that `text/event-stream` alone — which every correct Streamable HTTP server
contains — never fires.

## Results — v0.10.2 (21-rule engine, auth-hardening rules added)

Re-run 2026-08-01 with `mcp-vet` v0.10.2 on the SAME pinned corpus:
**243 findings across 66 files** — identical to the v0.9.0 run. By confidence:
100 high, 142 medium, 1 low.

| New pattern | Findings |
| --- | --- |
| `AUTH_ISS_UNVALIDATED` | 0 |
| `AUTH_DCR_NO_APPLICATION_TYPE` | 0 |
| `AUTH_CREDENTIALS_NOT_ISSUER_KEYED` | 0 |

**The three auth-hardening rules produce zero findings on this corpus, and that
is the correct result** — not a sign they do nothing. The official SDK examples
are already compliant: both SDKs supply `application_type`, the example clients
read `iss` from the callback, and the one apparent credential-store hit was an
authorization-server token cache. The rules are deliberately conservative, and
their positive behaviour is proven by fixtures instead — `test/fixtures/auth/`
(a hand-rolled registration + un-validated redemption → exactly 2 findings) and
`test/fixtures/dirty/` (all three, in both analyzers). A corpus of correct code
*should* be quiet; the fixtures are what stop that quiet from being vacuous.

> **Correction — v0.10.0 overstated this table.** 0.10.0 reported 247 findings
> and labeled three `AUTH_DCR_NO_APPLICATION_TYPE` hits in the python-sdk
> examples as *true* positives. They were false positives, and the rule was
> wrong, not just the label: both official SDKs supply `application_type` for
> you. python-sdk `src/mcp/shared/auth.py` defaults it on
> `OAuthClientMetadata` (*"SEP-837: OIDC application_type. Defaults to
> `"native"`…"*), and typescript-sdk
> `packages/client/src/client/auth.ts:902` derives it
> (`clientMetadata.application_type ?? deriveApplicationType(clientMetadata.redirect_uris)`).
> A body routed through either is already correct. 0.10.1 recognizes those SDK
> symbols and only flags a **hand-rolled** registration POST; the three corpus
> findings are gone, and the shapes are locked as true negatives
> (`negatives/sdk_dcr_defaults.py`, `negatives/sdk-dcr-defaults.ts`). The
> headline below is the corrected measurement.

Notes on the two rules that could have fired and correctly did not:

- `AUTH_CREDENTIALS_NOT_ISSUER_KEYED` flagged
  `servers/simple-auth/mcp_simple_auth/simple_auth_provider.py:217` in 0.10.0
  and 0.10.1 — `self.tokens[mcp_token] = AccessToken(…, client_id=…)`, an
  *authorization-server access-token cache* keyed by the token it just minted,
  not a client persisting registration credentials. It was counted as a false
  positive in both releases; **0.10.2 fixes the rule** (a token-shaped
  container or value is exempt unless the stored value carries a
  `client_secret` — only registration hands one out). Locked by
  `negatives/server_token_cache.py`.
- `AUTH_ISS_UNVALIDATED` produced **zero** corpus findings — correctly. The
  SDK example clients either read `iss` from the callback (`main.py`,
  `oauth_client.py` — the rule sees the token and stays quiet) or drive the
  exchange through SDK helpers with no `grant_type`/`authorization_code`
  literal in the file, which is the documented
  `adversarial/missed/auth-helper-indirection.ts` recall boundary.

So the v0.10.2 headline on this corpus is **241/243 true positives (2 FP,
0.8%)** — exactly the two v0.9.0 FPs, both unrelated to the new rules. The
auth-hardening rules added no false positives and no true positives here; the
precision improvement over 0.10.0's *reported* 1.2% is the removal of three
mislabeled findings and one genuine FP, not a change to the older rules.

## Results — v0.9.0 (18-rule engine, final 2026-07-28 changelog)

Re-run 2026-07-28 with `mcp-vet` v0.9.0 on the SAME pinned corpus:
**243 findings across 66 files** (was 105/41 with the 9-rule engine — the
final changelog's removals fire heavily on the SDKs' own pre-final examples).
By confidence: 100 high, 142 medium, 1 low.

| Pattern | Findings |
| --- | --- |
| `SSE_RESUMABILITY_REMOVED` | 65 |
| `MCP_SESSION_ID` | 49 |
| `ELICITATION_COMPLETE_REMOVED` | 44 |
| `RESOURCE_SUBSCRIBE_REMOVED` | 23 |
| `SAMPLING_CAP` | 16 |
| `LOGGING_CAP` | 16 |
| `ROOTS_CAP` | 10 |
| `ROOTS_LIST_CHANGED_REMOVED` | 5 |
| `INITIALIZE_HANDLER` | 4 |
| `PING_REMOVED` | 3 |
| `TASKS_LEGACY` | 2 |
| `TASKS_RESULT_REMOVED` | 2 |
| `OAUTH_DCR` | 2 |
| `ERROR_CODE_RENUMBERED` | 1 |
| `LOGGING_SETLEVEL_REMOVED` | 1 |

Labeling of the 138 NEW findings (spot-reviewed per category against source):

- **136 true positives.** The corpus repos genuinely implement the removed
  surfaces: the typescript-sdk `everything` example ships an
  `InMemoryEventStore` + `Last-Event-ID` resumability transport (all 65 SSE
  findings sit in those transport/resumability files), the elicitation examples
  register `notifications/elicitation/complete` handlers and read
  `elicitationId`, `everything/resources/subscriptions.ts` and friends register
  `SubscribeRequestSchema`/`UnsubscribeRequestSchema`, and the bearer-auth
  clients send `method: 'ping'`.
- **2 counted as false positives (honest reading):**
  `guides/serving/sessions-state-scaling.examples.ts:62` returns
  `code: -32001` for "Session not found" — an *implementation-defined* use the
  final policy grandfathers; static analysis cannot distinguish it from the
  renumbered `HeaderMismatch`, so ERROR_CODE_RENUMBERED flags it and we count
  it against ourselves. Plus the pre-existing `mcp-session-id` negative
  assertion (below). During this run a `registerTool('ping', ...)` false
  positive (a tool merely NAMED ping) was found and FIXED before release —
  strict registration context now excludes tool/prompt/resource registration
  calls, locked into `negatives/`.

So the v0.9.0 headline on this corpus is **241/243 true positives (2 FP,
0.8%)** — same discipline as before: FPs are counted, not defined away.

## Results — v0.4.0 (9-rule engine, release-candidate era)

**105 findings across 41 files** (TypeScript/JavaScript: 93, Python: 12).
By confidence: 66 high, 38 medium, 1 low.

| Pattern | Findings |
| --- | --- |
| `MCP_SESSION_ID` | 49 |
| `LOGGING_CAP` | 17 |
| `SAMPLING_CAP` | 16 |
| `ROOTS_CAP` | 15 |
| `INITIALIZE_HANDLER` | 4 |
| `TASKS_LEGACY` | 2 |
| `TASKS_RESULT_REMOVED` | 2 |

### Labeling

Every finding was manually reviewed against its source line:

- **104 / 105 true positives** — real references to a removed or deprecated
  protocol surface (session headers/ids, handshake registration, legacy task
  methods, deprecated capability declarations and method strings).
- **1 / 105 false positive (0.95%)** —
  `stories/json_response/client.py:62` in the typescript-sdk examples:
  `assert "mcp-session-id" not in response.headers`. That line is
  *already-migrated* test code asserting the header is **absent**; flagging it
  as "will break" is wrong. It is exactly what inline suppression
  (`# mcp-vet-disable-line MCP_SESSION_ID`) is for, but we count it as a false
  positive rather than defining it away. So the honest headline is
  **"1 false positive in 44k LOC"**, not zero.

Notes on reading the numbers:

- Two occurrences on one line (e.g. `transport.sessionId && sessions.delete(transport.sessionId)`)
  are reported as two findings — column-level dedup, not line-level.
- Findings in test files (`__tests__/…`) are counted as true positives: a test
  that registers `sampling/createMessage` breaks the same way production code
  does.

### Labeled negatives

Files asserted to stay **clean** are part of the repo's test suite and run in CI:

- `test/fixtures/clean/` — a full server written in the 2026-07-28 style
  (per-request `_meta`, `sessionIdGenerator: undefined`, `-32602`).
- `test/fixtures/negatives/` — "false friend" patterns: `sessionId` on plain
  app-level objects, `-32002` inside strings/comments, capability-like words
  with no capabilities context.
- `test/fixtures/adversarial/caught/` — obfuscations the scanner **must**
  catch: aliased imports (TS + Python), namespace-qualified SDK constants,
  client transports resuming a `sessionId`.

Additionally, in the corpus above, comment-only mentions (e.g. `Mcp-Session-Id`
in a comment, `initialize` in prose) produced zero findings — the AST layer
distinguishes executable tokens from comments by construction.

## Recall — what the scanner is known to miss

Static token analysis proves known patterns are **absent**; it cannot prove
your server **speaks the new wire contract**. Recall is bounded by
construction, and the misses are locked into the test suite
(`test/fixtures/adversarial/missed/`, asserted to produce zero findings so any
silent claim-inflation fails CI):

- split/computed method strings — `'tasks' + '/list'`, `` `tasks/${op}` ``, f-strings
- computed capability keys — `{ ['roo'+'ts']: {} }`
- generated/loop-driven registration from string fragments
- framework-adapter indirection (route tables built at runtime)
- cross-module renames — a wrapper re-exporting an SDK constant under a new
  name is flagged in the wrapper file, but a consumer importing only the new
  name scans clean on its own

There is no corpus-wide recall *percentage* for the protocol rules: that would
require a labeled set of every legacy usage in the wild, which nobody has. What
we can say is: for the pattern shapes listed in the README, detection is exact;
for the shapes above, it is zero, and the tool says so — pair the scan with
runtime checks (`mcp-vet fixtures`) to cover the difference.

The `TS_SDK_V1_*` group is the exception, and the only rule set here with a
measured recall number (**89.8%**, 53/59). It has a labeled set the protocol
rules do not: the official codemod ships the v1→v2 mappings as data. See the
v0.14.0 section above for the table and the six misses.

## Reproducing

Protocol-rule corpus:

```bash
git clone --depth 1 https://github.com/modelcontextprotocol/servers
git clone --depth 1 https://github.com/modelcontextprotocol/typescript-sdk
git clone --depth 1 https://github.com/modelcontextprotocol/python-sdk
# check out the pinned SHAs above, then:
npx @booyaka/mcp-vet servers/src typescript-sdk/examples python-sdk/examples --json --no-files
```

TS_SDK_V1 precision (expects zero TS_SDK findings on correct v2 code):

```bash
git clone https://github.com/modelcontextprotocol/typescript-sdk
git -C typescript-sdk checkout 5119ee7fd7790e335a3fb60ef36f85334e2a6326
npx @booyaka/mcp-vet typescript-sdk/examples --json --no-files
```

TS_SDK_V1 recall against the codemod's own mapping tables (prints 53/59):

```bash
npm run build && node scripts/ts-sdk-recall.mjs
```

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

## Results — v0.10.1 (21-rule engine, auth-hardening rules added)

Re-run 2026-08-01 with `mcp-vet` v0.10.1 on the SAME pinned corpus:
**244 findings across 67 files** — the 243 from v0.9.0 (unchanged) plus 1 from
the three new auth-hardening rules. By confidence: 100 high, 143 medium, 1 low.

| New pattern | Findings |
| --- | --- |
| `AUTH_CREDENTIALS_NOT_ISSUER_KEYED` | 1 |
| `AUTH_DCR_NO_APPLICATION_TYPE` | 0 |
| `AUTH_ISS_UNVALIDATED` | 0 |

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

Labeling of the 1 new finding:

- **1 false positive (counted, not suppressed):**
  `servers/simple-auth/mcp_simple_auth/simple_auth_provider.py:217` —
  `self.tokens[mcp_token] = AccessToken(…, client_id=…)`. That is a
  *server-side access-token cache* keyed by the token string, not a client
  persisting its registration credentials; SEP-2352 does not apply. The
  heuristic fired because the value carries a `client_id=` kwarg and the key
  variable `mcp_token` matches the server-ish key shape. Known and unfixed as
  of 0.10.1 — the FP goes in the table rather than getting defined away.
- `AUTH_ISS_UNVALIDATED` produced **zero** corpus findings — correctly. The
  SDK example clients either read `iss` from the callback (`main.py`,
  `oauth_client.py` — the rule sees the token and stays quiet) or drive the
  exchange through SDK helpers with no `grant_type`/`authorization_code`
  literal in the file, which is the documented
  `adversarial/missed/auth-helper-indirection.ts` recall boundary.

So the v0.10.1 headline on this corpus is **241/244 true positives (3 FP,
1.2%)** — the two v0.9.0 FPs carry over, plus the one above.

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

There is no corpus-wide recall *percentage*: that would require a labeled set
of every legacy usage in the wild, which nobody has. What we can say is: for
the pattern shapes listed in the README, detection is exact; for the shapes
above, it is zero, and the tool says so — pair the scan with runtime checks
(`mcp-vet fixtures`) to cover the difference.

## Reproducing

```bash
git clone --depth 1 https://github.com/modelcontextprotocol/servers
git clone --depth 1 https://github.com/modelcontextprotocol/typescript-sdk
git clone --depth 1 https://github.com/modelcontextprotocol/python-sdk
# check out the pinned SHAs above, then:
npx @booyaka/mcp-vet servers/src typescript-sdk/examples python-sdk/examples --json --no-files
```

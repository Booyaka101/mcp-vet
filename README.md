# mcp-vet

[![npm version](https://img.shields.io/npm/v/@booyaka/mcp-vet.svg)](https://www.npmjs.com/package/@booyaka/mcp-vet)
[![CI](https://github.com/Booyaka101/mcp-vet/actions/workflows/ci.yml/badge.svg)](https://github.com/Booyaka101/mcp-vet/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@booyaka/mcp-vet.svg)](https://nodejs.org)
[![license: MIT](https://img.shields.io/npm/l/@booyaka/mcp-vet.svg)](./LICENSE)

**On July 28, 2026 the Model Context Protocol ships its `2026-07-28` specification as final** — and it removes several things that today's MCP servers rely on. `mcp-vet` is a zero-config CLI that scans your MCP server source (TypeScript, JavaScript, and Python) for the exact patterns that will break client interop on that date, and tells you what to change.

- Official release candidate: <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- Protocol changelog: <https://tokenmix.ai/blog/mcp-updates-changelog-every-protocol-change-2026>

```bash
npx @booyaka/mcp-vet .
```

<p align="center">
  <img src="https://raw.githubusercontent.com/Booyaka101/mcp-vet/main/assets/demo.png" alt="mcp-vet scanning a server — BREAKING and DEPRECATED findings with before/after fixes and confidence tags" width="720">
</p>

No account, no API key — the scan parses your code locally (ts-morph for TS/JS, a bundled Python `ast` script for `.py`), makes no network calls, and exits non-zero if it finds anything **BREAKING**, so you can drop it straight into CI. (The opt-in [`mcp-vet probe`](#vet-a-running-server-mcp-vet-probe) is the one command that talks to a server — and only the one you point it at.)

## What actually happens on July 28

**July 28 is a specification release date, not a switch that remotely disables your deployment.** Nothing reaches into running servers and turns them off. Breakage appears when a **client and server pair negotiates or requires the new revision** — a client that sends `2026-07-28`-style requests (per-request `_meta`, no handshake, routing headers) against a server that still expects `2025-11-25` semantics, or vice versa.

Two practical consequences:

- **Your rollout is a window, not a day.** Until every client you care about has moved, keep **both** revisions in your production test matrix: a `2025-11-25` path and a `2026-07-28` path. `mcp-vet fixtures` emits wire-level test fixtures for exactly this (see [Runtime conformance fixtures](#runtime-conformance-fixtures)).
- **Silent acceptance is the worst failure mode.** A server that quietly processes an old-revision request under new semantics (or the reverse) corrupts behavior instead of failing loudly. Verify *refusal* behavior, not just the happy path.

The scan tells you *what to change in your source*; the date tells you *when clients start expecting it*.

---

## Real-world example

Pointed at the [official MCP TypeScript SDK's own example servers](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/examples), `mcp-vet` finds the patterns that the `2026-07-28` spec breaks:

```text
legacy-routing.ts:36:29  BREAKING   MCP_SESSION_ID [high]
    const sid = req.headers['mcp-session-id'] as string | undefined;
legacy-routing.ts:41:13  BREAKING   MCP_SESSION_ID [medium]
    sessionIdGenerator: () => randomUUID(),
legacy-routing.ts:70:26  BREAKING   MCP_SESSION_ID [high]
    exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate', ...]
sse-polling.ts:34:29     DEPRECATED LOGGING_CAP    [high]
    capabilities: { logging: {} }
sse-polling.ts:102:29    BREAKING   MCP_SESSION_ID [high]
    const sid = req.headers['mcp-session-id'] as string | undefined;
sse-polling.ts:107:13    BREAKING   MCP_SESSION_ID [medium]
    sessionIdGenerator: () => randomUUID(),

6 finding(s): 5 BREAKING, 1 DEPRECATED
```

Note it catches the `sessionIdGenerator` session usage — the real signal in SDK-based servers, which usually never write the literal `Mcp-Session-Id` string. And it stays quiet where it should: the `Mcp-Session-Id` mentioned in a *comment*, the `initialize` in a comment in `dual-era.ts`, and the `sampling/createMessage` in `sampling.ts` (which appears only in comments and behind the `requestSampling()` helper) are all left alone. That precision — structural AST checks, not text matching — is what keeps the noise down on a real codebase: **6 findings, 0 false positives on these files.** (Across the full labeled corpus it's 104/105 true positives — see [BENCHMARK.md](./BENCHMARK.md).)

---

## What it detects

### 🔴 BREAKING (fails the build — exit code 1)

| ID | Pattern |
| --- | --- |
| `MCP_SESSION_ID` | `Mcp-Session-Id` header / `mcpSessionId` variable / client-side session ownership (`sessionId` passed to or read from a client transport) |
| `INITIALIZE_HANDLER` | `initialize` / `notifications/initialized` handler registration |
| `ERROR_CODE_32002` | the numeric error code `-32002` |
| `TASKS_LEGACY` | `tasks/get` · `tasks/update` · `tasks/cancel` legacy method strings |
| `TASKS_LIST_REMOVED` | `tasks/list` — removed entirely (no replacement listing method) |
| `TASKS_RESULT_REMOVED` | `tasks/result` — removed; poll with `tasks/get` instead (SEP-2663) |

### 🟡 DEPRECATED (warns only — exit code 0, 12-month grace period)

| ID | Pattern |
| --- | --- |
| `ROOTS_CAP` | `roots` capability |
| `SAMPLING_CAP` | `sampling` capability |
| `LOGGING_CAP` | `logging` capability |

### Confidence

Every finding carries a **confidence** so you can tune signal-to-noise with `--min-confidence`:

- **high** — exact/deterministic match (session id, `-32002`, tasks methods), a structurally-verified capability (the `roots`/`sampling`/`logging` key is really *inside* a `capabilities` object), or an `initialize` string used as a method name (handler registration, `switch` case, or `req.method === 'initialize'`).
- **medium** — a `roots`/`sampling`/`logging` key/string within 5 lines of a `capabilities` mention but not structurally verified; a real `sessionIdGenerator`; client-side session ownership (`sessionId`/`session_id` passed to or read from a transport/client).
- **low** — a bare `'initialize'` string with no registration context.

---

## Before / after for each BREAKING pattern

### 1. `Mcp-Session-Id` — sessions are removed

> *"The `Mcp-Session-Id` header and the protocol-level session that came with it are also removed."*

```ts
// ❌ before
const sessionId = req.headers['Mcp-Session-Id'];
res.setHeader('Mcp-Session-Id', sessionId);

// ✅ after — no session header; client info & capabilities arrive in per-request _meta
function handle(req) {
  const meta = req.params?._meta ?? {};
  // route on meta, not on a session id
}
```

This cuts both ways — **client-side session ownership breaks too**, even against a server that scans clean. A lot of tool-reliability bugs only show up when the server is stateless but the client still behaves as if it owns a session:

```ts
// ❌ before — the client resumes a stored session
const transport = new StreamableHTTPClientTransport(url, { sessionId: stored });
persist(transport.sessionId);

// ✅ after — stateless: no stored session id, full _meta on every request
const transport = new StreamableHTTPClientTransport(url, { sessionId: undefined });
```

`mcp-vet` flags a client transport constructed with a real `sessionId`/`session_id` and reads of `transport.sessionId` (medium confidence). The migrated `sessionId: undefined` / `session_id=None` forms are recognized and left alone.

### 2. `initialize` / `notifications/initialized` — the handshake is removed

> *"The `initialize`/`initialized` handshake is removed. The protocol version, client info, and client capabilities that used to be exchanged once at connection time now travel in `_meta` on every request."*

```ts
// ❌ before
server.setRequestHandler('initialize', async (req) => ({ protocolVersion, capabilities }));
server.setNotificationHandler('notifications/initialized', () => {});

// ✅ after — read the handshake data from _meta on every request
function handle(req) {
  const { protocolVersion, clientInfo, capabilities } = req.params?._meta ?? {};
}
```

### 3. Error code `-32002` → `-32602`

> *"The error code for a missing resource changes from the MCP-custom `-32002` to the JSON-RPC standard `-32602` Invalid Params."*

```ts
// ❌ before
return { error: { code: -32002, message: 'Resource not found' } };

// ✅ after
return { error: { code: -32602, message: 'Invalid params' } };
```

This one is purely mechanical, so `mcp-vet --fix` rewrites it for you in place.

### 4. Legacy Tasks methods — redesigned to a handle-based lifecycle

> *"A server can answer `tools/call` with a task handle, and the client drives it with `tasks/get`, `tasks/update`, and `tasks/cancel`. Anyone who shipped against the `2025-11-25` experimental Tasks API will need to migrate to the new lifecycle."*

```ts
// ❌ before — legacy experimental argument shapes
switch (method) {
  case 'tasks/get':    return getTask(id);
  case 'tasks/update': return updateTask(id);
  case 'tasks/cancel': return cancelTask(id);
}

// ✅ after — tools/call returns a task handle; the same method names now carry
// the NEW argument shapes. mcp-vet flags every use for manual review against
// the 2026-07-28 schema.
```

### 5. `tasks/list` — removed entirely

> *"The `tasks/list` method is removed — it was unsafe once protocol-level sessions were gone. There is no replacement listing method."*

```ts
// ❌ before
case 'tasks/list': return listTasks();

// ✅ after — there is nothing to enumerate server-side. A client tracks the
// task handles it got back from its own tools/call responses.
```

---

## Needs manual review (not statically detectable)

`mcp-vet` catches every 2026-07-28 change that has a concrete code-level signal (a header, a method string, an error code, a capability key). A few changes are real but **can't be found reliably by static analysis** — they're architectural or depend on runtime wiring. A clean scan is not a promise that these are handled, so check them by hand:

- **The long-lived server→client SSE push channel is removed** — a server may only send requests to the client *while it is actively processing a client request*. Standing push streams / out-of-band notifications need rework.
- **Streamable HTTP now requires `Mcp-Method` and `Mcp-Name` headers** that mirror the JSON-RPC body; servers must reject requests where headers and body disagree.
- **Auth hardening** — validate the RFC 9207 `iss` parameter, declare OIDC `application_type` on Dynamic Client Registration, and bind tokens to the issuing authorization server.
- **Tool schemas may now be full JSON Schema 2020-12** (`oneOf`/`anyOf`/`$ref`/conditionals); do not auto-dereference external `$ref` URIs. The *dialect* half of this — schemas still declaring or using draft-07 forms — **is** detectable at runtime: [`mcp-vet probe`](#vet-a-running-server-mcp-vet-probe) checks it against your live server.

The CLI prints a one-line reminder of these after every scan.

## Runtime conformance fixtures

Static analysis proves known legacy patterns are *absent* from your source. Only wire-level tests prove your running server actually *speaks* the 2026-07-28 contract. `mcp-vet` ships both halves:

```bash
npx @booyaka/mcp-vet fixtures ./mcp-fixtures
```

writes nine ready-to-fire JSON fixtures plus a `CHECKLIST.md`, covering the runtime behaviors a linter cannot see:

1. `server/discover` replaces the initialize handshake
2. per-request `_meta` (protocolVersion, clientInfo, capabilities) — including explicit refusal when `_meta` is missing
3. `Mcp-Method` / `Mcp-Name` routing headers, including the header/body-mismatch rejection case
4. stateless auth context (no session-bound token cache)
5. task-handle lifecycle: creation, `tasks/get` polling, resume on another instance, `tasks/list` and `tasks/result` returning method-not-found
6. duplicate request delivery (idempotency under retries)
7. retry against a different server instance (no sticky in-memory state)
8. `tools/list` cache invalidation
9. downgrade/refusal: old-revision requests get an explicit error, never silent acceptance under the wrong semantics

Each fixture is a plain JSON description (`send` headers + JSON-RPC body, `expect` notes) you can replay with curl, supertest, pytest + httpx, or any HTTP harness. The checklist also spells out the **dual-version rollout matrix** — run both `2025-11-25` and `2026-07-28` paths until your clients have all moved — and a **client-side assumptions** list (session resume, per-request `_meta`, retries landing on other instances, `tools/list` revalidation).

## Vet a running server (`mcp-vet probe`)

Where the scan reads your *source*, `probe` talks to your *running server* over the wire — stdio (a command it spawns) or Streamable HTTP (a URL) — and checks the 2026-07-28 violations that only exist at runtime (`run` is an alias: `mcp-vet run …` ≡ `mcp-vet probe …`):

| ID | Severity | What it checks |
| --- | --- | --- |
| `json-schema-dialect` | 🟡 WARN | calls `tools/list` and inspects every tool's `inputSchema`/`outputSchema` for a pre-2020-12 JSON Schema dialect ([SEP-2106](https://modelcontextprotocol.io/seps/2106-json-schema-2020-12)) — an explicit draft-04/-06/-07 `$schema` (**high** confidence), or no `$schema` but draft-only keyword forms: `definitions` instead of `$defs`, `$ref: "#/definitions/…"`, boolean `exclusiveMinimum`/`exclusiveMaximum`, array-form `items` (**medium** confidence) |
| `requires-initialize-handshake` | 🔴 ERROR | with `--spec-version 2026-07-28`: makes a **stateless first request** — no `initialize`, protocolVersion/clientInfo/clientCapabilities in namespaced `_meta` keys per the RC — and flags a server that rejects it or hangs waiting for the removed handshake. A valid `tools` array in the answer is asserted, not just a 200 |
| `missing-server-discover` | 🔴 ERROR | with `--spec-version 2026-07-28`: calls the **`server/discover`** RPC that every 2026-07-28 server MUST implement ([SEP-2575](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575) — it replaces the handshake for up-front capability discovery) and flags a server whose answer is an error or lacks the required `capabilities` key. (The spec defines `server/discover` as JSON-RPC only — 2026-07-28 *removes* the HTTP GET endpoint, so there is no `GET /mcp/discover` to fall back to) |
| `legacy-resource-error-code` | 🔴 ERROR | with `--spec-version 2026-07-28`: reads a deliberately nonexistent resource URI and flags a server that still answers with the MCP-custom **`-32002`** instead of the JSON-RPC standard **`-32602`** (Invalid Params). Servers without `resources/read` (`-32601`) are skipped, not flagged |

```bash
# vet the schemas of a stdio server (spawns the command; a lone .js file runs with Node)
npx @booyaka/mcp-vet probe node ./dist/server.js

# full 2026-07-28 readiness: stateless first contact + server/discover +
# resource error code + schema dialects
npx @booyaka/mcp-vet probe --spec-version 2026-07-28 http://localhost:3000/mcp
```

```text
mcp-vet probe — node ./dist/server.js · spec 2026-07-28 · stdio · 12 tool(s) listed
  stateless probe: stateless tools/list was rejected: -32002 Server not initialized
  fallback probe: initialize handshake + tools/list succeeded
  server/discover: rejected (-32601)
  resource error-code check skipped — server does not implement resources/read (-32601)

ERROR  requires-initialize-handshake [high]
    The server rejected (or hung on) a stateless 2026-07-28-style first request ...
ERROR  missing-server-discover [high]
    The 2026-07-28 spec requires every server to implement the server/discover RPC ...
WARN   json-schema-dialect [high]
    tool "echo" inputSchema: $schema = http://json-schema.org/draft-07/schema# (draft-07)
```

The stateless verdict is **cross-checked** before it becomes a violation: `requires-initialize-handshake` is only emitted when the classic `2025-11-25` handshake path *does* work — a dead or non-MCP server is an operational error (exit 2), never a false violation. The `server/discover` and error-code checks then run on whichever contact path succeeded, so even a handshake-only server gets its complete migration report in one probe. The dialect walker recurses only into schema positions (applicators like `properties`/`allOf`), so a *property* literally named `definitions` is never mistaken for the draft-07 keyword, and an explicit 2020-12 `$schema` declaration is trusted.

### `--spec-version` — which revision to vet against

| Value | Behavior |
| --- | --- |
| `2025-11-25` *(default)* | today's stable contract: classic `initialize` handshake, then the `json-schema-dialect` check. **No 2026-07-28 assertions run** — a fully 2025-era server probes clean |
| `2026-07-28` | the full new-spec compliance suite: stateless first contact, required `server/discover`, `-32602` resource error code, plus the dialect check |

**Migration note.** The default stays `2025-11-25` so existing CI invocations keep their exact behavior — add the flag when *you* are ready, not when the spec ships. A practical rollout:

1. Today: `mcp-vet probe <server>` (unchanged) plus the static scan in CI.
2. When you start migrating: add a second CI job with `--spec-version 2026-07-28 --fail-on none` to *see* the new-spec violations without failing the build.
3. When your server targets `2026-07-28` (e.g. after moving to `@modelcontextprotocol/server` 2.x): drop `--fail-on none` so the three ERROR-level checks gate the build. A correctly migrated server passes all of them; the pre-migration server fails `requires-initialize-handshake` and `missing-server-discover` immediately.
4. Keep a `2025-11-25` probe in the matrix until every client you serve has moved (the rollout is a window, not a day — see [What actually happens on July 28](#what-actually-happens-on-july-28)).

### `--spec 2026-07-28` — the extra compliance suite

`--spec` is a shorthand for `--spec-version` that **also** runs six additional wire-level checks *on top of* the ones above. `--spec 2026-07-28` vets against the new revision **and** adds the suite; plain `--spec-version 2026-07-28` is unchanged and never runs it, so existing CI invocations keep their exact behavior.

```bash
# full readiness AND the extra compliance suite
npx @booyaka/mcp-vet probe --spec 2026-07-28 node ./dist/server.js
```

| ID | Severity | What it checks |
| --- | --- | --- |
| `stateless-no-session` | 🔴 ERROR | sends `tools/list` with **no** `Mcp-Session-Id` and flags a server that rejects it with a session error — sessions are removed on 2026-07-28 (SEP-2567), so a stateless request must be served |
| `stateless-no-init` | 🔴 ERROR | sends `tools/list` with **no** `initialize`/`initialized` handshake and flags a server that rejects it as uninitialized — the handshake is removed (SEP-2575); a compliant server answers the first request directly |
| `required-headers` | 🔴 ERROR | sends a request carrying the now-required `Mcp-Method` / `Mcp-Name` routing headers and flags a server that errors on them. Skipped for **stdio** targets (there are no request headers over stdio) |
| `deprecated-sampling` | 🟡 WARN | observes a server-initiated `sampling/createMessage` request. Sampling is deprecated in 2026-07-28 and **eligible for removal July 2027** — migrate to a direct LLM provider API |
| `deprecated-roots` | 🟡 WARN | flags a `roots/list` that returns a result — the roots capability is deprecated |
| `deprecated-logging` | 🟡 WARN | observes a server-emitted `notifications/message` — the MCP logging protocol is deprecated; migrate to stderr (stdio) or OpenTelemetry |

The two `stateless-*` checks are cross-checked the same way the rest of the probe is: a server that answers a stateless, session-less, handshake-less `tools/list` passes both; one that rejects it is classified by *why* — a `session` error trips `stateless-no-session`, an `uninitialized` error trips `stateless-no-init` (a session rejection trips both, since a sessionful server is also not answering the first request directly). The two `deprecated-sampling` / `deprecated-logging` checks watch for server→client traffic for a short window (up to the spec's 5 s, bounded by `--timeout`) and report only what the server actually sends — a server that never samples or logs stays clean. The suite runs on its own fresh connection after the standard probe completes, so the ERROR checks above are unaffected.

Probe findings use the same report formats as the scan: `--json` (machine-readable array on stdout) and `--sarif [file]` (SARIF 2.1.0 — `ERROR` maps to `error`, `WARN` to `warning`), plus `--fail-on breaking|any|none` (default `breaking`: exit 1 only on `ERROR`), `--timeout <ms>` (default 8000, also the hang-detection window), `--quiet`, and `--color`/`--no-color`.

Try it against the official reference server — the July 2026 `@modelcontextprotocol/server-everything` (beta 2026-07-28 SDK) answers stateless requests and already returns the new `-32602` resource error code, but it does not implement `server/discover` yet and its tool schemas still declare draft-07 — `probe` reports exactly that (1 ERROR, 13 WARN):

```bash
npx @booyaka/mcp-vet probe --spec-version 2026-07-28 npx -y @modelcontextprotocol/server-everything stdio
```

## Usage

```bash
npx @booyaka/mcp-vet [paths...]        # scan directories and/or files (default: current directory)
npx @booyaka/mcp-vet . --fix           # scan, and auto-apply the mechanical -32002 → -32602 rewrite
npx @booyaka/mcp-vet ./src ./packages  # multiple roots
npx @booyaka/mcp-vet server.py         # a single file
npx @booyaka/mcp-vet fixtures ./dir    # write runtime conformance fixtures + checklist (default: ./mcp-vet-fixtures)
npx @booyaka/mcp-vet probe <url|cmd>   # vet a RUNNING server's wire behavior (see section above; alias: run)
```

Globs `**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` and `**/*.py`, skipping `node_modules`, `.git`, `__pycache__`, `dist`, and `build`.

### Options

| Flag | Description |
| --- | --- |
| `--github-annotations` | emit GitHub Actions `::error` / `::warning` annotations to stdout |
| `--sarif [file]` | write a SARIF 2.1.0 report (default `mcp-vet.sarif`) for GitHub code scanning |
| `--out-dir <dir>` | where to write `mcp-vet-report.md` / `mcp-vet-results.json` (default: cwd) |
| `--no-files` | don't write the markdown/json report files |
| `--only <ids>` | only run these pattern ids (comma/space separated) |
| `--disable <ids>` | skip these pattern ids |
| `--fail-on <level>` | non-zero exit on `breaking` (default), `any`, or `none` |
| `--fix` | auto-apply the safe mechanical fixes in place (currently `-32002` → `-32602`) |
| `--dry-run` | with `--fix`: print the rewrites that would be made, without changing files |
| `--json` | print findings as a JSON array to stdout (pure JSON — notices go to stderr) |
| `--min-confidence <level>` | report only findings at/above `high`, `medium`, or `low` (default) |
| `--ignore <glob>` | ignore paths matching a gitignore-style glob (repeatable) |
| `--max-file-size <kb>` | skip files larger than N KB (default 1536; `0` = no limit) |
| `--no-py-fallback` | disable the regex fallback used when no Python interpreter is found |
| `--config <path>` | path to a config file (see below) |
| `--color` / `--no-color` | force or disable colored output |
| `--quiet` | suppress the human-readable terminal report |
| `-v, --version` | print version |

### Suppressing findings inline

Recognized in any comment style (`//` or `#`):

```ts
const x = -32002; // mcp-vet-disable-line ERROR_CODE_32002
// mcp-vet-disable-next-line
const y = 'Mcp-Session-Id';
```

- `mcp-vet-disable-line [IDS]` — suppress on the same line.
- `mcp-vet-disable-next-line [IDS]` — suppress on the following line.
- `mcp-vet-disable-file` — suppress the whole file.

Omitting the pattern ids suppresses **all** rules on that line/file; listing ids (e.g. `ERROR_CODE_32002`) suppresses only those.

### Config file

Drop a `.mcpvetrc.json` (or `mcp-vet.config.json`) in your project root; CLI flags override it.

```json
{
  "ignore": ["**/generated/**", "vendor/"],
  "disable": ["LOGGING_CAP"],
  "failOn": "breaking",
  "minConfidence": "medium",
  "maxFileSizeKb": 2048,
  "pythonFallback": true
}
```

You can also list ignore globs one-per-line in a `.mcpvetignore` file.

### Outputs

1. **Terminal** — compiler-style `file:line:col`, red for BREAKING, yellow for DEPRECATED, grouped by file, with before/after snippets and a `[confidence]` tag.
2. **`mcp-vet-report.md`** — a Markdown table (File · Line · Pattern · Severity · Confidence · Explanation).
3. **`mcp-vet-results.json`** — a structured JSON array of every finding (line, column, confidence, docUrl, before/after, source analyzer).
4. **`--github-annotations`** — native GitHub Actions annotations that surface inline on the PR diff.
5. **`--sarif`** — SARIF 2.1.0 for GitHub Advanced Security "code scanning" (uploads via `github/codeql-action/upload-sarif`).

### Exit codes

- `0` — clean, only DEPRECATED findings, or `--fail-on none`.
- `1` — findings that trip `--fail-on` (BREAKING by default).
- `2` — operational error (bad path, unreadable config, invalid flag/rule id).

---

## Use it in CI

```yaml
# .github/workflows/mcp-vet.yml
name: mcp-vet
on: [push, pull_request]
jobs:
  vet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx @booyaka/mcp-vet . --github-annotations
```

`setup-node` runners already include Python 3, which `mcp-vet` uses to scan `.py` files. If no interpreter is found, it automatically falls back to a regex scanner (reduced precision) unless you pass `--no-py-fallback`; TypeScript/JavaScript scanning is unaffected either way.

To upload results to GitHub code scanning instead:

```yaml
      - run: npx @booyaka/mcp-vet . --sarif mcp-vet.sarif --fail-on none
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: mcp-vet.sarif }
```

### Local git hooks

Catch it before it reaches CI. With [husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged):

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx,mjs,cjs,py}": "mcp-vet"
  }
}
```

Or with [pre-commit](https://pre-commit.com) (Python projects):

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: mcp-vet
        name: mcp-vet
        entry: npx @booyaka/mcp-vet
        language: system
        files: \.(ts|tsx|js|jsx|mjs|cjs|py)$
```

### Why there's no `--baseline`

Some linters let you "grandfather" existing findings so CI stays green. `mcp-vet` deliberately doesn't: this is a **one-time migration to a spec that ships on a fixed date**, and a suppressed finding is code that will break on July 28. The point is for the build to fail until it's actually fixed. For the rare intentional exception, use targeted [inline suppression](#suppressing-findings-inline) — an explicit, reviewable, per-line decision.

### Large repositories

`mcp-vet` skips `node_modules`, `.git`, `dist`, `build`, and `__pycache__` by default, chunks the Python subprocess, and takes `--max-file-size`. On a big monorepo, scope the scan to the packages that ship MCP servers (`mcp-vet ./packages/server ./services/mcp`) and add `--ignore` globs for generated code.

---

## How it works

- **TypeScript / JavaScript** — parsed with [`ts-morph`](https://ts-morph.com); the analyzer walks the AST and emits normalized tokens (string literals, signed numeric literals, identifiers, object keys) annotated with structural capability context and registration context.
- **Python** — a bundled script (`dist/python/mcp_ast_scan.py`) runs `ast.parse` + a context-tracking walk in a subprocess (chunked for large repos) and emits the same token shape (with character-accurate columns). When no interpreter exists, a regex fallback covers the deterministic rules.
- A single rule engine applies all 9 rules to those tokens, so TS and Python behave identically. Findings are de-duplicated per (line, column, rule) and can be suppressed inline.

It matches the ways real servers are actually written, not just raw method strings:

- **literal method strings** — `'tasks/list'`, `'sampling/createMessage'`, `'logging/setLevel'`, …
- **SDK schema-constant registration** — `server.setRequestHandler(InitializeRequestSchema, …)` (how the official SDKs register handlers) maps `InitializeRequestSchema`, `ListRootsRequestSchema`, `CreateMessageRequestSchema`, `SetLevelRequestSchema`, `ListTasksRequestSchema`, `GetTaskResultRequestSchema`, … to the right rule.
- **SDK capability constructors** — the Python SDK's `ClientCapabilities(roots=RootsCapability())` is recognized structurally (high confidence), and `RootsCapability` / `SamplingCapability` / `LoggingCapability` are matched directly.
- **`sessionIdGenerator`** — flagged only when it's a real generator, not the migrated `sessionIdGenerator: undefined`.
- **aliased imports** — `import { InitializeRequestSchema as Init }` (TS) and `from mcp.types import RootsCapability as RC` (Python) are resolved back to their canonical names, so both the import line and the aliased usage sites are flagged. Namespace access (`types.InitializeRequestSchema`) is matched too.
- **client-side session ownership** — a client transport constructed with a real `sessionId`/`session_id`, or a read of `transport.sessionId`; the migrated `sessionId: undefined` / `session_id=None` forms are recognized as benign.

**Measured, not vibes:** scanned against the official MCP reference servers and both SDK example suites at pinned commits — 447 files / ~44k LOC — every finding manually labeled: **105 findings, 104 true positives, 1 false positive**. Corpus, commit SHAs, per-pattern counts, labeled negatives, and the recall discussion are in [BENCHMARK.md](./BENCHMARK.md).

### Known limitations

These are locked into the test suite as `test/fixtures/adversarial/missed/` — fixtures asserted to produce **zero** findings, so the claims below can't silently rot in either direction:

- **Split/computed method strings** — `"tasks" + "/list"`, `` `tasks/${op}` ``, or `f"tasks/{x}"` are not reconstructed.
- **Computed capability keys** — `{ ['roo'+'ts']: {} }` never exists as a single token.
- **Generated/loop-driven registration** — method tables assembled from string fragments at runtime.
- **Framework-adapter indirection** — routes built dynamically (`app.post('/rpc/' + ns + '/' + action, ...)`).
- **Cross-module renames** — a wrapper module re-exporting an SDK constant under a new name is flagged *in the wrapper file*, but a consumer importing only the new name scans clean on its own. Scan whole projects, not single files.
- **Python SDK decorator/method registration** — a handler wired purely as `@server.list_roots()` or a bare `session.list_roots()` call (with no capability declaration or method string in the file) is not matched, to avoid false positives on generic method names. The capability declaration in the same server is normally caught.
- The **regex fallback** (no Python interpreter) covers only the deterministic rules at reduced precision; install Python for full `.py` fidelity.

This is the recall boundary of static analysis: it proves known patterns are *absent*, not that the server *speaks the new wire contract*. Cover the difference with the [runtime conformance fixtures](#runtime-conformance-fixtures).

## Programmatic API

The scanner is usable as a library (typed) as well as a CLI — for editor extensions, custom CI steps, or migration harnesses:

```ts
import { scan, ALL_PATTERN_IDS, IgnoreMatcher, applyFixes } from '@booyaka/mcp-vet';

const result = scan(['./src'], {
  enabled: new Set(ALL_PATTERN_IDS),
  ignore: new IgnoreMatcher([]),
  maxFileSizeKb: 0,
  pythonFallback: true,
  minConfidence: 'low',
});

for (const f of result.findings) {
  console.log(`${f.file}:${f.line} ${f.severity} ${f.patternId}`);
}

// Apply the safe mechanical fixes:
applyFixes(result.findings);
```

Also exported: `renderJson` / `renderMarkdown` / `renderSarif`, `RULES`, and the `Finding` / `PatternId` / `Severity` / `Confidence` types.

## Requirements

- Node.js ≥ 18
- Python 3 (optional — only needed for full-precision `.py` scanning; `python`, `py`, or `python3` on `PATH`)

## Development

```bash
npm install      # installs deps and builds (via prepare)
npm run build    # tsc -> dist/ + copies the Python script
npm test         # builds, then runs the Node.js built-in test runner (62 tests)
```

Test fixtures live in `test/fixtures/` (dirty TS + Python servers, a `clean/` server with zero violations, `negatives/` true-negatives, a `confidence/` gradient, and `suppress/` cases). Runtime-probe fixtures live in `test/probe-fixtures/` — minimal stdio + Streamable-HTTP MCP servers: one returning draft-07 schemas, one requiring the initialize handshake, one fully migrated 2026-07-28-native (stateless + `server/discover` + `-32602`), and a `server-partial.mjs` with one deliberate migration defect per mode (`legacy-error-code` / `no-discover` / `bad-discover`).

## License

MIT — see [LICENSE](./LICENSE).

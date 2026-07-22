# mcp-vet

[![npm version](https://img.shields.io/npm/v/mcp-vet.svg)](https://www.npmjs.com/package/mcp-vet)
[![CI](https://github.com/Booyaka101/mcp-vet/actions/workflows/ci.yml/badge.svg)](https://github.com/Booyaka101/mcp-vet/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/mcp-vet.svg)](https://nodejs.org)
[![license: MIT](https://img.shields.io/npm/l/mcp-vet.svg)](./LICENSE)

**On July 28, 2026 the Model Context Protocol ships its `2026-07-28` specification as final** — and it removes several things that today's MCP servers rely on. `mcp-vet` is a zero-config CLI that scans your MCP server source (TypeScript, JavaScript, and Python) for the exact patterns that will break client interop on that date, and tells you what to change.

- Official release candidate: <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- Protocol changelog: <https://tokenmix.ai/blog/mcp-updates-changelog-every-protocol-change-2026>

```bash
npx mcp-vet .
```

No account, no API key, no network calls — it parses your code locally (ts-morph for TS/JS, a bundled Python `ast` script for `.py`) and exits non-zero if it finds anything **BREAKING**, so you can drop it straight into CI.

---

## Real-world example

Pointed at the [official MCP TypeScript SDK's own example servers](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/examples), `mcp-vet` finds the patterns that the `2026-07-28` spec breaks:

```text
legacy-routing.ts:36:29  BREAKING   MCP_SESSION_ID [high]
    const sid = req.headers['mcp-session-id'] as string | undefined;
legacy-routing.ts:70:26  BREAKING   MCP_SESSION_ID [high]
    exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate', ...]
sse-polling.ts:34:29     DEPRECATED LOGGING_CAP    [high]
    capabilities: { logging: {} }
sse-polling.ts:102:29    BREAKING   MCP_SESSION_ID [high]
    const sid = req.headers['mcp-session-id'] as string | undefined;

4 finding(s): 3 BREAKING, 1 DEPRECATED
```

And it stays quiet where it should — the `initialize` mentioned in a *comment* in `dual-era.ts`, and the `sampling/createMessage` **method** in `sampling.ts`, are not flagged, because only the `sampling` **capability declaration** is deprecated, not the method. That precision (structural AST checks, not text matching) is what keeps the noise down on a real codebase.

---

## What it detects

### 🔴 BREAKING (fails the build — exit code 1)

| ID | Pattern |
| --- | --- |
| `MCP_SESSION_ID` | `Mcp-Session-Id` header / `mcpSessionId` variable |
| `INITIALIZE_HANDLER` | `initialize` / `notifications/initialized` handler registration |
| `ERROR_CODE_32002` | the numeric error code `-32002` |
| `TASKS_LEGACY` | `tasks/get` · `tasks/update` · `tasks/cancel` legacy method strings |

### 🟡 DEPRECATED (warns only — exit code 0, 12-month grace period)

| ID | Pattern |
| --- | --- |
| `ROOTS_CAP` | `roots` capability |
| `SAMPLING_CAP` | `sampling` capability |
| `LOGGING_CAP` | `logging` capability |

### Confidence

Every finding carries a **confidence** so you can tune signal-to-noise with `--min-confidence`:

- **high** — exact/deterministic match (session id, `-32002`, tasks methods), a structurally-verified capability (the `roots`/`sampling`/`logging` key is really *inside* a `capabilities` object), or an `initialize` string used as a method name (handler registration, `switch` case, or `req.method === 'initialize'`).
- **medium** — a `roots`/`sampling`/`logging` key/string within 5 lines of a `capabilities` mention but not structurally verified.
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

---

## Usage

```bash
npx mcp-vet [paths...]        # scan directories and/or files (default: current directory)
npx mcp-vet ./src ./packages  # multiple roots
npx mcp-vet server.py         # a single file
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
      - run: npx mcp-vet . --github-annotations
```

`setup-node` runners already include Python 3, which `mcp-vet` uses to scan `.py` files. If no interpreter is found, it automatically falls back to a regex scanner (reduced precision) unless you pass `--no-py-fallback`; TypeScript/JavaScript scanning is unaffected either way.

To upload results to GitHub code scanning instead:

```yaml
      - run: npx mcp-vet . --sarif mcp-vet.sarif --fail-on none
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: mcp-vet.sarif }
```

---

## How it works

- **TypeScript / JavaScript** — parsed with [`ts-morph`](https://ts-morph.com); the analyzer walks the AST and emits normalized tokens (string literals, signed numeric literals, identifiers, object keys) annotated with structural capability context and registration context.
- **Python** — a bundled script (`dist/python/mcp_ast_scan.py`) runs `ast.parse` + a context-tracking walk in a subprocess (chunked for large repos) and emits the same token shape. When no interpreter exists, a regex fallback covers the deterministic rules.
- A single rule engine applies all 7 rules to those tokens, so TS and Python behave identically. Findings are de-duplicated per (line, column, rule) and can be suppressed inline.

## Requirements

- Node.js ≥ 18
- Python 3 (optional — only needed for full-precision `.py` scanning; `python`, `py`, or `python3` on `PATH`)

## Development

```bash
npm install      # installs deps and builds (via prepare)
npm run build    # tsc -> dist/ + copies the Python script
npm test         # builds, then runs the Node.js built-in test runner (18 tests)
```

Test fixtures live in `test/fixtures/` (dirty TS + Python servers, a `clean/` server with zero violations, `negatives/` true-negatives, a `confidence/` gradient, and `suppress/` cases).

## License

MIT — see [LICENSE](./LICENSE).

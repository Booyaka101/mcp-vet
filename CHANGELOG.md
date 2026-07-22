# Changelog

All notable changes to `mcp-vet` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

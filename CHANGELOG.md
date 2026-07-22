# Changelog

All notable changes to `mcp-vet` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/Booyaka101/mcp-vet/releases/tag/v0.2.0
[0.1.0]: https://github.com/Booyaka101/mcp-vet/releases/tag/v0.1.0

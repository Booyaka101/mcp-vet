# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **"Report a vulnerability"**
(Security → Advisories) on the repository, or by email to the maintainer listed in
`package.json`. Please do not open a public issue for a vulnerability.

We aim to acknowledge reports within a few days.

## Threat model

`mcp-vet` is a local, offline static analyzer. By design it:

- **Makes no network calls** — no telemetry, no account, no API keys.
- Reads source files under the paths you pass and, unless `--fix` is used, only
  **writes report artifacts** (`mcp-vet-report.md`, `mcp-vet-results.json`, and a
  SARIF file when requested) to the output directory.
- With `--fix`, edits matched source files in place (currently only the same-length
  `-32002` → `-32602` substitution). Run it on a clean working tree so changes are
  easy to review with `git diff`.

### Python analysis

For `.py` files, `mcp-vet` shells out to a bundled script (`dist/python/mcp_ast_scan.py`)
run by your local Python interpreter to parse code with the standard-library `ast`
module. It parses but never executes the scanned code. If no interpreter is present,
a pure-JS regex fallback is used (no subprocess).

## Supported versions

Fixes are released against the latest published version on npm.

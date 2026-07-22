# Contributing to mcp-vet

Thanks for helping developers survive the MCP `2026-07-28` migration.

## Development

```bash
npm install      # installs deps and builds (via the prepare script)
npm run build    # tsc -> dist/ + copies the bundled Python script
npm test         # builds, then runs the Node.js built-in test runner
```

- Node.js ≥ 18. Python 3 (`python`, `py`, or `python3` on `PATH`) is optional — only
  needed for full-precision `.py` scanning; a regex fallback covers the rest.
- No linter/formatter is enforced; match the surrounding style.

## Adding a detection rule

Every rule is data + one match branch, applied uniformly to TS and Python tokens:

1. Add the id to `PatternId` and `ALL_PATTERN_IDS` in `src/types.ts`.
2. Add a `RULES` entry (label, severity, explanation, before/after) in `src/rules.ts`.
3. Add a match branch in `applyRules` (match on `token.value` / `token.kind`).
4. For structural or context-based confidence, teach the analyzers to set the token
   flags (`inCapabilities`, `registration`) — see `src/ts-analyzer.ts` and
   `src/python/mcp_ast_scan.py`.
5. Add a fixture under `test/fixtures/` (a positive case, and a true-negative in
   `negatives/` for anything that looks similar but must NOT fire), and a test in
   `test/scan.test.mjs`.

If the fix is a safe, same-length mechanical substitution, add the id to `FIXABLE`
in `src/autofix.ts`; otherwise leave it manual.

## Ground rules

- **Precision matters more than recall.** A false positive erodes trust faster than a
  missed edge case. Prefer confidence tiers over dropping a signal.
- Every rule must cite the spec change it detects (link the RC post or the SEP).
- Keep it dependency-light and fully local — no network calls, no telemetry.
- Tests must pass on Windows and POSIX (mind BOM/CRLF and path separators).

## Reporting issues

Open an issue with a minimal code snippet, the command you ran, and the actual vs
expected finding. False positives and false negatives are the most valuable reports.

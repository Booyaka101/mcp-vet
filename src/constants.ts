import * as fs from 'node:fs';
import * as path from 'node:path';

export const SPEC_DATE = 'July 28, 2026';
export const SPEC_URL =
  'https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/';
/**
 * The FINAL 2026-07-28 changelog, at the DATED permalink. The dated URL 404'd
 * on release day (0.9.0 cited /specification/draft/) but resolves since —
 * re-verified 2026-08-01 with the full final Key Changes list. A /draft/ URL
 * silently drifts at the next revision, so a test asserts no rule cites one.
 * The exact sentences every rule cites are pinned in docs/SPEC-2026-07-28.md.
 */
export const CHANGELOG_URL = 'https://modelcontextprotocol.io/specification/2026-07-28/changelog';
/** Registry of Deprecated features — the source of truth for removal windows. */
export const DEPRECATED_REGISTRY_URL = 'https://modelcontextprotocol.io/specification/2026-07-28/deprecated';
export const SEP_2106_URL = 'https://modelcontextprotocol.io/seps/2106-json-schema-2020-12';
/** SEP-2468 — iss validation before redeeming the authorization code (RFC 9207). */
export const SEP_2468_URL = 'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2468';
/** SEP-837 — required application_type during Dynamic Client Registration. */
export const SEP_837_URL = 'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/837';
/** SEP-2352 — client credentials keyed by (and bound to) the issuing AS. */
export const SEP_2352_URL = 'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2352';
/** PR #2858 — DCR deprecated in favour of Client ID Metadata Documents (no SEP number). */
export const PR_2858_URL = 'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2858';
export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
/**
 * Agent Plugins 1.0 (GA in VS Code / Copilot CLI / the Copilot SDK and app on
 * 2026-08-12). The two canonical machine-readable schemas are vendored under
 * schemas/agent-plugins/1.0.0/ (fetched 2026-08-18) so `mcp-vet plugin`
 * validates offline; the skill-layout rules are spec prose, pinned verbatim in
 * schemas/agent-plugins/1.0.0/skill-layout.md.
 */
export const AGENT_PLUGINS_SPEC_URL = 'https://agent-plugins.org/specification';
export const AGENT_PLUGINS_PLUGIN_SCHEMA_URL =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const AGENT_PLUGINS_MCP_SCHEMA_URL =
  'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

/**
 * 2026-07-28 changes that are real but NOT reliably detectable by static token
 * analysis — surfaced to the user so the tool is honest about its scope rather
 * than implying "clean === fully migrated".
 */
export const MANUAL_REVIEW: string[] = [
  'the long-lived server→client SSE push channel is removed (a server may only send requests while handling one); subscriptions/listen replaces it',
  'every result must carry `resultType`, and the cacheable list results must carry `ttlMs` + `cacheScope` — `mcp-vet probe --spec 2026-07-28` checks a running server',
  'MRTR replaces server-initiated requests: return resultType "input_required" with inputRequests; the client retries with inputResponses (`mcp-vet fixtures` emits a fixture)',
  'Streamable HTTP now requires Mcp-Method and Mcp-Name headers that mirror the JSON-RPC body',
  'tool inputSchema/outputSchema may now be full JSON Schema 2020-12 (do not auto-dereference external $ref) — `mcp-vet probe <server>` checks the dialect of a running server',
];

/** Resolve the package version from package.json, tolerating layout differences. */
export function getVersion(): string {
  const candidates = [
    path.join(__dirname, '..', 'package.json'), // dist/ -> package.json
    path.join(__dirname, '..', '..', 'package.json'),
  ];
  for (const c of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(c, 'utf8'));
      if (pkg && typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* try next */
    }
  }
  return '0.0.0';
}

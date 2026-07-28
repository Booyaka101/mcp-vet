import * as fs from 'node:fs';
import * as path from 'node:path';

export const SPEC_DATE = 'July 28, 2026';
export const SPEC_URL =
  'https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/';
/**
 * The FINAL 2026-07-28 changelog. NOTE: the dated URL
 * https://modelcontextprotocol.io/specification/2026-07-28 still returns 404 as
 * of 2026-07-28 — the final text is served under /specification/draft/.
 * The exact sentences every rule cites are pinned in docs/SPEC-2026-07-28.md.
 */
export const CHANGELOG_URL = 'https://modelcontextprotocol.io/specification/draft/changelog';
/** Registry of Deprecated features — the source of truth for removal windows. */
export const DEPRECATED_REGISTRY_URL = 'https://modelcontextprotocol.io/specification/draft/deprecated';
export const SEP_2106_URL = 'https://modelcontextprotocol.io/seps/2106-json-schema-2020-12';
export const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * 2026-07-28 changes that are real but NOT reliably detectable by static token
 * analysis — surfaced to the user so the tool is honest about its scope rather
 * than implying "clean === fully migrated".
 */
export const MANUAL_REVIEW: string[] = [
  'the long-lived server→client SSE push channel is removed (a server may only send requests while handling one)',
  'Streamable HTTP now requires Mcp-Method and Mcp-Name headers that mirror the JSON-RPC body',
  'auth hardening: validate the RFC 9207 `iss` param, send OIDC `application_type`, bind tokens to the issuer',
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

import * as fs from 'node:fs';
import * as path from 'node:path';

export const SPEC_DATE = 'July 28, 2026';
export const SPEC_URL =
  'https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/';
export const CHANGELOG_URL =
  'https://tokenmix.ai/blog/mcp-updates-changelog-every-protocol-change-2026';

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

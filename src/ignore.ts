/**
 * Minimal gitignore-flavored glob matcher (no external deps). Supports `*`,
 * `**`, `?`, leading `/` anchoring, trailing `/`, and bare basename patterns.
 * Patterns and paths are matched in posix form.
 */
function compile(pattern: string): RegExp | null {
  let p = pattern.trim();
  if (!p || p.startsWith('#')) return null;
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  if (p.endsWith('/')) p = p.slice(0, -1);
  if (!p) return null;

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }

  const hasSlash = p.includes('/');
  const full =
    anchored || hasSlash ? `^${re}(?:/.*)?$` : `(?:^|/)${re}(?:/.*)?$`;
  try {
    return new RegExp(full);
  } catch {
    return null;
  }
}

export class IgnoreMatcher {
  private readonly regexes: RegExp[];

  constructor(patterns: string[]) {
    this.regexes = patterns.map(compile).filter((r): r is RegExp => r !== null);
  }

  get size(): number {
    return this.regexes.length;
  }

  matches(relPosixPath: string): boolean {
    return this.regexes.some((r) => r.test(relPosixPath));
  }
}

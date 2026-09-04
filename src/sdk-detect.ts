import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolve which major of the `mcp` Python SDK a project declares, from the
 * nearest manifest: `uv.lock` (exact, wins), `poetry.lock`, `pyproject.toml`
 * ([project] dependencies / [tool.poetry.dependencies]), `requirements*.txt`.
 *
 * The declared SPECIFIER is what gates the PY_SDK_V1 rules — a range like
 * `>=1.26` admits both majors on a fresh install, so it stays 'undetermined'
 * (rules run, findings annotated) rather than guessing.
 */

export type McpMajor = 'v1' | 'v2' | 'undetermined' | 'none';

export interface SdkDetection {
  major: McpMajor;
  /** the specifier or locked version that decided it, e.g. ">=2.1" or "2.1.1 (locked)" */
  specifier?: string;
  /** manifest file the answer came from, relative-friendly basename */
  source?: string;
  /** true when the project declares httpx (not httpx2) as a DIRECT dependency */
  httpxDeclared: boolean;
}

/** Classify a PEP 508 / poetry version constraint into a declared major. */
export function classifySpecifier(spec: string): 'v1' | 'v2' | 'undetermined' {
  const s = spec.trim();
  if (!s) return 'undetermined';
  // poetry shorthand: ^2.0 / ~1.9
  const caret = s.match(/^[\^~]\s*(\d+)/);
  if (caret) return Number(caret[1]) >= 2 ? 'v2' : 'v1';
  const clauses = s
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  let lower2 = false;
  let capped1 = false;
  for (const c of clauses) {
    const m = c.match(/^(==|~=|>=|<=|>|<|!=)?\s*v?(\d+)(?:\.(\d+))?(?:\.[\dab.*rc]+)?/);
    if (!m) continue;
    const op = m[1] ?? '==';
    const major = Number(m[2]);
    const minor = m[3] === undefined ? undefined : Number(m[3]);
    if (op === '==' || op === '~=') return major >= 2 ? 'v2' : 'v1';
    if ((op === '>=' || op === '>') && major >= 2) lower2 = true;
    // An upper bound caps the project to v1 only when nothing in 2.x can
    // satisfy it: <2, <2.0, or <=1.x. `<2.5` still admits 2.0-2.4.
    if (op === '<' && (major < 2 || (major === 2 && (minor === undefined || minor === 0)))) capped1 = true;
    if (op === '<=' && major < 2) capped1 = true;
  }
  if (capped1) return 'v1';
  if (lower2) return 'v2';
  return 'undetermined';
}

function readIfFile(p: string): string | null {
  try {
    if (fs.statSync(p).isFile()) return fs.readFileSync(p, 'utf8');
  } catch {
    /* absent */
  }
  return null;
}

/** `[[package]] name = "mcp" ... version = "x.y.z"` from a uv/poetry lock. */
function lockVersion(text: string, pkg: string): string | null {
  const re = new RegExp(
    `\\[\\[package\\]\\]\\s*\\n(?:[^\\[]*?)name\\s*=\\s*"${pkg}"(?:[^\\[]*?)version\\s*=\\s*"([^"]+)"`,
  );
  const m = text.match(re);
  if (m) return m[1];
  // poetry.lock orders name before version too, but tolerate the reverse.
  const re2 = new RegExp(
    `\\[\\[package\\]\\]\\s*\\n(?:[^\\[]*?)version\\s*=\\s*"([^"]+)"(?:[^\\[]*?)name\\s*=\\s*"${pkg}"`,
  );
  const m2 = text.match(re2);
  return m2 ? m2[1] : null;
}

/** The specifier for `dep` out of a requirements.txt body, or null. */
function requirementsSpecifier(text: string, dep: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/);
    if (!m) continue;
    if (m[1].toLowerCase() !== dep) continue;
    return (m[3] ?? '').split(';')[0].trim();
  }
  return null;
}

/**
 * The specifier for `dep` out of pyproject.toml, or null. Dependency-free,
 * line-based TOML reading: PEP 621 `dependencies = [...]` arrays (including
 * multi-line) and poetry's `dep = "^2.0"` / `dep = { version = "^2.0" }`.
 */
function pyprojectSpecifier(text: string, dep: string): string | null {
  // Any string element naming the dep, with optional extras and constraint.
  const arrayItem = new RegExp(`["']${dep}(?:\\[[^\\]]*\\])?\\s*([^"']*)["']`, 'i');
  let inPoetryDeps = false;
  let inDepsArray = false;
  let inDepTable = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inPoetryDeps = /^\[tool\.poetry\.(group\.[^.\]]+\.)?dependencies\]/.test(line);
      inDepTable = /^\[(project\.optional-dependencies|dependency-groups)\]/.test(line);
      inDepsArray = false;
      continue;
    }
    if (inPoetryDeps) {
      const m = line.match(new RegExp(`^${dep}\\s*=\\s*(.*)$`, 'i'));
      if (m) {
        const v = m[1].trim();
        const str = v.match(/^["']([^"']*)["']/);
        if (str) return str[1];
        const tbl = v.match(/version\s*=\s*["']([^"']*)["']/);
        if (tbl) return tbl[1];
        return '';
      }
      continue;
    }
    // PEP 621 `dependencies = [`, any array inside
    // [project.optional-dependencies] (extras are named freely, e.g.
    // `server = ["mcp>=2.1"]`) and PEP 735 [dependency-groups], possibly
    // spanning lines. A bare "mcp" in keywords = [...] must not count, so
    // only elements inside a dependency array are read.
    const opensArray = inDepTable
      ? /^[\w.-]+\s*=\s*\[/.test(line)
      : /^[\w-]*dependencies\s*=\s*\[/.test(line);
    // `inDepsArray` alone, not `inDepsArray && line`: a blank line inside a
    // multi-line array is legal TOML and must not end the array early. Table
    // headers reset it above, and the closing `]` resets it below.
    if (opensArray || inDepsArray) {
      inDepsArray = !/\]/.test(line);
      const a = line.match(arrayItem);
      if (a) return (a[1] ?? '').trim();
    }
  }
  return null;
}

interface ManifestDir {
  dir: string;
  files: string[];
}

const isPyManifest = (n: string): boolean =>
  n === 'pyproject.toml' ||
  n === 'uv.lock' ||
  n === 'poetry.lock' ||
  /^requirements[^/\\]*\.txt$/i.test(n);

const isTsManifest = (n: string): boolean =>
  n === 'package.json' || n === 'package-lock.json' || n === 'pnpm-lock.yaml' || n === 'yarn.lock';

/**
 * The nearest ancestor of `startDir` (inclusive) containing any manifest
 * `accept`s. The walk stops at a repository boundary (a directory holding
 * `.git`) after checking it: past that point a manifest belongs to some
 * unrelated parent — a home directory, a monorepo sibling — and letting it
 * decide whether the SDK migration rules run would be worse than
 * 'undetermined'.
 */
function findManifestDir(startDir: string, accept: (name: string) => boolean): ManifestDir | null {
  let dir = path.resolve(startDir);
  for (;;) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      entries = [];
    }
    const files = entries.filter(accept);
    if (files.length) return { dir, files };
    if (entries.includes('.git')) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const cache = new Map<string, SdkDetection>();
const tsCache = new Map<string, TsSdkDetection>();

/** Test hook: detection results are cached per directory for the process lifetime. */
export function clearSdkDetectionCache(): void {
  cache.clear();
  tsCache.clear();
}

/**
 * Detect the declared mcp major for a Python file living in `startDir`.
 * Locked versions win over declared ranges; a manifest that never names mcp
 * yields 'none' (the scanner annotates findings the same as 'undetermined').
 */
export function detectMcpSdk(startDir: string): SdkDetection {
  const key = path.resolve(startDir);
  const hit = cache.get(key);
  if (hit) return hit;

  const result: SdkDetection = { major: 'undetermined', httpxDeclared: false };
  const found = findManifestDir(key, isPyManifest);
  if (!found) {
    cache.set(key, result);
    return result;
  }
  result.major = 'none';

  const has = (n: string) => found.files.includes(n);
  const read = (n: string) => readIfFile(path.join(found.dir, n));

  // Direct-declaration files decide httpxDeclared (lockfiles list transitives —
  // v1's mcp pulls httpx in transitively, which must not count).
  const declFiles = found.files.filter((n) => n !== 'uv.lock' && n !== 'poetry.lock');
  for (const n of declFiles) {
    const text = read(n);
    if (!text) continue;
    const spec = n === 'pyproject.toml' ? pyprojectSpecifier(text, 'httpx') : requirementsSpecifier(text, 'httpx');
    if (spec !== null) result.httpxDeclared = true;
  }

  for (const lock of ['uv.lock', 'poetry.lock']) {
    if (!has(lock)) continue;
    const text = read(lock);
    if (!text) continue;
    const v = lockVersion(text, 'mcp');
    if (v) {
      const major = parseInt(v, 10);
      result.major = major >= 2 ? 'v2' : 'v1';
      result.specifier = `${v} (locked)`;
      result.source = lock;
      cache.set(key, result);
      return result;
    }
  }

  for (const n of declFiles.sort((a, b) => (a === 'pyproject.toml' ? -1 : b === 'pyproject.toml' ? 1 : a.localeCompare(b)))) {
    const text = read(n);
    if (!text) continue;
    const spec = n === 'pyproject.toml' ? pyprojectSpecifier(text, 'mcp') : requirementsSpecifier(text, 'mcp');
    if (spec === null) continue;
    result.major = classifySpecifier(spec);
    result.specifier = spec || '(no constraint)';
    result.source = n;
    cache.set(key, result);
    return result;
  }

  cache.set(key, result);
  return result;
}

// --- TypeScript SDK v1→v2 resolution (0.14.0) ------------------------------

/**
 * Which family of MCP TypeScript SDK packages a project declares.
 * 'half' means it declares BOTH the v1 monolith and at least one v2 package —
 * a staged migration, which the guide explicitly supports ("both v1 and v2
 * packages can coexist in one manifest by their distinct names"). The rules
 * run for 'half': the leftover v1 surface is exactly what is worth reporting.
 */
export type TsMajor = 'v1' | 'v2' | 'half' | 'undetermined' | 'none';

export interface TsSdkDetection {
  major: TsMajor;
  /** the range or locked version that decided it, e.g. "^1.19.0" or "1.30.0 (locked)" */
  specifier?: string;
  /** manifest file the answer came from, e.g. "package.json" */
  source?: string;
  /** the declared `zod` range, when the project declares zod directly */
  zodSpecifier?: string;
  /** true when the declared zod range admits a version below 4.2.0 (the v2 floor) */
  zodBelowFloor: boolean;
}

/** The v2 packages that replaced the monolith. Any one of them means v2. */
export const TS_V2_PACKAGE_NAMES = [
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/core',
];
const TS_V1_PACKAGE_NAME = '@modelcontextprotocol/sdk';

/**
 * The lowest version an npm range admits, as [major, minor, patch], or null
 * when the range names no version at all (`*`, `latest`, `workspace:*`, a git
 * or file specifier). Used both to read a declared SDK major and to decide
 * whether a zod range dips below the v2 floor, so the two questions share one
 * parser rather than two near-identical ones.
 */
export function npmRangeFloor(range: string): [number, number, number] | null {
  const raw = range.trim();
  if (!raw || /^(\*|x|latest|next|[a-z+]+:)/i.test(raw)) return null;
  let lowest: [number, number, number] | null = null;
  for (const alt of raw.split('||')) {
    const floor = altFloor(alt.trim());
    if (!floor) continue;
    if (!lowest || cmp(floor, lowest) < 0) lowest = floor;
  }
  return lowest;
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The floor of a single comparator set (`>=1.2.0 <2`, `^4.2.0`, `1.2.3 - 2.0.0`). */
function altFloor(alt: string): [number, number, number] | null {
  const hyphen = alt.match(/^(\S+)\s+-\s+\S+$/);
  const text = hyphen ? hyphen[1] : alt;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\^|~>?|>=|>|<=|<|=|v)?\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/);
    if (!m) continue;
    const op = m[1] ?? '';
    // An upper bound alone puts no floor above zero: `<2.0.0` admits 0.0.0.
    if (op === '<' || op === '<=') return [0, 0, 0];
    const num = (part: string | undefined): number => {
      if (part === undefined || /^[xX*]$/.test(part)) return 0;
      return Number(part);
    };
    if (/^[xX*]$/.test(m[2])) return [0, 0, 0];
    return [num(m[2]), num(m[3]), num(m[4])];
  }
  return null;
}

/** The declared range for `dep` across every dependency block of a package.json. */
function packageJsonRange(pkg: any, dep: string): string | null {
  if (!pkg || typeof pkg !== 'object') return null;
  for (const block of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const table = pkg[block];
    if (table && typeof table === 'object' && typeof table[dep] === 'string') return table[dep];
  }
  return null;
}

/** The resolved version of `dep` out of a package-lock.json (v1, v2 and v3 layouts). */
function packageLockVersion(text: string, dep: string): string | null {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const fromPackages = json?.packages?.[`node_modules/${dep}`]?.version;
  if (typeof fromPackages === 'string') return fromPackages;
  const fromDeps = json?.dependencies?.[dep]?.version;
  return typeof fromDeps === 'string' ? fromDeps : null;
}

/**
 * The resolved version of `dep` out of a pnpm-lock.yaml or yarn.lock. Both are
 * read textually rather than parsed: the lock formats differ across major
 * versions (pnpm `/@scope/pkg/1.2.3:` before v9, `'@scope/pkg@1.2.3':` after)
 * and mcp-vet takes no YAML dependency for one version number.
 */
function textLockVersion(text: string, dep: string): string | null {
  const esc = dep.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const SEMVER = String.raw`(\d+\.\d+\.\d+[\w.+-]*)`;
  // pnpm v9+ keys and resolution entries: '@scope/pkg@1.2.3'
  const pnpmNew = text.match(new RegExp(String.raw`['"/]?` + esc + '@' + SEMVER));
  if (pnpmNew) return pnpmNew[1];
  // pnpm v6-v8 keys: /@scope/pkg/1.2.3:
  const pnpmOld = text.match(new RegExp('/' + esc + '/' + SEMVER));
  if (pnpmOld) return pnpmOld[1];
  // yarn.lock: the entry header, then an indented `version "1.2.3"`.
  const yarn = text.match(
    new RegExp(String.raw`^"?` + esc + String.raw`@[^\n]*:\n(?:\s+[^\n]*\n)*?\s+version\s+"([^"]+)"`, 'm'),
  );
  return yarn ? yarn[1] : null;
}

/** "@modelcontextprotocol/sdk@^1.19.0 + @modelcontextprotocol/server@^2.0.0" */
function joinDeclared(v1: string, v2: string[]): string {
  return [`${TS_V1_PACKAGE_NAME}@${v1 || '*'}`, ...v2].join(' + ');
}

const LOCK_READERS: Record<string, (text: string, dep: string) => string | null> = {
  'package-lock.json': packageLockVersion,
  'pnpm-lock.yaml': textLockVersion,
  'yarn.lock': textLockVersion,
};

/**
 * Detect which MCP TypeScript SDK family a .ts/.js file's project declares.
 *
 * package.json decides the family, because a declaration is an intent: the v1
 * monolith alone is 'v1', any v2 package is 'v2', both is 'half'. Lockfiles
 * only pin the version when the declared range names no major (`*`), or answer
 * on their own when package.json declares nothing MCP at all — in which case
 * the name may have arrived transitively, which is still the honest answer for
 * a file that imports the SDK.
 */
export function detectTsSdk(startDir: string): TsSdkDetection {
  const key = path.resolve(startDir);
  const hit = tsCache.get(key);
  if (hit) return hit;

  const result: TsSdkDetection = { major: 'undetermined', zodBelowFloor: false };
  const found = findManifestDir(key, isTsManifest);
  if (!found) {
    tsCache.set(key, result);
    return result;
  }
  result.major = 'none';

  const read = (n: string) => (found.files.includes(n) ? readIfFile(path.join(found.dir, n)) : null);

  let declaredV1: string | null = null;
  const declaredV2: string[] = [];
  const pkgText = read('package.json');
  if (pkgText) {
    let pkg: any;
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      pkg = null;
    }
    declaredV1 = packageJsonRange(pkg, TS_V1_PACKAGE_NAME);
    for (const name of TS_V2_PACKAGE_NAMES) {
      const range = packageJsonRange(pkg, name);
      if (range !== null) declaredV2.push(`${name}@${range || '*'}`);
    }
    const zod = packageJsonRange(pkg, 'zod');
    if (zod !== null) {
      result.zodSpecifier = zod || '(no constraint)';
      const floor = npmRangeFloor(zod);
      result.zodBelowFloor = floor !== null && cmp(floor, [4, 2, 0]) < 0;
    }
  }

  const lockedV1 = () => {
    for (const [name, reader] of Object.entries(LOCK_READERS)) {
      const text = read(name);
      if (!text) continue;
      const v = reader(text, TS_V1_PACKAGE_NAME);
      if (v) return { version: v, source: name };
    }
    return null;
  };

  if (declaredV1 !== null || declaredV2.length) {
    result.source = 'package.json';
    if (declaredV1 !== null && declaredV2.length) {
      result.major = 'half';
      result.specifier = joinDeclared(declaredV1, declaredV2);
    } else if (declaredV2.length) {
      result.major = 'v2';
      result.specifier = declaredV2.join(' + ');
    } else {
      const floor = npmRangeFloor(declaredV1!);
      if (floor) {
        result.major = floor[0] >= 2 ? 'v2' : 'v1';
        result.specifier = `${TS_V1_PACKAGE_NAME}@${declaredV1}`;
      } else {
        const locked = lockedV1();
        if (locked) {
          result.major = parseInt(locked.version, 10) >= 2 ? 'v2' : 'v1';
          result.specifier = locked.version + ' (locked)';
          result.source = locked.source;
        } else {
          result.major = 'undetermined';
          result.specifier = declaredV1! || '(no constraint)';
        }
      }
    }
    tsCache.set(key, result);
    return result;
  }

  for (const [name, reader] of Object.entries(LOCK_READERS)) {
    const text = read(name);
    if (!text) continue;
    const v2 = TS_V2_PACKAGE_NAMES.map((n) => [n, reader(text, n)] as const)
      .filter(([, v]) => v !== null)
      .map(([n, v]) => `${n}@${v}`);
    const v1 = reader(text, TS_V1_PACKAGE_NAME);
    if (!v1 && !v2.length) continue;
    result.source = name;
    if (v1 && v2.length) {
      result.major = 'half';
      result.specifier = joinDeclared(v1, v2) + ' (locked)';
    } else if (v2.length) {
      result.major = 'v2';
      result.specifier = v2.join(' + ') + ' (locked)';
    } else {
      result.major = parseInt(v1!, 10) >= 2 ? 'v2' : 'v1';
      result.specifier = v1 + ' (locked)';
    }
    break;
  }

  tsCache.set(key, result);
  return result;
}

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

/**
 * The nearest ancestor of `startDir` (inclusive) containing any Python
 * manifest. The walk stops at a repository boundary (a directory holding
 * `.git`) after checking it: past that point a manifest belongs to some
 * unrelated parent — a home directory, a monorepo sibling — and letting it
 * decide whether the PY_SDK_V1 rules run would be worse than 'undetermined'.
 */
function findManifestDir(startDir: string): ManifestDir | null {
  let dir = path.resolve(startDir);
  for (;;) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      entries = [];
    }
    const files = entries.filter(
      (n) => n === 'pyproject.toml' || n === 'uv.lock' || n === 'poetry.lock' || /^requirements[^/\\]*\.txt$/i.test(n),
    );
    if (files.length) return { dir, files };
    if (entries.includes('.git')) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const cache = new Map<string, SdkDetection>();

/** Test hook: detection results are cached per directory for the process lifetime. */
export function clearSdkDetectionCache(): void {
  cache.clear();
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
  const found = findManifestDir(key);
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

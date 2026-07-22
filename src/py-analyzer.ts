import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { Token } from './types';

let cachedPython: string | null | undefined = undefined;

/** Locate a usable Python 3 interpreter, trying platform-appropriate names. */
export function findPython(): string | null {
  if (cachedPython !== undefined) return cachedPython;
  if (process.env.MCP_VET_NO_PYTHON) {
    // Escape hatch: force the regex fallback (also used to test that path).
    cachedPython = null;
    return null;
  }
  if (process.env.MCP_VET_PYTHON) {
    cachedPython = process.env.MCP_VET_PYTHON;
    return cachedPython;
  }
  const candidates =
    process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python'];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (
        !r.error &&
        (r.status === 0 || `${r.stdout}${r.stderr}`.toLowerCase().includes('python'))
      ) {
        cachedPython = c;
        return c;
      }
    } catch {
      /* try next */
    }
  }
  cachedPython = null;
  return null;
}

const SCRIPT = path.join(__dirname, 'python', 'mcp_ast_scan.py');
const CHUNK_SIZE = 300;

export function pythonAvailable(): boolean {
  return findPython() !== null;
}

function runChunk(py: string, files: string[]): Record<string, Token[]> {
  const out: Record<string, Token[]> = {};
  const r = spawnSync(py, [SCRIPT], {
    input: files.join('\n'),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error || r.status !== 0 || !r.stdout) return out;
  try {
    const parsed = JSON.parse(r.stdout) as Record<string, Token[]>;
    for (const [f, toks] of Object.entries(parsed)) out[f] = toks;
  } catch {
    /* malformed output — treat chunk as no findings */
  }
  return out;
}

/**
 * Analyze a batch of Python files via the bundled subprocess script. Files are
 * processed in chunks so a single pathological file can only lose its own chunk,
 * and so stdin/stdout stay well under buffer limits on large repos.
 * Returns a map of absolute-file-path -> tokens.
 */
export function analyzePyBatch(absFiles: string[]): Record<string, Token[]> {
  const out: Record<string, Token[]> = {};
  const py = findPython();
  if (!py || absFiles.length === 0) return out;
  for (let i = 0; i < absFiles.length; i += CHUNK_SIZE) {
    const chunk = absFiles.slice(i, i + CHUNK_SIZE);
    Object.assign(out, runChunk(py, chunk));
  }
  return out;
}

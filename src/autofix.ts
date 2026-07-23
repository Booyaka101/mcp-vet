import * as fs from 'node:fs';
import { Finding, PatternId, ViolationId } from './types';

/**
 * Rules whose fix is a safe, purely mechanical text substitution. Only the
 * resource-not-found error code qualifies: -32002 -> -32602 is a same-length
 * swap with no semantic ambiguity. Everything else (removed handshake, removed
 * sessions, tasks/list removal, capability deprecations) requires human
 * judgement and is deliberately NOT auto-fixed.
 */
const FIXABLE: Set<PatternId> = new Set(['ERROR_CODE_32002']);

export interface FixPreview {
  file: string;
  line: number;
  before: string;
  after: string;
}

export interface FixResult {
  fixedCount: number;
  filesChanged: string[];
  fixedFindings: Finding[];
  /** Every planned rewrite (populated in both real and dry-run modes). */
  preview: FixPreview[];
}

export interface FixOptions {
  /** Compute and return the rewrites without touching any files. */
  dryRun?: boolean;
}

export function isFixable(id: ViolationId): boolean {
  return FIXABLE.has(id as PatternId);
}

/**
 * Apply the safe mechanical fixes in place. Returns which findings were fixed so
 * the caller can drop them from the report and the exit-code calculation.
 * Replacements are same-length, so multiple fixes on one line never shift each
 * other's positions.
 */
export function applyFixes(findings: Finding[], opts: FixOptions = {}): FixResult {
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!isFixable(f.patternId) || !f.absPath) continue;
    const list = byFile.get(f.absPath) ?? [];
    list.push(f);
    byFile.set(f.absPath, list);
  }

  const filesChanged: string[] = [];
  const fixedFindings: Finding[] = [];
  const preview: FixPreview[] = [];
  let fixedCount = 0;

  for (const [absPath, fileFindings] of byFile) {
    let raw: string;
    try {
      raw = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    const hasBom = raw.charCodeAt(0) === 0xfeff;
    const text = hasBom ? raw.slice(1) : raw;
    // Split on \n only; any \r stays attached to the line content, so CRLF
    // endings are preserved verbatim on rejoin.
    const lines = text.split('\n');
    const applied: Finding[] = [];
    const localPreview: FixPreview[] = [];

    for (const f of fileFindings) {
      const idx = f.line - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const L = lines[idx];
      const col = (f.column ?? 0) - 1; // anchored at the '-' (both analyzers), else the first digit

      // Require an exact column match. We deliberately do NOT fall back to a
      // blind indexOf: a mislocated column (e.g. a skewed offset) could otherwise
      // rewrite an unrelated `-32002` inside a string or comment and corrupt it.
      let next: string | null = null;
      if (col >= 0 && L.startsWith('-32002', col)) {
        next = L.slice(0, col) + '-32602' + L.slice(col + 6);
      } else if (col >= 0 && L.startsWith('32002', col)) {
        next = L.slice(0, col) + '32602' + L.slice(col + 5);
      }

      if (next !== null && next !== L) {
        localPreview.push({ file: f.file, line: f.line, before: L.replace(/\r$/, ''), after: next.replace(/\r$/, '') });
        lines[idx] = next;
        applied.push(f);
      }
    }

    if (applied.length === 0) continue;

    if (opts.dryRun) {
      // Report what WOULD change; touch nothing.
      preview.push(...localPreview);
      continue;
    }

    // Only count/return findings as fixed once the write actually succeeds â€” a
    // failed write (read-only file, EACCES) must not report the code as fixed.
    const out = (hasBom ? 'ï»¿' : '') + lines.join('\n');
    try {
      fs.writeFileSync(absPath, out, 'utf8');
    } catch {
      continue; // nothing fixed for this file
    }
    filesChanged.push(absPath);
    preview.push(...localPreview);
    for (const f of applied) {
      fixedFindings.push(f);
      fixedCount++;
    }
  }

  return { fixedCount, filesChanged, fixedFindings, preview };
}

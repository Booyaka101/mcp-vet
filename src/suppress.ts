import { PatternId, ALL_PATTERN_IDS } from './types';

const ALL = new Set(ALL_PATTERN_IDS);
const DIRECTIVE_RE = /mcp-vet-disable-(file|next-line|line)\b([^\r\n]*)/g;

export interface Suppressions {
  fileDisabled: boolean;
  /** line (1-indexed) -> set of suppressed pattern IDs (empty set = all) */
  byLine: Map<number, Set<PatternId>>;
  isSuppressed(line: number, id: PatternId): boolean;
}

function parseIds(trailing: string): Set<PatternId> {
  const ids = new Set<PatternId>();
  for (const tok of trailing.toUpperCase().match(/[A-Z0-9_]+/g) ?? []) {
    if (ALL.has(tok as PatternId)) ids.add(tok as PatternId);
  }
  return ids; // empty => all patterns
}

/**
 * Parse inline suppression directives from a file's raw lines. Recognized in any
 * comment style (they are matched textually):
 *   mcp-vet-disable-file
 *   mcp-vet-disable-line [PATTERN_ID ...]
 *   mcp-vet-disable-next-line [PATTERN_ID ...]
 */
export function parseSuppressions(lines: string[]): Suppressions {
  let fileDisabled = false;
  const byLine = new Map<number, Set<PatternId>>();

  const add = (line: number, ids: Set<PatternId>) => {
    const existing = byLine.get(line);
    if (!existing) {
      byLine.set(line, ids);
      return;
    }
    if (existing.size === 0) return; // already "all"
    if (ids.size === 0) {
      byLine.set(line, new Set()); // widen to all
      return;
    }
    ids.forEach((i) => existing.add(i));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DIRECTIVE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECTIVE_RE.exec(line)) !== null) {
      const kind = m[1];
      const ids = parseIds(m[2]);
      if (kind === 'file') fileDisabled = true;
      else if (kind === 'line') add(i + 1, ids);
      else if (kind === 'next-line') add(i + 2, ids);
    }
  }

  return {
    fileDisabled,
    byLine,
    isSuppressed(line: number, id: PatternId): boolean {
      if (fileDisabled) return true;
      const ids = byLine.get(line);
      if (!ids) return false;
      return ids.size === 0 || ids.has(id);
    },
  };
}

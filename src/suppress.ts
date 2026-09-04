import {
  ViolationId,
  ALL_PATTERN_IDS,
  ALL_PLUGIN_RULE_IDS,
  ALL_PY_SDK_RULE_IDS,
  ALL_TS_SDK_RULE_IDS,
} from './types';

/**
 * Every id a directive may name. This has to be ALL of them, not just the
 * protocol rules: an id the parser does not recognize is dropped, and a
 * directive left with no ids means "suppress everything on this line". Listing
 * only ALL_PATTERN_IDS meant `mcp-vet-disable-line PY_SDK_V1_HTTPX` silently
 * disabled the BREAKING rules on that line too, and flipped the exit code.
 */
const ALL = new Set<ViolationId>([
  ...ALL_PATTERN_IDS,
  ...ALL_PLUGIN_RULE_IDS,
  ...ALL_PY_SDK_RULE_IDS,
  ...ALL_TS_SDK_RULE_IDS,
]);
const DIRECTIVE_RE = /mcp-vet-disable-(file|next-line|line)\b([^\r\n]*)/g;

export interface Suppressions {
  fileDisabled: boolean;
  /** line (1-indexed) -> set of suppressed rule IDs (empty set = all) */
  byLine: Map<number, Set<ViolationId>>;
  isSuppressed(line: number, id: ViolationId): boolean;
}

function parseIds(trailing: string): Set<ViolationId> {
  const ids = new Set<ViolationId>();
  for (const tok of trailing.toUpperCase().match(/[A-Z0-9_]+/g) ?? []) {
    if (ALL.has(tok as ViolationId)) ids.add(tok as ViolationId);
  }
  return ids; // empty => all rules
}

/**
 * Parse inline suppression directives from a file's raw lines. Recognized in any
 * comment style (they are matched textually):
 *   mcp-vet-disable-file
 *   mcp-vet-disable-line [RULE_ID ...]
 *   mcp-vet-disable-next-line [RULE_ID ...]
 */
export function parseSuppressions(lines: string[]): Suppressions {
  let fileDisabled = false;
  const byLine = new Map<number, Set<ViolationId>>();

  const add = (line: number, ids: Set<ViolationId>) => {
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
    isSuppressed(line: number, id: ViolationId): boolean {
      if (fileDisabled) return true;
      const ids = byLine.get(line);
      if (!ids) return false;
      return ids.size === 0 || ids.has(id);
    },
  };
}

export type Severity = 'BREAKING' | 'DEPRECATED';

export type Confidence = 'high' | 'medium' | 'low';

export type PatternId =
  | 'MCP_SESSION_ID'
  | 'INITIALIZE_HANDLER'
  | 'ERROR_CODE_32002'
  | 'TASKS_LEGACY'
  | 'TASKS_LIST_REMOVED'
  | 'TASKS_RESULT_REMOVED'
  | 'ROOTS_CAP'
  | 'SAMPLING_CAP'
  | 'LOGGING_CAP';

export const ALL_PATTERN_IDS: PatternId[] = [
  'MCP_SESSION_ID',
  'INITIALIZE_HANDLER',
  'ERROR_CODE_32002',
  'TASKS_LEGACY',
  'TASKS_LIST_REMOVED',
  'TASKS_RESULT_REMOVED',
  'ROOTS_CAP',
  'SAMPLING_CAP',
  'LOGGING_CAP',
];

/**
 * A normalized syntactic token emitted by a language analyzer. Every analyzer
 * (ts-morph, the Python subprocess, and the regex fallback) emits this exact
 * shape so the rule engine can be written once and applied uniformly.
 */
export interface Token {
  /** string literal, numeric literal, identifier/variable name, or object key */
  kind: 'string' | 'number' | 'name' | 'key';
  /** literal text of the token. For numbers, the signed decimal (e.g. "-32002"). */
  value: string;
  /** 1-indexed line number */
  line: number;
  /** 1-indexed column number, when known */
  col?: number;
  /**
   * True when this token is *structurally* inside a `capabilities`
   * object/argument (AST-verified). Drives high-confidence capability findings.
   */
  inCapabilities?: boolean;
  /**
   * True when a string literal appears in a method-registration / switch-case /
   * method-comparison context (used to raise confidence for `initialize`).
   */
  registration?: boolean;
  /**
   * True when this token is an already-migrated no-op that must NOT be flagged —
   * e.g. `sessionIdGenerator: undefined`, the documented stateless migration.
   */
  benign?: boolean;
  /**
   * True when a `sessionId`/`session_id` token sits in *client-side* session
   * ownership context — a client transport constructed with a session id, or a
   * read of `transport.sessionId`. Client code that still owns a session breaks
   * against a stateless server even when the server itself scans clean.
   */
  clientSession?: boolean;
}

export interface Finding {
  /** path relative to the scan root, forward-slashed */
  file: string;
  line: number;
  /** 1-indexed column, when known */
  column?: number;
  /** 1-indexed end column, when known (for SARIF regions / editor selection) */
  endColumn?: number;
  patternId: PatternId;
  patternLabel: string;
  severity: Severity;
  confidence: Confidence;
  /** one-sentence explanation of what changes */
  explanation: string;
  /** canonical docs anchor for this pattern */
  docUrl: string;
  /** the offending line + one line of context */
  before: string;
  /** the correct 2026-07-28 pattern */
  after: string;
  /** absolute path — internal only, stripped from serialized output */
  absPath?: string;
  /** the analyzer that produced it — internal only */
  source?: 'ts-morph' | 'python-ast' | 'regex';
}

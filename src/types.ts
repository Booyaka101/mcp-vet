/**
 * BREAKING/DEPRECATED are the static-scan severities; ERROR/WARN are the
 * runtime-probe severities (`mcp-vet probe`). BREAKING and ERROR fail the
 * build under `--fail-on breaking`; DEPRECATED and WARN only warn.
 */
export type Severity = 'BREAKING' | 'DEPRECATED' | 'ERROR' | 'WARN';

export type Confidence = 'high' | 'medium' | 'low';

/** MCP spec revisions `mcp-vet probe` can vet a running server against. */
export type SpecVersion = '2025-11-25' | '2026-07-28';

export const SPEC_VERSIONS: SpecVersion[] = ['2025-11-25', '2026-07-28'];

export type PatternId =
  | 'MCP_SESSION_ID'
  | 'INITIALIZE_HANDLER'
  | 'ERROR_CODE_32002'
  | 'ERROR_CODE_RENUMBERED'
  | 'TASKS_LEGACY'
  | 'TASKS_LIST_REMOVED'
  | 'TASKS_RESULT_REMOVED'
  | 'PING_REMOVED'
  | 'RESOURCE_SUBSCRIBE_REMOVED'
  | 'ROOTS_LIST_CHANGED_REMOVED'
  | 'LOGGING_SETLEVEL_REMOVED'
  | 'SSE_RESUMABILITY_REMOVED'
  | 'ELICITATION_COMPLETE_REMOVED'
  | 'ROOTS_CAP'
  | 'SAMPLING_CAP'
  | 'LOGGING_CAP'
  | 'INCLUDE_CONTEXT_VALUES'
  | 'OAUTH_DCR'
  | 'AUTH_ISS_UNVALIDATED'
  | 'AUTH_DCR_NO_APPLICATION_TYPE'
  | 'AUTH_CREDENTIALS_NOT_ISSUER_KEYED'
  | 'SSE_TRANSPORT_DEPRECATED';

export const ALL_PATTERN_IDS: PatternId[] = [
  'MCP_SESSION_ID',
  'INITIALIZE_HANDLER',
  'ERROR_CODE_32002',
  'ERROR_CODE_RENUMBERED',
  'TASKS_LEGACY',
  'TASKS_LIST_REMOVED',
  'TASKS_RESULT_REMOVED',
  'PING_REMOVED',
  'RESOURCE_SUBSCRIBE_REMOVED',
  'ROOTS_LIST_CHANGED_REMOVED',
  'LOGGING_SETLEVEL_REMOVED',
  'SSE_RESUMABILITY_REMOVED',
  'ELICITATION_COMPLETE_REMOVED',
  'ROOTS_CAP',
  'SAMPLING_CAP',
  'LOGGING_CAP',
  'INCLUDE_CONTEXT_VALUES',
  'OAUTH_DCR',
  'AUTH_ISS_UNVALIDATED',
  'AUTH_DCR_NO_APPLICATION_TYPE',
  'AUTH_CREDENTIALS_NOT_ISSUER_KEYED',
  'SSE_TRANSPORT_DEPRECATED',
];

/**
 * Violations only detectable against a *running* server (`mcp-vet probe`),
 * not by static source analysis. Kebab-case ids are deliberate — they are the
 * wire-level category names, distinct from the static PatternId rule ids.
 */
export type RuntimeRuleId =
  | 'json-schema-dialect'
  | 'requires-initialize-handshake'
  | 'missing-server-discover'
  | 'legacy-resource-error-code'
  // the `--spec 2026-07-28` compliance suite (added on top of the checks above)
  | 'stateless-no-session'
  | 'stateless-no-init'
  | 'required-headers'
  | 'deprecated-sampling'
  | 'deprecated-roots'
  | 'deprecated-logging'
  // added in 0.9.0, from the FINAL 2026-07-28 changelog (SEP-2322 / SEP-2549 /
  // the error-code allocation policy / the ping removal)
  | 'missing-result-type'
  | 'missing-cacheable-fields'
  | 'legacy-error-code-renumbered'
  | 'ping-still-answered'
  // added in 0.10.0 — authorization-server metadata checks (auth hardening)
  | 'dcr-still-advertised'
  | 'auth-metadata-missing-iss'
  // added in 0.10.4 — the deprecated HTTP+SSE transport (SEP-2596)
  | 'legacy-sse-transport';

export const ALL_RUNTIME_RULE_IDS: RuntimeRuleId[] = [
  'json-schema-dialect',
  'requires-initialize-handshake',
  'missing-server-discover',
  'legacy-resource-error-code',
  'stateless-no-session',
  'stateless-no-init',
  'required-headers',
  'deprecated-sampling',
  'deprecated-roots',
  'deprecated-logging',
  'missing-result-type',
  'missing-cacheable-fields',
  'legacy-error-code-renumbered',
  'ping-still-answered',
  'dcr-still-advertised',
  'auth-metadata-missing-iss',
  'legacy-sse-transport',
];

/** Any violation id — static pattern or runtime probe category. */
export type ViolationId = PatternId | RuntimeRuleId;

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
  /**
   * True when a numeric literal sits in a JSON-RPC error `code` position — the
   * value of a `code` key/kwarg, an argument to an *Error(...) construction, or
   * a comparison against something named `code`. Guards ERROR_CODE_RENUMBERED
   * so arbitrary negative constants are never flagged (the 2026-07-28 changelog
   * grandfathers -32000..-32019 for implementation-defined codes).
   */
  errorCode?: boolean;
  /**
   * True when an SSE-resumability option (`eventStore`, `resumptionToken`,
   * `onresumptiontoken`, and their snake_case forms) is passed to something
   * transport/client shaped. Raises SSE_RESUMABILITY_REMOVED to high confidence.
   */
  transportCtx?: boolean;
  /**
   * True when this token is the KEY under which client credentials
   * (client_id/client_secret) are persisted, and that key is not derived from
   * an issuer identifier — a bare string constant, or a variable named like a
   * server/resource URL. SEP-2352 requires credentials to be keyed by the
   * issuer. Guards AUTH_CREDENTIALS_NOT_ISSUER_KEYED; a key mentioning
   * iss/issuer is never marked.
   */
  credKey?: boolean;
  /**
   * True when this token is a `transport`-named key/kwarg whose value is the
   * literal string 'sse' (FastMCP `mcp.run(transport="sse")`,
   * `{ transport: 'sse' }`). Guards SSE_TRANSPORT_DEPRECATED; a transport name
   * held in a variable is never marked (a documented miss).
   */
  transportSse?: boolean;
  /**
   * True when this token is an `event`-named field/kwarg whose value is the
   * literal string 'endpoint' — the legacy HTTP+SSE transport's endpoint-event
   * write (e.g. Python `{"event": "endpoint", ...}`). One half of the
   * hand-rolled two-endpoint signal for SSE_TRANSPORT_DEPRECATED.
   */
  sseEndpointEvent?: boolean;
}

export interface Finding {
  /** path relative to the scan root, forward-slashed */
  file: string;
  line: number;
  /** 1-indexed column, when known */
  column?: number;
  /** 1-indexed end column, when known (for SARIF regions / editor selection) */
  endColumn?: number;
  patternId: ViolationId;
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

import { Token, Finding, PatternId, Severity, Confidence } from './types';
import { SPEC_URL } from './constants';

interface RuleMeta {
  id: PatternId;
  label: string;
  severity: Severity;
  explanation: string;
  after: string;
}

/**
 * Canonical metadata for each of the 7 patterns. The `after` strings are the
 * corrected 2026-07-28 patterns, authored from the official RC post
 * (blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate) and the
 * tokenmix protocol changelog.
 */
export const RULES: Record<PatternId, RuleMeta> = {
  MCP_SESSION_ID: {
    id: 'MCP_SESSION_ID',
    label: 'Mcp-Session-Id',
    severity: 'BREAKING',
    explanation:
      'The Mcp-Session-Id header and protocol-level sessions are removed on 2026-07-28; client info and capabilities now travel in per-request _meta.',
    after: [
      "// 2026-07-28: sessions removed — stop reading/writing the 'Mcp-Session-Id' header.",
      '// Client info & capabilities now arrive in each request’s params._meta.',
      'function handle(req) { const meta = req.params?._meta ?? {}; /* route on meta, not a session id */ }',
    ].join('\n'),
  },
  INITIALIZE_HANDLER: {
    id: 'INITIALIZE_HANDLER',
    label: 'initialize handshake',
    severity: 'BREAKING',
    explanation:
      'The initialize/notifications-initialized handshake is removed on 2026-07-28; protocolVersion, clientInfo and capabilities now travel in _meta on every request.',
    after: [
      '// 2026-07-28: no initialize / notifications/initialized handshake.',
      '// Read handshake data from _meta on every request instead of registering an initialize handler.',
      'function handle(req) { const { protocolVersion, clientInfo, capabilities } = req.params?._meta ?? {}; }',
    ].join('\n'),
  },
  ERROR_CODE_32002: {
    id: 'ERROR_CODE_32002',
    label: 'error code -32002',
    severity: 'BREAKING',
    explanation:
      'The missing-resource error code changes from the MCP-custom -32002 to the JSON-RPC standard -32602 (Invalid Params).',
    after: "return { error: { code: -32602, message: 'Invalid params' } }; // was -32002",
  },
  TASKS_LEGACY: {
    id: 'TASKS_LEGACY',
    label: 'legacy Tasks method',
    severity: 'BREAKING',
    explanation:
      'The experimental Tasks API is redesigned to a handle-based lifecycle on 2026-07-28; tasks/get, tasks/update and tasks/cancel argument shapes change and need manual review.',
    after: [
      '// 2026-07-28: Tasks is now a handle-based extension.',
      '// tools/call returns a task handle; drive it with tasks/get | tasks/update | tasks/cancel',
      '// using the NEW argument shapes — review your params against the RC schema.',
    ].join('\n'),
  },
  TASKS_LIST_REMOVED: {
    id: 'TASKS_LIST_REMOVED',
    label: 'removed tasks/list method',
    severity: 'BREAKING',
    explanation:
      'The tasks/list method is removed entirely on 2026-07-28 (unsafe once protocol-level sessions are gone); there is no drop-in replacement — stop calling/handling it and track task handles yourself.',
    after: [
      '// 2026-07-28: tasks/list is REMOVED — there is no server-side task listing.',
      '// A client tracks the task handles it received from tools/call; there is nothing to enumerate.',
    ].join('\n'),
  },
  TASKS_RESULT_REMOVED: {
    id: 'TASKS_RESULT_REMOVED',
    label: 'removed tasks/result method',
    severity: 'BREAKING',
    explanation:
      'The blocking tasks/result method is removed on 2026-07-28 (SEP-2663); poll for completion and read the result with tasks/get instead.',
    after: [
      '// 2026-07-28: tasks/result is REMOVED — the blocking result call is gone.',
      '// Poll tasks/get until the task is terminal and read its result from there.',
    ].join('\n'),
  },
  ROOTS_CAP: {
    id: 'ROOTS_CAP',
    label: 'roots capability',
    severity: 'DEPRECATED',
    explanation:
      'The roots capability is deprecated with a 12-month grace period; it still works but should not be used in new code.',
    after: "// 'roots' capability is deprecated (≥12-month grace). Avoid new use; plan removal.",
  },
  SAMPLING_CAP: {
    id: 'SAMPLING_CAP',
    label: 'sampling capability',
    severity: 'DEPRECATED',
    explanation:
      'The sampling capability is deprecated with a 12-month grace period; prefer direct provider APIs.',
    after: "// 'sampling' capability is deprecated (≥12-month grace). Prefer direct provider APIs.",
  },
  LOGGING_CAP: {
    id: 'LOGGING_CAP',
    label: 'logging capability',
    severity: 'DEPRECATED',
    explanation:
      'The logging capability is deprecated with a 12-month grace period; use stderr or OpenTelemetry.',
    after: "// 'logging' capability is deprecated (≥12-month grace). Use stderr or OpenTelemetry.",
  },
};

const CAP_RE = /capabilities/i;
const CAP_NAMES: Record<string, PatternId> = {
  roots: 'ROOTS_CAP',
  sampling: 'SAMPLING_CAP',
  logging: 'LOGGING_CAP',
};

// Method-name strings of the deprecated capabilities (SEP-2577). The methods are
// deprecated, not just the capability keys — a server that references these by
// method string (with no literal `capabilities` object nearby) is caught here.
const DEPRECATED_METHODS: Record<string, PatternId> = {
  'roots/list': 'ROOTS_CAP',
  'notifications/roots/list_changed': 'ROOTS_CAP',
  'sampling/createMessage': 'SAMPLING_CAP',
  'logging/setLevel': 'LOGGING_CAP',
  'notifications/message': 'LOGGING_CAP',
};

// SDK request/notification *schema constants* — how real MCP SDK servers register
// handlers (e.g. `server.setRequestHandler(InitializeRequestSchema, ...)`). Matching
// the exact string literal alone misses these entirely.
const SCHEMA_CONSTANTS: Record<string, PatternId> = {
  InitializeRequestSchema: 'INITIALIZE_HANDLER',
  InitializedNotificationSchema: 'INITIALIZE_HANDLER',
  ListRootsRequestSchema: 'ROOTS_CAP',
  RootsListChangedNotificationSchema: 'ROOTS_CAP',
  CreateMessageRequestSchema: 'SAMPLING_CAP',
  SetLevelRequestSchema: 'LOGGING_CAP',
  LoggingMessageNotificationSchema: 'LOGGING_CAP',
  ListTasksRequestSchema: 'TASKS_LIST_REMOVED',
  GetTaskResultRequestSchema: 'TASKS_RESULT_REMOVED',
  GetTaskRequestSchema: 'TASKS_LEGACY',
  CancelTaskRequestSchema: 'TASKS_LEGACY',
};

// SDK capability *constructor* identifiers (esp. the Python SDK:
// `ClientCapabilities(roots=RootsCapability())`). Unambiguous deprecated-feature use.
const CAP_CONSTRUCTORS: Record<string, PatternId> = {
  RootsCapability: 'ROOTS_CAP',
  SamplingCapability: 'SAMPLING_CAP',
  LoggingCapability: 'LOGGING_CAP',
};

function snippet(lines: string[], line: number): string {
  const idx = line - 1;
  const out: string[] = [];
  if (lines[idx] !== undefined) out.push(`${line}: ${lines[idx].trim()}`);
  if (lines[idx + 1] !== undefined) out.push(`${line + 1}: ${lines[idx + 1].trim()}`);
  return out.join('\n');
}

export interface EngineOptions {
  /** the set of pattern IDs to evaluate (already resolved from only/disable) */
  enabled: Set<PatternId>;
  absPath: string;
  source: NonNullable<Finding['source']>;
}

/**
 * Apply the enabled detection rules to the tokens of a single file, producing
 * findings with a confidence score.
 */
export function applyRules(
  relPath: string,
  lines: string[],
  tokens: Token[],
  opts: EngineOptions,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const { enabled } = opts;

  // Lines that mention "capabilities" — drive the medium-confidence heuristic
  // for the DEPRECATED capability rules (5-7).
  const capLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (CAP_RE.test(lines[i])) capLines.push(i + 1);
  }
  const nearCapabilities = (line: number) =>
    capLines.some((cl) => Math.abs(cl - line) <= 5);

  const push = (id: PatternId, t: Token, confidence: Confidence) => {
    if (!enabled.has(id)) return;
    const key = `${t.line}|${t.col ?? 0}|${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const m = RULES[id];
    const column = t.col;
    findings.push({
      file: relPath,
      line: t.line,
      column,
      endColumn: column !== undefined ? column + t.value.length : undefined,
      patternId: id,
      patternLabel: m.label,
      severity: m.severity,
      confidence,
      explanation: m.explanation,
      docUrl: SPEC_URL,
      before: snippet(lines, t.line),
      after: m.after,
      absPath: opts.absPath,
      source: opts.source,
    });
  };

  for (const t of tokens) {
    const v = t.value;
    const lower = v.toLowerCase();

    // Rule 1 — Mcp-Session-Id (string literal, header key, or variable name)
    if (
      (t.kind === 'string' || t.kind === 'name' || t.kind === 'key') &&
      (lower.includes('mcp-session-id') || lower.includes('mcpsessionid'))
    ) {
      push('MCP_SESSION_ID', t, 'high');
    }

    // Rule 2 — initialize handshake (exact method-name string literal)
    if (t.kind === 'string' && (v === 'initialize' || v === 'notifications/initialized')) {
      push('INITIALIZE_HANDLER', t, t.registration ? 'high' : 'low');
    }

    // Rule 3 — legacy error code -32002 (numeric literal)
    if (t.kind === 'number' && v === '-32002') {
      push('ERROR_CODE_32002', t, 'high');
    }

    // Rule 4 — legacy Tasks methods (exact string literals)
    if (
      t.kind === 'string' &&
      (v === 'tasks/get' || v === 'tasks/update' || v === 'tasks/cancel')
    ) {
      push('TASKS_LEGACY', t, 'high');
    }

    // Rule 4b — tasks/list is removed entirely (exact string literal)
    if (t.kind === 'string' && v === 'tasks/list') {
      push('TASKS_LIST_REMOVED', t, 'high');
    }

    // Rule 4c — tasks/result is removed (exact string literal)
    if (t.kind === 'string' && v === 'tasks/result') {
      push('TASKS_RESULT_REMOVED', t, 'high');
    }

    // Rule 8 — deprecated-capability method strings (exact, high confidence)
    if (t.kind === 'string' && DEPRECATED_METHODS[v]) {
      push(DEPRECATED_METHODS[v], t, 'high');
    }

    // Rule 9 — SDK schema-constant identifiers used to register handlers
    if (t.kind === 'name' && SCHEMA_CONSTANTS[v]) {
      push(SCHEMA_CONSTANTS[v], t, 'high');
    }

    // Rule 9b — SDK capability constructor identifiers (RootsCapability, ...)
    if (t.kind === 'name' && CAP_CONSTRUCTORS[v]) {
      push(CAP_CONSTRUCTORS[v], t, 'high');
    }

    // Rule 10 — `sessionIdGenerator` option (TS SDK session usage). The correct
    // migration is `sessionIdGenerator: undefined`, so the analyzer marks that
    // benign; only a real generator is flagged, at medium confidence. TS only.
    if (
      opts.source === 'ts-morph' &&
      t.kind === 'key' &&
      v === 'sessionIdGenerator' &&
      !t.benign
    ) {
      push('MCP_SESSION_ID', t, 'medium');
    }

    // Rule 11 — client-side session ownership. A client transport constructed
    // with a real sessionId / session_id, or a read of transport.sessionId,
    // means the client still behaves as if it owns a session — which breaks
    // against a stateless 2026-07-28 server even when the server scans clean.
    if (
      (t.kind === 'key' || t.kind === 'name') &&
      (v === 'sessionId' || v === 'session_id') &&
      t.clientSession &&
      !t.benign
    ) {
      push('MCP_SESSION_ID', t, 'medium');
    }

    // Rules 5-7 — deprecated capabilities.
    // High confidence when structurally inside a `capabilities` object (AST);
    // medium when only within 5 lines of a "capabilities" mention.
    if ((t.kind === 'key' || t.kind === 'string') && CAP_NAMES[v]) {
      if (t.inCapabilities) push(CAP_NAMES[v], t, 'high');
      else if (nearCapabilities(t.line)) push(CAP_NAMES[v], t, 'medium');
    }
  }

  return findings.sort(
    (a, b) =>
      a.line - b.line ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.patternId.localeCompare(b.patternId),
  );
}

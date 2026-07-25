/**
 * Runtime prober (`mcp-vet probe`) — connects to a *running* MCP server over
 * stdio (spawned command) or Streamable HTTP (URL) and vets its wire behavior:
 *
 *  1. `json-schema-dialect` (WARN) — calls tools/list and inspects each tool's
 *     inputSchema/outputSchema for a pre-2020-12 JSON Schema dialect (SEP-2106).
 *  2. `requires-initialize-handshake` (ERROR, only with --spec-version
 *     2026-07-28) — makes a stateless first request (no initialize; capabilities
 *     travel in _meta per the 2026-07-28 RC). A server that rejects or hangs on
 *     it still requires the removed handshake.
 *  3. `missing-server-discover` (ERROR, 2026-07-28 only) — calls the required
 *     server/discover RPC (SEP-2575) and expects a result with a `capabilities`
 *     key. There is no HTTP GET variant — 2026-07-28 removes the GET endpoint.
 *  4. `legacy-resource-error-code` (ERROR, 2026-07-28 only) — reads a
 *     deliberately nonexistent resource URI and flags a server that still
 *     answers with the removed -32002 code instead of -32602 (Invalid Params).
 *     Servers without resources support (-32601) are skipped, not flagged.
 *
 * The stateless verdict is cross-checked: the violation is only emitted when
 * the classic 2025-11-25 handshake path *does* work, so a dead/broken server is
 * reported as an operational error (exit 2), not a false violation. Checks 3-4
 * run on whichever contact path succeeded, so a legacy server gets a complete
 * migration report in one probe.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Finding, RuntimeRuleId, SpecVersion } from './types';
import { RUNTIME_RULES } from './rules';
import { getVersion } from './constants';
import { analyzeSchemaDialect, DialectIssue } from './schema-dialect';

/** Operational failure — the server could not be probed at all. */
export class ProbeError extends Error {}

class TimeoutError extends Error {}
class ConnectionClosedError extends Error {}

export type ProbeTarget =
  | { kind: 'stdio'; command: string; args: string[] }
  | { kind: 'http'; url: string };

export interface ProbeOptions {
  specVersion: SpecVersion;
  /** per-request timeout in ms (also the stateless hang-detection window) */
  timeoutMs: number;
  /**
   * Run the `--spec 2026-07-28` compliance suite in addition to the existing
   * checks: stateless-no-session, stateless-no-init, required-headers, and the
   * deprecated-sampling / deprecated-roots / deprecated-logging warnings. Only
   * meaningful together with specVersion '2026-07-28'.
   */
  specChecks?: boolean;
}

export interface ProbeResult {
  /** human-readable target (the command line or the URL) */
  target: string;
  transport: 'stdio' | 'http';
  specVersion: SpecVersion;
  findings: Finding[];
  /** number of tools returned by tools/list */
  toolCount: number;
  /** stateless first-request verdict; null = not probed (spec 2025-11-25) */
  statelessOk: boolean | null;
  /** classic initialize-handshake verdict; null = not attempted */
  handshakeOk: boolean | null;
  /** server/discover verdict; null = not probed (spec 2025-11-25) */
  discoverOk: boolean | null;
  /** nonexistent-resource error-code verdict; null = not probed or inconclusive */
  errorCodeOk: boolean | null;
  notes: string[];
}

interface JsonRpcResponse {
  result?: any;
  error?: { code?: number; message?: string };
}

interface Connection {
  request(
    method: string,
    params: unknown,
    timeoutMs: number,
    extraHeaders?: Record<string, string>,
  ): Promise<JsonRpcResponse>;
  notify(method: string, params: unknown): Promise<void>;
  close(): void;
  /**
   * Subscribe to *server-initiated* messages (requests/notifications that are
   * not replies to our own request ids) — used to observe deprecated
   * server→client traffic like sampling/createMessage and notifications/message.
   * Returns an unsubscribe function. Optional: a transport may not surface them.
   */
  onServerMessage?(listener: (msg: any) => void): () => void;
}

// ---------------------------------------------------------------------------
// stdio transport — newline-delimited JSON-RPC over a spawned child process
// ---------------------------------------------------------------------------

/**
 * Windows can't spawn `.cmd`/`.bat` shims (npx, npm, uvx, ...) directly — Node
 * needs a shell for those, and cmd.exe resolves a bare name via PATHEXT itself.
 * A bare command that resolves to an .exe is spawned by full path, shell-free.
 */
function resolveSpawn(command: string): { command: string; shell: boolean } {
  if (process.platform !== 'win32') return { command, shell: false };
  if (/\.(cmd|bat)$/i.test(command)) return { command, shell: true };
  if (/\.exe$/i.test(command) || command.includes('\\') || command.includes('/')) {
    return { command, shell: false };
  }
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, `${command}.exe`))) {
      return { command: path.join(dir, `${command}.exe`), shell: false };
    }
    if (
      fs.existsSync(path.join(dir, `${command}.cmd`)) ||
      fs.existsSync(path.join(dir, `${command}.bat`))
    ) {
      // spawn the BARE name through the shell — cmd.exe finds the shim via
      // PATHEXT, and a bare name never has the quoting problems a full
      // "C:\Program Files\..." path has under shell:true.
      return { command, shell: true };
    }
  }
  return { command, shell: false };
}

function openStdio(rawCommand: string, args: string[]): Connection {
  const { command, shell } = resolveSpawn(rawCommand);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell });
  let nextId = 1;
  let buf = '';
  let closed = false;
  let closedReason = '';
  const stderrTail: string[] = [];
  const pending = new Map<number, { resolve: (m: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  const serverListeners = new Set<(msg: any) => void>();

  const failAll = (reason: string) => {
    closed = true;
    closedReason = reason;
    for (const p of pending.values()) p.reject(new ConnectionClosedError(reason));
    pending.clear();
  };

  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // tolerate stray non-JSON stdout lines
      }
      if (msg && typeof msg === 'object' && typeof msg.id === 'number' && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        p.resolve(msg);
      } else if (msg && typeof msg === 'object' && typeof msg.method === 'string') {
        // A server-initiated request or notification (its id, if any, is not one
        // we issued) — surface it to any deprecated-traffic observers.
        for (const l of serverListeners) l(msg);
      }
    }
  });
  child.stderr.on('data', (d: Buffer) => {
    stderrTail.push(d.toString('utf8'));
    while (stderrTail.length > 20) stderrTail.shift();
  });
  child.on('error', (err) => failAll(`failed to spawn "${command}": ${err.message}`));
  child.on('exit', (code, signal) => {
    const tail = stderrTail.join('').trim().split(/\r?\n/).slice(-3).join(' | ');
    failAll(
      `server process exited (${signal ?? `code ${code}`}) before responding` +
        (tail ? ` — stderr: ${tail}` : ''),
    );
  });

  return {
    // extraHeaders is a Streamable-HTTP concept; stdio has no request headers.
    request(method, params, timeoutMs, _extraHeaders) {
      return new Promise<JsonRpcResponse>((resolve, reject) => {
        if (closed) return reject(new ConnectionClosedError(closedReason));
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new TimeoutError(`no response to ${method} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        try {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        } catch (err) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new ConnectionClosedError((err as Error).message));
        }
      });
    },
    async notify(method, params) {
      if (closed) return;
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
      } catch {
        /* connection already down — the next request reports it */
      }
    },
    onServerMessage(listener) {
      serverListeners.add(listener);
      return () => serverListeners.delete(listener);
    },
    close() {
      closed = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport — POST JSON-RPC; tolerates JSON or SSE responses
// ---------------------------------------------------------------------------

function parseSse(body: string, id: number): JsonRpcResponse | null {
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const msg = JSON.parse(line.slice(5).trim());
      if (msg && typeof msg === 'object' && msg.id === id) return msg;
    } catch {
      /* not a JSON data line */
    }
  }
  return null;
}

function openHttp(url: string, specVersion: SpecVersion): Connection {
  let nextId = 1;
  let sessionId: string | undefined;
  const serverListeners = new Set<(msg: any) => void>();

  // Feed any server-initiated (method-bearing) message from a response body to
  // the deprecated-traffic observers, ignoring replies to our own request id.
  const dispatchServer = (msg: any, ourId: number) => {
    if (msg && typeof msg === 'object' && typeof msg.method === 'string' && msg.id !== ourId) {
      for (const l of serverListeners) l(msg);
    }
  };

  const post = async (
    payload: Record<string, unknown>,
    method: string,
    timeoutMs: number,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    // 2026-07-28 Streamable HTTP requires an Mcp-Method routing header that
    // mirrors the JSON-RPC body.
    if (specVersion === '2026-07-28') headers['mcp-method'] = method;
    if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = v;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new TimeoutError(`no response to ${method} within ${timeoutMs} ms`);
      }
      throw new ConnectionClosedError(`could not reach ${url}: ${e.message}`);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    return res;
  };

  return {
    async request(method, params, timeoutMs, extraHeaders) {
      const id = nextId++;
      const res = await post({ jsonrpc: '2.0', id, method, params }, method, timeoutMs, extraHeaders);
      const body = await res.text();
      const ct = res.headers.get('content-type') ?? '';
      let msg: JsonRpcResponse | null = null;
      if (ct.includes('text/event-stream')) {
        // A single POST may carry server→client traffic (e.g. a sampling
        // request) alongside our reply in the SSE stream — surface it.
        for (const line of body.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          try {
            dispatchServer(JSON.parse(line.slice(5).trim()), id);
          } catch {
            /* not a JSON data line */
          }
        }
        msg = parseSse(body, id);
      } else {
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed)) {
            for (const m of parsed) dispatchServer(m, id);
            msg = parsed.find((m) => m && m.id === id) ?? null;
          } else {
            msg = parsed;
          }
        } catch {
          msg = null;
        }
      }
      if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg)) return msg;
      if (!res.ok) {
        // An HTTP-level rejection with no JSON-RPC body (e.g. 400 "missing
        // session") — surface it as a JSON-RPC-shaped error so the stateless
        // probe classifies it as a rejection, not an operational failure.
        return {
          error: { code: -res.status, message: `HTTP ${res.status} ${body.slice(0, 120).trim()}` },
        };
      }
      throw new ConnectionClosedError(
        `unparseable response to ${method} (HTTP ${res.status}, content-type ${ct || 'none'})`,
      );
    },
    async notify(method, params) {
      try {
        await post({ jsonrpc: '2.0', method, params }, method, 5000);
      } catch {
        /* notifications are best-effort */
      }
    },
    onServerMessage(listener) {
      serverListeners.add(listener);
      return () => serverListeners.delete(listener);
    },
    close() {
      /* nothing persistent to tear down */
    },
  };
}

// ---------------------------------------------------------------------------
// Probe orchestration
// ---------------------------------------------------------------------------

function openConnection(target: ProbeTarget, specVersion: SpecVersion): Connection {
  return target.kind === 'http'
    ? openHttp(target.url, specVersion)
    : openStdio(target.command, target.args);
}

function clientInfo() {
  return { name: 'mcp-vet', version: getVersion() };
}

/** _meta for a stateless 2026-07-28 request (per the RC's namespaced keys). */
function statelessMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': clientInfo(),
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

interface AttemptResult {
  ok: boolean;
  tools?: any[];
  evidence: string;
  /** the still-open connection on success — the caller closes it */
  conn?: Connection;
}

/** Stateless 2026-07-28 first contact: tools/list with _meta, NO initialize. */
async function tryStateless(target: ProbeTarget, opts: ProbeOptions): Promise<AttemptResult> {
  const conn = openConnection(target, '2026-07-28');
  try {
    const resp = await conn.request('tools/list', { _meta: statelessMeta() }, opts.timeoutMs);
    if (resp.error) {
      conn.close();
      return {
        ok: false,
        evidence: `stateless tools/list was rejected: ${resp.error.code ?? '?'} ${resp.error.message ?? ''}`.trim(),
      };
    }
    const tools = resp.result?.tools;
    if (!Array.isArray(tools)) {
      conn.close();
      return { ok: false, evidence: 'stateless tools/list answered without a tools array' };
    }
    return { ok: true, tools, conn, evidence: 'server answered a stateless tools/list (no initialize)' };
  } catch (err) {
    conn.close();
    if (err instanceof TimeoutError) {
      return {
        ok: false,
        evidence: `stateless tools/list hung (${err.message}) — server is likely waiting for initialize`,
      };
    }
    return { ok: false, evidence: (err as Error).message };
  }
}

/** Classic 2025-11-25 contact: initialize → notifications/initialized → tools/list. */
async function tryClassic(target: ProbeTarget, opts: ProbeOptions): Promise<AttemptResult> {
  const conn = openConnection(target, '2025-11-25');
  try {
    const init = await conn.request(
      'initialize',
      { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: clientInfo() },
      opts.timeoutMs,
    );
    if (init.error) {
      conn.close();
      return {
        ok: false,
        evidence: `initialize was rejected: ${init.error.code ?? '?'} ${init.error.message ?? ''}`.trim(),
      };
    }
    await conn.notify('notifications/initialized', {});
    const lst = await conn.request('tools/list', {}, opts.timeoutMs);
    if (lst.error) {
      conn.close();
      return {
        ok: false,
        evidence: `tools/list after handshake was rejected: ${lst.error.code ?? '?'} ${lst.error.message ?? ''}`.trim(),
      };
    }
    const tools = lst.result?.tools;
    if (!Array.isArray(tools)) {
      conn.close();
      return { ok: false, evidence: 'tools/list after handshake answered without a tools array' };
    }
    return { ok: true, tools, conn, evidence: 'initialize handshake + tools/list succeeded' };
  } catch (err) {
    conn.close();
    return { ok: false, evidence: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// 2026-07-28-only follow-up checks (run on the connection that already worked)
// ---------------------------------------------------------------------------

interface CheckOutcome {
  /** true = passed, false = violation, null = skipped/inconclusive */
  ok: boolean | null;
  finding?: Finding;
  note: string;
}

/** server/discover is REQUIRED on 2026-07-28 (SEP-2575) and must advertise capabilities. */
async function checkServerDiscover(
  conn: Connection,
  label: string,
  opts: ProbeOptions,
): Promise<CheckOutcome> {
  try {
    const resp = await conn.request('server/discover', { _meta: statelessMeta() }, opts.timeoutMs);
    if (resp.error) {
      const evidence =
        `server/discover was rejected: ${resp.error.code ?? '?'} ${resp.error.message ?? ''}`.trim();
      return {
        ok: false,
        finding: runtimeFinding('missing-server-discover', label, evidence, 'high'),
        note: `server/discover: rejected (${resp.error.code ?? '?'})`,
      };
    }
    const caps = resp.result?.capabilities;
    if (!caps || typeof caps !== 'object') {
      const evidence = 'server/discover answered, but its result has no capabilities key';
      return {
        ok: false,
        finding: runtimeFinding('missing-server-discover', label, evidence, 'high'),
        note: 'server/discover: result missing the required capabilities key',
      };
    }
    const versions = Array.isArray(resp.result?.supportedVersions)
      ? ` · supportedVersions: ${resp.result.supportedVersions.join(', ')}`
      : '';
    return {
      ok: true,
      note: `server/discover: capabilities advertised (${Object.keys(caps).join(', ') || 'empty object'})${versions}`,
    };
  } catch (err) {
    if (err instanceof TimeoutError) {
      // No reply at all — a compliant server (or a legacy one) would at least
      // answer -32601. A hang is a failure, but not a deterministic one.
      return {
        ok: false,
        finding: runtimeFinding(
          'missing-server-discover',
          label,
          `server/discover hung (${err.message})`,
          'medium',
        ),
        note: 'server/discover: no response (hung)',
      };
    }
    return { ok: null, note: `server/discover: check inconclusive — ${(err as Error).message}` };
  }
}

/** A URI no real server should resolve — used to elicit the not-found error code. */
const NONEXISTENT_URI = 'mcp-vet://probe/nonexistent-resource';

/** 2026-07-28 changes resource-not-found from -32002 to -32602 (Invalid Params). */
async function checkResourceErrorCode(
  conn: Connection,
  label: string,
  opts: ProbeOptions,
): Promise<CheckOutcome> {
  try {
    const resp = await conn.request(
      'resources/read',
      { uri: NONEXISTENT_URI, _meta: statelessMeta() },
      opts.timeoutMs,
    );
    if (!resp.error) {
      return {
        ok: null,
        note: `resource error-code check inconclusive — resources/read of ${NONEXISTENT_URI} unexpectedly succeeded`,
      };
    }
    const code = resp.error.code;
    if (code === -32002) {
      const evidence =
        `resources/read of nonexistent ${NONEXISTENT_URI} returned the removed code -32002 (${resp.error.message ?? ''})`.trim();
      return {
        ok: false,
        finding: runtimeFinding('legacy-resource-error-code', label, evidence, 'high'),
        note: 'resource error code: -32002 (legacy — must be -32602)',
      };
    }
    if (code === -32602) {
      return { ok: true, note: 'resource error code: -32602 (Invalid Params — correct for 2026-07-28)' };
    }
    if (code === -32601) {
      return {
        ok: null,
        note: 'resource error-code check skipped — server does not implement resources/read (-32601)',
      };
    }
    return {
      ok: null,
      note: `resource error-code check inconclusive — nonexistent resource returned ${code ?? 'no code'} (neither -32002 nor -32602)`,
    };
  } catch (err) {
    return { ok: null, note: `resource error-code check inconclusive — ${(err as Error).message}` };
  }
}

function runtimeFinding(
  ruleId: RuntimeRuleId,
  targetLabel: string,
  evidence: string,
  confidence: 'high' | 'medium' = 'high',
): Finding {
  const rule = RUNTIME_RULES[ruleId];
  return {
    file: targetLabel,
    line: 1,
    patternId: rule.id,
    patternLabel: rule.label,
    severity: rule.severity,
    confidence,
    explanation: rule.explanation,
    docUrl: rule.docUrl,
    before: evidence,
    after: rule.after,
  };
}

function dialectFinding(
  targetLabel: string,
  toolName: string,
  field: 'inputSchema' | 'outputSchema',
  issue: DialectIssue,
): Finding {
  const rule = RUNTIME_RULES['json-schema-dialect'];
  const evidence =
    issue.kind === 'explicit'
      ? `tool "${toolName}" ${field}: $schema = ${issue.schemaValue} (${issue.dialect})`
      : `tool "${toolName}" ${field}: no $schema, uses ${issue.keywords!.join('; ')}`;
  return {
    file: targetLabel,
    line: 1,
    patternId: rule.id,
    patternLabel: rule.label,
    severity: rule.severity,
    // an explicit old $schema is deterministic; keyword inference is heuristic
    confidence: issue.kind === 'explicit' ? 'high' : 'medium',
    explanation: rule.explanation,
    docUrl: rule.docUrl,
    before: evidence,
    after: rule.after,
  };
}

export function targetLabel(target: ProbeTarget): string {
  return target.kind === 'http' ? target.url : [target.command, ...target.args].join(' ');
}

// ---------------------------------------------------------------------------
// `--spec 2026-07-28` compliance suite — opt-in, run IN ADDITION to the checks
// above. Each check uses its own fresh connection so the existing probe path is
// left exactly as it was.
// ---------------------------------------------------------------------------

const SESSION_ERR_RE = /session/i;
const UNINIT_ERR_RE = /initial/i; // matches initialize / initialized / uninitialized

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve once `pred()` is true or `windowMs` elapses (cheap polling). */
async function waitUntil(pred: () => boolean, windowMs: number): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (!pred() && Date.now() < deadline) await delay(25);
}

/**
 * Runs the six `--spec 2026-07-28` compliance checks and returns the findings
 * plus human-readable notes to fold into the ProbeResult:
 *   1. stateless-no-session   ERROR  — a no-session request must not be refused
 *   2. stateless-no-init      ERROR  — a no-handshake request must be answered
 *   3. required-headers       ERROR  — Mcp-Method/Mcp-Name must be accepted (HTTP)
 *   4. deprecated-sampling    WARN   — server issued sampling/createMessage
 *   5. deprecated-roots       WARN   — roots/list returned a result
 *   6. deprecated-logging     WARN   — server emitted notifications/message
 */
async function runSpecChecks(
  target: ProbeTarget,
  opts: ProbeOptions,
): Promise<{ findings: Finding[]; notes: string[] }> {
  const label = targetLabel(target);
  const findings: Finding[] = [];
  const notes: string[] = [];
  const isHttp = target.kind === 'http';
  const conn = openConnection(target, '2026-07-28');

  // Passively watch for deprecated server→client traffic while we drive the
  // connection (checks 4 & 6). Register before the first request so the window
  // covers everything the server sends.
  let sawSampling = false;
  let sawLogging = false;
  const unsub = conn.onServerMessage?.((m) => {
    if (m && m.method === 'sampling/createMessage') sawSampling = true;
    if (m && m.method === 'notifications/message') sawLogging = true;
  });

  try {
    // Checks 1 & 2 — a single stateless (no session), no-initialize tools/list.
    let resp: JsonRpcResponse;
    try {
      resp = await conn.request('tools/list', { _meta: statelessMeta() }, opts.timeoutMs);
    } catch (err) {
      resp = { error: { message: (err as Error).message } };
    }
    if (resp.error) {
      const code = resp.error.code;
      const message = resp.error.message ?? '';
      const evidence =
        `stateless tools/list (no session, no initialize) was rejected: ${code ?? '?'} ${message}`.trim();
      const isSession = SESSION_ERR_RE.test(message);
      const isUninit = UNINIT_ERR_RE.test(message);
      if (isSession) {
        findings.push(runtimeFinding('stateless-no-session', label, evidence));
        notes.push(`stateless-no-session: FAIL — server requires a session (${code ?? '?'})`);
      } else {
        notes.push('stateless-no-session: passed — no session was required');
      }
      // Per the brief, an "uninitialized" OR a "session" rejection fails no-init.
      if (isUninit || isSession) {
        findings.push(runtimeFinding('stateless-no-init', label, evidence));
        notes.push(`stateless-no-init: FAIL — request rejected without an initialize handshake (${code ?? '?'})`);
      } else {
        notes.push(`stateless-no-init: inconclusive — rejected for an unrelated reason (${code ?? '?'})`);
      }
    } else if (Array.isArray(resp.result?.tools)) {
      notes.push('stateless-no-session: passed — no session was required');
      notes.push('stateless-no-init: passed — answered the first request with no handshake');
    } else {
      notes.push('stateless-no-session / stateless-no-init: inconclusive — no tools array in the answer');
    }

    // Check 3 — the required Mcp-Method / Mcp-Name routing headers (HTTP only;
    // stdio has no request headers).
    if (!isHttp) {
      notes.push(
        'required-headers: skipped — Mcp-Method/Mcp-Name are a Streamable HTTP concern; target is stdio',
      );
    } else {
      let hdrResp: JsonRpcResponse;
      try {
        hdrResp = await conn.request('tools/list', { _meta: statelessMeta() }, opts.timeoutMs, {
          'mcp-method': 'tools/list',
          'mcp-name': 'tools/list',
        });
      } catch (err) {
        hdrResp = { error: { message: (err as Error).message } };
      }
      if (!hdrResp.error) {
        notes.push('required-headers: passed — server accepted a request carrying Mcp-Method and Mcp-Name');
      } else if (/header|mcp-method|mcp-name|routing/i.test(hdrResp.error.message ?? '')) {
        const evidence =
          `tools/list carrying the Mcp-Method/Mcp-Name headers was rejected: ${hdrResp.error.code ?? '?'} ${hdrResp.error.message ?? ''}`.trim();
        findings.push(runtimeFinding('required-headers', label, evidence));
        notes.push('required-headers: FAIL — server errored on the required routing headers');
      } else {
        notes.push(
          `required-headers: inconclusive — request errored for an unrelated reason (${hdrResp.error.code ?? '?'})`,
        );
      }
    }

    // Check 5 — a roots/list that returns a result means the deprecated roots
    // capability is in use.
    try {
      const rootsResp = await conn.request('roots/list', { _meta: statelessMeta() }, opts.timeoutMs);
      if (!rootsResp.error && rootsResp.result && typeof rootsResp.result === 'object') {
        const roots = (rootsResp.result as { roots?: unknown }).roots;
        const count = Array.isArray(roots) ? ` (${roots.length} root(s))` : '';
        findings.push(
          runtimeFinding(
            'deprecated-roots',
            label,
            `roots/list returned a result${count} — the deprecated roots capability is in use`,
          ),
        );
        notes.push('deprecated-roots: WARN — server answered roots/list with a result');
      } else {
        notes.push(`deprecated-roots: clean — roots/list not served (${rootsResp.error?.code ?? 'no result'})`);
      }
    } catch (err) {
      notes.push(`deprecated-roots: inconclusive — ${(err as Error).message}`);
    }

    // Checks 4 & 6 — give the server the spec's window (up to 5 s) to emit
    // deprecated server→client traffic, resolving early once both are seen.
    if (conn.onServerMessage) {
      await waitUntil(() => sawSampling && sawLogging, Math.min(5000, opts.timeoutMs));
      if (sawSampling) {
        findings.push(
          runtimeFinding('deprecated-sampling', label, 'server issued a sampling/createMessage request'),
        );
        notes.push('deprecated-sampling: WARN — server issued sampling/createMessage');
      } else {
        notes.push('deprecated-sampling: clean — no sampling/createMessage observed');
      }
      if (sawLogging) {
        findings.push(
          runtimeFinding(
            'deprecated-logging',
            label,
            'server emitted a notifications/message log notification',
          ),
        );
        notes.push('deprecated-logging: WARN — server emitted notifications/message');
      } else {
        notes.push('deprecated-logging: clean — no notifications/message observed');
      }
    } else {
      notes.push(
        'deprecated-sampling / deprecated-logging: skipped — this transport cannot observe server-initiated traffic',
      );
    }
  } finally {
    unsub?.();
    conn.close();
  }

  return { findings, notes };
}

export async function probeServer(target: ProbeTarget, opts: ProbeOptions): Promise<ProbeResult> {
  const label = targetLabel(target);
  const findings: Finding[] = [];
  const notes: string[] = [];
  let tools: any[] | null = null;
  let statelessOk: boolean | null = null;
  let handshakeOk: boolean | null = null;
  let discoverOk: boolean | null = null;
  let errorCodeOk: boolean | null = null;
  let conn: Connection | null = null;

  try {
    if (opts.specVersion === '2026-07-28') {
      const st = await tryStateless(target, opts);
      statelessOk = st.ok;
      notes.push(`stateless probe: ${st.evidence}`);
      if (st.ok) {
        tools = st.tools!;
        conn = st.conn!;
      } else {
        const cl = await tryClassic(target, opts);
        handshakeOk = cl.ok;
        if (cl.ok) {
          // Confirmed: the server works — but only through the removed handshake.
          tools = cl.tools!;
          conn = cl.conn!;
          notes.push(`fallback probe: ${cl.evidence}`);
          findings.push(runtimeFinding('requires-initialize-handshake', label, st.evidence));
        } else {
          throw new ProbeError(
            `could not reach the server statelessly (${st.evidence}) nor via the 2025-11-25 initialize handshake (${cl.evidence}) — is it running and speaking MCP?`,
          );
        }
      }

      // The remaining 2026-07-28 checks run on whichever contact path worked,
      // so even a handshake-only server gets a complete migration report.
      const disc = await checkServerDiscover(conn, label, opts);
      discoverOk = disc.ok;
      notes.push(disc.note);
      if (disc.finding) findings.push(disc.finding);

      const ec = await checkResourceErrorCode(conn, label, opts);
      errorCodeOk = ec.ok;
      notes.push(ec.note);
      if (ec.finding) findings.push(ec.finding);
    } else {
      const cl = await tryClassic(target, opts);
      handshakeOk = cl.ok;
      notes.push(`handshake probe: ${cl.evidence}`);
      if (!cl.ok) {
        throw new ProbeError(`could not connect: ${cl.evidence}`);
      }
      tools = cl.tools!;
      conn = cl.conn!;
    }
  } finally {
    conn?.close();
  }

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const name = typeof tool.name === 'string' ? tool.name : '(unnamed tool)';
    for (const field of ['inputSchema', 'outputSchema'] as const) {
      const issue = analyzeSchemaDialect(tool[field]);
      if (issue) findings.push(dialectFinding(label, name, field, issue));
    }
  }

  // The opt-in `--spec 2026-07-28` compliance suite runs on its own fresh
  // connection(s), in addition to everything above.
  if (opts.specChecks && opts.specVersion === '2026-07-28') {
    const extra = await runSpecChecks(target, opts);
    findings.push(...extra.findings);
    notes.push(...extra.notes);
  }

  return {
    target: label,
    transport: target.kind,
    specVersion: opts.specVersion,
    findings,
    toolCount: tools.length,
    statelessOk,
    handshakeOk,
    discoverOk,
    errorCodeOk,
    notes,
  };
}

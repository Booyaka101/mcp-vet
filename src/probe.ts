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
import { Finding, SpecVersion } from './types';
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
  request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcResponse>;
  notify(method: string, params: unknown): Promise<void>;
  close(): void;
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
    request(method, params, timeoutMs) {
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

  const post = async (
    payload: Record<string, unknown>,
    method: string,
    timeoutMs: number,
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    // 2026-07-28 Streamable HTTP requires an Mcp-Method routing header that
    // mirrors the JSON-RPC body.
    if (specVersion === '2026-07-28') headers['mcp-method'] = method;
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
    async request(method, params, timeoutMs) {
      const id = nextId++;
      const res = await post({ jsonrpc: '2.0', id, method, params }, method, timeoutMs);
      const body = await res.text();
      const ct = res.headers.get('content-type') ?? '';
      let msg: JsonRpcResponse | null = null;
      if (ct.includes('text/event-stream')) {
        msg = parseSse(body, id);
      } else {
        try {
          const parsed = JSON.parse(body);
          msg = Array.isArray(parsed) ? parsed.find((m) => m && m.id === id) ?? null : parsed;
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
  ruleId: 'requires-initialize-handshake' | 'missing-server-discover' | 'legacy-resource-error-code',
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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SPEC_URL } from './constants';

/**
 * Protocol-level conformance fixtures — the runtime companion to the static
 * scan. Static analysis proves known legacy patterns are *absent*; only
 * wire-level tests prove the server actually *speaks* the 2026-07-28 contract.
 * `mcp-vet fixtures <dir>` emits these as ready-to-fire JSON files plus a
 * checklist, so a migration harness (curl, supertest, pytest, ...) can replay
 * them against a real server during rollout.
 */

const NEW_REV = '2026-07-28';
const OLD_REV = '2025-11-25';

/** The per-request `_meta` that replaces the removed initialize handshake. */
const META = {
  protocolVersion: NEW_REV,
  clientInfo: { name: 'mcp-vet-conformance', version: '1.0.0' },
  capabilities: { tools: {} },
};

export interface ConformanceStep {
  /** what to send — a JSON-RPC body, plus any required HTTP headers */
  send: { headers?: Record<string, string>; body: unknown };
  /** what a conformant 2026-07-28 server must do with it */
  expect: string;
}

export interface ConformanceFixture {
  /** file stem, e.g. "01-discover" */
  id: string;
  title: string;
  /** why this fixture exists — the failure mode it exposes */
  description: string;
  steps: ConformanceStep[];
}

const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params: { ...params, _meta: META },
});

const routingHeaders = (method: string, name?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'Mcp-Method': method,
  ...(name ? { 'Mcp-Name': name } : {}),
});

export const CONFORMANCE_FIXTURES: ConformanceFixture[] = [
  {
    id: '01-discover',
    title: 'server/discover replaces the initialize handshake',
    description:
      'A fresh connection must be able to discover server info and capabilities via server/discover with no prior handshake of any kind.',
    steps: [
      {
        send: { headers: routingHeaders('server/discover'), body: rpc(1, 'server/discover') },
        expect:
          'HTTP 200 with a result carrying serverInfo, capabilities, and protocolVersion "' +
          NEW_REV +
          '". Any "session not initialized" style error is a conformance failure.',
      },
    ],
  },
  {
    id: '02-per-request-meta',
    title: 'every request carries and honors _meta',
    description:
      'protocolVersion, clientInfo, and capabilities travel in _meta on every request. A cold request (no prior traffic) must succeed on _meta alone.',
    steps: [
      {
        send: { headers: routingHeaders('tools/list'), body: rpc(1, 'tools/list') },
        expect: 'HTTP 200 with the tool list. The server must not require any earlier request.',
      },
      {
        send: {
          headers: routingHeaders('tools/list'),
          body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        },
        expect:
          'Request WITHOUT _meta: the server must refuse explicitly (JSON-RPC error, e.g. -32602) — not silently assume a protocol revision.',
      },
    ],
  },
  {
    id: '03-http-routing-headers',
    title: 'Mcp-Method / Mcp-Name headers must mirror the body',
    description:
      'Streamable HTTP requires routing headers that mirror the JSON-RPC body; a mismatch must be rejected, not routed by either half.',
    steps: [
      {
        send: {
          headers: routingHeaders('tools/call', 'echo'),
          body: rpc(1, 'tools/call', { name: 'echo', arguments: {} }),
        },
        expect: 'HTTP 200 — headers and body agree.',
      },
      {
        send: {
          headers: routingHeaders('tools/list'),
          body: rpc(2, 'tools/call', { name: 'echo', arguments: {} }),
        },
        expect:
          'HTTP 4xx rejection — the Mcp-Method header says tools/list but the body says tools/call. Accepting either interpretation is a conformance failure.',
      },
    ],
  },
  {
    id: '04-stateless-auth',
    title: 'auth context is derived per-request, not per-session',
    description:
      'With sessions gone there is nowhere to cache an auth handshake. Every request must be authorized from its own credentials.',
    steps: [
      {
        send: {
          headers: { ...routingHeaders('tools/list'), Authorization: 'Bearer <token>' },
          body: rpc(1, 'tools/list'),
        },
        expect:
          'HTTP 200. The same request against a server instance that has never seen this client before must behave identically (no session-bound token cache).',
      },
      {
        send: { headers: routingHeaders('tools/list'), body: rpc(2, 'tools/list') },
        expect:
          'If the server requires auth: HTTP 401/403 on EVERY unauthenticated request — not just the first one of a "session".',
      },
    ],
  },
  {
    id: '05-task-handle-lifecycle',
    title: 'task handles: explicit creation and resume',
    description:
      'tools/call returns a task handle; the client drives it with tasks/get / tasks/update / tasks/cancel using the new argument shapes. tasks/list and tasks/result no longer exist.',
    steps: [
      {
        send: {
          headers: routingHeaders('tools/call', 'long-running'),
          body: rpc(1, 'tools/call', { name: 'long-running', arguments: {} }),
        },
        expect: 'Result contains a task handle (task.taskId per the ' + NEW_REV + ' schema).',
      },
      {
        send: {
          headers: routingHeaders('tasks/get'),
          body: rpc(2, 'tasks/get', { taskId: '<handle-from-step-1>' }),
        },
        expect:
          'Task status (and result once terminal) — including when this request lands on a DIFFERENT server instance than step 1. Poll tasks/get; there is no blocking tasks/result.',
      },
      {
        send: { headers: routingHeaders('tasks/list'), body: rpc(3, 'tasks/list') },
        expect: 'JSON-RPC method-not-found (-32601). tasks/list is removed.',
      },
      {
        send: {
          headers: routingHeaders('tasks/result'),
          body: rpc(4, 'tasks/result', { taskId: '<handle-from-step-1>' }),
        },
        expect: 'JSON-RPC method-not-found (-32601). tasks/result is removed (SEP-2663).',
      },
    ],
  },
  {
    id: '06-duplicate-requests',
    title: 'duplicate request delivery is safe',
    description:
      'Stateless HTTP means retried deliveries happen. Sending the identical request twice must not corrupt state or fail on the second delivery.',
    steps: [
      {
        send: {
          headers: routingHeaders('tools/call', 'echo'),
          body: rpc(1, 'tools/call', { name: 'echo', arguments: { value: 'dup' } }),
        },
        expect: 'HTTP 200.',
      },
      {
        send: {
          headers: routingHeaders('tools/call', 'echo'),
          body: rpc(1, 'tools/call', { name: 'echo', arguments: { value: 'dup' } }),
        },
        expect:
          'Same request, same id, delivered again: a conformant server handles it without "already initialized" / duplicate-session errors.',
      },
    ],
  },
  {
    id: '07-retry-other-instance',
    title: 'retry against a different server instance',
    description:
      'Run the same sequence against two separate instances (or restart the server between steps). Nothing may depend on in-memory per-client state.',
    steps: [
      {
        send: { headers: routingHeaders('tools/list'), body: rpc(1, 'tools/list') },
        expect: 'Send to instance A: HTTP 200.',
      },
      {
        send: { headers: routingHeaders('tools/list'), body: rpc(2, 'tools/list') },
        expect:
          'Send to instance B (no prior traffic from this client): identical behavior. Divergence means hidden session state survived the migration.',
      },
    ],
  },
  {
    id: '08-tools-list-cache-invalidation',
    title: 'tools/list cache invalidation',
    description:
      'Without a session there is no notifications channel to piggyback list_changed on outside of an active request. Clients must revalidate; servers must not serve a stale list after tool changes.',
    steps: [
      {
        send: { headers: routingHeaders('tools/list'), body: rpc(1, 'tools/list') },
        expect: 'Baseline tool list.',
      },
      {
        send: { headers: routingHeaders('tools/list'), body: rpc(2, 'tools/list') },
        expect:
          'After the server adds/removes a tool (harness step): the new list. If the deployment caches tool lists, verify the cache is invalidated on change.',
      },
    ],
  },
  {
    id: '09-downgrade-refusal',
    title: 'old-revision requests are refused, not silently accepted',
    description:
      'A request declaring protocolVersion ' +
      OLD_REV +
      ' (or arriving in the old handshake style) must get an explicit refusal — processing it under new semantics silently is the worst failure mode.',
    steps: [
      {
        send: {
          headers: routingHeaders('tools/list'),
          body: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: { _meta: { ...META, protocolVersion: OLD_REV } },
          },
        },
        expect:
          'Explicit JSON-RPC error naming the supported revision(s) — unless the server intentionally supports both revisions during rollout, in which case it must apply ' +
          OLD_REV +
          ' semantics consistently for this request.',
      },
      {
        send: {
          headers: routingHeaders('initialize'),
          body: {
            jsonrpc: '2.0',
            id: 2,
            method: 'initialize',
            params: { protocolVersion: OLD_REV, clientInfo: META.clientInfo, capabilities: {} },
          },
        },
        expect:
          'A ' +
          NEW_REV +
          '-only server: method-not-found (-32601). A dual-revision server: a valid ' +
          OLD_REV +
          ' initialize result. Anything else (crash, silent success under new semantics) fails.',
      },
    ],
  },
  {
    id: '10-subscriptions-listen',
    title: 'subscriptions/listen opt-in replaces resource subscriptions',
    description:
      'The final changelog replaces the HTTP GET endpoint and resources/subscribe/resources/unsubscribe with subscriptions/listen: "Clients opt in to specific types (toolsListChanged, promptsListChanged, resourcesListChanged, resourceSubscriptions); the server acknowledges and tags notifications with io.modelcontextprotocol/subscriptionId."',
    steps: [
      {
        send: {
          headers: routingHeaders('subscriptions/listen'),
          body: rpc(1, 'subscriptions/listen', {
            subscriptions: {
              toolsListChanged: true,
              resourcesListChanged: true,
            },
          }),
        },
        expect:
          'A long-lived POST-response stream. The server acknowledges the opted-in types; every change notification it later sends on this stream carries _meta["io.modelcontextprotocol/subscriptionId"]. Types the client did NOT opt into (promptsListChanged, resourceSubscriptions here) must not be delivered.',
      },
      {
        send: {
          headers: routingHeaders('resources/subscribe'),
          body: rpc(2, 'resources/subscribe', { uri: 'demo://resource/1' }),
        },
        expect:
          'JSON-RPC method-not-found (-32601). resources/subscribe (and resources/unsubscribe) are removed on ' +
          NEW_REV +
          '.',
      },
    ],
  },
  {
    id: '11-mrtr',
    title: 'MRTR: input_required interim results and client retry',
    description:
      'Multi Round-Trip Requests (SEP-2322) replace server-initiated requests (roots/list, sampling/createMessage, elicitation/create): the server returns resultType "input_required" with inputRequests, and the client retries the ORIGINAL request with inputResponses.',
    steps: [
      {
        send: {
          headers: routingHeaders('tools/call', 'book-flight'),
          body: rpc(1, 'tools/call', { name: 'book-flight', arguments: { date: '2026-08-01' } }),
        },
        expect:
          'If the tool needs more information: a result with resultType "input_required", an inputRequests array carrying the requests, and (optionally) requestState the server uses to correlate the retry. NOT a server-initiated elicitation/create request — those are replaced by this pattern.',
      },
      {
        send: {
          headers: routingHeaders('tools/call', 'book-flight'),
          body: rpc(2, 'tools/call', {
            name: 'book-flight',
            arguments: { date: '2026-08-01' },
            inputResponses: [{ id: '<from-step-1-inputRequests>', value: '<user answer>' }],
            requestState: '<from-step-1, if provided>',
          }),
        },
        expect:
          'The retried ORIGINAL request, now carrying inputResponses, completes with resultType "complete". A server that instead waits for notifications/elicitation/complete (removed) or an elicitationId correlation (removed) fails.',
      },
    ],
  },
];

function checklist(): string {
  const lines: string[] = [
    '# mcp-vet conformance checklist (2026-07-28)',
    '',
    'The static scan proves known legacy patterns are absent from your source.',
    'These fixtures prove the running server actually speaks the new wire contract.',
    'Replay each `*.json` fixture against your server with your HTTP harness of',
    'choice (curl, supertest, pytest + httpx, ...) and check the `expect` notes.',
    '',
    `Spec: ${SPEC_URL}`,
    '',
    '## The dual-version rollout matrix',
    '',
    `**July 28 is a specification release date, not a switch that remotely disables`,
    `existing deployments.** Breakage appears when a client and server negotiate or`,
    `require the new revision. Until every client you care about has moved, your`,
    `production test matrix needs BOTH paths:`,
    '',
    `- \`${OLD_REV}\` client -> your server (old semantics, or an explicit refusal)`,
    `- \`${NEW_REV}\` client -> your server (new semantics)`,
    '',
    'Run fixture 09 in both configurations. Verify refusal is explicit — a server',
    'that silently accepts a request under the wrong semantics is the failure mode',
    'that reaches production.',
    '',
    '## Fixtures',
    '',
  ];
  for (const f of CONFORMANCE_FIXTURES) {
    lines.push(`- [ ] **${f.id}** — ${f.title}`);
    lines.push(`      ${f.description}`);
  }
  lines.push(
    '',
    '## Client-side assumptions (test these too)',
    '',
    'Reliability bugs also hide in clients that still behave as if they own a',
    'session while the server is stateless:',
    '',
    '- [ ] client works with `sessionId: undefined` / no stored session id',
    '- [ ] client sends full `_meta` on every request, not just the first',
    '- [ ] client survives its next request landing on a different server instance',
    '- [ ] client retries do not depend on server-side per-client state',
    '- [ ] client revalidates tools/list instead of trusting list_changed pushes',
    '',
  );
  return lines.join('\n');
}

export interface EmitResult {
  dir: string;
  files: string[];
}

/** Write all conformance fixtures plus CHECKLIST.md into `dir`. */
export function emitConformanceFixtures(dir: string): EmitResult {
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const f of CONFORMANCE_FIXTURES) {
    const p = path.join(dir, `${f.id}.json`);
    fs.writeFileSync(p, JSON.stringify(f, null, 2) + '\n', 'utf8');
    files.push(p);
  }
  const cl = path.join(dir, 'CHECKLIST.md');
  fs.writeFileSync(cl, checklist(), 'utf8');
  files.push(cl);
  return { dir, files };
}

import { Token } from './types';

/**
 * Degraded, regex-based tokenizer for Python source, used ONLY when no Python
 * interpreter is available. It cannot verify AST structure, so capability
 * findings fall back to the line-proximity heuristic (medium confidence) and it
 * may over-report inside comments/docstrings. Deterministic string/number rules
 * (session id, initialize, -32002, tasks/*) remain reliable.
 */
export function regexFallbackTokens(text: string): Token[] {
  const tokens: Token[] = [];
  const lines = text.split(/\r?\n/);

  const strRe = /(['"])((?:\\.|(?!\1).)*)\1/g;
  const numRe = /-?\b\d+\b/g;
  const idRe = /[A-Za-z_][A-Za-z0-9_]*/g;
  const capKeyRe = /\b(roots|sampling|logging)\s*[:=]/g;
  // PY_SDK_V1 surfaces (SDK v1→v2 migration, 0.12.0). Import lines feed both
  // the group's `import mcp` gate and the module-path rules; the rest mirror
  // the AST scanner's attribute/kwarg context flags at line granularity.
  const importRe = /^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/;
  const pySdkNameRe = /^(?:McpError|streamablehttp_client|websocket_client|RFC7523OAuthClientProvider|JWTParameters|environ|getenv)$/;
  const camelAttrRe = /\.\s*(inputSchema|outputSchema|isError|nextCursor)\b/g;
  const camelKwargRe = /\b(inputSchema|outputSchema|isError|nextCursor)\s*=[^=]/g;
  const getContextRe = /\.\s*(get_context)\s*\(/g;
  const timedeltaKwargRe = /\b([A-Za-z_]\w*timeout\w*|read_timeout_seconds)\s*=\s*(?:datetime\s*\.\s*)?timedelta\s*\(/g;
  const calleeKwargRe = /\b([A-Za-z_]\w*)\s*\([^()]*?\b(scopes|timeout|cache|is_binary)\s*=\s*([A-Za-z_]\w*|\[|['"{]|\d+)?/g;
  // HTTP+SSE transport surfaces (SSE_TRANSPORT_DEPRECATED, SEP-2596). The
  // module path is not a quoted string in Python, so it needs its own match;
  // the literal transport/event forms are marked like the AST analyzers do.
  const sseModuleRe = /\bmcp\.(?:server|client)\.sse\b/g;
  const sseHelperRe = /^(?:sse_client|sse_app|connect_sse|handle_post_message)$/;
  const sseTransportValRe = /\btransport['"]?\s*[:=]\s*(['"])sse\1/g;
  const sseEndpointValRe = /\bevent['"]?\s*[:=]\s*(['"])endpoint\1/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    let m: RegExpExecArray | null;

    strRe.lastIndex = 0;
    while ((m = strRe.exec(line)) !== null) {
      tokens.push({ kind: 'string', value: m[2], line: ln, col: m.index + 1 });
    }

    numRe.lastIndex = 0;
    while ((m = numRe.exec(line)) !== null) {
      tokens.push({ kind: 'number', value: m[0], line: ln, col: m.index + 1 });
    }

    idRe.lastIndex = 0;
    while ((m = idRe.exec(line)) !== null) {
      const v = m[0];
      // Only names that can matter to a rule (keeps the token list small).
      if (/mcpsessionid/i.test(v)) {
        tokens.push({ kind: 'name', value: v, line: ln, col: m.index + 1 });
      }
      const norm = v.toLowerCase().replace(/[-_]/g, '');
      if (
        norm === 'sseservertransport' ||
        norm === 'sseclienttransport' ||
        sseHelperRe.test(v.toLowerCase())
      ) {
        tokens.push({ kind: 'name', value: v, line: ln, col: m.index + 1 });
      }
      if (pySdkNameRe.test(v)) {
        tokens.push({ kind: 'name', value: v, line: ln, col: m.index + 1 });
      }
    }

    // Import lines: the modules gate/drive the PY_SDK_V1 group, the imported
    // names count as import-context usages of the v1 vocabulary.
    const im = importRe.exec(line);
    if (im) {
      const modules = (im[1] ?? im[2] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
      for (const mod of modules) {
        // Same allowlist as the AST scanner: only mcp/httpx module paths are
        // surfaced, so `import initialize` can't collide with method-string rules.
        if (!/^(mcp|httpx)(\.|$)/.test(mod)) continue;
        tokens.push({
          kind: 'string',
          value: mod,
          line: ln,
          col: line.indexOf(mod) + 1,
          importModule: true,
        });
      }
      idRe.lastIndex = 0;
      while ((m = idRe.exec(line)) !== null) {
        if (pySdkNameRe.test(m[0]) || m[0] === 'httpx') {
          tokens.push({ kind: 'name', value: m[0], line: ln, col: m.index + 1, importName: true });
        }
      }
    }

    camelAttrRe.lastIndex = 0;
    while ((m = camelAttrRe.exec(line)) !== null) {
      tokens.push({ kind: 'name', value: m[1], line: ln, col: line.indexOf(m[1], m.index) + 1, attr: true });
    }

    camelKwargRe.lastIndex = 0;
    while ((m = camelKwargRe.exec(line)) !== null) {
      tokens.push({ kind: 'key', value: m[1], line: ln, col: m.index + 1, kwarg: true });
    }

    getContextRe.lastIndex = 0;
    while ((m = getContextRe.exec(line)) !== null) {
      tokens.push({ kind: 'name', value: 'get_context', line: ln, col: line.indexOf('get_context', m.index) + 1, attr: true });
    }

    timedeltaKwargRe.lastIndex = 0;
    while ((m = timedeltaKwargRe.exec(line)) !== null) {
      tokens.push({ kind: 'key', value: m[1], line: ln, col: m.index + 1, kwarg: true, timedeltaValue: true });
    }

    // Single-line `Callee(..., kwarg=value)` shapes — multi-line calls are a
    // documented miss of the degraded path.
    calleeKwargRe.lastIndex = 0;
    while ((m = calleeKwargRe.exec(line)) !== null) {
      const tok: Token = {
        kind: 'key',
        value: m[2],
        line: ln,
        col: line.indexOf(m[2], m.index) + 1,
        kwarg: true,
        callee: m[1],
      };
      if (m[2] === 'cache' && /\bcache\s*=\s*False\b/.test(line)) tok.isFalse = true;
      tokens.push(tok);
    }

    capKeyRe.lastIndex = 0;
    while ((m = capKeyRe.exec(line)) !== null) {
      tokens.push({ kind: 'key', value: m[1], line: ln, col: m.index + 1 });
    }

    sseModuleRe.lastIndex = 0;
    while ((m = sseModuleRe.exec(line)) !== null) {
      tokens.push({ kind: 'string', value: m[0], line: ln, col: m.index + 1 });
    }

    sseTransportValRe.lastIndex = 0;
    while ((m = sseTransportValRe.exec(line)) !== null) {
      tokens.push({ kind: 'key', value: 'transport', line: ln, col: m.index + 1, transportSse: true });
    }

    sseEndpointValRe.lastIndex = 0;
    while ((m = sseEndpointValRe.exec(line)) !== null) {
      tokens.push({ kind: 'key', value: 'event', line: ln, col: m.index + 1, sseEndpointEvent: true });
    }
  }

  return tokens;
}

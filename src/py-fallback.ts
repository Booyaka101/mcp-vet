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

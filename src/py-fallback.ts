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
    }

    capKeyRe.lastIndex = 0;
    while ((m = capKeyRe.exec(line)) !== null) {
      tokens.push({ kind: 'key', value: m[1], line: ln, col: m.index + 1 });
    }
  }

  return tokens;
}

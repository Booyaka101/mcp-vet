import { Project, SyntaxKind, Node } from 'ts-morph';
import { Token } from './types';

let project: Project | null = null;
let counter = 0;

const CAP = new Set(['roots', 'sampling', 'logging']);
const INIT_STRINGS = new Set(['initialize', 'notifications/initialized']);
// SSE-resumability option keys (SEP-2575 removal) — flagged at high confidence
// only when passed to something transport/client shaped.
const SSE_OPTION_KEYS = new Set(['eventStore', 'resumptionToken', 'onresumptiontoken']);

function getProject(): Project {
  if (!project) {
    project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        noLib: true, // pure syntactic extraction — no type checking / lib needed
      },
    });
  }
  return project;
}

function scanExtension(absPath: string): string {
  const p = absPath.toLowerCase();
  if (p.endsWith('.tsx')) return '.tsx';
  if (p.endsWith('.jsx')) return '.jsx';
  if (p.endsWith('.mts') || p.endsWith('.cts')) return '.ts';
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return '.js';
  return '.ts';
}

function safePropName(node: Node): string | undefined {
  const pa =
    node.asKind(SyntaxKind.PropertyAssignment) ??
    node.asKind(SyntaxKind.ShorthandPropertyAssignment);
  try {
    return pa?.getName();
  } catch {
    return undefined;
  }
}

const TRANSPORTISH = /transport|client/i;

// Credential-store shapes (SEP-2352): a persist-ish call whose value side
// carries client_id/client_secret. The KEY argument is classified — an
// issuer-derived key is the migrated form; a bare string constant or a
// server/resource-URL variable violates the issuer-keying MUST.
const STORE_VERBS = /^(set|setItem|put|add|write)$/i;
const STOREISH_SUBSTR = /save|store|persist|upsert|cache|credential/i;
const CREDENTIALISH = /client_secret|clientSecret|client_id|clientId|credential/i;
const SERVERISH_KEY = /server|url|uri|resource|endpoint|host|base|target|mcp/i;
const ISSUERISH = /\biss\b|issuer/i;
// A server-side ACCESS-TOKEN cache is not a client credential store: SEP-2352
// covers the credentials a client obtains from registration. A client_secret in
// the value settles it the other way — only registration hands one out.
const TOKENISH = /(^|[._])tokens?([._]|$)|access_?token|oauth_?token|refresh_?token|bearer_?token/i;
const CLIENT_SECRETISH = /client_secret|clientSecret/i;
const looksLikeTokenStore = (containerText: string, valueText: string): boolean =>
  !CLIENT_SECRETISH.test(valueText) && (TOKENISH.test(containerText) || TOKENISH.test(valueText));

/**
 * Is `node` inside a call/constructor argument of something transport/client
 * shaped (e.g. `new StreamableHTTPClientTransport(url, { sessionId })`)?
 * Drives the client-side session-ownership check.
 */
function isClientTransportContext(node: Node): boolean {
  let depth = 0;
  for (const anc of node.getAncestors()) {
    if (depth++ > 8) break;
    const k = anc.getKind();
    if (k === SyntaxKind.CallExpression || k === SyntaxKind.NewExpression) {
      const expr = (anc as any).getExpression?.();
      if (expr && TRANSPORTISH.test(expr.getText())) return true;
    }
  }
  return false;
}

/**
 * Is this numeric literal in a JSON-RPC error `code` position? Accepts the
 * value of a `code:` property, an argument to an *Error(...) call/constructor,
 * or a ==/=== comparison against something named code. Guards
 * ERROR_CODE_RENUMBERED (-32000..-32019 stays implementation-defined).
 */
function isErrorCodeContext(anchor: Node): boolean {
  const parent = anchor.getParent();
  if (!parent) return false;

  // { code: -32001 }
  if (parent.getKind() === SyntaxKind.PropertyAssignment) {
    try {
      const pa = parent.asKind(SyntaxKind.PropertyAssignment)!;
      if (pa.getName() === 'code' && pa.getInitializer()?.getStart() === anchor.getStart()) {
        return true;
      }
    } catch {
      /* computed key */
    }
  }

  // err.code === -32001  /  code == -32001
  if (parent.getKind() === SyntaxKind.BinaryExpression) {
    const be = parent.asKind(SyntaxKind.BinaryExpression)!;
    const op = be.getOperatorToken().getKind();
    if (op === SyntaxKind.EqualsEqualsEqualsToken || op === SyntaxKind.EqualsEqualsToken) {
      const left = be.getLeft();
      const other = left.getStart() === anchor.getStart() ? be.getRight() : left;
      if (/code/i.test(other.getText())) return true;
    }
  }

  // new McpError(-32001, ...) / makeRpcError(-32001, ...)
  if (
    parent.getKind() === SyntaxKind.CallExpression ||
    parent.getKind() === SyntaxKind.NewExpression
  ) {
    const expr = (parent as any).getExpression?.();
    if (expr && /error/i.test(expr.getText())) return true;
  }

  return false;
}

/** Is `node` structurally inside a `capabilities` object / call argument? */
function isInCapabilities(node: Node): boolean {
  let depth = 0;
  for (const anc of node.getAncestors()) {
    if (depth++ > 12) break;
    const k = anc.getKind();
    if (k === SyntaxKind.PropertyAssignment || k === SyntaxKind.ShorthandPropertyAssignment) {
      if (safePropName(anc) === 'capabilities') return true;
    } else if (k === SyntaxKind.VariableDeclaration) {
      try {
        if (anc.asKind(SyntaxKind.VariableDeclaration)!.getName() === 'capabilities') return true;
      } catch {
        /* ignore */
      }
    } else if (k === SyntaxKind.CallExpression || k === SyntaxKind.NewExpression) {
      const expr = (anc as any).getExpression?.();
      if (expr && /capabilit/i.test(expr.getText())) return true;
    }
  }
  return false;
}

/**
 * Is this string literal used like a registered method name? `strict` drops the
 * `name:` property form — a tool literally *named* "ping" is legal and common,
 * so PING_REMOVED only accepts method/type keys, cases, comparisons and handler
 * registration.
 */
function isRegistrationContext(node: Node, strict = false): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  // switch (x) { case 'initialize': }
  if (parent.getKind() === SyntaxKind.CaseClause) return true;

  // x.method === 'initialize'
  if (parent.getKind() === SyntaxKind.BinaryExpression) {
    const be = parent.asKind(SyntaxKind.BinaryExpression)!;
    const op = be.getOperatorToken().getKind();
    if (op === SyntaxKind.EqualsEqualsEqualsToken || op === SyntaxKind.EqualsEqualsToken) {
      const left = be.getLeft();
      const other = left.getStart() === node.getStart() ? be.getRight() : left;
      if (/method|type/i.test(other.getText())) return true;
    }
  }

  // { method: 'initialize' }
  if (parent.getKind() === SyntaxKind.PropertyAssignment) {
    const pa = parent.asKind(SyntaxKind.PropertyAssignment)!;
    try {
      if (
        pa.getInitializer()?.getStart() === node.getStart() &&
        (strict ? /^(method|type)$/i : /^(method|type|name)$/i).test(pa.getName())
      ) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  // server.setRequestHandler('initialize', handler)
  let cur: Node | undefined = node;
  for (let i = 0; i < 4 && cur; i++) {
    const p = cur.getParent();
    if (!p) break;
    if (p.getKind() === SyntaxKind.CallExpression) {
      const call = p.asKind(SyntaxKind.CallExpression)!;
      const isArg = call
        .getArguments()
        .some((a) => a.getStart() === cur!.getStart() && a.getEnd() === cur!.getEnd());
      if (isArg) {
        const exprText = call.getExpression().getText();
        // strict: registerTool('ping', ...) registers a TOOL NAME, not a method.
        if (strict && /tool|prompt|resource/i.test(exprText)) break;
        if (/handler|handle|register|method|route|request|notification|(^|\.)on$/i.test(exprText)) {
          return true;
        }
      }
      break;
    }
    cur = p;
  }
  return false;
}

/**
 * Parse a TypeScript/JavaScript file with ts-morph and emit normalized tokens:
 * string literals, numeric literals (with sign), identifiers, and object keys —
 * annotated with structural capability context and registration context.
 */
export function analyzeTs(absPath: string, text: string): Token[] {
  const proj = getProject();
  const ext = scanExtension(absPath);
  const sf = proj.createSourceFile(`__scan_${counter++}${ext}`, text, { overwrite: true });
  const tokens: Token[] = [];

  const posOf = (node: Node) => {
    try {
      const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
      return { line, col: column };
    } catch {
      return { line: node.getStartLineNumber(), col: undefined as number | undefined };
    }
  };

  // Aliased named imports (`import { InitializeRequestSchema as Init }`): map the
  // local alias back to its canonical SDK name so *usage sites* are flagged too,
  // not just the import line where the original identifier happens to appear.
  const aliases = new Map<string, string>();
  try {
    for (const imp of sf.getImportDeclarations()) {
      for (const spec of imp.getNamedImports()) {
        const aliasNode = spec.getAliasNode();
        if (aliasNode) aliases.set(aliasNode.getText(), spec.getName());
      }
    }
  } catch {
    /* ignore malformed imports */
  }

  try {
    sf.forEachDescendant((node) => {
      const kind = node.getKind();

      if (
        kind === SyntaxKind.StringLiteral ||
        kind === SyntaxKind.NoSubstitutionTemplateLiteral
      ) {
        let value: string;
        try {
          value = (node as any).getLiteralValue();
        } catch {
          const raw = node.getText();
          value = raw.length >= 2 ? raw.slice(1, -1) : raw;
        }
        const { line, col } = posOf(node);
        const tok: Token = { kind: 'string', value, line, col };
        if (CAP.has(value)) tok.inCapabilities = isInCapabilities(node);
        if (INIT_STRINGS.has(value)) tok.registration = isRegistrationContext(node);
        // 'ping' uses the STRICT registration check (a tool `name: 'ping'` is
        // legal and must not count as MCP method registration).
        if (value === 'ping') tok.registration = isRegistrationContext(node, true);
        tokens.push(tok);
        return;
      }

      if (kind === SyntaxKind.NumericLiteral) {
        const raw = node.getText();
        let value = raw;
        let anchor: Node = node; // for negatives, anchor at the '-' so col + value.length is exact
        const parent = node.getParent();
        if (parent && parent.getKind() === SyntaxKind.PrefixUnaryExpression) {
          const pu = parent.asKind(SyntaxKind.PrefixUnaryExpression);
          if (pu && pu.getOperatorToken() === SyntaxKind.MinusToken) {
            value = '-' + raw;
            anchor = parent;
          }
        }
        const { line, col } = posOf(anchor);
        const tok: Token = { kind: 'number', value, line, col };
        if (isErrorCodeContext(anchor)) tok.errorCode = true;
        tokens.push(tok);
        return;
      }

      if (kind === SyntaxKind.Identifier) {
        const { line, col } = posOf(node);
        const text = node.getText();
        tokens.push({ kind: 'name', value: text, line, col });
        // An aliased identifier also counts as its canonical imported name —
        // except inside the import specifier itself, where the original
        // identifier is already present (avoids a duplicate import-line finding).
        const original = aliases.get(text);
        if (original && node.getParent()?.getKind() !== SyntaxKind.ImportSpecifier) {
          tokens.push({ kind: 'name', value: original, line, col });
        }
        return;
      }
    });

    // Client-side session ownership: reads of `<transport>.sessionId` mean the
    // client still behaves as if it owns a session against a stateless server.
    for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      try {
        if (pae.getName() !== 'sessionId') continue;
        if (!TRANSPORTISH.test(pae.getExpression().getText())) continue;
        const { line, col } = posOf(pae.getNameNode());
        tokens.push({ kind: 'name', value: 'sessionId', line, col, clientSession: true });
      } catch {
        /* ignore */
      }
    }

    // Credential-store writes (SEP-2352). Two shapes: a persist-ish call
    // (`store.set(key, creds)`, `saveCredentials(key, ...)`) and an
    // element-access assignment (`creds[serverUrl] = {...}`). The key is only
    // marked when it is clearly NOT issuer-derived; computed keys (template
    // expressions, function calls) are skipped — a documented miss.
    const emitCredKey = (keyNode: Node) => {
      const keyText = keyNode.getText();
      if (ISSUERISH.test(keyText)) return; // issuer-keyed — the migrated form
      // `data['client_secret'] = ...` builds a token-REQUEST body; the key is
      // the OAuth field name, not a store key. Never a credential store.
      if (CREDENTIALISH.test(keyText)) return;
      const k = keyNode.getKind();
      const { line, col } = posOf(keyNode);
      if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) {
        let value: string;
        try {
          value = (keyNode as any).getLiteralValue();
        } catch {
          value = keyText;
        }
        tokens.push({ kind: 'string', value, line, col, credKey: true });
      } else if (
        (k === SyntaxKind.Identifier || k === SyntaxKind.PropertyAccessExpression) &&
        SERVERISH_KEY.test(keyText)
      ) {
        tokens.push({ kind: 'name', value: keyText, line, col, credKey: true });
      }
      // anything else is computed/indirect — unknown, deliberately not flagged
    };
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      try {
        const expr = call.getExpression();
        const calleeName =
          expr.getKind() === SyntaxKind.PropertyAccessExpression
            ? expr.asKind(SyntaxKind.PropertyAccessExpression)!.getName()
            : expr.getText();
        if (!STORE_VERBS.test(calleeName) && !STOREISH_SUBSTR.test(calleeName)) continue;
        const args = call.getArguments();
        if (args.length < 2) continue;
        const valueText = args.slice(1).map((a) => a.getText()).join(' ');
        if (!CREDENTIALISH.test(valueText) && !/credential/i.test(calleeName)) continue;
        if (looksLikeTokenStore(expr.getText(), valueText)) continue;
        emitCredKey(args[0]);
      } catch {
        /* ignore */
      }
    }
    for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      try {
        if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
        const left = bin.getLeft();
        if (left.getKind() !== SyntaxKind.ElementAccessExpression) continue;
        const ea = left.asKind(SyntaxKind.ElementAccessExpression)!;
        const baseText = ea.getExpression().getText();
        const rhsText = bin.getRight().getText();
        if (!CREDENTIALISH.test(rhsText) && !/credential/i.test(baseText)) continue;
        if (looksLikeTokenStore(baseText, rhsText)) continue;
        const arg = ea.getArgumentExpression();
        if (arg) emitCredKey(arg);
      } catch {
        /* ignore */
      }
    }

    // Object literal keys (roots:, "sampling":, logging shorthand, ...)
    const emitKey = (nameNode: Node, value: string, benign = false) => {
      const { line, col } = posOf(nameNode);
      const tok: Token = { kind: 'key', value, line, col };
      if (CAP.has(value)) tok.inCapabilities = isInCapabilities(nameNode);
      if (benign) tok.benign = true;
      // `sessionId` passed into a client transport constructor/factory = the
      // client resuming/owning a session.
      if (value === 'sessionId' && isClientTransportContext(nameNode)) {
        tok.clientSession = true;
      }
      // SSE-resumability options handed to a transport (eventStore, resumption
      // token callbacks) — removed by 2026-07-28 (SEP-2575).
      if (SSE_OPTION_KEYS.has(value) && isClientTransportContext(nameNode)) {
        tok.transportCtx = true;
      }
      tokens.push(tok);
    };
    for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      try {
        const name = pa.getName();
        // `sessionIdGenerator: undefined` / `sessionId: undefined` (or null) is
        // the migrated, stateless form.
        let benign = false;
        if (name === 'sessionIdGenerator' || name === 'sessionId') {
          const init = pa.getInitializer()?.getText();
          benign = init === 'undefined' || init === 'null';
        }
        emitKey(pa.getNameNode(), name, benign);
      } catch {
        /* computed / unusual key */
      }
    }
    for (const sp of sf.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)) {
      try {
        emitKey(sp.getNameNode(), sp.getName());
      } catch {
        /* ignore */
      }
    }
  } finally {
    proj.removeSourceFile(sf);
  }

  return tokens;
}

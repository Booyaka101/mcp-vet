import { Project, SyntaxKind, Node } from 'ts-morph';
import { Token } from './types';

let project: Project | null = null;
let counter = 0;

const CAP = new Set(['roots', 'sampling', 'logging']);
const INIT_STRINGS = new Set(['initialize', 'notifications/initialized']);

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

/** Is this string literal used like a registered method name? */
function isRegistrationContext(node: Node): boolean {
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
        /^(method|type|name)$/i.test(pa.getName())
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
        tokens.push({ kind: 'number', value, line, col });
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

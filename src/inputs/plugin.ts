/**
 * Agent Plugins 1.0 package input (`mcp-vet plugin <dir>`).
 *
 * Validates the plugin envelope against the vendored 1.0.0 schemas, applies the
 * semantic rules the schemas cannot express (single-token command, URL
 * security, cwd containment, skills layout), and runs the 22 static source
 * rules over server code the plugin bundles via a `./`-relative stdio command.
 *
 * Manifest findings are severity-split by what a conformant client does, not
 * by what the schema says (agent-plugins-spec#77): FATAL rejects, TOLERATED
 * reports-and-loads (§5.2 unknown top-level fields, §8.1 non-object
 * extensions). Every envelope finding carries the spec section it cites.
 *
 * A server whose code cannot be reached (bare launcher token, remote URL,
 * non-source executable) gets a note saying why, never a silent skip.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Finding, PluginRuleId, ALL_PATTERN_IDS } from '../types';
import { PLUGIN_RULES } from '../rules';
import { scan, PythonMode } from '../scanner';
import { IgnoreMatcher } from '../ignore';

export class PluginVetError extends Error {}

const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build']);

export interface PluginVetOptions {
  pythonFallback?: boolean;
  /** 0 = no limit */
  maxFileSizeKb?: number;
}

export interface PluginServerInfo {
  name: string;
  /** the declared transport type, verbatim ('stdio' | 'streamable-http' | 'sse' | other) */
  type: string;
  /** true when bundled source for this server was scanned with the 22 static rules */
  scanned: boolean;
  /** plugin-relative paths of the scanned source files */
  scannedFiles: string[];
  /** why this server's code could not be scanned (bare token, remote, binary) */
  unscannableReason?: string;
}

export interface PluginVetResult {
  findings: Finding[];
  pluginDir: string;
  pluginName: string | null;
  hasMcpJson: boolean;
  servers: PluginServerInfo[];
  /** valid skills discovered at skills/<name>/SKILL.md */
  skillCount: number;
  /** unscannable-by-design reasons and other advisories — printed, never silent */
  notes: string[];
  /** how bundled Python source (if any) was analyzed */
  pythonMode: PythonMode;
  /** bundled source files scanned with the 22 static rules */
  sourceFilesScanned: number;
}

// Vendored schemas, loaded from the package rather than fetched: the spec says
// "Clients MUST NOT retrieve a schema while loading a plugin".

function loadVendoredSchema(name: string): any {
  const candidates = [
    path.join(__dirname, '..', '..', 'schemas', 'agent-plugins', '1.0.0', name), // dist/inputs -> package root
    path.join(__dirname, '..', '..', '..', 'schemas', 'agent-plugins', '1.0.0', name),
  ];
  for (const c of candidates) {
    try {
      return JSON.parse(fs.readFileSync(c, 'utf8'));
    } catch {
      /* try next */
    }
  }
  throw new PluginVetError(
    `vendored schema ${name} is missing next to the package — reinstall @booyaka/mcp-vet`,
  );
}

let pluginSchemaCache: any;
let mcpSchemaCache: any;
function pluginSchema(): any {
  return (pluginSchemaCache ??= loadVendoredSchema('plugin.schema.json'));
}
function mcpSchema(): any {
  return (mcpSchemaCache ??= loadVendoredSchema('mcp.schema.json'));
}

// JSON Schema evaluator covering the keyword subset the two vendored schemas
// use. Driven by the schema files, so vendoring an updated schema needs no code
// change; a schema using keywords beyond this subset would need one.

interface SchemaError {
  /** dotted instance path relative to the validated value, '' for the root */
  path: string;
  keyword: string;
  message: string;
  /** for additionalProperties errors: the path of the object that rejected the key */
  parent?: string;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function deref(schema: any, root: any): any {
  if (schema && typeof schema.$ref === 'string') {
    const m = /^#\/\$defs\/([^/]+)$/.exec(schema.$ref);
    if (m && root.$defs && root.$defs[m[1]]) return root.$defs[m[1]];
  }
  return schema;
}

function validateSchema(
  schema: any,
  root: any,
  value: unknown,
  p: string,
  errors: SchemaError[],
): void {
  schema = deref(schema, root);
  if (schema === true || schema == null) return;
  const t = typeOf(value);
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path: p, keyword: 'const', message: `must be ${JSON.stringify(schema.const)}` });
    return;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push({
      path: p,
      keyword: 'enum',
      message: `must be one of ${schema.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}`,
    });
    return;
  }
  if (schema.not !== undefined) {
    const sub: SchemaError[] = [];
    validateSchema(schema.not, root, value, p, sub);
    if (sub.length === 0) {
      errors.push({ path: p, keyword: 'not', message: 'matches a disallowed value' });
    }
  }
  if (schema.type !== undefined) {
    const want: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = want.some(
      (w) => w === t || (w === 'integer' && t === 'number' && Number.isInteger(value)),
    );
    if (!ok) {
      errors.push({ path: p, keyword: 'type', message: `must be ${want.join(' or ')}, got ${t}` });
      return;
    }
  }
  if (t === 'string') {
    const s = value as string;
    if (schema.minLength !== undefined && s.length < schema.minLength) {
      errors.push({
        path: p,
        keyword: 'minLength',
        message: `must be at least ${schema.minLength} character(s)`,
      });
    }
    if (schema.maxLength !== undefined && s.length > schema.maxLength) {
      errors.push({
        path: p,
        keyword: 'maxLength',
        message: `must be at most ${schema.maxLength} characters`,
      });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(s)) {
      errors.push({ path: p, keyword: 'pattern', message: `must match ${schema.pattern}` });
    }
  }
  if (t === 'array' && schema.items !== undefined) {
    (value as unknown[]).forEach((item, i) =>
      validateSchema(schema.items, root, item, `${p}[${i}]`, errors),
    );
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) {
      if (!(req in obj)) {
        errors.push({ path: p, keyword: 'required', message: `missing required field "${req}"` });
      }
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      const kp = p ? `${p}.${k}` : k;
      if (schema.propertyNames !== undefined) {
        const sub: SchemaError[] = [];
        validateSchema(schema.propertyNames, root, k, kp, sub);
        if (sub.length > 0) {
          errors.push({
            path: kp,
            keyword: 'propertyNames',
            message: `property name "${k}" is not allowed`,
          });
        }
      }
      if (k in props) {
        validateSchema(props[k], root, v, kp, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: kp, keyword: 'additionalProperties', message: `unknown field "${k}"`, parent: p });
      } else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
        validateSchema(schema.additionalProperties, root, v, kp, errors);
      }
    }
  }
}

function snippet(lines: string[], line: number): string {
  const idx = line - 1;
  const out: string[] = [];
  if (lines[idx] !== undefined) out.push(`${line}: ${lines[idx].trim()}`);
  if (lines[idx + 1] !== undefined) out.push(`${line + 1}: ${lines[idx + 1].trim()}`);
  return out.join('\n');
}

/**
 * Best-effort line/column of a key in raw JSON text, walking key segments in
 * document order (`["mcpServers", "legacy", "url"]`). Array indices in
 * validator paths are stripped before lookup. Falls back to line 1.
 */
function locateKey(raw: string, segments: string[]): { line: number; col?: number } {
  let idx = 0;
  let found = -1;
  for (const seg of segments) {
    const esc = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`"${esc}"\\s*:`, 'g');
    re.lastIndex = idx;
    const m = re.exec(raw);
    if (!m) return found >= 0 ? posOf(raw, found) : { line: 1 };
    found = m.index;
    idx = m.index + m[0].length;
  }
  return found >= 0 ? posOf(raw, found) : { line: 1 };
}

function posOf(raw: string, index: number): { line: number; col: number } {
  const upto = raw.slice(0, index);
  const line = upto.split('\n').length;
  const nl = upto.lastIndexOf('\n');
  return { line, col: index - nl };
}

/** Splits a validator path into locator segments, dropping array indices. */
function pathSegments(p: string): string[] {
  return p
    .split('.')
    .map((s) => s.replace(/\[\d+\]$/, ''))
    .filter(Boolean);
}

/**
 * Which 1.0.0 section a FATAL manifest schema error violates: §5.3 covers a
 * required field that is "missing, has the wrong type, is empty, or otherwise
 * violates its requirements", §5.2 the unrecognized-$schema rejection, §5.5
 * the name constraints, §5.4 the metadata fields.
 */
function manifestSection(e: SchemaError): string {
  if (e.keyword === 'required') return '5.3';
  if (e.path === '$schema') return '5.2';
  if (e.path === 'name') {
    return e.keyword === 'type' || e.keyword === 'minLength' ? '5.3' : '5.5';
  }
  return '5.4';
}

const CWD_RE = /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/;

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost') return true; // exactly localhost — subdomains are NOT loopback
  if (hostname === '[::1]' || hostname === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  return m !== null && m.slice(1).every((o) => Number(o) <= 255);
}

/** Spec URL rules for streamable-http / sse endpoints; null when compliant. */
function remoteUrlIssue(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `"${raw}" is not an absolute URL`;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `scheme "${u.protocol.replace(/:$/, '')}" is not HTTP or HTTPS`;
  }
  if (u.username || u.password) {
    return 'the URL carries user information (user:pass@), which the spec forbids';
  }
  if (raw.includes('#')) {
    return 'the URL carries a fragment (#...), which the spec forbids';
  }
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) {
    return `non-loopback host "${u.hostname}" over plain HTTP — non-loopback endpoints MUST use HTTPS (loopback means localhost, 127.0.0.0/8 or [::1], not just the literal "localhost")`;
  }
  return null;
}

/** True when a resolved path stays inside root (or is root itself). */
function staysInside(root: string, resolved: string): boolean {
  const rel = path.relative(root, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function vetPlugin(dir: string, opts: PluginVetOptions = {}): PluginVetResult {
  const root = path.resolve(dir);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new PluginVetError(`plugin directory does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) {
    throw new PluginVetError(`not a directory: ${dir} — pass the plugin's root directory`);
  }

  const findings: Finding[] = [];
  const notes: string[] = [];
  const servers: PluginServerInfo[] = [];
  const seen = new Set<string>();

  const push = (
    id: PluginRuleId,
    file: string,
    loc: { line: number; col?: number },
    detail: string | null,
    lines: string[] | null,
    section?: string,
  ) => {
    const key = `${file}|${loc.line}|${loc.col ?? 0}|${id}|${detail ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const m = PLUGIN_RULES[id];
    findings.push({
      file,
      line: loc.line,
      column: loc.col,
      patternId: id,
      patternLabel: m.label,
      severity: m.severity,
      confidence: 'high',
      explanation: detail ? `${detail} — ${m.explanation}` : m.explanation,
      docUrl: m.docUrl,
      before: lines ? snippet(lines, loc.line) : '(missing)',
      after: m.after,
      section: section ?? m.section,
      absPath: path.join(root, ...file.split('/')),
    });
  };

  // --- plugin.json — the manifest is the conformance floor -----------------
  const manifestPath = path.join(root, 'plugin.json');
  let pluginName: string | null = null;
  let manifestRaw: string | null = null;
  try {
    manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    push(
      'PLUGIN_MANIFEST_INVALID',
      'plugin.json',
      { line: 1 },
      'no plugin.json at the plugin root — a plugin MUST include a manifest there, and conformant clients reject the package without one',
      null,
      '5.1',
    );
  }
  if (manifestRaw !== null) {
    const manifestLines = manifestRaw.split(/\r?\n/);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (err) {
      push(
        'PLUGIN_MANIFEST_INVALID',
        'plugin.json',
        { line: 1 },
        `plugin.json is not valid JSON (${(err as Error).message})`,
        manifestLines,
        '5.1',
      );
      manifest = undefined;
    }
    if (manifest !== undefined) {
      const schema = pluginSchema();
      // §8.1: "A client MUST ignore manifest entries for namespaces it does
      // not implement without validating the contents of their values."
      // mcp-vet implements none, so extensions is opened for schema validation
      // and only its own type is checked by hand — a non-object value is
      // TOLERATED exactly once, an object's interior produces nothing at all.
      const openExtensions = {
        ...schema,
        properties: { ...schema.properties, extensions: true },
      };
      const errors: SchemaError[] = [];
      validateSchema(openExtensions, openExtensions, manifest, '', errors);
      const obj = manifest as Record<string, unknown>;
      if ('extensions' in obj && typeOf(obj.extensions) !== 'object') {
        push(
          'PLUGIN_EXTENSIONS_NOT_OBJECT',
          'plugin.json',
          locateKey(manifestRaw, ['extensions']),
          `extensions: must be an object keyed by reverse-domain namespace, got ${typeOf(obj.extensions)} — a conformant client reports this and continues loading components`,
          manifestLines,
        );
      }
      for (const e of errors) {
        if (e.keyword === 'additionalProperties' && e.parent === '') {
          const componentNote =
            e.path === 'skills'
              ? '; note: skills declared here will NOT load — §6.1 discovers skills only from the skills/ directory'
              : e.path === 'mcpServers'
                ? '; note: MCP servers declared here will NOT load — §6.1 discovers MCP servers only from mcp.json at the plugin root'
                : '';
          push(
            'PLUGIN_UNKNOWN_FIELD',
            'plugin.json',
            locateKey(manifestRaw, [e.path]),
            `unknown top-level field "${e.path}" — a conformant client reports this and continues loading${componentNote}`,
            manifestLines,
          );
          continue;
        }
        const loc = e.path ? locateKey(manifestRaw, pathSegments(e.path)) : { line: 1 };
        push(
          'PLUGIN_MANIFEST_INVALID',
          'plugin.json',
          loc,
          `${e.path || 'plugin.json'}: ${e.message}`,
          manifestLines,
          manifestSection(e),
        );
        if (e.path === 'name' && e.keyword === 'pattern') {
          push('PLUGIN_NAME_RE2_LOOKAHEAD', 'plugin.json', loc, null, manifestLines);
        }
      }
      const name = obj.name;
      if (typeof name === 'string') pluginName = name;
    }
  }

  // --- mcp.json — optional; absent is valid and silent --------------------
  const mcpPath = path.join(root, 'mcp.json');
  let hasMcpJson = false;
  let mcpRaw: string | null = null;
  try {
    mcpRaw = fs.readFileSync(mcpPath, 'utf8');
    hasMcpJson = true;
  } catch {
    /* no MCP servers — fine */
  }

  const bundledSources = new Map<string, string[]>(); // abs path -> server names
  if (mcpRaw !== null) {
    const mcpLines = mcpRaw.split(/\r?\n/);
    let doc: unknown;
    try {
      doc = JSON.parse(mcpRaw);
    } catch (err) {
      push(
        'PLUGIN_MCP_INVALID',
        'mcp.json',
        { line: 1 },
        `mcp.json is not valid JSON (${(err as Error).message})`,
        mcpLines,
      );
      doc = undefined;
    }
    if (doc !== undefined) {
      // Root-level validation first (server entries are validated one by one
      // below so each keeps its own failure boundary, mirroring spec §7.2.2).
      const schema = mcpSchema();
      const rootOnly = {
        ...schema,
        properties: { ...schema.properties, mcpServers: { type: 'object' } },
      };
      const rootErrors: SchemaError[] = [];
      validateSchema(rootOnly, rootOnly, doc, '', rootErrors);
      for (const e of rootErrors) {
        const loc = e.path ? locateKey(mcpRaw, pathSegments(e.path)) : { line: 1 };
        push('PLUGIN_MCP_INVALID', 'mcp.json', loc, `${e.path || 'mcp.json'}: ${e.message}`, mcpLines);
      }

      function vetStdioServer(
        name: string,
        server: Record<string, unknown>,
        info: PluginServerInfo,
      ): void {
        const locate = (...sub: string[]) => locateKey(mcpRaw!, ['mcpServers', name, ...sub]);
        const command = typeof server.command === 'string' ? server.command : null;
        if (command !== null && command.length > 0) {
          if (command.startsWith('./')) {
            const resolved = path.resolve(root, command);
            if (!staysInside(root, resolved)) {
              push(
                'PLUGIN_MCP_INVALID',
                'mcp.json',
                locate('command'),
                `mcpServers.${name}.command: ${JSON.stringify(command)} resolves outside the plugin root — the spec treats a containment failure as an invalid server entry (§7.2.2)`,
                mcpLines,
              );
            } else if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
              // The plugin bundles its own server — a real protocol audit.
              if (SOURCE_EXT_RE.test(resolved)) {
                const names = bundledSources.get(resolved) ?? [];
                names.push(name);
                bundledSources.set(resolved, names);
                info.scanned = true;
              } else {
                info.unscannableReason = `bundled command ${JSON.stringify(command)} is not TypeScript/JavaScript/Python source — the 22 MCP source rules cannot audit it`;
                notes.push(`server "${name}": ${info.unscannableReason}`);
              }
            } else if (/\s/.test(command)) {
              push(
                'PLUGIN_CMD_NOT_SINGLE_TOKEN',
                'mcp.json',
                locate('command'),
                `mcpServers.${name}.command: ${JSON.stringify(command)} contains whitespace and does not resolve to a bundled file — it reads as a shell command string, not a single executable token`,
                mcpLines,
              );
            } else {
              info.unscannableReason = `plugin-relative command ${JSON.stringify(command)} does not resolve to a file in the plugin — the server cannot start as packaged, and there is no source to scan`;
              notes.push(`server "${name}": ${info.unscannableReason}`);
            }
          } else if (/\s/.test(command)) {
            push(
              'PLUGIN_CMD_NOT_SINGLE_TOKEN',
              'mcp.json',
              locate('command'),
              `mcpServers.${name}.command: ${JSON.stringify(command)} is ${command.trim().split(/\s+/).length} tokens — clients do not shell-split, so pass arguments via "args"`,
              mcpLines,
            );
          } else if (/[\\/]/.test(command) || path.isAbsolute(command)) {
            push(
              'PLUGIN_CMD_NOT_SINGLE_TOKEN',
              'mcp.json',
              locate('command'),
              `mcpServers.${name}.command: ${JSON.stringify(command)} is neither a bare executable name nor a plugin-relative path beginning with ./`,
              mcpLines,
            );
          } else {
            // A bare launcher token (npx, uvx, node, python, ...): valid, but
            // the code it fetches/runs is not in the plugin. Say so.
            const args = Array.isArray(server.args) ? server.args : [];
            const localArgs = args.filter(
              (a): a is string =>
                typeof a === 'string' &&
                SOURCE_EXT_RE.test(a) &&
                fs.existsSync(path.resolve(root, a.replace(/^\$\{PLUGIN_ROOT\}\//, ''))),
            );
            info.unscannableReason =
              `bare command "${command}" is resolved by the platform's executable search rules — the server's source is not part of the plugin, so the 22 MCP source rules cannot audit it here (unscannable by design)` +
              (localArgs.length > 0
                ? `; its args reference bundled source (${localArgs.join(', ')}) — scan that directly with \`mcp-vet <path>\``
                : '');
            notes.push(`server "${name}": ${info.unscannableReason}`);
          }
        }

        // cwd containment beyond the schema's prefix pattern: "./../x" passes
        // the pattern but escapes the plugin root.
        const cwd = typeof server.cwd === 'string' ? server.cwd : null;
        if (cwd !== null && CWD_RE.test(cwd) && cwd.startsWith('./')) {
          if (!staysInside(root, path.resolve(root, cwd))) {
            push(
              'PLUGIN_CWD_ESCAPE',
              'mcp.json',
              locate('cwd'),
              `mcpServers.${name}.cwd: ${JSON.stringify(cwd)} starts with ./ but resolves outside the plugin root`,
              mcpLines,
            );
          }
        }
      }

      const mcpServers = (doc as Record<string, unknown>).mcpServers;
      if (typeOf(mcpServers) === 'object') {
        for (const [name, cfg] of Object.entries(mcpServers as Record<string, unknown>)) {
          const locate = (...sub: string[]) => locateKey(mcpRaw!, ['mcpServers', name, ...sub]);
          if (typeOf(cfg) !== 'object') {
            push(
              'PLUGIN_MCP_INVALID',
              'mcp.json',
              locate(),
              `mcpServers.${name}: must be a server configuration object, got ${typeOf(cfg)}`,
              mcpLines,
            );
            continue;
          }
          const server = cfg as Record<string, unknown>;
          const declared = typeof server.type === 'string' ? server.type : '';
          const info: PluginServerInfo = {
            name,
            type: declared || '(missing)',
            scanned: false,
            scannedFiles: [],
          };
          servers.push(info);

          const variant =
            declared === 'stdio'
              ? 'stdioServer'
              : declared === 'streamable-http'
                ? 'streamableHttpServer'
                : declared === 'sse'
                  ? 'sseServer'
                  : null;
          if (variant === null) {
            push(
              'PLUGIN_MCP_INVALID',
              'mcp.json',
              locate(),
              `mcpServers.${name}: type must be "stdio", "streamable-http" or "sse"${server.type === undefined ? ' (missing)' : `, got ${JSON.stringify(server.type)}`}`,
              mcpLines,
            );
            continue;
          }

          // Schema validation of the matching closed variant. Two failure
          // classes have dedicated rules and are routed there: the cwd
          // pattern (PLUGIN_CWD_ESCAPE) and the reserved env property names
          // (PLUGIN_ENV_RESERVED). Everything else is PLUGIN_MCP_INVALID.
          const errors: SchemaError[] = [];
          validateSchema(schema.$defs[variant], schema, server, '', errors);
          for (const e of errors) {
            const loc = locate(...pathSegments(e.path));
            if (e.keyword === 'pattern' && (e.path === 'cwd' || e.path.endsWith('.cwd'))) {
              push(
                'PLUGIN_CWD_ESCAPE',
                'mcp.json',
                loc,
                `mcpServers.${name}.cwd: ${JSON.stringify(server.cwd)} does not start with ./, \${PLUGIN_ROOT} or \${PLUGIN_DATA}`,
                mcpLines,
              );
            } else if (e.keyword === 'propertyNames') {
              push(
                'PLUGIN_ENV_RESERVED',
                'mcp.json',
                loc,
                `mcpServers.${name}.env: ${e.message.replace('property name', 'reserved name')}`,
                mcpLines,
              );
            } else {
              push(
                'PLUGIN_MCP_INVALID',
                'mcp.json',
                loc,
                `mcpServers.${name}${e.path ? '.' + e.path : ''}: ${e.message}`,
                mcpLines,
              );
            }
          }

          if (declared === 'stdio') {
            vetStdioServer(name, server, info);
          } else {
            // Remote transports: URL rules, and never silently skipped.
            if (typeof server.url === 'string' && server.url.length > 0) {
              const issue = remoteUrlIssue(server.url);
              if (issue !== null) {
                push(
                  'PLUGIN_REMOTE_INSECURE_URL',
                  'mcp.json',
                  locate('url'),
                  `mcpServers.${name}.url: ${issue}`,
                  mcpLines,
                );
              }
            }
            if (declared === 'sse') {
              push(
                'PLUGIN_SSE_TRANSPORT',
                'mcp.json',
                locate('type'),
                `mcpServers.${name}: type "sse" is the HTTP+SSE transport, Deprecated by MCP 2026-07-28 (SEP-2596)`,
                mcpLines,
              );
            }
            info.unscannableReason = `remote ${declared} endpoint — its source is not part of the plugin; vet the running server with \`mcp-vet probe ${typeof server.url === 'string' ? server.url : '<url>'}\``;
            notes.push(`server "${name}": ${info.unscannableReason}`);
          }
        }
      }
    }
  }

  // --- skills/ — immediate children only are discoverable ------------------
  let skillCount = 0;
  const skillsDir = path.join(root, 'skills');
  let skillsStat: fs.Stats | null = null;
  try {
    skillsStat = fs.statSync(skillsDir);
  } catch {
    /* absent is valid */
  }
  if (skillsStat !== null && !skillsStat.isDirectory()) {
    notes.push(
      'skills exists but is not a directory — conformant clients treat the skills component type as invalid and load nothing from it',
    );
  } else if (skillsStat !== null) {
    const walk = (dirAbs: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dirAbs, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          walk(full, depth + 1);
        } else if (e.isFile() && e.name === 'SKILL.md') {
          if (depth === 1) {
            skillCount++;
          } else {
            const rel = path.relative(root, full).split(path.sep).join('/');
            push(
              'PLUGIN_SKILL_LAYOUT',
              rel,
              { line: 1 },
              depth === 0
                ? `${rel} sits directly in skills/ — skills live one level down, at skills/<name>/SKILL.md`
                : `${rel} sits ${depth - 1} level(s) deeper than an immediate child of skills/`,
              null,
            );
          }
        }
      }
    };
    walk(skillsDir, 0);
  }

  // --- Bundled server source → the existing 22 static rules, verbatim ------
  let pythonMode: PythonMode = 'n/a';
  let sourceFilesScanned = 0;
  if (bundledSources.size > 0) {
    const result = scan([...bundledSources.keys()], {
      enabled: new Set(ALL_PATTERN_IDS),
      ignore: new IgnoreMatcher([]),
      maxFileSizeKb: opts.maxFileSizeKb ?? 1536,
      pythonFallback: opts.pythonFallback ?? true,
      minConfidence: 'low',
    });
    pythonMode = result.pythonMode;
    sourceFilesScanned = result.filesScanned;
    for (const f of result.findings) {
      // Report bundled-source findings plugin-relative, not by basename.
      if (f.absPath) f.file = path.relative(root, f.absPath).split(path.sep).join('/');
      findings.push(f);
    }
    for (const [abs, names] of bundledSources) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      for (const name of names) {
        const info = servers.find((s) => s.name === name);
        if (info) info.scannedFiles.push(rel);
      }
    }
    if (pythonMode === 'regex') {
      notes.push(
        'no Python interpreter found — bundled .py server source was scanned with the regex fallback (reduced precision)',
      );
    } else if (pythonMode === 'none') {
      notes.push(
        'bundled .py server source was NOT scanned: no Python interpreter available and the regex fallback is disabled',
      );
    }
    for (const rel of result.skippedLargeFiles) {
      notes.push(`skipped large bundled file ${rel} (exceeds the file-size limit)`);
    }
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      (a.column ?? 0) - (b.column ?? 0) ||
      a.patternId.localeCompare(b.patternId),
  );

  return {
    findings,
    pluginDir: root,
    pluginName,
    hasMcpJson,
    servers,
    skillCount,
    notes,
    pythonMode,
    sourceFilesScanned,
  };
}

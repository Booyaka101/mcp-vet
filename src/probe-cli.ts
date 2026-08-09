/**
 * `mcp-vet probe` — CLI wrapper around the runtime prober.
 *
 *   mcp-vet probe [options] <url | command [args...]>
 *
 * Targets:
 *   http(s)://...      Streamable HTTP MCP endpoint
 *   anything else      a command to spawn as a stdio MCP server
 *                      (a lone .js/.mjs/.cjs file is run with the current Node)
 */
import * as path from 'node:path';
import { Command } from 'commander';
import { SPEC_VERSIONS, SpecVersion } from './types';
import { probeServer, ProbeError, ProbeTarget } from './probe';
import { reportProbeTerminal, renderJson, writeSarif } from './reporters';
import { FailOn } from './config';

const FAILON_VALUES: FailOn[] = ['breaking', 'any', 'none'];

function fail(msg: string): never {
  console.error(`mcp-vet: ${msg}`);
  process.exit(2);
}

export async function runProbeCli(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('mcp-vet probe')
    .description(
      'Connect to a RUNNING MCP server (stdio command or Streamable HTTP URL) and vet its wire behavior: JSON Schema dialect of tool schemas (SEP-2106) and, with --spec-version 2026-07-28, stateless-protocol readiness, the required server/discover RPC (SEP-2575), and the -32002 → -32602 resource error-code change. Add --spec 2026-07-28 to ALSO run the thirteen-check compliance suite: stateless-no-session, stateless-no-init, required-headers, the deprecated-sampling/roots/logging warnings, resultType/cacheable-field checks, renumbered error codes, the ping removal, the authorization-server metadata checks (dcr-still-advertised, auth-metadata-missing-iss), and the legacy HTTP+SSE transport sniff (legacy-sse-transport).',
    )
    .argument('<target...>', 'server URL (http/https) or a command + args to spawn (stdio)')
    .option(
      '--spec-version <version>',
      `MCP revision to vet against: ${SPEC_VERSIONS.join(' | ')}`,
      '2025-11-25',
    )
    .option(
      '--spec <version>',
      `shorthand for --spec-version that ALSO runs the extra compliance suite (stateless-no-session, stateless-no-init, required-headers, deprecated-sampling/roots/logging): ${SPEC_VERSIONS.join(' | ')}`,
    )
    .option('--timeout <ms>', 'per-request timeout in milliseconds', '8000')
    .option('--fail-on <level>', `exit non-zero on: ${FAILON_VALUES.join(' | ')}`, 'breaking')
    .option('--json', 'print findings as a JSON array to stdout (notices go to stderr)')
    .option('--sarif [file]', 'write a SARIF 2.1.0 report (default file: mcp-vet.sarif)')
    .option('--color', 'force colored output')
    .option('--no-color', 'disable colored output')
    .option('--quiet', 'suppress the human-readable terminal report')
    .passThroughOptions() // everything after the first positional belongs to the server command
    .exitOverride()
    .showHelpAfterError();

  try {
    program.parse(argv, { from: 'user' });
  } catch (err) {
    // commander already printed the error/help text
    const code = (err as { code?: string }).code;
    return code === 'commander.helpDisplayed' || code === 'commander.help' ? 0 : 2;
  }

  const opts = program.opts<{
    specVersion: string;
    spec?: string;
    timeout: string;
    failOn: string;
    json?: boolean;
    sarif?: string | boolean;
    color?: boolean;
    quiet?: boolean;
  }>();

  // `--spec` is a shorthand for `--spec-version` that ALSO enables the extra
  // compliance suite. When present it wins over --spec-version.
  const specChecks = opts.spec !== undefined;
  const rawSpec = opts.spec ?? opts.specVersion;
  if (!SPEC_VERSIONS.includes(rawSpec as SpecVersion)) {
    const flag = opts.spec !== undefined ? '--spec' : '--spec-version';
    fail(`invalid ${flag} "${rawSpec}". Valid: ${SPEC_VERSIONS.join(', ')}`);
  }
  const specVersion = rawSpec as SpecVersion;

  const timeoutMs = Number(opts.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`invalid --timeout "${opts.timeout}" (need a positive number of milliseconds).`);
  }
  if (!FAILON_VALUES.includes(opts.failOn as FailOn)) {
    fail(`invalid --fail-on "${opts.failOn}". Valid: ${FAILON_VALUES.join(', ')}`);
  }
  const failOn = opts.failOn as FailOn;

  const rawTarget = program.args;
  let target: ProbeTarget;
  if (/^https?:\/\//i.test(rawTarget[0])) {
    if (rawTarget.length > 1) {
      fail(`unexpected extra arguments after URL target: ${rawTarget.slice(1).join(' ')}`);
    }
    target = { kind: 'http', url: rawTarget[0] };
  } else {
    let [command, ...args] = rawTarget;
    // Convenience: `mcp-vet probe ./server.mjs` runs the file with this Node.
    if (/\.(mjs|cjs|js)$/i.test(command)) {
      args = [command, ...args];
      command = process.execPath;
    }
    target = { kind: 'stdio', command, args };
  }

  let result;
  try {
    result = await probeServer(target, { specVersion, timeoutMs, specChecks });
  } catch (err) {
    if (err instanceof ProbeError) fail(err.message);
    throw err;
  }

  const quiet = opts.quiet || opts.json;
  const notify = (msg: string) => (opts.json ? console.error(msg) : console.log(msg));

  if (!quiet) reportProbeTerminal(result, { color: opts.color });
  if (opts.json) process.stdout.write(renderJson(result) + '\n');

  if (opts.sarif) {
    const sarifPath = path.resolve(
      process.cwd(),
      typeof opts.sarif === 'string' ? opts.sarif : 'mcp-vet.sarif',
    );
    try {
      writeSarif(result, sarifPath);
      if (!quiet) notify(`Wrote ${sarifPath}`);
    } catch (err) {
      console.error(`mcp-vet: failed to write SARIF: ${(err as Error).message}`);
    }
  }

  const hasError = result.findings.some(
    (f) => f.severity === 'ERROR' || f.severity === 'BREAKING',
  );
  const hasAny = result.findings.length > 0;
  if (failOn === 'breaking') return hasError ? 1 : 0;
  if (failOn === 'any') return hasAny ? 1 : 0;
  return 0;
}

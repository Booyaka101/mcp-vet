/**
 * `mcp-vet plugin` — CLI wrapper around the Agent Plugins 1.0 package vetter.
 *
 *   mcp-vet plugin [options] <dir>
 *
 * Vets the plugin envelope (plugin.json / mcp.json / skills layout) against
 * the vendored 1.0.0 schemas and runs the 22 static source rules over any MCP
 * server code bundled via a ./-relative stdio command. Shares the scan's
 * reporters and exit-code contract: any FATAL or BREAKING finding exits 1;
 * TOLERATED (spec §5.2/§8.1 report-and-continue conditions), DEPRECATED and
 * INFO exit 0.
 */
import * as path from 'node:path';
import { Command } from 'commander';
import { vetPlugin, PluginVetError } from './inputs/plugin';
import { reportPluginTerminal, renderJson, writeSarif } from './reporters';
import { FailOn } from './config';

const FAILON_VALUES: FailOn[] = ['breaking', 'any', 'none'];

function fail(msg: string): never {
  console.error(`mcp-vet: ${msg}`);
  process.exit(2);
}

export function runPluginCli(argv: string[]): number {
  const program = new Command();
  program
    .name('mcp-vet plugin')
    .description(
      'Vet an Agent Plugins 1.0 package directory: validate plugin.json and mcp.json against the vendored 1.0.0 schemas (offline), enforce the spec\'s semantic rules (single-token stdio command, cwd containment, reserved env names, remote URL security, skills discovery layout), flag the deprecated HTTP+SSE transport, and run the 22 MCP 2026-07-28 source rules over any server code bundled in the plugin. Envelope severities follow what a conformant client does: FATAL rejects the plugin and exits 1 (as does BREAKING); TOLERATED marks the schema violations spec §5.2/§8.1 require clients to report and keep loading, and exits 0 (as do DEPRECATED and INFO).',
    )
    .argument('<dir>', "the plugin's root directory (the one containing plugin.json)")
    .option('--fail-on <level>', `exit non-zero on: ${FAILON_VALUES.join(' | ')}`, 'breaking')
    .option('--json', 'print findings as a JSON array to stdout (notices go to stderr)')
    .option('--sarif [file]', 'write a SARIF 2.1.0 report (default file: mcp-vet.sarif)')
    .option('--no-py-fallback', 'disable the regex fallback when no Python interpreter is found')
    .option('--color', 'force colored output')
    .option('--no-color', 'disable colored output')
    .option('--quiet', 'suppress the human-readable terminal report')
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
    failOn: string;
    json?: boolean;
    sarif?: string | boolean;
    pyFallback: boolean;
    color?: boolean;
    quiet?: boolean;
  }>();

  if (!FAILON_VALUES.includes(opts.failOn as FailOn)) {
    fail(`invalid --fail-on "${opts.failOn}". Valid: ${FAILON_VALUES.join(', ')}`);
  }
  const failOn = opts.failOn as FailOn;

  let result;
  try {
    result = vetPlugin(program.args[0], { pythonFallback: opts.pyFallback });
  } catch (err) {
    if (err instanceof PluginVetError) fail(err.message);
    throw err;
  }

  const quiet = opts.quiet || opts.json;
  const notify = (msg: string) => (opts.json ? console.error(msg) : console.log(msg));

  if (!quiet) reportPluginTerminal(result, { color: opts.color });
  if (opts.json) {
    // Unscannable-by-design reasons still surface in --json mode (stderr).
    for (const n of result.notes) console.error(`note: ${n}`);
    process.stdout.write(renderJson(result) + '\n');
  }

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

  const hasBreaking = result.findings.some(
    (f) => f.severity === 'BREAKING' || f.severity === 'ERROR' || f.severity === 'FATAL',
  );
  const hasAny = result.findings.length > 0;
  if (failOn === 'breaking') return hasBreaking ? 1 : 0;
  if (failOn === 'any') return hasAny ? 1 : 0;
  return 0;
}

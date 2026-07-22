#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { scan, ScanError } from './scanner';
import { IgnoreMatcher } from './ignore';
import { loadConfig, ConfigError, Config, FailOn } from './config';
import { ALL_PATTERN_IDS, PatternId, Confidence } from './types';
import { getVersion } from './constants';
import {
  reportTerminal,
  writeMarkdown,
  writeJson,
  writeSarif,
  printGithubAnnotations,
  renderJson,
} from './reporters';
import { applyFixes } from './autofix';

const CONF_VALUES: Confidence[] = ['high', 'medium', 'low'];
const FAILON_VALUES: FailOn[] = ['breaking', 'any', 'none'];

function fail(msg: string): never {
  console.error(`mcp-vet: ${msg}`);
  process.exit(2);
}

function parsePatternIds(raw: string | undefined): PatternId[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const ids: PatternId[] = [];
  for (const p of parts) {
    if (!ALL_PATTERN_IDS.includes(p as PatternId)) {
      fail(`unknown pattern id "${p}". Valid ids: ${ALL_PATTERN_IDS.join(', ')}`);
    }
    ids.push(p as PatternId);
  }
  return ids;
}

function readIgnoreFile(dir: string): string[] {
  const p = path.join(dir, '.mcpvetignore');
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

const program = new Command();

program
  .name('mcp-vet')
  .description(
    'Scan MCP server source code for patterns that break under the 2026-07-28 MCP spec release candidate.',
  )
  .argument('[paths...]', 'files or directories to scan', ['.'])
  .option('--github-annotations', 'emit GitHub Actions ::error/::warning annotations to stdout')
  .option('--sarif [file]', 'write a SARIF 2.1.0 report (default file: mcp-vet.sarif)')
  .option('--out-dir <dir>', 'directory for mcp-vet-report.md and mcp-vet-results.json', process.cwd())
  .option('--no-files', 'do not write the markdown/json report files')
  .option('--only <ids>', 'only run these pattern ids (comma/space separated)')
  .option('--disable <ids>', 'skip these pattern ids (comma/space separated)')
  .option('--fail-on <level>', `exit non-zero on: ${FAILON_VALUES.join(' | ')}`, 'breaking')
  .option('--min-confidence <level>', `report only findings at/above: ${CONF_VALUES.join(' | ')}`, 'low')
  .option(
    '--ignore <glob>',
    'ignore paths matching glob (repeatable)',
    (v: string, acc: string[]) => {
      acc.push(v);
      return acc;
    },
    [] as string[],
  )
  .option('--max-file-size <kb>', 'skip files larger than this many KB (0 = no limit)', '1536')
  .option('--no-py-fallback', 'disable the regex fallback when no Python interpreter is found')
  .option('--config <path>', 'path to a config file (.mcpvetrc.json)')
  .option('--fix', 'auto-apply the safe mechanical fixes in place (currently: -32002 → -32602)')
  .option('--dry-run', 'with --fix: print the rewrites that would be made, without changing files')
  .option('--json', 'print findings as a JSON array to stdout (implies a quiet terminal report)')
  .option('--color', 'force colored output')
  .option('--no-color', 'disable colored output')
  .option('--quiet', 'suppress the human-readable terminal report')
  .version(getVersion(), '-v, --version')
  .showHelpAfterError();

program.parse(process.argv);

const opts = program.opts<{
  githubAnnotations?: boolean;
  sarif?: string | boolean;
  outDir: string;
  files: boolean;
  only?: string;
  disable?: string;
  failOn: string;
  minConfidence: string;
  ignore: string[];
  maxFileSize: string;
  pyFallback: boolean;
  config?: string;
  fix?: boolean;
  dryRun?: boolean;
  json?: boolean;
  color?: boolean;
  quiet?: boolean;
}>();

const paths: string[] = program.args.length ? program.args : ['.'];

// --- Resolve configuration (CLI over config file over defaults) ---
let config: Config = {};
try {
  config = loadConfig(process.cwd(), opts.config);
} catch (err) {
  if (err instanceof ConfigError) fail(err.message);
  throw err;
}

// Validate enums
if (!FAILON_VALUES.includes(opts.failOn as FailOn)) {
  fail(`invalid --fail-on "${opts.failOn}". Valid: ${FAILON_VALUES.join(', ')}`);
}
if (!CONF_VALUES.includes(opts.minConfidence as Confidence)) {
  fail(`invalid --min-confidence "${opts.minConfidence}". Valid: ${CONF_VALUES.join(', ')}`);
}

// CLI value wins when explicitly set; otherwise fall back to the config file.
const fromCli = (key: string) => program.getOptionValueSource(key) === 'cli';

const failOn: FailOn = fromCli('failOn')
  ? (opts.failOn as FailOn)
  : config.failOn ?? (opts.failOn as FailOn);
const minConfidence: Confidence = fromCli('minConfidence')
  ? (opts.minConfidence as Confidence)
  : config.minConfidence ?? (opts.minConfidence as Confidence);

const normalizeIds = (ids?: string[]): PatternId[] | undefined =>
  ids
    ?.map((s) => String(s).toUpperCase())
    .filter((s): s is PatternId => ALL_PATTERN_IDS.includes(s as PatternId));

const cliOnly = parsePatternIds(opts.only);
const cliDisable = parsePatternIds(opts.disable);
const only = cliOnly ?? normalizeIds(config.only);
const disable = cliDisable ?? normalizeIds(config.disable);

let enabled = new Set<PatternId>(ALL_PATTERN_IDS);
if (only && only.length) enabled = new Set(only.filter((id) => ALL_PATTERN_IDS.includes(id)));
// `disable` always applies on top — so a CLI --disable still narrows a config `only`.
if (disable && disable.length) {
  for (const id of disable) enabled.delete(id);
}
if (enabled.size === 0) fail('no rules enabled after applying --only/--disable.');

const maxKbRaw = Number(opts.maxFileSize);
if (!Number.isFinite(maxKbRaw) || maxKbRaw < 0) fail(`invalid --max-file-size "${opts.maxFileSize}".`);
const maxFileSizeKb = fromCli('maxFileSize')
  ? maxKbRaw
  : config.maxFileSizeKb != null
    ? config.maxFileSizeKb
    : maxKbRaw;

const pythonFallback = fromCli('pyFallback')
  ? opts.pyFallback
  : config.pythonFallback != null
    ? config.pythonFallback
    : opts.pyFallback;

const color = fromCli('color') ? opts.color : undefined;

// Ignore patterns: config + CLI + .mcpvetignore in cwd and each root dir
const ignorePatterns = new Set<string>([...(config.ignore ?? []), ...opts.ignore]);
for (const line of readIgnoreFile(process.cwd())) ignorePatterns.add(line);
for (const p of paths) {
  try {
    const abs = path.resolve(p);
    if (fs.statSync(abs).isDirectory()) {
      for (const line of readIgnoreFile(abs)) ignorePatterns.add(line);
    }
  } catch {
    /* validated later in scan() */
  }
}
const ignore = new IgnoreMatcher([...ignorePatterns]);

// --- Scan ---
let result;
try {
  result = scan(paths, {
    enabled,
    ignore,
    maxFileSizeKb,
    pythonFallback,
    minConfidence,
  });
} catch (err) {
  if (err instanceof ScanError) fail(err.message);
  throw err;
}

// --- Autofix (before reporting, so the report/exit reflect what remains) ---
if (opts.fix) {
  const say = opts.json ? console.error : console.log; // keep stdout clean for --json
  const fr = applyFixes(result.findings, { dryRun: opts.dryRun });
  if (opts.dryRun) {
    if (fr.preview.length === 0) {
      say('mcp-vet: --fix --dry-run — nothing to auto-fix.');
    } else {
      say(`mcp-vet: --fix --dry-run — ${fr.preview.length} rewrite(s) that would be applied (no files changed):`);
      for (const p of fr.preview) {
        say(`  ${p.file}:${p.line}`);
        say(`    - ${p.before.trim()}`);
        say(`    + ${p.after.trim()}`);
      }
    }
  } else {
    if (fr.fixedCount > 0) {
      const fixed = new Set(fr.fixedFindings);
      result.findings = result.findings.filter((f) => !fixed.has(f));
    }
    say(
      fr.fixedCount > 0
        ? `mcp-vet: fixed ${fr.fixedCount} occurrence(s) of -32002 → -32602 in ${fr.filesChanged.length} file(s).`
        : 'mcp-vet: --fix found nothing to auto-fix.',
    );
  }
}

// --- Report ---
const quiet = opts.quiet || opts.json;
// Notices (Wrote ...) go to stderr in --json mode so stdout stays pure JSON.
const notify = (msg: string) => (opts.json ? console.error(msg) : console.log(msg));

if (opts.githubAnnotations) {
  printGithubAnnotations(result.findings);
}

if (!quiet) {
  reportTerminal(result, { color });
}

if (opts.json) {
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

if (opts.files) {
  try {
    const md = writeMarkdown(result, opts.outDir);
    const json = writeJson(result, opts.outDir);
    if (!quiet) {
      notify(`Wrote ${md}`);
      notify(`Wrote ${json}`);
    }
  } catch (err) {
    console.error(`mcp-vet: failed to write report files: ${(err as Error).message}`);
  }
}

// --- Exit code ---
const hasBreaking = result.findings.some((f) => f.severity === 'BREAKING');
const hasAny = result.findings.length > 0;
let failing = false;
if (failOn === 'breaking') failing = hasBreaking;
else if (failOn === 'any') failing = hasAny;
else failing = false; // 'none'

process.exit(failing ? 1 : 0);

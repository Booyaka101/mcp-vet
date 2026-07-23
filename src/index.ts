/**
 * Programmatic API for mcp-vet.
 *
 * The CLI (`dist/cli.js`) is the primary entry point, but the scanner and its
 * reporters are usable as a library — e.g. from an editor extension, a custom CI
 * step, or a migration harness:
 *
 * ```ts
 * import { scan, renderJson, applyFixes } from '@booyaka/mcp-vet';
 * const result = scan(['./src'], {
 *   enabled: new Set(ALL_PATTERN_IDS),
 *   ignore: new IgnoreMatcher([]),
 *   maxFileSizeKb: 0,
 *   pythonFallback: true,
 *   minConfidence: 'low',
 * });
 * console.log(result.findings);
 * ```
 */
export { scan, ScanError } from './scanner';
export type { ScanOptions, ScanResult, PythonMode } from './scanner';

export { applyFixes, isFixable } from './autofix';
export type { FixResult } from './autofix';

export { renderJson, renderMarkdown, renderSarif, toPublicFinding } from './reporters';

export { RULES } from './rules';
export { CONFORMANCE_FIXTURES, emitConformanceFixtures } from './conformance';
export type { ConformanceFixture, ConformanceStep, EmitResult } from './conformance';
export { IgnoreMatcher } from './ignore';
export { SPEC_URL, SPEC_DATE, CHANGELOG_URL, MANUAL_REVIEW, getVersion } from './constants';

export { ALL_PATTERN_IDS } from './types';
export type { Finding, PatternId, Severity, Confidence, Token } from './types';

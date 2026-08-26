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
export type { ScanOptions, ScanResult, PythonMode, PySdkMode, PySdkStatus } from './scanner';

export { applyFixes, isFixable } from './autofix';
export type { FixResult } from './autofix';

export { renderJson, renderMarkdown, renderSarif, toPublicFinding } from './reporters';

export { RULES, RUNTIME_RULES, PLUGIN_RULES, PY_SDK_RULES } from './rules';
export type { RuntimeRuleMeta, PluginRuleMeta, PySdkRuleMeta } from './rules';

export { detectMcpSdk, classifySpecifier, clearSdkDetectionCache } from './sdk-detect';
export type { SdkDetection, McpMajor } from './sdk-detect';

export { vetPlugin, PluginVetError } from './inputs/plugin';
export type { PluginVetOptions, PluginVetResult, PluginServerInfo } from './inputs/plugin';
export { CONFORMANCE_FIXTURES, emitConformanceFixtures } from './conformance';
export type { ConformanceFixture, ConformanceStep, EmitResult } from './conformance';
export { IgnoreMatcher } from './ignore';
export {
  SPEC_URL,
  SPEC_DATE,
  CHANGELOG_URL,
  DEPRECATED_REGISTRY_URL,
  SEP_2106_URL,
  JSON_SCHEMA_2020_12,
  AGENT_PLUGINS_SPEC_URL,
  AGENT_PLUGINS_PLUGIN_SCHEMA_URL,
  AGENT_PLUGINS_MCP_SCHEMA_URL,
  MANUAL_REVIEW,
  PY_SDK_MIGRATION_URL,
  PY_SDK_RELEASES_URL,
  PY_SDK_LATEST_V2,
  PY_SDK_LATEST_V2_DATE,
  getVersion,
} from './constants';

export { probeServer, ProbeError, targetLabel } from './probe';
export type { ProbeTarget, ProbeOptions, ProbeResult } from './probe';
export { analyzeSchemaDialect } from './schema-dialect';
export type { DialectIssue } from './schema-dialect';

export {
  ALL_PATTERN_IDS,
  ALL_RUNTIME_RULE_IDS,
  ALL_PLUGIN_RULE_IDS,
  ALL_PY_SDK_RULE_IDS,
  SPEC_VERSIONS,
} from './types';
export type {
  Finding,
  PatternId,
  RuntimeRuleId,
  PluginRuleId,
  PySdkRuleId,
  ViolationId,
  SpecVersion,
  Severity,
  Confidence,
  Token,
} from './types';

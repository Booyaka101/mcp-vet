import * as fs from 'node:fs';
import * as path from 'node:path';
import { PatternId, PySdkRuleId, TsSdkRuleId, Confidence } from './types';

export type FailOn = 'breaking' | 'any' | 'none';

export type SdkGroupConfig = 'auto' | 'v1' | 'v2' | 'off';
/** @deprecated alias kept for API compatibility; use SdkGroupConfig. */
export type PySdkConfig = SdkGroupConfig;

/** Any rule id accepted by `only` / `disable`. */
export type ConfigRuleId = PatternId | PySdkRuleId | TsSdkRuleId;

export interface Config {
  ignore?: string[];
  only?: ConfigRuleId[];
  disable?: ConfigRuleId[];
  failOn?: FailOn;
  minConfidence?: Confidence;
  maxFileSizeKb?: number;
  pythonFallback?: boolean;
  /** PY_SDK_V1 group gate — same values as --py-sdk, plus 'off' (--no-py-sdk) */
  pySdk?: SdkGroupConfig;
  /** TS_SDK_V1 group gate — same values as --ts-sdk, plus 'off' (--no-ts-sdk) */
  tsSdk?: SdkGroupConfig;
}

const CONFIG_NAMES = ['.mcpvetrc.json', 'mcp-vet.config.json'];

export class ConfigError extends Error {}

/**
 * Load config. If `explicitPath` is given it must exist and parse (throws
 * ConfigError otherwise). Otherwise the first known config file found in `cwd`
 * is used; missing config is not an error.
 */
export function loadConfig(cwd: string, explicitPath?: string): Config {
  let file: string | undefined;
  if (explicitPath) {
    file = path.resolve(cwd, explicitPath);
    if (!fs.existsSync(file)) {
      throw new ConfigError(`config file not found: ${explicitPath}`);
    }
  } else {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(cwd, name);
      if (fs.existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (!file) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`failed to parse ${file}: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError(`config must be a JSON object: ${file}`);
  }
  return raw as Config;
}

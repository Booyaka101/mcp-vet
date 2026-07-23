/**
 * JSON Schema dialect detection for the 2026-07-28 spec (SEP-2106), which lifts
 * tool inputSchema/outputSchema to full JSON Schema 2020-12.
 *
 * Two detection paths:
 *  1. Explicit — `$schema` declares draft-04/-06/-07 (or 2019-09): high confidence.
 *  2. Inferred — `$schema` is absent but the schema uses keywords/forms that only
 *     exist in the old drafts (`definitions`, `dependencies`, boolean
 *     `exclusiveMinimum`/`exclusiveMaximum`, array-form `items`,
 *     `$ref: "#/definitions/..."`): medium confidence.
 *
 * The walker recurses ONLY into schema positions (applicator keywords), so a
 * *property* literally named `definitions` (a key under `properties`) is never
 * mistaken for the draft-07 keyword.
 */

export interface DialectIssue {
  kind: 'explicit' | 'inferred';
  /** e.g. "draft-07" — set for kind 'explicit' */
  dialect?: string;
  /** the literal $schema value — set for kind 'explicit' */
  schemaValue?: string;
  /** the pre-2020-12 keywords/forms found — set for kind 'inferred' */
  keywords?: string[];
}

const OLD_DRAFT_RE = /^https?:\/\/json-schema\.org\/draft-0([467])\/schema#?$/;
const DRAFT_2019_RE = /^https?:\/\/json-schema\.org\/draft\/2019-09\/schema#?$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keywords whose value is a single subschema. */
const SINGLE_SCHEMA_KEYS = [
  'additionalProperties',
  'additionalItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentSchema',
];

/** Keywords whose value is an array of subschemas. */
const SCHEMA_ARRAY_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

/** Keywords whose value is a map of name → subschema. */
const SCHEMA_MAP_KEYS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];

function walk(node: unknown, found: Set<string>): void {
  if (!isObj(node)) return;

  // --- pre-2020-12 signals at this schema level ---
  if (isObj(node.definitions)) {
    found.add('definitions (2020-12 uses $defs)');
  }
  if (isObj(node.dependencies)) {
    // Both the schema form and the string-array form were split into
    // dependentSchemas / dependentRequired in 2019-09.
    found.add('dependencies (2020-12 uses dependentSchemas/dependentRequired)');
    for (const v of Object.values(node.dependencies)) walk(v, found);
  }
  if (typeof node.exclusiveMinimum === 'boolean' || typeof node.exclusiveMaximum === 'boolean') {
    found.add('boolean exclusiveMinimum/exclusiveMaximum (draft-04 form)');
  }
  if (Array.isArray(node.items)) {
    found.add('array-form items (2020-12 uses prefixItems)');
    for (const v of node.items) walk(v, found);
  }
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/definitions/')) {
    found.add('$ref into #/definitions/ (2020-12 uses #/$defs/)');
  }
  // draft-04's `id` (vs `$id`) is deliberately NOT inferred — a bare `id` key is
  // far more often a property name or data field than a schema identifier, and
  // false positives cost more than the marginal recall here.

  // --- recurse into schema positions only ---
  for (const key of SCHEMA_MAP_KEYS) {
    const v = node[key];
    if (isObj(v)) for (const sub of Object.values(v)) walk(sub, found);
  }
  for (const key of SINGLE_SCHEMA_KEYS) {
    const v = node[key];
    if (isObj(v)) walk(v, found);
  }
  if (isObj(node.items)) walk(node.items, found);
  for (const key of SCHEMA_ARRAY_KEYS) {
    const v = node[key];
    if (Array.isArray(v)) for (const sub of v) walk(sub, found);
  }
}

/**
 * Inspect a tool's inputSchema/outputSchema and report a pre-2020-12 dialect,
 * or null when the schema is (or plausibly is) JSON Schema 2020-12.
 */
export function analyzeSchemaDialect(schema: unknown): DialectIssue | null {
  if (!isObj(schema)) return null;

  const declared = schema.$schema;
  if (typeof declared === 'string') {
    const old = OLD_DRAFT_RE.exec(declared);
    if (old) {
      return { kind: 'explicit', dialect: `draft-0${old[1]}`, schemaValue: declared };
    }
    if (DRAFT_2019_RE.test(declared)) {
      return { kind: 'explicit', dialect: 'draft 2019-09', schemaValue: declared };
    }
    // 2020-12 (or an unrecognized/custom dialect): trust the declaration.
    return null;
  }

  const found = new Set<string>();
  walk(schema, found);
  if (found.size === 0) return null;
  return { kind: 'inferred', keywords: [...found] };
}

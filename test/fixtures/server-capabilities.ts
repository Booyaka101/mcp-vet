// Fixture: capability declaration.
// Triggers: ROOTS_CAP (rule 5), SAMPLING_CAP (rule 6), LOGGING_CAP (rule 7).

export const serverInfo = {
  name: 'example-mcp-server',
  version: '1.0.0',
  capabilities: {
    roots: { listChanged: true }, // DEPRECATED
    sampling: {}, // DEPRECATED
    logging: {}, // DEPRECATED
    tools: { listChanged: true }, // clean — still supported
    resources: { subscribe: true }, // clean — still supported
  },
};

// A "projectRoots" identifier far from any capability block — must NOT flag,
// because rules 5-7 only match a bare `roots`/`sampling`/`logging` key/string.
export function projectRoots(): string[] {
  return ['/workspace', '/tmp'];
}

// An unrelated helper name — must NOT flag.
export function loggingHelperNote() {
  return 'this is a normal function';
}

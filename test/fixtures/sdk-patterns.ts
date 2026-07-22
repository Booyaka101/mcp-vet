// Fixture: how real MCP SDK servers actually register handlers — via schema
// constants and method strings, not bare 'initialize' literals. Plus the
// value-aware sessionIdGenerator signal.

import {
  InitializeRequestSchema,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  SetLevelRequestSchema,
  ListTasksRequestSchema,
  GetTaskResultRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

declare const server: any;

// SDK schema-constant registration — must be detected even with no string literal.
server.setRequestHandler(InitializeRequestSchema, async () => ({})); // BREAKING
server.setRequestHandler(CreateMessageRequestSchema, async () => ({})); // DEPRECATED (sampling)
server.setRequestHandler(ListRootsRequestSchema, async () => ({})); // DEPRECATED (roots)
server.setRequestHandler(SetLevelRequestSchema, async () => ({})); // DEPRECATED (logging)
server.setRequestHandler(ListTasksRequestSchema, async () => ({})); // BREAKING (tasks/list)
server.setRequestHandler(GetTaskResultRequestSchema, async () => ({})); // BREAKING (tasks/result)

// Deprecated-capability method strings (no literal `capabilities` object nearby).
const requested = await server.request('sampling/createMessage', {}); // DEPRECATED
const roots = await server.request('roots/list', {}); // DEPRECATED
server.notification({ method: 'notifications/message', params: {} }); // DEPRECATED (logging)

// sessionIdGenerator — flagged only when it is a real generator.
const active = { sessionIdGenerator: () => crypto.randomUUID() }; // BREAKING (session usage)
const migrated = { sessionIdGenerator: undefined }; // OK — the stateless migration; must NOT fire

export { requested, roots, active, migrated };

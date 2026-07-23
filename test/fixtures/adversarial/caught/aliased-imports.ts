// Adversarial fixture (CAUGHT): aliased imports must not hide SDK constants.
// Both the import line and the aliased *usage sites* must be flagged.

import {
  InitializeRequestSchema as Init,
  ListTasksRequestSchema as ListTasks,
} from '@modelcontextprotocol/sdk/types.js';

declare const server: any;

server.setRequestHandler(Init, async () => ({})); // BREAKING via alias
server.setRequestHandler(ListTasks, async () => ({})); // BREAKING via alias

export {};

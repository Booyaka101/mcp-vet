// Adversarial fixture (CAUGHT): namespace-qualified SDK constants.

import * as types from '@modelcontextprotocol/sdk/types.js';

declare const server: any;

server.setRequestHandler(types.InitializeRequestSchema, async () => ({})); // BREAKING

export {};

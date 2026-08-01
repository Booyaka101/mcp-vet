// TRUE NEGATIVE — a TypeScript MCP client that omits `application_type` and is
// still correct: the SDK derives it. typescript-sdk
// packages/client/src/client/auth.ts:902 —
//   application_type: clientMetadata.application_type ?? deriveApplicationType(clientMetadata.redirect_uris)
// so a loopback redirect URI yields "native" without the caller saying so.
// Only a hand-rolled POST to the registration endpoint can actually omit it.
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

export const clientMetadata: OAuthClientMetadata = {
  client_name: 'example-mcp-client',
  redirect_uris: ['http://127.0.0.1:33418/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
};

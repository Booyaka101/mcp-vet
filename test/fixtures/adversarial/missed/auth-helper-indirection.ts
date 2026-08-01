// KNOWN MISS (documented limitation): both halves of the SEP-2468 iss story
// live inside a third-party helper, so the AST sees neither the redemption nor
// the validation. `oauth.authorizationCodeGrantRequest(...)` performs the
// grant_type=authorization_code token request AND (per its own docs) validates
// the RFC 9207 iss internally — but no 'authorization_code' string literal,
// grant_type key, or iss/issuer read exists in THIS file, so
// AUTH_ISS_UNVALIDATED can neither fire nor verify anything. The same file
// calling a helper that does NOT validate would scan clean too: helper
// indirection is outside the recall boundary of static token analysis.
// This file IS an MCP client, so the file-level context gate is NOT what
// keeps it quiet.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as oauth from 'oauth4webapi';

export async function connectAuthorized(as: any, client: any, params: URLSearchParams) {
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    params,
    'http://127.0.0.1:33418/callback',
    'pkce-verifier',
  );
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, response);
  return new Client({ name: 'helper-indirection', version: '1.0.0' }), tokens;
}

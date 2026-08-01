// The migrated worked example: the same MCP client with application_type
// declared ('native' — SEP-837) and the RFC 9207 iss parameter validated
// against the recorded issuer before the code is redeemed (SEP-2468).
// Must produce ZERO findings.

export async function registerClient(registerUrl: string) {
  const body = {
    redirect_uris: ['http://127.0.0.1:33418/callback'],
    client_name: 'example-mcp-client',
    application_type: 'native',
  };
  const res = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function redeemCode(
  tokenEndpoint: string,
  recordedIssuer: string,
  params: URLSearchParams,
) {
  const iss = params.get('iss');
  if (iss !== null && iss !== recordedIssuer) {
    throw new Error('authorization response iss does not match the recorded issuer');
  }
  const code = params.get('code');
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code ?? '' }),
  });
  return res.json();
}

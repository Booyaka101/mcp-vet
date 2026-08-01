// The 0.10.0 worked example: an MCP client that builds a DCR body
// {redirect_uris, client_name} and posts it to the registration endpoint, then
// later exchanges the authorization code without ever touching iss. The scan
// must emit EXACTLY two findings — AUTH_DCR_NO_APPLICATION_TYPE (medium) and
// AUTH_ISS_UNVALIDATED (medium) — and exit 0 (no BREAKING rule fires).
// The registration endpoint URL arrives as a variable so this file isolates
// the two NEW rules from the pre-existing OAUTH_DCR field-name rule.

export async function registerClient(registerUrl: string) {
  const body = {
    redirect_uris: ['http://127.0.0.1:33418/callback'],
    client_name: 'example-mcp-client',
  };
  const res = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function redeemCode(tokenEndpoint: string, params: URLSearchParams) {
  const code = params.get('code');
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code ?? '' }),
  });
  return res.json();
}

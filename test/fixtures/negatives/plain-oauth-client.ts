// A generic OAuth 2.0 client for a photo-sharing app. It registers dynamically
// without application_type, redeems an authorization code without validating
// iss, and stores its credentials under a bare constant key — all real (if
// sloppy) OAuth, but nothing in this file relates to the protocol this tool
// vets, so the scanner must stay silent. (Deliberately: this file never names
// that protocol — the three auth-hardening rules are gated on that file-level
// context, exactly like the SSE-resumability rule.)

const store = new Map<string, unknown>();

export async function register(registerUrl: string) {
  const body = {
    redirect_uris: ['https://photos.example.com/callback'],
    client_name: 'photo-uploader',
  };
  const res = await fetch(registerUrl, { method: 'POST', body: JSON.stringify(body) });
  const creds = (await res.json()) as { client_id: string; client_secret: string };
  store.set('photo-uploader', { client_id: creds.client_id, client_secret: creds.client_secret });
  return creds;
}

export async function redeem(tokenUrl: string, code: string, clientId: string) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId });
  const res = await fetch(tokenUrl, { method: 'POST', body });
  return res.json();
}

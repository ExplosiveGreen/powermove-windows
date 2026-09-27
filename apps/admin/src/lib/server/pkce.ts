const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A PKCE pair and a state for the API's /v1/auth/web hand-off (the same shape the desktop uses). */
export async function pkce(): Promise<{ state: string; verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(bytes);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { state, verifier, challenge };
}

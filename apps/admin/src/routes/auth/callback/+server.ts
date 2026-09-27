import { redirect } from '@sveltejs/kit';
import { Auth } from '@powermove/registry/wire';
import { cloud } from '$lib/server/cloud';
import { setSession } from '$lib/server/session';
import type { RequestHandler } from './$types';

/* The API hands back a one-time token for the state this browser started.
   Only this server has the verifier, so only it can turn the token into a session. */
export const GET: RequestHandler = async (event) => {
  const [state, verifier] = (event.cookies.get('pm_admin_flow') ?? '').split('.');
  event.cookies.delete('pm_admin_flow', { path: '/auth', secure: event.url.protocol === 'https:' });
  const token = event.url.searchParams.get('token');
  event.setHeaders({ 'Referrer-Policy': 'no-referrer' });
  if (!state || !verifier || !token || event.url.searchParams.get('state') !== state) redirect(303, '/sign-in?error=google');
  let session: { token: string; expiresAt: string };
  try {
    session = await cloud(event, '/v1/auth/web/exchange', { method: 'POST', body: { state, token, verifier }, schema: Auth.WebExchange.Res });
  } catch {
    redirect(303, '/sign-in?error=google');
  }
  setSession(event, session.token, session.expiresAt);
  redirect(303, '/');
};

import { redirect } from '@sveltejs/kit';
import { apiOrigin } from '$lib/server/cloud';
import { pkce } from '$lib/server/pkce';
import type { RequestHandler } from './$types';

/* Google sign-in: keep the verifier here, send the browser to the API with
   the challenge. The API's Google callback comes back to /auth/callback. */
export const GET: RequestHandler = async (event) => {
  const { state, verifier, challenge } = await pkce();
  event.cookies.set('pm_admin_flow', `${state}.${verifier}`, {
    path: '/auth', httpOnly: true, sameSite: 'lax', secure: event.url.protocol === 'https:', maxAge: 600,
  });
  const target = new URL('/v1/auth/web', apiOrigin(event));
  target.search = new URLSearchParams({ provider: 'google', state, challenge }).toString();
  redirect(303, target.toString());
};

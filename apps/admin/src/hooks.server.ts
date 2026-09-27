import type { Handle } from '@sveltejs/kit';
import { readSession, whoami } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.token = readSession(event);
  // The sign-in hand-off routes don't need to know who is asking.
  event.locals.who = event.url.pathname.startsWith('/auth/') ? { state: 'signed-out' } : await whoami(event);
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy', 'same-origin');
  if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
  return response;
};

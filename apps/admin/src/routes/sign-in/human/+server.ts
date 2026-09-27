import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { cloud } from '$lib/server/cloud';
import { HUMAN_COOKIE } from '$lib/server/human';
import type { RequestHandler } from './$types';


/* Polled by the sign-in page while the verification tab is open. The
   clearance is bound to the email and lasts as long as the API says; it is
   not a session. */
export const POST: RequestHandler = async (event) => {
  if (event.request.headers.get('origin') !== event.url.origin) error(403, 'Cross-origin request');
  const body = (await event.request.json().catch(() => null)) as { ticket?: unknown } | null;
  if (typeof body?.ticket !== 'string') error(400, 'Missing ticket');
  const result = await cloud(event, '/v1/human/result', {
    method: 'POST', body: { ticket: body.ticket }, schema: z.object({ clearance: z.string() }).optional(),
  }).catch(() => undefined);
  if (!result) return json({ done: false });
  event.cookies.set(HUMAN_COOKIE, result.clearance, {
    path: '/sign-in', httpOnly: true, sameSite: 'lax', secure: event.url.protocol === 'https:', maxAge: 60 * 60 * 24 * 30,
  });
  return json({ done: true });
};

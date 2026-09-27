import { fail, redirect } from '@sveltejs/kit';
import { Auth } from '@powermove/registry/wire';
import { apiOrigin, cloud, CloudError, problem } from '$lib/server/cloud';
import { setSession } from '$lib/server/session';
import { HUMAN_COOKIE } from '$lib/server/human';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
  error: url.searchParams.get('error') === 'google' ? "Google sign-in didn't finish. Try again." : null,
});

export const actions: Actions = {
  send: async (event) => {
    const email = String((await event.request.formData()).get('email') ?? '').trim();
    if (!email) return fail(400, { step: 'email' as const, email, message: 'Enter your email.' });
    const clearance = event.cookies.get(HUMAN_COOKIE);
    try {
      await cloud(event, '/v1/auth/email/send', {
        method: 'POST', body: { email }, headers: clearance ? { 'X-Powermove-Human': clearance } : {}, schema: Auth.EmailSend.Res,
      });
      return { step: 'code' as const, email };
    } catch (error) {
      // The API asks for a Turnstile check before it emails a code; the check
      // runs on its own origin, and /sign-in/human collects the result.
      if (error instanceof CloudError && error.body?.error === 'human_verification_required') {
        const verifyUrl = new URL('/v1/human', apiOrigin(event));
        verifyUrl.searchParams.set('ticket', error.body.ticket);
        return { step: 'human' as const, email, ticket: error.body.ticket, verifyUrl: verifyUrl.toString() };
      }
      const { status, message } = problem(error);
      return fail(status, { step: 'email' as const, email, message });
    }
  },
  verify: async (event) => {
    const form = await event.request.formData();
    const email = String(form.get('email') ?? '').trim();
    const otp = String(form.get('otp') ?? '').trim();
    if (!otp) return fail(400, { step: 'code' as const, email, message: 'Enter the code.' });
    let session: { token: string; expiresAt: string };
    try {
      session = await cloud(event, '/v1/auth/email/verify', { method: 'POST', body: { email, otp }, schema: Auth.EmailVerify.Res });
    } catch (error) {
      const { status, message } = problem(error);
      return fail(status, { step: 'code' as const, email, message });
    }
    setSession(event, session.token, session.expiresAt);
    redirect(303, '/');
  },
};

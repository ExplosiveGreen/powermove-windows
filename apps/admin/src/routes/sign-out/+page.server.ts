import { redirect } from '@sveltejs/kit';
import { Auth } from '@powermove/registry/wire';
import { cloud } from '$lib/server/cloud';
import { clearSession } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
  default: async (event) => {
    if (event.locals.token) await cloud(event, '/v1/auth/sign-out', { method: 'POST', schema: Auth.SignOut.Res }).catch(() => null);
    clearSession(event);
    redirect(303, '/sign-in');
  },
};

import { fail } from '@sveltejs/kit';
import { Admin } from '@powermove/registry/wire';
import { cloud, problem } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { user } = requireAdmin(event.locals);
  const { items } = await cloud(event, '/v1/admin/admins', { schema: Admin.Admins.Res });
  return { me: user.id, items };
};

export const actions: Actions = {
  grant: async (event) => {
    requireAdmin(event.locals);
    const email = String((await event.request.formData()).get('email') ?? '').trim();
    if (!email) return fail(400, { grant: true, email, message: 'Enter an email.' });
    try {
      await cloud(event, '/v1/admin/admins', { method: 'POST', body: { email }, schema: Admin.Grant.Res });
    } catch (e) {
      const { status, message } = problem(e);
      return fail(status, { grant: true, email, message });
    }
    return { grant: true, email: '', message: null };
  },
  revoke: async (event) => {
    requireAdmin(event.locals);
    const userId = String((await event.request.formData()).get('userId') ?? '');
    try {
      await cloud(event, `/v1/admin/admins/${encodeURIComponent(userId)}`, { method: 'DELETE', schema: Admin.Revoke.Res });
    } catch (e) {
      const { status, message } = problem(e);
      return fail(status, { grant: false, email: '', message });
    }
  },
};

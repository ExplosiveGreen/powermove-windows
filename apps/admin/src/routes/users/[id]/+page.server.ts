import { error, fail } from '@sveltejs/kit';
import { Admin } from '@powermove/registry/wire';
import { cloud, CloudError, problem } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals);
  try { return { account: await cloud(event, `/v1/admin/users/${encodeURIComponent(event.params.id)}`, { schema: Admin.User.Res }) }; }
  catch (e) {
    if (e instanceof CloudError && (e.status === 404 || e.status === 400)) error(404, 'No such user');
    throw e;
  }
};
export const actions: Actions = {
  verified: async (event) => {
    requireAdmin(event.locals);
    const value = (await event.request.formData()).get('verified');
    if (value !== 'true' && value !== 'false') return fail(400, { message: 'Invalid verification status.' });
    try {
      const account = await cloud(event, `/v1/admin/users/${encodeURIComponent(event.params.id)}`, { schema: Admin.User.Res });
      if (!account.publisher || account.publisher.tombstoned) return fail(400, { message: 'This user has no active publisher profile.' });
      await cloud(event, `/v1/admin/publishers/${account.publisher.id}/verified`, { method: 'PUT', body: { verified: value === 'true' }, schema: Admin.SetVerified.Res });
      return { success: true };
    } catch (e) { const { status, message } = problem(e); return fail(status, { message }); }
  },
};

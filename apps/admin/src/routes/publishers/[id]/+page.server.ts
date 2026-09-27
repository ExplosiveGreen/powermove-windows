import { error, fail } from '@sveltejs/kit';
import { Admin } from '@powermove/registry/wire';
import { cloud, CloudError, problem } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals);
  try {
    return { publisher: await cloud(event, `/v1/admin/publishers/${encodeURIComponent(event.params.id)}`, { schema: Admin.Publisher.Res }) };
  } catch (e) {
    if (e instanceof CloudError && (e.status === 404 || e.status === 400)) error(404, 'No such publisher');
    throw e;
  }
};

export const actions: Actions = {
  verified: async (event) => {
    requireAdmin(event.locals);
    const verified = (await event.request.formData()).get('verified') === 'true';
    try {
      await cloud(event, `/v1/admin/publishers/${encodeURIComponent(event.params.id)}/verified`, { method: 'PUT', body: { verified }, schema: Admin.SetVerified.Res });
    } catch (e) {
      const { status, message } = problem(e);
      return fail(status, { message });
    }
  },
};

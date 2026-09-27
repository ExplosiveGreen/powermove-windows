import { error, fail } from '@sveltejs/kit';
import { Admin } from '@powermove/registry/wire';
import { cloud, CloudError, problem } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals);
  try {
    return { extension: await cloud(event, `/v1/admin/extensions/${encodeURIComponent(event.params.id)}`, { schema: Admin.Extension.Res }) };
  } catch (e) {
    if (e instanceof CloudError && (e.status === 404 || e.status === 400)) error(404, 'No such extension');
    throw e;
  }
};

export const actions: Actions = {
  moderate: async (event) => {
    requireAdmin(event.locals);
    const form = await event.request.formData();
    const action = Admin.Moderate.Req.shape.body.shape.action.safeParse(form.get('action'));
    if (!action.success) return fail(400, { message: 'Unknown action.' });
    const reason = String(form.get('reason') ?? '').trim().slice(0, 1000);
    try {
      await cloud(event, `/v1/admin/repos/${encodeURIComponent(event.params.id)}/moderation`, {
        method: 'POST', body: { action: action.data, reason }, schema: Admin.Moderate.Res,
      });
    } catch (e) {
      const { status, message } = problem(e);
      return fail(status, { message });
    }
  },
};

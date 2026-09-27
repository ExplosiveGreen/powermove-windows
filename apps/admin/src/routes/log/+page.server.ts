import { Admin } from '@powermove/registry/wire';
import { cloud } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals);
  const { items } = await cloud(event, '/v1/admin/log?limit=100', { schema: Admin.Log.Res });
  return { items };
};

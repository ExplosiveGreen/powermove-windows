import { Admin } from '@powermove/registry/wire';
import { cloud } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals);
  const q = event.url.searchParams.get('q')?.trim() ?? '';
  const { items } = await cloud(event, `/v1/admin/publishers?${new URLSearchParams(q ? { q } : {})}`, { schema: Admin.Publishers.Res });
  return { q, items };
};

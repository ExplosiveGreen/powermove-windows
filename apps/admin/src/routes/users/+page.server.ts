import { Admin } from '@powermove/registry/wire';
import { cloud } from '$lib/server/cloud';
import { requireAdmin } from '$lib/server/session';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAdmin(event.locals);
  const parsed = Admin.Users.Req.shape.query.safeParse(Object.fromEntries(event.url.searchParams));
  if (!parsed.success) error(400, 'Invalid search or page.');
  const query = parsed.data;
  const params = new URLSearchParams({ q: query.q ?? '', filter: query.filter, offset: String(query.offset), limit: String(query.limit) });
  const result = await cloud(event, `/v1/admin/users?${params}`, { schema: Admin.Users.Res });
  return { ...result, q: query.q ?? '', filter: query.filter };
};

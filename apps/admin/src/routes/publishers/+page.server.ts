import { redirect } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/session';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => { requireAdmin(event.locals); redirect(303, `/users?${new URLSearchParams({ filter: 'publishers', q: event.url.searchParams.get('q') ?? '' })}`); };

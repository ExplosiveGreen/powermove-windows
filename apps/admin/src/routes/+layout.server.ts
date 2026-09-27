import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

const open = (path: string) => path === '/sign-in' || path === '/not-admin';

export const load: LayoutServerLoad = ({ locals, url }) => {
  const { who } = locals;
  if (who.state === 'signed-out' && !open(url.pathname)) redirect(303, '/sign-in');
  if (who.state === 'not-admin' && url.pathname !== '/not-admin') redirect(303, '/not-admin');
  if (who.state === 'admin' && open(url.pathname)) redirect(303, '/');
  if (who.state !== 'not-admin' && url.pathname === '/not-admin') redirect(303, '/');
  return { who };
};

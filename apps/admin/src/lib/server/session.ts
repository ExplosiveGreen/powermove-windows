import { redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { Admin, Me } from '@powermove/registry/wire';
import { cloud, CloudError } from './cloud';

/* The session token lives in an httpOnly cookie on the admin origin only.
   `__Host-` pins it to this host over HTTPS; plain http://localhost can't use it. */
const name = (url: URL) => (url.protocol === 'https:' ? '__Host-pm_admin' : 'pm_admin');
const secure = (url: URL) => url.protocol === 'https:';

export function readSession(event: RequestEvent): string | null {
  return event.cookies.get(name(event.url)) ?? null;
}
export function setSession(event: { cookies: Cookies; url: URL }, token: string, expiresAt: string): void {
  event.cookies.set(name(event.url), token, { path: '/', httpOnly: true, sameSite: 'lax', secure: secure(event.url), expires: new Date(expiresAt) });
}
export function clearSession(event: { cookies: Cookies; url: URL }): void {
  event.cookies.delete(name(event.url), { path: '/', secure: secure(event.url) });
}

export async function whoami(event: RequestEvent): Promise<Who> {
  if (!event.locals.token) return { state: 'signed-out' };
  try {
    const { user } = await cloud(event, '/v1/admin/session', { schema: Admin.Session.Res });
    return { state: 'admin', user };
  } catch (error) {
    if (!(error instanceof CloudError)) throw error;
    if (error.status === 401) {
      clearSession(event);
      event.locals.token = null;
      return { state: 'signed-out' };
    }
    if (error.status !== 403) throw error;
    const me = await cloud(event, '/v1/me', { schema: Me.Get.Res }).catch(() => null);
    return { state: 'not-admin', email: me?.user.email ?? null };
  }
}

/** Every admin page and action starts here. */
export function requireAdmin(locals: App.Locals): Extract<Who, { state: 'admin' }> {
  if (locals.who.state === 'signed-out') redirect(303, '/sign-in');
  if (locals.who.state === 'not-admin') redirect(303, '/not-admin');
  return locals.who;
}

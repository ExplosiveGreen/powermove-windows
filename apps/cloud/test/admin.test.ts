import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Admin, ListingDto, MeDto } from '@powermove/registry/wire';
import { createApp } from '../src/app';
import { admins, desktopAuth, moderationLog, publishers } from '../src/db/schema';
import { withData } from './db';
import { makeEnv } from './env';
import { seedAdmin, seedSession } from './helpers';
import { files, publisher, publishRequest, uploadTree } from './publish-fixture';

const json = async (res: Response): Promise<any> => res.json();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('admin routes: signed out 401, non-admin 403, admin 200; the old token header grants nothing', () =>
  withData(async (data) => {
    const env = makeEnv(data), app = createApp({ data: () => data });
    (env as CloudflareBindings & { ADMIN_TOKEN?: string }).ADMIN_TOKEN = 'legacy-token';
    const someone = await seedSession(data, env, 'someone@example.com');
    const admin = await seedAdmin(data, env);
    const owner = await publisher(data, env, 'alice');
    const token = { 'X-Admin-Token': 'legacy-token' };
    const reads = ['/v1/admin/session', '/v1/admin/publishers', `/v1/admin/publishers/${owner.publisher.id}`, '/v1/admin/extensions', '/v1/admin/admins', '/v1/admin/log'];
    for (const path of reads) {
      expect((await app.request(path, {}, env)).status).toBe(401);
      expect((await app.request(path, { headers: token }, env)).status).toBe(401);
      expect((await app.request(path, { headers: { ...someone.headers, ...token } }, env)).status).toBe(403);
      const ok = await app.request(path, { headers: admin.headers }, env);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('Cache-Control')).toBe('no-store');
    }
    const writes: Array<[string, string, unknown]> = [
      ['PUT', `/v1/admin/publishers/${owner.publisher.id}/verified`, { verified: true }],
      ['POST', '/v1/admin/admins', { email: 'someone@example.com' }],
      ['DELETE', `/v1/admin/admins/${admin.id}`, undefined],
      ['POST', '/v1/admin/publishers', { handle: 'powermove', userId: someone.id }],
    ];
    for (const [method, path, body] of writes) {
      const init = (headers: Record<string, string>) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect((await app.request(path, init(token), env)).status).toBe(401);
      expect((await app.request(path, init({ ...someone.headers, ...token }), env)).status).toBe(403);
    }
    const [row] = await data.db.select().from(publishers).where(eq(publishers.id, owner.publisher.id));
    expect(row!.verifiedAt).toBeNull();
    expect(await data.db.select().from(admins)).toHaveLength(1);
    const session = Admin.Session.Res.parse(await json(await app.request('/v1/admin/session', { headers: admin.headers }, env)));
    expect(session.user).toEqual({ id: admin.id, email: 'admin@example.com', name: 'Jude' });
  }));

test('verify and unverify flip `verified` in listings, detail and /v1/me; the log names the admin', () =>
  withData(async (data) => {
    const env = makeEnv(data), app = createApp({ data: () => data });
    const admin = await seedAdmin(data, env);
    const alice = await publisher(data, env, 'alice');
    const built = await uploadTree(data, env, alice, files());
    expect((await publishRequest(data, env, alice, 'demo', built.commitSha)).status).toBe(201);
    const set = (verified: boolean) => app.request(`/v1/admin/publishers/${alice.publisher.id}/verified`, {
      method: 'PUT', headers: { ...admin.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ verified }),
    }, env);
    const seen = async () => {
      const detail = await json(await app.request('/v1/store/x/alice/demo', {}, env));
      const search = await json(await app.request('/v1/store/extensions?q=demo', {}, env));
      const me = MeDto.parse(await json(await app.request('/v1/me', { headers: alice.headers }, env)));
      const panel = Admin.Publisher.Res.parse(await json(await app.request(`/v1/admin/publishers/${alice.publisher.id}`, { headers: admin.headers }, env)));
      return [detail.owner.verified, ListingDto.parse(search.items[0]).owner.verified, me.publisher!.verified, panel.publisher.verified, panel.extensions[0]!.owner.verified];
    };
    expect(await seen()).toEqual([false, false, false, false, false]);

    const on = await set(true);
    expect(on.status).toBe(200);
    const verified = Admin.SetVerified.Res.parse(await json(on));
    expect(verified.publisher.verified).toBe(true);
    expect(verified.verifiedAt).not.toBeNull();
    expect(await seen()).toEqual([true, true, true, true, true]);
    // Setting it again changes nothing and logs nothing.
    expect((await set(true)).status).toBe(200);

    expect(Admin.SetVerified.Res.parse(await json(await set(false))).publisher.verified).toBe(false);
    expect(await seen()).toEqual([false, false, false, false, false]);

    const log = await data.db.select().from(moderationLog).where(eq(moderationLog.publisherId, alice.publisher.id)).orderBy(moderationLog.createdAt);
    expect(log.map((row) => [row.action, row.actor])).toEqual([['verify', admin.id], ['unverify', admin.id]]);
    const entries = Admin.Log.Res.parse(await json(await app.request('/v1/admin/log', { headers: admin.headers }, env))).items;
    expect(entries.filter((e) => e.target?.kind === 'publisher').map((e) => [e.action, e.actor.label, e.target!.label]))
      .toEqual([['unverify', 'admin@example.com', '@alice'], ['verify', 'admin@example.com', '@alice']]);
    expect((await app.request(`/v1/admin/publishers/${crypto.randomUUID()}/verified`, {
      method: 'PUT', headers: { ...admin.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: true }),
    }, env)).status).toBe(404);
  }));

test('search, moderation by an admin, and the log actor is the admin user id', () =>
  withData(async (data) => {
    const env = makeEnv(data), app = createApp({ data: () => data });
    const admin = await seedAdmin(data, env);
    const alice = await publisher(data, env, 'alice');
    await publisher(data, env, 'bob');
    const built = await uploadTree(data, env, alice, files());
    const repoId = (await json(await publishRequest(data, env, alice, 'demo', built.commitSha))).repo.repoId as string;
    const get = async (path: string) => json(await app.request(path, { headers: admin.headers }, env));

    expect(Admin.Publishers.Res.parse(await get('/v1/admin/publishers')).items.map((p) => p.publisher.handle).sort()).toEqual(['alice', 'bob']);
    const byEmail = Admin.Publishers.Res.parse(await get('/v1/admin/publishers?q=BOB%40example'));
    expect(byEmail.items.map((p) => [p.publisher.handle, p.user?.email])).toEqual([['bob', 'bob@example.com']]);
    expect(Admin.Publishers.Res.parse(await get('/v1/admin/publishers?q=ali')).items[0]!.extensionCount).toBe(1);
    expect(Admin.Publishers.Res.parse(await get('/v1/admin/publishers?q=%25')).items).toHaveLength(0);

    const moderate = (action: string) => app.request(`/v1/admin/repos/${repoId}/moderation`, {
      method: 'POST', headers: { ...admin.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason: 'review' }),
    }, env);
    expect((await moderate('hide')).status).toBe(200);
    expect((await app.request('/v1/store/x/alice/demo', {}, env)).status).toBe(404);
    const hidden = Admin.Extensions.Res.parse(await get('/v1/admin/extensions?q=demo')).items;
    expect(hidden.map((e) => [e.owner.handle, e.slug, e.moderation, e.latestVersion])).toEqual([['alice', 'demo', 'hidden', '1.0.0']]);
    expect((await moderate('unhide')).status).toBe(200);
    expect((await app.request('/v1/store/x/alice/demo', {}, env)).status).toBe(200);
    expect((await moderate('remove')).status).toBe(200);
    expect((await moderate('unhide')).status).toBe(400);
    expect(Admin.Extensions.Res.parse(await get('/v1/admin/extensions')).items[0]!.moderation).toBe('removed');

    const log = await data.db.select().from(moderationLog).where(eq(moderationLog.repoId, repoId)).orderBy(moderationLog.createdAt);
    expect(log.map((row) => [row.action, row.actor])).toEqual([['hide', admin.id], ['unhide', admin.id], ['remove', admin.id]]);
    const entries = Admin.Log.Res.parse(await get('/v1/admin/log?limit=2')).items;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ action: 'remove', reason: 'review', actor: { id: admin.id, label: 'admin@example.com' }, target: { kind: 'repo', id: repoId, label: 'alice/demo' } });
  }));

test('grant by email, revoke, and never the last admin', () =>
  withData(async (data) => {
    const env = makeEnv(data), app = createApp({ data: () => data });
    const admin = await seedAdmin(data, env);
    const mara = await seedSession(data, env, 'mara@example.com');
    const grant = (email: string, headers = admin.headers) => app.request('/v1/admin/admins', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    }, env);
    const revoke = (userId: string, headers = admin.headers) => app.request(`/v1/admin/admins/${userId}`, { method: 'DELETE', headers }, env);

    // Alone: can't revoke yourself.
    const last = await revoke(admin.id);
    expect(last.status).toBe(400);
    expect((await json(last)).detail).toBe("The last admin can't be removed.");

    expect((await grant('nobody@example.com')).status).toBe(404);
    const created = await grant('Mara@Example.com');
    expect(created.status).toBe(201);
    expect(Admin.Grant.Res.parse(await json(created))).toMatchObject({ user: { id: mara.id, email: 'mara@example.com' }, grantedBy: { id: admin.id } });
    expect((await grant('mara@example.com')).status).toBe(200);
    expect((await app.request('/v1/admin/session', { headers: mara.headers }, env)).status).toBe(200);
    const list = Admin.Admins.Res.parse(await json(await app.request('/v1/admin/admins', { headers: admin.headers }, env)));
    expect(list.items.map((a) => a.user.email)).toEqual(['admin@example.com', 'mara@example.com']);

    // Two admins: either can go, including yourself; then the other is the last.
    expect((await revoke(admin.id, mara.headers)).status).toBe(204);
    expect((await app.request('/v1/admin/session', { headers: admin.headers }, env)).status).toBe(403);
    expect((await revoke(mara.id, mara.headers)).status).toBe(400);
    expect((await revoke('missing-user', mara.headers)).status).toBe(404);

    const log = await data.db.select().from(moderationLog).orderBy(moderationLog.createdAt);
    expect(log.map((row) => [row.action, row.userId, row.actor])).toEqual([['grant_admin', mara.id, admin.id], ['revoke_admin', admin.id, mara.id]]);
  }));

test('web sign-in hands its one-time token only to ADMIN_ORIGIN, then the PKCE exchange', () =>
  withData(async (data) => {
    const env = makeEnv(data), app = createApp({ data: () => data });
    const browser = await seedSession(data, env);
    const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(atob(verifier.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))));
    const state = crypto.randomUUID().replaceAll('-', '');
    await data.db.insert(desktopAuth).values({ state, challenge, expiresAt: new Date(Date.now() + 600000) });

    const done = await app.request(`/v1/auth/web/done?state=${state}`, { headers: browser.headers }, env);
    expect(done.status).toBe(302);
    expect(done.headers.get('Referrer-Policy')).toBe('no-referrer');
    const target = new URL(done.headers.get('Location')!);
    expect(target.origin + target.pathname).toBe('https://admin.trypowermove.com/auth/callback');
    expect(target.searchParams.get('state')).toBe(state);

    const exchange = await app.request('/v1/auth/web/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, verifier, token: target.searchParams.get('token') }),
    }, env);
    expect(exchange.status).toBe(200);
    const session = await json(exchange);
    const me = await app.request('/v1/me', { headers: { Authorization: `Bearer ${session.token}` } }, env);
    expect((await json(me)).user.id).toBe(browser.id);

    const unset = { ...env, ADMIN_ORIGIN: undefined } as unknown as CloudflareBindings;
    expect((await app.request(`/v1/auth/web/done?state=${state}`, { headers: browser.headers }, unset)).status).toBe(404);
    expect((await app.request(`/v1/auth/web?provider=google&state=${'a'.repeat(32)}&challenge=${challenge}`, {}, unset)).status).toBe(404);
  }));

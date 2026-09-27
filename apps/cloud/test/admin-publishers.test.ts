import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { publishers } from '../src/db/schema';
import { withData } from './db';
import { makeEnv } from './env';
import { seedAdmin, seedSession } from './helpers';

const json = async (res: Response): Promise<any> => res.json();

test('an admin seeds a reserved handle for an existing user; nobody else can', () =>
  withData(async (data) => {
    const env = makeEnv(data);
    const app = createApp({ data: () => data });
    const s = await seedSession(data, env);
    const admin = await seedAdmin(data, env);
    const post = (body: unknown, headers: Record<string, string> = admin.headers) =>
      app.request(
        '/v1/admin/publishers',
        { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) },
        env
      );

    // The reserved list still applies to the user's own claim.
    const own = await app.request(
      '/v1/me/handle',
      { method: 'POST', headers: { ...s.headers, 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'powermove' }) },
      env
    );
    expect(own.status).toBe(400);
    expect((await json(own)).error).toBe('handle_reserved');

    // Signed out → 401, a signed-in non-admin → 403, and nothing written.
    expect((await post({ handle: 'powermove', userId: s.id }, {})).status).toBe(401);
    expect((await post({ handle: 'powermove', userId: s.id }, s.headers)).status).toBe(403);
    expect(await data.db.select().from(publishers)).toHaveLength(0);

    // Unknown user → 404.
    expect((await post({ handle: 'powermove', userId: 'missing-user' })).status).toBe(404);

    // Seeded.
    const ok = await post({ handle: 'powermove', userId: s.id });
    expect(ok.status).toBe(201);
    expect((await json(ok)).publisher.handle).toBe('powermove');
    const [row] = await data.db.select().from(publishers).where(eq(publishers.userId, s.id));
    expect(row?.handle).toBe('powermove');

    // GET /v1/me sees it; a second seed for the same user is refused; the handle is taken for others.
    const me = await app.request('/v1/me', { headers: s.headers }, env);
    expect((await json(me)).publisher.handle).toBe('powermove');
    expect((await json(await post({ handle: 'official', userId: s.id }))).error).toBe('handle_already_set');
    const other = await seedSession(data, env, 'other@example.com');
    expect((await json(await post({ handle: 'powermove', userId: other.id }))).error).toBe('handle_taken');
  }));

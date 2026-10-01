import { expect, it, vi } from 'vitest';
import { createCloudClient } from './client';
import { createStoreClient } from './store-client';

const origin = 'http://localhost:8787';
const iconPath = `/v1/store/icons/${'a'.repeat(64)}.png`;
const listing = {
  repoId: '11111111-1111-4111-8111-111111111111',
  owner: { id: '22222222-2222-4222-8222-222222222222', handle: 'mara', tombstoned: false },
  slug: 'glass-blur', name: 'Glass blur', tagline: 'Blur', category: 'effects', latest: null,
  iconUrl: iconPath, installCount: 0, forkCount: 0, visibility: 'public', permissions: [], licence: 'MIT', forkedFrom: null,
  createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z', about: null, releases: [], moderation: 'none'
};

function store(iconUrl: string | null = iconPath) {
  const item = { ...listing, iconUrl };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const body = path.endsWith('/browse') ? { sections: [{ id: 'effects', title: 'Effects', items: [item] }] }
      : path.endsWith('/extensions') ? { items: [item], nextCursor: null } : item;
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  return createStoreClient(() => createCloudClient({ origin, getToken: () => null, appVersion: '1.0.0', fetch }));
}

it('uses the selected registry origin for icons on every Store read', async () => {
  const client = store();
  expect((await client.browse()).sections[0]?.items[0]?.iconUrl).toBe(`${origin}${iconPath}`);
  expect((await client.extensions({})).items[0]?.iconUrl).toBe(`${origin}${iconPath}`);
  expect((await client.detail('mara', 'glass-blur')).iconUrl).toBe(`${origin}${iconPath}`);
});

it.each([null, '/bad.png', `https://other.example${iconPath}`, 'data:image/png;base64,AA=='])('uses fallback artwork for an invalid icon path (%s)', async (path) => {
  expect((await store(path).detail('mara', 'glass-blur')).iconUrl).toBeNull();
});

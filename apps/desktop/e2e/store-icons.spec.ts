import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { expect, launchApp, repoRoot, test } from './helpers/app';

test('loads Store icons in the built desktop app and keeps artwork when an image fails', async () => {
  const png = await readFile(path.join(repoRoot, 'e2e/fixtures/still-red.png'));
  const iconPath = `/v1/store/icons/${'a'.repeat(64)}.png`;
  const listing = {
    repoId: '11111111-1111-4111-8111-111111111111',
    owner: { id: '22222222-2222-4222-8222-222222222222', handle: 'mara', tombstoned: false },
    slug: 'glass-blur', name: 'Glass blur', tagline: 'Blur', category: 'effects', latest: null,
    iconUrl: iconPath, installCount: 0, forkCount: 0, visibility: 'public', permissions: [], licence: 'MIT', forkedFrom: null,
    createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z', about: null, releases: [], moderation: 'none'
  };
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/v1/store/icons/')) {
      const found = req.url === iconPath;
      res.writeHead(found ? 200 : 404, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(found ? png : undefined);
      return;
    }
    const body = req.url === '/v1/store/browse' ? { sections: [{ id: 'effects', title: 'Effects', items: [listing] }] }
      : req.url === '/v1/store/x/mara/glass-blur' ? listing : { error: 'not_found' };
    res.writeHead('error' in body ? 404 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const session = await launchApp({ env: { POWERMOVE_REGISTRY_URL: origin } });
  try {
    await session.page.evaluate(() => (window as any).PM.StoreUI.open());
    // The collections carousel is behind STORE_FLAGS.collections; shelf cards always show.
    const card = session.page.locator('.st-item-icon img').first();
    await expect(card).toHaveAttribute('src', `${origin}${iconPath}`);
    await expect.poll(() => card.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await session.page.getByRole('button', { name: 'Open Glass blur', exact: true }).last().click();
    const hero = session.page.locator('.st-detail-head img');
    await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    listing.iconUrl = `/v1/store/icons/${'b'.repeat(64)}.png`;
    await session.page.getByRole('button', { name: 'Back', exact: true }).click();
    await session.page.getByRole('button', { name: 'Open Glass blur', exact: true }).last().click();
    await expect(session.page.locator('.st-detail-head img')).toHaveCount(0);
    await expect(session.page.locator('.st-detail-head .st-thumb')).toBeVisible();
    expect(session.diagnostics.pageErrors).toEqual([]);
  } finally {
    await session.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

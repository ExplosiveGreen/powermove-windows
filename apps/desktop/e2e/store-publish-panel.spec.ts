import type { PublishPlanDto } from '../src/shared/publish';
import type { LibraryItemDto } from '../src/shared/store-ipc';
import { expect, test } from './helpers/app';

test('selecting an extension opens a full publish panel through preparation, cancellation, and reopening', async ({ session }) => {
  const plan: PublishPlanDto = {
    localId: 'demo', coordinate: 'maker/demo', version: '1.0.0', suggestedVersion: '1.0.0', lastVersion: null,
    firstPublish: true, treeSha: 'a'.repeat(40), fileCount: 2, sizeBytes: 120, isFork: false,
    blockedFindings: [], waivableFindings: [], permissionFindings: [
      { path: 'index.ts', line: 1, needs: 'full-access', text: 'Declare full-access for api.render.' },
      { path: 'index.ts', line: 1, needs: 'full-access', text: 'Declare full-access for api.host.' }
    ],
    manifest: { id: 'demo', name: 'Demo', description: null },
    listing: { name: 'Demo', tagline: '', category: 'effects', licence: 'MIT' }
  };
  const item: LibraryItemDto = {
    localId: 'demo', name: 'Demo', version: '1.0.0', category: 'effects', contributes: ['effects'], vars: [],
    health: { state: 'ok' }, enabled: true, trust: 'local', permissions: [], description: null,
    group: 'yours', maker: { you: true }, update: null, modified: false, publish: 'first'
  };
  await session.app.evaluate(({ ipcMain, BrowserWindow }, { item, plan }) => {
    for (const channel of ['store:library', 'store:browse', 'store:publish-prepare']) ipcMain.removeHandler(channel);
    ipcMain.handle('store:library', () => [item]);
    ipcMain.handle('store:browse', () => ({ ok: true, value: { sections: [] } }));
    ipcMain.handle('store:publish-prepare', () => new Promise((resolve) => {
      (globalThis as any).finishPublishPreparation = () => resolve({ ok: true, value: plan });
    }));
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('cloud:account-changed', {
      user: { id: 'test-maker', name: 'Maker', email: 'maker@example.test', image: null },
      publisher: { id: '22222222-2222-4222-8222-222222222222', handle: 'maker', tombstoned: false, verified: false },
      settings: { rememberInstalls: true }
    });
  }, { item, plan });
  await session.page.evaluate(() => (window as any).PM.StoreUI.open('library'));
  await expect(session.page.locator('.st-item.is-library').filter({ hasText: 'Demo' })).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    await session.page.locator('.st-add').click();
    await session.page.locator('.thread-row').filter({ hasText: 'Demo' }).click();
    const modal = session.page.locator('.publish-modal');
    await expect(session.page.locator('.thread-popup')).toHaveCount(0);
    await expect(modal.getByRole('heading', { name: 'Publish Demo', exact: true })).toBeVisible();
    await expect(modal.getByText('Getting it ready…')).toBeVisible();
    await expect.poll(() => modal.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(150);
    await session.app.evaluate(() => (globalThis as any).finishPublishPreparation());
    await expect(modal.locator('input[inputmode="decimal"]')).toBeVisible();
    await expect(modal.getByText('Declare full-access for api.render.')).toHaveCount(1);
    await expect(modal.getByText('Declare full-access for api.host.')).toHaveCount(1);
    await expect.poll(() => modal.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(300);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(session.page.locator('#scrim')).not.toHaveClass(/\bon\b/);
    await expect(session.page.locator('.st-add')).toBeFocused();
  }
  expect(session.diagnostics.pageErrors).toEqual([]);
});

import { expect, test } from './helpers/app';

test.beforeEach(async ({ session }) => { await session.openEditor(); });

test('library builds nearby previews, loads more on scroll, and refreshes cached previews on reopen', async ({ session }) => {
  const { page } = session;
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => {
    const PM = (window as any).PM;
    const builds: Record<string, number> = {};
    (window as any).__libraryBuilds = builds;
    for (let index = 0; index < 48; index++) {
      const id = `speed-${String(index).padStart(2, '0')}`;
      const el = document.createElement('div');
      el.className = 'panel';
      el.innerHTML = `<input value="Original ${index}"><div style="height:250px">Preview ${index}</div>`;
      document.body.appendChild(el);
      PM.PANELS[id] = { title: `AAA speed ${id}`, library: {
        width: 360, height: 300,
        render() { builds[id] = (builds[id] ?? 0) + 1; }
      } };
      PM.panelInst[id] = { el };
    }
    PM.LibraryUI.open();
  });
  const library = page.locator('#library-screen');
  await expect(library.locator('[data-panel-id="speed-00"] .library-clone')).toBeAttached();
  await expect(library).toHaveAttribute('data-previews', 'ready');
  const initial = await page.evaluate(() => ({ ...(window as any).__libraryBuilds }));
  test.info().annotations.push({ type: 'initial preview builds', description: `${Object.keys(initial).length} of 48 panels` });
  expect(Object.keys(initial).length).toBeLessThan(24);
  expect(initial['speed-47']).toBeUndefined();

  const last = library.locator('[data-panel-id="speed-47"]');
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('.library-clone')).toBeAttached();
  await expect.poll(() => page.evaluate(() => (window as any).__libraryBuilds['speed-47'])).toBe(1);

  await page.evaluate(() => {
    const PM = (window as any).PM;
    PM.LibraryUI.close();
    PM.panelInst['speed-47'].el.querySelector('input').value = 'Updated while closed';
    PM.LibraryUI.open();
  });
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('.library-clone input')).toHaveValue('Updated while closed');
  await expect.poll(() => page.evaluate(() => (window as any).__libraryBuilds['speed-47'])).toBe(2);

  // Search and shelf changes reuse the current snapshot, without remeasuring it.
  await library.getByRole('searchbox', { name: 'Search panels' }).fill('AAA speed speed-47');
  await expect(library.locator('.library-card[data-panel-id]')).toHaveCount(1);
  await expect(last.locator('.library-clone input')).toHaveValue('Updated while closed');
  expect(await page.evaluate(() => (window as any).__libraryBuilds['speed-47'])).toBe(2);
  await library.getByRole('button', { name: 'All workspaces', exact: true }).click();
  await library.getByRole('button', { name: 'All panels', exact: true }).click();
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('.library-clone input')).toHaveValue('Updated while closed');
  expect(await page.evaluate(() => (window as any).__libraryBuilds['speed-47'])).toBe(2);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

test('closing the library cancels queued preview work', async ({ session }) => {
  const { page } = session;
  await page.evaluate(() => {
    const PM = (window as any).PM;
    (window as any).__closedLibraryBuilds = 0;
    const el = document.createElement('div');
    el.className = 'panel';
    el.textContent = 'Close before building';
    document.body.appendChild(el);
    PM.PANELS['close-fixture'] = { title: 'AAA close fixture', library: {
      width: 360, height: 300,
      render() { (window as any).__closedLibraryBuilds++; }
    } };
    PM.panelInst['close-fixture'] = { el };
    PM.LibraryUI.open();
    // Close on the first scheduled frame, before queued measurements run.
    requestAnimationFrame(() => PM.LibraryUI.close());
  });
  await expect(page.locator('#library-screen')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__closedLibraryBuilds)).toBe(0);
  await page.evaluate(() => (window as any).PM.LibraryUI.open());
  await expect(page.locator('[data-panel-id="close-fixture"] .library-clone')).toBeAttached();
  expect(await page.evaluate(() => (window as any).__closedLibraryBuilds)).toBe(1);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

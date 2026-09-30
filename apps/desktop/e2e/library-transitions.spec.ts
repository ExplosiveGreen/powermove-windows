import { expect, test } from './helpers/app';

test.beforeEach(async ({ session }) => { await session.openEditor(); });

test('opening and returning from a panel keeps the shelves and restores its live panel', async ({ session }) => {
  const { page } = session;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const PM = (window as any).PM;
    PM.LibraryUI.reveal('notes');
    PM.LibraryUI.open();
  });
  const library = page.locator('#library-screen');
  await expect(library.locator('[data-panel-id="notes"] .library-clone')).toBeAttached();
  await expect(library).toHaveAttribute('data-previews', 'ready');
  await page.evaluate(() => {
    (window as any).__libraryShelf = document.querySelector('.library-shell');
    (window as any).__libraryNotes = (window as any).PM.panelInst.notes.el;
    (window as any).__libraryNotesParent = (window as any).PM.panelInst.notes.el.parentElement;
  });
  const timings: Array<{ open: number; back: number; keptShelves: boolean }> = [];
  for (let index = 0; index < 3; index++) {
    const open = await library.getByRole('button', { name: 'Edit Notes', exact: true }).evaluate((button) => {
      const start = performance.now();
      (button as HTMLElement).click();
      return performance.now() - start;
    });
    await expect(library.locator('.library-stage-live #panel-notes')).toBeVisible();
    const keptShelves = await page.evaluate(() => (window as any).__libraryShelf.isConnected);
    await library.locator('.library-stage-live textarea').fill(`Edited ${index}`);
    const back = await library.getByRole('button', { name: 'Back to panels', exact: true }).evaluate((button) => {
      const start = performance.now();
      (button as HTMLElement).click();
      return performance.now() - start;
    });
    await expect(library.locator('.library-shell')).toBeVisible();
    await expect(library).toHaveAttribute('data-previews', 'ready');
    await expect(library.locator('[data-panel-id="notes"] .library-clone textarea')).toHaveValue(`Edited ${index}`);
    expect(await page.evaluate(() => {
      const PM = (window as any).PM;
      return PM.panelInst.notes.el === (window as any).__libraryNotes
        && PM.panelInst.notes.el.parentElement === (window as any).__libraryNotesParent
        && !PM.panelInst.notes.el.classList.contains('popped');
    })).toBe(true);
    timings.push({ open, back, keptShelves });
  }
  test.info().annotations.push({ type: 'panel transition work', description: JSON.stringify(timings) });
  expect(timings.every(timing => timing.keptShelves)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.library-shell') === (window as any).__libraryShelf)).toBe(true);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

test('quick Back and reopen leave one editor and no abandoned flying cover', async ({ session }) => {
  const { page } = session;
  await page.evaluate(() => (window as any).PM.LibraryUI.open());
  const library = page.locator('#library-screen');
  await library.locator('[data-panel-id="notes"]').scrollIntoViewIfNeeded();
  await expect(library.locator('[data-panel-id="notes"] .library-clone')).toBeAttached();
  await page.evaluate(() => {
    const edit = () => document.querySelector<HTMLButtonElement>('[data-panel-id="notes"] .library-card-hit')!.click();
    edit();
    document.querySelector<HTMLElement>('[aria-label="Back to panels"]')!.click();
    edit();
  });
  await expect(library.locator('.library-stage-live #panel-notes')).toBeVisible();
  await expect(library.locator('.library-fly')).toHaveCount(0);
  await library.press('Escape');
  await expect(library.locator('.library-shell')).toBeVisible();
  await page.evaluate(() => {
    const PM = (window as any).PM;
    document.querySelector<HTMLButtonElement>('[data-panel-id="notes"] .library-card-hit')!.click();
    PM.LibraryUI.close();
    PM.LibraryUI.open();
  });
  await expect(library.locator('.library-shell')).toBeVisible();
  await expect(library.locator('.library-editor')).toHaveCount(0);
  await expect(library.locator('.library-fly')).toHaveCount(0);
  await expect(library.getByRole('searchbox', { name: 'Search panels' })).toBeFocused();
  await expect(library.locator('[data-panel-id="notes"] .library-clone')).toBeAttached();
  expect(session.diagnostics.pageErrors).toEqual([]);
});

for (const reducedMotion of [false, true]) {
  test(`embedded panels keep their document when opened and returned (${reducedMotion ? 'reduced motion' : 'animated'})`, async ({ session }) => {
    const { page } = session;
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.evaluate(() => {
      const PM = (window as any).PM;
      const panel = document.createElement('div');
      panel.id = 'embedded-fixture';
      panel.className = 'panel';
      const frame = document.createElement('iframe');
      frame.srcdoc = '<input value="Embedded panel">';
      (window as any).__embeddedLoads = 0;
      frame.addEventListener('load', () => { (window as any).__embeddedLoads++; });
      panel.appendChild(frame);
      document.body.appendChild(panel);
      PM.PANELS['embedded-fixture'] = { title: 'AAA embedded fixture',
        [Symbol.for('powermove.panel-frame')]: { extensionId: 'embedded-fixture' } };
      PM.panelInst['embedded-fixture'] = { el: panel };
      (window as any).__embeddedPanel = panel;
      PM.LibraryUI.open();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__embeddedLoads)).toBe(1);
    await page.evaluate(() => {
      (window as any).__embeddedPanel.querySelector('iframe').contentWindow.libraryFixtureState = 'Retained';
    });
    const library = page.locator('#library-screen');
    await library.getByRole('button', { name: 'Edit AAA embedded fixture', exact: true }).click();
    await expect(library.locator('.library-stage-live #embedded-fixture')).toBeVisible();
    const state = () => page.evaluate(() => ({
      loads: (window as any).__embeddedLoads,
      value: (window as any).__embeddedPanel.querySelector('iframe').contentWindow.libraryFixtureState
    }));
    expect(await state()).toEqual({ loads: 1, value: 'Retained' });
    await library.getByRole('button', { name: 'Back to panels', exact: true }).click();
    await expect(library.locator('.library-shell')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__embeddedPanel.parentElement === document.body)).toBe(true);
    expect(await state()).toEqual({ loads: 1, value: 'Retained' });
    await library.getByRole('button', { name: 'Edit AAA embedded fixture', exact: true }).click();
    await expect(library.locator('.library-stage-live #embedded-fixture')).toBeVisible();
    await library.getByRole('button', { name: 'Close Library', exact: true }).click();
    await expect(library).toBeHidden();
    expect(await page.evaluate(() => (window as any).__embeddedPanel.parentElement === document.body)).toBe(true);
    expect(await state()).toEqual({ loads: 1, value: 'Retained' });
    expect(session.diagnostics.pageErrors).toEqual([]);
  });
}

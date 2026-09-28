import { expect, test } from './helpers/app';
import { installStoreExtensions, runCommand } from './helpers/sandbox';

type Outcome = { armed: boolean; import: { ok: boolean; id?: string; size?: number; error?: string } | null; copy: { ok: boolean; error?: string } | null };

/* The fixture's panel (test/fixtures/sandbox-clipboard) imports a ~5 MB PNG
   it generates and copies a line of text, each on a real click inside its
   out-of-process view. Its `outcome` command reads the results back. */
test('a sandboxed panel imports a 5 MB image, and copies only with the clipboard permission', async ({ session }) => {
  const ids = await installStoreExtensions(session, [
    { fixture: 'sandbox-clipboard', id: 'sandbox-clipboard', permissions: ['assets', 'clipboard'] },
    { fixture: 'sandbox-clipboard', id: 'sandbox-no-clipboard', permissions: ['assets'] }
  ]);
  await session.relaunch();
  await session.openEditor();
  const { page, app } = session;
  await page.waitForFunction((ids) => ids.every(id => (window as any).PM?.Kernel?.panels?.has(`${id}.panel`)), ids);

  /* Never touch the machine's real clipboard: main's write lands in a list.
     The hidden harness's windows cannot take focus, so they report the focus
     a person's click would give them; the frame focus the host checks is real. */
  await app.evaluate(({ BrowserWindow, clipboard }) => {
    const copied: string[] = [];
    (globalThis as { __copied?: string[] }).__copied = copied;
    const write = (text: string) => { copied.push(text); };
    clipboard.writeText = write;
    if (clipboard.writeText !== write) throw new Error('could not stub the clipboard');
    for (const window of BrowserWindow.getAllWindows()) window.isFocused = () => true;
  });
  await page.evaluate(() => { document.hasFocus = () => true; });
  const copied = () => app.evaluate(() => [...((globalThis as { __copied?: string[] }).__copied ?? [])]);

  const outcome = (id: string) => runCommand<Outcome>(session, `${id}.outcome`);
  for (const [id, dock] of [['sandbox-clipboard', 'right'], ['sandbox-no-clipboard', 'left']] as const) {
    await page.evaluate(({ id, dock }) => { const PM = (window as any).PM; PM.WS.mutate((workspace: any) => PM.Layout.addPanel(workspace, id, dock)); }, { id: `${id}.panel`, dock });
    const frame = page.locator(`[id="panel-${id}.panel"] iframe.ext-panel-frame`);
    await expect(frame).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
    const box = (await frame.boundingBox())!;
    /* An out-of-process view in a hidden window can take a moment before its
       first click lands; press empty panel space until one arrives. */
    await expect.poll(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
      return (await outcome(id) as Outcome).armed;
    }, { timeout: 15_000 }).toBe(true);

    // Import: the first button. The File crosses the 1 MiB RPC limit and lands as a project asset.
    await page.mouse.click(box.x + box.width / 2, box.y + 32);
    await expect.poll(async () => (await outcome(id) as Outcome).import, { timeout: 30_000 }).not.toBeNull();
    const imported = (await outcome(id) as Outcome).import!;
    expect(imported, JSON.stringify(imported)).toMatchObject({ ok: true, id: expect.any(String) });
    expect(imported.size).toBeGreaterThan(4 * 1024 * 1024);
    expect(await page.evaluate((assetId) => (window as any).PM.proj.assets?.[assetId]?.size ?? null, imported.id!)).toBe(imported.size);

    // Copy: the second button, from the now focused view.
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe('ext-panel-frame');
    await page.mouse.click(box.x + box.width / 2, box.y + 64 + 8 + 32);
    await expect.poll(async () => (await outcome(id) as Outcome).copy, { timeout: 10_000 }).not.toBeNull();
    const copy = (await outcome(id) as Outcome).copy!;
    if (id === 'sandbox-clipboard') {
      expect(copy).toEqual({ ok: true });
      expect(await copied()).toEqual(['Copied by sandbox-clipboard']);
    } else {
      expect(copy).toMatchObject({ ok: false, error: expect.stringContaining('clipboard permission') });
      expect(await copied()).toEqual(['Copied by sandbox-clipboard']);
    }
  }
  expect(session.diagnostics.pageErrors).toEqual([]);
});

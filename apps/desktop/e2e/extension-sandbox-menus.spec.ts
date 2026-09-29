import { chooseNativeMenu, expect, test } from './helpers/app';
import { installStoreExtensions, runCommand, waitForCommands } from './helpers/sandbox';

/* A sandboxed layer menu item used to come from the previous open: the
   first right-click showed nothing, and right-clicking B ran A's action. */
test('a sandboxed context-menu item acts on the layer that was right-clicked', async ({ session }) => {
  const ids = await installStoreExtensions(session, [{ fixture: 'sandbox-menus' }]);
  await session.relaunch();
  await session.openEditor();
  await waitForCommands(session, ids, 'marked');
  const { page } = session;
  await page.evaluate(() => {
    const PM = (window as any).PM;
    for (const id of ['menu-a', 'menu-b']) {
      PM.Edit.apply({ type: 'add_layer', id, layerType: 'shape', name: id, duration: 5 }, { label: `e2e: add ${id}` });
    }
  });
  const rightClick = async (layerId: string) => {
    const position = await page.evaluate((layerId) => {
      const timeline = (window as any).PM.Kernel.services.get('timeline');
      const index = timeline.rows.findIndex((row: any) => row.kind === 'layer' && row.L.id === layerId);
      if (index < 0) throw new Error(`no timeline row for ${layerId}`);
      return { x: Math.min(100, timeline.gut / 2), y: timeline.ruler + index * timeline.row - timeline.scrollY + timeline.row / 2 };
    }, layerId);
    await page.locator('#tl-canvas').click({ button: 'right', position });
  };

  const first = await chooseNativeMenu(session, 'Mark this layer', () => rightClick('menu-a'));
  expect(first).toContain('Mark this layer');
  await expect.poll(() => runCommand(session, 'sandbox-menus.marked')).toEqual(['menu-a']);
  await chooseNativeMenu(session, 'Mark this layer', () => rightClick('menu-b'));
  await expect.poll(() => runCommand(session, 'sandbox-menus.marked')).toEqual(['menu-a', 'menu-b']);
});

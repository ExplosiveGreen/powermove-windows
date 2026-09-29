import { expect, type Page } from '@playwright/test';
import { test } from './helpers/app';

async function fixture(page: Page) {
  await page.waitForFunction(() => !!(window as any).PM.Kernel.services.get('timeline')?.cv);
  const ids = await page.evaluate(() => {
    const PM = (window as any).PM, timeline = PM.Kernel.services.get('timeline');
    window.dispatchEvent(new CustomEvent('pm-open-project', { detail: PM.mkProject({ name: 'Directional snapping', dur: 8 }) }));
    PM.ProjectsScreen.hide();
    const moving = PM.mkLayer('solid', { name: 'Moving', from: .5, dur: 1 });
    const target = PM.mkLayer('solid', { name: 'Target', from: 3, dur: 1 });
    PM.proj.layers = [moving, target];
    PM.selectLayers(moving.id); PM.setTime(6); PM.hist.clear();
    timeline.pps = 100; timeline.scrollT = 0; timeline.graph = false;
    PM.bus.emit('layers'); PM.invalidate();
    return { moving: moving.id, target: target.id };
  });
  await expect.poll(() => page.evaluate(() => (window as any).PM.Kernel.services.get('timeline').rows.length)).toBeGreaterThanOrEqual(2);
  return ids;
}

async function point(page: Page, time: number, id?: string) {
  return page.evaluate(({ time, id }) => {
    const timeline = (window as any).PM.Kernel.services.get('timeline');
    const rect = timeline.cv.getBoundingClientRect();
    const index = id ? timeline.rows.findIndex((row: any) => row.kind === 'layer' && row.L.id === id) : -1;
    return {
      x: rect.x + timeline.gut + (time - timeline.scrollT) * timeline.pps,
      y: rect.y + (id ? timeline.ruler + index * timeline.row - timeline.scrollY + timeline.row / 2 : timeline.ruler - 6),
      pps: timeline.pps,
    };
  }, { time, id });
}

async function guide(page: Page) {
  return page.evaluate(() => (window as any).PM.Kernel.services.get('timeline').snapGuide ?? null);
}

test('playhead latches only after crossing an edge and releases for fine movement', async ({ session }, testInfo) => {
  await session.openEditor();
  const { page } = session;
  await fixture(page);
  const start = await point(page, 2.8);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x + 18, start.y);
  expect(await guide(page)).toBeNull();
  expect(await page.evaluate(() => (window as any).PM.time)).toBeLessThan(3);
  await page.mouse.move(start.x + 24, start.y);
  await expect.poll(() => guide(page)).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as any).PM.time)).toBe(3);
  await expect(page.locator('#tl-canvas')).toHaveAttribute('data-snap-target', '3');
  await page.locator('#tl-canvas').screenshot({ path: testInfo.outputPath('latched-playhead.png') });
  await page.mouse.move(start.x + 30, start.y);
  expect(await page.evaluate(() => (window as any).PM.time)).toBe(3);
  // Reverse while still beside the target: the latch releases immediately.
  await page.mouse.move(start.x + 28, start.y);
  await expect.poll(() => guide(page)).toBeNull();
  expect(await page.evaluate(() => (window as any).PM.time)).toBeGreaterThan(3);
  await page.mouse.move(start.x + 19, start.y);
  await expect.poll(() => guide(page)).toBe(3);
  await page.keyboard.up('Shift');
  await expect.poll(() => guide(page)).toBeNull();
  await page.mouse.up();
  expect(session.diagnostics.pageErrors).toEqual([]);
});

for (const gesture of ['move', 'trim'] as const) test(`clip ${gesture} latches to an edge and clears the guide on release`, async ({ session }) => {
  await session.openEditor();
  const { page } = session;
  const ids = await fixture(page);
  const start = await point(page, gesture === 'move' ? 1 : 1.5, ids.moving);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x + 148, start.y, { steps: 5 });
  expect(await guide(page)).toBeNull();
  await page.mouse.move(start.x + 154, start.y);
  await expect.poll(() => guide(page)).toBe(3);
  const state = () => page.evaluate(id => {
    const layer = (window as any).PM.L(id); return { from: layer.from, dur: layer.dur };
  }, ids.moving);
  expect(await state()).toEqual(gesture === 'move' ? { from: 2, dur: 1 } : { from: .5, dur: 2.5 });
  await page.mouse.up(); await page.keyboard.up('Shift');
  await expect.poll(() => guide(page)).toBeNull();
  await page.evaluate(() => (window as any).PM.hist.undo());
  expect(await state()).toEqual({ from: .5, dur: 1 });
  expect(session.diagnostics.pageErrors).toEqual([]);
});

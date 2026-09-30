import { test, expect } from './helpers/app';
import type { Page } from '@playwright/test';

async function setup(page: Page) {
  await page.waitForFunction(() => { const PM = (window as any).PM; return PM.Kernel.services.get('viewer')?.ov && PM.GL?.gl; });
  return page.evaluate(() => {
    const PM = (window as any).PM, timeline = PM.Kernel.services.get('timeline');
    PM.replaceProject(PM.mkProject({ name: 'Text animators', w: 640, h: 360, fps: 30, dur: 4, bg: '#000000' }));
    const layer = PM.mkLayer('text', { name: 'Title', p: { 'position.x': 320, 'position.y': 180 }, d: { text: 'Motion type', size: 64, color: '#ffffff', align: 'center' } });
    layer.dur = 4;
    PM.proj.layers = [layer]; PM.ProjectIndex.invalidate(); PM.touch();
    PM.setTime(0, { force: true }); PM.selectLayers(layer.id); PM.hist.clear();
    timeline.pps = 200; timeline.scrollT = 0; timeline.graph = false;
    PM.bus.emit('layers'); PM.invalidate();
    return layer.id;
  });
}

/** A point in the lower half of the layer's clip, where stagger bands live. */
async function bandPoint(page: Page, time: number, id: string) {
  return page.evaluate(({ time, id }) => {
    const timeline = (window as any).PM.Kernel.services.get('timeline');
    const rect = timeline.cv.getBoundingClientRect();
    const index = timeline.rows.findIndex((row: any) => row.kind === 'layer' && row.L.id === id);
    return { x: rect.x + timeline.gut + (time - timeline.scrollT) * timeline.pps, y: rect.y + timeline.ruler + index * timeline.row - timeline.scrollY + timeline.row - 5 };
  }, { time, id });
}

const timing = (page: Page) => page.evaluate(() => {
  const p = (window as any).PM.proj.layers[0].d.animators[0].p;
  return { delay: p.delay.v, duration: p.duration.v, stagger: p.stagger.v };
});

test('a stagger preset plays without keyframes and its timeline band edits timing with one Undo each', async ({ session }) => {
  await session.openEditor();
  const { page } = session;
  const id = await setup(page);
  await page.getByRole('group', { name: 'Text animator presets' }).getByRole('button', { name: 'Rise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collapse Rise', exact: true })).toBeVisible();

  const coverage = await page.evaluate(() => {
    const PM = (window as any).PM, sum = (t: number) => PM.GL.renderToPixels(t, 320, 180, { transparent: true, mblur: false }).reduce((a: number, v: number) => a + v, 0);
    return { start: sum(0), settled: sum(3), keys: PM.allProps(PM.proj.layers[0]).reduce((n: number, p: any) => n + (p.prop?.kf?.length || 0), 0) };
  });
  expect(coverage.start).toBe(0);
  expect(coverage.settled).toBeGreaterThan(10000);
  expect(coverage.keys).toBe(0);

  const before = await timing(page);
  // Drag the band body half a second later: only Start moves.
  let from = await bandPoint(page, 0.2, id);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y, { steps: 4 }); await page.mouse.move(from.x + 100, from.y, { steps: 4 }); await page.mouse.up();
  expect(await timing(page)).toEqual({ ...before, delay: 0.5 });

  // Drag its end: Duration and Stagger stretch together, Start stays.
  const span = before.duration + before.stagger * 9;
  from = await bandPoint(page, 0.5 + span, id);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y, { steps: 6 }); await page.mouse.up();
  const stretched = await timing(page);
  expect(stretched.delay).toBe(0.5);
  expect(stretched.duration / before.duration).toBeCloseTo((span + 0.5) / span, 1);
  expect(stretched.stagger / before.stagger).toBeCloseTo((span + 0.5) / span, 1);

  await page.evaluate(() => (window as any).PM.hist.undo());
  expect(await timing(page)).toEqual({ ...before, delay: 0.5 });
  await page.evaluate(() => (window as any).PM.hist.undo());
  expect(await timing(page)).toEqual(before);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

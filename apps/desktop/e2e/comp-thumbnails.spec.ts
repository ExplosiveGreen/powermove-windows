import { expect, test } from './helpers/app';

test('composition cards in the media panel preview every composition, open or not', async ({ session }) => {
  await session.openEditor();
  const { page } = session;
  await page.evaluate(() => {
    const PM = (window as any).PM;
    window.dispatchEvent(new CustomEvent('pm-open-project', { detail: PM.mkProject({ name: 'Thumbs', compName: 'Main' }) }));
    PM.ProjectsScreen.hide();
  });
  await page.waitForFunction(() => { const PM = (window as any).PM; return Boolean(PM?.GL?.gl && PM.Comps); });
  await page.evaluate(() => {
    const PM = (window as any).PM;
    const project = PM.mkProject({ name: 'Thumbs', compName: 'Main', w: 320, h: 180, fps: 30, dur: 4, bg: '#000000' });
    const plate = PM.mkLayer('solid', { name: 'Red', from: 0, dur: 4, d: { w: 320, h: 180, color: '#E02020' }, p: { 'position.x': 160, 'position.y': 90 } }, project);
    const card = PM.mkLayer('solid', { name: 'Blue', from: 0, dur: 4, d: { w: 320, h: 180, color: '#2040E0' }, p: { 'position.x': 160, 'position.y': 90 } }, project);
    project.layers = [card, plate];
    PM.replaceProject(project);
    PM.Comps.precompose([card.id], { name: 'Blue Comp', adjustDuration: true });
    PM.WS?.activate?.('design', true);
  });

  const centre = (name: string) => page.locator('.asset-card.is-comp', { hasText: name }).locator('img.comp-thumb')
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data.slice(0, 3));
    });

  await expect(page.locator('.asset-card.is-comp img.comp-thumb')).toHaveCount(2, { timeout: 10_000 });
  // Main nests Blue Comp on top of the red plate; the closed comp renders on its own.
  const [main, blue] = [await centre('Main'), await centre('Blue Comp')];
  expect(blue[2]).toBeGreaterThan(180); expect(blue[0]).toBeLessThan(80);
  expect(main[2]).toBeGreaterThan(180); expect(main[0]).toBeLessThan(80);

  // Editing the closed comp refreshes its thumbnail.
  await page.evaluate(() => {
    const PM = (window as any).PM;
    const id = PM.Comps.list().find((comp: any) => comp.name === 'Blue Comp').id;
    PM.hist.do('Recolor', () => { PM.Comps.get(id).layers[0].d.color = '#20C040'; });
    PM.invalidate('all');
    PM.bus.emit('layers');
  });
  await expect.poll(async () => (await centre('Blue Comp'))[1], { timeout: 10_000 }).toBeGreaterThan(150);
});

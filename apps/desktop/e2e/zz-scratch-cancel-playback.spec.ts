import { expect, test } from './helpers/app';
import { importFixture } from './helpers/media';
import path from 'node:path';

for (const format of ['mp4', 'webm'] as const) for (const playing of [false, true]) test(`scratch ${format} playing=${playing}: playback after cancel`, async ({ session }) => {
  test.setTimeout(90_000);
  await session.openEditor();
  const { page } = session;
  await page.evaluate(() => {
    const PM = (window as any).PM;
    PM.pause(); PM.assets.clear();
    PM.proj = PM.mkProject({ name: 'Cancel', w: 640, h: 360, fps: 30, dur: 10, bg: '#000000' });
    PM.time = 0; PM.sel.layers = [];
    PM.bus.emit('project'); PM.bus.emit('layers');
  });
  await importFixture(page, 'h264-aac.mp4');
  await page.waitForFunction(() => (window as any).PM.proj.layers.some((l: any) => l.type === 'video') && !(window as any).PM.assets.loading?.size);
  const sample = () => page.evaluate(async () => {
    const PM = (window as any).PM; PM.setTime(0, { force: true }); PM.play();
    const t0 = PM.time; await new Promise(r => setTimeout(r, 1200));
    const r = { playing: PM.playing, advanced: PM.time - t0, fps: PM.perf.fps, busy: PM.Export.busy, cancel: PM.Export.cancel, q: PM.quality };
    PM.pause(); return r;
  });
  console.log('before', await sample());
  await session.app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, path.join(session.userData, 'c.' + format));
  await page.evaluate(({ format, playing }) => { const PM = (window as any).PM; if (playing) PM.play(); (window as any).__r = PM.Export.run({ format, audio: true, mblur: false, range: 'all' }); }, { format, playing });
  const progress = page.getByRole('dialog', { name: 'Exporting Cancel' });
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /[1-9]/, { timeout: 30000 });
  await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('result', await page.evaluate(async () => { const r = await (window as any).__r; const PM = (window as any).PM; return { r, busy: PM.Export.busy, playing: PM.playing }; }));
  await page.waitForTimeout(500);
  console.log('after', await sample());
  console.log('after2', await sample());
  console.log('errors', session.diagnostics.pageErrors);
});

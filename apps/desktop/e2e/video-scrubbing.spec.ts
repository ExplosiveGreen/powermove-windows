import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, repoRoot, test } from './helpers/app';

test('HD video scrubbing presents frames throughout a drag and settles at the release position', async ({ session }) => {
  test.setTimeout(60_000);
  await session.openEditor();
  const source = path.join(session.userData, 'scrub-source.mp4');
  // Generate ordinary compressed footage with a long interval between
  // reference frames, rather than depending on a private user's video.
  execFileSync(path.join(repoRoot, 'node_modules/ffmpeg-static/ffmpeg'), [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '120', '-keyint_min', '120',
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p', source,
  ]);
  const { page } = session;
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => (window as any).PM.pickFiles());
  await (await chooser).setFiles(source);
  await page.waitForFunction(() => (window as any).PM.proj.layers.some((l: any) => l.type === 'video'));
  await page.evaluate(async () => {
    const PM = (window as any).PM, layer = PM.proj.layers.find((l: any) => l.type === 'video');
    PM.Edit.apply({ type: 'set_layer', target: layer.id, patch: { from: 0 } });
    await PM.assets.get(layer.d.asset).previewReady;
  });
  const result = await page.evaluate(async () => {
    const PM = (window as any).PM, asset = PM.assets.get(PM.proj.layers.find((l: any) => l.type === 'video').d.asset);
    const original = PM.GL.render;
    let dragging = false;
    const shown: number[] = [];
    PM.GL.render = (time: number, options: any) => {
      const result = original(time, options);
      if (dragging && result !== false) shown.push(time);
      return result;
    };
    try {
      dragging = true;
      const start = performance.now();
      await new Promise<void>(resolve => {
        const move = () => {
          const elapsed = performance.now() - start;
          if (elapsed >= 1200) { resolve(); return; }
          // Forward then reverse, with changing positions on every display tick.
          const fraction = elapsed / 1200;
          PM.setTime(.2 + 3 * (fraction < .5 ? fraction * 2 : 2 - fraction * 2), { raw: true });
          requestAnimationFrame(move);
        };
        move();
      });
      dragging = false;
      PM.setTime(2.5, { raw: true, force: true });
      await new Promise(r => setTimeout(r, 350));
      const video = asset.preview?.el || asset.el;
      const frame = new VideoFrame(video), timestamp = frame.timestamp / 1e6;
      frame.close();
      return { shown, timestamp, time: PM.time, preview: !!asset.preview, originalWidth: asset.el.videoWidth, previewWidth: video.videoWidth };
    } finally { PM.GL.render = original; }
  });
  expect(result.preview).toBe(true);
  expect(result.originalWidth).toBe(1920);
  expect(result.previewWidth).toBe(1280);
  expect(result.shown.length).toBeGreaterThan(20);
  expect(Math.max(...result.shown) - Math.min(...result.shown)).toBeGreaterThan(2);
  expect(result.shown.some((time, i) => i > 0 && time < result.shown[i - 1]!)).toBe(true);
  expect(result.time).toBe(2.5);
  expect(result.timestamp).toBeCloseTo(2.5, 2);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

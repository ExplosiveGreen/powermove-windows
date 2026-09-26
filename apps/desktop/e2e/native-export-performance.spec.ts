import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './helpers/app';

for (const alpha of [false, true]) {
  test(`native export preserves every input pixel (${alpha ? 'alpha' : 'opaque'})`, async ({ session }) => {
    await session.openEditor();
    await session.app.evaluate(({ ipcMain }) => {
      const state = { chunks: [] as number[][], finished: false };
      (globalThis as any).__exportPixels = state;
      for (const name of ['start', 'write', 'finish', 'cancel']) ipcMain.removeHandler(`render:${name}`);
      ipcMain.handle('render:start', () => 'pixel-test');
      ipcMain.handle('render:write', (_e, request) => { state.chunks.push(Array.from(request.data)); });
      ipcMain.handle('render:finish', () => { state.finished = true; return { path: '/test/pixels' }; });
      ipcMain.handle('render:cancel', () => {});
    });
    const expected = await session.page.evaluate(async alpha => {
      const PM = (window as any).PM;
      PM.pause(); PM.agentFrameCapture = true;
      const project = PM.mkProject({ name: 'Native pixel parity', w: 96, h: 64, dur: 1, fps: 6 });
      project.backgroundFill = { type: 'none', stops: [], angle: 0 };
      const shape = PM.mkLayer('shape', { d: { w: 69, h: 43, radius: 11, color: '#a34bf7' }, p: { 'position.x': 38, 'position.y': 25, opacity: 37, rotation: 17 } }, project);
      const bottom = PM.mkLayer('shape', { d: { shape: 'ellipse', w: 41, h: 39, color: '#2bd773' }, p: { 'position.x': 70, 'position.y': 45, opacity: 81 } }, project);
      project.layers = [shape, bottom]; PM.proj = project; PM.touch();
      PM.animate(shape, 'position.x', [{ t: 0, v: 18 }, { t: 1, v: 77 }]);
      const expected: number[] = [];
      // Independent reference matching the established canvas delivery route.
      for (let frame = 0; frame < 6; frame++) {
        const t = frame / 6;
        const pixels = PM.GL.renderToPixels(t, 96, 64, { opaque: !alpha, transparent: alpha, mblur: false, mbSamples: alpha ? 20 : 1, shutter: .5 });
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
        const ctx = canvas.getContext('2d')!, image = ctx.createImageData(96, 64);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
          const src = ((63 - y) * 96 + x) * 4, dst = (y * 96 + x) * 4, a = pixels[src + 3];
          for (let c = 0; c < 3; c++) image.data[dst+c] = !alpha || a === 255 ? pixels[src+c]
            : a === 0 ? 0 : Math.min(255, (pixels[src+c] * 255 / a) | 0);
          image.data[dst+3] = alpha ? a : 255;
        }
        ctx.putImageData(image, 0, 0);
        expected.push(...ctx.getImageData(0, 0, 96, 64).data);
      }
      const serialized = JSON.stringify(project), time = PM.time, quality = PM.quality;
      const result = await PM.Export.run({ format: alpha ? 'prores' : 'mp4', alpha, scale: 1, fps: 6, range: 'all', quality: 'draft', audio: false, mblur: false });
      return { expected, result, preserved: serialized === JSON.stringify(project) && time === PM.time && quality === PM.quality };
    }, alpha);
    const actual = await session.app.evaluate(() => (globalThis as any).__exportPixels);
    expect(expected.result).toEqual({ cancelled: false });
    expect(expected.preserved).toBe(true);
    expect(actual.finished).toBe(true);
    expect(actual.chunks.flat()).toEqual(expected.expected);
    expect(session.diagnostics.pageErrors).toEqual([]);
  });
}

test('profiles full native MP4 delivery at HD and 4K', async ({ session }, info) => {
  test.setTimeout(120_000);
  await session.openEditor();
  await session.app.evaluate(({ dialog }, root) => {
    let sequence = 0;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${root}/profile-${sequence++}.mp4` });
  }, session.userData);
  const results = await session.page.evaluate(async () => {
    const PM = (window as any).PM;
    PM.pause(); PM.agentFrameCapture = true;
    const results: any[] = [];
    for (const [width, height, frames] of [[1920, 1080, 24], [3840, 2160, 12]]) {
      const project = PM.mkProject({ name: 'Native profile', w: width, h: height, dur: 1, fps: frames, bg: '#21344a' });
      const shape = PM.mkLayer('shape', { d: { w: width / 3, h: height / 2, radius: 27, color: '#dd7355' }, p: { 'position.x': width / 2, 'position.y': height / 2, opacity: 63 } }, project);
      project.layers = [shape]; PM.proj = project; PM.touch();
      PM.animate(shape, 'rotation', [{ t: 0, v: 0 }, { t: 1, v: 50 }]);
      for (let warm = 0; warm < 3; warm++) PM.renderFrameTo(warm / frames, width, height, { mblur: false });
      for (let run = 0; run < 3; run++) {
        const originalRead = CanvasRenderingContext2D.prototype.getImageData;
        const originalPut = CanvasRenderingContext2D.prototype.putImageData;
        const originalPixels = PM.GL.renderToPixels;
        let reads = 0, readMs = 0, putMs = 0, gpuMs = 0;
        CanvasRenderingContext2D.prototype.getImageData = function (...args: any[]) {
          const start = performance.now(); const result = (originalRead as any).apply(this, args);
          if (args[2] === width && args[3] === height) { reads++; readMs += performance.now() - start; }
          return result;
        };
        CanvasRenderingContext2D.prototype.putImageData = function (...args: any[]) {
          const start = performance.now(); const result = (originalPut as any).apply(this, args);
          if (args[0].width === width && args[0].height === height) putMs += performance.now() - start;
          return result;
        };
        PM.GL.renderToPixels = (...args: any[]) => { const start = performance.now(); const result = originalPixels(...args); gpuMs += performance.now() - start; return result; };
        try {
          const start = performance.now();
          const result = await PM.Export.run({ format: 'mp4', scale: 1, fps: frames, range: 'all', quality: 'draft', alpha: false, audio: false, mblur: false });
          results.push({ width, height, frames, run, ms: performance.now() - start, reads, readMs, putMs, gpuMs, result });
        } finally {
          CanvasRenderingContext2D.prototype.getImageData = originalRead;
          CanvasRenderingContext2D.prototype.putImageData = originalPut;
          PM.GL.renderToPixels = originalPixels;
        }
      }
    }
    return results;
  });
  console.log('NATIVE_EXPORT', JSON.stringify(results));
  writeFileSync(info.outputPath('native-export-metrics.json'), JSON.stringify(results, null, 2));
  if (process.env.PM_NATIVE_EXPORT_METRICS) writeFileSync(path.resolve(process.env.PM_NATIVE_EXPORT_METRICS), JSON.stringify(results, null, 2));
  for (const result of results) {
    expect(result.result).toEqual({ cancelled: false });
    if (process.env.PM_NATIVE_EXPORT_BASELINE !== '1') expect(result.reads).toBe(0);
  }
  expect(session.diagnostics.pageErrors).toEqual([]);
});

for (const alpha of [false, true]) test(`native ${alpha ? 'alpha' : 'opaque'} export rejects a lost GPU frame and succeeds after recovery`, async ({ session }) => {
  await session.openEditor();
  await session.app.evaluate(({ ipcMain }) => {
    const state = { writes: 0, finishes: 0, cancels: 0 };
    (globalThis as any).__captureRecovery = state;
    for (const name of ['start', 'write', 'finish', 'cancel']) ipcMain.removeHandler(`render:${name}`);
    ipcMain.handle('render:start', () => 'gpu-recovery');
    ipcMain.handle('render:write', () => { state.writes++; });
    ipcMain.handle('render:finish', () => { state.finishes++; return { path: '/test/recovered' }; });
    ipcMain.handle('render:cancel', () => { state.cancels++; });
  });
  const supported = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    PM.pause(); PM.agentFrameCapture = true;
    PM.proj = PM.mkProject({ name: 'Native GPU recovery', w: 64, h: 64, fps: 2, dur: 1, bg: '#9b54c3' }); PM.touch();
    (window as any).__nativeGpuLoss = PM.GL.gl.getExtension('WEBGL_lose_context');
    return !!(window as any).__nativeGpuLoss;
  });
  test.skip(!supported, 'GPU reset extension unavailable');
  const failed = await session.page.evaluate(async alpha => {
    const PM = (window as any).PM, original = PM.GL.renderToPixels;
    PM.GL.renderToPixels = (...args: any[]) => {
      const pixels = original(...args);
      (window as any).__nativeGpuLoss.loseContext();
      return pixels;
    };
    try { return await PM.Export.run({ format: alpha ? 'prores' : 'mp4', alpha, scale: 1, fps: 2, range: 'all', quality: 'draft', audio: false, mblur: false }); }
    finally { PM.GL.renderToPixels = original; }
  }, alpha);
  expect(failed).toEqual({ error: 'The GPU could not capture the export frame' });
  expect(await session.app.evaluate(() => (globalThis as any).__captureRecovery)).toEqual({ writes: 0, finishes: 0, cancels: 1 });
  await expect.poll(() => session.page.evaluate(() => (window as any).PM.GL.contextLost)).toBe(true);
  await session.page.evaluate(() => (window as any).__nativeGpuLoss.restoreContext());
  await expect.poll(() => session.page.evaluate(() => !!(window as any).PM.GL.gl && !(window as any).PM.GL.contextLost)).toBe(true);
  const retry = await session.page.evaluate(async alpha => {
    const PM = (window as any).PM;
    return await PM.Export.run({ format: alpha ? 'prores' : 'mp4', alpha, scale: 1, fps: 2, range: 'all', quality: 'draft', audio: false, mblur: false });
  }, alpha);
  expect(retry).toEqual({ cancelled: false });
  expect(await session.app.evaluate(() => (globalThis as any).__captureRecovery)).toEqual({ writes: 2, finishes: 1, cancels: 1 });
  expect(session.diagnostics.pageErrors).toEqual([]);
});

import { expect, test } from './helpers/app';

test('time-only timeline paints reuse static artwork with identical pixels and live property values', async ({ session }) => {
  await session.openEditor();
  const results = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    PM.pause();
    const project = PM.mkProject({ name: 'Retained timeline artwork', dur: 12 });
    project.layers = Array.from({ length: 200 }, (_, index) => PM.mkLayer('solid', { name: `Layer ${index}`, dur: 12 }, project));
    PM.replaceProject(project);
    const timeline = PM.Kernel.services.get('timeline');
    timeline.pps = 90; timeline.scrollT = 0; timeline.scrollY = 0;
    const now = performance.now();
    const originalNow = performance.now;
    const originalText = CanvasRenderingContext2D.prototype.fillText;
    const originalPath = CanvasRenderingContext2D.prototype.beginPath;
    let text = 0, paths = 0;
    // Freeze only decorative trail integration while comparing the same
    // completed frame through the retained and complete painting paths.
    performance.now = () => now;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof originalText>) {
      if (this.canvas === timeline.cv) text++;
      return originalText.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.beginPath = function () {
      if (this.canvas === timeline.cv) paths++;
      return originalPath.call(this);
    };
    const results: Array<{ properties: boolean; changedChannels: number; maxDelta: number; bounds: number[]; cachedText: number; cachedPaths: number; fullText: number; fullPaths: number }> = [];
    try {
      for (const properties of [false, true]) {
        const layer = PM.proj.layers[0];
        if (properties) {
          PM.setKey(layer, 'opacity', 0, 25); PM.setKey(layer, 'opacity', 2, 100);
          PM.UIState.setLayerCollapsed(layer, false); PM.UIState.setReveal(layer, ['opacity']);
        }
        PM.bus.emit('layers');
        PM.time = .25; PM.bus.emit('time', PM.time); PM.bus.emit('draw:timeline');
        text = paths = 0;
        PM.time = .75; PM.bus.emit('time', PM.time); PM.bus.emit('draw:timeline');
        const cachedText = text, cachedPaths = paths;
        const snapshot = () => {
          const canvas = document.createElement('canvas');
          canvas.width = timeline.cv.width; canvas.height = timeline.cv.height;
          const context = canvas.getContext('2d', { willReadFrequently: true })!;
          context.drawImage(timeline.cv, 0, 0);
          return { canvas, context };
        };
        // Read separate canvases after both paints. Repeated live-canvas
        // getImageData calls switch Chromium's raster backend and change its
        // antialiasing midway through the very comparison being measured.
        const cachedSnapshot = snapshot();
        // The moving trail legitimately keeps a time-only repaint pending.
        // Explicitly invalidate the artwork to obtain a fresh reference.
        PM.bus.emit('layers');
        text = paths = 0;
        PM.bus.emit('draw:timeline');
        const fullText = text, fullPaths = paths;
        const fullSnapshot = snapshot();
        const cached = cachedSnapshot.context.getImageData(0, 0, timeline.cv.width, timeline.cv.height).data;
        const full = fullSnapshot.context.getImageData(0, 0, timeline.cv.width, timeline.cv.height).data;
        let changedChannels = 0, maxDelta = 0;
        const bounds = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < full.length; i++) {
          const delta = Math.abs(full[i] - cached[i]);
          if (delta) {
            changedChannels++;
            const pixel = Math.floor(i / 4), x = pixel % timeline.cv.width, y = Math.floor(pixel / timeline.cv.width);
            bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
            bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
          }
          maxDelta = Math.max(maxDelta, delta);
        }
        results.push({ properties, changedChannels, maxDelta, bounds, cachedText, cachedPaths, fullText, fullPaths });
      }
    } finally {
      performance.now = originalNow;
      CanvasRenderingContext2D.prototype.fillText = originalText;
      CanvasRenderingContext2D.prototype.beginPath = originalPath;
    }
    return results;
  });
  console.log('TIMELINE_PAINT_CACHE', JSON.stringify(results));
  for (const result of results) {
    expect(result.maxDelta).toBeLessThanOrEqual(1);
    expect(result.cachedPaths).toBeLessThan(result.fullPaths / 3);
    expect(result.cachedText).toBeLessThan(result.fullText / 3);
  }
  expect(results[0]!.cachedText).toBe(0);
  expect(results[1]!.cachedText).toBeGreaterThan(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
  expect(session.diagnostics.console.filter(record => record.text.includes('[timeline draw]'))).toEqual([]);
});

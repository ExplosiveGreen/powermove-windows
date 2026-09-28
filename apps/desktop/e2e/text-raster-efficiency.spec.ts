import { expect, test } from './helpers/app';

test('loaded text avoids synchronous readbacks with identical preview and export pixels', async ({ session }) => {
  await session.openEditor();
  const result = await session.page.evaluate(async () => {
    const PM = (window as any).PM, GL = PM.GL, gl = GL.gl;
    PM.pause(); PM.agentFrameCapture = true;
    const project = PM.mkProject({ w: 640, h: 360, dur: 4, bg: '#27314a' });
    project.layers = [
      PM.mkLayer('text', { d: { text: 'Text at changing densities', font: 'Geist', size: 36, color: '#ffffff' }, p: { 'position.x': 30, 'position.y': 30 } }, project),
      PM.mkLayer('text', { d: { text: 'Italic — café\nSecond line', italic: true, size: 26, align: 'center', tracking: 1.5, color: '#fa852780' }, p: { 'position.x': 320, 'position.y': 130 } }, project),
      PM.mkLayer('text', { d: { text: '世界 · مرحبا · 👋', size: 26, weight: 700 }, p: { 'position.x': 30, 'position.y': 260 } }, project),
    ];
    PM.proj = project; PM.touch(); GL.previewViewport = null;
    for (const layer of project.layers) PM.raster(layer, 1, 0);
    await document.fonts.ready;
    const read = CanvasRenderingContext2D.prototype.getImageData;
    const check = document.fonts.check;
    let reads = 0;
    const results: any[] = [];
    CanvasRenderingContext2D.prototype.getImageData = function (...args: any[]) {
      reads++; return (read as any).apply(this, args);
    } as any;
    try {
      for (const width of [640, 960, 1280]) {
        const height = width * 9 / 16;
        GL.resize(width, height);
        for (const exporting of [false, true]) {
          const render = (reference: boolean) => {
            // The reference runs the original pixel-probe recovery path.
            document.fonts.check = reference ? () => false : check;
            PM.rasterClear(); reads = 0;
            let pixels: Uint8Array;
            if (exporting) pixels = GL.renderToPixels(0, width, height, { opaque: true });
            else {
              GL.render(0);
              pixels = new Uint8Array(width * height * 4);
              gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            }
            return { pixels, reads };
          };
          const reference = render(true), optimized = render(false);
          let differences = 0;
          for (let i = 0; i < reference.pixels.length; i++) if (reference.pixels[i] !== optimized.pixels[i]) differences++;
          results.push({ width, exporting, differences, referenceReads: reference.reads, optimizedReads: optimized.reads });
        }
      }
    } finally {
      document.fonts.check = check;
      CanvasRenderingContext2D.prototype.getImageData = read;
      PM.rasterClear();
    }
    return results;
  });
  for (const sample of result) {
    expect(sample.referenceReads).toBeGreaterThan(0);
    expect(sample.optimizedReads).toBe(0);
    expect(sample.differences).toBe(0);
  }
  expect(session.diagnostics.pageErrors).toEqual([]);
});

test('oversized text retains visible pixels in bounded preview textures after pans, edits and scale changes', async ({ session }) => {
  await session.openEditor();
  const result = await session.page.evaluate(async () => {
    const PM = (window as any).PM, GL = PM.GL, gl = GL.gl;
    PM.pause(); PM.agentFrameCapture = true;
    const project = PM.mkProject({ w: 640, h: 360, dur: 4 });
    const layer = PM.mkLayer('text', {
      d: { text: Array.from({ length: 20 }, () => 'MWxyz0123456789 '.repeat(6)).join('\n'), font: 'Geist', size: 18, color: '#ffffff' },
      p: { 'position.x': 320, 'position.y': 180 },
    }, project);
    project.layers = [layer]; PM.proj = project; PM.touch();
    PM.raster(layer, 1, 0); await document.fonts.ready;
    GL.previewViewport = null; GL.resize(640, 360);
    const raster = PM.raster, results: any[] = [];
    try {
      for (const [index, scale] of [8, 12, 8].entries()) {
        layer.p['scale.x'].v = scale * 100; layer.p['scale.y'].v = scale * 100;
        if (index === 2) layer.d.color = '#ea8742';
        const geometry = PM.textRasterGeometry(layer, scale, 0);
        layer.p['position.x'].v = 320 - (geometry.w / 2 - geometry.anchorX) * scale + index * 39;
        layer.p['position.y'].v = 180 - (geometry.h / 2 - geometry.anchorY) * scale;
        PM.touch();
        const render = (clipped: boolean) => {
          PM.rasterClear();
          PM.raster = (l: any, s: any, t: any, u: any, crop: any) => raster(l, s, t, u, clipped ? crop : undefined);
          GL.render(0);
          const pixels = new Uint8Array(640 * 360 * 4);
          gl.readPixels(0, 0, 640, 360, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return { pixels, bytes: GL.memoryStats().textures.bytes };
        };
        const reference = render(false), clipped = render(true);
        let maxDifference = 0, visible = 0;
        for (let i = 0; i < reference.pixels.length; i++) maxDifference = Math.max(maxDifference, Math.abs(reference.pixels[i] - clipped.pixels[i]));
        for (let i = 0; i < clipped.pixels.length; i += 4) if (clipped.pixels[i] > 100) visible++;
        results.push({ maxDifference, visible, referenceBytes: reference.bytes, clippedBytes: clipped.bytes });
      }
    } finally { PM.raster = raster; PM.rasterClear(); }
    return results;
  });
  for (const sample of result) {
    expect(sample.visible).toBeGreaterThan(100);
    // Preserve the existing compositor's one-channel-step interpolation tolerance.
    expect(sample.maxDifference).toBeLessThanOrEqual(1);
    expect(sample.clippedBytes).toBeLessThan(sample.referenceBytes / 4);
  }
  expect(session.diagnostics.pageErrors).toEqual([]);
});

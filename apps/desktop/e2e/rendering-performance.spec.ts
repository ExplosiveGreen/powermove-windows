import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from './helpers/app';

// Optional before/after evidence: set PM_RENDER_BASELINE to a JSON path and
// PM_RECORD_RENDER_BASELINE=1 on the unchanged renderer, then run without it.
test('shared renderer preserves pixels across grouped previews and captures', async ({ session }, info) => {
  test.setTimeout(90_000);
  await session.openEditor();
  const result = await session.page.evaluate(() => {
    const PM = (window as any).PM, GL = PM.GL, gl = GL.gl;
    PM.pause(); PM.agentFrameCapture = true;
    const project = PM.mkProject({ name: 'Render performance', w: 640, h: 360, fps: 30, dur: 3, bg: '#182439' });
    for (let i = 0; i < 180; i++) {
      const group = PM.mkLayer('group', {}, project);
      const child = PM.mkLayer('shape', {
        d: { shape: i % 2 ? 'ellipse' : 'rect', w: 40, h: 32, radius: 7, color: i % 2 ? '#ee7733' : '#44aadd' },
        p: { 'position.x': 20 + i % 18 * 35, 'position.y': 20 + Math.floor(i / 18) * 34, opacity: 65 },
      }, project);
      child.group = group.id;
      project.layers.push(group, child);
    }
    PM.proj = project; PM.touch();
    const images: Record<string, number[]> = {};
    const capture = (label: string, time: number, opaque: boolean, w = 320, h = 180) => {
      images[label] = Array.from(GL.renderToPixels(time, w, h, { opaque, mblur: true, mbSamples: 3 }));
    };
    capture('groups', 0, true);
    const groupedPixels = images.groups!;
    const groupedLayers = project.layers;
    project.layers = project.layers.filter((layer: any) => layer.type !== 'group');
    const owners = project.layers.map((layer: any) => layer.group);
    project.layers.forEach((layer: any) => { layer.group = null; }); PM.touch();
    const flatPixels = GL.renderToPixels(0, 320, 180, { opaque: true, mblur: true, mbSamples: 3 });
    const flatMatches = groupedPixels.every((value, i) => value === flatPixels[i]);
    project.layers.forEach((layer: any, i: number) => { layer.group = owners[i]; });
    project.layers = groupedLayers; PM.touch();
    const group = project.layers[0], child = project.layers[1];
    group.p.opacity.v = 43;
    group.blend = 'screen';
    PM.animate(child, 'rotation', [{ t: 0, v: 0 }, { t: 2, v: 130 }]);
    child.mblur = true; PM.touch();
    capture('styled', .75, true);
    capture('alpha', .75, false);
    capture('resize', .25, true, 160, 90);
    capture('reverse', 0, true);
    const mask = PM.mkMask('rect', project);
    mask.p.x.v = 28; mask.p.y.v = 25; mask.p.w.v = 40; mask.p.h.v = 35;
    group.masks.push(mask); PM.touch();
    capture('mask', .75, true);
    group.solo = true; PM.touch(); capture('solo', 1, true);
    group.solo = false; group.masks = []; group.blend = 'normal'; group.p.opacity.v = 100; child.mblur = false; PM.touch();
    project.backgroundFill = { type: 'none', stops: [], angle: 0 }; PM.touch();
    capture('transparent-background', .75, false);
    group.fx.push(PM.mkEffect('blur')); PM.touch(); capture('group-effect', .75, false);
    group.fx = [];
    group.transitionIn = { type: 'crossfade', dur: .5, p: {} }; PM.touch(); capture('transition', .25, true);
    group.transitionIn = null;
    group.matteSource = project.layers[3].id; PM.touch(); capture('matte', .75, false);
    group.matteSource = null;
    const outer = PM.mkLayer('group', {}, project); outer.p.opacity.v = 70;
    group.group = outer.id; project.layers.unshift(outer); PM.touch(); capture('nested-boundary', .75, false);
    project.layers.shift(); group.group = null;
    project.backgroundFill = { type: 'solid', stops: [{ color: '#182439', position: 0 }], angle: 0 }; PM.touch();
    GL.resize(640, 360, null);
    const metrics: Record<string, { median: number; p95: number; allocations: number }> = {};
    for (const mode of ['preview', 'capture']) {
      const run = (t: number) => mode === 'preview' ? GL.render(t, { exporting: true, mblur: false }) : GL.renderToPixels(t, 640, 360, { opaque: true, mblur: false });
      for (let i = 0; i < 5; i++) run(i / 30);
      let allocations = 0;
      const storage = gl.renderbufferStorage.bind(gl);
      gl.renderbufferStorage = (...args: any[]) => { allocations++; return storage(...args); };
      const times: number[] = [];
      try {
        for (let i = 0; i < 120; i++) {
          const start = performance.now(); run(i / 120); gl.finish();
          times.push(performance.now() - start);
        }
      } finally { gl.renderbufferStorage = storage; }
      times.sort((a,b) => a-b);
      metrics[mode] = { median: times[Math.floor(times.length / 2)]!, p95: times[Math.ceil(times.length * .95) - 1]!, allocations };
    }
    return { images, metrics, flatMatches, errors: [...GL.errors], glError: gl.getError() };
  });
  const hashes = Object.fromEntries(Object.entries(result.images).map(([key, bytes]) => [key, createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')]));
  const evidence = { hashes, metrics: result.metrics };
  writeFileSync(info.outputPath('rendering-metrics.json'), JSON.stringify(evidence, null, 2));
  console.log('RENDERING', JSON.stringify(evidence));
  const baseline = process.env.PM_RENDER_BASELINE;
  if (baseline) {
    if (process.env.PM_RECORD_RENDER_BASELINE === '1') writeFileSync(baseline, JSON.stringify(evidence, null, 2));
    else expect(hashes).toEqual(JSON.parse(readFileSync(baseline, 'utf8')).hashes);
  }
  expect(result.flatMatches).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.glError).toBe(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

for (const topDownOpaque of [false, true]) test(`capture failures release readback buffers and preserve pixels through resize and memory pressure (${topDownOpaque ? 'top-down' : 'raw'})`, async ({ session }) => {
  await session.openEditor();
  const result = await session.page.evaluate(topDownOpaque => {
    const PM = (window as any).PM, GL = PM.GL, gl = GL.gl;
    PM.pause(); PM.agentFrameCapture = true;
    PM.proj = PM.mkProject({ w: 128, h: 72, dur: 1, bg: '#a73366' }); PM.touch();
    const capture = () => GL.renderToPixels(0, 128, 72, { opaque: true, topDownOpaque });
    const first = Array.from(capture());
    const read = gl.readPixels.bind(gl);
    const create = gl.createRenderbuffer.bind(gl), dispose = gl.deleteRenderbuffer.bind(gl);
    const live = new Set();
    let threw = false;
    try {
      gl.createRenderbuffer = () => { const buffer = create(); live.add(buffer); return buffer; };
      gl.deleteRenderbuffer = (buffer: WebGLRenderbuffer | null) => { live.delete(buffer); dispose(buffer); };
      gl.readPixels = () => { throw new Error('injected readback failure'); };
      try { capture(); } catch { threw = true; }
    } finally { gl.readPixels = read; gl.createRenderbuffer = create; gl.deleteRenderbuffer = dispose; }
    const leakedBuffers = live.size;
    const afterFailure = Array.from(capture());
    GL.resize(GL.canvas.width + 1, GL.canvas.height + 1);
    const afterResize = Array.from(capture());
    // Several capture sizes must be included in the normal framebuffer budget.
    for (const width of [512, 768, 1024]) GL.renderToPixels(0, width, width, { opaque: true });
    const bytesBefore = PM.Memory.stats().framebuffers.bytes;
    PM.Memory.setBudget('framebuffers', 1024 * 1024);
    const bytesAfter = PM.Memory.stats().framebuffers.bytes;
    const retainedBytes = GL.pool.filter((f: any) => f.busy).reduce((sum: number, f: any) => sum + f.bytes, 0);
    const afterPressure = Array.from(capture());
    return { first, afterFailure, afterResize, afterPressure, threw, leakedBuffers, bytesBefore, bytesAfter, retainedBytes, glError: gl.getError() };
  }, topDownOpaque);
  expect(result.threw).toBe(true);
  expect(result.leakedBuffers).toBe(0);
  expect(result.afterFailure).toEqual(result.first);
  expect(result.afterResize).toEqual(result.first);
  expect(result.afterPressure).toEqual(result.first);
  expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
  expect(result.bytesAfter).toBeLessThanOrEqual(Math.max(1024 * 1024, result.retainedBytes));
  expect(result.glError).toBe(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

test('captures recover with identical pixels after GPU context loss', async ({ session }) => {
  await session.openEditor();
  const before = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    PM.pause(); PM.agentFrameCapture = true;
    PM.proj = PM.mkProject({ name: 'Readback recovery', w: 128, h: 72, dur: 1, bg: '#275ba3' });
    PM.proj.layers = [PM.mkLayer('shape', { d: { w: 50, h: 40, color: '#fd6432' }, p: { 'position.x': 64, 'position.y': 36, opacity: 47 } }, PM.proj)];
    PM.touch();
    const pixels = Array.from(PM.GL.renderToPixels(0, 128, 72, { opaque: true }));
    (window as any).__readbackContextLoss = PM.GL.gl.getExtension('WEBGL_lose_context');
    return { pixels, project: JSON.stringify(PM.proj), supported: !!(window as any).__readbackContextLoss };
  });
  test.skip(!before.supported, 'GPU reset extension unavailable');
  await session.page.evaluate(() => (window as any).__readbackContextLoss.loseContext());
  await expect.poll(() => session.page.evaluate(() => (window as any).PM.GL.contextLost)).toBe(true);
  expect(await session.page.evaluate(() => (window as any).PM.GL.pool.length)).toBe(0);
  await session.page.evaluate(() => (window as any).__readbackContextLoss.restoreContext());
  await expect.poll(() => session.page.evaluate(() => !!(window as any).PM.GL.gl && !(window as any).PM.GL.contextLost)).toBe(true);
  const after = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    const pixels = Array.from(PM.GL.renderToPixels(0, 128, 72, { opaque: true }));
    return { pixels, project: JSON.stringify(PM.proj), glError: PM.GL.gl.getError() };
  });
  expect(after.pixels).toEqual(before.pixels);
  expect(after.project).toBe(before.project);
  expect(after.glError).toBe(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

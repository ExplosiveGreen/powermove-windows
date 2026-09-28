import { expect, test } from './helpers/app';

test('offscreen captures render at their requested size without reusing preview prefixes', async ({ session }) => {
  await session.openEditor();
  const result = await session.page.evaluate(async () => {
    const PM = (window as any).PM, GL = PM.GL;
    PM.pause(); PM.perf.auto = false; await document.fonts.ready;
    PM.proj = PM.mkProject({ w: 320, h: 180, dur: 6 });
    const foreground = PM.mkLayer('shape', { d: { w: 25, h: 25, color: '#ffffff' } }, PM.proj);
    PM.proj.layers = [foreground, ...Array.from({ length: 12 }, (_, i) => PM.mkLayer('shape', {
      d: { w: 37, h: 29, radius: 7, color: i % 2 ? '#336688' : '#995577' },
      p: { 'position.x': 25 + i % 6 * 52, 'position.y': 50 + Math.floor(i / 6) * 70, rotation: i * 7 },
    }, PM.proj))];
    PM.animate(foreground, 'position.x', [{ t: 0, v: 30 }, { t: 6, v: 290 }]);
    PM.touch(); GL.resize(320, 180, null);
    GL.render(.2, { exporting: true, mblur: false });
    GL.render(.2, { mblur: false }); GL.render(.3, { mblur: false });
    const options = { mblur: false, opaque: true, topDownOpaque: true };
    const checks = [];
    for (const [width, height] of [[80, 45], [320, 180], [640, 360], [160, 90]]) {
      const actual = GL.renderToPixels(.4, width, height, options);
      const reference = GL.renderToPixels(.4, width, height, { ...options, previewReuse: false });
      checks.push({ width, height, same: actual.every((value: number, i: number) => value === reference[i]) });
    }
    return { checks, error: GL.gl.getError() };
  });
  expect(result.checks.every(check => check.same)).toBe(true);
  expect(result.error).toBe(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

test('static artwork is reused beneath animated foreground with identical pixels', async ({ session }) => {
  test.setTimeout(90_000);
  await session.openEditor();
  const result = await session.page.evaluate(async ({ count, width }) => {
    const height = Math.round(width * 9 / 16), columns = Math.ceil(Math.sqrt(count * 16 / 9));
    const PM = (window as any).PM, GL = PM.GL, gl = GL.gl;
    PM.pause(); PM.perf.auto = false; await document.fonts.ready;
    PM.proj = PM.mkProject({ w: width, h: height, dur: 6 });
    const foreground = PM.mkLayer('shape', { d: { w: 60, h: 60, color: '#ee8833' } }, PM.proj);
    PM.proj.layers = [foreground, ...Array.from({ length: count }, (_, i) => PM.mkLayer('shape', {
      d: { w: 20, h: 18, color: i % 2 ? '#336688' : '#995577' },
      p: { 'position.x': i % columns * width / columns, 'position.y': Math.floor(i / columns) * height / Math.ceil(count / columns), opacity: 60 },
    }, PM.proj))];
    PM.animate(foreground, 'position.x', [{ t: 0, v: 30 }, { t: 6, v: width - 30 }]);
    PM.touch(); GL.resize(width, height, null);
    // Compile synchronously; neither phase gets a shader-startup advantage.
    GL.render(.2, { exporting: true, mblur: false });
    const read = () => { const pixels = new Uint8Array(width * height * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
    const phases: any[] = [];
    for (const reuse of [false, true]) {
      GL.previewFrames.clear();
      const samples: number[] = [], draws: number[] = [];
      for (let i = 0; i < 40; i++) {
        const start = performance.now();
        GL.render(.2 + i / 60, { mblur: false, previewReuse: reuse });
        gl.finish();
        if (i > 3) { samples.push(performance.now() - start); draws.push(GL.stats.draws); }
      }
      samples.sort((a, b) => a - b);
      phases.push({ reuse, median: samples[Math.floor(samples.length / 2)], draws: Math.max(...draws) });
    }
    let same = true;
    for (const time of [.21, .4, .7, 2, .21]) {
      GL.render(time, { mblur: false, previewReuse: true }); const cached = read();
      GL.render(time, { mblur: false, previewReuse: false }); const reference = read();
      same &&= cached.every((value, i) => value === reference[i]);
    }
    const background = PM.proj.layers.at(-1); background.d.color = '#ffffff'; PM.touch();
    GL.render(.4, { mblur: false }); const edited = read();
    GL.render(.4, { mblur: false, previewReuse: false }); const reference = read();
    const group = PM.mkLayer('group', {}, PM.proj);
    for (const layer of PM.proj.layers.slice(1)) layer.group = group.id;
    PM.proj.layers.push(group); PM.touch();
    GL.render(.3, { mblur: false }); GL.render(.4, { mblur: false });
    const grouped = read(), groupedDraws = GL.stats.draws;
    GL.render(.4, { mblur: false, previewReuse: false }); const groupedReference = read();
    PM.animate(group, 'opacity', [{ t: 0, v: 0 }, { t: 1, v: 100 }]);
    GL.render(.5, { mblur: false }); const fading = read();
    GL.render(.5, { mblur: false, previewReuse: false }); const fadingReference = read();
    return { count, width, phases, same, editSame: edited.every((value, i) => value === reference[i]), groupedDraws,
      groupSame: grouped.every((value, i) => value === groupedReference[i]), fadeSame: fading.every((value, i) => value === fadingReference[i]), error: gl.getError() };
  }, { count: Number(process.env.PM_STATIC_LAYERS) || 1000, width: Number(process.env.PM_STATIC_WIDTH) || 640 });
  console.log('STATIC_PREVIEW', JSON.stringify(result));
  expect(result.same).toBe(true);
  expect(result.editSame).toBe(true);
  expect(result.groupSame).toBe(true);
  expect(result.fadeSame).toBe(true);
  expect(result.groupedDraws).toBeLessThan(10);
  expect(result.error).toBe(0);
  expect(result.phases[1].draws).toBeLessThan(10);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

test('settled animation spans reuse frames while keys, clip edges, expressions and masks stay accurate', async ({ session }) => {
  await session.openEditor();
  const result = await session.page.evaluate(async () => {
    const PM = (window as any).PM, GL = PM.GL, gl = GL.gl;
    PM.pause(); PM.perf.auto = false; await document.fonts.ready;
    PM.proj = PM.mkProject({ w: 160, h: 90, dur: 6 });
    const layer = PM.mkLayer('shape', { from: 1, dur: 4, d: { w: 40, h: 35, color: '#ffaa22' }, p: { 'position.y': 40 } }, PM.proj);
    PM.proj.layers = [layer];
    PM.animate(layer, 'position.x', [{ t: 1, v: 30 }, { t: 2, v: 120 }]);
    PM.touch(); GL.resize(160, 90, null);
    GL.render(2, { exporting: true, mblur: false });
    const read = () => { const pixels = new Uint8Array(160 * 90 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 160, 90, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
    const checks = [];
    const check = (times: number[]) => {
      for (const time of times) {
        GL.render(time, { mblur: false }); const cached = read(), hit = GL.stats.previewHit;
        GL.render(time, { mblur: false, previewReuse: false }); const fresh = read();
        checks.push({ time, hit, same: cached.every((value, i) => value === fresh[i]) });
      }
    };
    check([.2, .5, 1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 4.999999, 5, 5.2, 6, 1.5]);
    layer.p.rotation.expr = 'T*35'; PM.bus.emit('layers'); check([.2, 1.2, 2, 3.5, 4]);
    layer.p.rotation.expr = ''; layer.masks = [PM.mkMask('rect', PM.proj)];
    layer.masks[0].p.w.kf = [{ t: 0, v: 10 }, { t: 3, v: 100 }]; PM.touch(); check([1.2, 2, 3, 4, 4.5]);
    return { checks, error: gl.getError() };
  });
  expect(result.checks.every(check => check.same)).toBe(true);
  expect(result.checks.some(check => check.hit)).toBe(true);
  expect(result.error).toBe(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

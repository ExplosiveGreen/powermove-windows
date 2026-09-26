import { expect, test } from './helpers/app';

test('opaque capture matches the original row conversion at odd, HD and 4K sizes', async ({ session }) => {
  await session.openEditor();
  const results = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    PM.pause(); PM.agentFrameCapture = true;
    const results = [];
    for (const [w, h] of [[97, 65], [1920, 1080], [3840, 2160]]) {
      const project = PM.mkProject({ w, h, dur: 2, fps: 30 });
      project.backgroundFill = { type: 'linear', stops: [{ color: '#351149', position: 0 }, { color: '#b5db7e', position: 100 }], angle: 37 };
      const group = PM.mkLayer('group', { p: { opacity: 73 } }, project);
      const shape = PM.mkLayer('shape', { d: { w: w * .65, h: h * .57, radius: 13, color: '#a34bf7' }, p: { 'position.x': w * .41, 'position.y': h * .39, opacity: 37, rotation: 17 } }, project);
      const bottom = PM.mkLayer('shape', { d: { shape: 'ellipse', w: w * .43, h: h * .71, color: '#2bd773' }, p: { 'position.x': w * .77, 'position.y': h * .71, opacity: 81 } }, project);
      shape.group = group.id; shape.mblur = true;
      project.layers = [group, shape, bottom]; PM.proj = project; PM.touch();
      PM.animate(shape, 'rotation', [{ t: 0, v: 17 }, { t: 2, v: 63 }]);
      for (const blur of [false, true]) {
        const options = { opaque: true, mblur: blur, mbSamples: 3, shutter: .5 };
        const original = PM.GL.renderToPixels(.37, w, h, options);
        const actual = PM.GL.renderToPixels(.37, w, h, { ...options, topDownOpaque: true });
        let different = 0, maxError = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
          const a = actual[(y * w + x) * 4 + c];
          const b = c === 3 ? 255 : original[((h - y - 1) * w + x) * 4 + c];
          if (a !== b) { different++; maxError = Math.max(maxError, Math.abs(a - b)); }
        }
        results.push({ w, h, blur, different, maxError });
      }
    }
    return results;
  });
  for (const result of results) expect(result, JSON.stringify(result)).toMatchObject({ different: 0, maxError: 0 });
  expect(session.diagnostics.pageErrors).toEqual([]);
});

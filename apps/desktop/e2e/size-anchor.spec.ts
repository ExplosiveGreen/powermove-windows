import { expect, test } from './helpers/app';

test('resized shapes render and hit-test from their anchor in preview and export', async ({ session }) => {
  await session.openEditor();
  const result = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    PM.pause(); PM.perf.auto = false; PM.quality = 1; PM.agentFrameCapture = true;
    const project = PM.mkProject({ w: 128, h: 128, dur: 3, bg: '#000000' });
    const layer = PM.mkLayer('shape', { d: { w: 20, h: 20, radius: 0, stroke: 0, color: '#FF0000' },
      p: { 'anchor.x': -10, 'anchor.y': -10, 'position.x': 32, 'position.y': 32 } }, project);
    project.layers = [layer]; PM.replaceProject(project);
    const edit = PM.Edit.apply({ type: 'set_content', target: layer.id, patch: { w: 60, h: 60 } });
    PM.GL.previewViewport = null; PM.GL.resize(128, 128);
    const samples = [false, true].map(exporting => {
      PM.GL.render(0, { exporting, previewReuse: false, mblur: false });
      const gl = PM.GL.gl;
      const redAt = (x: number, y: number) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(x, 127 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[0];
      };
      return [redAt(24, 24), redAt(34, 34), redAt(88, 88), redAt(96, 96)];
    });
    return { ok: edit.ok, samples, inside: PM.GL.pick(88, 88, 0)?.id === layer.id,
      outside: PM.GL.pick(24, 24, 0)?.id === layer.id };
  });
  expect(result.ok).toBe(true);
  expect(result.samples).toEqual([[0, 255, 255, 0], [0, 255, 255, 0]]);
  expect(result.inside).toBe(true); expect(result.outside).toBe(false);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

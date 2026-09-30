import { expect, it } from 'vitest';
import { makePM } from '../__tests__/make-pm';

function scene(type = 'shape') {
  const PM = makePM('core/easing', 'core/model', 'core/selection', 'core/anim', 'core/history', 'core/editing', 'gl/compositor');
  PM.proj = PM.mkProject({ dur: 5 }); PM.time = 0;
  const layer = PM.mkLayer(type, { d: { w: 100, h: 80, stroke: 0 } });
  PM.proj.layers = [layer]; PM.ProjectIndex.invalidate();
  return { PM, layer };
}

it('resizes a shape from its corner anchor and restores its geometry with Undo', () => {
  const { PM, layer } = scene();
  layer.p['anchor.x'].v = -50; layer.p['anchor.y'].v = -40;
  expect(PM.Edit.apply({ type: 'set_content', target: layer.id, patch: { w: 200, h: 160 } }).ok).toBe(true);
  expect(PM.GL.bounds(layer, 0)).toMatchObject({ x0: -50, y0: -40, x1: 150, y1: 120 });
  PM.hist.undo();
  expect(PM.GL.bounds(PM.L(layer.id), 0)).toMatchObject({ x0: -50, y0: -40, x1: 50, y1: 40 });
  PM.hist.redo();
  expect(PM.GL.bounds(PM.L(layer.id), 0)).toMatchObject({ x0: -50, y0: -40, x1: 150, y1: 120 });
});

it.each(['shape', 'image', 'video', 'solid', 'shader', 'extension', 'precomp'])('anchors animated %s dimensions at every frame', (type) => {
  const { PM, layer } = scene(type);
  const centered = ['shape', 'image', 'video'].includes(type);
  layer.p['anchor.x'].v = centered ? -50 : 0;
  layer.p['anchor.y'].v = centered ? -40 : 0;
  expect(PM.Edit.apply({ type: 'replace_keyframes', target: layer.id, path: 'c.w',
    keyframes: [{ time: 0, value: 100 }, { time: 2, value: 200 }] }).ok).toBe(true);
  for (const time of [0, 1, 2]) {
    const bounds = PM.GL.bounds(layer, time);
    expect(bounds.x0).toBeCloseTo(centered ? -50 : 0);
    expect(bounds.x1 - bounds.x0).toBeCloseTo(100 + time * 50);
    expect(bounds.y0).toBeCloseTo(centered ? -40 : 0);
  }
});

it('moves the anchor after resizing without moving artwork, then resizes from the new pivot', () => {
  const { PM, layer } = scene();
  layer.p['anchor.x'].v = -50;
  PM.Edit.apply({ type: 'set_content', target: layer.id, patch: { w: 200 } });
  const before = PM.GL.bounds(layer, 0);
  PM.Edit.apply({ type: 'set_property', target: layer.id, path: 'anchor.x', value: 50 });
  expect(PM.GL.bounds(layer, 0)).toEqual(before);
  PM.Edit.apply({ type: 'set_content', target: layer.id, patch: { w: 400 } });
  expect(PM.GL.bounds(layer, 0)).toMatchObject({ x0: -150, x1: 250 });
});

it('keeps a centered pivot centered and ignores decorative radius and stroke edits', () => {
  const { PM, layer } = scene();
  PM.Edit.apply({ type: 'set_content', target: layer.id, patch: { radius: 20, stroke: 8 } });
  expect(layer.d.sizeAnchorBounds).toBeUndefined();
  PM.Edit.apply({ type: 'set_content', target: layer.id, patch: { w: 200 } });
  expect(PM.GL.bounds(layer, 0)).toMatchObject({ x0: -104, x1: 104 });
});

it('keeps an external pivot fixed for expression-driven dimensions and transformed hit testing', () => {
  const { PM, layer } = scene();
  layer.p['anchor.x'].v = 100;
  layer.p['anchor.y'].v = -40;
  layer.p.rotation.v = 30; layer.p['scale.x'].v = 150;
  expect(PM.Edit.apply({ type: 'set_expression', target: layer.id, path: 'c.w', expression: '100 + t * 50' }).ok).toBe(true);
  const bounds = PM.GL.bounds(layer, 2);
  expect(bounds).toMatchObject({ x0: -200, x1: 0 });
  const matrix = PM.worldMatrix(layer, 2);
  const local = { x: -100, y: 0 };
  const x = matrix[0] * local.x + matrix[2] * local.y + matrix[4];
  const y = matrix[1] * local.x + matrix[3] * local.y + matrix[5];
  expect(PM.GL.pick(x, y, 2)).toBe(layer);
});

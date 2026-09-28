import { expect, it } from 'vitest';
import { previewPlan } from './preview-plan';

const layer = (extra = {}) => ({ type: 'shape', from: 0, dur: 10, d: {}, p: {}, ...extra });
it('shares static spans but separates clip entrances and exits', () => {
  const plan = previewPlan({ layers: [layer(), layer({ from: 3, dur: 2 })] });
  expect(plan.timeKey(1)).toBe(plan.timeKey(2));
  expect(plan.timeKey(2)).not.toBe(plan.timeKey(4));
  expect(plan.timeKey(4)).not.toBe(plan.timeKey(6));
  expect(plan.timeKey(3)).toBe(3);
  expect(plan.timeKey(3 - 1e-6)).toBe(3 - 1e-6);
});
it('renders changing keyframes normally and reuses their settled holds', () => {
  const plan = previewPlan({ layers: [layer({ from: 1, p: { x: { v: 0, kf: [{ t: 1, v: 0 }, { t: 3, v: 10 }] } } })] });
  expect(plan.timeKey(1.2)).toBe(plan.timeKey(1.8));
  expect(plan.timeKey(2.5)).toBe(2.5);
  expect(plan.timeKey(5)).toBe(plan.timeKey(6));
  expect(plan.timeKey(1.99, .02)).toBe(1.99);
  expect(plan.timeKey(4.01, .02)).toBe(4.01);
});
it('keeps expressions, custom renderers, effects and video on the live path', () => {
  for (const extra of [{ p: { x: { v: 0, kf: [], expr: 'T' } } }, { type: 'video' }, { type: 'precomp' }, { fx: [{}] }, { d: { animators: [{}] } }]) {
    const plan = previewPlan({ layers: [layer(extra)] });
    expect(plan.timeKey(1)).toBe(1);
    expect(plan.timeKey(2)).toBe(2);
  }
});
it('only admits independent static layers to the reusable bottom stack', () => {
  const staticLayer = layer();
  const plan = previewPlan({ layers: [staticLayer, layer({ parent: 'moving' }), layer({ group: 'moving' }), layer({ p: { x: { v: 0, kf: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } } })] });
  expect([...plan.staticLayers]).toEqual([staticLayer]);
});
it('retains static grouped artwork but follows animated ancestors and rejects cycles', () => {
  const group = layer({ id: 'group', type: 'group' });
  const child = layer({ group: 'group' });
  expect(previewPlan({ layers: [group, child] }).staticLayers.has(child)).toBe(true);
  group.p = { x: { v: 0, kf: [], expr: 'T' } };
  expect(previewPlan({ layers: [group, child] }).staticLayers.has(child)).toBe(false);
  expect(previewPlan({ layers: [layer({ id: 'a', parent: 'b' }), layer({ id: 'b', parent: 'a' })] }).staticLayers.size).toBe(0);
});
it('reuses flat and held sections of animation without freezing native speed-handle overshoots', () => {
  const a = { t: 0, v: 20, outInterp: 'bezier', outEase: { speed: 0, influence: 33 } };
  const b = { t: 2, v: 20, inInterp: 'bezier', inEase: { speed: 0, influence: 33 }, outInterp: 'hold' };
  const c = { t: 4, v: 40 };
  const project = { layers: [layer({ p: { x: { v: 20, kf: [a, b, c] } } }), layer({ type: 'audio' })] };
  expect(previewPlan(project).timeKey(.5)).toBe(previewPlan(project).timeKey(1.5));
  expect(previewPlan(project).timeKey(2.5)).toBe(previewPlan(project).timeKey(3.5));
  a.outEase.speed = 10;
  expect(previewPlan(project).timeKey(.5)).toBe(.5);
});

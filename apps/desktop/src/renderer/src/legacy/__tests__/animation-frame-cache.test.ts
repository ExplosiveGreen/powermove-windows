import { describe, expect, it } from 'vitest';
import { makePM } from './make-pm';

describe('animation frame cache', () => {
  it('evaluates transform and opacity at each frame, including backwards seeks and parent chains', () => {
    const PM = makePM('core/easing', 'core/model', 'core/anim');
    PM.proj = PM.mkProject({ dur: 5 });
    const parent = PM.mkLayer('solid'), child = PM.mkLayer('solid');
    PM.proj.layers = [parent, child]; child.parent = parent.id;
    parent.p['position.x'].v = 0; child.p['position.x'].v = 10;
    PM.animate(parent, 'position.x', [{ t: 0, v: 0 }, { t: 2, v: 200 }], { ease: 'linear' });
    PM.animate(parent, 'opacity', [{ t: 0, v: 100 }, { t: 2, v: 0 }], { ease: 'linear' });
    for (const t of [0, 1, 2, .5, 0]) {
      PM.beginEval(t);
      expect(PM.worldMatrix(child, t)[4]).toBeCloseTo(10 + 100 * t);
      expect(PM.worldOpacity(child, t)).toBeCloseTo(1);
    }
  });

  it('reuses local transforms within a frame and invalidates them after edits', () => {
    const PM = makePM('core/easing', 'core/model', 'core/anim');
    PM.proj = PM.mkProject({ dur: 5 });
    const layer = PM.mkLayer('solid');
    PM.proj.layers = [layer];
    PM.animate(layer, 'position.x', [{ t: 0, v: 0 }, { t: 2, v: 200 }], { ease: 'linear' });
    PM.beginEval(1);
    const before = PM.localMatrix(layer, 1);
    expect(PM.localMatrix(layer, 1)).toBe(before);
    expect(before[4]).toBeCloseTo(100);
    layer.p['position.x'].kf[1].v = 400;
    PM.touch(); PM.beginEval(1);
    expect(PM.localMatrix(layer, 1)[4]).toBeCloseTo(200);
    PM.beginEval(.5);
    expect(PM.localMatrix(layer, .5)[4]).toBeCloseTo(100);
  });

  it('reuses static transforms across frames and detects direct value and channel replacements', () => {
    const PM = makePM('core/easing', 'core/model', 'core/anim');
    PM.proj = PM.mkProject({ dur: 5 });
    const layer = PM.mkLayer('solid'); PM.proj.layers = [layer];
    layer.p['position.x'].v = 10;
    PM.beginEval(0); const first = PM.localMatrix(layer, 0);
    PM.beginEval(1);
    expect(PM.localMatrix(layer, 1)).toBe(first);
    expect(PM.worldMatrix(layer, 1)).toBe(first);
    layer.p['position.x'].v = 20;
    PM.beginEval(2);
    expect(PM.localMatrix(layer, 2)[4]).toBe(20);
    layer.p['position.x'] = PM.P(30);
    PM.beginEval(3);
    expect(PM.localMatrix(layer, 3)[4]).toBe(30);
    layer.p['position.x'].v = 40;
    PM.touch(); PM.beginEval(3);
    expect(PM.localMatrix(layer, 3)[4]).toBe(40);
  });

  it('switches from static transforms to expressions and animation without freezing later samples', () => {
    const PM = makePM('core/easing', 'core/model', 'core/anim');
    PM.proj = PM.mkProject({ dur: 5 });
    const layer = PM.mkLayer('solid'); PM.proj.layers = [layer];
    PM.beginEval(0); PM.localMatrix(layer, 0);
    layer.p['position.x'].expr = 'T * 100';
    for (const time of [1, 2, .5]) {
      PM.beginEval(time); expect(PM.localMatrix(layer, time)[4]).toBe(time * 100);
    }
    layer.p['position.x'].expr = null;
    layer.p['position.x'].v = 25;
    PM.beginEval(3); const stationary = PM.localMatrix(layer, 3);
    expect(stationary[4]).toBe(25);
    PM.beginEval(4); expect(PM.localMatrix(layer, 4)).toBe(stationary);
    PM.animate(layer, 'position.x', [{ t: 0, v: 0 }, { t: 2, v: 200 }]);
    PM.beginEval(1); expect(PM.localMatrix(layer, 1)[4]).toBeCloseTo(100);
    PM.beginEval(.5); expect(PM.localMatrix(layer, .5)[4]).toBeCloseTo(50);
  });

  it('keeps a static child attached to its animated parent across frames', () => {
    const PM = makePM('core/easing', 'core/model', 'core/anim');
    PM.proj = PM.mkProject({ dur: 5 });
    const parent = PM.mkLayer('solid'), child = PM.mkLayer('solid');
    child.parent = parent.id; child.p['position.x'].v = 10;
    PM.proj.layers = [parent, child];
    PM.animate(parent, 'position.x', [{ t: 0, v: 0 }, { t: 2, v: 200 }]);
    for (const time of [0, 1, 2, .5]) {
      PM.beginEval(time); expect(PM.worldMatrix(child, time)[4]).toBeCloseTo(10 + time * 100);
    }
  });
});

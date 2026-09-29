import { describe, expect, it } from 'vitest';
import { graphAxisColor, graphKeyShape, graphPlotTop, graphValueTicks } from './graph-presentation';

describe('graph presentation', () => {
  it('keeps axis identity through reordered selections', () => {
    expect(graphAxisColor('position.x', 0)).toBe(graphAxisColor('position.x', 3));
    expect(graphAxisColor('scale.y')).not.toBe(graphAxisColor('scale.x'));
  });
  it('labels readable intervals across negative, fractional, and large ranges', () => {
    expect(graphValueTicks(-120, 310, 400)).toEqual([-100, -50, 0, 50, 100, 150, 200, 250, 300]);
    expect(graphValueTicks(-.03, .07, 220)).toEqual([-.02, 0, .02, .04, .06]);
    expect(graphValueTicks(0, Infinity, 200)).toEqual([]);
    expect(graphValueTicks(1, 1, 200)).toEqual([]);
  });
  it('distinguishes held, linear, and curved keys', () => {
    expect(graphKeyShape({ hold: true, inInterp: 'bezier' })).toBe('hold');
    expect(graphKeyShape({ outInterp: 'hold' })).toBe('hold');
    expect(graphKeyShape({ inInterp: 'bezier' })).toBe('bezier');
    expect(graphKeyShape({ inInterp: 'linear', outInterp: 'linear' })).toBe('linear');
  });
  it('reserves usable space on both sides of the adjustable split', () => {
    expect(graphPlotTop(28, 400, false)).toBe(28);
    expect(graphPlotTop(28, 400, true, 0)).toBeCloseTo(102.4);
    expect(graphPlotTop(28, 400, true, 1)).toBeCloseTo(269.8);
  });
});

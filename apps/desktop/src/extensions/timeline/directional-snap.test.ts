import { describe, expect, it } from 'vitest';
import { createDirectionalSnapper } from './directional-snap';

describe('directional timeline latching', () => {
  const anchors = [{ time: 0 }];
  const targets = [{ time: 2 }];
  it('does not attract a pointer near an edge, and acquires only when crossing it', () => {
    const snap = createDirectionalSnapper(1);
    expect(snap.resolve(anchors, 1.98, targets, .15)).toEqual({ delta: 1.98, lock: null });
    expect(snap.resolve(anchors, 2.02, targets, .15)).toEqual({ delta: 2, lock: { anchor: 0, target: 2, direction: 1 } });
    expect(snap.resolve(anchors, 2.1, targets, .15).delta).toBe(2);
    expect(snap.resolve(anchors, 2.16, targets, .15)).toEqual({ delta: 2.16, lock: null });
    expect(snap.resolve(anchors, 2.17, targets, .15).lock).toBeNull();
  });
  it('works in both directions and releases immediately when reversing', () => {
    const snap = createDirectionalSnapper(3);
    expect(snap.resolve(anchors, 2.02, targets, .15).lock).toBeNull();
    expect(snap.resolve(anchors, 1.98, targets, .15).lock?.direction).toBe(-1);
    expect(snap.resolve(anchors, 1.99, targets, .15)).toEqual({ delta: 1.99, lock: null });
    // Fine positioning remains free until the next crossing.
    expect(snap.resolve(anchors, 1.995, targets, .15).delta).toBe(1.995);
    expect(snap.resolve(anchors, 2.01, targets, .15).delta).toBe(2);
  });
  it('does not reacquire a latch in the sample that reverses across its edge', () => {
    const snap = createDirectionalSnapper(1);
    snap.resolve(anchors, 2.05, targets, .15);
    expect(snap.resolve(anchors, 1.99, targets, .15)).toEqual({ delta: 1.99, lock: null });
  });
  it('does not snap when toggled at rest or acquire an edge passed while disabled', () => {
    const snap = createDirectionalSnapper(1);
    snap.resolve(anchors, 2.02, targets, .15, false);
    expect(snap.resolve(anchors, 2.02, targets, .15).lock).toBeNull();
    expect(snap.resolve(anchors, 2.05, targets, .15).lock).toBeNull();
    expect(snap.resolve(anchors, 1.99, targets, .15).delta).toBe(2);
    expect(snap.resolve(anchors, 1.98, targets, .15, false).delta).toBe(1.98);
  });
  it('moves a rigid selection from any eligible edge without changing its spacing', () => {
    const snap = createDirectionalSnapper();
    const group = [{ time: 1, edge: 'in' as const }, { time: 3, edge: 'out' as const }, { time: 5, edge: 'out' as const }];
    const result = snap.resolve(group, 1.05, [{ time: 6, edge: 'out' }], .15);
    expect(result).toEqual({ delta: 1, lock: { anchor: 2, target: 6, direction: 1 } });
    expect(group.map(anchor => anchor.time + result.delta)).toEqual([2, 4, 6]);
  });
  it('ignores incompatible edges and never jumps to a distant target crossed by a fast drag', () => {
    const snap = createDirectionalSnapper();
    expect(snap.resolve([{ time: 1, edge: 'in' }], 1.01, [{ time: 2, edge: 'out' }], .15).lock).toBeNull();
    expect(snap.resolve(anchors, 5, targets, .15).lock).toBeNull();
  });
  it('keeps the same latch among dense targets and releases a removed target', () => {
    const snap = createDirectionalSnapper(1);
    const dense = [{ time: 2 }, { time: 2.05 }];
    snap.resolve(anchors, 2.01, dense, .15);
    expect(snap.resolve(anchors, 2.07, dense, .15).delta).toBe(2);
    expect(snap.resolve(anchors, 2.08, [{ time: 2.05 }], .15).lock).toBeNull();
  });
  it('chooses the last crossed target and does not let a weighted target pull backwards', () => {
    const snap = createDirectionalSnapper(1.8);
    expect(snap.resolve(anchors, 2.06, [{ time: 2, weight: 3 }, { time: 2.05 }], .15).delta).toBe(2.05);
  });
  it('does not latch while moving away from an initially aligned edge', () => {
    const snap = createDirectionalSnapper(2);
    expect(snap.resolve(anchors, 2.01, targets, .15).lock).toBeNull();
    snap.reset(1.99);
    expect(snap.resolve(anchors, 2.01, targets, .15).delta).toBe(2);
  });
});

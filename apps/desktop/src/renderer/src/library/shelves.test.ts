import { describe, expect, it } from 'vitest';

import { coverSize, MAX_PREVIEW_HEIGHT, MAX_PREVIEW_WIDTH, packRows, panelSource, shelfScale } from './shelves';

describe('panelSource', () => {
  it('uses the Store grouping and names the maker of an install', () => {
    expect(panelSource({ ownerId: 'grain', item: { group: 'store', maker: { handle: 'mara' } } as never }))
      .toEqual({ shelf: 'store', extensionId: 'grain', maker: 'by mara' });
    expect(panelSource({ ownerId: 'mine', item: { group: 'yours', maker: { you: true } } as never }))
      .toEqual({ shelf: 'yours', extensionId: 'mine' });
  });

  it('falls back to the loader record, then to generated sections', () => {
    expect(panelSource({ ownerId: 'x', record: { scope: 'user', trust: 'store-trusted' } }).shelf).toBe('store');
    expect(panelSource({ ownerId: 'timeline', record: { scope: 'builtin', trust: 'builtin' } }).shelf).toBe('builtin');
    expect(panelSource({ ownerId: 'local', record: { scope: 'user', trust: 'local' } }).shelf).toBe('yours');
    expect(panelSource({ generated: true }).shelf).toBe('yours');
    expect(panelSource({}).shelf).toBe('builtin');
  });
});

describe('cover geometry', () => {
  it('keeps every panel at one scale so relative sizes survive', () => {
    const wide = coverSize({ width: 800, height: 440 }, 0.5);
    const normal = coverSize({ width: 360, height: 320 }, 0.5);
    expect(wide).toEqual({ width: 400, height: 220, scale: 0.5 });
    expect(normal).toEqual({ width: 180, height: 160, scale: 0.5 });
  });

  it('crops a very long or very wide panel to the preview bounds at the shared scale', () => {
    const tall = coverSize({ width: 360, height: 2400 }, 0.5);
    expect(tall).toEqual({ width: 180, height: MAX_PREVIEW_HEIGHT / 2, scale: 0.5 });
    const wide = coverSize({ width: 1600, height: 300 }, 0.5);
    expect(wide).toEqual({ width: MAX_PREVIEW_WIDTH / 2, height: 150, scale: 0.5 });
  });

  it('shrinks a cover whole only when the shelf itself is narrower', () => {
    const wide = coverSize({ width: 800, height: 440 }, 0.5, 300);
    expect(wide.width).toBe(300);
    expect(wide.height).toBe(165);
  });

  it('bounds the shared scale to the shelf width', () => {
    expect(shelfScale(200)).toBe(0.4);
    expect(shelfScale(850)).toBeCloseTo(0.5);
    expect(shelfScale(4000)).toBe(0.56);
    expect(shelfScale(0)).toBe(0.5);
  });
});

describe('packRows', () => {
  it('fills rows left to right and wraps what does not fit', () => {
    const rows = packRows([180, 400, 180, 180, 320], (width) => width, 800, 20);
    expect(rows).toEqual([[180, 400, 180], [180, 320]]);
  });

  it('gives an oversized book its own row', () => {
    expect(packRows([900, 100], (width) => width, 800, 20)).toEqual([[900], [100]]);
    expect(packRows([], (width: number) => width, 800, 20)).toEqual([]);
  });
});

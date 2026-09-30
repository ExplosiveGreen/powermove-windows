// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { createEngine } from './player';
import { buildWebExport } from './export-web';
import { createSvgPlayer } from './svg-player';

it('preserves a corner anchor through portable SVG export and animated resizing', async () => {
  const PM = createEngine(null);
  PM.proj = PM.mkProject({ w: 128, h: 128, dur: 3 });
  const layer = PM.mkLayer('shape', { d: { shape: 'rect', w: 20, h: 20, radius: 0, stroke: 0,
    sizeAnchorBounds: { x0: -10, x1: 10, y0: -10, y1: 10 } },
    p: { 'anchor.x': -10, 'anchor.y': -10 } }, PM.proj);
  layer.d.w = PM.P(20, { kf: [PM.KF(0, 20, 'linear'), PM.KF(2, 60, 'linear')] });
  PM.proj.layers = [layer];
  const { scene } = await buildWebExport(PM);
  expect((scene.project.layers[0] as any).d.sizeAnchorBounds).toEqual(layer.d.sizeAnchorBounds);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const player = await createSvgPlayer({ svg, scene });
  try {
    for (const time of [0, 1, 2]) {
      await player.seek(time);
      const rect = svg.querySelector('[data-layer-id] rect')!;
      expect(rect.getAttribute('transform')).toBe('translate(-10 -10)');
      expect(Number(rect.getAttribute('width'))).toBeCloseTo(20 + time * 20);
    }
  } finally { player.destroy(); }
});

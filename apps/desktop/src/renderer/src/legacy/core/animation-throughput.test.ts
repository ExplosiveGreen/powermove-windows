import { expect, it } from 'vitest';
import { makePM } from '../__tests__/make-pm';
import { resolveContent } from './content-properties';

const benchmark = process.env.PM_ANIMATION_THROUGHPUT === '1' ? it : it.skip;

benchmark('measures repeated-frame transform and content evaluation for a heavy composition', () => {
  const PM = makePM('core/easing', 'core/model', 'core/anim');
  PM.proj = PM.mkProject({ dur: 30 });
  const layers = Array.from({ length: 5000 }, (_, index) => PM.mkLayer('shape', {
    d: { w: 200, h: 100, color: '#ed5b32', paths: [], metadata: { label: `Shape ${index}` } },
    p: { 'position.x': index, 'position.y': index % 100, rotation: index % 360 },
  }));
  PM.proj.layers = layers;
  let checksum = 0;
  const measure = (action: (time: number) => void) => {
    const samples: number[] = [];
    for (let run = 0; run < 9; run++) {
      const started = performance.now();
      for (let frame = 0; frame < 30; frame++) {
        const time = (run * 30 + frame) / 30;
        PM.beginEval(time); action(time);
      }
      if (run > 1) samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };
  const transformMs = measure(time => {
    for (const layer of layers) checksum += PM.worldMatrix(layer, time)[4];
  });
  const contentMs = measure(time => {
    for (const layer of layers) checksum += resolveContent(PM, layer, time).w;
  });
  console.log('ANIMATION_THROUGHPUT', JSON.stringify({ layers: layers.length, frames: 30, transformMs, contentMs }));
  expect(checksum).toBeGreaterThan(0);
});

import { describe, expect, it } from 'vitest';
import { createTextStagger } from './text-stagger';
import { countTextUnits } from '../../renderer/src/legacy/core/text-animation';

const channel = (v: number) => ({ v, kf: [], expr: null });
function setup(order = 'forward') {
  const layer = { id: 'l', type: 'text', from: 1, d: { animators: [{ id: 'a', name: 'Rise', mode: 'stagger', unit: 'characters', order,
    p: { delay: channel(0.5), duration: channel(1), stagger: channel(0.25) } }] } };
  const api: any = {
    anim: { version: () => 1, evP: (_layer: any, prop: any) => prop.v },
    transport: { time: () => 0 },
    render: { textLayout: () => ({ lines: [{ text: 'abc' }, { text: 'de' }] }) }
  };
  return { layer, stagger: createTextStagger(api) };
}

describe('timeline text stagger bands', () => {
  it('spans from Start to the last unit settling, across wrapped lines', () => {
    const { layer, stagger } = setup();
    expect(stagger.bands(layer)[0]).toMatchObject({ start: 0.5, duration: 1, cascade: 1, end: 2.5 });
    const center = setup('center');
    expect(center.stagger.bands(center.layer)[0]!.cascade).toBe(0.5);
  });

  it('grabs the lower half of the clip and its end', () => {
    const { layer, stagger } = setup();
    const t2x = (time: number) => time * 100;
    expect(stagger.hit(layer, 200, 20, t2x, 0, 24)?.part).toBe('body');
    expect(stagger.hit(layer, 350, 20, t2x, 0, 24)?.part).toBe('end');
    expect(stagger.hit(layer, 200, 4, t2x, 0, 24)).toBeNull();
    expect(stagger.hit(layer, 100, 20, t2x, 0, 24)).toBeNull();
  });

  it('moves Start by whole frames and stretches duration and stagger together', () => {
    const { layer, stagger } = setup();
    const band = stagger.bands(layer)[0]!;
    expect(stagger.drag(band, 'body', 0.26, 30)).toEqual({ delay: 0.7666666666666667 });
    expect(stagger.drag(band, 'end', 2, 30)).toEqual({ duration: 2, stagger: 0.5 });
  });

  it('counts units the way the text layout segments them', () => {
    const lines = [{ text: 'Hello big' }, { text: '' }, { text: 'wide world' }];
    expect(countTextUnits(lines, 'characters')).toBe(17);
    expect(countTextUnits(lines, 'words')).toBe(4);
    expect(countTextUnits(lines, 'lines')).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { ICON_MIN_SIDE, planIcon } from './icon-image';

describe('planIcon', () => {
  it('crops the centre square and never upscales', () => {
    expect(planIcon(3000, 2000)).toEqual({ ok: true, crop: { x: 500, y: 0, side: 2000 }, sides: [512, 448, 384, 320, 256] });
    expect(planIcon(600, 900)).toEqual({ ok: true, crop: { x: 0, y: 150, side: 600 }, sides: [512, 448, 384, 320, 256] });
    expect(planIcon(512, 512)).toEqual({ ok: true, crop: { x: 0, y: 0, side: 512 }, sides: [512, 448, 384, 320, 256] });
    expect(planIcon(300, 300)).toEqual({ ok: true, crop: { x: 0, y: 0, side: 300 }, sides: [300, 256] });
    expect(planIcon(200, 320)).toEqual({ ok: true, crop: { x: 0, y: 60, side: 200 }, sides: [200] });
  });

  it('refuses images too small to look sharp', () => {
    const plan = planIcon(ICON_MIN_SIDE - 1, 400);
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.error).toContain(`${ICON_MIN_SIDE} pixels`);
    expect(planIcon(Number.NaN, 400).ok).toBe(false);
  });

  it('uses a framed square, kept inside the image', () => {
    expect(planIcon(3000, 2000, { x: 100.4, y: 50.6, side: 800 })).toEqual({ ok: true, crop: { x: 100, y: 51, side: 800 }, sides: [512, 448, 384, 320, 256] });
    expect(planIcon(1000, 800, { x: 900, y: -20, side: 400 })).toEqual({ ok: true, crop: { x: 600, y: 0, side: 400 }, sides: [400, 384, 320, 256] });
    expect(planIcon(1000, 800, { x: 0, y: 0, side: 5000 }).ok && planIcon(1000, 800, { x: 0, y: 0, side: 5000 })).toMatchObject({ crop: { side: 800 } });
    const tooTight = planIcon(1000, 800, { x: 0, y: 0, side: ICON_MIN_SIDE - 1 });
    expect(tooTight.ok ? '' : tooTight.error).toContain('Zoom out');
  });
});

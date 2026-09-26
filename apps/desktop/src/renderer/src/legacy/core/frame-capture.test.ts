import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOpaqueFrame } from './frame-capture';

beforeEach(() => {
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data; this.width = width; this.height = height;
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

function scene(pixels: Uint8Array | null = new Uint8Array(24)) {
  return { quality: .5, proj: { shutter: .75 }, GL: { renderToPixels: vi.fn(() => pixels), gl: { isContextLost: () => false } } };
}

describe('opaque frame capture', () => {
  it('shares the GPU-owned top-down buffer without copying or modifying it', () => {
    const pixels = Uint8Array.from([17,18,19,255, 21,22,23,255, 9,10,11,255, 13,14,15,255, 1,2,3,255, 5,6,7,255]);
    const PM = scene(pixels);
    const result = renderOpaqueFrame(PM, .25, 2, 3, { mblur: false });
    expect([...result.data]).toEqual([17,18,19,255, 21,22,23,255, 9,10,11,255, 13,14,15,255, 1,2,3,255, 5,6,7,255]);
    expect(result.data.buffer).toBe(pixels.buffer);
    expect(result.width).toBe(2);
    expect(result.height).toBe(3);
    expect(PM.GL.renderToPixels).toHaveBeenCalledWith(.25, 2, 3, { mblur: false, mbSamples: 1, shutter: .75, opaque: true, topDownOpaque: true });
    expect(PM.quality).toBe(.5);
  });

  it('keeps the exact byte range if readback returns a view into a buffer', () => {
    const pixels = new Uint8Array(32).subarray(4, 28);
    pixels.fill(255);
    const image = renderOpaqueFrame(scene(pixels), 0, 2, 3);
    expect(image.data.buffer).toBe(pixels.buffer);
    expect(image.data.byteOffset).toBe(4);
    expect(image.data.byteLength).toBe(24);
  });

  it('preserves motion blur sampling and renders at full quality before restoring preview quality', () => {
    const PM = scene();
    PM.GL.renderToPixels.mockImplementation(() => { expect(PM.quality).toBe(1); return new Uint8Array(24); });
    renderOpaqueFrame(PM, 0, 2, 3);
    expect(PM.GL.renderToPixels).toHaveBeenLastCalledWith(0, 2, 3, { mblur: true, mbSamples: 16, shutter: .75, opaque: true, topDownOpaque: true });
    renderOpaqueFrame(PM, 0, 2, 3, { mbSamples: 7 });
    expect(PM.GL.renderToPixels).toHaveBeenLastCalledWith(0, 2, 3, { mblur: true, mbSamples: 7, shutter: .75, opaque: true, topDownOpaque: true });
    expect(PM.quality).toBe(.5);
  });

  it.each(['missing', 'short', 'lost', 'throw'])('rejects a %s GPU frame and restores quality', failure => {
    const PM = scene(failure === 'missing' ? null : new Uint8Array(failure === 'short' ? 16 : 24));
    if (failure === 'lost') PM.GL.gl.isContextLost = () => true;
    if (failure === 'throw') PM.GL.renderToPixels.mockImplementation(() => { throw new Error('Read failed'); });
    expect(() => renderOpaqueFrame(PM, 0, 2, 3)).toThrow();
    expect(PM.quality).toBe(.5);
  });
});

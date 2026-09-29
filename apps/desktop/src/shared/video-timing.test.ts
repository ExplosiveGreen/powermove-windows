import { describe, expect, it } from 'vitest';
import { videoPlaybackTime, webmTimestampScale } from './video-timing';

const el = (id: number[], data: number[]) => [...id, 0x80 | data.length, ...data];
const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [...new TextEncoder().encode('webm')]));
const scaleElement = (ns: number) => el([0x2a, 0xd7, 0xb1], [ns >> 16, ns >> 8 & 255, ns & 255]);
function webm(scale?: number, unknownSize = false) {
  const info = el([0x15, 0x49, 0xa9, 0x66], scale === undefined ? [] : scaleElement(scale));
  return new Blob([new Uint8Array([...header, ...(unknownSize
    ? [0x18, 0x53, 0x80, 0x67, 0xff, ...info]
    : el([0x18, 0x53, 0x80, 0x67], info))])]);
}

describe('WebM timestamp precision', () => {
  it('reads explicit, default and unknown-length Segment timebases', async () => {
    expect(await webmTimestampScale(webm(1_000_000))).toBe(.001);
    expect(await webmTimestampScale(webm())).toBe(.001);
    expect(await webmTimestampScale(webm(100_000, true))).toBe(.0001);
  });
  it('does not infer WebM timing from filenames, compressed payloads or malformed headers', async () => {
    expect(await webmTimestampScale(new Blob(['not webm', new Uint8Array(scaleElement(1_000_000))]))).toBeUndefined();
    expect(await webmTimestampScale(new Blob([new Uint8Array(header)]))).toBeUndefined();
    const valid = webm(1_000_000);
    expect(await webmTimestampScale(valid.slice(0, valid.size - 1))).toBeUndefined();
    expect(await webmTimestampScale(webm(0))).toBeUndefined();
    expect(await webmTimestampScale(webm(2_000_000))).toBeUndefined();
  });
  it('reads only a bounded header from large sources', async () => {
    let requested = 0;
    const blob = { slice: (start: number, end: number) => { requested = end - start; return webm(); } };
    expect(await webmTimestampScale(blob as Blob)).toBe(.001);
    expect(requested).toBe(256 * 1024);
  });
  it.each([24, 30, 60, 120, 240, 30000 / 1001])('selects consecutive rounded timestamps at %s fps', fps => {
    const timestamps = Array.from({ length: 100 }, (_, i) => Math.round(i / fps * 1000) / 1000);
    const asset = { dur: 100 / fps, videoTimestampScale: .001 };
    for (let i = 0; i < timestamps.length; i++) {
      const at = videoPlaybackTime(asset, i / fps, 1 / fps);
      expect(at).toBeGreaterThanOrEqual(timestamps[i]!);
      if (i + 1 < timestamps.length) expect(at).toBeLessThan(timestamps[i + 1]!);
    }
  });
  it('keeps precise MP4 ticks, image sequences, clamping and variable-time requests', () => {
    expect(videoPlaybackTime({ dur: 2 }, 2 / 30)).toBe(.066667);
    expect(videoPlaybackTime({ dur: 2 }, .5)).toBe(.5);
    expect(videoPlaybackTime({ dur: 2 }, -1)).toBe(0);
    expect(videoPlaybackTime({ dur: 2 }, 3)).toBe(1.96);
    const asset = { dur: 2, videoTimestampScale: .001 };
    expect(videoPlaybackTime(asset, .0423)).toBeCloseTo(.042001, 9);
    expect(videoPlaybackTime({ ...asset, imageSequence: { fps: 30, frames: 60 } }, 2 / 30)).toBeCloseTo(2 / 30 + .001, 9);
    expect(videoPlaybackTime({ dur: .0000005, videoTimestampScale: .001 }, 1)).toBe(0);
  });
});

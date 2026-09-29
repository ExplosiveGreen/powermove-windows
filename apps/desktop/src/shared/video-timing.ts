import { sequencePlaybackTime } from './image-sequence';

// Inspect container structure, not byte patterns inside compressed frames. A
// bounded header read also works for large local, restored and converted clips.
const HEADER_BYTES = 256 * 1024;
type Element = { id: number; start: number; end: number };
function element(bytes: Uint8Array, offset: number, limit: number): Element | undefined {
  const vint = (at: number, id: boolean) => {
    const first = bytes[at];
    if (!first) return;
    let width = 1, marker = 0x80;
    while (!(first & marker)) { width++; marker >>= 1; }
    if (width > (id ? 4 : 8) || at + width > limit) return;
    let value = id ? first : first & (marker - 1);
    let unknown = !id && value === marker - 1;
    for (let i = 1; i < width; i++) {
      value = value * 256 + bytes[at + i]!;
      unknown = unknown && bytes[at + i] === 255;
    }
    return { width, value, unknown };
  };
  const id = vint(offset, true);
  if (!id) return;
  const size = vint(offset + id.width, false);
  if (!size) return;
  const start = offset + id.width + size.width;
  if (!size.unknown && !Number.isSafeInteger(start + size.value)) return;
  return { id: id.value, start, end: size.unknown ? limit : start + size.value };
}
function children(bytes: Uint8Array, start: number, end: number): Element[] {
  const result: Element[] = [];
  const limit = Math.min(bytes.length, end);
  for (let at = start; at < limit;) {
    const item = element(bytes, at, limit);
    if (!item) break;
    result.push(item);
    if (item.end > limit) break;
    at = item.end;
  }
  return result;
}

/** WebM timestamps are normally rounded to milliseconds, unlike MP4's finer
 * timebase. Read this from the actual bytes so older projects and proxies work
 * without guessing their frame rate or depending on a filename/MIME type. */
export async function webmTimestampScale(blob: Blob): Promise<number | undefined> {
  const bytes = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  const header = element(bytes, 0, bytes.length);
  if (header?.id !== 0x1a45dfa3 || header.end > bytes.length) return;
  const docType = children(bytes, header.start, header.end).find(item => item.id === 0x4282);
  if (!docType || new TextDecoder().decode(bytes.subarray(docType.start, docType.end)) !== 'webm') return;
  const segment = children(bytes, header.end, bytes.length).find(item => item.id === 0x18538067);
  if (!segment) return;
  const info = children(bytes, segment.start, segment.end).find(item => item.id === 0x1549a966);
  if (!info || info.end > bytes.length) return;
  const scale = children(bytes, info.start, info.end).find(item => item.id === 0x2ad7b1);
  if (!scale) return .001; // WebM's specified default TimestampScale.
  if (scale.end > info.end || scale.end <= scale.start || scale.end - scale.start > 8) return;
  let ns = 0;
  for (let at = scale.start; at < scale.end; at++) ns = ns * 256 + bytes[at]!;
  // Only compensate sub-millisecond rounding. Coarser or invalid timebases
  // must not move intentional holds/cuts by a perceptible amount.
  return Number.isSafeInteger(ns) && ns > 0 && ns <= 1_000_000 ? ns / 1e9 : undefined;
}

/** Use the same source-frame boundary for scrubbing, playback and export. */
export function videoPlaybackTime(asset: any, time: number, endPadding = .04): number {
  const sequence = sequencePlaybackTime(asset, time);
  if (sequence !== undefined) return sequence;
  const at = Math.max(0, Math.min(Math.max(0, (asset.dur || 0) - endPadding), time));
  const scale = asset.videoTimestampScale;
  if (!(Number.isFinite(scale) && scale > 0 && scale <= .001)) {
    // Chromium seeks on a microsecond clock. Rounding a fractional request
    // down can still select the previous frame, even in an MP4 (2/30 seconds
    // is 66666.666… µs). Keep exact ticks, otherwise seek to the next µs.
    return Math.max(0, Math.ceil(at * 1e6 - 1e-7) / 1e6);
  }
  // 2/30 is before WebM's rounded 67 ms timestamp. Seeking there repeats
  // frame 1 and the next request skips frame 2. Round to the encoded timebase;
  // a microsecond inside the boundary avoids decoder floating-point truncation.
  const inside = Math.min(scale / 1000, .000001);
  return Math.max(0, Math.min(Math.max(0, asset.dur - inside), Math.round(at / scale + 1e-9) * scale + inside));
}

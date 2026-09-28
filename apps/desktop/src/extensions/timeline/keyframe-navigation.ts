import { timelineProperties, trackChannels, trackSelected } from './property-tracks';
import type { PowermoveAPI, Space3DAPI } from 'powermove';

/** Key times stay layer-local in the document; navigation uses composition time. */
export function keyframeTimes(api: Pick<PowermoveAPI, 'anim' | 'project' | 'selection' | 'space3d'>, row?: any, space3d: Pick<Space3DAPI, 'CHANNELS_3D'> = api.space3d): number[] {
  let rows = row ? [row] : [];
  if (!row) {
    const selected = new Set(api.selection.layers());
    const layers = api.project.get().layers.filter((L) => !selected.size || selected.has(L.id));
    rows = layers.flatMap((L: any) => timelineProperties(api, L, space3d)
      .filter((p: any) => !api.selection.chan() || trackSelected(p, api.selection.chan()!))
      .map((p: any) => ({ ...p, L })));
  }
  const times: number[] = rows.flatMap((r: any) => trackChannels(r).flatMap(axis =>
    (axis.prop.kf ?? []).map((key: any) => Number(r.L.from) + Number(key.t))));
  return [...new Set(times.filter(time => Number.isFinite(time) && time >= 0 && time <= api.project.get().dur))].sort((a, b) => a - b);
}

const rowTimeCache = new WeakMap<object, { api: object; version: number; from: number; duration: number; times: number[] }>();

export function adjacentKeyframe(api: Pick<PowermoveAPI, 'anim' | 'project' | 'selection' | 'space3d' | 'transport'>, direction: -1 | 1, row?: any, space3d: Pick<Space3DAPI, 'CHANNELS_3D'> = api.space3d): number | undefined {
  let times: number[];
  if (row) {
    const version = api.anim.version(), from = Number(row.L.from), duration = api.project.get().dur;
    let cached = rowTimeCache.get(row);
    if (!cached || cached.api !== api || cached.version !== version || cached.from !== from || cached.duration !== duration) {
      cached = { api, version, from, duration, times: keyframeTimes(api, row, space3d) };
      rowTimeCache.set(row, cached);
    }
    times = cached.times;
  } else times = keyframeTimes(api, undefined, space3d);
  // The gutter asks twice per property on every frame. Reuse the sorted row
  // times and binary-search without allocating, reversing, or scanning keys.
  const boundary = api.transport.time() + direction * 1e-5;
  let low = 0, high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (direction === 1 ? times[mid]! <= boundary : times[mid]! < boundary) low = mid + 1;
    else high = mid;
  }
  return times[direction === 1 ? low : low - 1];
}

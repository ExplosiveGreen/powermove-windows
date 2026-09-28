/** Conservative temporal analysis for editable, built-in artwork. Unknown
 * renderers, expressions and media always retain the normal per-frame path. */
export function previewPlan(project: any) {
  const edges = new Set<number>();
  const moving: Array<[number, number]> = [];
  let continuous = false;
  const staticLayers = new Set<any>();
  const independent = new Set<any>();
  for (const layer of project.layers || []) {
    // Sound keeps advancing independently of the retained picture.
    if (layer.type === 'audio') continue;
    let constant = true;
    const from = Number(layer.from) || 0, end = from + (Number(layer.dur) || 0);
    edges.add(from); edges.add(end);
    if (!['shape', 'text', 'solid', 'group', 'null'].includes(layer.type)
        || layer.fx?.length || layer.transitionIn || layer.transitionOut
        || layer.d?.animators?.length || layer.threeD) {
      continuous = true; continue;
    }
    const seen = new Set<object>();
    const visit = (value: any) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value.expr) { continuous = true; constant = false; }
      if (Array.isArray(value.kf) && value.kf.length > 1) {
        constant = false;
        for (let i = 1; i < value.kf.length; i++) {
          const a = value.kf[i - 1], b = value.kf[i];
          const start = Number(a.t) + from, finish = Number(b.t) + from;
          if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) { continuous = true; continue; }
          edges.add(start); edges.add(finish);
          const held = a.hold || typeof a.v === 'number' && typeof b.v === 'number'
            && (a.outInterp === 'hold' || b.inInterp === 'hold');
          // Equal endpoints can still move with native speed handles. Reuse
          // only proven flat segments, never inferred easing overshoots.
          const flat = Object.is(a.v, b.v) && !a.autoBezier && !b.autoBezier
            && !Number(a.outEase?.speed) && !Number(b.inEase?.speed);
          if (!held && !flat) moving.push([start, finish]);
        }
      }
      for (const [key, child] of Object.entries(value)) if (key !== 'kf') visit(child);
    };
    visit(layer);
    if (constant && !layer.matteSource && !layer.masks?.length && !layer.solo) independent.add(layer);
  }
  const byId = new Map<any, any>((project.layers || []).map((layer: any) => [layer.id, layer]));
  const resolved = new Map<any, boolean>(), visiting = new Set<any>();
  const stable = (layer: any): boolean => {
    if (resolved.has(layer)) return resolved.get(layer)!;
    if (!independent.has(layer) || visiting.has(layer)) return false;
    visiting.add(layer);
    const value = (!layer.parent || stable(byId.get(layer.parent))) && (!layer.group || stable(byId.get(layer.group)));
    visiting.delete(layer); resolved.set(layer, value);
    return value;
  };
  for (const layer of independent) if (layer.type !== 'group' && stable(layer)) staticLayers.add(layer);
  const boundaries = [...edges].filter(Number.isFinite).sort((a, b) => a - b);
  moving.sort((a, b) => a[0] - b[0]);
  const intervals: Array<[number, number]> = [];
  for (const range of moving) {
    const last = intervals.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else intervals.push([...range]);
  }
  const upper = (values: number[], time: number) => {
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid]! <= time) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const starts = intervals.map(range => range[0]);
  return {
    staticLayers,
    // Prefix caching uses visibility intervals even when the foreground moves.
    interval(time: number, radius = 0): number | null {
      const index = upper(boundaries, time);
      if (Math.abs(time - (boundaries[index - 1] ?? -Infinity)) <= radius + 2e-6
          || Math.abs(time - (boundaries[index] ?? Infinity)) <= radius + 2e-6) return null;
      return index;
    },
    timeKey(time: number, radius = 0): string | number {
      if (continuous) return time;
      const range = intervals[upper(starts, time + radius) - 1];
      if (range && time - radius <= range[1]) return time;
      const index = this.interval(time, radius);
      return index === null ? time : `still:${index}`;
    },
  };
}

type WarmupState = {
  key: string;
  project: any;
  time: number;
  blocked: boolean;
};
type Window = [number, number];
type Candidate = { layer: any; windows: Window[]; index: number; at: number; checkedAt?: number };

const intersect = (left: Window[], right: Window[]): Window[] => {
  const result: Window[] = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i]!, b = right[j]!;
    const start = Math.max(a[0], b[0]), end = Math.min(a[1], b[1]);
    if (start < end) result.push([start, end]);
    if (a[1] < b[1]) i++; else j++;
  }
  return result;
};

/** Broad positive-opacity windows. Actual easing is checked in the idle slice,
 * so this analysis never changes animation state or predicts expression values. */
function opacityWindows(layer: any): Window[] {
  const prop = layer.p?.opacity;
  if (layer.on === false || layer.on?.expr || prop?.expr
      || layer.on?.v === false && !layer.on?.kf?.length) return [];
  const keys = Array.isArray(prop?.kf) ? prop.kf : [];
  if (!keys.length) return Number(prop?.v ?? prop ?? 100) > 0 ? [[-Infinity, Infinity]] : [];
  if (keys.some((key: any) => !Number.isFinite(Number(key.t)) || !Number.isFinite(Number(key.v)))) return [];
  const from = Number(layer.from) || 0, result: Window[] = [];
  const add = (start: number, end: number) => {
    const previous = result.at(-1);
    if (previous && previous[1] === start) previous[1] = end;
    else result.push([start, end]);
  };
  if (Number(keys[0].v) > 0) add(-Infinity, from + Number(keys[0].t));
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    const hold = a.hold === true || a.outInterp === 'hold' || b.inInterp === 'hold';
    if (Number(a.v) > 0 || !hold && Number(b.v) > 0) add(from + Number(a.t), from + Number(b.t));
  }
  if (Number(keys.at(-1).v) > 0) add(from + Number(keys.at(-1).t), Infinity);
  return result;
}

/** Prepare imminent sources in short idle slices. The queue never renders a
 * future frame or takes ownership of the visible canvas or media decoders. */
export function createPreviewWarmup(
  state: () => WarmupState,
  prepare: (layer: any, time: number) => void,
  schedule: (run: (deadline: { timeRemaining(): number }) => void) => void,
  now = () => performance.now(),
  visible?: (layer: any, time: number) => boolean,
) {
  let project: any, key = '', lastTime = -Infinity, lastScan = -Infinity, pending = false;
  let queue: Candidate[] = [], attempted = new Set<any>();
  let windows = new Map<any, Window[]>();
  const nextFrame = (time: number) => (Math.floor(time * Math.max(1, Number(project?.fps) || 30) + 1e-7) + 1) / Math.max(1, Number(project?.fps) || 30);
  const reset = (current: WarmupState) => {
    project = current.project; key = current.key; attempted = new Set(); queue = []; lastScan = -Infinity;
    windows = new Map();
    const layers: any[] = project?.layers || [];
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    const groups = new Map<any, Window[]>(), visiting = new Set<any>();
    const groupWindows = (group: any): Window[] => {
      if (!group || group.type !== 'group' || visiting.has(group)) return [];
      if (groups.has(group)) return groups.get(group)!;
      visiting.add(group);
      let result = opacityWindows(group);
      if (group.group) result = intersect(result, groupWindows(byId.get(group.group)));
      visiting.delete(group); groups.set(group, result); return result;
    };
    for (const layer of layers) {
      if (!['shape', 'text'].includes(layer.type) || !(Number(layer.dur) > 0)) continue;
      const from = Number(layer.from) || 0;
      let result = intersect([[from, from + Number(layer.dur)]], opacityWindows(layer));
      if (layer.group) result = intersect(result, groupWindows(byId.get(layer.group)));
      if (result.length) windows.set(layer, result);
    }
  };
  const advance = (candidate: Candidate, time: number, after = false): boolean => {
    const earliest = after ? nextFrame(candidate.at) : nextFrame(time);
    while (candidate.index < candidate.windows.length) {
      const span = candidate.windows[candidate.index]!;
      candidate.at = Math.max(span[0], earliest);
      if (candidate.at >= span[1]) { candidate.index++; continue; }
      return candidate.at <= time + 2;
    }
    return false;
  };
  const refresh = (current: WarmupState) => {
    if (project !== current.project || key !== current.key || current.time < lastTime) reset(current);
    lastTime = current.time;
    if (queue.length || current.time < lastScan + .25) return;
    lastScan = current.time;
    for (const [layer, spans] of windows) {
      if (attempted.has(layer)) continue;
      const candidate: Candidate = { layer, windows: spans, index: 0, at: 0 };
      if (advance(candidate, current.time)) queue.push(candidate);
    }
    queue.sort((a, b) => a.at - b.at);
  };
  const request = () => {
    if (pending) return;
    const current = state();
    if (current.blocked) return;
    refresh(current);
    if (!queue.length) return;
    pending = true;
    const requestedProject = project, requestedKey = key;
    schedule(deadline => {
      pending = false;
      const current = state();
      if (current.blocked || current.time < lastTime || requestedProject !== current.project || requestedKey !== current.key) {
        queue = [];
        request(); return;
      }
      const start = now();
      while (queue.length && now() - start < 2 && deadline.timeRemaining() > 1) {
        const candidate = queue.shift()!;
        const { layer } = candidate;
        try {
          // Current sources belong to the visible render. Check ancestors with
          // the engine predicate, without multiplying scene-size frame scans.
          if (candidate.checkedAt !== current.time) {
            candidate.checkedAt = current.time;
            const currentVisible = visible ? visible(layer, current.time)
              : candidate.windows.some(([from, end]) => from <= current.time && current.time < end);
            if (currentVisible) { attempted.add(layer); continue; }
          }
          if (candidate.at <= current.time && !advance(candidate, current.time)) continue;
          if (candidate.at > current.time + 2) continue;
          if (visible && !visible(layer, candidate.at)) {
            if (advance(candidate, current.time, true)) queue.unshift(candidate);
            continue;
          }
          attempted.add(layer);
          prepare(layer, candidate.at);
        } catch { attempted.add(layer); /* Normal rendering owns source errors. */ }
      }
      if (queue.length) request();
    });
  };
  return request;
}

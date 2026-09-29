export interface DirectionalSnapAnchor {
  time: number;
  edge?: 'in' | 'out';
}

export interface DirectionalSnapTarget {
  time: number;
  edge?: 'in' | 'out';
  weight?: number;
}

export interface DirectionalSnapLock {
  anchor: number;
  target: number;
  direction: -1 | 1;
}

export interface DirectionalSnapResult {
  delta: number;
  lock: DirectionalSnapLock | null;
}

/** A gesture-local latch. Nearby edges never attract the pointer: an anchor
 * must cross a target to acquire it. Continuing past the release distance or
 * reversing direction releases it, allowing precise movement beside an edge.
 * Pass every pointer sample, including when snapping is disabled, so enabling
 * it midway through a drag cannot catch targets already passed. */
export function createDirectionalSnapper(initialDelta = 0) {
  let previous = Number.isFinite(initialDelta) ? initialDelta : 0;
  let lock: DirectionalSnapLock | null = null;
  const epsilon = 1e-9;
  return {
    resolve(
      anchors: readonly DirectionalSnapAnchor[], requestedDelta: number,
      targets: readonly DirectionalSnapTarget[], releaseTolerance: number,
      enabled = true,
    ): DirectionalSnapResult {
      const raw = Number.isFinite(requestedDelta) ? requestedDelta : previous;
      const before = previous;
      previous = raw;
      const travel = raw - before;
      const direction = Math.abs(travel) <= epsilon ? 0 : travel > 0 ? 1 : -1;
      const radius = Math.max(0, Number.isFinite(releaseTolerance) ? releaseTolerance : 0);
      if (!enabled) { lock = null; return { delta: raw, lock }; }

      // Remember a released latch for this sample. It must not immediately
      // reacquire while the pointer reverses across its target.
      const released = lock;
      if (lock) {
        const anchor = anchors[lock.anchor];
        const exists = anchor && targets.some(target => target.time === lock!.target
          && (!target.edge || target.edge === anchor.edge));
        if (exists && (!direction || direction === lock.direction)
          && Math.abs(anchor.time + raw - lock.target) <= radius + epsilon) {
          return { delta: lock.target - anchor.time, lock };
        }
        lock = null;
      }
      if (!direction) return { delta: raw, lock };

      let bestDistance = Infinity;
      let bestWeight = -Infinity;
      for (let index = 0; index < anchors.length; index++) {
        const anchor = anchors[index]!;
        if (!Number.isFinite(anchor.time)) continue;
        for (const target of targets) {
          if (!Number.isFinite(target.time) || (target.edge && target.edge !== anchor.edge)) continue;
          if (released?.anchor === index && released.target === target.time) continue;
          const at = target.time - anchor.time;
          const crossed = direction > 0
            ? at > before + epsilon && at <= raw + epsilon
            : at < before - epsilon && at >= raw - epsilon;
          const distance = Math.abs(raw - at);
          if (!crossed || distance > radius + epsilon) continue;
          // Prefer the last crossed edge. Weights only break identical-distance
          // ties: a playhead must not pull a clip backwards past a nearer edge.
          const weight = Number.isFinite(target.weight) ? target.weight! : 1;
          if (distance < bestDistance - epsilon || (Math.abs(distance - bestDistance) <= epsilon && weight > bestWeight)) {
            bestDistance = distance; bestWeight = weight;
            lock = { anchor: index, target: target.time, direction };
          }
        }
      }
      return lock ? { delta: lock.target - anchors[lock.anchor]!.time, lock } : { delta: raw, lock: null };
    },
    reset(delta = previous) {
      previous = Number.isFinite(delta) ? delta : previous;
      lock = null;
    },
  };
}

/** Draw after the cached timeline backdrop, so latching does not invalidate
 * clip artwork and the indicator disappears on the next time-only paint. */
export function drawDirectionalSnapGuide(
  context: CanvasRenderingContext2D,
  geometry: { x: number; top: number; bottom: number; left: number; right: number },
  color: string,
): void {
  const { x, top, bottom, left, right } = geometry;
  if (!Number.isFinite(x) || x < left || x > right || bottom <= top) return;
  context.save();
  context.beginPath(); context.rect(left, top, right - left, bottom - top); context.clip();
  context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 1.5;
  context.setLineDash([3, 3]);
  context.beginPath(); context.moveTo(x, top + 6); context.lineTo(x, bottom); context.stroke();
  context.setLineDash([]);
  context.beginPath(); context.moveTo(x - 4, top); context.lineTo(x + 4, top);
  context.lineTo(x + 4, top + 3); context.lineTo(x, top + 7);
  context.lineTo(x - 4, top + 3); context.closePath(); context.fill();
  context.restore();
}

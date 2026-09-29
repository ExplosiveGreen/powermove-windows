/*
 * How much of the editor's time each extension is taking, and the notice that
 * names one when it is too much.
 *
 * PerformanceMonitor answers "what is slow right now" for the status bar. This
 * answers a different question: has one extension cost enough over the last
 * few seconds that the user should hear about it. Two sources feed it:
 *   - host.ts `guard`: synchronous time in every API callback of a non-built-in
 *     extension (painters, commands, panels, events, status text…);
 *   - sandboxed (store) extensions: time the runtime iframe spends running
 *     extension callbacks for host calls, reported by sandbox/boot.ts.
 * Work an extension schedules for itself (its own timers or DOM listeners) is
 * not seen. Long Animation Frame script attribution would cover it, but
 * Chromium reports no script entries for `app://` bundles.
 *
 * One rule decides: an extension that used `shareLimit` of the last `windowMs`
 * is slow. A single long freeze trips the same rule, so there is no separate
 * stall threshold to tune. Each extension is named at most once per session.
 */
export interface SlowExtension {
  id: string;
  /** Busy milliseconds inside the window. */
  busyMs: number;
  windowMs: number;
  /** The longest single sample inside the window. */
  longestMs: number;
}

export interface ExtensionLoadOptions {
  windowMs?: number;
  /** Fraction of the window, 0–1. */
  shareLimit?: number;
}

const BUCKET_MS = 1000;
const MAX_TRACKED = 256;

/** One second of one extension's time; `second` says which absolute second it holds. */
interface Slot { second: number; busy: number; longest: number }

export class ExtensionLoad {
  readonly windowMs: number;
  readonly shareLimit: number;
  private readonly slots: number;
  private meters = new Map<string, Slot[]>();
  private reported = new Set<string>();
  private listeners = new Set<(slow: SlowExtension) => void>();

  constructor(options: ExtensionLoadOptions = {}) {
    this.slots = Math.max(1, Math.round((options.windowMs ?? 10_000) / BUCKET_MS));
    this.windowMs = this.slots * BUCKET_MS;
    this.shareLimit = options.shareLimit ?? 0.15;
  }

  /** Charge `ms` of editor time to extension `id`, ending at `now`. */
  record(id: string, ms: number, now = performance.now()): void {
    if (!id || !Number.isFinite(ms) || ms <= 0 || this.reported.has(id)) return;
    let meter = this.meters.get(id);
    if (!meter) {
      if (this.meters.size >= MAX_TRACKED) this.meters.delete(this.meters.keys().next().value!);
      meter = Array.from({ length: this.slots }, () => ({ second: -Infinity, busy: 0, longest: 0 }));
      this.meters.set(id, meter);
    }
    const second = Math.floor(now / BUCKET_MS);
    const slot = meter[((second % this.slots) + this.slots) % this.slots]!;
    if (slot.second !== second) Object.assign(slot, { second, busy: 0, longest: 0 });
    slot.busy += ms;
    slot.longest = Math.max(slot.longest, ms);

    const usage = this.usage(id, now);
    if (!usage || usage.busyMs < this.shareLimit * this.windowMs) return;
    this.reported.add(id);
    this.meters.delete(id);
    for (const listener of [...this.listeners]) {
      try { listener(usage); } catch (error) { console.error('[extension-load] listener threw', error); }
    }
  }

  /** Busy time for `id` over the window ending at `now`, or null when idle. */
  usage(id: string, now = performance.now()): SlowExtension | null {
    const meter = this.meters.get(id);
    if (!meter) return null;
    const oldest = Math.floor(now / BUCKET_MS) - this.slots;
    let busyMs = 0;
    let longestMs = 0;
    for (const slot of meter) {
      if (slot.second <= oldest) continue;
      busyMs += slot.busy;
      longestMs = Math.max(longestMs, slot.longest);
    }
    return busyMs > 0 ? { id, busyMs, windowMs: this.windowMs, longestMs } : null;
  }

  onSlow(listener: (slow: SlowExtension) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Drop the running meter, e.g. when the extension unloads. Keeps the once-per-session mark. */
  forget(id: string): void { this.meters.delete(id); }

  /** Test seam: forget everything, including who was already named. */
  reset(): void { this.meters.clear(); this.reported.clear(); }
}

export const extensionLoad = new ExtensionLoad();

export interface SlowExtensionNoticeDeps {
  /** Display name, or null for an extension the user did not add (built-ins, unknown ids). */
  nameOf(id: string): string | null;
  toast(text: string, options: Record<string, unknown>): void;
  turnOff(id: string): Promise<void>;
}

/** Tell the user, once per extension per session, which extension is slowing the editor. */
export function noticeSlowExtensions(deps: SlowExtensionNoticeDeps, load: ExtensionLoad = extensionLoad): () => void {
  return load.onSlow((slow) => {
    const name = deps.nameOf(slow.id);
    if (!name) return;
    const share = Math.round((slow.busyMs / slow.windowMs) * 100);
    console.warn(`[ext:${slow.id}] used ${share}% of the editor's time over the last ${slow.windowMs / 1000} s (longest ${Math.round(slow.longestMs)} ms)`);
    const source = { id: slow.id, name };
    /* An alert already carries the extension's name above the message. */
    deps.toast('This extension is slowing down the editor', {
      kind: 'alert',
      sticky: true,
      key: `slow-extension:${slow.id}`,
      source,
      action: {
        label: 'Turn off',
        run: () => {
          deps.turnOff(slow.id).catch(() => deps.toast('Could not turn it off. Open Mods to try again.', { kind: 'alert', source }));
        }
      }
    });
  });
}

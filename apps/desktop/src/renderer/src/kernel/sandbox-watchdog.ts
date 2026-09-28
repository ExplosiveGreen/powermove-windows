/*
 * Liveness check for a sandboxed extension's process (docs/sandbox-data-plane.md
 * §2). A spinning or crashed runtime never answers `ping`; removing its iframe
 * would not stop the process, so the caller terminates it.
 */

export interface WatchdogTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WatchSandboxOptions {
  /** One round trip to the sandbox. Settling either way ends that ping; only an answer that never comes counts. */
  ping(): Promise<unknown>;
  onUnresponsive(): void;
  intervalMs?: number;
  thresholdMs?: number;
  /** Host time (monotonic). */
  now?(): number;
  timers?: WatchdogTimers;
}

const defaultTimers: WatchdogTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Pings every `intervalMs`; fires `onUnresponsive` once when a ping has been outstanding for `thresholdMs`. */
export function watchSandbox(options: WatchSandboxOptions): { dispose(): void } {
  const { ping, onUnresponsive, intervalMs = 2000, thresholdMs = 8000, now = () => performance.now(), timers = defaultTimers } = options;
  let outstandingSince: number | null = null;
  let current = 0, stopped = false, timer: unknown;
  let last = now();
  const send = (at: number): void => {
    const token = ++current;
    outstandingSince = at;
    const settle = (): void => { if (token === current) outstandingSince = null; };
    try { void Promise.resolve(ping()).then(settle, settle); } catch { settle(); }
  };
  const check = (): void => {
    if (stopped) return;
    const at = now();
    // A check that ran far behind schedule means the host itself was not
    // running (sleep, timer throttling): the sandbox had no chance to answer.
    const late = at - last > 2 * intervalMs;
    last = at;
    if (outstandingSince === null) send(at);
    else if (late) outstandingSince = at;
    else if (at - outstandingSince >= thresholdMs) { dispose(); onUnresponsive(); return; }
    timer = timers.setTimeout(check, intervalMs);
  };
  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    current++;
    timers.clearTimeout(timer);
  };
  send(last);
  timer = timers.setTimeout(check, intervalMs);
  return { dispose };
}

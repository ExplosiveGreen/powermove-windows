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

/**
 * Pings every `intervalMs`; fires `onUnresponsive` once when a ping has been
 * outstanding for `thresholdMs`, or when a ping sent as the host woke is still
 * outstanding at the next check.
 */
export function watchSandbox(options: WatchSandboxOptions): { dispose(): void } {
  const { ping, onUnresponsive, intervalMs = 2000, thresholdMs = 8000, now = () => performance.now(), timers = defaultTimers } = options;
  let outstandingSince: number | null = null;
  /* The outstanding ping went out from a late check, so the host was running
     when it was sent. A live sandbox answers within milliseconds of that. */
  let sentAwake = false;
  let current = 0, stopped = false, timer: unknown;
  let last = now();
  const send = (at: number, awake: boolean): void => {
    const token = ++current;
    outstandingSince = at; sentAwake = awake;
    const settle = (): void => { if (token === current) { outstandingSince = null; sentAwake = false; } };
    try { void Promise.resolve(ping()).then(settle, settle); } catch { settle(); }
  };
  const check = (): void => {
    if (stopped) return;
    const at = now();
    // A check that ran far behind schedule means the host itself was not
    // running (sleep, timer throttling): the sandbox may have had no chance to
    // answer, so it is asked again now. Under intensive throttling (a window
    // hidden for minutes) every check is late, so that fresh ping still being
    // outstanding at the next check, late or not, is the answer.
    const late = at - last > 2 * intervalMs;
    last = at;
    if (outstandingSince === null) send(at, late);
    else if (late && !sentAwake) send(at, true);
    else if (late || at - outstandingSince >= thresholdMs) { dispose(); onUnresponsive(); return; }
    timer = timers.setTimeout(check, intervalMs);
  };
  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    current++;
    timers.clearTimeout(timer);
  };
  send(last, false);
  timer = timers.setTimeout(check, intervalMs);
  return { dispose };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchSandbox } from './sandbox-watchdog';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A sandbox that answers each ping after `delay` ms, or never once `hung`. */
function sandbox(delay = 5) {
  const state = { hung: false, pings: 0, skew: 0 };
  const ping = (): Promise<unknown> => {
    state.pings++;
    return state.hung ? new Promise(() => {}) : new Promise(resolve => setTimeout(resolve, delay, true));
  };
  const now = (): number => Date.now() + state.skew;
  return { state, ping, now };
}

describe('watchSandbox', () => {
  it('keeps pinging a responsive sandbox and never fires', async () => {
    const { state, ping, now } = sandbox();
    const onUnresponsive = vi.fn();
    const watch = watchSandbox({ ping, onUnresponsive, now });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
    expect(state.pings).toBe(31); // one at start, then one per 2 s check
    watch.dispose();
  });

  it('fires once when a ping stays unanswered for the threshold', async () => {
    const { state, ping, now } = sandbox();
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now });
    await vi.advanceTimersByTimeAsync(4_000);
    state.hung = true;
    await vi.advanceTimersByTimeAsync(2_000); // the 6 s check sends the ping that hangs
    await vi.advanceTimersByTimeAsync(7_999);
    expect(onUnresponsive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    const pings = state.pings;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    expect(state.pings).toBe(pings);
  });

  it('a hang from the start fires at the threshold', async () => {
    const { state, ping, now } = sandbox();
    state.hung = true;
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now, intervalMs: 1_000, thresholdMs: 3_000 });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(onUnresponsive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    expect(state.pings).toBe(1);
  });

  it('after a sleep, a live sandbox answers the fresh ping and is left alone', async () => {
    const { state, ping, now } = sandbox();
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now });
    await vi.advanceTimersByTimeAsync(4_000);
    state.hung = true; // the 6 s check's ping is lost to the sleep
    await vi.advanceTimersByTimeAsync(2_000);
    state.hung = false;
    state.skew += 3_600_000; // the machine slept between the 6 s and 8 s checks
    await vi.advanceTimersByTimeAsync(2_000);
    state.skew += 3_600_000; // and again right after waking
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
  });

  it('a sandbox hung across a sleep fires at the threshold after the fresh ping, not before', async () => {
    const { state, ping, now } = sandbox();
    state.hung = true;
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now });
    await vi.advanceTimersByTimeAsync(4_000);
    state.skew += 3_600_000; // the machine slept between the 4 s and 6 s checks
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
    expect(state.pings).toBe(2); // the late check asked again
    await vi.advanceTimersByTimeAsync(7_999);
    expect(onUnresponsive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
  });

  /* Chromium's intensive throttling (a window hidden for over 5 minutes) runs
     chained timers once a minute, so every check is late. */
  const throttled = { setTimeout: (fn: () => void) => setTimeout(fn, 60_000), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

  it('catches a sandbox that spins while the window is hidden and throttled', async () => {
    const { state, ping, now } = sandbox();
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now, timers: throttled });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onUnresponsive).not.toHaveBeenCalled(); // live and throttled: every late check is answered
    state.hung = true;
    await vi.advanceTimersByTimeAsync(2 * 60_000); // one check sends the ping that hangs, the next sees it
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
  });

  it('a live sandbox answering late checks under throttling is never declared unresponsive', async () => {
    const { ping, now } = sandbox(40);
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now, timers: throttled });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
  });

  it('a rejected ping is over: the next check sends another', async () => {
    let calls = 0;
    const ping = (): Promise<unknown> => (++calls === 1 ? Promise.reject(new Error('timed out')) : Promise.resolve(true));
    const onUnresponsive = vi.fn();
    watchSandbox({ ping, onUnresponsive, now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
    expect(calls).toBe(11);
  });

  it('dispose stops pings and prevents firing', async () => {
    const { state, ping, now } = sandbox();
    state.hung = true;
    const onUnresponsive = vi.fn();
    const watch = watchSandbox({ ping, onUnresponsive, now });
    await vi.advanceTimersByTimeAsync(6_000);
    watch.dispose();
    watch.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
    expect(state.pings).toBe(1);
  });

  it('uses injected timers', () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const timers = { setTimeout: (fn: () => void, ms: number) => scheduled.push({ fn, ms }), clearTimeout: vi.fn() };
    let clock = 0;
    const onUnresponsive = vi.fn();
    watchSandbox({ ping: () => new Promise(() => {}), onUnresponsive, now: () => clock, timers, intervalMs: 100, thresholdMs: 300 });
    for (let step = 0; step < 3; step++) { clock += 100; scheduled.at(-1)!.fn(); }
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    expect(scheduled.every(entry => entry.ms === 100)).toBe(true);
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLINK_MS, blink } from './menu-blink';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('blink', () => {
  it('turns the row off, then on, then finishes', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const row = document.createElement('div');
    const done = vi.fn();
    blink(row, done);
    expect(row.dataset.blink).toBe('off');
    vi.advanceTimersByTime(BLINK_MS);
    expect(row.dataset.blink).toBe('on');
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BLINK_MS);
    expect(row.dataset.blink).toBeUndefined();
    expect(done).toHaveBeenCalledOnce();
  });

  it('picks on the same frame under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const row = document.createElement('div');
    const done = vi.fn();
    blink(row, done);
    expect(done).toHaveBeenCalledOnce();
    expect(row.dataset.blink).toBeUndefined();
  });
});

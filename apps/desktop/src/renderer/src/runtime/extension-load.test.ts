import { describe, expect, it, vi } from 'vitest';
import { ExtensionLoad, noticeSlowExtensions } from './extension-load';

describe('ExtensionLoad', () => {
  it('names an extension once its share of the window crosses the limit', () => {
    const load = new ExtensionLoad({ windowMs: 10_000, shareLimit: 0.15 });
    const slow = vi.fn();
    load.onSlow(slow);
    // 5 ms every frame for a little under five seconds: 1.45 s of 10 s.
    for (let frame = 0; frame < 290; frame++) load.record('acme.painter', 5, frame * 16.7);
    expect(slow).not.toHaveBeenCalled();
    for (let frame = 290; frame < 320; frame++) load.record('acme.painter', 5, frame * 16.7);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(slow.mock.calls[0]![0]).toMatchObject({ id: 'acme.painter', windowMs: 10_000, longestMs: 5 });
    expect(slow.mock.calls[0]![0].busyMs).toBeGreaterThanOrEqual(1500);
  });

  it('lets old work age out of the window', () => {
    const load = new ExtensionLoad({ windowMs: 10_000, shareLimit: 0.15 });
    const slow = vi.fn();
    load.onSlow(slow);
    load.record('acme.burst', 1000, 0);
    expect(load.usage('acme.burst', 0)?.busyMs).toBe(1000);
    // Eleven seconds later the first second has left the window.
    load.record('acme.burst', 1000, 11_000);
    expect(load.usage('acme.burst', 11_000)?.busyMs).toBe(1000);
    expect(slow).not.toHaveBeenCalled();
  });

  it('treats one long freeze like sustained work', () => {
    const load = new ExtensionLoad({ windowMs: 10_000, shareLimit: 0.15 });
    const slow = vi.fn();
    load.onSlow(slow);
    load.record('acme.freeze', 2000, 500);
    expect(slow).toHaveBeenCalledWith(expect.objectContaining({ id: 'acme.freeze', longestMs: 2000 }));
  });

  it('reports each extension at most once, even after it unloads', () => {
    const load = new ExtensionLoad({ windowMs: 10_000, shareLimit: 0.15 });
    const slow = vi.fn();
    load.onSlow(slow);
    load.record('acme.again', 2000, 0);
    load.forget('acme.again');
    load.record('acme.again', 2000, 20_000);
    expect(slow).toHaveBeenCalledTimes(1);
    load.reset();
    load.record('acme.again', 2000, 40_000);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('keeps extensions apart and ignores nonsense samples', () => {
    const load = new ExtensionLoad({ windowMs: 10_000, shareLimit: 0.15 });
    const slow = vi.fn();
    load.onSlow(slow);
    load.record('acme.a', 1000, 0);
    load.record('acme.b', 1000, 0);
    load.record('acme.a', Number.NaN, 0);
    load.record('acme.a', -50, 0);
    load.record('', 5000, 0);
    expect(slow).not.toHaveBeenCalled();
    expect(load.usage('acme.a', 0)?.busyMs).toBe(1000);
  });
});

describe('noticeSlowExtensions', () => {
  it('names the extension and offers to turn it off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = new ExtensionLoad();
    const toast = vi.fn();
    const turnOff = vi.fn(async () => {});
    noticeSlowExtensions({ nameOf: () => 'Glow Kit', toast, turnOff }, load);
    load.record('acme.glow', 3000, 0);
    expect(toast).toHaveBeenCalledWith('This extension is slowing down the editor', expect.objectContaining({
      kind: 'alert', sticky: true, key: 'slow-extension:acme.glow', source: { id: 'acme.glow', name: 'Glow Kit' }
    }));
    toast.mock.calls[0]![1].action.run();
    expect(turnOff).toHaveBeenCalledWith('acme.glow');
  });

  it('says so when turning off fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = new ExtensionLoad();
    const toast = vi.fn();
    noticeSlowExtensions({ nameOf: () => 'Glow Kit', toast, turnOff: () => Promise.reject(new Error('no')) }, load);
    load.record('acme.glow', 3000, 0);
    toast.mock.calls[0]![1].action.run();
    await Promise.resolve(); await Promise.resolve();
    expect(toast).toHaveBeenLastCalledWith('Could not turn it off. Open Mods to try again.', expect.objectContaining({ kind: 'alert', source: { id: 'acme.glow', name: 'Glow Kit' } }));
  });

  it('stays quiet about built-ins and unknown ids', () => {
    const load = new ExtensionLoad();
    const toast = vi.fn();
    noticeSlowExtensions({ nameOf: () => null, toast, turnOff: vi.fn() }, load);
    load.record('timeline', 3000, 0);
    expect(toast).not.toHaveBeenCalled();
  });
});

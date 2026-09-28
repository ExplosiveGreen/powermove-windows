import { afterEach, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { createRpc, createRpcBudget, rpcTransfers, SandboxTimeoutError } from './sandbox-rpc';
const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); });
function pair(a: Record<string, (...args: any[]) => unknown> = {}, b: Record<string, (...args: any[]) => unknown> = {}, timeout = 100) {
  const channel = new MessageChannel();
  const left = createRpc(channel.port1 as unknown as MessagePort, a, timeout);
  const right = createRpc(channel.port2 as unknown as MessagePort, b, timeout);
  close.push(() => { left.close(); right.close(); });
  return { left, right };
}
it('round-trips calls and notifications', async () => {
  let value = 0;
  const { left } = pair({}, { sum: (a: number, b: number) => a + b, save: (n: number) => { value = n; } });
  expect(await left.call('sum', 3, 4)).toBe(7);
  left.notify('save', 9);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(value).toBe(9);
});
it('invokes and releases function handles', async () => {
  const { left, right } = pair();
  const id = right.handle((value: string) => value.toUpperCase());
  expect(await left.invokeHandle(id, 'hi')).toBe('HI');
  right.release(id);
  await expect(left.invokeHandle(id, 'hi')).rejects.toThrow('Unknown sandbox method');
});
it('preserves error names and codes', async () => {
  const { left } = pair({}, { fail() { const error = new Error('denied'); error.name = 'PermissionError'; (error as Error & { code: string }).code = 'full-access'; throw error; } });
  await expect(left.call('fail')).rejects.toMatchObject({ name: 'PermissionError', message: 'denied', code: 'full-access' });
});
it('can transfer an ArrayBuffer with a call', async () => {
  const { left } = pair({}, { bytes: (buffer: ArrayBuffer) => [...new Uint8Array(buffer)] });
  const buffer = Uint8Array.from([3, 7]).buffer;
  expect(await left.call('bytes', buffer, rpcTransfers(buffer))).toEqual([3, 7]);
  expect(buffer.byteLength).toBe(0);
});
it('times out and rejects outstanding work on close', async () => {
  const { left } = pair({}, { wait: () => new Promise(() => {}) }, 15);
  await expect(left.call('wait')).rejects.toBeInstanceOf(SandboxTimeoutError);
  const pending = left.call('wait');
  left.close();
  await expect(pending).rejects.toThrow('closed');
});
it('caps live handles and rejects oversized or deeply nested incoming messages', async () => {
  const channel = new MessageChannel();
  const left = createRpc(channel.port1 as unknown as MessagePort, {}, 100);
  const right = createRpc(channel.port2 as unknown as MessagePort, { echo: (value: unknown) => value }, 100, { maxHandles: 2 });
  close.push(() => { left.close(); right.close(); });
  right.handle(() => 1);
  right.handle(() => 2);
  expect(() => right.handle(() => 3)).toThrow('handle limit');
  await expect(left.call('echo', 'x'.repeat(2 * 1024 * 1024))).rejects.toMatchObject({ code: 'resource_limit' });
  let nested: unknown = 'leaf';
  for (let i = 0; i < 70; i++) nested = { next: nested };
  await expect(left.call('echo', nested)).rejects.toMatchObject({ code: 'resource_limit' });
  await expect(left.call('echo', new Map([['blob', 'x'.repeat(2 * 1024 * 1024)]]))).rejects.toMatchObject({ code: 'resource_limit' });
  await expect(left.call('echo', new Set(['x'.repeat(2 * 1024 * 1024)]))).rejects.toMatchObject({ code: 'resource_limit' });
});
it('rejects an oversized reply from a sandbox callback', async () => {
  const { left } = pair({}, { huge: () => 'x'.repeat(2 * 1024 * 1024) }, 500);
  await expect(left.call('huge')).rejects.toMatchObject({ code: 'resource_limit' });
});
it('accepts the documented larger project mirror only on a trusted receiver', async () => {
  const channel = new MessageChannel();
  const mirror = vi.fn(), other = vi.fn();
  const host = createRpc(channel.port1 as unknown as MessagePort, {});
  const view = createRpc(channel.port2 as unknown as MessagePort, { mirror, other }, 100, { maxMirrorBytes: 16 * 1024 * 1024 + 8192 });
  close.push(() => { host.close(); view.close(); });
  host.notify('mirror', { project: 'x'.repeat(2 * 1024 * 1024) });
  host.notify('other', 'x'.repeat(2 * 1024 * 1024));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(mirror).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
});
it('shares the message rate budget across an extension runtime and view', async () => {
  const budget = createRpcBudget();
  const a = new MessageChannel(), b = new MessageChannel();
  const callers = [createRpc(a.port1 as unknown as MessagePort, {}), createRpc(b.port1 as unknown as MessagePort, {})];
  const receivers = [createRpc(a.port2 as unknown as MessagePort, { ping: () => true }, 1000, { budget }),
    createRpc(b.port2 as unknown as MessagePort, { ping: () => true }, 1000, { budget })];
  close.push(() => { for (const rpc of [...callers, ...receivers]) rpc.close(); });
  const results = await Promise.allSettled([...Array.from({ length: 150 }, () => callers[0]!.call('ping')),
    ...Array.from({ length: 150 }, () => callers[1]!.call('ping'))]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(200);
  expect(results.filter(item => item.status === 'rejected')).toHaveLength(100);
});
it('delivers 120 Hz host mirrors and callbacks without spending the callback budget on mirrors', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const channel = new MessageChannel();
  const limited = vi.fn();
  let mirroredTime = 0;
  const host = createRpc(channel.port1 as unknown as MessagePort, {}, 1000);
  const child = createRpc(channel.port2 as unknown as MessagePort, { mirror: (time: number) => { mirroredTime = time; } }, 1000, {
    trustedHostMirrors: true, onSustainedLimit: limited,
  } as Parameters<typeof createRpc>[3]);
  close.push(() => { host.close(); child.close(); clock.mockRestore(); });
  const callback = child.handle((time: number) => ({ time, mirroredTime }));
  for (let second = 0; second < 4; second++) {
    const results: Promise<unknown>[] = [];
    for (let tick = 1; tick <= 120; tick++) {
      const time = second + tick / 120;
      host.notify('mirror', time);
      results.push(host.invokeHandle(callback, time));
    }
    const settled = await Promise.allSettled(results);
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(120);
    for (const result of settled) if (result.status === 'fulfilled') {
      expect((result.value as any).mirroredTime).toBe((result.value as any).time);
    }
    now += 1000;
  }
  expect(limited).not.toHaveBeenCalled();
});

it('keeps mirror size/depth checks and the host inbound rate limit with trusted child mirrors', async () => {
  const channel = new MessageChannel();
  const hostMirror = vi.fn(), childMirror = vi.fn();
  const host = createRpc(channel.port1 as unknown as MessagePort, { mirror: hostMirror }, 1000);
  const child = createRpc(channel.port2 as unknown as MessagePort, { mirror: childMirror }, 1000, {
    trustedHostMirrors: true, maxMirrorBytes: 1024,
  } as Parameters<typeof createRpc>[3]);
  close.push(() => { host.close(); child.close(); });
  host.notify('mirror', 'x'.repeat(1024));
  let nested: unknown = 'leaf';
  for (let depth = 0; depth < 70; depth++) nested = { next: nested };
  host.notify('mirror', nested);
  for (let tick = 0; tick < 201; tick++) child.notify('mirror', tick);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(childMirror).not.toHaveBeenCalled();
  expect(hostMirror).toHaveBeenCalledTimes(200);
});
it('reports a sustained over-rate sender after three seconds', async () => {
  let now = 1_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const channel = new MessageChannel();
  const report = vi.fn();
  const sender = createRpc(channel.port1 as unknown as MessagePort, {});
  const receiver = createRpc(channel.port2 as unknown as MessagePort, {}, 100, { onSustainedLimit: report });
  close.push(() => { sender.close(); receiver.close(); clock.mockRestore(); });
  for (let second = 0; second < 4; second++) {
    for (let index = 0; index < 201; index++) sender.notify('noise');
    await new Promise(resolve => setTimeout(resolve, 10));
    now += 1_000;
  }
  expect(report).toHaveBeenCalledTimes(1);
});

it('meters unsolicited replies and caps handles across connected ports', async () => {
  let now = 2_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const budget = createRpcBudget();
  const a = new MessageChannel(), b = new MessageChannel();
  const report = vi.fn();
  const receiver = createRpc(a.port1 as unknown as MessagePort, {}, 100, { budget, maxIncomingPerSecond: 2, onSustainedLimit: report, maxHandles: 2 });
  const view = createRpc(b.port1 as unknown as MessagePort, {}, 100, { budget, maxHandles: 2 });
  close.push(() => { receiver.close(); view.close(); a.port2.close(); b.port2.close(); clock.mockRestore(); });
  receiver.handle(() => 1);
  view.handle(() => 2);
  expect(() => view.handle(() => 3)).toThrow('handle limit');
  for (let second = 0; second < 4; second++) {
    for (let index = 0; index < 3; index++) a.port2.postMessage({ t: 'reply', id: 900 + index, ok: true, v: 'noise' });
    await new Promise(resolve => setTimeout(resolve, 5));
    now += 1_000;
  }
  expect(report).toHaveBeenCalledTimes(1);
});

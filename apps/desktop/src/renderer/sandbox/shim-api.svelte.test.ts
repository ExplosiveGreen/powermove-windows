// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterEach, expect, it } from 'vitest';
import { createRpc } from '../../shared/sandbox-rpc';
import { createSandboxAPI, sandboxControl, type SandboxInit, type SandboxSnapshot } from './shim-api';

const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); });
const settle = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function harness(kernel: Record<string, (...args: any[]) => unknown> = {}) {
  const channel = new MessageChannel();
  const calls: string[] = [];
  const handlers: Record<string, (...args: any[]) => unknown> = { register: () => undefined, 'dispose-registration': () => undefined, 'runtime-error': () => undefined, ...kernel };
  const host = createRpc(channel.port2, Object.fromEntries(Object.entries(handlers).map(([name, fn]) => [name, (...args: unknown[]) => { calls.push(name); return fn(...args); }])));
  const rpc = createRpc(channel.port1, {}, 1000, { trusted: true, maxHandles: 1 });
  close.push(() => { rpc.close(); host.close(); });
  const init = { id: 'shim-ext', apiVersion: 3, manifest: { id: 'shim-ext', name: 'Shim', version: '1.0.0', apiVersion: 3 }, vars: {},
    theme: { id: 'night', scheme: 'dark', tokens: {} }, bundleUrl: '', state: { time: 1, playing: false, revision: 5, generation: 1, selection: null } } as unknown as SandboxInit;
  const api = createSandboxAPI(rpc, init) as any;
  return { api, control: sandboxControl(api), calls, count: (name: string) => calls.filter(call => call === name).length };
}

/** A reader in a reactive context: every run records what it read. */
function watch<T>(read: () => T): { seen: T[]; stop(): void } {
  const seen: T[] = [];
  const stop = $effect.root(() => { $effect(() => { seen.push(read()); }); });
  flushSync();
  return { seen, stop };
}

it('re-runs reactive readers on the tick keys they read, and nothing else', () => {
  const { api, control } = harness();
  const time = watch(() => api.project.time());
  const transport = watch(() => [api.transport.time(), api.transport.playing()]);
  const revision = watch(() => api.project.revision());
  const selection = watch(() => api.project.selection());
  control.tick({ time: 2 }, []); flushSync();
  control.tick({ playing: true }, []); flushSync();
  control.tick({ revision: 6, selection: { layers: ['b'], keys: [], chan: null } }, []); flushSync();
  expect(time.seen).toEqual([1, 2]);
  expect(transport.seen).toEqual([[1, false], [2, false], [2, true]]);
  expect(revision.seen).toEqual([5, 6]);
  expect(selection.seen).toEqual([null, { layers: ['b'], keys: [], chan: null }]);
  for (const reader of [time, transport, revision, selection]) reader.stop();
});

it('keeps plain reads plain and the remaining readers live when one goes', async () => {
  const { api, control } = harness();
  expect(api.project.time()).toBe(1); // outside a reactive context: a value, no subscription
  const first = watch(() => api.project.time());
  const second = watch(() => api.project.time());
  first.stop();
  await settle();
  control.tick({ time: 3 }, []); flushSync();
  expect([first.seen, second.seen]).toEqual([[1], [1, 3]]);
  expect(api.project.time()).toBe(3);
  second.stop();
});

it('sends nothing to the host during playback, with or without reactive readers', async () => {
  const { api, control, calls } = harness({ 'project-snapshot': (): SandboxSnapshot => ({ generation: 1, json: '{}' }) });
  const play = () => { for (let frame = 1; frame <= 60; frame++) { control.tick({ time: frame / 30 }, []); flushSync(); } };
  play();
  await settle();
  expect(calls).toEqual([]);
  const time = watch(() => api.project.time());
  const latest = watch(() => api.project.latest());
  await settle();
  expect(calls).toEqual(['project-snapshot']);
  play();
  await settle();
  expect(calls).toEqual(['project-snapshot']);
  expect(time.seen).toHaveLength(61);
  expect(latest.seen).toEqual([undefined, {}]);
  time.stop(); latest.stop();
});

it('pulls latest() once per generation while it has readers, re-running them when each copy lands', async () => {
  let generation = 1;
  const { api, control, count } = harness({ 'project-snapshot': (): SandboxSnapshot => ({ generation, json: JSON.stringify({ generation }) }) });
  expect(api.project.latest()).toBeUndefined();
  await settle();
  expect(count('project-snapshot')).toBe(0); // a plain read never pulls
  const one = watch(() => api.project.latest()?.generation);
  const two = watch(() => api.project.latest()?.generation);
  await settle(); flushSync();
  expect(count('project-snapshot')).toBe(1);
  expect([one.seen, two.seen]).toEqual([[undefined, 1], [undefined, 1]]);
  expect(Object.isFrozen(api.project.latest())).toBe(true);
  control.tick({ revision: 6 }, [['project:changed', { kind: 'values' }]]); // same generation: nothing to pull
  generation = 2;
  control.tick({ generation: 2 }, []);
  await settle(); flushSync();
  expect(count('project-snapshot')).toBe(2);
  expect(one.seen).toEqual([undefined, 1, 2]);
  await expect(api.project.get()).resolves.toBe(api.project.latest()); // get() shares the copy
  expect(count('project-snapshot')).toBe(2);
  one.stop(); two.stop();
  await settle();
  generation = 3;
  control.tick({ generation: 3 }, []);
  await settle();
  expect(count('project-snapshot')).toBe(2); // the last reader took the pulls with it
  await api.project.get();
  expect(api.project.latest()).toEqual({ generation: 3 }); // latest() is whatever this document pulled last
});

it('starts latest() readers from a copy get() already pulled', async () => {
  const { api, count } = harness({ 'project-snapshot': (): SandboxSnapshot => ({ generation: 1, json: '{"layers":[]}' }) });
  const project = await api.project.get();
  const latest = watch(() => api.project.latest());
  await settle(); flushSync();
  expect(latest.seen).toEqual([project]);
  expect(count('project-snapshot')).toBe(1);
  latest.stop();
});

it('re-runs theme readers from the theme push when it changes', () => {
  const { api, control } = harness();
  const theme = watch(() => `${api.theme.active()}/${api.theme.scheme()}`);
  control.theme({ id: 'night', scheme: 'dark', tokens: { '--accent': 'red' } }); flushSync();
  control.theme({ id: 'day', scheme: 'light', tokens: {} }); flushSync();
  control.theme({ scheme: 'dark', tokens: {} }); flushSync(); // a view's push without an id keeps the active theme
  expect(theme.seen).toEqual(['night/dark', 'day/light', 'day/dark']);
  expect([api.theme.active(), api.theme.scheme()]).toEqual(['day', 'dark']);
  theme.stop();
});

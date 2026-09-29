// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { expect, it, vi } from 'vitest';
import type { ExtensionRecord, PaletteEntry, Project, ProjectAPI, TransportAPI } from './api';
import { createExtensionAPI, type HostDeps } from './host';
import { createKernel } from './registries';

const record: ExtensionRecord = { id: 'live', scope: 'user', manifest: { id: 'live', name: 'Live', version: '1.0.0', apiVersion: 3 }, dir: '/ext/live',
  enabled: true, bundleUrl: null, bundleHash: null, health: { state: 'ok' }, updatedAt: 0 };

function harness(withTransport = true) {
  const kernel = createKernel();
  const live = { time: 0, playing: false, revision: 1, layers: ['a'], quality: 1, project: { id: 'p', name: 'One' } as unknown as Project };
  /* Counts the kernel subscriptions each event has, so a test can see who subscribed. */
  const listeners = new Map<string, number>();
  const on = kernel.events.on.bind(kernel.events);
  kernel.events.on = ((event: string, fn: never, owner?: string) => {
    listeners.set(event, (listeners.get(event) ?? 0) + 1);
    const off = on(event as never, fn, owner);
    return { dispose() { off.dispose(); listeners.set(event, listeners.get(event)! - 1); } };
  }) as typeof kernel.events.on;
  const project = { get: () => live.project, latest: () => live.project, revision: () => live.revision, time: () => live.time, playing: () => live.playing,
    selection: () => ({ layers: [...live.layers], keys: [], chan: null }), apply: vi.fn() } as unknown as ProjectAPI;
  const transport = { time: () => live.time, playing: () => live.playing, get quality() { return live.quality; }, set quality(value: number) { live.quality = value; } } as unknown as TransportAPI;
  const deps = { pm: {}, state: {}, ui: {}, project, ...(withTransport ? { transport } : {}), assets: {}, storage: () => ({}), extensions: {},
    panelsBackend: {}, paletteOpen: vi.fn(), reportRuntimeError: vi.fn() } as unknown as HostDeps;
  const handle = createExtensionAPI(kernel, record, deps);
  const subscribed = () => Object.fromEntries([...listeners].filter(([, count]) => count > 0));
  return { kernel, live, api: handle.api, handle, subscribed };
}

/** A reader in a reactive context: every run records what it read. */
function watch<T>(read: () => T): { seen: T[]; stop(): void } {
  const seen: T[] = [];
  const stop = $effect.root(() => { $effect(() => { seen.push(read()); }); });
  flushSync();
  return { seen, stop };
}
const microtask = () => new Promise<void>(resolve => queueMicrotask(resolve));

it('re-runs each reactive read on the kernel event that changes it, and on no other', () => {
  const { kernel, live, api } = harness();
  const time = watch(() => [api.project.time(), api.transport.time()]);
  const playing = watch(() => [api.project.playing(), api.transport.playing()]);
  const revision = watch(() => api.project.revision());
  const selection = watch(() => api.project.selection().layers);
  const latest = watch(() => api.project.latest()?.name);
  live.time = 1; kernel.events.emit('time', 1); flushSync();
  live.playing = true; kernel.events.emit('transport', { playing: true }); flushSync();
  live.layers = ['b']; kernel.events.emit('selection', { layers: ['b'], keys: [], chan: null }); flushSync();
  live.revision = 2; (live.project as { name: string }).name = 'Two'; // edited in place, as the editor does
  kernel.events.emit('project:changed', { kind: 'values' }); flushSync();
  expect(time.seen).toEqual([[0, 0], [1, 1]]);
  expect(playing.seen).toEqual([[false, false], [true, true]]);
  expect(selection.seen).toEqual([['a'], ['b']]);
  expect(revision.seen).toEqual([1, 2]);
  expect(latest.seen).toEqual(['One', 'Two']);
  expect(api.project.latest()).toBe(api.project.get());
  for (const reader of [time, playing, revision, selection, latest]) reader.stop();
});

it('re-runs theme reads on theme:changed', () => {
  const { kernel, api } = harness();
  const theme = watch(() => `${api.theme.active()}/${api.theme.scheme()}`);
  kernel.themes.register('app', { id: 'paper', name: 'Paper', scheme: 'light' });
  kernel.activateTheme('paper'); flushSync();
  kernel.setScheme('dark'); flushSync();
  expect(theme.seen).toEqual(['default/system', 'paper/system', 'paper/dark']);
  theme.stop();
});

it('subscribes nothing for plain reads, once for many readers, and unsubscribes with the last', async () => {
  const { kernel, api, subscribed } = harness();
  expect([api.project.time(), api.project.playing(), api.project.revision(), api.project.latest()?.name, api.transport.time(), api.theme.active()])
    .toEqual([0, false, 1, 'One', 0, 'default']);
  expect(subscribed()).toEqual({});
  const one = watch(() => api.project.time());
  const two = watch(() => api.transport.time());
  expect(subscribed()).toEqual({ time: 1 });
  one.stop();
  await microtask();
  expect(subscribed()).toEqual({ time: 1 });
  kernel.events.emit('time', 5); flushSync();
  expect([one.seen, two.seen]).toEqual([[0], [0, 0]]);
  two.stop();
  await microtask();
  expect(subscribed()).toEqual({});
});

it('keeps reads plain in callbacks the host polls from its own reactive UI', () => {
  const { kernel, api, subscribed } = harness();
  api.status.register({ id: 'live.clock', text: () => `t=${api.project.time()}` });
  api.commands.register({ id: 'live.go', label: 'Go', run: () => {}, when: () => api.project.selection().layers.length > 0 });
  api.menus.contribute('layer:context', () => [{ label: api.theme.active() }]);
  api.palette.registerProvider(() => [{ id: 'live.entry', label: String(api.project.revision()), category: 'Live', run: () => {} }]);
  // The host's status bar, menus and palette evaluate these inside its own $derived.
  const host = watch(() => [kernel.status.get('live.clock')!.text(), kernel.commands.get('live.go')!.when!(),
    kernel.collectMenu('layer:context'), kernel.paletteProviders().map(entry => (entry.provider('') as PaletteEntry[])[0]?.label)]);
  expect(host.seen).toEqual([['t=0', true, [{ label: 'default' }], ['1']]]);
  expect(subscribed()).toEqual({});
  host.stop();
});

it('drops its subscriptions with the extension, and a reader leaving afterwards is harmless', async () => {
  const { kernel, handle, api } = harness();
  const time = watch(() => api.project.time());
  handle.disposeAll();
  kernel.events.emit('time', 1); flushSync();
  expect(time.seen).toEqual([0]);
  time.stop();
  await expect(microtask()).resolves.toBeUndefined();
});

it('keeps the transport accessors and leaves a missing transport missing', () => {
  const { api, live } = harness();
  api.transport.quality = 0.5;
  expect([live.quality, api.transport.quality]).toEqual([0.5, 0.5]);
  expect(harness(false).api.transport).toBeUndefined();
});

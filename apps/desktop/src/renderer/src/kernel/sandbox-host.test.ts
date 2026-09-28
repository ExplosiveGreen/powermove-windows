// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxAPI, PermissionError, sandboxControl, type SandboxEvent, type SandboxInit } from '../../sandbox/shim-api';
import { installSandboxRuntime } from '../../sandbox/boot';
import { cached, coalesceEvents, createSandboxRuntime } from './sandbox-host';
import { createKernel } from './registries';
import { parseHostEvent } from './sandbox-schemas';
import { sandboxStats } from './project-snapshots';
import { syntheticProject } from './__fixtures__/synthetic-project';
import type { HostDeps } from './host';
import type { ExtensionRecord, ProjectAPI } from './api';
const close: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of close.splice(0)) await fn(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('keeps only one callback request in flight for a synchronous cache', async () => {
  let finish!: (value: unknown) => void;
  const invokeHandle = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
  const text = cached({ invokeHandle } as unknown as ReturnType<typeof createRpc>, 7, 'loading');
  expect(Array.from({ length: 10 }, () => text())).toEqual(Array(10).fill('loading'));
  expect(invokeHandle).toHaveBeenCalledTimes(1);
  finish('ready');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(text()).toBe('ready');
  expect(invokeHandle).toHaveBeenCalledTimes(2);
});
it('accepts a large validated extensions boot event', () => {
  const payload = { ids: Array.from({ length: 1500 }, (_, index) => `extension-${index}`), reason: 'boot' };
  expect(parseHostEvent('extensions:changed', payload)).toEqual(payload);
  expect(() => parseHostEvent('extensions:changed', { ...payload, ids: Array(2001).fill('x') })).toThrow();
});
it('registers across a real MessageChannel, caches sync callbacks, scopes vars, and disposes', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'powermove-sandbox-fixture-'));
  close.push(() => rm(output, { recursive: true, force: true }));
  const compilerPath = '../../../main/extensions/compiler';
  const { compileExtension } = await import(/* @vite-ignore */ compilerPath);
  const compiled = await compileExtension({ dir: path.resolve('test/fixtures/sandboxed-ext'), entry: 'index.ts', outDir: output });
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const source = await readFile(compiled.bundlePath);
  installSandboxRuntime(); // the fixture's Svelte panel resolves svelte through the runtime table
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network mocked'))));
  const kernel = createKernel();
  const apply = vi.fn(() => ({ ok: true }));
  const project = { get: () => ({ id: 'test' }), revision: () => 1, selection: () => ({ layers: [], keys: [], chan: null }), time: () => 0, playing: () => false, apply, select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
  const deps = { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: async () => ({ id: 'x', name: 'x', kind: 'image' }), get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: async () => {}, remove: async () => {}, reload: async () => {}, reveal: async () => {}, requestFix: vi.fn(), rebase: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
  const record = { id: 'sandboxed-ext', trust: 'store', scope: 'user', manifest: { id: 'sandboxed-ext', name: 'Fixture', version: '1.0.0', apiVersion: 3, permissions: ['network', 'project:write'] }, dir: '/tmp/ext', enabled: true, bundleUrl: '/ext/sandboxed-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let childApi!: ReturnType<typeof createSandboxAPI>;
  const runtimePromise = createSandboxRuntime(kernel, record, deps, { TOKEN: 'one' }, { frame, onPostInit(port, init) {
    const child = createRpc(port, {});
    close.push(() => child.close());
    childApi = createSandboxAPI(child, init);
    void import(`data:text/javascript;base64,${source.toString('base64')}`).then(module => {
      module.default(childApi);
      child.notify('activated');
    });
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await runtimePromise;
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(kernel.effects.topEntry('sandboxed-ext.tint')?.ownerId).toBe('sandboxed-ext');
  expect(kernel.commands.topEntry('sandboxed-ext.command')?.ownerId).toBe('sandboxed-ext');
  expect(kernel.status.topEntry('sandboxed-ext.status')?.ownerId).toBe('sandboxed-ext');
  expect(childApi.effects.get('sandboxed-ext.tint')?.label).toBe('Sandbox tint');
  expect(childApi.commands.has('sandboxed-ext.command')).toBe(true);
  expect(await childApi.commands.run('sandboxed-ext.command')).toBe('ran');
  const status = kernel.status.get('sandboxed-ext.status')!;
  expect(status.text()).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(status.text()).toBe('Sandbox one');
  await childApi.project.apply([]);
  expect(apply).toHaveBeenCalled();
  expect(() => childApi.host.pm).toThrow(PermissionError);
  expect(childApi.vars.keys()).toEqual(['TOKEN']);
  runtime.dispose();
  expect(kernel.effects.has('sandboxed-ext.tint')).toBe(false);
  expect(kernel.commands.has('sandboxed-ext.command')).toBe(false);
  expect(kernel.status.has('sandboxed-ext.status')).toBe(false);
});

it('refuses malicious port calls before they touch the host', async () => {
  const kernel = createKernel();
  const deletes = vi.fn();
  const apply = vi.fn();
  const remove = vi.fn();
  const storageSet = vi.fn();
  const hostEvent = vi.fn();
  kernel.commands.register('app', { id: 'delete', label: 'Delete', run: deletes });
  const save = vi.fn();
  const duplicate = vi.fn();
  kernel.commands.register('legacy', { id: 'save', label: 'Save', run: save });
  kernel.commands.register('legacy', { id: 'duplicate', label: 'Duplicate', run: duplicate });
  kernel.commands.register('other', { id: 'evil-ext.collide', label: 'Other', run: vi.fn() });
  kernel.events.on('project:changed', hostEvent);
  const project = { get: () => ({ id: 'test', assets: {}, library: {} }), revision: () => 1, selection: () => ({ layers: [] }), time: () => 0, playing: () => false,
    apply, select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
  const deps = { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: async () => ({ id: 'x', name: 'x', kind: 'image' }), get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: storageSet, delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: vi.fn(), remove, reload: vi.fn(), reveal: vi.fn(), requestFix: vi.fn(), rebase: vi.fn(), setUp: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
  const record = { id: 'evil-ext', trust: 'store', scope: 'user', manifest: { id: 'evil-ext', name: 'Evil', version: '1.0.0', apiVersion: 3, permissions: [] }, dir: '/tmp/evil', enabled: true, bundleUrl: '/ext/evil-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let client: ReturnType<typeof createRpc>;
  const pending = createSandboxRuntime(kernel, record, deps, {}, { frame, onPostInit(port) {
    client = createRpc(port, {});
    client.notify('activated');
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => { runtime.dispose(); client.close(); });
  const errorCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toMatchObject({ code });
  };
  await errorCode(client!.call('invoke', 'commands', 'run', ['delete']), 'project:write');
  await errorCode(client!.call('invoke', 'project', 'undo', []), 'project:write');
  await errorCode(client!.call('invoke', 'project', 'select', [[]]), 'project:write');
  await expect(client!.call('invoke', 'extensions', 'remove', ['other'])).rejects.toThrow('unavailable');
  await errorCode(client!.call('invoke', 'extensions', 'setUp', ['other']), 'permission_denied');
  await errorCode(client!.call('register', 'commands', 'undo', { id: 'undo', label: 'Undo', run: 1 }), 'id_collision');
  await errorCode(client!.call('register', 'commands', 'collision', { id: 'evil-ext.collide', label: 'Collision', run: 1 }), 'id_collision');
  await errorCode(client!.call('register', 'commands', 'sibling', { id: 'evil-ext-other.command', label: 'Sibling', run: 1 }), 'id_collision');
  await expect(client!.call('register', 'commands', 'malformed', { id: 'evil-ext.malformed', label: 'Malformed', run: 'callback' })).rejects.toMatchObject({ name: 'ZodError' });
  await errorCode(client!.call('invoke', 'events', 'emit', ['project:changed', {}]), 'permission_denied');
  await errorCode(client!.call('register', 'events', 'foreign-event', { event: 'other-ext:secret' }), 'permission_denied');
  // Reading needs no permission: an extension without any may follow and read the project, and render a frame of it.
  await client!.call('register', 'events', 'changes', { event: 'project:changed' });
  await client!.call('register', 'events', 'selection', { event: 'selection' });
  await expect(client!.call('project-snapshot')).resolves.toMatchObject({ json: expect.any(String) });
  await expect(client!.call('invoke', 'project', 'snapshot', [0, 64])).resolves.toBe('');
  for (const token of ['changes', 'selection']) await client!.call('dispose-registration', token);
  await expect(client!.call('register', 'events', 'with-handle', { event: 'time', fn: 1 })).rejects.toMatchObject({ name: 'ZodError' });
  await errorCode(client!.call('register', 'keybindings', 'bad-key', { key: 'cmd+s', command: 'delete' }), 'permission_denied');
  const ownHandle = client!.handle(() => 'ok');
  await client!.call('register', 'commands', 'own', { id: 'evil-ext.own', label: 'Own', run: ownHandle });
  await client!.call('register', 'keybindings', 'save-key', { key: 'cmd+s', command: 'evil-ext.own' });
  expect(kernel.bindingsFor('cmd+s')[0]?.priority).toBeGreaterThanOrEqual(1000);
  kernel.bind('legacy', { key: 'cmd+s', command: 'save', priority: 100 });
  expect(kernel.bindingsFor('cmd+s')[0]?.command).toBe('save');
  await errorCode(client!.call('register', 'keybindings', 'save-key-2', { key: 'cmd+s', command: 'evil-ext.own' }), 'id_collision');
  for (const extra of [{ looseModifiers: true }, { inFields: true }, { priority: -1 }]) {
    await expect(client!.call('register', 'keybindings', 'invalid', { key: 'x', command: 'evil-ext.own', ...extra })).rejects.toMatchObject({ name: 'ZodError' });
  }
  await client!.call('register', 'keybindings', 'own-key', { key: 'cmd+shift+9', command: 'evil-ext.own' });
  expect(kernel.bindingsFor('cmd+shift+9')[0]?.priority).toBeGreaterThanOrEqual(1000);
  await expect(client!.call('invoke', 'keybindings', 'unbind', ['cmd+s', 1])).rejects.toMatchObject({ name: 'ZodError' });
  await client!.call('invoke', 'keybindings', 'unbind', ['cmd+s']);
  expect(kernel.bindingsFor('cmd+s')[0]?.command).toBe('save');
  await errorCode(client!.call('invoke', 'panels', 'open', ['foreign.panel']), 'permission_denied');
  await expect(client!.call('invoke', 'theme', 'setScheme', ['dark'])).rejects.toThrow('unavailable');
  await client!.call('invoke', 'commands', 'run', ['evil-ext.own']);
  record.manifest!.permissions!.push('project:write');
  await client!.call('invoke', 'commands', 'run', ['duplicate']);
  expect(duplicate).toHaveBeenCalledTimes(1);
  await errorCode(client!.call('invoke', 'commands', 'run', ['save']), 'permission_denied');
  await errorCode(client!.call('invoke', 'commands', 'run', ['evil-ext.collide']), 'permission_denied');
  await errorCode(client!.call('invoke', 'storage', 'set', ['huge', 'x'.repeat(2 * 1024 * 1024)]), 'resource_limit');
  for (const value of [new Map([['secret', 'x']]), new Set(['secret']), new ArrayBuffer(8)]) {
    await expect(client!.call('invoke', 'storage', 'set', ['invalid', value])).rejects.toMatchObject({ name: 'ZodError' });
  }
  await errorCode(client!.call('invoke', 'storage', 'set', ['k'.repeat(129), 'x']), 'resource_limit');
  await client!.call('invoke', 'storage', 'set', ['first', 'x'.repeat(250 * 1024)]);
  await errorCode(client!.call('invoke', 'storage', 'set', ['second', 'x'.repeat(8 * 1024)]), 'resource_limit');
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  for (let index = 0; index < 60; index++) client!.notify('log', 'info', 'flood', []);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(info).toHaveBeenCalledTimes(50);
  info.mockRestore();
  record.id = 'project';
  const scoped = vi.fn();
  kernel.events.on('ext:project:changed' as Parameters<typeof kernel.events.on>[0], scoped);
  await errorCode(client!.call('invoke', 'events', 'emit', ['project:changed', {}]), 'permission_denied');
  await client!.call('invoke', 'events', 'emit', ['changed', { safe: true }]);
  expect(scoped).toHaveBeenCalledWith({ safe: true });
  expect(hostEvent).not.toHaveBeenCalled();
  await new Promise(resolve => setTimeout(resolve, 1100));
  for (let index = 0; index < 197; index++) await client!.call('register', 'events', `event-${index}`, { event: 'tick' });
  await new Promise(resolve => setTimeout(resolve, 1100));
  await expect(client!.call('register', 'events', 'event-201', { event: 'tick' })).rejects.toThrow('registration limit');
  const burst = await Promise.allSettled(Array.from({ length: 500 }, () => client!.call('extensions-list')));
  expect(burst.some(result => result.status === 'rejected' && (result.reason as { code?: string }).code === 'resource_limit')).toBe(true);
  expect(deletes).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(hostEvent).not.toHaveBeenCalled();
  expect(storageSet).toHaveBeenCalledTimes(1);
  expect(kernel.commands.topEntry('undo')).toBeUndefined();
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    for (let second = 0; second < 4; second++) {
      for (let index = 0; index < 201; index++) client!.notify('noise');
      await new Promise(resolve => setTimeout(resolve, 10));
      now += 1000;
    }
    expect(deps.reportRuntimeError).toHaveBeenCalledWith('project', expect.objectContaining({ message: 'exceeded the sandbox message budget' }));
    expect(frame.isConnected).toBe(false);
  } finally { clock.mockRestore(); }
});

it('does not allocate callback handles for view-local registration replays or event listeners', () => {
  const channel = new MessageChannel();
  const rpc = createRpc(channel.port1, {}, 100, { maxHandles: 0 });
  const peer = createRpc(channel.port2, { register: () => undefined });
  close.push(() => { rpc.close(); peer.close(); });
  const init = { id: 'evil-ext', apiVersion: 3, manifest: { id: 'evil-ext', name: 'Test', version: '1.0.0', apiVersion: 3, permissions: [] }, vars: {},
    theme: { scheme: 'dark', tokens: {} }, state: { time: 0, playing: false, revision: 1, generation: 1, selection: null }, bundleUrl: '' } as Parameters<typeof createSandboxAPI>[1];
  const api = createSandboxAPI(rpc, init, 'view');
  api.commands.register({ id: 'evil-ext.one', label: 'One', run: () => {} });
  api.commands.register({ id: 'evil-ext.two', label: 'Two', run: () => {} });
  api.status.register({ id: 'evil-ext.status', text: () => 'ready' });
  api.palette.registerProvider(() => []);
  api.menus.contribute('panel:context', () => []);
  const events = api.events as unknown as { on(event: string, fn: () => void): { dispose(): void } };
  events.on('one', () => {});
  events.on('two', () => {});
  events.on('time', () => {});
  sandboxControl(api).dispose();
});

it('coalesces one flush: last time and selection, one project:changed per kind, the rest in order', () => {
  expect(coalesceEvents([['time', 1], ['a', 1], ['project:changed', { kind: 'values' }], ['time', 2], ['selection', 's1'],
    ['project:changed', { kind: 'structure' }], ['a', 2], ['project:changed', { kind: 'values' }], ['selection', 's2']]))
    .toEqual([['a', 1], ['time', 2], ['project:changed', { kind: 'structure' }], ['a', 2], ['project:changed', { kind: 'values' }], ['selection', 's2']]);
});

/* Data plane (docs/sandbox-data-plane.md §3): real shim documents on real ports. */
function planeDeps(live: { proj: Record<string, any>; time: number; playing: boolean; selection?: { layers: string[]; keys: string[]; chan: string | null } }) {
  const project = { get: () => live.proj, revision: () => Number(live.proj.revision),
    selection: vi.fn(() => live.selection ? { layers: [...live.selection.layers], keys: [...live.selection.keys], chan: live.selection.chan } : { layers: ['l1'], keys: [], chan: null }),
    time: () => live.time, playing: () => live.playing, apply: vi.fn(), select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
  return { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: async () => ({ id: 'x', name: 'x', kind: 'image' }), get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: async () => {}, remove: async () => {}, reload: async () => {}, reveal: async () => {}, requestFix: vi.fn(), rebase: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
}
async function planeRuntime(kernel: ReturnType<typeof createKernel>, deps: HostDeps, id: string, permissions: string[], activate: (api: any) => void = () => {}) {
  const record = { id, trust: 'store', scope: 'user', manifest: { id, name: id, version: '1.0.0', apiVersion: 3, permissions }, dir: `/tmp/${id}`, enabled: true, bundleUrl: `/ext/${id}/bundle.js`, bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as unknown as ExtensionRecord;
  const frame = document.createElement('iframe');
  const ticks: string[] = [];
  let api!: any;
  let init!: SandboxInit;
  let rpc!: ReturnType<typeof createRpc>;
  const pending = createSandboxRuntime(kernel, record, deps, {}, { frame, onPostInit(port, message) {
    init = message;
    let control: ReturnType<typeof sandboxControl> | undefined;
    const child = rpc = createRpc(port, { tick: (delta: unknown, events: SandboxEvent[]) => { ticks.push(JSON.stringify([delta, events])); control?.tick(delta as never, events); } }, 10_000, { trusted: true });
    close.push(() => child.close());
    api = createSandboxAPI(child, message);
    control = sandboxControl(api);
    activate(api);
    child.notify('activated');
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => runtime.dispose());
  return { runtime, api, ticks, init: () => init, rpc };
}
const flushed = () => new Promise(resolve => setTimeout(resolve, 0));
/* A tick crosses a real port, which one macrotask does not always cover under load. */
const until = async (check: () => boolean) => { for (let wait = 0; wait < 100 && !check(); wait++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };

it('inits with state and no project, ticks small deltas, and forwards only subscribed events, coalesced', async () => {
  const kernel = createKernel();
  const live = { proj: { revision: 1, layers: [] } as Record<string, any>, time: 0, playing: false };
  const deps = planeDeps(live);
  const heard: unknown[] = [];
  const reader = await planeRuntime(kernel, deps, 'reader-ext', [], api => {
    api.events.on('project:changed', (payload: unknown) => heard.push(['changed', payload, api.project.revision()]));
    api.events.on('time', (time: number) => heard.push(['time', time]));
  });
  const blind = await planeRuntime(kernel, deps, 'blind-ext', []);
  expect(reader.init().state).toEqual({ time: 0, playing: false, revision: 1, generation: expect.any(Number), selection: { layers: ['l1'], keys: [], chan: null } });
  expect(blind.init().state.selection).toEqual({ layers: ['l1'], keys: [], chan: null });
  expect(reader.init()).not.toHaveProperty('project');
  await flushed();
  reader.ticks.length = 0; blind.ticks.length = 0;
  live.time = 1; kernel.events.emit('time', 1);
  live.time = 2; kernel.events.emit('time', 2);
  live.proj.revision = 2;
  kernel.events.emit('project:changed', { kind: 'values' });
  kernel.events.emit('project:changed', { kind: 'values' });
  kernel.events.emit('ext:reader-ext:unheard' as never, 1 as never);
  await flushed();
  expect(reader.ticks).toHaveLength(1);
  expect(JSON.parse(reader.ticks[0]!)).toEqual([{ time: 2, revision: 2, generation: expect.any(Number) }, [['time', 2], ['project:changed', { kind: 'values' }]]]);
  expect(heard).toEqual([['time', 2], ['changed', { kind: 'values' }, 2]]);
  // Nothing subscribed: the state alone, and no selection while it hasn't changed.
  expect(blind.ticks.map(tick => JSON.parse(tick)[1])).toEqual([[]]);
  expect(JSON.parse(blind.ticks[0]!)[0]).not.toHaveProperty('selection');
  kernel.events.emit('time', 2); // state unchanged, no subscriber for the blind one
  await flushed();
  expect(blind.ticks).toHaveLength(1);
  expect(reader.api.project.time()).toBe(2);
});

it('costs a playing project nothing but tiny ticks when an extension reads nothing', async () => {
  const kernel = createKernel();
  const live = { proj: syntheticProject(), time: 0, playing: true };
  await planeRuntime(kernel, planeDeps(live), 'idle-ext', []);
  await flushed();
  const stats = sandboxStats();
  const builds = stats.snapshotBuilds, ticks = stats.ticks;
  let hostMs = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const start = performance.now();
    live.time = frame / 60; kernel.events.emit('time', live.time);
    await Promise.resolve(); // the flush runs as the microtask queued first
    hostMs += performance.now() - start;
  }
  await flushed();
  expect(stats.snapshotBuilds - builds).toBe(0);
  expect(stats.ticks - ticks).toBe(120);
  console.info(`[bench] playback, idle extension on a ${(JSON.stringify(live.proj).length / 1e6).toFixed(2)} MB project: ${(hostMs / 120 * 1000).toFixed(1)} µs host time per frame, 0 snapshot builds`);
});

it('sends small ticks during playback and builds one snapshot for three extensions reading after a change', async () => {
  const kernel = createKernel();
  const live = { proj: syntheticProject(), time: 0, playing: true };
  const deps = planeDeps(live);
  const docs = await Promise.all(['one-ext', 'two-ext', 'three-ext'].map(id => planeRuntime(kernel, deps, id, id === 'two-ext' ? ['project:write'] : [])));
  for (let frame = 1; frame <= 120; frame++) { live.time = frame / 60; kernel.events.emit('time', live.time); await Promise.resolve(); }
  for (let wait = 0; wait < 100 && docs.some(doc => doc.ticks.length < 120); wait++) await new Promise(resolve => setTimeout(resolve, 10));
  for (const doc of docs) {
    expect(doc.ticks.length).toBeGreaterThanOrEqual(120);
    expect(Math.max(...doc.ticks.map(tick => tick.length))).toBeLessThan(200);
  }
  const stats = sandboxStats();
  const first = await Promise.all(docs.map(doc => doc.api.project.get()));
  const builds = stats.snapshotBuilds;
  live.proj.revision += 1;
  live.proj.layers[0].name = 'Renamed';
  kernel.events.emit('project:changed', { kind: 'values' });
  await until(() => docs.every(doc => doc.api.project.revision() === live.proj.revision));
  const second = await Promise.all(docs.map(doc => doc.api.project.get()));
  expect(stats.snapshotBuilds - builds).toBe(1);
  expect(second.map(project => project.layers[0].name)).toEqual(['Renamed', 'Renamed', 'Renamed']);
  expect(second[0]).not.toBe(first[0]);
  expect(Object.isFrozen(second[1].layers[0].p)).toBe(true);
  expect(second[2]).not.toHaveProperty('edits');
  // Unchanged generation: no message, the same frozen object.
  expect(await docs[0]!.api.project.get()).toBe(second[0]);
  expect(stats.snapshotBuilds - builds).toBe(1);
});

it('sends each document one full copy per generation, however often it asks', async () => {
  const kernel = createKernel();
  const live = { proj: { revision: 1, layers: [{ id: 'a' }] } as Record<string, any>, time: 0, playing: false };
  const deps = planeDeps(live);
  const reader = await planeRuntime(kernel, deps, 'reader-ext', []);
  const other = await planeRuntime(kernel, deps, 'other-ext', []);
  const project = await reader.api.project.get();
  const generation = reader.init().state.generation;
  // A patched shim asking straight on its port gets no second copy of the generation it holds.
  const asked = await Promise.all(Array.from({ length: 20 }, () => reader.rpc.call('project-snapshot')));
  expect(asked).toEqual(Array(20).fill({ generation, unchanged: true }));
  expect(await reader.api.project.get()).toBe(project);
  // Another document at the same generation still gets its own full copy, once.
  expect(await other.rpc.call('project-snapshot')).toEqual({ generation, json: JSON.stringify({ revision: 1, layers: [{ id: 'a' }] }) });
  expect(await other.rpc.call('project-snapshot')).toEqual({ generation, unchanged: true });
  live.proj.layers[0].id = 'b';
  reader.ticks.length = 0;
  kernel.events.emit('project:changed', { kind: 'values' });
  await until(() => reader.ticks.some(tick => tick.includes('"generation"')));
  const next = await reader.api.project.get();
  expect(next).toEqual({ revision: 1, layers: [{ id: 'b' }] });
  expect(await reader.rpc.call('project-snapshot')).toEqual({ generation: generation + 1, unchanged: true });
  expect(await reader.api.project.get()).toBe(next);
});

it('copies and stringifies the selection once per change for every document, and not at all on a time-only frame', async () => {
  const kernel = createKernel();
  const selection = { layers: Array.from({ length: 540 }, (_, index) => `L${index}`), keys: Array.from({ length: 4000 }, (_, index) => `k${index}`), chan: null as string | null };
  const live = { proj: { revision: 1, layers: [] } as Record<string, any>, time: 0, playing: true, selection };
  const deps = planeDeps(live);
  const read = deps.project.selection as unknown as ReturnType<typeof vi.fn>;
  const heard: string[][] = [];
  const docs = await Promise.all(['one-ext', 'two-ext'].map(id => planeRuntime(kernel, deps, id, [], api => {
    api.events.on('selection', () => heard.push(api.project.selection().layers));
  })));
  await flushed();
  const stats = sandboxStats();
  read.mockClear();
  const builds = stats.selectionBuilds;
  let hostMs = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const start = performance.now();
    live.time = frame / 60; kernel.events.emit('time', live.time);
    await Promise.resolve();
    hostMs += performance.now() - start;
  }
  await flushed();
  expect(read).not.toHaveBeenCalled();
  expect(stats.selectionBuilds - builds).toBe(0);
  // One change, one copy, shared by both documents.
  live.selection = { layers: ['L7'], keys: [], chan: 'opacity' };
  kernel.events.emit('selection', deps.project.selection());
  read.mockClear();
  await until(() => heard.length === 2);
  expect(read).toHaveBeenCalledTimes(1);
  expect(stats.selectionBuilds - builds).toBe(1);
  expect(docs.map(doc => doc.api.project.selection())).toEqual([live.selection, live.selection]);
  expect(heard).toEqual([['L7'], ['L7']]);
  // A new revision or a replaced project is read again even without an event.
  live.proj.revision = 2; kernel.events.emit('time', 3);
  await flushed();
  live.proj = { revision: 2, layers: [] }; kernel.events.emit('time', 4);
  await flushed();
  expect(stats.selectionBuilds - builds).toBe(3);
  console.info(`[bench] playback, two readers, ${JSON.stringify(selection).length} character selection: ${(hostMs / 120 * 1000).toFixed(1)} µs host time per frame, 0 selection copies`);
});

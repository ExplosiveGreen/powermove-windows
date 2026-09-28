// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { createRpc } from '../../shared/sandbox-rpc';
import { createSandboxAPI, ProjectReadPermissionError, sandboxControl, type SandboxInit, type SandboxSnapshot } from './shim-api';

const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); });
const settle = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function harness(permissions: string[] = ['project:read'], apiVersion = 3, kernel: Record<string, (...args: any[]) => unknown> = {}) {
  const channel = new MessageChannel();
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string, fn: (...args: any[]) => unknown = () => undefined) => (...args: unknown[]) => { calls.push([name, ...args]); return fn(...args); };
  const host = createRpc(channel.port2, {
    register: record('register'), 'dispose-registration': record('dispose-registration'), 'runtime-error': record('runtime-error'),
    'sandbox-report': record('sandbox-report'), ...Object.fromEntries(Object.entries(kernel).map(([name, fn]) => [name, record(name, fn)]))
  });
  const rpc = createRpc(channel.port1, {}, 1000, { trusted: true, maxHandles: 1 });
  close.push(() => { rpc.close(); host.close(); });
  const init = { id: 'shim-ext', apiVersion, manifest: { id: 'shim-ext', name: 'Shim', version: '1.0.0', apiVersion, permissions }, vars: {},
    theme: { scheme: 'dark', tokens: {} }, bundleUrl: '', state: { time: 1, playing: false, revision: 5, generation: 1, selection: { layers: ['a'], keys: [], chan: null } } } as unknown as SandboxInit;
  const api = createSandboxAPI(rpc, init) as any;
  return { api, control: sandboxControl(api), calls, count: (name: string) => calls.filter(call => call[0] === name).length };
}

it('reads state synchronously and applies tick deltas before dispatching events', async () => {
  const { api, control } = harness();
  expect([api.project.time(), api.project.playing(), api.project.revision(), api.transport.time()]).toEqual([1, false, 5, 1]);
  expect(Object.isFrozen(api.project.selection().layers)).toBe(true);
  const seen: unknown[] = [];
  api.events.on('project:changed', (payload: unknown) => seen.push([payload, api.project.revision()]));
  control.tick({ time: 2, playing: true, revision: 6, selection: { layers: [], keys: [], chan: null } }, [['project:changed', { kind: 'values' }], ['other', 1]]);
  expect([api.project.time(), api.transport.playing(), api.project.selection().layers]).toEqual([2, true, []]);
  expect(seen).toEqual([[{ kind: 'values' }, 6]]);
});

it('keeps listeners local, registering interest once per name and withdrawing it with the last listener', async () => {
  const { api, control, calls, count } = harness();
  const order: string[] = [];
  const first = api.events.on('project:changed', () => order.push('first'));
  const second = api.events.on('project:changed', () => { order.push('second'); throw new Error('listener boom'); });
  const third = api.events.on('time', () => order.push('time'));
  api.events.on('custom', () => {}); // no callback handle crosses, so the one-handle quota is untouched
  await settle();
  expect(calls.filter(call => call[0] === 'register').map(call => [call[1], call[3]]))
    .toEqual([['events', { event: 'project:changed' }], ['events', { event: 'time' }], ['events', { event: 'custom' }]]);
  control.tick({}, [['time', 3], ['project:changed', { kind: 'structure' }]]);
  expect(order).toEqual(['time', 'first', 'second']);
  await settle();
  expect(calls.find(call => call[0] === 'runtime-error')?.[1]).toMatchObject({ message: 'listener boom' });
  first.dispose(); third.dispose();
  await settle();
  expect(count('dispose-registration')).toBe(1);
  second.dispose(); second.dispose();
  await settle();
  expect(count('dispose-registration')).toBe(2);
  control.tick({}, [['project:changed', { kind: 'values' }]]);
  expect(order).toHaveLength(3);
});

it('pulls the project once per generation, shares one call in flight, and freezes it', async () => {
  let generation = 1;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { api, control, count } = harness(['project:write'], 3, {
    'project-snapshot': async (): Promise<SandboxSnapshot> => { await gate; return { generation, json: JSON.stringify({ revision: generation, layers: [{ id: 'a' }] }) }; }
  });
  const reads = [api.project.get(), api.project.get(), api.project.get()];
  await settle();
  release();
  const [one, two, three] = await Promise.all(reads);
  expect(one).toBe(two); expect(two).toBe(three);
  expect(count('project-snapshot')).toBe(1);
  expect(Object.isFrozen(one.layers[0])).toBe(true);
  expect(await api.project.get()).toBe(one);
  expect(count('project-snapshot')).toBe(1);
  generation = 2;
  control.tick({ generation: 2 }, []);
  const next = await api.project.get();
  expect(next.revision).toBe(2);
  expect(count('project-snapshot')).toBe(2);
});

it('asks again when the reply predates the generation the document already heard about', async () => {
  let replies = 0;
  const { api, control, count } = harness(['project:read'], 3, {
    'project-snapshot': (): SandboxSnapshot => ({ generation: ++replies < 2 ? 1 : 3, json: JSON.stringify({ replies }) })
  });
  control.tick({ generation: 3 }, []);
  expect(await api.project.get()).toEqual({ replies: 2 });
  expect(count('project-snapshot')).toBe(2);
});

it('rejects project.get clearly when the snapshot is too large', async () => {
  const { api } = harness(['project:read'], 3, { 'project-snapshot': (): SandboxSnapshot => ({ generation: 1, tooLarge: true }) });
  await expect(api.project.get()).rejects.toThrow('8 Mi character');
});

it('gates project reads on project:read and reports each member, leaving time and transport open', async () => {
  const { api, calls } = harness([]);
  await expect(api.project.get()).rejects.toBeInstanceOf(ProjectReadPermissionError);
  await expect(api.project.get()).rejects.toMatchObject({ name: 'PermissionError', code: 'project:read', message: 'project.get requires project:read permission. Declare "project:read" in the manifest\'s permissions.' });
  expect(() => api.project.selection()).toThrow('project:read');
  expect(() => api.events.on('project:changed', () => {})).toThrow(ProjectReadPermissionError);
  expect(() => api.events.on('selection', () => {})).toThrow('project:read');
  expect(api.project.time()).toBe(1);
  expect(api.project.revision()).toBe(5);
  api.events.on('time', () => {});
  api.events.on('transport', () => {});
  await settle();
  expect(calls.filter(call => call[0] === 'sandbox-report').map(call => (call[1] as { member: string }).member))
    .toEqual(['project.get', 'project.get', 'project.selection', "events.on('project:changed')", "events.on('selection')"]);
  expect(calls.filter(call => call[0] === 'register')).toHaveLength(2);
});

it('drops a pushed selection without read access', () => {
  const { control, api } = harness([]);
  control.tick({ selection: { layers: ['secret'], keys: [], chan: null } }, []);
  expect(() => api.project.selection()).toThrow('project:read');
});

it('reports a synchronous read of an async result from apiVersion 2 code', async () => {
  const { api, calls } = harness([], 2, { invoke: () => ({ layers: [] }) });
  const result = api.storage.get('layout');
  expect(result.layers).toBeUndefined();
  await expect(result).resolves.toEqual({ layers: [] });
  await settle();
  expect(calls.filter(call => call[0] === 'sandbox-report').map(call => call[1])).toEqual([{ kind: 'async', member: 'storage.get' }]);
});

it('keeps project reads from apiVersion 2 code, and says to set apiVersion 3 and declare project:read', async () => {
  // A legacy manifest can't declare permissions; one that claims project:read anyway is not trusted with it.
  const { api, calls } = harness(['project:read'], 2, { 'project-snapshot': (): SandboxSnapshot => ({ generation: 1, json: '{"layers":[]}' }) });
  const hint = 'requires project:read permission. Set "apiVersion": 3 and declare "project:read" in the manifest\'s permissions.';
  await expect(api.project.get()).rejects.toThrow(`project.get ${hint}`);
  expect(() => api.project.selection()).toThrow(`project.selection ${hint}`);
  expect(() => api.events.on('selection', () => {})).toThrow(`events.on('selection') ${hint}`);
  await expect(api.project.snapshot()).rejects.toThrow(`project.snapshot ${hint}`);
  await settle();
  expect(calls.filter(call => call[0] === 'project-snapshot')).toEqual([]);
  expect(calls.filter(call => call[0] === 'sandbox-report').map(call => (call[1] as { kind: string }).kind)).toEqual(['permission', 'permission', 'permission', 'permission']);
});

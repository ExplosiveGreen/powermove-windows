// @vitest-environment happy-dom
/* Sandboxed palette providers, context-menu contributions and command `when`
   answer over a real port here (the shim on one end, the sandbox host on the
   other), so these tests see the round trip the app sees. */
import { afterEach, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxAPI, sandboxControl, type SandboxEvent } from '../../sandbox/shim-api';
import { createSandboxRuntime } from './sandbox-host';
import { createKernel, MENU_DEADLINE_MS } from './registries';
import type { HostDeps } from './host';
import type { ExtensionRecord, MenuContribution, ProjectAPI } from './api';

const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); document.body.replaceChildren(); vi.useRealTimers(); });

function deps(): HostDeps {
  const project = { get: () => ({ revision: 1, layers: [] }), revision: () => 1, selection: () => ({ layers: [], keys: [], chan: null }), time: () => 0, playing: () => false,
    apply: vi.fn(), select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
  return { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: async () => ({ id: 'x', name: 'x', kind: 'image' }), get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: async () => {}, remove: async () => {}, reload: async () => {}, reveal: async () => {}, requestFix: vi.fn(), rebase: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
}

/** One Store extension running `activate` in a real shim on the far end of a MessageChannel. */
async function sandboxed(activate: (api: any) => void, id = 'menu-ext') {
  const kernel = createKernel();
  const record = { id, trust: 'store', scope: 'user', manifest: { id, name: id, version: '1.0.0', apiVersion: 3, permissions: [] }, dir: `/tmp/${id}`, enabled: true,
    bundleUrl: `/ext/${id}/bundle.js`, bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as unknown as ExtensionRecord;
  const frame = document.createElement('iframe');
  const pending = createSandboxRuntime(kernel, record, deps(), {}, { frame, onPostInit(port, init) {
    let control: ReturnType<typeof sandboxControl> | undefined;
    const child = createRpc(port, { tick: (delta: unknown, events: SandboxEvent[]) => control?.tick(delta as never, events) }, 10_000, { trusted: true });
    close.push(() => child.close());
    const api = createSandboxAPI(child, init);
    control = sandboxControl(api);
    activate(api);
    child.notify('activated');
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => runtime.dispose());
  return kernel;
}

const label = (item: MenuContribution): string => item === '-' ? item : 'header' in item ? item.header : item.label;
const run = async (items: MenuContribution[], name: string): Promise<unknown> => {
  const item = items.find(entry => entry !== '-' && 'label' in entry && entry.label === name);
  if (!item || item === '-' || !('run' in item) || !item.run) throw new Error(`no ${name} in ${items.map(label).join(', ')}`);
  return item.run();
};

it('asks a sandboxed context menu afresh per open, so right-clicking layer B never runs the action built for layer A', async () => {
  const ran: string[] = [];
  const kernel = await sandboxed(api => {
    api.menus.contribute('layer:context', (ctx: { layerId: string }) => [{ label: `Tag ${ctx.layerId}`, run: () => { ran.push(ctx.layerId); } }]);
  });

  // The first open already has the items, for its own layer.
  const onA = await kernel.gatherMenu('layer:context', { layerId: 'A' });
  expect(onA.map(label)).toEqual(['Tag A']);
  const onB = await kernel.gatherMenu('layer:context', { layerId: 'B' });
  expect(onB.map(label)).toEqual(['Tag B']);
  await run(onB, 'Tag B');
  expect(ran).toEqual(['B']);
  // A's items, asked for before, still act on A alone.
  await run(onA, 'Tag A');
  expect(ran).toEqual(['B', 'A']);
});

it('opens a sandboxed menu without an answer that misses the deadline, and the late one never reaches the next open', async () => {
  const ran: string[] = [];
  let answerA!: () => void;
  const kernel = await sandboxed(api => {
    api.menus.contribute('layer:context', async (ctx: { layerId: string }) => {
      if (ctx.layerId === 'A') await new Promise<void>(resolve => { answerA = resolve; });
      return [{ label: `Tag ${ctx.layerId}`, run: () => { ran.push(ctx.layerId); } }];
    });
  });
  const started = performance.now();
  expect(await kernel.gatherMenu('layer:context', { layerId: 'A' })).toEqual([]);
  expect(performance.now() - started).toBeGreaterThanOrEqual(MENU_DEADLINE_MS - 5);
  const onB = kernel.gatherMenu('layer:context', { layerId: 'B' });
  answerA();
  const items = await onB;
  expect(items.map(label)).toEqual(['Tag B']);
  await run(items, 'Tag B');
  expect(ran).toEqual(['B']);
});

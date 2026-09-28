// @vitest-environment happy-dom
/* Sandboxed palette providers, context-menu contributions and command `when`
   answer over a real port here (the shim on one end, the sandbox host on the
   other), so these tests see the round trip the app sees. */
import { afterEach, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxAPI, sandboxControl, type SandboxEvent } from '../../sandbox/shim-api';
import { createSandboxRuntime, freshWhen, WHEN_DEADLINE_MS } from './sandbox-host';
import { createKernel, MENU_DEADLINE_MS, whenCheck } from './registries';
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

it('answers a sandboxed palette provider for the query asked, the first one included', async () => {
  const ran: string[] = [];
  const kernel = await sandboxed(api => {
    api.palette.registerProvider(async (query: string) => [{ id: `menu-ext.find-${query}`, label: `Find ${query}`, category: 'Find', run: () => { ran.push(query); } }]);
  });
  const provider = kernel.paletteProviders()[0]!.provider;
  const first = await provider('alpha');
  expect(first.map(entry => entry.label)).toEqual(['Find alpha']);
  const second = await provider('beta');
  expect(second.map(entry => entry.label)).toEqual(['Find beta']);
  await second[0]!.run();
  await first[0]!.run();
  expect(ran).toEqual(['beta', 'alpha']);
});

/* A controllable answer per key: `answer(key)` settles the one asked for it. */
function gates() {
  const open = new Map<string, () => void>();
  return {
    wait: (key: string) => new Promise<void>(resolve => open.set(key, resolve)),
    answer: async (key: string) => { open.get(key)!(); await new Promise(resolve => setTimeout(resolve, 5)); }
  };
}

it('keeps the handles of the newest palette query however the replies land', async () => {
  const ran: string[] = [];
  const gate = gates();
  const kernel = await sandboxed(api => {
    api.palette.registerProvider(async (query: string) => {
      await gate.wait(query);
      return [{ id: `menu-ext.${query}`, label: query, category: 'Find', run: () => { ran.push(query); } }];
    });
  });
  const provider = kernel.paletteProviders()[0]!.provider;
  // Typed a, ab, abc; abc answers first, then the slower ab and a.
  const [a, ab, abc] = ['a', 'ab', 'abc'].map(query => provider(query) as Promise<Array<{ run(): unknown }>>);
  await new Promise(resolve => setTimeout(resolve, 5));
  await gate.answer('abc');
  await gate.answer('ab');
  await gate.answer('a');
  const shown = await abc;
  await shown[0]!.run(); // the palette shows abc's rows
  expect(ran).toEqual(['abc']);
  expect(await a).toEqual([]); // two newer queries already answered: nothing to run
  expect((await ab).map(entry => (entry as { label: string }).label)).toEqual(['ab']);
});

it('keeps the handles of the newest menu open however the replies land', async () => {
  const ran: string[] = [];
  const gate = gates();
  const kernel = await sandboxed(api => {
    api.menus.contribute('layer:context', async (ctx: { layerId: string }) => {
      await gate.wait(ctx.layerId);
      return [{ label: `Tag ${ctx.layerId}`, run: () => { ran.push(ctx.layerId); } }];
    });
  });
  const opens = ['A', 'B', 'C'].map(layerId => kernel.gatherMenu('layer:context', { layerId }, 1000) as Promise<MenuContribution[]>);
  await new Promise(resolve => setTimeout(resolve, 5));
  await gate.answer('C');
  await gate.answer('A');
  await gate.answer('B');
  const [, onB, onC] = await Promise.all(opens);
  await run(onC!, 'Tag C');
  await run(onB!, 'Tag B');
  expect(ran).toEqual(['C', 'B']);
});

it('never asks a sandboxed contributor for the synchronous collectMenu, so an open menu keeps its items', async () => {
  const ran: string[] = [];
  let asked = 0;
  const kernel = await sandboxed(api => {
    api.menus.contribute('layer:context', (ctx: { layerId: string }) => { asked += 1; return [{ label: `Tag ${ctx.layerId}`, run: () => { ran.push(ctx.layerId); } }]; });
  });
  const open = await kernel.gatherMenu('layer:context', { layerId: 'A' });
  kernel.contributeMenu('in-realm', 'layer:context', () => [{ label: 'Trusted' }]);
  for (let index = 0; index < 3; index++) expect(kernel.collectMenu('layer:context', { layerId: 'B' }).map(label)).toEqual(['Trusted']);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(asked).toBe(1);
  await run(open, 'Tag A');
  expect(ran).toEqual(['A']);
});

it('asks a sandboxed when() afresh on every check', async () => {
  const kernel = await sandboxed(api => {
    let enabled = true;
    api.commands.register({ id: 'menu-ext.go', label: 'Go', run: () => {}, when: () => enabled });
    api.commands.register({ id: 'menu-ext.toggle', label: 'Toggle', run: () => { enabled = !enabled; } });
  });
  const check = whenCheck(kernel.commands.get('menu-ext.go'))!;
  expect(await check.ask()).toBe(true);
  await kernel.commands.get('menu-ext.toggle')!.run();
  expect(await check.ask()).toBe(false);
  await kernel.commands.get('menu-ext.toggle')!.run();
  expect(await check.ask()).toBe(true);
});

it('keeps a sandboxed when() synchronous for in-realm readers, answering with the last reply', async () => {
  let enabled = false;
  const kernel = await sandboxed(api => {
    api.commands.register({ id: 'menu-ext.go', label: 'Go', run: () => {}, when: async () => enabled });
    api.commands.register({ id: 'menu-ext.toggle', label: 'Toggle', run: () => { enabled = !enabled; } });
  });
  const shown = () => kernel.commands.list().filter(command => !command.when || command.when()).map(command => command.id);
  const go = kernel.commands.get('menu-ext.go')!;
  expect(go.when!()).toBe(true); // nothing answered yet
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(shown()).toEqual(['menu-ext.toggle']);
  expect(whenCheck(go)!.last()).toBe(false);
  await kernel.commands.get('menu-ext.toggle')!.run();
  expect(shown()).toEqual(['menu-ext.toggle']); // the last answer, while the next one is asked
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(shown()).toEqual(['menu-ext.go', 'menu-ext.toggle']);
});

it('falls back to the last when() answer only when the fresh one is late', async () => {
  vi.useFakeTimers();
  const replies: Array<(value: unknown) => void> = [];
  const rpc = { invokeHandle: vi.fn(() => new Promise(resolve => replies.push(resolve))) } as unknown as ReturnType<typeof createRpc>;
  const when = freshWhen(rpc, 3);
  const seen: boolean[] = [];

  void when().then(value => seen.push(value));
  await vi.advanceTimersByTimeAsync(WHEN_DEADLINE_MS);
  expect(seen).toEqual([true]); // late, and nothing answered yet
  replies[0]!(false); // the late answer still becomes the last one
  await vi.advanceTimersByTimeAsync(0);

  void when().then(value => seen.push(value));
  replies[1]!(true); // in time: the fresh answer, not the last
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual([true, true]);

  void when().then(value => seen.push(value)); // a slow check, answered after a newer one
  void when().then(value => seen.push(value));
  replies[3]!(false);
  await vi.advanceTimersByTimeAsync(0);
  replies[2]!(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual([true, true, false, true]);
  void when().then(value => seen.push(value));
  await vi.advanceTimersByTimeAsync(WHEN_DEADLINE_MS);
  expect(seen.at(-1)).toBe(false); // the newer check's answer stands as the last one
  expect(rpc.invokeHandle).toHaveBeenCalledTimes(5);
});

// @vitest-environment happy-dom
/* Activation and liveness of a sandboxed runtime (docs/sandbox-data-plane.md §2). */
import { afterEach, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import type { PowermoveBridge } from '../../../shared/ipc';
import { createSandboxRuntime, type SandboxRuntimeOptions } from './sandbox-host';
import { installBridgeForTests, resetBridgeForTests } from './bridge';
import { createKernel } from './registries';
import type { HostDeps } from './host';
import type { ExtensionRecord, ProjectAPI } from './api';

const close: Array<() => void> = [];
afterEach(() => {
  for (const fn of close.splice(0)) fn();
  document.body.replaceChildren();
  resetBridgeForTests();
  vi.restoreAllMocks();
});

const project = { get: () => ({}), revision: () => 1, selection: () => ({ layers: [], keys: [], chan: null }), time: () => 0, playing: () => false,
  apply: vi.fn(), select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
const deps = (): HostDeps => ({ pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
  ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
  assets: { pick: async () => [], import: async () => ({ id: 'x', name: 'x', kind: 'image' }), get: () => undefined, readText: async () => '' },
  storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  extensions: { list: () => [], setEnabled: vi.fn(), remove: vi.fn(), reload: vi.fn(), reveal: vi.fn(), requestFix: vi.fn(), rebase: vi.fn() },
  panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
} as unknown as HostDeps);
const record = { id: 'live-ext', trust: 'store', scope: 'user', manifest: { id: 'live-ext', name: 'Live', version: '1.0.0', apiVersion: 3, permissions: [] },
  dir: '/tmp/live', enabled: true, bundleUrl: '/ext/live-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;

/** Runs as the Electron app, where each extension has its own process, or as the browser host. */
function host(kind: 'electron' | 'browser'): { terminate: ReturnType<typeof vi.fn> } {
  const terminate = vi.fn(async () => 1);
  if (kind === 'electron') {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/140.0 Electron/40.0.0');
    installBridgeForTests({ sandboxTerminate: terminate } as unknown as PowermoveBridge);
  } else installBridgeForTests({} as unknown as PowermoveBridge);
  return { terminate };
}

/** A runtime document behind a real MessageChannel. `ping` answers the kernel's pings; `activate` settles activation. */
function runtimeDoc(options: { ping?: () => unknown; activate?: (child: ReturnType<typeof createRpc>) => void } = {}) {
  const pings: number[] = [];
  const frame = document.createElement('iframe');
  const test: SandboxRuntimeOptions = { frame, onPostInit(port) {
    const child = createRpc(port, { ping: () => { pings.push(performance.now()); return (options.ping ?? (() => true))(); } });
    close.push(() => child.close());
    (options.activate ?? (rpc => rpc.notify('activated')))(child);
  } };
  return { frame, test, pings };
}
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

it('watches an extension that has its own process', async () => {
  host('electron');
  const doc = runtimeDoc();
  const pending = createSandboxRuntime(createKernel(), record, deps(), {}, doc.test);
  doc.frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => runtime.dispose());
  await wait(20);
  expect(doc.pings.length).toBe(2); // the boot ping, then the watchdog's first
});

it('runs no watchdog where sandboxes share one process or cannot be terminated', async () => {
  for (const kind of ['browser', 'no-terminate'] as const) {
    if (kind === 'browser') host('browser');
    else { vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Electron/40.0.0'); installBridgeForTests({} as unknown as PowermoveBridge); }
    const doc = runtimeDoc();
    const pending = createSandboxRuntime(createKernel(), record, deps(), {}, doc.test);
    doc.frame.dispatchEvent(new Event('load'));
    const runtime = await pending;
    await wait(20);
    expect(doc.pings).toHaveLength(1); // the boot ping alone
    runtime.dispose();
    vi.restoreAllMocks();
  }
});

/** Settles the activation of `doc` and reports how, and how long it took. */
async function activation(doc: ReturnType<typeof runtimeDoc>, hostDeps: HostDeps, timeoutMs: number) {
  const started = performance.now();
  const pending = createSandboxRuntime(createKernel(), record, hostDeps, {}, { ...doc.test, timeoutMs });
  doc.frame.dispatchEvent(new Event('load'));
  const error = await pending.then(runtime => { runtime.dispose(); return null; }, (failure: Error & { code?: string }) => failure);
  return { error, elapsed: performance.now() - started };
}
/** Boots (answers the first ping, as the shim does before importing the bundle), then spins in activate. */
function spins() {
  let pings = 0;
  return { ping: () => (++pings === 1 ? true : new Promise(() => {})), activate: () => {} };
}

it('rejects a runtime that spins while activating as sandbox_fatal, killed, within the budget', async () => {
  const { terminate } = host('electron');
  const hostDeps = deps();
  const { error, elapsed } = await activation(runtimeDoc(spins()), hostDeps, 400);
  expect(error).toMatchObject({ message: 'stopped responding while activating', code: 'sandbox_fatal' });
  expect(terminate).toHaveBeenCalledWith('live-ext');
  // The caller reports it; the sandbox does not report it a second time.
  expect(hostDeps.reportRuntimeError).not.toHaveBeenCalled();
  expect(elapsed).toBeGreaterThanOrEqual(390);
  expect(elapsed).toBeLessThan(400 + 150);
});

it('a timeout where sandboxes share a process is a plain activation error', async () => {
  const { terminate } = host('browser');
  const hostDeps = deps();
  const { error } = await activation(runtimeDoc(spins()), hostDeps, 200);
  expect(error?.message).toBe('Sandbox document or activation timed out');
  expect(error?.code).toBeUndefined();
  expect(terminate).not.toHaveBeenCalled();
  expect(hostDeps.reportRuntimeError).not.toHaveBeenCalled();
});

it('a runtime that never booted is a plain activation error, not spinning', async () => {
  const { terminate } = host('electron');
  const cases = {
    // The document never loaded, or an error page stood in for it: nothing ever answers.
    'no runtime': { ping: () => new Promise(() => {}), activate: () => {} },
    // A document that never took init leaves its port unread.
    'no init': 'unread'
  } as const;
  for (const [name, doc] of Object.entries(cases)) {
    const hostDeps = deps();
    const frame = document.createElement('iframe');
    const runtime = doc === 'unread' ? { frame, test: { frame, onPostInit: () => {} }, pings: [] } : runtimeDoc(doc);
    const { error } = await activation(runtime as ReturnType<typeof runtimeDoc>, hostDeps, 300);
    expect({ name, message: error?.message, code: error?.code }).toEqual({ name, message: 'Sandbox document or activation timed out', code: undefined });
    expect(hostDeps.reportRuntimeError).not.toHaveBeenCalled();
  }
  expect(terminate).not.toHaveBeenCalled();
});

it('a booted runtime that still answers was only waiting: not killed', async () => {
  const { terminate } = host('electron');
  const { error } = await activation(runtimeDoc({ activate: () => {} }), deps(), 300);
  expect(error?.code).toBeUndefined();
  expect(terminate).not.toHaveBeenCalled();
});

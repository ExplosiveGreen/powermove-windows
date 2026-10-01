// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxAPI, sandboxControl, type SandboxInit } from '../../sandbox/shim-api';
import { createSandboxRuntime } from './sandbox-host';
import { createKernel } from './registries';
import type { HostDeps } from './host';
import type { ExtensionRecord, PowermoveAPI, ProjectAPI } from './api';

/* Small sandbox stubs that used to fail, each through a real port pair. */
const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const settle = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

async function start(options: { maxHandles?: number; open?: string[] } = {}) {
  const kernel = createKernel();
  const project = { get: () => ({ id: 'test' }), revision: () => 1, selection: () => null, time: () => 0, playing: () => false } as unknown as ProjectAPI;
  const toast = vi.fn();
  const dismissToast = vi.fn();
  const reportRuntimeError = vi.fn();
  const open = new Set(options.open ?? []);
  const deps = { pm: { dismissToast }, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast, confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [] },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: (id: string) => open.has(id), refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError
  } as unknown as HostDeps;
  const record = { id: 'stub-ext', trust: 'store', scope: 'user', manifest: { id: 'stub-ext', name: 'Stubs', version: '1.0.0', apiVersion: 3, permissions: [] }, dir: '/tmp/stub', enabled: true, bundleUrl: '/ext/stub-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let api!: PowermoveAPI;
  let pushes = 0;
  let child!: ReturnType<typeof createRpc>;
  const views: Array<{ init: SandboxInit; pushes: number }> = [];
  const pending = createSandboxRuntime(kernel, record, deps, {}, { frame, onPostInit(port, init) {
    child = createRpc(port, { catalog: (next: SandboxInit['catalog']) => { pushes += 1; sandboxControl(api).catalog(next); } }, 10_000, { trusted: true, maxHandles: options.maxHandles ?? 1000 });
    api = createSandboxAPI(child, init);
    child.notify('activated');
  }, onViewInit(_frame, init, ports) {
    const view = { init, pushes: 0 };
    views.push(view);
    const rpc = createRpc(ports[0]!, { catalog: () => { view.pushes += 1; } }, 10_000, { trusted: true });
    close.push(() => rpc.close());
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => { runtime.dispose(); child.close(); });
  /* A panel view on its own port, the way a docked panel mounts one. */
  const openView = async () => {
    const id = `stub-ext.panel-${views.length}`;
    await child.call('register', 'panels', crypto.randomUUID(), { id, title: 'Panel' });
    const body = document.createElement('div');
    document.body.append(body);
    const before = views.length;
    kernel.panels.get(id)!.build!(body, { spec: {} } as never);
    for (let wait = 0; wait < 50 && views.length === before; wait++) await settle(5);
    return views.at(-1)!;
  };
  return { kernel, api, toast, dismissToast, runtime, reportRuntimeError, open, pushes: () => pushes, openView };
}

type ToastCall = [string, { action?: { label: string; run: () => void }; onDismiss?: () => void; onClose?: () => void; sticky?: boolean; source?: unknown; key?: string }];

it('sends toast callbacks as handles and releases them when the toast closes', async () => {
  // Two handles fit; a leak would make the second toast throw the handle limit.
  const h = await start({ maxHandles: 2 });
  const run = vi.fn();
  const onDismiss = vi.fn();
  h.api.ui.toast('Exported', { sticky: true, dismissible: true, action: { label: 'Reveal', run }, onDismiss });
  await settle();
  expect(h.toast).toHaveBeenCalledOnce();
  const [text, options] = h.toast.mock.calls[0] as ToastCall;
  expect(text).toBe('Exported');
  expect(options).toMatchObject({ sticky: true, action: { label: 'Reveal' }, source: { id: 'stub-ext', name: 'Stubs' } });
  options.action!.run();
  options.onDismiss!();
  await settle();
  expect(run).toHaveBeenCalledOnce();
  expect(onDismiss).toHaveBeenCalledOnce();
  options.onClose!();
  options.onClose!(); // once is enough
  await settle();

  h.api.ui.toast('Again', { action: { label: 'Undo', run }, onDismiss });
  await settle();
  expect(h.toast).toHaveBeenCalledTimes(2);
  expect(h.reportRuntimeError).not.toHaveBeenCalled();
  // A closed toast's handle is gone on both sides.
  options.action!.run();
  await settle();
  expect(run).toHaveBeenCalledOnce();
});

it('dismisses the runtime’s toasts with buttons, and its keyed ones, when the extension is disposed', async () => {
  const h = await start();
  const run = vi.fn();
  h.api.ui.toast('Exported', { action: { label: 'Reveal', run } });
  h.api.ui.toast('Syncing', { key: 'sync', sticky: true });
  h.api.ui.toast('Plain');
  await settle();
  const keys = h.toast.mock.calls.map(call => (call as ToastCall)[1]?.key);
  expect(keys).toEqual([expect.stringMatching(/^sandbox:stub-ext:#/), 'sandbox:stub-ext:sync', undefined]);
  // One the person already closed is not dismissed again.
  (h.toast.mock.calls[1] as ToastCall)[1].onClose!();
  expect(h.dismissToast).not.toHaveBeenCalled();
  h.runtime.dispose();
  expect(h.dismissToast.mock.calls).toEqual([[keys[0]]]);
});

it('releases the handles of a toast the host refuses, and reports the refusal', async () => {
  const h = await start({ maxHandles: 2 });
  const run = vi.fn();
  h.api.ui.toast('Broken', { action: { label: '', run }, onDismiss: run });
  await settle();
  expect(h.toast).not.toHaveBeenCalled();
  expect(h.reportRuntimeError).toHaveBeenCalledOnce();
  h.api.ui.toast('Fine', { action: { label: 'Open', run }, onDismiss: run });
  await settle();
  expect(h.toast).toHaveBeenCalledOnce();
});

it('keeps plain toasts and drops callbacks that cannot cross', async () => {
  const h = await start();
  h.api.ui.toast('Plain');
  h.api.ui.toast('Keyed', { key: 'k', corner: 'top-right', icon: (() => 'x') as unknown as string });
  await settle();
  expect(h.toast.mock.calls.map(call => call[0])).toEqual(['Plain', 'Keyed']);
  // The key is the extension's own: it can replace its notices, never the editor's.
  expect((h.toast.mock.calls[0] as ToastCall)[1]).not.toHaveProperty('key');
  expect((h.toast.mock.calls[1] as ToastCall)[1]).toMatchObject({ key: 'sandbox:stub-ext:k', corner: 'top-right' });
  expect((h.toast.mock.calls[1] as ToastCall)[1]).not.toHaveProperty('icon');
  expect(h.reportRuntimeError).not.toHaveBeenCalled();
});

it('answers panels.isOpen for the extension’s own panels only', async () => {
  const h = await start({ open: ['stub-ext.panel', 'layers'] });
  await expect(h.api.panels.isOpen('stub-ext.panel')).resolves.toBe(true);
  await expect(h.api.panels.isOpen('stub-ext.other')).resolves.toBe(false);
  // Asking about an app/other-extension panel is relocated to this extension's own
  // namespace ('stub-ext.layers'), so it never leaks that the host's 'layers' panel is open.
  await expect(h.api.panels.isOpen('layers')).resolves.toBe(false);
  h.open.delete('stub-ext.panel');
  await expect(h.api.panels.isOpen('stub-ext.panel')).resolves.toBe(false);
});

it('refreshes the catalog when other extensions load or unload, and only when it changed', async () => {
  const h = await start();
  const fx = { id: 'other-ext.glow', label: 'Glow', group: 'Other', params: [], frag: 'o = texture(u_tex, v_uv);' };
  expect(h.api.effects.get('other-ext.glow')).toBeUndefined();
  const effect = h.kernel.registerEffect('other-ext', fx);
  h.kernel.commands.register('other-ext', { id: 'other-ext.go', label: 'Go', run: () => {} });
  h.kernel.events.emit('extension:loaded', { id: 'other-ext' });
  h.kernel.events.emit('extensions:changed', { ids: ['other-ext'], reason: 'enable' }); // same burst: one push
  await settle();
  expect(h.pushes()).toBe(1);
  expect(h.api.effects.get('other-ext.glow')?.label).toBe('Glow');
  expect(h.api.commands.has('other-ext.go')).toBe(true);
  expect(h.api.commands.list().find(command => command.id === 'other-ext.go')).not.toHaveProperty('run');

  h.kernel.events.emit('extensions:changed', { ids: [], reason: 'health' });
  await settle();
  expect(h.pushes()).toBe(1); // nothing changed, nothing sent

  effect.dispose();
  h.kernel.disposeOwner('other-ext');
  h.kernel.events.emit('extension:unloaded', { id: 'other-ext' });
  await settle();
  expect(h.pushes()).toBe(2);
  expect(h.api.effects.get('other-ext.glow')).toBeUndefined();
  expect(h.api.commands.has('other-ext.go')).toBe(false);
});

it('sends each document the catalog it lacks, even after a view mounted with the newer one', async () => {
  const h = await start();
  // Another extension loads; before the refresh runs, a view mounts and gets the new catalog in its init.
  h.kernel.commands.register('other-ext', { id: 'other-ext.go', label: 'Go', run: () => {} });
  const view = await h.openView();
  expect(view.init.catalog?.commands?.some(command => command.id === 'other-ext.go')).toBe(true);
  h.kernel.events.emit('extension:loaded', { id: 'other-ext' });
  await settle();
  expect(h.pushes()).toBe(1);
  expect(h.api.commands.has('other-ext.go')).toBe(true);
  expect(view.pushes).toBe(0); // it already has this one
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxAPI } from '../../sandbox/shim-api';
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
  const reportRuntimeError = vi.fn();
  const open = new Set(options.open ?? []);
  const deps = { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast, confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [] },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: (id: string) => open.has(id), refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError
  } as unknown as HostDeps;
  const record = { id: 'stub-ext', trust: 'store', scope: 'user', manifest: { id: 'stub-ext', name: 'Stubs', version: '1.0.0', apiVersion: 3, permissions: [] }, dir: '/tmp/stub', enabled: true, bundleUrl: '/ext/stub-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let api!: PowermoveAPI;
  let child!: ReturnType<typeof createRpc>;
  const pending = createSandboxRuntime(kernel, record, deps, {}, { frame, onPostInit(port, init) {
    child = createRpc(port, {}, 10_000, { trusted: true, maxHandles: options.maxHandles ?? 1000 });
    api = createSandboxAPI(child, init);
    child.notify('activated');
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => { runtime.dispose(); child.close(); });
  return { kernel, api, toast, reportRuntimeError, open };
}

type ToastCall = [string, { action?: { label: string; run: () => void }; onDismiss?: () => void; onClose?: () => void; sticky?: boolean; source?: unknown }];

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
  expect((h.toast.mock.calls[1] as ToastCall)[1]).toMatchObject({ key: 'k', corner: 'top-right' });
  expect((h.toast.mock.calls[1] as ToastCall)[1]).not.toHaveProperty('icon');
  expect(h.reportRuntimeError).not.toHaveBeenCalled();
});

it('answers panels.isOpen for the extension’s own panels only', async () => {
  const h = await start({ open: ['stub-ext.panel', 'layers'] });
  await expect(h.api.panels.isOpen('stub-ext.panel')).resolves.toBe(true);
  await expect(h.api.panels.isOpen('stub-ext.other')).resolves.toBe(false);
  // Whether an app or another extension's panel is open is not this extension's to ask.
  await expect(h.api.panels.isOpen('layers') as unknown as Promise<boolean>).rejects.toMatchObject({ code: 'permission_denied' });
  h.open.delete('stub-ext.panel');
  await expect(h.api.panels.isOpen('stub-ext.panel')).resolves.toBe(false);
});

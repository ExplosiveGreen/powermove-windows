// @vitest-environment happy-dom
/* ui.openExternal and assets.importUrl end to end: the sandbox shim, a real
   MessageChannel, the host's invoke policy, and the in-realm implementation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import type { PowermoveBridge } from '../../../shared/ipc';
import { createSandboxAPI } from '../../sandbox/shim-api';
import { createSandboxRuntime } from './sandbox-host';
import { createKernel } from './registries';
import { installBridgeForTests, resetBridgeForTests } from './bridge';
import { installKernel, type InstalledKernel } from './install';
import { resetExtensionsStore } from './extensions.svelte';
import { RUNTIME_GLOBAL } from './runtime-globals';
import { fakePM } from './__fixtures__/fake-pm';
import type { HostDeps } from './host';
import type { ExtensionPermission } from '../../../shared/extensions';
import type { ExtensionRecord, ProjectAPI, PowermoveAPI } from './api';

const close: Array<() => void> = [];
let installed: InstalledKernel | null = null;
afterEach(() => {
  for (const fn of close.splice(0)) fn();
  installed?.uninstall(); installed = null;
  delete (globalThis as Record<string, unknown>)[RUNTIME_GLOBAL];
  resetExtensionsStore();
  resetBridgeForTests();
  document.body.replaceChildren();
});

const project = { get: () => ({}), revision: () => 1, selection: () => ({ layers: [], keys: [], chan: null }), time: () => 0, playing: () => false,
  apply: vi.fn(), select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;

function makeDeps() {
  const confirm = vi.fn(async (_title: string, _body?: string) => true);
  const openExternal = vi.fn(async (_url: string) => true);
  const deps = { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm, openExternal, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: async () => ({ id: 'x', name: 'x', kind: 'image' }), get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: vi.fn(), remove: vi.fn(), reload: vi.fn(), reveal: vi.fn(), requestFix: vi.fn(), rebase: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
  return { deps, confirm, openExternal };
}

/** A running sandbox for a Store extension, and the shim API its bundle would get. */
async function sandbox(permissions: ExtensionPermission[], links?: string[]) {
  const { deps, confirm, openExternal } = makeDeps();
  const record = { id: 'link-ext', trust: 'store', scope: 'user', dir: '/tmp/link-ext', enabled: true, bundleUrl: '/ext/link-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0,
    manifest: { id: 'link-ext', name: 'Link Lab', version: '1.0.0', apiVersion: 3, permissions, ...(links ? { links } : {}) } } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let api!: PowermoveAPI;
  let client!: ReturnType<typeof createRpc>;
  const pending = createSandboxRuntime(createKernel(), record, deps, {}, { frame, onPostInit(port, init) {
    client = createRpc(port, {});
    api = createSandboxAPI(client, init);
    client.notify('activated');
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => { runtime.dispose(); client.close(); });
  return { api, client, record, deps, confirm, openExternal };
}

describe('ui.openExternal', () => {
  it('opens a listed origin from the sandbox without a prompt when the extension has network', async () => {
    const { api, confirm, openExternal } = await sandbox(['network'], ['https://replicate.com']);
    await expect(api.ui.openExternal('https://replicate.com/account/api-tokens')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://replicate.com/account/api-tokens');
  });

  it('asks first, on the host, for an unlisted URL and for every URL without network', async () => {
    const { api, confirm, openExternal } = await sandbox([], ['https://replicate.com']);
    confirm.mockResolvedValueOnce(false);
    await expect(api.ui.openExternal('https://replicate.com/?q=project-data')).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith('Link Lab wants to open a link in your browser', 'https://replicate.com/?q=project-data');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('never trusts the sandbox about its manifest, and refuses bad URLs at the port', async () => {
    const { client, confirm, openExternal } = await sandbox([]);
    // The kernel's record has no links: what the frame claims does not matter.
    await client.call('invoke', 'ui', 'openExternal', ['https://evil.example/']);
    expect(confirm).toHaveBeenCalledTimes(1);
    await expect(client.call('invoke', 'ui', 'openExternal', [`https://example.com/${'a'.repeat(2048)}`])).rejects.toMatchObject({ name: 'ZodError' });
    await expect(client.call('invoke', 'ui', 'openExternal', ['https://example.com/', 'extra'])).rejects.toMatchObject({ name: 'ZodError' });
    await expect(client.call('invoke', 'ui', 'openExternal', ['javascript:alert(1)'])).rejects.toThrow('https URL');
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('opens nothing during a sandbox check', async () => {
    const { quietDeps } = await import('./sandbox-check');
    const { deps } = makeDeps();
    const scratch = quietDeps(deps, () => {});
    await expect(scratch.ui.openExternal('https://example.com/')).resolves.toBe(false);
    await expect(scratch.ui.confirm('t')).resolves.toBe(false);
    expect(deps.ui.openExternal).not.toHaveBeenCalled();
  });

  it('in-realm, validates the URL and hands it to main’s extension channel', async () => {
    const extensionOpenExternal = vi.fn(async () => undefined);
    const openExternal = vi.fn(async () => undefined);
    installBridgeForTests({ extensionOpenExternal, openExternal } as unknown as PowermoveBridge);
    installed = installKernel(fakePM());
    const api = installed.api('trusted-ext');
    await expect(api.ui.openExternal('https://example.com/a b')).resolves.toBe(true);
    expect(extensionOpenExternal).toHaveBeenCalledWith('https://example.com/a%20b');
    await expect(api.ui.openExternal('http://example.com')).rejects.toThrow(TypeError);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

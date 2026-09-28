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
import type { ImportUrl } from './remote-media';

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
    expect(confirm).toHaveBeenCalledWith('The extension “link-ext” wants to open a link in your browser', 'https://replicate.com/?q=project-data');
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

describe('assets.importUrl', () => {
  it('imports through the host when the record grants assets and network, one download at a time', async () => {
    const { api, deps } = await sandbox(['assets', 'network']);
    let finish!: (id: string) => void;
    const importUrl = vi.fn((_url: string) => new Promise<string>(resolve => { finish = resolve; }));
    (deps.assets as { importUrl?: unknown }).importUrl = importUrl;
    const first = api.assets.importUrl('https://cdn.example/photo.png');
    await vi.waitFor(() => expect(importUrl).toHaveBeenCalledWith('https://cdn.example/photo.png', expect.any(Function)));
    await expect(api.assets.importUrl('https://cdn.example/other.png')).rejects.toMatchObject({ code: 'resource_limit' });
    finish('asset-7');
    await expect(first).resolves.toBe('asset-7');
    importUrl.mockResolvedValueOnce('asset-8');
    await expect(api.assets.importUrl('https://cdn.example/other.png')).resolves.toBe('asset-8');
  });

  it('needs both permissions from the kernel’s record, and a short URL', async () => {
    for (const permissions of [['assets'], ['network'], []] as ExtensionPermission[][]) {
      const { client, deps } = await sandbox(permissions);
      const importUrl = vi.fn(async () => 'asset');
      (deps.assets as { importUrl?: unknown }).importUrl = importUrl;
      await expect(client.call('invoke', 'assets', 'importUrl', ['https://cdn.example/a.png'])).rejects.toMatchObject({ name: 'PermissionError' });
      expect(importUrl).not.toHaveBeenCalled();
    }
    const { client } = await sandbox(['assets', 'network']);
    await expect(client.call('invoke', 'assets', 'importUrl', [`https://cdn.example/${'a'.repeat(2048)}`])).rejects.toMatchObject({ name: 'ZodError' });
    await expect(client.call('invoke', 'assets', 'importUrl', [{ href: 'https://cdn.example/a.png' }])).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('downloads nothing during a sandbox check', async () => {
    const { quietDeps } = await import('./sandbox-check');
    const { deps } = makeDeps();
    const importUrl = vi.fn(async () => 'asset');
    (deps.assets as { importUrl?: unknown }).importUrl = importUrl;
    await expect(quietDeps(deps, () => {}).assets.importUrl('https://cdn.example/a.png')).rejects.toThrow('sandbox check');
    expect(importUrl).not.toHaveBeenCalled();
  });

  it('in-realm, downloads through main, decodes, imports through the normal asset path and returns the id', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const remoteMedia = {
      fetch: vi.fn(async () => ({ token: 't', size: png.byteLength, name: 'photo.png', type: 'image/png', kind: 'image' as const })),
      read: vi.fn(async (_token: string, offset: number, length: number) => png.slice(offset, offset + length)),
      release: vi.fn(async () => undefined)
    };
    installBridgeForTests({ remoteMedia } as unknown as PowermoveBridge);
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close })));
    try {
      const PM = fakePM();
      installed = installKernel(PM);
      await expect(installed.api('trusted-ext').assets.importUrl('https://cdn.example/photo.png')).resolves.toBe('asset-1');
      expect(PM.assets.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'photo.png', type: 'image/png', size: png.byteLength }), expect.anything());
      expect(close).toHaveBeenCalled();
      expect(remoteMedia.release).toHaveBeenCalledWith('t');
      // The sandbox host's quota check reaches the download before its bytes are read.
      const admit = vi.fn(() => { throw new Error('over quota'); });
      await expect((installed.api('trusted-ext').assets.importUrl as ImportUrl)('https://cdn.example/photo.png', admit)).rejects.toThrow('over quota');
      expect(admit).toHaveBeenCalledWith(png.byteLength);
      expect(remoteMedia.read).toHaveBeenCalledTimes(1);
      expect(PM.assets.add).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});

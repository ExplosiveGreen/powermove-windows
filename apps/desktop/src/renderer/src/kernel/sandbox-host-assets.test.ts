// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxRuntime } from './sandbox-host';
import { createKernel } from './registries';
import type { HostDeps } from './host';
import type { ExtensionRecord, ProjectAPI } from './api';

const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const MiB = 1024 * 1024;
/* A real File crosses the port: Node's clones over its MessageChannel, and
   parts that are Blobs are held by reference, so a 600 MiB file costs 1 MiB. */
const chunk = new NodeBlob([new Uint8Array(MiB)]);
const fileOf = (mebibytes: number, name = 'photo.png') => new NodeFile(Array(mebibytes).fill(chunk), name, { type: 'image/png' });

async function runtime(permissions: string[]) {
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  const kernel = createKernel();
  const imported = vi.fn(async (file: File) => ({ id: `asset-${file.size}`, name: file.name, kind: 'image', size: file.size }));
  const project = { get: () => ({ id: 'test' }), revision: () => 1, selection: () => ({ layers: [], keys: [], chan: null }), time: () => 0, playing: () => false,
    apply: vi.fn(), select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
  const deps = { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: imported, get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: vi.fn(), remove: vi.fn(), reload: vi.fn(), reveal: vi.fn(), requestFix: vi.fn(), rebase: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
  const record = { id: 'importer', trust: 'store', scope: 'user', manifest: { id: 'importer', name: 'Importer', version: '1.0.0', apiVersion: 3, permissions }, dir: '/tmp/importer', enabled: true, bundleUrl: '/ext/importer/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let client!: ReturnType<typeof createRpc>;
  const views: Array<{ frame: HTMLIFrameElement; rpc: ReturnType<typeof createRpc> }> = [];
  const pending = createSandboxRuntime(kernel, record, deps, {}, { frame,
    onPostInit(port) { client = createRpc(port, {}, 10_000, { trusted: true }); client.notify('activated'); },
    onViewInit(viewFrame, _message, ports) { const rpc = createRpc(ports[0]!, {}, 10_000, { trusted: true }); close.push(() => rpc.close()); views.push({ frame: viewFrame, rpc }); } });
  frame.dispatchEvent(new Event('load'));
  const started = await pending;
  close.push(() => { started.dispose(); client.close(); });
  /* A panel view on its own port, the way a docked panel mounts one. */
  const openView = async (): Promise<{ frame: HTMLIFrameElement; rpc: ReturnType<typeof createRpc> }> => {
    const id = `importer.panel-${views.length}`;
    await client.call('register', 'panels', id, { id, title: 'Panel' });
    const body = document.createElement('div');
    document.body.append(body);
    kernel.panels.get(id)!.build!(body, { spec: {} } as never);
    for (let wait = 0; wait < 50 && !views.length; wait++) await new Promise(resolve => setTimeout(resolve, 5));
    return views.at(-1)!;
  };
  return { client, imported, openView };
}

it('imports a file over the 1 MiB RPC limit, and meters everything else in the call', async () => {
  const { client, imported } = await runtime(['assets']);
  await expect(client.call('invoke', 'assets', 'import', [fileOf(5)])).resolves.toMatchObject({ id: `asset-${5 * MiB}`, name: 'photo.png' });
  expect(imported).toHaveBeenCalledTimes(1);
  expect((imported.mock.calls[0]![0] as File).size).toBe(5 * MiB);
  // Only argument 0 is exempt: large options, or a File sent to another method, still hit the 1 MiB limit.
  await expect(client.call('invoke', 'assets', 'import', [fileOf(1), { layerDefinition: 'x'.repeat(MiB) }])).rejects.toMatchObject({ code: 'resource_limit' });
  await expect(client.call('invoke', 'storage', 'set', ['key', fileOf(2)])).rejects.toMatchObject({ code: 'resource_limit' });
  await expect(client.call('invoke', 'assets', 'pick', [fileOf(2)])).rejects.toMatchObject({ code: 'resource_limit' });
  expect(imported).toHaveBeenCalledTimes(1);
});

it('imports a large file from a panel view, which shares the extension’s caps', async () => {
  const { imported, openView, client } = await runtime(['assets']);
  const view = await openView();
  await expect(view.rpc.call('invoke', 'assets', 'import', [fileOf(5)])).resolves.toMatchObject({ id: `asset-${5 * MiB}` });
  await expect(view.rpc.call('invoke', 'storage', 'set', ['key', fileOf(2)])).rejects.toMatchObject({ code: 'resource_limit' });
  for (let index = 0; index < 4; index++) await client.call('invoke', 'assets', 'import', [fileOf(500)]);
  await expect(view.rpc.call('invoke', 'assets', 'import', [fileOf(50)])).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('2 GiB') });
  expect(imported).toHaveBeenCalledTimes(5);
});

it('refuses a large import without the assets permission', async () => {
  const { client, imported } = await runtime([]);
  await expect(client.call('invoke', 'assets', 'import', [fileOf(5)])).rejects.toMatchObject({ name: 'PermissionError' });
  expect(imported).not.toHaveBeenCalled();
});

it('caps one import at 512 MiB and an extension at 2 GiB a minute, before the host reads the file', async () => {
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { client, imported } = await runtime(['assets']);
  await expect(client.call('invoke', 'assets', 'import', [fileOf(513)])).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('512 MiB') });
  expect(imported).not.toHaveBeenCalled();
  for (let index = 0; index < 4; index++) await client.call('invoke', 'assets', 'import', [fileOf(500, `part-${index}.png`)]);
  expect(imported).toHaveBeenCalledTimes(4);
  // 2000 MiB are in this minute: 49 more would pass 2 GiB, 48 do not.
  await expect(client.call('invoke', 'assets', 'import', [fileOf(49)])).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('2 GiB') });
  await client.call('invoke', 'assets', 'import', [fileOf(48)]);
  await expect(client.call('invoke', 'assets', 'import', [fileOf(1)])).rejects.toMatchObject({ code: 'resource_limit' });
  expect(imported).toHaveBeenCalledTimes(5);
  // A minute after the first imports, their bytes leave the window.
  now += 60_000;
  await client.call('invoke', 'assets', 'import', [fileOf(512)]);
  expect(imported).toHaveBeenCalledTimes(6);
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxRuntime } from './sandbox-host';
import { createKernel } from './registries';
import { installBridgeForTests, resetBridgeForTests } from './bridge';
import { CLIPBOARD_TEXT_MAX_CHARS, type PowermoveBridge } from '../../../shared/ipc';
import type { HostDeps } from './host';
import type { ExtensionRecord, ProjectAPI } from './api';
import type { ImportUrl } from './remote-media';

const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetBridgeForTests(); });
const MiB = 1024 * 1024;
/* A real File crosses the port: Node's clones over its MessageChannel, and
   parts that are Blobs are held by reference, so a 600 MiB file costs 1 MiB. */
const chunk = new NodeBlob([new Uint8Array(MiB)]);
const fileOf = (mebibytes: number, name = 'photo.png') => new NodeFile(Array(mebibytes).fill(chunk), name, { type: 'image/png' });

async function runtime(permissions: string[], links?: string[]) {
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  const kernel = createKernel();
  const imported = vi.fn(async (file: File) => ({ id: `asset-${file.size}`, name: file.name, kind: 'image', size: file.size }));
  const project = { get: () => ({ id: 'test' }), revision: () => 1, selection: () => ({ layers: [], keys: [], chan: null }), time: () => 0, playing: () => false,
    apply: vi.fn(), select: vi.fn(), setTime: vi.fn(), play: vi.fn(), pause: vi.fn(), undo: vi.fn(), redo: vi.fn(), snapshot: async () => '' } as unknown as ProjectAPI;
  const deps = { pm: { dismissToast: vi.fn() }, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: vi.fn(async () => true), openExternal: vi.fn(async () => true), menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    assets: { pick: async () => [], import: imported, get: () => undefined, readText: async () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [], setEnabled: vi.fn(), remove: vi.fn(), reload: vi.fn(), reveal: vi.fn(), requestFix: vi.fn(), rebase: vi.fn() },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError: vi.fn()
  } as unknown as HostDeps;
  const record = { id: 'importer', trust: 'store', scope: 'user', manifest: { id: 'importer', name: 'Importer', version: '1.0.0', apiVersion: 3, permissions, ...(links ? { links } : {}) }, dir: '/tmp/importer', enabled: true, bundleUrl: '/ext/importer/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
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
  return { client, imported, openView, deps };
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

it('counts assets.importUrl downloads against the same 2 GiB a minute, before they are read back', async () => {
  vi.spyOn(Date, 'now').mockImplementation(() => 2_000_000);
  const { client, imported, deps } = await runtime(['assets', 'network']);
  const downloads: number[] = [];
  let size = 0;
  // The kernel's importUrl: main reports the size, `admit` may refuse it, then the file imports.
  (deps.assets as { importUrl?: ImportUrl }).importUrl = async (_url, admit) => { admit?.(size); downloads.push(size); return (await imported(fileOf(0) as unknown as File)).id; };
  for (let index = 0; index < 4; index++) await client.call('invoke', 'assets', 'import', [fileOf(500, `part-${index}.png`)]);
  size = 49 * MiB;
  await expect(client.call('invoke', 'assets', 'importUrl', ['https://cdn.example/big.png'])).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('2 GiB') });
  expect(downloads).toEqual([]);
  size = 40 * MiB;
  await client.call('invoke', 'assets', 'importUrl', ['https://cdn.example/fits.png']);
  expect(downloads).toEqual([40 * MiB]);
  // The download's bytes are in the window: 2040 MiB leaves room for 8, not 9.
  await expect(client.call('invoke', 'assets', 'import', [fileOf(9)])).rejects.toMatchObject({ code: 'resource_limit' });
  await client.call('invoke', 'assets', 'import', [fileOf(8)]);
});

it('dismisses a panel’s toast buttons when that panel’s document goes, and leaves the runtime’s', async () => {
  const { client, openView, deps } = await runtime([]);
  const toast = vi.mocked(deps.ui.toast);
  const dismissToast = vi.mocked((deps.pm as { dismissToast: (key: string) => void }).dismissToast);
  const view = await openView();
  await client.call('invoke', 'ui', 'toast', ['From the runtime', { action: { label: 'Open', run: 1 } }]);
  await view.rpc.call('invoke', 'ui', 'toast', ['From the panel', { action: { label: 'Undo', run: 2 } }]);
  const [runtimeKey, viewKey] = toast.mock.calls.map(call => (call[1] as { key?: string }).key);
  expect(runtimeKey).not.toBe(viewKey);
  view.frame.remove();
  await vi.waitFor(() => expect(dismissToast).toHaveBeenCalledWith(viewKey));
  expect(dismissToast).toHaveBeenCalledTimes(1);
});

/* ui.copy (report item 11): the manifest record's clipboard permission, a
   view the host sees focused, once a second, through main's write channel. */
/** The app document's transient user activation, which only the browser sets. */
function activation(isActive: boolean): void {
  Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive, hasBeenActive: isActive } });
}
afterEach(() => { delete (navigator as { userActivation?: unknown }).userActivation; });

async function copier(permissions: string[]) {
  const clipboardWriteText = vi.fn(async (_text: string) => {});
  installBridgeForTests({ clipboardWriteText } as unknown as PowermoveBridge);
  activation(true);
  const harness = await runtime(permissions);
  const view = await harness.openView();
  view.frame.tabIndex = 0;
  return { ...harness, view, clipboardWriteText };
}

it('copies text from a focused panel view with the clipboard permission, once a second', async () => {
  let now = 5_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { view, clipboardWriteText } = await copier(['clipboard']);
  view.frame.focus();
  await view.rpc.call('invoke', 'ui', 'copy', ['#ff6600']);
  expect(clipboardWriteText).toHaveBeenCalledExactlyOnceWith('#ff6600');
  await expect(view.rpc.call('invoke', 'ui', 'copy', ['again'])).rejects.toMatchObject({ code: 'resource_limit' });
  now += 1000;
  await view.rpc.call('invoke', 'ui', 'copy', ['again']);
  expect(clipboardWriteText).toHaveBeenLastCalledWith('again');
  // Plain text only, up to the channel's limit.
  now += 1000;
  for (const value of [{ html: '<b>x</b>' }, 42, 'x'.repeat(CLIPBOARD_TEXT_MAX_CHARS + 1)]) {
    await expect(view.rpc.call('invoke', 'ui', 'copy', [value])).rejects.toBeTruthy();
  }
  expect(clipboardWriteText).toHaveBeenCalledTimes(2);
});

it('refuses ui.copy without the permission, from the runtime, and from an unfocused view', async () => {
  const denied = await copier([]);
  denied.view.frame.focus();
  await expect(denied.view.rpc.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ name: 'PermissionError', code: 'clipboard' });
  close.splice(0).forEach(fn => fn());
  const { client, view, clipboardWriteText } = await copier(['clipboard']);
  // The runtime document has no focus to prove, even while a view has it.
  view.frame.focus();
  await expect(client.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ name: 'PermissionError', message: expect.stringContaining('focus') });
  view.frame.blur();
  await expect(view.rpc.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ name: 'PermissionError', message: expect.stringContaining('focus') });
  // A focused frame in a window that lost focus is not focused either.
  view.frame.focus();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  await expect(view.rpc.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ message: expect.stringContaining('focus') });
  // Nothing the view sends stands in for focus.
  view.frame.blur();
  vi.mocked(document.hasFocus).mockReturnValue(true);
  await view.rpc.call('focus', { field: false }).catch(() => {});
  view.rpc.notify('pointer', { button: 0, x: 1, y: 1 });
  await expect(view.rpc.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ message: expect.stringContaining('focus') });
  expect(clipboardWriteText).not.toHaveBeenCalled();
});

it('refuses ui.copy from a focused panel nobody just clicked or typed in (focus restored by Command-Tab)', async () => {
  const { view, clipboardWriteText } = await copier(['clipboard']);
  view.frame.focus();
  activation(false);
  await expect(view.rpc.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ name: 'PermissionError', message: expect.stringContaining('click or key press') });
  expect(clipboardWriteText).not.toHaveBeenCalled();
  activation(true);
  await view.rpc.call('invoke', 'ui', 'copy', ['x']);
  expect(clipboardWriteText).toHaveBeenCalledWith('x');
});

/** A real press on the app document, outside every frame: the browser's own, so trusted. */
function pressOnApp(type: 'pointerdown' | 'keydown' = 'pointerdown'): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  document.body.dispatchEvent(event);
}

it('refuses ui.copy after a press on the app that left the panel focused, until that activation lapses', async () => {
  let clock = 1_000_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  let now = 5_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { view, clipboardWriteText } = await copier(['clipboard']);
  view.frame.focus();
  clock += 100;
  // A toolbar button that cancels pointerdown keeps focus in the panel.
  pressOnApp();
  await expect(view.rpc.call('invoke', 'ui', 'copy', ['x'])).rejects.toMatchObject({ message: expect.stringContaining('click or key press') });
  // Script-made presses are not the person's, and do not count against the panel.
  clock += 5_000; now += 5_000;
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  // After the app's activation has lapsed, an active one is a press in the frame.
  await view.rpc.call('invoke', 'ui', 'copy', ['after']);
  expect(clipboardWriteText).toHaveBeenCalledExactlyOnceWith('after');
  clock += 100; now += 1_000;
  pressOnApp();
  // Focus that moves into the frame after the press is a press in the frame.
  view.frame.blur();
  clock += 100;
  view.frame.focus();
  await view.rpc.call('invoke', 'ui', 'copy', ['refocused']);
  expect(clipboardWriteText).toHaveBeenLastCalledWith('refocused');
});

it('opens a listed link without a sheet only from a focused panel right after a real click or key press', async () => {
  let clock = 1_000_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const { openView, deps } = await runtime(['network'], ['https://docs.example']);
  const view = await openView();
  view.frame.tabIndex = 0;
  const confirm = vi.mocked(deps.ui.confirm);
  const open = () => { clock += 2_000; return view.rpc.call('invoke', 'ui', 'openExternal', ['https://docs.example/guide']); };
  // Focused, but nobody acted: focus came back with Command-Tab.
  view.frame.focus();
  activation(false);
  await open();
  expect(confirm).toHaveBeenCalledTimes(1);
  // Acted, but somewhere else: another panel or the canvas has focus.
  view.frame.blur();
  activation(true);
  await open();
  expect(confirm).toHaveBeenCalledTimes(2);
  view.frame.focus();
  await open();
  expect(confirm).toHaveBeenCalledTimes(2);
  // Focused and activated, but the press was on the app around the panel.
  pressOnApp();
  await open();
  expect(confirm).toHaveBeenCalledTimes(3);
  expect(deps.ui.openExternal).toHaveBeenCalledTimes(4);
});

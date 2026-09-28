import { expect, test } from './helpers/app';
import type { LaunchedApp } from './helpers/app';
import { installStoreExtensions, waitForCommands } from './helpers/sandbox';

/* A sandboxed Store extension (test/fixtures/sandbox-links) opens links and
   imports remote media by URL through the real renderer, IPC and main
   process. The injected run swaps only DNS and the socket in main, so it
   works offline; the live run fetches a public image when the network is up. */

// 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PUBLIC = '93.184.215.14';
const LIVE_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';

type Outcome = { ok?: unknown; error?: string; code?: string | null };

function run(session: LaunchedApp, command: string, url: string): Promise<Outcome> {
  return session.page.evaluate(({ command, url }) => (window as any).PM.Kernel.commands.get(command).run(url), { command, url }) as Promise<Outcome>;
}

async function start(session: LaunchedApp): Promise<void> {
  await installStoreExtensions(session, [{ fixture: 'sandbox-links' }]);
  await session.relaunch();
  await session.openEditor();
  await waitForCommands(session, ['sandbox-links'], 'import');
}

/** Replaces main's DNS and socket: every name answers `answers[name]`, and every request gets the PNG. */
async function fakeNetwork(session: LaunchedApp, answers: Record<string, string>): Promise<void> {
  await session.app.evaluate((_electron, { png, answers }) => {
    const requests: Array<{ url: string; address: string }> = [];
    (globalThis as any).__remoteRequests = requests;
    (globalThis as any).__powermoveRemoteMedia.useNetworkForTests({
      resolve: async (hostname: string) => {
        const address = answers[hostname];
        if (!address) throw new Error('ENOTFOUND');
        return [{ address, family: address.includes(':') ? 6 : 4 }];
      },
      transport: async ({ url, address }: { url: URL; address: string }) => {
        requests.push({ url: url.href, address });
        const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
        return { status: 200, headers: { 'content-type': 'text/plain' }, cancel: () => {}, body: (async function* () { yield bytes; })() };
      }
    });
  }, { png: PNG, answers });
}

const assetOf = (session: LaunchedApp, id: string) => session.page.evaluate((id) => {
  const asset = (window as any).PM.proj.assets?.[id];
  return asset ? { name: asset.name, kind: asset.kind } : null;
}, id);

test('a sandboxed extension imports a remote image by URL, and private hosts are refused', async ({ session }) => {
  await start(session);
  await fakeNetwork(session, { 'images.example.com': PUBLIC, 'intranet.example.com': '10.0.0.7', 'loopback.example.com': '127.0.0.1' });

  const imported = await run(session, 'sandbox-links.import', 'https://images.example.com/photos/Test%20Image.jpeg?w=1');
  expect(imported.error).toBeUndefined();
  expect(typeof imported.ok).toBe('string');
  // Named after the URL, typed by its bytes rather than the extension or Content-Type.
  expect(await assetOf(session, imported.ok as string)).toEqual({ name: 'Test Image.png', kind: 'image' });
  expect(await session.app.evaluate(() => (globalThis as any).__remoteRequests)).toEqual([
    { url: 'https://images.example.com/photos/Test%20Image.jpeg?w=1', address: PUBLIC }
  ]);

  for (const url of ['https://intranet.example.com/a.png', 'https://loopback.example.com/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png']) {
    expect((await run(session, 'sandbox-links.import', url)).error).toContain('is not reachable on the public internet');
  }
  expect((await run(session, 'sandbox-links.import', 'http://images.example.com/a.png')).error).toContain('https URL');
  // Nothing refused reached the socket.
  expect(await session.app.evaluate(() => (globalThis as any).__remoteRequests.length)).toBe(1);
});

test('a sandboxed extension without network cannot import by URL', async ({ session }) => {
  await installStoreExtensions(session, [{ fixture: 'sandbox-links', permissions: ['assets'] }]);
  await session.relaunch();
  await session.openEditor();
  await waitForCommands(session, ['sandbox-links'], 'import');
  await fakeNetwork(session, { 'images.example.com': PUBLIC });
  expect(await run(session, 'sandbox-links.import', 'https://images.example.com/a.png')).toMatchObject({ code: 'network' });
  expect(await session.app.evaluate(() => (globalThis as any).__remoteRequests.length)).toBe(0);
});

test('a sandboxed extension opens its listed origin directly and asks, showing the URL, for any other', async ({ session }) => {
  await start(session);
  await session.app.evaluate(({ dialog, shell }) => {
    const seen = { opened: [] as string[], asked: [] as Array<{ message: string; detail?: string }> };
    (globalThis as any).__links = seen;
    shell.openExternal = async (url: string) => { seen.opened.push(url); };
    dialog.showMessageBox = (async (_window: unknown, options: { message: string; detail?: string }) => {
      seen.asked.push({ message: options.message, detail: options.detail });
      return { response: seen.asked.length === 1 ? 0 : 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  const seen = () => session.app.evaluate(() => (globalThis as any).__links);

  expect(await run(session, 'sandbox-links.open', 'https://links.example.com/docs')).toEqual({ ok: true });
  expect(await seen()).toEqual({ opened: ['https://links.example.com/docs'], asked: [] });

  await session.page.waitForTimeout(2_100);
  expect(await run(session, 'sandbox-links.open', 'https://elsewhere.example.org/?q=1')).toEqual({ ok: true });
  await session.page.waitForTimeout(2_100);
  expect(await run(session, 'sandbox-links.open', 'https://declined.example.org/')).toEqual({ ok: false });
  expect(await seen()).toEqual({
    opened: ['https://links.example.com/docs', 'https://elsewhere.example.org/?q=1'],
    asked: [
      { message: 'Sandbox links fixture wants to open a link in your browser', detail: 'https://elsewhere.example.org/?q=1' },
      { message: 'Sandbox links fixture wants to open a link in your browser', detail: 'https://declined.example.org/' }
    ]
  });
  // Too soon after the last one.
  expect(await run(session, 'sandbox-links.open', 'https://links.example.com/again')).toMatchObject({ code: 'resource_limit' });
});

test('a sandboxed extension imports a public image over the real network', async ({ session }) => {
  test.setTimeout(90_000);
  const online = await fetch(LIVE_IMAGE, { method: 'HEAD', signal: AbortSignal.timeout(8_000) }).then((response) => response.ok, () => false);
  test.skip(!online, 'no network: the injected run above covers the pipeline');
  await start(session);
  const imported = await run(session, 'sandbox-links.import', LIVE_IMAGE);
  expect(imported.error).toBeUndefined();
  expect(await assetOf(session, imported.ok as string)).toEqual({ name: 'PNG_transparency_demonstration_1.png', kind: 'image' });
});

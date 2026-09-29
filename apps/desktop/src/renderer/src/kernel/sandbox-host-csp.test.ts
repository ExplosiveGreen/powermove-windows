// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createRpc } from '../../../shared/sandbox-rpc';
import { createSandboxRuntime, type SandboxObserver } from './sandbox-host';
import { createKernel } from './registries';
import type { HostDeps } from './host';
import type { ExtensionRecord, ProjectAPI } from './api';

const close: Array<() => void> = [];
afterEach(() => { for (const fn of close.splice(0)) fn(); document.body.replaceChildren(); vi.restoreAllMocks(); });

async function start(observer?: SandboxObserver) {
  const kernel = createKernel();
  const project = { get: () => ({ id: 'test' }), revision: () => 1, selection: () => null, time: () => 0, playing: () => false } as unknown as ProjectAPI;
  const reportRuntimeError = vi.fn();
  const deps = { pm: {}, state: { doc: {}, sel: {}, transport: {}, perf: {} }, project,
    ui: { controls: {}, toast: vi.fn(), confirm: async () => true, menu: vi.fn(), modal: vi.fn(), icon: () => '' },
    storage: () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
    extensions: { list: () => [] },
    panelsBackend: { open: vi.fn(), close: vi.fn(), isOpen: () => false, refresh: vi.fn(), list: () => [] }, paletteOpen: vi.fn(), reportRuntimeError
  } as unknown as HostDeps;
  const record = { id: 'csp-ext', trust: 'store', scope: 'user', manifest: { id: 'csp-ext', name: 'CSP', version: '1.0.0', apiVersion: 3, permissions: [] }, dir: '/tmp/csp', enabled: true, bundleUrl: '/ext/csp-ext/bundle.js', bundleHash: 'x', health: { state: 'ok' }, updatedAt: 0 } as ExtensionRecord;
  const frame = document.createElement('iframe');
  let client!: ReturnType<typeof createRpc>;
  const pending = createSandboxRuntime(kernel, record, deps, {}, { frame, ...(observer ? { observer } : {}), onPostInit(port) {
    client = createRpc(port, {});
    client.notify('activated');
  } });
  frame.dispatchEvent(new Event('load'));
  const runtime = await pending;
  close.push(() => { runtime.dispose(); client.close(); });
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  return { client, reportRuntimeError, settle };
}

it('logs each distinct blocked load once and never counts it toward auto-disable', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { client, reportRuntimeError, settle } = await start();
  for (let index = 0; index < 3; index++) {
    client.notify('csp-violation', { directive: 'img-src', blockedURI: 'https://a.example/beacon.png' });
    client.notify('csp-violation', { directive: 'connect-src', blockedURI: 'https://b.example/api' });
  }
  await settle();
  expect(reportRuntimeError).not.toHaveBeenCalled();
  expect(warn.mock.calls.map(call => call[0])).toEqual([
    '[ext:csp-ext] The sandbox blocked https://a.example/beacon.png (img-src)',
    '[ext:csp-ext] The sandbox blocked https://b.example/api (connect-src)'
  ]);
});

it('keeps at most 100 distinct violations and says when it stops logging', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { client, reportRuntimeError, settle } = await start();
  // Paced under the port's per-second budget.
  for (let batch = 0; batch < 3; batch++) {
    for (let index = batch * 50; index < batch * 50 + 50; index++) client.notify('csp-violation', { directive: 'img-src', blockedURI: `https://example.com/${index}` });
    await new Promise(resolve => setTimeout(resolve, 1010));
  }
  client.notify('csp-violation', { directive: 'img-src', blockedURI: 'x'.repeat(100_000) });
  await settle();
  expect(reportRuntimeError).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(100);
  expect(warn.mock.calls.at(-1)?.[0]).toBe('[ext:csp-ext] The sandbox blocked https://example.com/99 (img-src); further blocked requests are not logged');
}, 10_000);

it('still reports every distinct violation to the publish-time sandbox check', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const csp = vi.fn();
  const { client, reportRuntimeError, settle } = await start({ csp });
  client.notify('csp-violation', { directive: 'script-src-elem', blockedURI: 'https://cdn.example/lib.js' });
  client.notify('csp-violation', { directive: 'script-src-elem', blockedURI: 'https://cdn.example/lib.js' });
  client.notify('csp-violation', { directive: 'font-src', blockedURI: 'https://fonts.example/a.woff2' });
  await settle();
  expect(csp.mock.calls).toEqual([['script-src-elem', 'https://cdn.example/lib.js'], ['font-src', 'https://fonts.example/a.woff2']]);
  expect(reportRuntimeError).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PublishPlanDto } from '../../../shared/publish';
import type { LibraryItemDto } from '../../../shared/store-ipc';
import { installBridgeForTests, resetBridgeForTests } from '../kernel/bridge';
import { ModalController } from '../overlays/modal';
import type { ModalOptions, OverlayPM } from '../overlays/types';
import * as account from '../cloud/account';
import type { StorePM } from './data';
import StoreScreen from './StoreScreen.svelte';

afterEach(() => { resetBridgeForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const plan: PublishPlanDto = {
  localId: 'demo', coordinate: 'maker/demo', version: '1.0.0', suggestedVersion: '1.0.0', lastVersion: null,
  firstPublish: true, treeSha: 'a'.repeat(40), fileCount: 2, sizeBytes: 120, isFork: false,
  blockedFindings: [], waivableFindings: [], permissionFindings: [
    { path: 'index.ts', line: 1, needs: 'full-access', text: 'Declare full-access for api.render.' },
    { path: 'index.ts', line: 1, needs: 'full-access', text: 'Declare full-access for api.host.' }
  ],
  manifest: { id: 'demo', name: 'Demo', description: null },
  listing: { name: 'Demo', tagline: '', category: 'effects', licence: 'MIT' }
};
const item: LibraryItemDto = {
  localId: 'demo', name: 'Demo', version: '1.0.0', category: 'effects', contributes: ['effects'], vars: [],
  health: { state: 'ok' }, enabled: true, trust: 'local', permissions: [], description: null,
  group: 'yours', maker: { you: true }, update: null, modified: false, publish: 'first'
};

async function setup(onPublishProgress = vi.fn(() => () => {})) {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addListener() {}, removeListener() {} }));
  // happy-dom has no layout; the desktop test covers the modal's measured height.
  vi.stubGlobal('ResizeObserver', undefined);
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.spyOn(account, 'subscribeAccount').mockImplementation((listener) => {
    listener({ name: '@maker', handle: 'maker', email: 'maker@example.test', image: null }, null);
    return () => {};
  });
  let ready!: () => void;
  const prepared = new Promise<{ ok: true; value: PublishPlanDto }>((resolve) => { ready = () => resolve({ ok: true, value: plan }); });
  const publishPrepare = vi.fn(() => prepared);
  installBridgeForTests({ extensionStore: {
    library: async () => [item], browse: async () => ({ ok: true, value: { sections: [] } }),
    publishPrepare, onPublishProgress,
    onUpdatesChanged: () => () => {}, onLibraryChanged: () => () => {}
  } } as any);
  const host = document.createElement('div');
  host.id = 'app';
  const scrim = document.createElement('div');
  scrim.id = 'scrim';
  document.body.append(host, scrim);
  const toast = vi.fn();
  const PM = { bus: { emit() {} }, toast } as unknown as StorePM;
  const modals = new ModalController(PM as unknown as OverlayPM);
  PM.modal = (options: ModalOptions) => modals.open(options);
  const screen = mount(StoreScreen, { target: host, props: { PM } });
  flushSync(() => screen.open('library'));
  await vi.waitFor(() => expect(host.querySelector('.st-item.is-library')).not.toBeNull());
  return { host, scrim, ready, toast, publishPrepare,
    async choose() {
      (host.querySelector('.st-add') as HTMLButtonElement).click();
      flushSync();
      await vi.waitFor(() => expect(document.querySelector('.thread-row')).not.toBeNull());
      (document.querySelector('.thread-row') as HTMLElement).click();
      flushSync();
      await vi.waitFor(() => expect(publishPrepare).toHaveBeenCalled());
    },
    async dispose() { modals.closeAll(); await unmount(screen); host.remove(); scrim.remove(); }
  };
}

it('hands a publish choice to the preparing panel immediately and opens the full form', async () => {
  const app = await setup();
  try {
    await app.choose();
    expect(document.querySelector('.thread-popup')).toBeNull();
    expect(document.querySelector('.publish-modal')?.textContent).toContain('Getting it ready');
    app.ready();
    await vi.waitFor(() => expect(document.querySelector('.publish-modal .pub-form input')).not.toBeNull());
    expect([...document.querySelectorAll('.publish-modal .pub-problem')].filter((row) => row.textContent?.startsWith('Declare full-access'))).toHaveLength(2);
    expect(app.toast).not.toHaveBeenCalled();
  } finally { await app.dispose(); }
});

it('cleans up the modal and scrim after a form setup error and allows a retry', async () => {
  const progress = vi.fn(() => () => {}).mockImplementationOnce(() => { throw new Error('Simulated form setup error'); });
  const app = await setup(progress);
  try {
    await app.choose();
    app.ready();
    await vi.waitFor(() => expect(app.toast).toHaveBeenCalledWith('Couldn’t open the publishing panel. Please try again.', 5000, { error: true }));
    expect(document.querySelector('.publish-modal')).toBeNull();
    expect(app.scrim.classList.contains('on')).toBe(false);
    expect(app.host.inert).toBe(false);
    await app.choose();
    await vi.waitFor(() => expect(document.querySelector('.publish-modal .pub-form input')).not.toBeNull());
  } finally { await app.dispose(); }
});

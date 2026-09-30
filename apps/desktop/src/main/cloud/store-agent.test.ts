import { describe, expect, it, vi } from 'vitest';

import { createStoreAgentGateway, type StoreAgentGatewayOptions } from './store-agent';

/** A detail response with just the fields the gateway reads. */
function detail(overrides: Record<string, unknown> = {}): any {
  return {
    repoId: 'repo-1',
    owner: { handle: 'ada', verified: true },
    slug: 'glow',
    name: 'Glow',
    tagline: 'A warm glow',
    category: 'effects',
    installCount: 42,
    permissions: ['network'],
    about: 'About Glow',
    latest: { id: 'rel-2', version: '1.1.0' },
    releases: [
      { id: 'rel-1', version: '1.0.0', apiVersion: 3, publishedAt: '2026-01-01', yankedAt: null, fileCount: 3, sizeBytes: 100, manifest: { permissions: [] } },
      { id: 'rel-2', version: '1.1.0', apiVersion: 3, publishedAt: '2026-02-01', yankedAt: null, fileCount: 4, sizeBytes: 200, manifest: { permissions: ['network'] } }
    ],
    ...overrides
  };
}

function gateway(overrides: Partial<StoreAgentGatewayOptions> = {}) {
  const store = {
    extensions: vi.fn().mockResolvedValue({ items: [detail()], nextCursor: 'next' }),
    detail: vi.fn().mockResolvedValue(detail()),
    tree: vi.fn().mockResolvedValue({ treeSha: 'tree-sha', files: [{ path: 'index.ts', sha: 'a', size: 10 }] }),
    release: vi.fn().mockResolvedValue({ handle: 'ada', slug: 'glow', version: '1.1.0' }),
    file: vi.fn().mockResolvedValue('export default 1')
  };
  const installer = {
    installRelease: vi.fn().mockResolvedValue({ localId: 'glow', needsSetup: false, needsTrust: false }),
    updateRelease: vi.fn().mockResolvedValue({ kind: 'updated', localId: 'glow', version: '1.1.0' }),
    uninstall: vi.fn().mockResolvedValue({ removed: true }),
    updates: vi.fn().mockReturnValue({}),
    localTree: vi.fn().mockResolvedValue(null)
  };
  const publisher = {
    prepare: vi.fn().mockResolvedValue({ suggestedVersion: '1.2.0', firstPublish: false, listing: { name: 'Glow', tagline: 't', category: 'effects', licence: 'MIT' } }),
    publish: vi.fn().mockResolvedValue({ published: true, coordinate: 'ada/glow', version: '1.2.0', repoId: 'repo-1', releaseId: 'rel-3' })
  };
  const removeExtension = vi.fn().mockResolvedValue(true);
  const refreshExtensions = vi.fn().mockResolvedValue(undefined);
  const options: StoreAgentGatewayOptions = {
    store: store as any,
    installer: installer as any,
    publisher: publisher as any,
    provenance: { read: vi.fn().mockResolvedValue({}) } as any,
    registry: { list: () => [] },
    me: () => ({ publisher: { id: 'pub-1', handle: 'ada' } }) as any,
    signedIn: () => true,
    removeExtension,
    refreshExtensions,
    ...overrides
  };
  return { gw: createStoreAgentGateway(options), store, installer, publisher, removeExtension, refreshExtensions };
}

describe('store agent gateway', () => {
  it('searches and trims listings for the agent', async () => {
    const { gw, store } = gateway();
    const result = await gw.search({ query: 'glow', sort: 'installs' });
    expect(store.extensions).toHaveBeenCalledWith({ q: 'glow', sort: 'installs' });
    expect(result).toEqual({
      items: [{ handle: 'ada', slug: 'glow', name: 'Glow', tagline: 'A warm glow', category: 'effects', installs: 42, verified: true, permissions: ['network'], latest: { releaseId: 'rel-2', version: '1.1.0' } }],
      nextCursor: 'next'
    });
  });

  it('installs the latest release by default and reports its permissions', async () => {
    const { gw, installer } = gateway();
    const result = await gw.install({ handle: 'ada', slug: 'glow' });
    expect(installer.installRelease).toHaveBeenCalledWith({ repoId: 'repo-1', releaseId: 'rel-2' });
    expect(result).toMatchObject({ localId: 'glow', coordinate: 'ada/glow', version: '1.1.0', permissions: ['network'], needsSetup: false, needsTrust: false });
  });

  it('installs a specific version when asked', async () => {
    const { gw, installer } = gateway();
    await gw.install({ handle: 'ada', slug: 'glow', version: '1.0.0' });
    expect(installer.installRelease).toHaveBeenCalledWith({ repoId: 'repo-1', releaseId: 'rel-1' });
  });

  it('refuses to install a version that does not exist', async () => {
    const { gw } = gateway();
    await expect(gw.install({ handle: 'ada', slug: 'glow', version: '9.9.9' })).rejects.toThrow(/no version 9\.9\.9/);
  });

  it('returns the file tree when no path is given', async () => {
    const { gw, store } = gateway();
    const result = await gw.source('rel-2');
    expect(store.tree).toHaveBeenCalledWith('rel-2');
    expect(result).toEqual({ treeSha: 'tree-sha', files: [{ path: 'index.ts', size: 10 }] });
  });

  it('resolves a release to read one source file', async () => {
    const { gw, store } = gateway();
    const result = await gw.source('rel-2', 'index.ts');
    expect(store.release).toHaveBeenCalledWith('rel-2');
    expect(store.file).toHaveBeenCalledWith('ada', 'glow', '1.1.0', 'index.ts');
    expect(result).toEqual({ path: 'index.ts', text: 'export default 1' });
  });

  it('updates and uninstalls through the shared installer and reconciles the renderer', async () => {
    const { gw, installer, removeExtension, refreshExtensions } = gateway();
    await gw.update('glow');
    expect(installer.updateRelease).toHaveBeenCalledWith('glow');

    const result = await gw.uninstall('glow');
    expect(installer.uninstall).toHaveBeenCalledWith('glow', removeExtension);
    expect(refreshExtensions).toHaveBeenCalledWith(['glow']);
    expect(result).toEqual({ removed: true });
  });

  it('will not publish when the user is signed out', async () => {
    const { gw, publisher } = gateway({ signedIn: () => false });
    await expect(gw.publish({ localId: 'glow' })).rejects.toThrow(/signed in/);
    await expect(gw.publishPrepare('glow')).rejects.toThrow(/signed in/);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('will not publish without a claimed publisher handle', async () => {
    const { gw } = gateway({ me: () => ({ publisher: null }) as any });
    await expect(gw.publish({ localId: 'glow' })).rejects.toThrow(/publisher handle/);
  });

  it('publishes an update using the prepared suggested version, no listing', async () => {
    const { gw, publisher } = gateway();
    await gw.publish({ localId: 'glow' });
    expect(publisher.publish).toHaveBeenCalledWith('glow', { version: '1.2.0', waivers: [] });
  });

  it('fills a first publish with the manifest-derived listing and public visibility', async () => {
    const { gw, publisher } = gateway();
    publisher.prepare.mockResolvedValueOnce({ suggestedVersion: '1.0.0', firstPublish: true, listing: { name: 'Glow', tagline: 'A warm glow', category: 'effects', licence: 'MIT' } });
    await gw.publish({ localId: 'glow', notes: 'first cut' });
    expect(publisher.publish).toHaveBeenCalledWith('glow', {
      version: '1.0.0',
      waivers: [],
      notes: 'first cut',
      listing: { name: 'Glow', tagline: 'A warm glow', category: 'effects', licence: 'MIT' },
      visibility: 'public'
    });
  });
});

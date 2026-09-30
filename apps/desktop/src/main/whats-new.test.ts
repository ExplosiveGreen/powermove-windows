import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));

import { IPC } from '../shared/ipc';
import { compareAppVersions, installWhatsNew, releasesBetween, tidyNotes } from './whats-new';

const releases = [
  { tag_name: 'v1.0.5', name: 'Powermove 1.0.5', body: 'Five', html_url: 'u5', published_at: '2026-09-23T00:00:00Z' },
  { tag_name: 'v1.0.4', name: 'Powermove 1.0.4', body: 'Four', html_url: 'u4' },
  { tag_name: 'v1.0.4-beta.1', body: 'Beta', prerelease: true },
  { tag_name: 'v1.0.3', body: 'Three' },
  { tag_name: 'v1.0.6', body: 'Draft', draft: true }
];

function ipc() {
  const handlers = new Map<string, () => unknown>();
  return { handlers, main: { handle: (channel: string, fn: () => unknown) => handlers.set(channel, fn) } as never };
}

describe('whats-new', () => {
  it('orders versions with betas below their release', () => {
    expect(compareAppVersions('1.0.4-beta.1', '1.0.4')).toBeLessThan(0);
    expect(compareAppVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });

  it('selects the stable releases after the last seen version, newest first', () => {
    expect(releasesBetween(releases, '1.0.3', '1.0.5').map(r => r.version)).toEqual(['1.0.5', '1.0.4']);
    expect(releasesBetween(releases, '1.0.3', '1.0.4').map(r => r.version)).toEqual(['1.0.4']);
    expect(releasesBetween(releases, '1.0.3', '1.0.5-beta.2').map(r => r.version)).toEqual(['1.0.4', '1.0.4-beta.1']);
  });

  it('drops the compare link and shortens PR links', () => {
    expect(tidyNotes('* Fix by @a in https://github.com/o/r/pull/12\n\n**Full Changelog**: https://x')).toBe('* Fix by @a in [#12](https://github.com/o/r/pull/12)');
  });

  it('records a fresh install silently and shows notes once after an update', async () => {
    const userData = await mkdtemp(path.join(tmpdir(), 'whats-new-'));
    const fetch = vi.fn(async () => new Response(JSON.stringify(releases)));
    const first = ipc();
    installWhatsNew(first.main, { userData, current: '1.0.3', fetch });
    expect(await first.handlers.get(IPC.whatsNewPending)!()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    const second = ipc();
    installWhatsNew(second.main, { userData, current: '1.0.5', fetch });
    const notes = await second.handlers.get(IPC.whatsNewPending)!() as { releases: unknown[] };
    expect(notes.releases).toHaveLength(2);
    expect(await second.handlers.get(IPC.whatsNewPending)!()).toBeNull();
    await second.handlers.get(IPC.whatsNewSeen)!();
    expect(JSON.parse(await readFile(path.join(userData, 'whats-new.json'), 'utf8'))).toEqual({ version: '1.0.5' });
  });

  it('retries on the next request when GitHub is unreachable', async () => {
    const userData = await mkdtemp(path.join(tmpdir(), 'whats-new-'));
    await writeFile(path.join(userData, 'whats-new.json'), '{"version":"1.0.3"}');
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify(releases)));
    const { handlers, main } = ipc();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installWhatsNew(main, { userData, current: '1.0.4', fetch });
    expect(await handlers.get(IPC.whatsNewPending)!()).toBeNull();
    expect(await handlers.get(IPC.whatsNewPending)!()).not.toBeNull();
  });
});

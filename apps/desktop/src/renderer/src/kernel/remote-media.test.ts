// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PowermoveBridge, RemoteMediaInfo } from '../../../shared/ipc';
import { installBridgeForTests, resetBridgeForTests } from './bridge';
import { fetchRemoteMedia } from './remote-media';

afterEach(() => resetBridgeForTests());

/** main's side of the download, holding `bytes` under one token. */
function remote(bytes: Uint8Array, info: Partial<RemoteMediaInfo> = {}) {
  const held: RemoteMediaInfo = { token: 'token-1', size: bytes.byteLength, name: 'photo.png', type: 'image/png', kind: 'image', ...info };
  const media = {
    fetch: vi.fn(async (_url: string) => held),
    read: vi.fn(async (_token: string, offset: number, length: number) => bytes.slice(offset, offset + length)),
    release: vi.fn(async (_token: string) => undefined)
  };
  installBridgeForTests({ remoteMedia: media } as unknown as PowermoveBridge);
  return media;
}

describe('fetchRemoteMedia', () => {
  it('reads the download back in 4 MiB chunks, decodes it, and releases it', async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024).map((_, index) => index % 251);
    const media = remote(bytes);
    const decode = vi.fn(async () => true);
    const file = await fetchRemoteMedia('https://cdn.example/photo.png', decode);
    expect(media.fetch).toHaveBeenCalledWith('https://cdn.example/photo.png');
    expect(media.read.mock.calls.map(([, offset, length]) => [offset, length])).toEqual([[0, 4 * 1024 * 1024], [4 * 1024 * 1024, 4 * 1024 * 1024], [8 * 1024 * 1024, 1024 * 1024]]);
    expect([file.name, file.type, file.size]).toEqual(['photo.png', 'image/png', bytes.byteLength]);
    expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), Buffer.from(bytes))).toBe(0);
    expect(decode).toHaveBeenCalledWith(file, 'image');
    expect(media.release).toHaveBeenCalledWith('token-1');
  });

  it('refuses bytes that do not decode, and still releases them', async () => {
    const media = remote(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]));
    await expect(fetchRemoteMedia('https://cdn.example/photo.png', async () => false)).rejects.toThrow('photo.png is not a readable image file');
    expect(media.release).toHaveBeenCalledWith('token-1');
  });

  it('refuses a short read and a bad size from the bridge', async () => {
    const short = remote(new Uint8Array(10), { size: 20 });
    await expect(fetchRemoteMedia('https://cdn.example/a.png', async () => true)).rejects.toThrow('ended early');
    expect(short.release).toHaveBeenCalled();
    remote(new Uint8Array(0));
    await expect(fetchRemoteMedia('https://cdn.example/a.png', async () => true)).rejects.toThrow('invalid size');
  });

  it('passes on main’s reason without Electron’s IPC wrapper', async () => {
    const media = remote(new Uint8Array(4));
    media.fetch.mockRejectedValueOnce(new Error("Error invoking remote method 'media:remote-fetch': RemoteMediaError: intranet.example is not reachable on the public internet"));
    await expect(fetchRemoteMedia('https://intranet.example/a.png', async () => true)).rejects.toThrow(/^intranet\.example is not reachable on the public internet$/);
  });

  it('checks the URL before asking main, and needs the desktop bridge', async () => {
    const media = remote(new Uint8Array(4));
    for (const url of ['http://cdn.example/a.png', 'file:///etc/passwd', 'https://u:p@cdn.example/a.png', 42]) {
      await expect(fetchRemoteMedia(url, async () => true)).rejects.toThrow(TypeError);
    }
    expect(media.fetch).not.toHaveBeenCalled();
    installBridgeForTests({} as PowermoveBridge);
    await expect(fetchRemoteMedia('https://cdn.example/a.png', async () => true)).rejects.toThrow('unavailable in this host');
  });
});

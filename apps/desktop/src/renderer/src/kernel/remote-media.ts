/*
 * The renderer half of `assets.importUrl`. Main downloads behind its SSRF
 * guard and keeps only bytes whose signature is media (main/remote-media.ts);
 * here the file is read back in chunks and decoded before anything imports
 * it, so a file that only starts like an image never becomes an asset.
 */
import { parseExtensionUrl } from '../../../shared/extension-url';
import type { RemoteMediaInfo } from '../../../shared/ipc';
import { bridge } from './bridge';

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_BYTES = 512 * 1024 * 1024;
const DECODE_TIMEOUT_MS = 15_000;

export type MediaKind = RemoteMediaInfo['kind'];
/** Resolves true when the browser can decode `file` as `kind`. */
export type MediaDecoder = (file: File, kind: MediaKind) => Promise<boolean>;

export const decodesAsMedia: MediaDecoder = async (file, kind) => {
  if (kind === 'image') {
    try { (await createImageBitmap(file)).close(); return true; } catch { return false; }
  }
  const element = document.createElement(kind);
  const source = URL.createObjectURL(file);
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), DECODE_TIMEOUT_MS);
      element.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(true); }, { once: true });
      element.addEventListener('error', () => { clearTimeout(timer); resolve(false); }, { once: true });
      element.muted = true;
      element.preload = 'metadata';
      element.src = source;
    });
  } finally {
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(source);
  }
};

/** Downloads `value` through main and returns it as a File that decoded as media. */
export async function fetchRemoteMedia(value: unknown, decode: MediaDecoder = decodesAsMedia): Promise<File> {
  const url = parseExtensionUrl(value);
  if (!url) throw new TypeError('assets.importUrl accepts an https URL of at most 2 KB without credentials');
  const remote = bridge()?.remoteMedia;
  if (!remote) throw new Error('assets.importUrl is unavailable in this host');
  const info = await remote.fetch(url.href);
  try {
    if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_BYTES) throw new Error('The download has an invalid size');
    const parts: Uint8Array[] = [];
    for (let offset = 0; offset < info.size;) {
      const chunk = await remote.read(info.token, offset, Math.min(CHUNK_BYTES, info.size - offset));
      if (!chunk.byteLength) throw new Error('The download ended early');
      parts.push(chunk);
      offset += chunk.byteLength;
    }
    const file = new File(parts as BlobPart[], info.name, { type: info.type });
    if (!await decode(file, info.kind)) throw new Error(`${info.name} is not a readable ${info.kind} file`);
    return file;
  } finally {
    await remote.release(info.token).catch(() => undefined);
  }
}

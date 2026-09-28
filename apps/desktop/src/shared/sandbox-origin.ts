/*
 * Where a sandboxed extension's documents live. Chromium groups frames into
 * processes by site, so one app:// host per extension is one renderer process
 * per extension (docs/sandbox-data-plane.md §1). Main (to serve, guard and
 * terminate) and the renderer (to load) must compute the same host, so this
 * module is pure and synchronous.
 */

import { sha256Hex } from './sha256';

export const SANDBOX_DOCUMENT = 'host/ext-sandbox.html';
const SLUG_LENGTH = 20, CODE_LENGTH = 26;
const SANDBOX_HOST = /^x-(?:[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?-)?[a-z2-7]{26}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * `x-<slug>-<code>`: one DNS label (at most 2 + 20 + 1 + 26 = 49 of 63 chars),
 * readable in DevTools. The code is the leading 130 bits of the id's SHA-256
 * in base32, so no one can publish an id that lands on another extension's
 * host (and so its process). SHA-256 runs in plain JS because main and the
 * renderer must agree synchronously; crypto.subtle is async.
 */
export function sandboxHost(id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, SLUG_LENGTH).replace(/^-+|-+$/g, '');
  let hash = BigInt(`0x${sha256Hex(new TextEncoder().encode(id)).slice(0, 33)}`) >> 2n, code = '';
  for (let index = 0; index < CODE_LENGTH; index++) { code = BASE32.charAt(Number(hash & 31n)) + code; hash >>= 5n; }
  return slug ? `x-${slug}-${code}` : `x-${code}`;
}

export function isSandboxHost(host: string): boolean {
  return SANDBOX_HOST.test(host);
}

/**
 * The origin a sandbox loads from. `base` is the editor's own origin for
 * sandbox content: inside Electron (`app://powermove`) each extension gets its
 * own host; the browser host (`powermove serve`) is one origin and stays so.
 */
export function sandboxOrigin(id: string, base: string): string {
  return base.startsWith('app:') ? `app://${sandboxHost(id)}` : base;
}

export function sandboxDocumentUrl(origin: string, id: string, perms: string, view?: string): string {
  return `${origin}/${SANDBOX_DOCUMENT}?id=${encodeURIComponent(id)}${view === undefined ? '' : `&view=${encodeURIComponent(view)}`}&perms=${encodeURIComponent(perms)}`;
}

/** The bundle always comes from the sandbox's own origin; only the cache-busting version is kept from the record. */
export function sandboxBundleUrl(origin: string, id: string, bundleUrl?: string | null): string {
  const version = /[?&]v=([^&#]*)/.exec(bundleUrl ?? '')?.[1];
  return `${origin}/ext/${encodeURIComponent(id)}/bundle.js${version ? `?v=${version}` : ''}`;
}

/** The extension id of an app:// sandbox document URL whose host is that id's own, else null. */
export function sandboxDocumentId(url: string): string | null {
  try {
    const target = new URL(url);
    const id = target.searchParams.get('id');
    return target.protocol === 'app:' && target.pathname === `/${SANDBOX_DOCUMENT}` && id && sandboxHost(id) === target.host ? id : null;
  } catch { return null; }
}

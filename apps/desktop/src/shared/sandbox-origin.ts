/*
 * Where a sandboxed extension's documents live. Chromium groups frames into
 * processes by site, so one app:// host per extension is one renderer process
 * per extension (docs/sandbox-data-plane.md §1). Main (to serve, guard and
 * terminate) and the renderer (to load) must compute the same host, so this
 * module is pure and synchronous.
 */

export const SANDBOX_DOCUMENT = 'host/ext-sandbox.html';
const SANDBOX_HOST = /^x-(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-)?[a-z2-7]{13}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const FNV_OFFSET = 0xcbf29ce484222325n, FNV_PRIME = 0x100000001b3n, MASK = (1n << 64n) - 1n;

export function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  return hash;
}

/** `x-<slug>-<hash>`: one DNS label, readable in DevTools, and the 64-bit hash keeps distinct ids apart. */
export function sandboxHost(id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-+|-+$/g, '');
  let hash = fnv1a64(id), code = '';
  for (let index = 0; index < 13; index++) { code = BASE32.charAt(Number(hash & 31n)) + code; hash >>= 5n; }
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

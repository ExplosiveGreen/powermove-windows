/* The one rule for a URL an extension hands the host, to open
   (`ui.openExternal`) or to fetch (`assets.importUrl`). The renderer checks it
   before asking anyone, and main checks it again before acting, so neither
   trusts the other's copy. */

/** The longest URL an extension may pass: 2 KB, measured on the serialized form too. */
export const EXTENSION_URL_MAX = 2048;

/** An https URL with a host and no credentials, at most 2 KB; null otherwise. */
export function parseExtensionUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > EXTENSION_URL_MAX) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
  return url.href.length > EXTENSION_URL_MAX ? null : url;
}

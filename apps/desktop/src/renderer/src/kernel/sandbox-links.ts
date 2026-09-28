/*
 * `ui.openExternal` for a sandboxed extension. Everything here is decided on
 * the host from the kernel's own manifest record, never from what the sandbox
 * says about itself:
 *
 *  - only https URLs up to 2 KB (main checks the same rule again);
 *  - one request at a time, at most one every 2 s;
 *  - an origin listed in the manifest's `links` opens without asking, but only
 *    when the extension also declares `network`: without it, opening a URL
 *    would be its one way to send project data out, so every URL asks;
 *  - any other URL is shown in full in a host sheet. The sheet names the
 *    extension by the kernel record's id in fixed wording, never by the
 *    manifest's display name, which the extension chooses (`"Powermove"`).
 */
import type { ExtensionManifest } from '../../../shared/extensions';
import { parseExtensionUrl } from '../../../shared/extension-url';
import type { UIAPI } from './api';

export const OPEN_EXTERNAL_INTERVAL_MS = 2_000;

/**
 * The app document's transient user activation: a real click or key press in
 * it, or in any frame inside it (a sandboxed view's included), within the
 * last 5 s. The browser keeps it; nothing a sandbox sends can set it.
 */
export function userActivated(): boolean {
  return (globalThis.navigator as { userActivation?: { isActive?: boolean } } | undefined)?.userActivation?.isActive === true;
}

function limited(message: string): Error {
  return Object.assign(new Error(message), { name: 'PermissionError', code: 'resource_limit' });
}

/** The sheet's title: says an extension is asking, and which one. */
export function openExternalPrompt(id: string): string {
  return `The extension “${id}” wants to open a link in your browser`;
}

export function sandboxOpenExternal(options: {
  /** The kernel record's id. */
  id: string;
  /** Read on every call: the record's manifest is the only source of `permissions` and `links`. */
  manifest: () => Pick<ExtensionManifest, 'permissions' | 'links'>;
  ui: Pick<UIAPI, 'confirm' | 'openExternal'>;
  now?: () => number;
}): (value: unknown) => Promise<boolean> {
  const now = options.now ?? (() => performance.now());
  let pending = false;
  let last = -Infinity;
  return async (value) => {
    const url = parseExtensionUrl(value);
    if (!url) throw new TypeError('ui.openExternal accepts an https URL of at most 2 KB without credentials');
    if (pending) throw limited('ui.openExternal is still waiting on the previous link');
    const at = now();
    if (at - last < OPEN_EXTERNAL_INTERVAL_MS) throw limited('ui.openExternal opens at most one link every 2 seconds');
    pending = true; last = at;
    try {
      const manifest = options.manifest();
      const listed = (manifest.permissions ?? []).includes('network') && (manifest.links ?? []).includes(url.origin);
      if (!listed && !await options.ui.confirm(openExternalPrompt(options.id), url.href)) return false;
      await options.ui.openExternal(url.href);
      return true;
    } finally { pending = false; }
  };
}

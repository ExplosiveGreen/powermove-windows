/*
 * `ui.openExternal` for a sandboxed extension. Everything here is decided on
 * the host from the kernel's own manifest record, never from what the sandbox
 * says about itself:
 *
 *  - only https URLs up to 2 KB (main checks the same rule again, and opens
 *    nothing unless the window has focus);
 *  - one request at a time, at most one every 2 s;
 *  - an origin listed in the manifest's `links` opens without asking only when
 *    the extension also declares `network` (without it, opening a URL would be
 *    its one way to send project data out), only when the call answers a
 *    person's action as the host saw it (`gesture`: a focused view of the
 *    extension right after a real click or key press, or a run the host
 *    started from one), and at most 3 times a minute;
 *  - anything else is shown in full in a host sheet. The sheet names the
 *    extension by the kernel record's id in fixed wording, never by the
 *    manifest's display name, which the extension chooses (`"Powermove"`).
 *    Once the person declines, the extension cannot ask again for 30 s.
 */
import type { ExtensionManifest } from '../../../shared/extensions';
import { parseExtensionUrl } from '../../../shared/extension-url';
import type { UIAPI } from './api';

export const OPEN_EXTERNAL_INTERVAL_MS = 2_000;
/** Links opened without asking, per minute; past it each one asks. */
export const OPEN_EXTERNAL_DIRECT_PER_MINUTE = 3;
/** After a person declines, how long the extension's links are refused without asking. */
export const OPEN_EXTERNAL_DECLINED_MS = 30_000;

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
}): (value: unknown, gesture: boolean) => Promise<boolean> {
  const now = options.now ?? (() => performance.now());
  let pending = false;
  let last = -Infinity;
  let declinedAt = -Infinity;
  const direct: number[] = [];
  return async (value, gesture) => {
    const url = parseExtensionUrl(value);
    if (!url) throw new TypeError('ui.openExternal accepts an https URL of at most 2 KB without credentials');
    if (pending) throw limited('ui.openExternal is still waiting on the previous link');
    const at = now();
    if (at - last < OPEN_EXTERNAL_INTERVAL_MS) throw limited('ui.openExternal opens at most one link every 2 seconds');
    const manifest = options.manifest();
    const listed = (manifest.permissions ?? []).includes('network') && (manifest.links ?? []).includes(url.origin);
    while (direct.length && at - direct[0]! >= 60_000) direct.shift();
    const ask = !(listed && gesture && direct.length < OPEN_EXTERNAL_DIRECT_PER_MINUTE);
    if (ask && at - declinedAt < OPEN_EXTERNAL_DECLINED_MS) throw limited('ui.openExternal cannot ask again for 30 seconds after the person declined');
    pending = true; last = at;
    try {
      if (!ask) direct.push(at);
      else if (!await options.ui.confirm(openExternalPrompt(options.id), url.href)) { declinedAt = now(); return false; }
      await options.ui.openExternal(url.href);
      return true;
    } finally { pending = false; }
  };
}

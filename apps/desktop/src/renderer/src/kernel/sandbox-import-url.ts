/*
 * `assets.importUrl` for a sandboxed extension. The host requires both
 * `assets` and `network` from the kernel's manifest record (a download is the
 * network reaching somewhere, and its result lands in the project), and runs
 * one download per extension at a time. Main enforces the address guard, the
 * redirect checks and the 512 MiB cap; the import is the normal asset path.
 */
import type { ExtensionManifest } from '../../../shared/extensions';
import type { AssetsAPI } from './api';

function denied(message: string, code: string): Error {
  return Object.assign(new Error(message), { name: 'PermissionError', code });
}

export function sandboxImportUrl(options: {
  manifest: () => Pick<ExtensionManifest, 'permissions'>;
  assets: Pick<AssetsAPI, 'importUrl'>;
}): (url: unknown) => Promise<string> {
  let pending = false;
  return async (url) => {
    const permissions = options.manifest().permissions ?? [];
    if (!permissions.includes('assets')) throw denied('assets.importUrl requires assets permission', 'assets');
    if (!permissions.includes('network')) throw denied('assets.importUrl requires network permission', 'network');
    if (pending) throw denied('assets.importUrl downloads one URL at a time', 'resource_limit');
    pending = true;
    try { return await options.assets.importUrl(String(url)); } finally { pending = false; }
  };
}

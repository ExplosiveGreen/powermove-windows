import type { PowermoveAPI } from 'powermove';

/* A Store extension that opens links and imports media by URL. Its frames are
   opaque to Playwright, so each command returns its outcome as plain data. */
export default function activate(api: PowermoveAPI) {
  const attempt = async (work: () => Promise<unknown>) => {
    try { return { ok: await work() }; }
    catch (error) { return { error: String((error as Error)?.message ?? error), code: (error as { code?: string })?.code ?? null }; }
  };
  api.commands.register({ id: `${api.id}.import`, label: 'Import from URL', run: (url: unknown) => attempt(() => api.assets.importUrl(String(url))) });
  api.commands.register({ id: `${api.id}.open`, label: 'Open link', run: (url: unknown) => attempt(() => api.ui.openExternal(String(url))) });
}

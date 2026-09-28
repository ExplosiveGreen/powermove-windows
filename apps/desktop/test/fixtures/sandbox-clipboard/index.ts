import type { PowermoveAPI } from 'powermove';

/* A Store panel with two buttons: Import makes a ~5 MB PNG of noise and
   imports it, Copy copies a line of text. Each stores its outcome, which
   the `outcome` command reads back: a spec cannot look inside the
   out-of-process view. The first pointer press anywhere in the view is
   stored too, so a spec knows its clicks arrive before it presses a button. */
async function noisePng(width = 1400, height = 1200): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  const bytes = image.data;
  for (let offset = 0; offset < bytes.length; offset += 65_536) crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
  for (let index = 3; index < bytes.length; index += 4) bytes[index] = 255;
  context.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export default function activate(api: PowermoveAPI) {
  api.commands.register({ id: `${api.id}.outcome`, label: 'Outcome', run: async () => ({ armed: await api.storage.get('armed') ?? false, import: await api.storage.get('import') ?? null, copy: await api.storage.get('copy') ?? null }) });
  api.panels.register({ id: `${api.id}.panel`, title: 'Clipboard and import', size: 240, build: (body) => {
    body.ownerDocument.addEventListener('pointerdown', () => void api.storage.set('armed', true), { once: true });
    const button = (label: string, key: string, run: () => Promise<Record<string, unknown>>) => {
      const element = document.createElement('button');
      element.textContent = label;
      element.dataset.action = key;
      element.style.cssText = 'display:block;width:100%;height:64px;margin:0 0 8px';
      element.addEventListener('click', () => {
        void run().then(result => api.storage.set(key, { ok: true, ...result }), (error: Error) => api.storage.set(key, { ok: false, error: String(error?.message ?? error) }));
      });
      body.append(element);
    };
    button('Import', 'import', async () => {
      const blob = await noisePng();
      const asset = await api.assets.import(new File([blob], 'noise.png', { type: 'image/png' }));
      return { id: asset.id, size: blob.size };
    });
    button('Copy', 'copy', async () => {
      await api.ui.copy!(`Copied by ${api.id}`);
      return {};
    });
  } });
}

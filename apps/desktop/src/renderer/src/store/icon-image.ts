/* Store icons: people choose any image; the sheet makes the upload. It is
   cropped to the square they framed (its centre square by default), drawn at 512px (never upscaled), and
   encoded as PNG, stepping down in size until it fits the registry's
   256 KB cap (PUBLISH_LIMITS.iconBytes). checkIconBytes then checks the
   result exactly as main and the registry will. */
import { PUBLISH_LIMITS } from '../../../shared/publish';
import { checkIconBytes, type IconResult } from './publish-form';

/** What the picker takes before any work is done. */
export const ICON_INPUT_MAX_BYTES = 20 * 1024 * 1024;
export const ICON_INPUT_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
/** Below this the icon would be visibly soft on the store's detail page. */
export const ICON_MIN_SIDE = 128;
const ICON_SIDES = [512, 448, 384, 320, 256];

export type IconCrop = { x: number; y: number; side: number };

export type IconPlan =
  | { ok: true; crop: IconCrop; sides: number[] }
  | { ok: false; error: string };

/** A framed square kept whole inside a width × height image, in whole pixels. */
export function clampCrop(crop: IconCrop, width: number, height: number): IconCrop {
  const side = Math.min(Math.max(1, Math.round(crop.side)), Math.min(width, height));
  const clamp = (value: number, max: number) => Math.min(Math.max(0, Math.round(value)), max);
  return { x: clamp(crop.x, width - side), y: clamp(crop.y, height - side), side };
}

/** The square to use (the framed one, else the centre square) and the sizes to try, largest first. */
export function planIcon(width: number, height: number, framed?: IconCrop): IconPlan {
  const short = Math.min(width, height);
  if (!Number.isFinite(short) || short < ICON_MIN_SIDE) return { ok: false, error: `Choose an image at least ${ICON_MIN_SIDE} pixels on its short side.` };
  const crop = framed ? clampCrop(framed, width, height) : { x: Math.floor((width - short) / 2), y: Math.floor((height - short) / 2), side: short };
  const side = crop.side;
  if (side < ICON_MIN_SIDE) return { ok: false, error: `Zoom out a little. The icon needs at least ${ICON_MIN_SIDE} pixels of the image.` };
  const sides = ICON_SIDES.filter((candidate) => candidate < side);
  return { ok: true, crop, sides: side <= ICON_SIDES[0]! ? [side, ...sides] : sides };
}

export type PreparedIcon = { ok: true; base64: string; png: Blob } | { ok: false; error: string };

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Crop, resize and compress a chosen file into the icon the registry takes. */
export async function prepareIcon(file: Blob, crop?: IconCrop): Promise<PreparedIcon> {
  if (file.size > ICON_INPUT_MAX_BYTES) return { ok: false, error: 'Choose an image of 20 MB or smaller.' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'Powermove can’t read this image. Choose a PNG, JPEG or WebP.' };
  }
  try {
    const plan = planIcon(bitmap.width, bitmap.height, crop);
    if (!plan.ok) return plan;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, error: 'Powermove couldn’t prepare the icon. Try again.' };
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const { x, y, side } = plan.crop;
    for (const size of plan.sides) {
      canvas.width = canvas.height = size;
      context.clearRect(0, 0, size, size);
      context.drawImage(bitmap, x, y, side, side, 0, 0, size, size);
      const png = await encode(canvas);
      if (!png || png.size > PUBLISH_LIMITS.iconBytes) continue;
      const checked: IconResult = checkIconBytes(new Uint8Array(await png.arrayBuffer()));
      return checked.ok ? { ok: true, base64: checked.base64, png } : checked;
    }
    return { ok: false, error: 'This image is too detailed to make a small enough icon. Try a simpler one.' };
  } finally {
    bitmap.close();
  }
}

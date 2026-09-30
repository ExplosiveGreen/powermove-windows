import { resolveContent } from './content-properties';
import { fontAnchorOffset } from './font-anchor';

const sizedTypes = new Set(['shape', 'solid', 'image', 'video', 'shader', 'extension', 'precomp']);

/** Native content bounds, excluding stroke and raster padding. */
export function sizeBounds(PM: any, layer: any, time: number) {
  if (!layer || !sizedTypes.has(layer.type) || layer.type === 'shape' && layer.d.paths?.length) return null;
  const d = resolveContent(PM, layer, time);
  const w = Number(d.w || PM.proj.w), h = Number(d.h || PM.proj.h);
  if (![w, h].every(value => Number.isFinite(value) && value > 0)) return null;
  const centered = ['shape', 'image', 'video'].includes(layer.type);
  return { x0: centered ? -w / 2 : 0, y0: centered ? -h / 2 : 0,
    x1: centered ? w / 2 : w, y1: centered ? h / 2 : h };
}

export function sizeAnchorOffset(PM: any, layer: any, time: number) {
  if (!layer.d?.sizeAnchorBounds) return { x: 0, y: 0 };
  return fontAnchorOffset(layer.d.sizeAnchorBounds, sizeBounds(PM, layer, time),
    PM.ev(layer, 'anchor.x', time), PM.ev(layer, 'anchor.y', time));
}

export function captureSizeAnchor(PM: any, layer: any, command: any) {
  if (!layer || layer.d?.sizeAnchorBounds) return;
  const fields = command.type === 'set_content' ? Object.keys(command.patch || {})
    : ['set_property', 'replace_keyframes', 'set_expression'].includes(command.type)
      ? [String(command.path || command.channel || '').replace(/^c\./, '')] : [];
  if (!fields.some(key => key === 'w' || key === 'h')) return;
  const bounds = sizeBounds(PM, layer, command.time ?? PM.time);
  if (bounds) layer.d.sizeAnchorBounds = bounds;
}

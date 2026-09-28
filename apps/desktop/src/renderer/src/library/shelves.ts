/* The Library shelves panels like books: grouped by where they came from, and
   each shown at one shared scale so a wide Timeline stays wide and a tall
   Inspector stays tall. Everything here is pure so the packing is testable. */
import type { LibraryItemDto } from '../../../shared/store-ipc';
import type { PanelPreviewSize } from './panel-preview';

export type ShelfId = 'builtin' | 'yours' | 'store';

export const SHELF_ORDER: ShelfId[] = ['builtin', 'yours', 'store'];

export const SHELF_LABEL: Record<ShelfId, string> = {
  builtin: 'Built in',
  yours: 'Made by you',
  store: 'From the Store'
};

export interface PanelSource {
  shelf: ShelfId;
  /** The extension that registered the panel, when there is one. */
  extensionId?: string;
  /** "by mara" for a Store install. */
  maker?: string;
}

export interface SourceInput {
  ownerId?: string | undefined;
  record?: { scope?: string; trust?: string } | undefined;
  item?: Pick<LibraryItemDto, 'group' | 'maker'> | undefined;
  /** A workspace section the agent generated; it has no extension owner. */
  generated?: boolean;
}

/** Which shelf a panel stands on. The Store's own grouping wins, then the loader record. */
export function panelSource({ ownerId, record, item, generated }: SourceInput): PanelSource {
  const extensionId = ownerId || undefined;
  if (item) {
    const maker = 'handle' in item.maker ? `by ${item.maker.handle}` : undefined;
    return { shelf: item.group, extensionId, ...(maker ? { maker } : {}) };
  }
  if (record) {
    if (record.trust === 'store' || record.trust === 'store-trusted') return { shelf: 'store', extensionId };
    if (record.scope === 'builtin' || record.trust === 'builtin') return { shelf: 'builtin', extensionId };
    return { shelf: 'yours', extensionId };
  }
  return { shelf: generated ? 'yours' : 'builtin', extensionId };
}

/* A default 360px-wide panel reads at roughly 180px; the scale follows the
   room the shelves have, within bounds that keep previews legible. */
const MIN_SCALE = 0.4;
const MAX_SCALE = 0.56;
const SCALE_WIDTH = 1700;
/* A panel longer or wider than this is cropped, like a book's cover shows
   only its front: a 35-mod list or a long agent thread would otherwise
   become a sliver on the shelf. */
export const MAX_PREVIEW_WIDTH = 960;
export const MAX_PREVIEW_HEIGHT = 720;
/** A last guard on screen size; the preview caps keep covers under it at every scale. */
export const MAX_COVER_HEIGHT = 420;

/** The part of a panel a cover shows. */
export function previewBounds(size: PanelPreviewSize): PanelPreviewSize {
  return { width: Math.min(size.width, MAX_PREVIEW_WIDTH), height: Math.min(size.height, MAX_PREVIEW_HEIGHT) };
}

export function shelfScale(shelfWidth: number): number {
  if (!Number.isFinite(shelfWidth) || shelfWidth <= 0) return 0.5;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, shelfWidth / SCALE_WIDTH));
}

export interface CoverSize {
  width: number;
  height: number;
  scale: number;
}

/**
 * One shared scale for every panel, so their sizes compare honestly. The
 * panel is first cropped to the preview bounds; a cover that still exceeds
 * the shelf's width or MAX_COVER_HEIGHT is shrunk whole.
 */
export function coverSize(panel: PanelPreviewSize, scale: number, maxWidth = Infinity): CoverSize {
  const size = previewBounds(panel);
  const fit = Math.min(scale, MAX_COVER_HEIGHT / size.height, maxWidth / size.width);
  const next = Number.isFinite(fit) && fit > 0 ? fit : scale;
  return { width: Math.round(size.width * next), height: Math.round(size.height * next), scale: next };
}

/** Greedy left-to-right rows, like books along a shelf; a book wider than the shelf gets a row of its own. */
export function packRows<T>(items: readonly T[], widthOf: (item: T) => number, shelfWidth: number, gap: number): T[][] {
  const rows: T[][] = [];
  let row: T[] = [];
  let used = 0;
  for (const item of items) {
    const width = widthOf(item);
    const next = row.length ? used + gap + width : width;
    if (row.length && next > shelfWidth) {
      rows.push(row);
      row = [item];
      used = width;
    } else {
      row.push(item);
      used = next;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

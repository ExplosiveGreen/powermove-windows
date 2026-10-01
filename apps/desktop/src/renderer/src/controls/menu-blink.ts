// The macOS pick: a chosen menu row goes dark for a beat and lights again
// before the menu closes, so you see your click land on the right item.
// Native NSMenus do this themselves; our DOM menus call blink() between the
// pick and the close. Reduced motion skips it and picks on the same frame.

// Half the blink: off this long, then on this long (90ms in all).
export const BLINK_MS = 45;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Turns a row's highlight off, then on, then calls `done`. */
export function blink(row: HTMLElement, done: () => void): void {
  if (prefersReducedMotion()) { done(); return; }
  row.dataset.blink = 'off';
  window.setTimeout(() => {
    row.dataset.blink = 'on';
    window.setTimeout(() => { delete row.dataset.blink; done(); }, BLINK_MS);
  }, BLINK_MS);
}

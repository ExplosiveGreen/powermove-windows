import { expect, it } from 'vitest';
import { ownId } from './sandbox-host';

// A sandboxed extension owns the bare extension id and anything under `<id>.`.
// The bare id is unique so it can't impersonate another owner; the dot is still
// required for suffixes so `foo` can't claim a sibling `foo-bar`'s namespace.
it('accepts the bare extension id and its dot-namespace, rejects siblings/foreign', () => {
  expect(ownId('contour-hud', 'contour-hud')).toBe(true);
  expect(ownId('contour-hud', 'contour-hud.panel')).toBe(true);
  expect(ownId('contour-hud', 'contour-hud-extra')).toBe(false);
  expect(ownId('foo', 'foo-bar.command')).toBe(false);
  expect(ownId('foo', 'bar')).toBe(false);
});

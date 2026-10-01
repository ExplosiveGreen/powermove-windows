import { expect, it } from 'vitest';
import { ownId, qualifyId } from './sandbox-host';

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

// The system relocates any id into the extension's namespace (idempotent), so authors
// use bare ids and nothing can land outside their own namespace.
it('qualifies bare and foreign ids into the extension namespace, leaves own ids alone', () => {
  expect(qualifyId('contour-hud', 'hud')).toBe('contour-hud.hud');
  expect(qualifyId('contour-hud', 'contour-hud')).toBe('contour-hud');
  expect(qualifyId('contour-hud', 'contour-hud.panel')).toBe('contour-hud.panel');
  expect(qualifyId('contour-hud', 'blur')).toBe('contour-hud.blur');
  expect(qualifyId('foo', 'foo-bar.command')).toBe('foo.foo-bar.command');
});

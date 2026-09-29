import { expect, it } from 'vitest';
import { isNewerVersion } from './runtime-updates';

it('only treats strictly higher versions as newer', () => {
  expect(isNewerVersion('2.1.284', '2.1.280')).toBe(true);
  expect(isNewerVersion('2.2.0', '2.1.999')).toBe(true);
  expect(isNewerVersion('2.1.280', '2.1.280')).toBe(false);
  expect(isNewerVersion('2.1.279', '2.1.280')).toBe(false);
});

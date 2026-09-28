import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { Sha256, sha256Hex, sha256HexOf } from './sha256';

describe('sha256Hex', () => {
  it('matches Node across arbitrary chunk boundaries without retaining the input', () => {
    const bytes = new Uint8Array(70001).map((_, i) => i % 251);
    for (const chunkSize of [1, 7, 63, 64, 65, 1000, 65536]) {
      const digest = new Sha256();
      for (let offset = 0; offset < bytes.length; offset += chunkSize) digest.update(bytes.subarray(offset, offset + chunkSize));
      expect(digest.digest()).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(() => digest.update(bytes)).toThrow('finished');
    }
  });
  it('matches node for empty, short, block-boundary and long inputs', () => {
    for (const size of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('hashes text like the fingerprint does', async () => {
    const bytes = new TextEncoder().encode('{"layers":[]}');
    expect(await sha256HexOf(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});

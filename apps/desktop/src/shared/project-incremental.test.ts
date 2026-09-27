import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';
import { decodeProjectContainer } from './project-container';
import { INCREMENTAL_MAGIC, projectFooter, readProjectFooter, validateProjectIndex, type ProjectIndex } from './project-incremental';

function fixture() {
  const document = new TextEncoder().encode(JSON.stringify({ proj: { w: 10, h: 10, layers: [] } }));
  const media = new Uint8Array([3, 2, 1]);
  const index: ProjectIndex = { version: 4, document: { offset: 5, length: document.length, sha256: sha256Hex(document) },
    media: [{ id: 'clip', revision: 'one', type: 'video/webm', offset: 5 + document.length, length: media.length, sha256: sha256Hex(media) }] };
  const raw = new TextEncoder().encode(JSON.stringify(index));
  const offset = 5 + document.length + media.length;
  const footer = projectFooter(offset, raw.length, sha256Hex(raw));
  const bytes = new Uint8Array(offset + raw.length + footer.length);
  bytes.set(INCREMENTAL_MAGIC); bytes.set(document, 5); bytes.set(media, index.media[0]!.offset); bytes.set(raw, offset); bytes.set(footer, offset + raw.length);
  return { bytes, index, offset, footer };
}
describe('PMV4 portable format', () => {
  it('round trips document and media through the common decoder', () => {
    const decoded = decodeProjectContainer(fixture().bytes);
    expect(decoded.document.proj).toEqual({ w: 10, h: 10, layers: [] });
    expect([...decoded.media[0]!.data]).toEqual([3, 2, 1]);
  });
  it('rejects a corrupt index and corrupt document', () => {
    const { bytes, offset } = fixture(); bytes[offset + 10] = bytes[offset + 10]! ^ 1;
    expect(() => decodeProjectContainer(bytes)).toThrow('checksum');
    const other = fixture().bytes; other[9] = other[9]! ^ 1;
    expect(() => decodeProjectContainer(other)).toThrow('checksum');
  });
  it('rejects oversized indexes before allocating or reading them', () => {
    const { footer } = fixture(); new DataView(footer.buffer).setUint32(16, 0xffffffff, true);
    expect(() => readProjectFooter(footer, 0xffffffff + 100)).toThrow('invalid');
  });
  it('rejects overlapping ranges, duplicate ids, unsafe offsets, and bad hashes', () => {
    for (const mutate of [
      (index: ProjectIndex) => { index.media[0]!.offset = 5; },
      (index: ProjectIndex) => { index.media.push({ ...index.media[0]! }); },
      (index: ProjectIndex) => { index.document.offset = Number.MAX_SAFE_INTEGER + 1; },
      (index: ProjectIndex) => { index.media[0]!.sha256 = 'invalid'; },
    ]) {
      const { index, offset } = fixture(); mutate(index);
      expect(() => validateProjectIndex(index, offset)).toThrow();
    }
  });
});

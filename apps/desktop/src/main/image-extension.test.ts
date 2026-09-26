import { describe, expect, it } from 'vitest';

import { imageExtension } from './image-extension';

const bytes = (text: string, ...prefix: number[]) => new Uint8Array([...prefix, ...[...text].map(char => char.charCodeAt(0))]);

describe('imageExtension', () => {
  it('names each attachment type the agent accepts by its real format', () => {
    expect(imageExtension(bytes('PNG\r\n\x1a\n', 0x89))).toBe('png');
    expect(imageExtension(bytes('GIF89a'))).toBe('gif');
    expect(imageExtension(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(imageExtension(bytes('RIFF\0\0\0\0WAVE'))).toBe('jpg');
    expect(imageExtension(new Uint8Array())).toBe('jpg');
  });
});

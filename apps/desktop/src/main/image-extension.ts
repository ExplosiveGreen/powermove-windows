/* Agent runtimes infer an image's media type from its file extension, so a
   WebP or GIF attachment written as `.jpg` reaches the model mislabelled. */
export function imageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' {
  const ascii = (start: number, text: string): boolean =>
    bytes.length >= start + text.length && [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 'PNG\r\n\x1a\n')) return 'png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  return 'jpg';
}

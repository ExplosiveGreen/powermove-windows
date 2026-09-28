import { describe, expect, it } from 'vitest';
import { EXTENSION_URL_MAX, parseExtensionUrl } from './extension-url';

describe('extension URLs', () => {
  it('accepts https URLs and returns their serialized form', () => {
    expect(parseExtensionUrl('https://replicate.com/account/api-tokens?from=powermove#top')?.href)
      .toBe('https://replicate.com/account/api-tokens?from=powermove#top');
    // Hosts serialize as punycode and paths percent-encode, so the prompt shows ASCII only.
    expect(parseExtensionUrl('https://bücher.example/ä b')?.href).toBe('https://xn--bcher-kva.example/%C3%A4%20b');
  });

  it('refuses every other scheme, credentials, junk and non-strings', () => {
    for (const value of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'blob:https://example.com/x',
      'powermove://store', 'mailto:a@example.com', 'wss://example.com', 'https://user:pass@example.com', 'https://user@example.com', 'https://', 'not a url', '',
      42, null, undefined, { href: 'https://example.com' }]) {
      expect(parseExtensionUrl(value)).toBeNull();
    }
  });

  it('caps the URL at 2 KB, before and after serializing', () => {
    const base = 'https://example.com/';
    expect(parseExtensionUrl(base + 'a'.repeat(EXTENSION_URL_MAX - base.length))).not.toBeNull();
    expect(parseExtensionUrl(base + 'a'.repeat(EXTENSION_URL_MAX - base.length + 1))).toBeNull();
    // 600 characters that each percent-encode to nine bytes.
    expect(parseExtensionUrl(base + 'ä'.repeat(600))).toBeNull();
  });
});

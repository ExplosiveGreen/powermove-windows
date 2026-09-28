import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isSandboxHost, sandboxBundleUrl, sandboxDocumentId, sandboxDocumentUrl, sandboxHost, sandboxOrigin } from './sandbox-origin';

describe('sandboxHost', () => {
  /* RFC 4648 base32 of the digest's leading 130 bits, spelled out bit by bit. */
  const reference = (hex: string): string => {
    const bits = [...Buffer.from(hex, 'hex')].map(byte => byte.toString(2).padStart(8, '0')).join('').slice(0, 130);
    return bits.match(/.{5}/g)!.map(chunk => 'abcdefghijklmnopqrstuvwxyz234567'.charAt(parseInt(chunk, 2))).join('');
  };
  const code = (host: string): string => host.slice(-26);

  it('codes the id with SHA-256', () => {
    // FIPS 180-2 vectors: "abc" and the empty string (literals from Python's base64.b32encode).
    expect(code(sandboxHost('abc'))).toBe(reference('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
    expect(code(sandboxHost('abc'))).toBe('xj4bnp4pahh6uqkbidpf3lrceo');
    expect(sandboxHost('')).toBe(`x-${reference('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')}`);
    expect(sandboxHost('')).toBe('x-4oymiquy7qobjgx36tejs35zeq');
  });

  it('matches node:crypto for random ids', () => {
    for (let round = 0; round < 200; round++) {
      const id = randomBytes(1 + (round % 64)).toString('base64url');
      expect(code(sandboxHost(id))).toBe(reference(createHash('sha256').update(id, 'utf8').digest('hex')));
    }
    const unicode = 'ünïcode-☃';
    expect(code(sandboxHost(unicode))).toBe(reference(createHash('sha256').update(unicode, 'utf8').digest('hex')));
  });

  it('stays one DNS label for the longest ids', () => {
    const host = sandboxHost('a'.repeat(64));
    expect(host.length).toBeLessThanOrEqual(63);
    expect(host).toMatch(/^x-a{20}-[a-z2-7]{26}$/);
  });

  it('is a readable DNS label with a base32 hash', () => {
    const host = sandboxHost('sandboxed-ext');
    expect(host).toBe('x-sandboxed-ext-vkyvbqsl7rchbesnaeceq5ga5t');
    expect(host).toBe(sandboxHost('sandboxed-ext'));
    expect(isSandboxHost(host)).toBe(true);
    expect(new URL(`app://${host}/`).host).toBe(host);
  });

  it('slugs to at most 20 characters without edge or doubled dashes', () => {
    expect(sandboxHost('a-very-long-extension-identifier-here')).toMatch(/^x-a-very-long-extensio-[a-z2-7]{26}$/);
    expect(sandboxHost('abcdefghijklmnopqrst-uvw')).toMatch(/^x-abcdefghijklmnopqrst-[a-z2-7]{26}$/);
    expect(sandboxHost('abcdefghijklmnopqrs-tuvw')).toMatch(/^x-abcdefghijklmnopqrs-[a-z2-7]{26}$/);
    expect(sandboxHost('--Weird__ID..')).toMatch(/^x-weird-id-[a-z2-7]{26}$/);
    expect(sandboxHost('___')).toMatch(/^x-[a-z2-7]{26}$/);
    for (const id of ['a', 'x-y', '--Weird__ID..', '___', 'ünïcode']) expect(isSandboxHost(sandboxHost(id))).toBe(true);
  });

  it('keeps ids that share a slug apart', () => {
    const ids = ['my-extension', 'My-Extension', 'my_extension', 'my.extension', 'a-very-long-extension-one', 'a-very-long-extension-two'];
    expect(new Set(ids.map(sandboxHost)).size).toBe(ids.length);
  });

  it('never looks like the editor host', () => {
    expect(isSandboxHost('powermove')).toBe(false);
    expect(isSandboxHost('localhost:5173')).toBe(false);
    expect(isSandboxHost('x--aaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    // The old 13-character FNV code and an over-long slug are not sandbox hosts.
    expect(isSandboxHost('x-sandboxed-ext-aaaaaaaaaaaaa')).toBe(false);
    expect(isSandboxHost(`x-${'a'.repeat(21)}-${'a'.repeat(26)}`)).toBe(false);
  });
});

describe('sandbox URLs', () => {
  const host = sandboxHost('sandboxed-ext');

  it('gives each extension its own app:// origin inside Electron only', () => {
    expect(sandboxOrigin('sandboxed-ext', 'app://powermove')).toBe(`app://${host}`);
    expect(sandboxOrigin('sandboxed-ext', 'http://192.168.1.4:4000')).toBe('http://192.168.1.4:4000');
  });

  it('builds runtime, view and bundle URLs on that origin', () => {
    const origin = `app://${host}`;
    expect(sandboxDocumentUrl(origin, 'sandboxed-ext', 'network,project:write'))
      .toBe(`${origin}/host/ext-sandbox.html?id=sandboxed-ext&perms=network%2Cproject%3Awrite`);
    expect(sandboxDocumentUrl(origin, 'sandboxed-ext', '', 'sandboxed-ext.panel'))
      .toBe(`${origin}/host/ext-sandbox.html?id=sandboxed-ext&view=sandboxed-ext.panel&perms=`);
    expect(sandboxBundleUrl(origin, 'sandboxed-ext', 'app://powermove/ext/sandboxed-ext/bundle.js?v=abc123')).toBe(`${origin}/ext/sandboxed-ext/bundle.js?v=abc123`);
    expect(sandboxBundleUrl(origin, 'sandboxed-ext', null)).toBe(`${origin}/ext/sandboxed-ext/bundle.js`);
    expect(sandboxBundleUrl('http://127.0.0.1:4000', 'sandboxed-ext', 'http://127.0.0.1:4000/ext/sandboxed-ext/bundle.js?v=1')).toBe('http://127.0.0.1:4000/ext/sandboxed-ext/bundle.js?v=1');
  });

  it('recognises a sandbox document only on its own host', () => {
    const url = sandboxDocumentUrl(`app://${host}`, 'sandboxed-ext', '');
    expect(sandboxDocumentId(url)).toBe('sandboxed-ext');
    expect(sandboxDocumentId(url.replace('sandboxed-ext&', 'other-ext&'))).toBeNull();
    expect(sandboxDocumentId(`app://powermove/host/ext-sandbox.html?id=sandboxed-ext&perms=`)).toBeNull();
    expect(sandboxDocumentId(`app://${host}/host/sandbox.html?id=sandboxed-ext`)).toBeNull();
    expect(sandboxDocumentId(`https://${host}/host/ext-sandbox.html?id=sandboxed-ext`)).toBeNull();
    expect(sandboxDocumentId('not a url')).toBeNull();
  });
});

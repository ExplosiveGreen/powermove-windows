import { describe, expect, it } from 'vitest';
import { fnv1a64, isSandboxHost, sandboxBundleUrl, sandboxDocumentId, sandboxDocumentUrl, sandboxHost, sandboxOrigin } from './sandbox-origin';

describe('sandboxHost', () => {
  it('uses the reference FNV-1a 64-bit hash', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
    expect(fnv1a64('a')).toBe(0xaf63dc4c8601ec8cn);
    expect(fnv1a64('foobar')).toBe(0x85944171f73967e8n);
  });

  it('is a readable DNS label with a base32 hash', () => {
    const host = sandboxHost('sandboxed-ext');
    expect(host).toMatch(/^x-sandboxed-ext-[a-z2-7]{13}$/);
    expect(host).toBe(sandboxHost('sandboxed-ext'));
    expect(isSandboxHost(host)).toBe(true);
    expect(new URL(`app://${host}/`).host).toBe(host);
  });

  it('slugs to at most 20 characters without edge or doubled dashes', () => {
    expect(sandboxHost('a-very-long-extension-identifier-here')).toMatch(/^x-a-very-long-extensio-[a-z2-7]{13}$/);
    expect(sandboxHost('abcdefghijklmnopqrst-uvw')).toMatch(/^x-abcdefghijklmnopqrst-[a-z2-7]{13}$/);
    expect(sandboxHost('abcdefghijklmnopqrs-tuvw')).toMatch(/^x-abcdefghijklmnopqrs-[a-z2-7]{13}$/);
    expect(sandboxHost('--Weird__ID..')).toMatch(/^x-weird-id-[a-z2-7]{13}$/);
    expect(sandboxHost('___')).toMatch(/^x-[a-z2-7]{13}$/);
    for (const id of ['a', 'x-y', '--Weird__ID..', '___', 'ünïcode']) expect(isSandboxHost(sandboxHost(id))).toBe(true);
  });

  it('keeps ids that share a slug apart', () => {
    const ids = ['my-extension', 'My-Extension', 'my_extension', 'my.extension', 'a-very-long-extension-one', 'a-very-long-extension-two'];
    expect(new Set(ids.map(sandboxHost)).size).toBe(ids.length);
  });

  it('never looks like the editor host', () => {
    expect(isSandboxHost('powermove')).toBe(false);
    expect(isSandboxHost('localhost:5173')).toBe(false);
    expect(isSandboxHost('x--aaaaaaaaaaaaa')).toBe(false);
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

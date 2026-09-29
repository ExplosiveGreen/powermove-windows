import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EXTENSION_API_VERSION, MANIFEST_LIMITS, parseForkedFrom, parseManifest } from '../src/manifest';
const valid = { id: 'my-extension', name: 'My extension', version: '1.2.3', apiVersion: 1 };
const bad = (change: Record<string, unknown>) => parseManifest({ ...valid, ...change });
describe('manifest frozen errors', () => {
  const cases: [string, unknown, string][] = [
    ['object', null, 'manifest must be an object'],
    ['id', { ...valid, id: 'A' }, 'invalid "id" (a-z, 0-9, -; 2–64 chars)'],
    ['name', { ...valid, name: '' }, 'invalid "name"'],
    ['version', { ...valid, version: '1.2' }, 'invalid "version" (x.y.z)'],
    ['apiVersion', { ...valid, apiVersion: 0 }, 'invalid "apiVersion"'],
    ['newer apiVersion', { ...valid, apiVersion: 4 }, `apiVersion 4 is newer than this app (${EXTENSION_API_VERSION})`],
    ['description', { ...valid, description: 'x'.repeat(401) }, 'invalid "description"'],
    ['entry value', { ...valid, entry: '' }, 'invalid "entry"'],
    ['entry path', { ...valid, entry: '../index.ts' }, 'invalid "entry" path'],
    ['contributes', { ...valid, contributes: ['other'] }, 'invalid "contributes"'],
    ['replaces', { ...valid, replaces: ['Bad'] }, 'invalid "replaces"'],
    ['dependsOn', { ...valid, dependsOn: ['Bad'] }, 'invalid "dependsOn"'],
    ['self reference', { ...valid, dependsOn: ['my-extension'] }, 'extension cannot reference itself'],
    ['features', { ...valid, features: ['Bad'] }, 'invalid "features"'],
    ['integrates', { ...valid, integrates: ['Bad'] }, 'invalid "integrates"'],
    ['forkedFrom', { ...valid, forkedFrom: '' }, 'invalid "forkedFrom"'],
    ['author', { ...valid, author: 'alien' }, 'invalid "author"']
  ];
  for (const [name, input, error] of cases) test(name, () => expect(parseManifest(input)).toEqual({ ok: false, error }));
});
test('standalone agent source', () => {
  const source = readFileSync(new URL('../src/manifest.ts', import.meta.url), 'utf8');
  expect(/^import /m.test(source)).toBe(false);
  expect(MANIFEST_LIMITS.forkedFromChars).toBe(160);
});
test('vars parse and version gate', () => {
  expect(bad({ apiVersion: 2, vars: [{ key: 'API_KEY', label: 'API key', secret: true, required: true, hint: 'Use a key' }] })).toMatchObject({ ok: true, manifest: { vars: [{ key: 'API_KEY' }] } });
  expect(bad({ vars: [] })).toEqual({ ok: false, error: '"vars" requires apiVersion 2' });
  for (const vars of [null, [{ key: 'bad', label: 'x' }], [{ key: 'GOOD', label: '' }], [{ key: 'GOOD', label: 'x', secret: 'yes' }], [{ key: 'GOOD', label: 'x', hint: 'x'.repeat(201) }], Array(33).fill({ key: 'GOOD', label: 'x' })]) {
    expect(bad({ apiVersion: 2, vars })).toEqual({ ok: false, error: 'invalid "vars"' });
  }
  expect(bad({ apiVersion: 2, vars: [{ key: 'GOOD', label: 'x' }, { key: 'GOOD', label: 'y' }] })).toEqual({ ok: false, error: 'duplicate var key "GOOD"' });
});
test('fork origin forms', () => {
  expect(parseForkedFrom('builtin-id@1.2.3')).toEqual({ kind: 'builtin', id: 'builtin-id', version: '1.2.3' });
  expect(parseForkedFrom('a-handle/store-id@1.2.3')).toEqual({ kind: 'store', handle: 'a-handle', id: 'store-id', version: '1.2.3' });
  for (const origin of ['Bad/id@1.2.3', 'a/b/c@1.2.3', 'a/b@x', 'a@1.2.3', 'a/b@1.2.3']) expect(parseForkedFrom(origin)).toBeNull();
  expect(bad({ forkedFrom: 'a-handle/store-id@1.2.3' }).ok).toBe(true);
  expect(bad({ forkedFrom: 'x'.repeat(161) })).toEqual({ ok: false, error: 'invalid "forkedFrom"' });
});
test('apiVersion 3 links are up to five canonical https origins', () => {
  const links = ['https://replicate.com', 'https://docs.example.org', 'https://xn--bcher-kva.example:8443'];
  expect(bad({ apiVersion: 3, links })).toMatchObject({ ok: true, manifest: { links } });
  expect(bad({ apiVersion: 3 })).toMatchObject({ ok: true, manifest: expect.not.objectContaining({ links: expect.anything() }) });
  expect(bad({ apiVersion: 2, links: [] })).toEqual({ ok: false, error: '"links" requires apiVersion 3' });
  const error = 'invalid "links" (up to 5 origins like "https://example.com")';
  for (const value of [
    null, 'https://example.com', [1], Array.from({ length: 6 }, (_, index) => `https://a${index}.example.com`),
    ['https://example.com', 'https://example.com'],
    ['http://example.com'], ['wss://example.com'], ['https://example.com/'], ['https://example.com/path'], ['https://example.com?q'],
    ['https://Example.com'], ['https://example.com:443'], ['https://user@example.com'], ['https://bücher.example'], ['https://example.com.'],
    ['https://*.example.com'], ['https://localhost'], ['https://app.localhost'], ['https://printer.local'], ['https://intranet'],
    ['https://127.0.0.1'], ['https://10.0.0.1'], ['https://[::1]'], [`https://${'a'.repeat(200)}.com`]
  ]) expect(bad({ apiVersion: 3, links: value })).toEqual({ ok: false, error });
});
test('apiVersion 3 permissions parse and version gate', () => {
  expect(bad({ apiVersion: 3, permissions: ['network', 'clipboard', 'assets', 'project:write', 'full-access'] })).toMatchObject({
    ok: true, manifest: { apiVersion: 3, permissions: ['network', 'clipboard', 'assets', 'project:write', 'full-access'] }
  });
  expect(bad({ apiVersion: 3, permissions: [] })).toMatchObject({ ok: true, manifest: { permissions: [] } });
  expect(bad({ apiVersion: 2, permissions: [] })).toEqual({ ok: false, error: '"permissions" requires apiVersion 3' });
  for (const permissions of [null, 'network', ['unknown'], ['project:read'], [1], ['network', 'network'], Array(9).fill('network')]) {
    expect(bad({ apiVersion: 3, permissions })).toEqual({ ok: false, error: 'invalid "permissions"' });
  }
});

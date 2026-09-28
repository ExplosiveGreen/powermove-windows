import { describe, expect, it, vi } from 'vitest';
import type { ExtensionManifest } from '../../../shared/extensions';
import { OPEN_EXTERNAL_INTERVAL_MS, sandboxOpenExternal } from './sandbox-links';

function opener(manifest: Pick<ExtensionManifest, 'name' | 'permissions' | 'links'>, answer = true) {
  let clock = 10_000;
  const confirm = vi.fn(async (_title: string, _body?: string) => answer);
  const openExternal = vi.fn(async (_url: string) => true);
  const open = sandboxOpenExternal({ manifest: () => manifest, ui: { confirm, openExternal }, now: () => clock });
  return { open, confirm, openExternal, tick: (ms = OPEN_EXTERNAL_INTERVAL_MS) => { clock += ms; } };
}

describe('sandboxed ui.openExternal', () => {
  it('opens a listed origin without asking when the extension declares network', async () => {
    const { open, confirm, openExternal } = opener({ name: 'Replicate', permissions: ['network'], links: ['https://replicate.com'] });
    await expect(open('https://replicate.com/account/api-tokens')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://replicate.com/account/api-tokens');
  });

  it('asks, naming the extension and showing the whole URL, for anything else', async () => {
    const manifest = { name: 'Replicate', permissions: ['network' as const], links: ['https://replicate.com'] };
    const { open, confirm, openExternal, tick } = opener(manifest);
    // Origins match exactly: not a subdomain, another port, or plain http.
    for (const url of ['https://evil.replicate.com/x', 'https://replicate.com:8443/x', 'https://replicate.com.evil.example/?q=secret']) {
      await expect(open(url)).resolves.toBe(true);
      expect(confirm).toHaveBeenLastCalledWith('Replicate wants to open a link in your browser', url);
      tick();
    }
    expect(openExternal).toHaveBeenCalledTimes(3);
  });

  it('asks for every URL, listed or not, without network', async () => {
    const { open, confirm } = opener({ name: 'Offline', permissions: ['assets'], links: ['https://replicate.com'] });
    await open('https://replicate.com/?project=exfiltrated');
    expect(confirm).toHaveBeenCalledWith('Offline wants to open a link in your browser', 'https://replicate.com/?project=exfiltrated');
  });

  it('opens nothing when the person declines', async () => {
    const { open, openExternal } = opener({ name: 'Declined', permissions: [] }, false);
    await expect(open('https://example.com/')).resolves.toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('shows the serialized URL, so hosts read as punycode and nothing hides in the path', async () => {
    const { open, confirm, openExternal } = opener({ name: 'Unicode', permissions: [] });
    await open('https://аpple.com/‮gnp.exe');
    const shown = confirm.mock.calls[0]![1]!;
    expect(shown).toBe('https://xn--pple-43d.com/%E2%80%AEgnp.exe');
    expect(openExternal).toHaveBeenCalledWith(shown);
  });

  it('refuses anything but a short credential-free https URL before asking', async () => {
    const { open, confirm } = opener({ name: 'Bad', permissions: ['network'] });
    for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com', `https://example.com/${'a'.repeat(2048)}`, 42]) {
      await expect(open(url)).rejects.toThrow(TypeError);
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps one request pending and at most one every 2 s', async () => {
    let answer!: (value: boolean) => void;
    const manifest = { name: 'Spam', permissions: [] };
    let clock = 0;
    const confirm = vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; }));
    const openExternal = vi.fn(async () => true);
    const open = sandboxOpenExternal({ manifest: () => manifest, ui: { confirm, openExternal }, now: () => clock });
    const first = open('https://example.com/1');
    clock += 5_000;
    await expect(open('https://example.com/2')).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('waiting') });
    answer(true);
    await expect(first).resolves.toBe(true);
    const second = open('https://example.com/3');
    answer(false);
    await expect(second).resolves.toBe(false);
    clock += OPEN_EXTERNAL_INTERVAL_MS - 1;
    await expect(open('https://example.com/4')).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('2 seconds') });
    clock += 1;
    const third = open('https://example.com/5');
    answer(true);
    await expect(third).resolves.toBe(true);
    expect(openExternal.mock.calls).toEqual([['https://example.com/1'], ['https://example.com/5']]);
  });

  it('reads permissions and links from the record on every call', async () => {
    const manifest: Pick<ExtensionManifest, 'name' | 'permissions' | 'links'> = { name: 'Live', permissions: [], links: ['https://example.com'] };
    const { open, confirm, tick } = opener(manifest);
    await open('https://example.com/');
    expect(confirm).toHaveBeenCalledTimes(1);
    manifest.permissions = ['network'];
    tick();
    await open('https://example.com/');
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

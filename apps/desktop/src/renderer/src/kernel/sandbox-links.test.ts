import { describe, expect, it, vi } from 'vitest';
import type { ExtensionManifest } from '../../../shared/extensions';
import { OPEN_EXTERNAL_DECLINED_MS, OPEN_EXTERNAL_INTERVAL_MS, sandboxOpenExternal } from './sandbox-links';

function opener(manifest: Pick<ExtensionManifest, 'name' | 'permissions' | 'links'>, answer = true) {
  let clock = 10_000;
  const confirm = vi.fn(async (_title: string, _body?: string) => answer);
  const openExternal = vi.fn(async (_url: string) => true);
  const opener = sandboxOpenExternal({ id: manifest.name.toLowerCase(), manifest: () => manifest, ui: { confirm, openExternal }, now: () => clock });
  // A person's action stands behind the call unless a test says otherwise.
  const open = (url: unknown, gesture = true) => opener(url, gesture);
  return { open, confirm, openExternal, tick: (ms = OPEN_EXTERNAL_INTERVAL_MS) => { clock += ms; } };
}

describe('sandboxed ui.openExternal', () => {
  it('opens a listed origin without asking when the extension declares network and a person just acted', async () => {
    const { open, confirm, openExternal } = opener({ name: 'Replicate', permissions: ['network'], links: ['https://replicate.com'] });
    await expect(open('https://replicate.com/account/api-tokens')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://replicate.com/account/api-tokens');
  });

  it('asks even for a listed origin when no person’s action stands behind the call (a timer in activate)', async () => {
    const { open, confirm, openExternal } = opener({ name: 'Replicate', permissions: ['network'], links: ['https://replicate.com'] });
    await expect(open('https://replicate.com/', false)).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('The extension “replicate” wants to open a link in your browser', 'https://replicate.com/');
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('opens at most 3 listed links a minute without asking, then asks', async () => {
    const { open, confirm, openExternal, tick } = opener({ name: 'Replicate', permissions: ['network'], links: ['https://replicate.com'] });
    for (let index = 0; index < 3; index++) { await open(`https://replicate.com/${index}`); tick(); }
    expect(confirm).not.toHaveBeenCalled();
    await open('https://replicate.com/3');
    expect(confirm).toHaveBeenCalledTimes(1);
    // A minute after the first, it has room for one more.
    tick(60_000 - 3 * OPEN_EXTERNAL_INTERVAL_MS);
    await open('https://replicate.com/4');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledTimes(5);
  });

  it('refuses to ask again for 30 s after the person declines', async () => {
    const { open, confirm, openExternal, tick } = opener({ name: 'Nagging', permissions: ['network'], links: ['https://nag.example'] }, false);
    await expect(open('https://elsewhere.example/')).resolves.toBe(false);
    tick();
    await expect(open('https://elsewhere.example/')).rejects.toMatchObject({ name: 'PermissionError', code: 'resource_limit', message: expect.stringContaining('declined') });
    await expect(open('https://nag.example/', false)).rejects.toMatchObject({ code: 'resource_limit' });
    expect(confirm).toHaveBeenCalledTimes(1);
    // A listed link the person just asked for needs no sheet, so it still opens.
    await expect(open('https://nag.example/')).resolves.toBe(true);
    tick(OPEN_EXTERNAL_DECLINED_MS);
    await expect(open('https://elsewhere.example/')).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(openExternal.mock.calls).toEqual([['https://nag.example/']]);
  });

  it('asks, naming the extension and showing the whole URL, for anything else', async () => {
    const manifest = { name: 'Replicate', permissions: ['network' as const], links: ['https://replicate.com'] };
    const { open, confirm, openExternal, tick } = opener(manifest);
    // Origins match exactly: not a subdomain, another port, or plain http.
    for (const url of ['https://evil.replicate.com/x', 'https://replicate.com:8443/x', 'https://replicate.com.evil.example/?q=secret']) {
      await expect(open(url)).resolves.toBe(true);
      expect(confirm).toHaveBeenLastCalledWith('The extension “replicate” wants to open a link in your browser', url);
      tick();
    }
    expect(openExternal).toHaveBeenCalledTimes(3);
  });

  it('asks for every URL, listed or not, without network', async () => {
    const { open, confirm } = opener({ name: 'Offline', permissions: ['assets'], links: ['https://replicate.com'] });
    await open('https://replicate.com/?project=exfiltrated');
    expect(confirm).toHaveBeenCalledWith('The extension “offline” wants to open a link in your browser', 'https://replicate.com/?project=exfiltrated');
  });

  it('names the extension by its id in fixed wording, never by the name it chose', async () => {
    const confirm = vi.fn(async (_title: string, _body?: string) => false);
    const open = sandboxOpenExternal({ id: 'color-tools', manifest: () => ({ name: 'Powermove', permissions: [] }), ui: { confirm, openExternal: vi.fn() } });
    await open('https://example.com/', true);
    const [title, detail] = confirm.mock.calls[0]!;
    expect(title).toBe('The extension “color-tools” wants to open a link in your browser');
    expect(`${title} ${detail}`).not.toContain('Powermove');
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
    const opener = sandboxOpenExternal({ id: 'spam', manifest: () => manifest, ui: { confirm, openExternal }, now: () => clock });
    const open = (url: string) => opener(url, true);
    const first = open('https://example.com/1');
    clock += 5_000;
    await expect(open('https://example.com/2')).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('waiting') });
    answer(true);
    await expect(first).resolves.toBe(true);
    const second = open('https://example.com/3');
    answer(true);
    await expect(second).resolves.toBe(true);
    clock += OPEN_EXTERNAL_INTERVAL_MS - 1;
    await expect(open('https://example.com/4')).rejects.toMatchObject({ code: 'resource_limit', message: expect.stringContaining('2 seconds') });
    clock += 1;
    const third = open('https://example.com/5');
    answer(true);
    await expect(third).resolves.toBe(true);
    expect(openExternal.mock.calls).toEqual([['https://example.com/1'], ['https://example.com/3'], ['https://example.com/5']]);
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

describe('the agent’s real input', () => {
  it('holds back the app’s activation while main says the agent drives the window, and for 5 s after', async () => {
    vi.resetModules();
    let clock = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true, hasBeenActive: true } });
    let send!: (active: boolean) => void;
    const { installBridgeForTests, resetBridgeForTests } = await import('./bridge');
    installBridgeForTests({ agentTools: { onInput: (cb: (active: boolean) => void) => { send = cb; return () => {}; } } } as never);
    try {
      const { userActivated, AGENT_INPUT_HOLD_MS } = await import('./sandbox-links');
      expect(userActivated()).toBe(true);
      send(true); send(true);
      expect(userActivated()).toBe(false);
      send(false);
      clock += AGENT_INPUT_HOLD_MS;
      expect(userActivated()).toBe(false); // one drive still runs
      send(false);
      clock += AGENT_INPUT_HOLD_MS - 1;
      expect(userActivated()).toBe(false);
      clock += 1;
      expect(userActivated()).toBe(true);
    } finally {
      resetBridgeForTests();
      delete (navigator as { userActivation?: unknown }).userActivation;
      vi.mocked(performance.now).mockRestore();
    }
  });
});

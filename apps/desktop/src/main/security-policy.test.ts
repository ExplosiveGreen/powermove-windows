import { describe, expect, it } from 'vitest';

import { sandboxDocumentUrl, sandboxHost } from '../shared/sandbox-origin';
import { CONTENT_SECURITY_POLICY, SANDBOX_CONTENT_SECURITY_POLICY, extensionSandboxCsp, sandboxFrameNavigationAllowed, sandboxProcessesToKill } from './security-policy';

describe('renderer security policy', () => {
  it('allows trusted extensions to make HTTP requests and WebSocket connections', () => {
    const connect = CONTENT_SECURITY_POLICY.split(';').map(value => value.trim())
      .find(value => value.startsWith('connect-src '))?.split(/\s+/).slice(1);
    expect(connect).toEqual(["'self'", 'blob:', 'http:', 'https:', 'ws:', 'wss:']);
    expect(SANDBOX_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  });

  it('forbids eval in the privileged editor and confines it to the generated-script sandbox', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(SANDBOX_CONTENT_SECURITY_POLICY).toContain("'unsafe-eval'");
    expect(SANDBOX_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  });
});

const directive = (policy: string, name: string): string[] | undefined =>
  policy.split(';').map(value => value.trim()).find(value => value.startsWith(`${name} `))?.split(/\s+/).slice(1);

describe('extension sandbox policy', () => {
  const host = sandboxHost('sandboxed-ext');

  it('lets the editor frame app: sandbox hosts', () => {
    expect(directive(CONTENT_SECURITY_POLICY, 'frame-src')).toEqual(["'self'", 'about:', 'blob:', 'app:']);
  });

  it('scopes scripts to the extension’s own origin', () => {
    const policy = extensionSandboxCsp('sandboxed-ext', ['network'], `app://${host}`);
    expect(directive(policy, 'script-src')).toEqual([`app://${host}/host/`, `app://${host}/ext/sandboxed-ext/`, "'wasm-unsafe-eval'"]);
    expect(directive(policy, 'connect-src')).toEqual(['https:', 'wss:']);
    expect(directive(extensionSandboxCsp('sandboxed-ext', [], `app://${host}`), 'connect-src')).toEqual(["'none'"]);
    expect(directive(policy, 'frame-src')).toEqual(["'none'"]);
  });
});

describe('sandbox frame navigation', () => {
  const own = sandboxDocumentUrl(`app://${sandboxHost('a-ext')}`, 'a-ext', '');
  const other = sandboxDocumentUrl(`app://${sandboxHost('b-ext')}`, 'b-ext', '');

  it('allows a sandbox document on its own host from the editor', () => {
    expect(sandboxFrameNavigationAllowed(own, ['', 'app://powermove/'])).toBe(true);
    expect(sandboxFrameNavigationAllowed(own, [undefined, null])).toBe(true);
    expect(sandboxFrameNavigationAllowed(own, [own, 'app://powermove/'])).toBe(true);
  });

  it('refuses mismatched hosts, other paths and one sandbox becoming another', () => {
    expect(sandboxFrameNavigationAllowed(own.replace('id=a-ext', 'id=b-ext'), [''])).toBe(false);
    expect(sandboxFrameNavigationAllowed(`app://${sandboxHost('a-ext')}/index.html`, [''])).toBe(false);
    expect(sandboxFrameNavigationAllowed('app://powermove/host/ext-sandbox.html?id=a-ext&perms=', [''])).toBe(false);
    expect(sandboxFrameNavigationAllowed('https://example.com/', [''])).toBe(false);
    expect(sandboxFrameNavigationAllowed(other, [own])).toBe(false);
    expect(sandboxFrameNavigationAllowed(other, ['', own])).toBe(false);
  });
});

describe('sandboxProcessesToKill', () => {
  const a = sandboxHost('a-ext'), b = sandboxHost('b-ext');
  const url = (host: string) => `app://${host}/host/ext-sandbox.html?id=x`;
  const editor = (pid: number, frames: Array<{ url: string; pid: number }>) => ({ mainFramePid: pid, frames: [{ url: 'app://powermove/', pid }, ...frames] });

  it('kills a process that only holds that extension’s frames, across windows', () => {
    const contents = [
      editor(10, [{ url: url(a), pid: 20 }, { url: url(a), pid: 20 }, { url: url(b), pid: 21 }]),
      editor(11, [{ url: url(a), pid: 20 }, { url: url(a), pid: 22 }])
    ];
    expect(sandboxProcessesToKill(a, contents).sort()).toEqual([20, 22]);
    expect(sandboxProcessesToKill(b, contents)).toEqual([21]);
  });

  it('spares a process shared with another host or with any main frame', () => {
    expect(sandboxProcessesToKill(a, [editor(10, [{ url: url(a), pid: 20 }, { url: url(b), pid: 20 }])])).toEqual([]);
    expect(sandboxProcessesToKill(a, [editor(10, [{ url: url(a), pid: 10 }])])).toEqual([]);
    expect(sandboxProcessesToKill(a, [editor(10, [{ url: url(a), pid: 20 }]), { mainFramePid: 20, frames: [] }])).toEqual([]);
    expect(sandboxProcessesToKill(a, [editor(10, [{ url: url(a), pid: 20 }, { url: 'about:blank', pid: 20 }])])).toEqual([]);
  });

  it('ignores unknown pids and non-sandbox hosts', () => {
    expect(sandboxProcessesToKill(a, [editor(10, [{ url: url(a), pid: 0 }, { url: url(a), pid: -1 }])])).toEqual([]);
    expect(sandboxProcessesToKill('powermove', [editor(10, [{ url: 'app://powermove/x', pid: 20 }])])).toEqual([]);
  });
});

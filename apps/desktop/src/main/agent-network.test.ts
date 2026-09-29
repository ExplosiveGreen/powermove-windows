import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_SHELL_NETWORK_HOSTS, agentCredentialPaths, agentHostAllowed, agentProxyEnvironment, agentSeatbeltRules,
  isClaudeProjectStore, isPublicAddress, startAgentNetworkProxy, type AgentNetworkProxy
} from './agent-network';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(run => run())); });

describe('agent shell allowlist', () => {
  it('matches exact hosts, and subdomains only for wildcard entries', () => {
    expect(agentHostAllowed('images.pexels.com')).toBe(true);
    expect(agentHostAllowed('IMAGES.PEXELS.COM.')).toBe(true);
    expect(agentHostAllowed('pexels.com')).toBe(false);
    expect(agentHostAllowed('evil.images.pexels.com')).toBe(false);
    expect(agentHostAllowed('images.pexels.com.attacker.example')).toBe(false);
    expect(agentHostAllowed('a.example.com', ['*.example.com'])).toBe(true);
    expect(agentHostAllowed('example.com', ['*.example.com'])).toBe(false);
    expect(agentHostAllowed('badexample.com', ['*.example.com'])).toBe(false);
  });

  it('never lists a host that accepts authenticated uploads', () => {
    for (const host of ['*', 'github.com', 'api.github.com', 'uploads.github.com', 'registry.npmjs.org', 'pypi.org', 'archive.org']) {
      expect(AGENT_SHELL_NETWORK_HOSTS).not.toContain(host);
    }
  });

  it('treats only public unicast addresses as reachable', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '224.0.0.1', '::', '::1', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::a00:1',
      '2002:a00:1::', 'not-an-ip']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '64:ff9b::5db8:d822']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});

describe('agent network proxy', () => {
  async function upstream(): Promise<number> {
    const server = net.createServer(socket => socket.pipe(socket));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise(resolve => server.close(resolve)));
    return (server.address() as net.AddressInfo).port;
  }

  async function proxy(addresses: Record<string, string[]>): Promise<{ proxy: AgentNetworkProxy; dialed: string[]; resolved: string[] }> {
    const echo = await upstream();
    const dialed: string[] = [];
    const resolved: string[] = [];
    const started = await startAgentNetworkProxy({
      resolve: async host => { resolved.push(host); return addresses[host] ?? []; },
      // Every public target lands on the local echo server.
      connect: (address, port) => { dialed.push(`${address}:${port}`); return net.connect(echo, '127.0.0.1'); }
    });
    cleanup.push(() => started.close());
    return { proxy: started, dialed, resolved };
  }

  function send(port: number, request: string, payload?: string): Promise<{ head: string; echoed: string }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
      let data = '';
      let head = '';
      socket.on('data', chunk => {
        data += chunk.toString('utf8');
        if (!head && data.includes('\r\n\r\n')) {
          [head = ''] = data.split('\r\n\r\n');
          data = data.slice(head.length + 4);
          if (payload && head.startsWith('HTTP/1.1 200')) socket.write(payload);
        }
        if (payload && data === payload) { socket.end(); resolve({ head, echoed: data }); }
      });
      socket.on('end', () => resolve({ head, echoed: data }));
      socket.on('error', reject);
    });
  }

  const connect = (target: string) => `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`;

  it('tunnels to an allowlisted host on 443 at its public address', async () => {
    const { proxy: started, dialed } = await proxy({ 'cdn.jsdelivr.net': ['10.0.0.8', '93.184.216.34'] });
    const result = await send(started.port, connect('cdn.jsdelivr.net:443'), 'ping');
    expect(result.head).toMatch(/^HTTP\/1\.1 200/);
    expect(result.echoed).toBe('ping');
    expect(dialed).toEqual(['93.184.216.34:443']);
  });

  it('refuses a host outside the allowlist without resolving it', async () => {
    const { proxy: started, dialed, resolved } = await proxy({ 'attacker.example': ['93.184.216.34'] });
    const result = await send(started.port, connect('attacker.example:443'));
    expect(result.head).toMatch(/^HTTP\/1\.1 403/);
    expect(result.echoed).toContain('not on Powermove');
    expect(resolved).toEqual([]);
    expect(dialed).toEqual([]);
  });

  it('refuses an allowlisted name that resolves to a private address', async () => {
    const { proxy: started, dialed } = await proxy({ 'cdn.jsdelivr.net': ['10.0.0.8', '::1'] });
    const result = await send(started.port, connect('cdn.jsdelivr.net:443'));
    expect(result.head).toMatch(/^HTTP\/1\.1 403/);
    expect(dialed).toEqual([]);
  });

  it('refuses IP literals, other ports and plain HTTP', async () => {
    const { proxy: started, dialed } = await proxy({ 'cdn.jsdelivr.net': ['93.184.216.34'] });
    for (const target of ['cdn.jsdelivr.net:80', 'cdn.jsdelivr.net:22', '93.184.216.34:443', '[::1]:443', '127.0.0.1:443']) {
      expect((await send(started.port, connect(target))).head, target).toMatch(/^HTTP\/1\.1 403/);
    }
    const plain = await send(started.port, 'GET http://cdn.jsdelivr.net/ HTTP/1.1\r\nHost: cdn.jsdelivr.net\r\n\r\n');
    expect(plain.head).toMatch(/^HTTP\/1\.1 403/);
    expect(dialed).toEqual([]);
  });

  it('points every common proxy variable at loopback', () => {
    const env = agentProxyEnvironment(4321);
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
      expect(env[name]).toBe('http://127.0.0.1:4321');
    }
    expect(env.NO_PROXY).toBe('');
  });
});

describe('agent sandbox rules', () => {
  it('allows outbound traffic only to the proxy and denies credential reads', () => {
    const rules = agentSeatbeltRules(4321, ['/Users/me/.ssh', '/Users/me/Library/Application Support/Powermove/codex-runtime']);
    expect(rules).toContain('(deny network-outbound)(allow network-outbound (remote ip "localhost:4321"))');
    expect(rules).not.toMatch(/\(allow network-outbound\)/);
    expect(rules).toContain('(deny file-read* (subpath "/Users/me/.ssh") (subpath "/Users/me/Library/Application Support/Powermove/codex-runtime"))');
    expect(() => agentSeatbeltRules(0, [])).toThrow('port');
  });

  it('denies listening sockets and LaunchServices', () => {
    const rules = agentSeatbeltRules(4321, []);
    expect(rules).toContain('(deny network-bind (local ip "*:*"))(deny network-inbound (local ip "*:*"))');
    expect(rules).toContain('(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name-regex #"^com\\.apple\\.lsd\\."))');
    expect(rules).not.toMatch(/\(allow network-(?:bind|inbound)/);
  });

  it.runIf(process.platform === 'darwin')('lets a sandboxed command reach the proxy but not listen or launch apps', async () => {
    const proxy = net.createServer(socket => socket.end('proxied'));
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise(resolve => proxy.close(resolve)));
    const port = (proxy.address() as net.AddressInfo).port;
    const profile = `(version 1)(allow default)${agentSeatbeltRules(port, [])}`;
    const run = (command: string, args: string[]) => new Promise<string>(resolve => {
      execFile('/usr/bin/sandbox-exec', ['-p', profile, command, ...args], { timeout: 10_000 }, (_error, stdout, stderr) => resolve(`${stdout}${stderr}`));
    });
    const script = `const net = require('node:net');
      const listen = host => new Promise(done => { const server = net.createServer();
        server.once('error', error => done(error.code)); server.listen(0, host, () => server.close(() => done('listening'))); });
      const reach = () => new Promise(done => { const socket = net.connect(${port}, '127.0.0.1');
        let text = ''; socket.on('data', chunk => text += chunk); socket.on('end', () => done(text)); socket.on('error', error => done(error.code)); });
      (async () => console.log(JSON.stringify({ any: await listen('0.0.0.0'), loopback: await listen('127.0.0.1'), proxy: await reach() })))();`;
    expect(JSON.parse(await run(process.execPath, ['-e', script]))).toEqual({ any: 'EPERM', loopback: 'EPERM', proxy: 'proxied' });
    // lsappinfo only reads LaunchServices state, unlike `open`, which would launch an app if the rule regressed.
    const front = await new Promise<string>(resolve => execFile('/usr/bin/lsappinfo', ['front'], (_error, stdout) => resolve(stdout)));
    if (front.includes('ASN:')) expect(await run('/usr/bin/lsappinfo', ['front'])).not.toContain('ASN:');
  });

  it('lists account keys, provider logins and Powermove runtime homes by their real paths', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'pm-agent-network-'));
    cleanup.push(() => rm(userData, { recursive: true, force: true }));
    await mkdir(path.join(userData, 'codex-runtime'));
    const home = os.homedir();
    const all = await agentCredentialPaths(userData, { codexHome: 'all' });
    for (const file of ['.ssh', '.aws', '.config/gcloud', '.netrc', 'Library/Keychains', '.codex/auth.json', '.claude/.credentials.json']) {
      expect(all).toContain(path.join(home, file));
    }
    for (const dir of ['codex-runtime', 'codex-runtime-isolated', 'claude-runtime']) expect(all).toContain(path.join(userData, dir));
    // macOS temp folders live behind /var -> /private/var; sandboxes match the real path.
    expect(all).toContain(path.join(await realpath(userData), 'codex-runtime'));
    const codex = await agentCredentialPaths(userData, { codexHome: 'credentials' });
    expect(codex).toContain(path.join(userData, 'codex-runtime', 'auth.json'));
    expect(codex).not.toContain(path.join(userData, 'codex-runtime'));
    expect(codex).toContain(path.join(userData, 'claude-runtime'));
  });

  it('lists registry, container and password-store tokens and every CLI\'s transcripts', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'pm-agent-network-'));
    cleanup.push(() => rm(userData, { recursive: true, force: true }));
    const home = os.homedir();
    const all = await agentCredentialPaths(userData, { codexHome: 'all' });
    for (const file of ['.npmrc', '.yarnrc.yml', '.docker/config.json', '.kube', '.gnupg', '.claude.json', '.config/op', '.password-store',
      '.codex/sessions', '.codex/archived_sessions', '.codex/history.jsonl', '.claude/projects', '.claude/history.jsonl']) {
      expect(all).toContain(path.join(home, file));
    }
  });

  it('keeps a runtime home\'s helpers readable but not its login backups, databases or transcripts', async () => {
    const userData = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pm-agent-network-')));
    cleanup.push(() => rm(userData, { recursive: true, force: true }));
    const codexRuntime = path.join(userData, 'codex-runtime');
    await mkdir(path.join(codexRuntime, 'skills'), { recursive: true });
    for (const name of ['auth.json.bak.1', 'state_5.sqlite', 'state_5.sqlite-wal', 'config.toml']) await writeFile(path.join(codexRuntime, name), '');
    const codex = await agentCredentialPaths(userData, { codexHome: 'credentials' });
    for (const name of ['auth.json', 'auth.json.bak.1', 'state_5.sqlite', 'state_5.sqlite-wal', 'sessions', 'history.jsonl']) {
      expect(codex).toContain(path.join(codexRuntime, name));
    }
    for (const name of ['skills', 'config.toml']) expect(codex).not.toContain(path.join(codexRuntime, name));

    const claudeRuntime = path.join(userData, 'claude-runtime');
    const cwd = path.join(userData, 'Agent Workspaces', 'project');
    const own = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    for (const store of [own, '-Users-me-other']) await mkdir(path.join(claudeRuntime, 'projects', store), { recursive: true });
    await mkdir(path.join(claudeRuntime, 'shell-snapshots'));
    await writeFile(path.join(claudeRuntime, '.claude.json.backup.1'), '');
    const claude = await agentCredentialPaths(userData, { codexHome: 'all', claudeHome: { cwd } });
    for (const name of ['.credentials.json', '.claude.json', '.claude.json.backup.1', 'sessions', 'history.jsonl', 'projects/-Users-me-other']) {
      expect(claude).toContain(path.join(claudeRuntime, name));
    }
    for (const name of ['', 'projects', `projects/${own}`, 'shell-snapshots']) expect(claude).not.toContain(path.join(claudeRuntime, name));
    expect(claude).toContain(codexRuntime);
  });

  it('names Claude project stores the way Claude Code does', () => {
    expect(isClaudeProjectStore('-Users-me-Agent-Workspaces-p-1', '/Users/me/Agent Workspaces/p_1')).toBe(true);
    expect(isClaudeProjectStore('-Users-me-Agent-Workspaces-p-2', '/Users/me/Agent Workspaces/p_1')).toBe(false);
    const long = `/Users/me/${'a'.repeat(240)}`;
    expect(isClaudeProjectStore(`${long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200)}-1x2y3z`, long)).toBe(true);
    expect(isClaudeProjectStore(long.replace(/[^a-zA-Z0-9]/g, '-'), long)).toBe(false);
  });
});

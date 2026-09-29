import { lookup } from 'node:dns/promises';
import { readdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { ISOLATED_CODEX_HOME_NAME, userCodexHome } from './codex/isolation';
import { ISOLATED_CLAUDE_HOME_NAME } from './claude/isolation';

/** Hosts sandboxed agent shells may reach in Project access: read-only media,
 * font and package CDNs, so research-and-download work (the "Find useful
 * footage" chip) can finish. Every provider filters by host, not method, so a
 * host that accepts authenticated writes (github.com, registry.npmjs.org,
 * archive.org) would be a bulk upload channel for files the agent can read;
 * none is listed. */
export const AGENT_SHELL_NETWORK_HOSTS = [
  'assets.mixkit.co',
  'cdn.freesound.org',
  'cdn.jsdelivr.net',
  'cdn.pixabay.com',
  'codeload.github.com',
  'files.pythonhosted.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'images-assets.nasa.gov',
  'images.pexels.com',
  'images.unsplash.com',
  'live.staticflickr.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'unpkg.com',
  'upload.wikimedia.org',
  'videos.pexels.com'
] as const;

export const AGENT_SHELL_NETWORK_INSTRUCTIONS = `Shell commands can download only over HTTPS from ${AGENT_SHELL_NETWORK_HOSTS.join(', ')}; other hosts are refused.`;

/** Claude sandbox semantics: a bare entry is that exact host, `*.example.com`
 * its subdomains only. */
export function agentHostAllowed(host: string, hosts: readonly string[] = AGENT_SHELL_NETWORK_HOSTS): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return hosts.some(entry => entry.startsWith('*.') ? name.endsWith(entry.slice(1)) : name === entry);
}

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const;
// ::/96 covers the unspecified, loopback and IPv4-compatible forms; 2002::/16
// (6to4) embeds an IPv4 address that could be private.
const PRIVATE_V6 = [['::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const;
const privateAddresses = new net.BlockList();
// BlockList also matches IPv4-mapped IPv6 addresses against these.
for (const [address, prefix] of PRIVATE_V4) privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of PRIVATE_V6) privateAddresses.addSubnet(address, prefix, 'ipv6');
const nat64 = new net.BlockList();
nat64.addSubnet('64:ff9b::', 96, 'ipv6');

/** The IPv4 address in the low 32 bits of an IPv6 address. */
function lowIPv4(address: string): string {
  const [head = '', tail = ''] = address.split('::');
  const groups = (part: string) => part ? part.split(':') : [];
  const words = [...groups(head), ...groups(tail)];
  const last = words.at(-1) ?? '';
  if (net.isIPv4(last)) return last;
  const low = [...Array(8 - words.length).fill('0'), ...words].slice(-2).map(word => parseInt(word, 16));
  return [low[0]! >> 8, low[0]! & 255, low[1]! >> 8, low[1]! & 255].join('.');
}

/** Loopback, private, link-local, shared, documentation and multicast targets
 * are refused, so an allowlisted name that resolves inward cannot reach the
 * user's machine or network. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  if (family === 6 && nat64.check(address, 'ipv6')) return isPublicAddress(lowIPv4(address));
  return !privateAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface AgentNetworkProxyOptions {
  hosts?: readonly string[];
  resolve?: (host: string) => Promise<string[]>;
  connect?: (address: string, port: number) => net.Socket;
  maxTunnels?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface AgentNetworkProxy {
  readonly port: number;
  close(): Promise<void>;
}

// Every Project command shares one proxy, so a runaway or hostile shell cannot
// hold more tunnels than this, or keep one open while nothing moves.
const MAX_TUNNELS = 64;
const CONNECT_TIMEOUT_MS = 20_000;
const IDLE_TIMEOUT_MS = 60_000;
const resolveHost = async (host: string) => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address);

/** HTTP CONNECT proxy on loopback that tunnels only to allowlisted hosts on
 * port 443 at public addresses. Sandboxed shells can reach nothing else. */
export async function startAgentNetworkProxy(options: AgentNetworkProxyOptions = {}): Promise<AgentNetworkProxy> {
  const {
    hosts = AGENT_SHELL_NETWORK_HOSTS, resolve = resolveHost, connect = (address, port) => net.connect({ host: address, port }),
    maxTunnels = MAX_TUNNELS, connectTimeoutMs = CONNECT_TIMEOUT_MS, idleTimeoutMs = IDLE_TIMEOUT_MS
  } = options;
  const refuse = (socket: net.Socket, reason: string, status = '403 Forbidden') => {
    if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${reason}\n`);
    else socket.destroy();
  };
  let tunnels = 0;
  const server = createServer((request, response) => {
    response.writeHead(403, { 'Content-Type': 'text/plain', Connection: 'close' });
    response.end(`Powermove allows shell downloads only over HTTPS from: ${hosts.join(', ')}.\n`);
    request.resume();
  });
  // Sockets that have not sent CONNECT yet are bounded too; headersTimeout closes them.
  server.maxConnections = maxTunnels * 2;
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (request, client: net.Socket, head: Buffer) => {
    client.on('error', () => client.destroy());
    const target = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(request.url ?? '');
    const host = target?.[1]?.replace(/^\[|\]$/g, '') ?? '';
    if (!target || Number(target[2]) !== 443) return refuse(client, 'Powermove allows shell connections only to port 443.');
    if (!agentHostAllowed(host, hosts)) return refuse(client, `${host} is not on Powermove's download allowlist: ${hosts.join(', ')}.`);
    if (tunnels >= maxTunnels) return refuse(client, `Powermove allows at most ${maxTunnels} shell connections at once.`, '503 Service Unavailable');
    tunnels += 1;
    client.once('close', () => { tunnels -= 1; });
    // Resolving and connecting share one deadline.
    let upstream: net.Socket | null = null;
    const deadline = setTimeout(() => { upstream?.destroy(); refuse(client, `Timed out reaching ${host}.`, '504 Gateway Timeout'); }, connectTimeoutMs);
    client.once('close', () => { clearTimeout(deadline); upstream?.destroy(); });
    void resolve(host).then(addresses => {
      if (client.destroyed || !client.writable) return;
      const address = addresses.find(isPublicAddress);
      if (!address) return refuse(client, `${host} does not resolve to a public address.`);
      const socket = upstream = connect(address, 443);
      let established = false;
      const close = () => { socket.destroy(); client.destroy(); };
      socket.once('connect', () => {
        established = true;
        clearTimeout(deadline);
        // Reads and writes both count as activity on either socket.
        socket.setTimeout(idleTimeoutMs, close);
        client.setTimeout(idleTimeoutMs, close);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) socket.write(head);
        socket.pipe(client);
        client.pipe(socket);
      });
      socket.on('error', () => established ? close() : refuse(client, `Could not reach ${host}.`));
      socket.on('close', () => { if (established) close(); });
    }, () => refuse(client, `Could not resolve ${host}.`));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
  });
  server.unref();
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise(done => { server.close(() => done()); server.closeAllConnections(); })
  };
}

let shared: Promise<AgentNetworkProxy> | null = null;
/** One loopback proxy for the app; it serves every Project command. */
export function agentNetworkProxy(): Promise<AgentNetworkProxy> {
  shared ??= startAgentNetworkProxy().catch(error => { shared = null; throw error; });
  return shared;
}

/** Proxy variables for the tools a shell commonly runs (curl, git, pip, npm,
 * bun, Node fetch). The sandbox enforces the proxy either way. */
export function agentProxyEnvironment(port: number): NodeJS.ProcessEnv {
  const url = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { NO_PROXY: '', no_proxy: '', NODE_USE_ENV_PROXY: '1' };
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) env[name] = env[name.toLowerCase()] = url;
  return env;
}

/** The spelling a sandbox matches: the real path of the nearest existing
 * ancestor, plus the part that does not exist yet. */
async function resolvedPath(file: string): Promise<string> {
  let existing = file;
  const rest: string[] = [];
  for (;;) {
    try { return path.join(await realpath(existing), ...rest.reverse()); }
    catch {
      const parent = path.dirname(existing);
      if (parent === existing) return file;
      rest.push(path.basename(existing));
      existing = parent;
    }
  }
}

// Account keys, cloud, registry and container tokens, and password stores.
const HOME_CREDENTIALS = ['.ssh', '.aws', '.azure', '.config/gcloud', '.config/gh', '.config/op', '.op', '.netrc', '.git-credentials',
  '.npmrc', '.yarnrc.yml', '.pypirc', '.cargo/credentials', '.cargo/credentials.toml', '.gem/credentials', '.docker/config.json',
  '.kube', '.gnupg', '.password-store', '.claude.json', 'Library/Keychains'];
// Logins, their backups, and every project's transcripts and history.
const CODEX_PRIVATE = ['auth.json', 'sessions', 'archived_sessions', 'history.jsonl'];
// auth.json and its backups (auth.json.bak…), and the state and log databases.
const CODEX_PRIVATE_PATTERN = /^auth\.json|\.sqlite(?:-wal|-shm)?$/;
const CLAUDE_PRIVATE = ['.credentials.json', '.claude.json', 'sessions', 'history.jsonl', 'file-history', 'backups'];
const CLAUDE_PRIVATE_PATTERN = /^\.claude\.json/;

/** Entries of `directory` whose names match; none when it does not exist. */
async function matching(directory: string, pattern: RegExp | ((name: string) => boolean)): Promise<string[]> {
  const test = typeof pattern === 'function' ? pattern : (name: string) => pattern.test(name);
  try { return (await readdir(directory)).filter(test).map(name => path.join(directory, name)); }
  catch { return []; }
}

async function privatePaths(directory: string, names: readonly string[], pattern: RegExp): Promise<string[]> {
  return [...names.map(name => path.join(directory, name)), ...await matching(directory, pattern)];
}

/** Claude Code's store for a working directory under `projects/`: each
 * character outside [a-zA-Z0-9] becomes `-`, and a name past 200 characters is
 * cut there and suffixed with a hash. */
export function isClaudeProjectStore(name: string, cwd: string): boolean {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return key.length <= 200 ? name === key : name.startsWith(`${key.slice(0, 200)}-`);
}

/** A Claude runtime home's logins and transcripts, and every project store
 * but the run's own: Claude spills large tool results into that one and the
 * model reads them back with Read. Claude resumes a session in-process, so no
 * tool needs its transcript. */
async function claudeRuntimePrivate(directory: string, cwd: string): Promise<string[]> {
  const cwds = [cwd, await resolvedPath(cwd)];
  const projects = await matching(path.join(directory, 'projects'), name => !cwds.some(dir => isClaudeProjectStore(name, dir)));
  return [...await privatePaths(directory, CLAUDE_PRIVATE, CLAUDE_PRIVATE_PATTERN), ...projects];
}

/** Credential material a sandboxed agent shell must not read: account keys,
 * cloud, registry and Git tokens, the provider logins Powermove and the
 * user's own CLIs keep, and their transcripts. A Codex runtime home set to
 * `'credentials'`, or the Claude runtime home given the run's working
 * directory, stays readable apart from those, since that provider's shells
 * run helpers, skills and shell snapshots from it. */
export async function agentCredentialPaths(userData: string,
  options: { codexHome: 'all' | 'credentials'; claudeHome?: 'all' | { cwd: string } }): Promise<string[]> {
  const home = homedir();
  const claudeHomes = [process.env.CLAUDE_CONFIG_DIR?.trim(), path.join(home, '.claude')].filter((value): value is string => !!value);
  const codexHomes = [userCodexHome(), path.join(home, '.codex')];
  const codexRuntimes = [ISOLATED_CODEX_HOME_NAME, `${ISOLATED_CODEX_HOME_NAME}-isolated`].map(name => path.join(userData, name));
  const claudeRuntime = path.join(userData, ISOLATED_CLAUDE_HOME_NAME);
  const { claudeHome = 'all' } = options;
  const paths = [
    ...HOME_CREDENTIALS.map(name => path.join(home, name)),
    ...(await Promise.all([
      matching(home, CLAUDE_PRIVATE_PATTERN),
      ...codexHomes.map(dir => privatePaths(dir, CODEX_PRIVATE, CODEX_PRIVATE_PATTERN)),
      ...claudeHomes.map(dir => privatePaths(dir, [...CLAUDE_PRIVATE, 'projects'], CLAUDE_PRIVATE_PATTERN)),
      ...options.codexHome === 'all' ? [codexRuntimes] : codexRuntimes.map(dir => privatePaths(dir, CODEX_PRIVATE, CODEX_PRIVATE_PATTERN)),
      claudeHome === 'all' ? [claudeRuntime] : claudeRuntimePrivate(claudeRuntime, claudeHome.cwd)
    ])).flat()
  ].map(file => path.resolve(file));
  return [...new Set([...paths, ...await Promise.all(paths.map(resolvedPath))])];
}

// `open` and every other app launch go through LaunchServices.
const LAUNCH_SERVICES = '(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name-regex #"^com\\.apple\\.lsd\\."))';
// Seatbelt's "localhost" also matches the wildcard address, so a loopback-only
// listener cannot be told apart from one on every interface; no TCP or UDP
// listeners at all. Unix sockets still bind.
const NO_LISTENERS = '(deny network-bind (local ip "*:*"))(deny network-inbound (local ip "*:*"))';

/** Seatbelt rules for a Project command: outbound traffic only to the
 * loopback proxy (no direct sockets, DNS or Unix sockets), no listening
 * sockets, no app launches, and no reads of credential paths. Later rules
 * win, so these follow `(allow default)`. */
export function agentSeatbeltRules(proxyPort: number, deniedReads: readonly string[]): string {
  if (!Number.isInteger(proxyPort) || proxyPort <= 0 || proxyPort > 65535) throw new Error('Invalid proxy port.');
  const reads = deniedReads.map(file => ` (subpath ${JSON.stringify(file)})`).join('');
  return `(deny network-outbound)(allow network-outbound (remote ip "localhost:${proxyPort}"))${NO_LISTENERS}${LAUNCH_SERVICES}`
    + (reads ? `(deny file-read*${reads})` : '');
}

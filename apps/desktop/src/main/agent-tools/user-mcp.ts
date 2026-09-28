import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';

export type UserMcpServers = Record<string, Record<string, unknown>>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Import tool registrations, never account credentials or unrelated user settings.
 * Read on every run so adding/removing a server takes effect on the next message.
 * Powermove's authenticated, run-scoped server always owns its reserved name. */
export async function loadUserMcpServers(
  provider: 'chatgpt' | 'claude',
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir()
): Promise<UserMcpServers> {
  const file = provider === 'chatgpt'
    ? path.join(environment.CODEX_HOME?.trim() || path.join(home, '.codex'), 'config.toml')
    : path.join(environment.CLAUDE_CONFIG_DIR?.trim() || home, '.claude.json');
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read MCP configuration: ${file}`);
  }
  let config: unknown;
  try {
    config = provider === 'chatgpt' ? parse(source) : JSON.parse(source);
  } catch {
    // Parser diagnostics may contain credentials from the offending source line.
    throw new Error(`Invalid MCP configuration: ${file}`);
  }
  if (!record(config)) throw new Error(`Invalid MCP configuration: ${file}`);
  const servers = config[provider === 'chatgpt' ? 'mcp_servers' : 'mcpServers'];
  if (servers === undefined) return {};
  if (!record(servers)) throw new Error(`Invalid MCP server list: ${file}`);
  const disabled = new Set(Array.isArray(config.disabledMcpServers) ? config.disabledMcpServers : []);
  return Object.fromEntries(Object.entries(servers).filter(([name, server]) =>
    name !== 'powermove' && !disabled.has(name) && record(server) && server.enabled !== false
  )) as UserMcpServers;
}

/** Codex --config expects TOML values, not JSON objects. Quote every key so
 * dotted server names and environment/header keys remain literal names. */
function inlineToml(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(inlineToml).join(',')}]`;
  if (record(value)) {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${inlineToml(item)}`).join(',')}}`;
  }
  throw new Error('Unsupported value in MCP configuration.');
}

export function userMcpArgv(servers: UserMcpServers = {}): string[] {
  return Object.entries(servers).filter(([name]) => name !== 'powermove').flatMap(([name, server]) => [
    '--config', `mcp_servers.${JSON.stringify(name)}=${inlineToml(server)}`
  ]);
}

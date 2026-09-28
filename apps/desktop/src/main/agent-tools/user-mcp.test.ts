import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'smol-toml';
import { loadUserMcpServers, userMcpArgv } from './user-mcp';

const roots: string[] = [];
async function home(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'powermove-user-mcp-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('user MCP tool registration', () => {
  it('imports any enabled Codex stdio/HTTP server, preserving tool settings but excluding unrelated config', async () => {
    const root = await home();
    await mkdir(path.join(root, '.codex'));
    const servers = {
      'studio.with-dots': { command: '/a path/python', args: ['-m', 'studio'], env: { MODE: 'test' }, disabled_tools: ['erase'] },
      remote: { url: 'https://example.test/mcp', bearer_token_env_var: 'MCP_TOKEN', tool_timeout_sec: 240 },
      off: { command: 'off', enabled: false },
      powermove: { command: 'must-not-override-live-session' }
    };
    const file = path.join(root, '.codex/config.toml');
    await writeFile(file, stringify({ model: 'irrelevant', mcp_servers: servers }));
    const loaded = await loadUserMcpServers('chatgpt', {}, root);
    expect(loaded).toEqual({ 'studio.with-dots': servers['studio.with-dots'], remote: servers.remote });
    const argv = userMcpArgv(loaded);
    expect(parse(argv.filter((_, i) => i % 2 === 1).join('\n'))).toEqual({ mcp_servers: loaded });
    await writeFile(file, 'model = "changed"\n');
    expect(await loadUserMcpServers('chatgpt', {}, root)).toEqual({});
  });

  it('honors custom provider homes and Claude disabled servers without importing project or account data', async () => {
    const root = await home();
    const enabled = { type: 'stdio', command: '/a path/server', args: ['hello'] };
    await writeFile(path.join(root, '.claude.json'), JSON.stringify({
      mcpServers: { arbitrary: enabled, disabled: enabled, powermove: enabled },
      disabledMcpServers: ['disabled'],
      projects: { '/other-project': { mcpServers: { unrelated: enabled } } },
      oauthAccount: { emailAddress: 'fixture@example.test' }
    }));
    expect(await loadUserMcpServers('claude', { CLAUDE_CONFIG_DIR: root }, '/unused')).toEqual({ arbitrary: enabled });
    await writeFile(path.join(root, 'config.toml'), stringify({ mcp_servers: { arbitrary: { command: 'server' } } }));
    expect(await loadUserMcpServers('chatgpt', { CODEX_HOME: root }, '/unused')).toEqual({ arbitrary: { command: 'server' } });
  });

  it('allows missing config but reports malformed config without leaking its contents', async () => {
    const root = await home();
    expect(await loadUserMcpServers('chatgpt', {}, root)).toEqual({});
    expect(await loadUserMcpServers('claude', {}, root)).toEqual({});
    await writeFile(path.join(root, '.claude.json'), '{sensitive-invalid-fixture');
    await expect(loadUserMcpServers('claude', {}, root)).rejects.toThrow(`Invalid MCP configuration: ${path.join(root, '.claude.json')}`);
    await writeFile(path.join(root, 'config.toml'), 'broken = "sensitive-invalid-fixture');
    await expect(loadUserMcpServers('chatgpt', { CODEX_HOME: root }, root)).rejects.toThrow(`Invalid MCP configuration: ${path.join(root, 'config.toml')}`);
  });
});

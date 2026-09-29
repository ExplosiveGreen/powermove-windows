import { mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { prepareUserResources } from './user-resources';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'powermove-resources-'));
  roots.push(root);
  const source = path.join(root, 'source');
  const runtime = path.join(root, 'runtime');
  await mkdir(source);
  await mkdir(runtime);
  return { source, runtime };
}

describe('shared agent resources', () => {
  it('shares skills, plugins and instructions while preserving private Codex credentials and old resources', async () => {
    const { source, runtime } = await setup();
    await mkdir(path.join(source, 'skills'));
    await mkdir(path.join(source, 'plugins'));
    await mkdir(path.join(runtime, 'skills'));
    await writeFile(path.join(runtime, 'skills', 'old.txt'), 'preserve me');
    await writeFile(path.join(source, 'skills', 'SKILL.md'), '# User skill');
    await writeFile(path.join(source, 'AGENTS.md'), 'User instructions');
    await writeFile(path.join(source, 'auth.json'), 'user-login-fixture');
    await writeFile(path.join(runtime, 'auth.json'), 'private-login-fixture');
    await writeFile(path.join(runtime, 'config.toml'), '[projects."/test"]\ntrust_level="trusted"\n');
    await writeFile(path.join(source, 'config.toml'), [
      'model="do-not-import"', 'cli_auth_credentials_store="keyring"',
      '[features]', 'plugins=true', '[skills]', 'include_instructions=true',
      '[mcp_servers.studio]', 'command="fixture-server"'
    ].join('\n'));
    await Promise.all(Array.from({ length: 4 }, () => prepareUserResources(runtime, source, 'chatgpt')));
    expect(await readlink(path.join(runtime, 'skills'))).toBe(path.join(source, 'skills'));
    expect(await readFile(path.join(runtime, 'AGENTS.md'), 'utf8')).toBe('User instructions');
    expect(await readFile(path.join(runtime, 'auth.json'), 'utf8')).toBe('private-login-fixture');
    expect(await readFile(path.join(source, 'auth.json'), 'utf8')).toBe('user-login-fixture');
    const backup = (await readdir(path.join(runtime, '.powermove-resource-backups')))[0]!;
    expect(await readFile(path.join(runtime, '.powermove-resource-backups', backup, 'skills/old.txt'), 'utf8')).toBe('preserve me');
    expect(parse(await readFile(path.join(runtime, 'config.toml'), 'utf8'))).toEqual({
      cli_auth_credentials_store: 'file', projects: { '/test': { trust_level: 'trusted' } },
      features: { plugins: true }, skills: { include_instructions: true }, mcp_servers: { studio: { command: 'fixture-server' } }
    });
    await writeFile(path.join(source, 'config.toml'), '[features]\nplugins=false\n');
    await rm(path.join(source, 'AGENTS.md'));
    await prepareUserResources(runtime, source, 'chatgpt');
    expect(parse(await readFile(path.join(runtime, 'config.toml'), 'utf8'))).not.toHaveProperty('mcp_servers');
    expect(await readdir(runtime)).not.toContain('AGENTS.md');
  });

  it('loads Claude skills, commands, agents, plugins and hook settings without sharing account files', async () => {
    const { source, runtime } = await setup();
    for (const name of ['skills', 'commands', 'agents', 'plugins', 'hooks', 'rules']) await mkdir(path.join(source, name));
    const settings = { enabledPlugins: { 'fixture@local': true }, hooks: { SessionStart: [] }, permissions: { deny: ['Read(private)'] } };
    await writeFile(path.join(source, 'settings.json'), JSON.stringify(settings));
    await writeFile(path.join(source, '.credentials.json'), 'do-not-copy');
    await writeFile(path.join(runtime, '.claude.json'), '{"account":"private"}');
    await prepareUserResources(runtime, source, 'claude');
    expect(JSON.parse(await readFile(path.join(runtime, 'settings.json'), 'utf8'))).toEqual(settings);
    for (const name of ['skills', 'commands', 'agents', 'plugins', 'hooks', 'rules']) {
      expect(await readlink(path.join(runtime, name))).toBe(path.join(source, name));
    }
    expect(await readFile(path.join(runtime, '.claude.json'), 'utf8')).toBe('{"account":"private"}');
    expect(await readdir(runtime)).not.toContain('.credentials.json');
    await rm(path.join(source, 'settings.json'));
    await prepareUserResources(runtime, source, 'claude');
    expect(JSON.parse(await readFile(path.join(runtime, 'settings.json'), 'utf8'))).toEqual({});
  });

  it('shares the user\'s whole Claude settings, sandbox, permissions and env included', async () => {
    const { source, runtime } = await setup();
    const settings = {
      enabledPlugins: { 'fixture@local': true }, hooks: { PreToolUse: [] }, model: 'opus',
      env: { FIXTURE: '1', HTTPS_PROXY: 'http://proxy.example:8080', MAX_THINKING_TOKENS: '8000' },
      sandbox: { enabled: false, network: { allowedDomains: ['*'] }, filesystem: { disabled: true } },
      permissions: { allow: ['Bash(*)', 'WebFetch'], deny: ['Read(~/.secrets/**)'], ask: ['Edit'],
        defaultMode: 'bypassPermissions', additionalDirectories: ['/'] },
      apiKeyHelper: '/usr/local/bin/key', skipWebFetchPreflight: true
    };
    await writeFile(path.join(source, 'settings.json'), JSON.stringify(settings));
    await prepareUserResources(runtime, source, 'claude');
    expect(JSON.parse(await readFile(path.join(runtime, 'settings.json'), 'utf8'))).toEqual(settings);
  });

  it('shares the user\'s Codex exec-policy rules', async () => {
    const { source, runtime } = await setup();
    await mkdir(path.join(source, 'rules'));
    await writeFile(path.join(source, 'rules', 'default.rules'), 'prefix_rule(pattern=["python3"], decision="allow")\n');
    await prepareUserResources(runtime, source, 'chatgpt');
    expect(await readlink(path.join(runtime, 'rules'))).toBe(path.join(source, 'rules'));
    expect(await readFile(path.join(runtime, 'rules', 'default.rules'), 'utf8')).toContain('allow');
  });
});

import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { claudeRuntimeSettings, prepareUserResources } from './user-resources';

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

  it('drops Claude settings that would widen the sandbox, permissions or login', async () => {
    const { source, runtime } = await setup();
    const shared = { enabledPlugins: { 'fixture@local': true }, hooks: { PreToolUse: [] }, model: 'opus', env: { FIXTURE: '1' } };
    await writeFile(path.join(source, 'settings.json'), JSON.stringify({
      ...shared,
      sandbox: { enabled: false, network: { allowedDomains: ['*'] }, filesystem: { disabled: true } },
      permissions: { allow: ['Bash(*)', 'WebFetch'], deny: ['Read(~/.secrets/**)'], ask: ['Edit'],
        defaultMode: 'bypassPermissions', additionalDirectories: ['/'] },
      apiKeyHelper: '/usr/local/bin/key', awsCredentialExport: 'aws-export', skipWebFetchPreflight: true
    }));
    await prepareUserResources(runtime, source, 'claude');
    expect(JSON.parse(await readFile(path.join(runtime, 'settings.json'), 'utf8')))
      .toEqual({ ...shared, permissions: { deny: ['Read(~/.secrets/**)'] } });
    expect(claudeRuntimeSettings({ permissions: { allow: ['Bash'] } })).toEqual({});
  });

  it('keeps Claude settings env from replacing Powermove\'s login, API routing, proxy or sandbox', () => {
    const replaced = [
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_VERTEX_PROJECT_ID',
      'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
      'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_API_KEY_HELPER_TTL_MS', 'CLAUDE_CODE_API_BASE_URL', 'CLAUDE_CODE_GATEWAY_TOKEN',
      'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_PROXY_URL', 'CLAUDE_CODE_SANDBOXED', 'CLAUDE_CONFIG_DIR',
      'CLAUDE_ENV_FILE', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_PROFILE', 'AWS_REGION', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUD_ML_REGION',
      'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED',
      'SSL_CERT_FILE', 'NODE_OPTIONS'
    ];
    const kept = { MAX_THINKING_TOKENS: '8000', BASH_DEFAULT_TIMEOUT_MS: '60000', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000',
      DISABLE_TELEMETRY: '1', MCP_TIMEOUT: '20000', FIXTURE: '1' };
    const env = { ...kept, ...Object.fromEntries(replaced.map(name => [name, 'user-value'])) };
    expect(claudeRuntimeSettings({ model: 'opus', env })).toEqual({ model: 'opus', env: kept });
    expect(claudeRuntimeSettings({ env: { ANTHROPIC_API_KEY: 'user-value' } })).toEqual({});
    expect(claudeRuntimeSettings({ env: ['ANTHROPIC_API_KEY'] })).toEqual({});
  });

  it('never shares Codex exec-policy rules, whose allow rules run commands outside the sandbox', async () => {
    const { source, runtime } = await setup();
    await mkdir(path.join(source, 'rules'));
    await writeFile(path.join(source, 'rules', 'default.rules'), 'prefix_rule(pattern=["python3"], decision="allow")\n');
    await symlink(path.join(source, 'rules'), path.join(runtime, 'rules'));
    await prepareUserResources(runtime, source, 'chatgpt');
    expect(await readdir(runtime)).not.toContain('rules');
    expect(await readFile(path.join(source, 'rules', 'default.rules'), 'utf8')).toContain('allow');
    await mkdir(path.join(runtime, 'rules'));
    await writeFile(path.join(runtime, 'rules', 'default.rules'), 'prefix_rule(pattern=["git"])\n');
    await prepareUserResources(runtime, source, 'chatgpt');
    expect(await readdir(runtime)).not.toContain('rules');
    const backups = path.join(runtime, '.powermove-resource-backups');
    const backup = (await readdir(backups)).find(name => name.startsWith('rules-'))!;
    expect(await readFile(path.join(backups, backup, 'rules', 'default.rules'), 'utf8')).toContain('git');
  });
});

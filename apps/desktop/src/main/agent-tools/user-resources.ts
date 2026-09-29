import { lstat, mkdir, mkdtemp, readFile, readlink, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'smol-toml';

const CODEX_RESOURCE_KEYS = [
  'features', 'skills', 'plugins', 'marketplaces', 'apps', 'mcp_servers',
  'tools', 'web_search', 'hooks', 'agents', 'developer_instructions',
  'model_instructions_file', 'project_doc_fallback_filenames', 'project_doc_max_bytes'
] as const;

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function moveToBackup(target: string): Promise<void> {
  const backupRoot = path.join(path.dirname(target), '.powermove-resource-backups');
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backup = await mkdtemp(path.join(backupRoot, `${path.basename(target)}-`));
  await rename(target, path.join(backup, path.basename(target)));
}

async function linkResource(source: string, target: string): Promise<void> {
  if (!await exists(source)) {
    if (await exists(target) && (await lstat(target)).isSymbolicLink() && await readlink(target) === source) {
      await unlink(target);
    }
    return;
  }
  if (await exists(target)) {
    if ((await lstat(target)).isSymbolicLink() && await readlink(target) === source) return;
    // Preserve resources created by an older private runtime before linking the
    // normal user installation. Never move or replace account/session files.
    await moveToBackup(target);
  }
  await symlink(source, target);
}

/** Drops a resource from the runtime home: an older link is removed, anything
 * else is kept in the backups. */
async function withdrawResource(target: string): Promise<void> {
  if (!await exists(target)) return;
  if ((await lstat(target)).isSymbolicLink()) await unlink(target);
  else await moveToBackup(target);
}

async function readConfig(file: string, toml: boolean): Promise<Record<string, unknown>> {
  let source: string;
  try { source = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  try {
    const value = toml ? parse(source) : JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error(`Invalid agent resource configuration: ${file}`); }
}

// Claude Code merges user settings into every run: sandbox domains and
// filesystem switches, permission allow rules and extra directories would
// widen Powermove's isolation, and auth helpers would replace its login.
const CLAUDE_ISOLATION_KEYS = ['sandbox', 'apiKeyHelper', 'proxyAuthHelper', 'awsCredentialExport', 'awsAuthRefresh',
  'gcpAuthRefresh', 'skipWebFetchPreflight'] as const;

// Settings `env` overrides the environment Powermove starts Claude with. Keys,
// tokens, API endpoints and providers, proxies and TLS trust, the config home
// and sandbox switches stay Powermove's; tuning such as MAX_THINKING_TOKENS or
// BASH_DEFAULT_TIMEOUT_MS is kept.
const CLAUDE_ENV_PROVIDER = /^(?:ANTHROPIC|AWS|AZURE|GOOGLE|GCLOUD|GCP|CLOUDSDK|CLOUD_ML|VERTEX|CLAUDE_CODE_USE|CLAUDE_CODE_SKIP)_/i;
const CLAUDE_ENV_ROUTING = new RegExp(`(?:^|_)(?:${[
  'PROXY', 'TOKEN', 'KEY', 'SECRET', 'AUTH', 'AUTHENTICATE', 'OAUTH', 'CREDS?', 'CREDENTIALS?', 'PASSWORD', 'PASSPHRASE',
  'HEADERS?', 'CERTS?', 'CA', 'TLS', 'SSL', 'URL', 'HOST', 'ENDPOINT', 'BASE', 'GATEWAY', 'BEDROCK', 'VERTEX', 'FOUNDRY', 'MANTLE',
  'ORGANIZATION', 'ACCOUNT', 'PROVIDER', 'REGION', 'PROFILE', 'SANDBOX', 'SANDBOXED', 'CONFIG_DIR', 'ENV', 'OPTIONS'
].join('|')})(?:_|$)`, 'i');

/** Environment entries from the user's Claude settings that neither sign in,
 * route API traffic nor change isolation. */
function claudeRuntimeEnvironment(env: unknown): Record<string, unknown> | undefined {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  const kept = Object.entries(env).filter(([name]) => !CLAUDE_ENV_PROVIDER.test(name) && !CLAUDE_ENV_ROUTING.test(name));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/** The user's Claude settings without anything that loosens isolation or
 * replaces Powermove's login. Deny rules only narrow a run, so they are kept. */
export function claudeRuntimeSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const { permissions, env, ...rest } = settings;
  for (const key of CLAUDE_ISOLATION_KEYS) delete rest[key];
  const shared = claudeRuntimeEnvironment(env);
  if (shared) rest.env = shared;
  const deny = permissions && typeof permissions === 'object' ? (permissions as { deny?: unknown }).deny : undefined;
  return Array.isArray(deny) && deny.length ? { ...rest, permissions: { deny } } : rest;
}

/** Share skills, plugins, hooks and instructions, while keeping authentication,
 * session history and login files inside Powermove. */
async function syncUserResources(
  runtimeHome: string,
  sourceHome: string,
  provider: 'chatgpt' | 'claude'
): Promise<void> {
  if (path.resolve(runtimeHome) === path.resolve(sourceHome)) return;
  await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
  const names = provider === 'chatgpt'
    ? ['skills', 'plugins', 'hooks', 'AGENTS.md', 'AGENTS.override.md']
    : ['skills', 'plugins', 'commands', 'agents', 'rules', 'hooks', 'CLAUDE.md'];
  for (const name of names) await linkResource(path.join(sourceHome, name), path.join(runtimeHome, name));
  // Codex rules are exec policy: a command an `allow` rule matches runs
  // outside the sandbox, so the user's terminal rules are never shared.
  if (provider === 'chatgpt') await withdrawResource(path.join(runtimeHome, 'rules'));

  if (provider === 'claude') {
    // Copy settings rather than linking: provider settings updates must not
    // rewrite the user's terminal configuration. Credentials are separate.
    const settings = claudeRuntimeSettings(await readConfig(path.join(sourceHome, 'settings.json'), false));
    await writeConfig(path.join(runtimeHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    return;
  }

  const source = await readConfig(path.join(sourceHome, 'config.toml'), true);
  const configFile = path.join(runtimeHome, 'config.toml');
  const runtime = await readConfig(configFile, true);
  for (const key of CODEX_RESOURCE_KEYS) {
    delete runtime[key];
    if (Object.hasOwn(source, key)) runtime[key] = source[key];
    if (key === 'mcp_servers' && runtime[key] && typeof runtime[key] === 'object') {
      runtime[key] = Object.fromEntries(Object.entries(runtime[key]).filter(([name]) => name !== 'powermove'));
    }
  }
  // The native engine, skills, app connectors and plugins are no longer
  // disabled by Powermove. Explicit user choices retain their native meaning.
  runtime.cli_auth_credentials_store = 'file';
  await writeConfig(configFile, stringify(runtime));
}

async function writeConfig(file: string, contents: string): Promise<void> {
  if (await readFile(file, 'utf8').catch(() => null) === contents) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

const preparing = new Map<string, Promise<void>>();
export async function prepareUserResources(
  runtimeHome: string,
  sourceHome: string,
  provider: 'chatgpt' | 'claude'
): Promise<void> {
  const active = preparing.get(runtimeHome);
  if (active) return active;
  const work = syncUserResources(runtimeHome, sourceHome, provider);
  preparing.set(runtimeHome, work);
  try { await work; }
  finally { if (preparing.get(runtimeHome) === work) preparing.delete(runtimeHome); }
}

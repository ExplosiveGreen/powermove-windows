import { readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ISOLATED_CODEX_HOME_NAME, userCodexHome } from './codex/isolation';
import { ISOLATED_CLAUDE_HOME_NAME } from './claude/isolation';

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

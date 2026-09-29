import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentCredentialPaths, isClaudeProjectStore } from './agent-network';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(run => run())); });

describe('agent credential paths', () => {
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

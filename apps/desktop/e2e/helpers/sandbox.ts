import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LaunchedApp } from './app';

/** One Store install: a fixture directory copied under `id`, optionally with other permissions. */
export type StoreFixture = { fixture: string; id?: string; permissions?: string[] };

export type SandboxFrame = { id: string; pid: number; host: string; url: string; editorPid: number };

/** `present` is false when the page never published the counters (no sandbox host yet). */
export type SandboxStats = { present: boolean; snapshotBuilds: number; snapshotMs: number; ticks: number };

/**
 * Installs fixtures as Store extensions (provenance from someone else's repo),
 * so they run sandboxed; replaces any previous set. Takes effect on relaunch.
 */
export async function installStoreExtensions(session: LaunchedApp, fixtures: StoreFixture[]): Promise<string[]> {
  const extensions = path.join(session.userData, 'extensions');
  await rm(extensions, { recursive: true, force: true });
  await mkdir(extensions, { recursive: true });
  const provenance: Record<string, unknown> = {};
  const ids: string[] = [];
  for (const [index, entry] of fixtures.entries()) {
    const source = path.resolve('test/fixtures', entry.fixture);
    const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
    const id = entry.id ?? manifest.id;
    const target = path.join(extensions, id);
    await cp(source, target, { recursive: true });
    manifest.id = id;
    if (entry.permissions) manifest.permissions = entry.permissions;
    await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest));
    const repoId = `external-repo-${index}`;
    provenance[id] = { localId: id, envKey: repoId, origin: { repoId, releaseId: 'release-1', coordinate: `someone/${id}`, version: manifest.version, treeSha: 'tree', commitSha: 'commit', ownerPublisherId: 'someone-else' } };
    ids.push(id);
  }
  await writeFile(path.join(session.userData, 'extensions-provenance.json'), JSON.stringify(provenance));
  return ids;
}

/** Waits until every id has registered `<id>.<command>` in the kernel (its sandbox activated). */
export async function waitForCommands(session: LaunchedApp, ids: string[], command: string, timeout = 20_000): Promise<void> {
  await session.page.waitForFunction(({ ids, command }) => ids.every(id => (window as any).PM?.Kernel?.commands?.get(`${id}.${command}`)),
    { ids, command }, { timeout });
}

/**
 * Runs a sandboxed extension command from the editor and returns its result,
 * or `'timeout'`. The frames are opaque and out of process, so commands (and
 * their return values over RPC) are how a spec reads a fixture's state.
 */
export function runCommand<T = unknown>(session: LaunchedApp, command: string, timeout = 5_000): Promise<T | 'timeout' | { error: string }> {
  return session.page.evaluate(async ({ command, timeout }) => {
    const entry = (window as any).PM.Kernel.commands.get(command);
    if (!entry) return { error: `no command ${command}` };
    try {
      return await Promise.race([Promise.resolve(entry.run()), new Promise(resolve => setTimeout(() => resolve('timeout'), timeout))]);
    } catch (error) { return { error: String((error as Error)?.message ?? error) }; }
  }, { command, timeout }) as Promise<T | 'timeout' | { error: string }>;
}

/** Sandbox runtime frames (views excluded) as main sees them, with their OS process. */
export function sandboxFrames(session: LaunchedApp): Promise<SandboxFrame[]> {
  return session.app.evaluate(({ webContents }) => {
    const frames: { id: string; pid: number; host: string; url: string; editorPid: number }[] = [];
    for (const contents of webContents.getAllWebContents()) {
      if (contents.isDestroyed()) continue;
      const main = contents.mainFrame;
      for (const frame of main.framesInSubtree) {
        if (frame === main) continue;
        let url: URL;
        try { url = new URL(frame.url); } catch { continue; }
        if (!url.pathname.endsWith('/host/ext-sandbox.html') || url.searchParams.has('view')) continue;
        frames.push({ id: url.searchParams.get('id') ?? '', pid: frame.osProcessId, host: url.host, url: frame.url, editorPid: main.osProcessId });
      }
    }
    return frames;
  });
}

/** `process.kill(pid, 0)` from main: true while the OS process exists. */
export function processAlive(session: LaunchedApp, pid: number): Promise<boolean> {
  return session.app.evaluate((_electron, pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }, pid);
}

export function sandboxStats(session: LaunchedApp): Promise<SandboxStats> {
  return session.page.evaluate(() => {
    const stats = (globalThis as any).__powermoveSandboxStats;
    return { present: Boolean(stats), snapshotBuilds: Number(stats?.snapshotBuilds ?? 0), snapshotMs: Number(stats?.snapshotMs ?? 0), ticks: Number(stats?.ticks ?? 0) };
  });
}

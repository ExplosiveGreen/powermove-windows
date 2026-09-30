/*
 * What's New: the first launch after an update shows the GitHub release notes
 * for every version between the one the user last ran and this one.
 *
 * `whats-new.json` in userData remembers the last version whose notes were
 * seen. A fresh install records its version without showing anything. The
 * notes are only marked seen once a window has shown them, so an offline
 * first launch tries again next time. Only the first window to ask gets them.
 */
import { app, type IpcMain } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { IPC, type WhatsNew, type WhatsNewRelease } from '../shared/ipc';

export const RELEASES_URL = 'https://api.github.com/repos/iterative-computer/powermove/releases?per_page=30';
const MARKER = 'whats-new.json';

type Version = { core: [number, number, number]; beta: number | null };

function parse(version: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(version.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], beta: match[4] === undefined ? null : Number(match[4]) };
}

/** Negative, zero or positive, as `a` is lower, equal or higher. A beta sorts below its release. */
export function compareAppVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let index = 0; index < 3; index++) {
    const diff = x.core[index]! - y.core[index]!;
    if (diff) return diff;
  }
  if (x.beta === y.beta) return 0;
  if (x.beta === null) return 1;
  if (y.beta === null) return -1;
  return x.beta - y.beta;
}

type GitHubRelease = {
  tag_name?: string; name?: string | null; body?: string | null; html_url?: string;
  published_at?: string | null; draft?: boolean; prerelease?: boolean;
};

/** GitHub's generated notes end in a compare link and cite PRs by full URL;
 * keep the prose and turn PR URLs into short links. */
export function tidyNotes(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/^\s*\*\*Full Changelog\*\*:.*$/gm, '')
    .replace(/(?<!\()https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g, (url, number) => `[#${number}](${url})`)
    .trim();
}

/** Releases newer than `since`, up to and including `current`, newest first.
 * Stable builds skip prereleases, matching the updater's channel. */
export function releasesBetween(releases: GitHubRelease[], since: string, current: string): WhatsNewRelease[] {
  const beta = parse(current)?.beta !== null;
  return releases
    .filter(release => !release.draft && (beta || !release.prerelease) && typeof release.tag_name === 'string')
    .map(release => ({ release, version: release.tag_name!.replace(/^v/, '') }))
    .filter(({ version }) => parse(version) && compareAppVersions(version, since) > 0 && compareAppVersions(version, current) <= 0)
    .sort((a, b) => compareAppVersions(b.version, a.version))
    .map(({ release, version }) => ({
      version,
      name: release.name?.trim() || `Powermove ${version}`,
      notes: tidyNotes(release.body ?? ''),
      url: release.html_url ?? `https://github.com/iterative-computer/powermove/releases/tag/v${version}`,
      date: release.published_at ?? null
    }));
}

async function readSeen(userData: string): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(path.join(userData, MARKER), 'utf8')) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

async function writeSeen(userData: string, version: string): Promise<void> {
  await mkdir(userData, { recursive: true });
  const destination = path.join(userData, MARKER);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version })}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
}

export type WhatsNewOptions = {
  userData: string;
  current: string;
  /** Pretend the last seen version was this one (POWERMOVE_WHATS_NEW_SINCE). */
  since?: string | null;
  fetch?: typeof fetch;
};

export function installWhatsNew(ipcMain: IpcMain, options: WhatsNewOptions): void {
  const { userData, current } = options;
  const request = options.fetch ?? fetch;
  let claimed = false;

  async function pending(): Promise<WhatsNew | null> {
    if (claimed) return null;
    claimed = true;
    const seen = options.since ?? await readSeen(userData);
    if (seen === null) {
      await writeSeen(userData, current).catch(error => console.error('[whats-new] could not record version', error));
      return null;
    }
    if (compareAppVersions(current, seen) <= 0) return null;
    try {
      const response = await request(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
      const releases = releasesBetween(await response.json() as GitHubRelease[], seen, current);
      if (!releases.length) {
        await writeSeen(userData, current);
        return null;
      }
      return { current, previous: seen, releases };
    } catch (error) {
      // Offline or rate-limited: try again on the next launch.
      console.error('[whats-new]', error);
      claimed = false;
      return null;
    }
  }

  ipcMain.handle(IPC.whatsNewPending, () => pending());
  ipcMain.handle(IPC.whatsNewSeen, () => writeSeen(userData, current));
}

export function whatsNewOptions(env: NodeJS.ProcessEnv): WhatsNewOptions {
  return { userData: app.getPath('userData'), current: app.getVersion(), since: env['POWERMOVE_WHATS_NEW_SINCE'] || null };
}

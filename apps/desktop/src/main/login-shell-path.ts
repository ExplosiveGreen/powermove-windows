import { execFile } from 'node:child_process';
import path from 'node:path';

const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const START = '__POWERMOVE_PATH_START__';
const END = '__POWERMOVE_PATH_END__';

let probe: Promise<string[]> | null = null;

/** Absolute, unique PATH entries in order; relative entries resolve against a caller's cwd. */
export function absolutePathEntries(value: string | undefined): string[] {
  const entries: string[] = [];
  for (const entry of (value ?? '').split(':')) {
    if (path.isAbsolute(entry) && !/[\0\r\n]/u.test(entry) && !entries.includes(entry)) entries.push(entry);
  }
  return entries;
}

/** The PATH printed between markers, ignoring anything a login profile echoes. */
export function markedPath(stdout: string): string | null {
  const end = stdout.lastIndexOf(END);
  const start = end < 0 ? -1 : stdout.lastIndexOf(START, end);
  return start < 0 ? null : stdout.slice(start + START.length, end);
}

function readLoginShellPath(): Promise<string[]> {
  return new Promise(resolve => {
    // Only PATH crosses over; the login environment can hold tokens.
    execFile('/bin/zsh', ['-ilc', `printf '${START}%s${END}' "$PATH"`],
      { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? [] : absolutePathEntries(markedPath(stdout) ?? '')));
  });
}

/**
 * The user's login-shell PATH, so Dock and Finder launches (which get a
 * minimal PATH) still find Homebrew, bun and node tools. Probed once.
 */
export async function loginShellPath(home = process.env.HOME): Promise<string> {
  probe ??= process.platform === 'darwin' ? readLoginShellPath() : Promise.resolve([]);
  const login = await probe;
  const fallback = login.length ? [] : ['/opt/homebrew/bin', '/usr/local/bin', ...(home && path.isAbsolute(home) ? [path.join(home, '.bun', 'bin')] : [])];
  return absolutePathEntries([...login, ...fallback, ...absolutePathEntries(process.env.PATH), ...SYSTEM_PATH].join(':')).join(':');
}

export function resetLoginShellPathForTests(): void {
  probe = null;
}

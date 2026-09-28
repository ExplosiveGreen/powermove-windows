import { execFile } from 'node:child_process';

export type ProcessRow = { pid: number; ppid: number; pgid: number };

export function parseProcessTable(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const [pid = NaN, ppid = NaN, pgid = NaN] = line.trim().split(/\s+/u).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isInteger(pgid) && pid > 1) rows.push({ pid, ppid, pgid });
  }
  return rows;
}

/** Members of the group plus every descendant, including ones that left it. */
export function processFamily(rows: readonly ProcessRow[], group: number): Set<number> {
  const family = new Set(rows.filter(row => row.pgid === group).map(row => row.pid));
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (!family.has(row.pid) && family.has(row.ppid)) { family.add(row.pid); grew = true; }
  }
  family.delete(process.pid);
  return family;
}

function processTable(): Promise<ProcessRow[]> {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 5_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(parseProcessTable(stdout)));
  });
}

function signal(pid: number, name: NodeJS.Signals): boolean {
  try { process.kill(pid, name); return true; } catch { return false; }
}

/**
 * SIGKILL a command's process group and every descendant. A group kill alone
 * misses children that moved to their own group or session while their
 * parent lives, so the family is frozen until no new member appears (a
 * stopped process cannot fork), then killed.
 */
export async function killProcessFamily(group: number): Promise<void> {
  if (!Number.isInteger(group) || group <= 1 || group === process.pid) return;
  // An empty group leaves nothing reachable: escaped children of dead
  // members were already reparented away from this command.
  if (!signal(-group, 'SIGSTOP')) return;
  const frozen = new Set<number>();
  try {
    for (let round = 0; round < 16; round++) {
      let fresh = false;
      for (const pid of processFamily(await processTable(), group)) {
        if (frozen.has(pid)) continue;
        frozen.add(pid); fresh = true;
        signal(pid, 'SIGSTOP');
      }
      if (!fresh) break;
    }
  } finally {
    signal(-group, 'SIGKILL');
    for (const pid of frozen) signal(pid, 'SIGKILL');
  }
}

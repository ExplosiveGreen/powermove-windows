import { execFile } from 'node:child_process';
import path from 'node:path';

/** `started` is ps's lstart: with the pid, it names one process for its whole life. */
export type ProcessRow = { pid: number; ppid: number; pgid: number; uid: number; started: string };

export function parseProcessTable(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S.*?)\s*$/u.exec(line);
    if (!match) continue;
    const [pid, ppid, pgid, uid] = match.slice(1, 5).map(Number) as [number, number, number, number];
    if (pid > 1) rows.push({ pid, ppid, pgid, uid, started: match[5]! });
  }
  return rows;
}

function processTable(): Promise<ProcessRow[]> {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,uid=,lstart='],
      { encoding: 'utf8', timeout: 5_000, maxBuffer: 16 * 1024 * 1024, env: { LC_ALL: 'C', ...(process.env.TZ ? { TZ: process.env.TZ } : {}) } },
      (error, stdout) => error ? reject(error) : resolve(parseProcessTable(stdout)));
  });
}

/** Working directories by pid; processes lsof cannot inspect are left out. */
function workingDirectories(pids: readonly number[]): Promise<Map<number, string>> {
  return new Promise(resolve => {
    // lsof exits 1 when any pid is gone; what it printed still holds.
    execFile('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-w', '-p', pids.join(',')],
      { encoding: 'utf8', timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => {
        const found = new Map<number, string>();
        let pid = 0;
        for (const line of (stdout ?? '').split('\n')) {
          if (line.startsWith('p')) pid = Number(line.slice(1));
          else if (line.startsWith('n') && pid) found.set(pid, line.slice(1));
        }
        resolve(found);
      });
  });
}

function signal(pid: number, name: NodeJS.Signals): boolean {
  try { process.kill(pid, name); return true; } catch { return false; }
}

const watched = new Set<ProcessFamily>();
let polling: NodeJS.Timeout | null = null;

/** One process table per tick serves every running command; fast while one is young. */
function schedulePoll(): void {
  if (polling || !watched.size) return;
  const young = [...watched].some(family => Date.now() - family.since < 5_000);
  polling = setTimeout(() => {
    void processTable().then(rows => { for (const family of watched) family.record(rows); }, () => undefined)
      .finally(() => { polling = null; schedulePoll(); });
  }, young ? 100 : 500);
  polling.unref();
}

/**
 * Everything a command started, by pid and start time. A group kill misses
 * children that left the group, and the parent walk loses them once their
 * parent exits (launchd adopts them), so descendants are recorded while the
 * command runs. At kill time, adopted processes that started since then in
 * the command's folder are claimed too: a child spawned into a new session
 * by a parent that exits at once is never seen by a poll.
 */
export class ProcessFamily {
  private readonly members = new Map<number, string>();
  private readonly checked = new Set<string>();
  private killing: Promise<void> = Promise.resolve();

  /** `group` is the command's process group, or null to claim strays only. */
  constructor(readonly group: number | null, readonly options: { cwd: string; since: number }) {}

  get since(): number { return this.options.since; }

  watch(): void { watched.add(this); schedulePoll(); }

  /** Add group members and children of recorded members; forget pids now naming another process. */
  record(rows: readonly ProcessRow[]): void {
    const current = new Map(rows.map(row => [row.pid, row.started]));
    for (const [pid, started] of this.members) if (current.get(pid) !== started) this.members.delete(pid);
    // A group id outlives its leader only while members remain; later reuse starts later.
    const floor = this.options.since - 1_000;
    for (const row of rows) {
      if (row.pid !== process.pid && row.pgid === this.group && !(Date.parse(row.started) < floor)) this.members.set(row.pid, row.started);
    }
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows) {
        if (this.members.has(row.pid) || row.pid === process.pid || !this.members.has(row.ppid)) continue;
        this.members.set(row.pid, row.started); grew = true;
      }
    }
  }

  private async claimStrays(rows: readonly ProcessRow[]): Promise<void> {
    const uid = process.getuid?.();
    const floor = this.options.since - 1_000;
    const candidates = rows.filter(row => row.ppid === 1 && row.uid === uid && row.pid !== process.pid
      && !this.members.has(row.pid) && !this.checked.has(`${row.pid}:${row.started}`) && Date.parse(row.started) >= floor);
    if (!candidates.length) return;
    const cwd = await workingDirectories(candidates.map(row => row.pid));
    const inside = (dir: string) => dir === this.options.cwd || dir.startsWith(this.options.cwd + path.sep);
    for (const row of candidates) {
      this.checked.add(`${row.pid}:${row.started}`);
      const dir = cwd.get(row.pid);
      if (dir !== undefined && inside(dir)) this.members.set(row.pid, row.started);
    }
  }

  /**
   * SIGKILL every member still alive. Members are frozen until no new one
   * appears (a stopped process cannot fork), then killed.
   */
  kill(): Promise<void> {
    watched.delete(this);
    this.killing = this.killing.then(() => this.killOnce(), () => this.killOnce());
    return this.killing;
  }

  private async killOnce(): Promise<void> {
    const frozen = new Set<number>();
    // The whole group stops at once, but only while it is still this command's.
    let group = false;
    try {
      for (let round = 0; round < 16; round++) {
        const rows = await processTable();
        this.record(rows);
        await this.claimStrays(rows);
        group = rows.some(row => row.pgid === this.group && this.members.get(row.pid) === row.started);
        if (group) signal(-this.group!, 'SIGSTOP');
        let fresh = false;
        for (const pid of this.members.keys()) {
          if (frozen.has(pid)) continue;
          frozen.add(pid); fresh = true;
          signal(pid, 'SIGSTOP');
        }
        if (!fresh) break;
      }
    } catch { /* Kill what is known when ps fails. */ }
    finally {
      if (group) signal(-this.group!, 'SIGKILL');
      for (const pid of new Set([...frozen, ...this.members.keys()])) signal(pid, 'SIGKILL');
      this.members.clear();
    }
  }
}

/** SIGKILL a command's process group and every descendant recorded or found now. */
export function killProcessFamily(group: number, options: { cwd: string; since: number }): Promise<void> {
  return new ProcessFamily(group, options).kill();
}

/** SIGKILL whatever escaped every command since `since`: adopted processes in `cwd`, with their descendants. */
export function killStrays(cwd: string, since: number): Promise<void> {
  return new ProcessFamily(null, { cwd, since }).kill();
}

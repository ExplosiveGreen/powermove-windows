import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { killProcessFamily, killStrays, parseProcessTable, ProcessFamily, type ProcessRow } from './process-family';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const directories: string[] = [];
const strays: number[] = [];
afterEach(async () => {
  for (const pid of strays.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const folder = async () => { const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pm-family-'))); directories.push(dir); return dir; };
const START = 'Mon Sep 28 10:00:00 2026';

it('parses ps rows with their start time and ignores launchd and malformed lines', () => {
  expect(parseProcessTable(`    1     0     1     0 ${START}\n  200     1   200   501 ${START}   \nnoise\n  201   200   200   501 Tue Sep 29 09:05:07 2026\n`)).toEqual([
    { pid: 200, ppid: 1, pgid: 200, uid: 501, started: START },
    { pid: 201, ppid: 200, pgid: 200, uid: 501, started: 'Tue Sep 29 09:05:07 2026' }
  ]);
});

it('records descendants that left the group, keeps them after their parent exits, and forgets reused pids', () => {
  const row = (pid: number, ppid: number, pgid: number, started = START): ProcessRow => ({ pid, ppid, pgid, uid: 501, started });
  const family = new ProcessFamily(10, { cwd: '/w', since: Date.parse(START) });
  family.record([row(10, 5, 10), row(11, 10, 10), row(12, 11, 12), row(13, 12, 12), row(20, 1, 20), row(21, 5, 21)]);
  const members = () => [...(family as any).members.keys()].sort();
  expect(members()).toEqual([10, 11, 12, 13]);
  // 11 exits; launchd adopts 12, which stays recorded with its child.
  family.record([row(10, 5, 10), row(12, 1, 12), row(13, 12, 12), row(14, 13, 12)]);
  expect(members()).toEqual([10, 12, 13, 14]);
  // pid 13 now names a different process.
  family.record([row(10, 5, 10), row(12, 1, 12), row(13, 1, 13, 'Tue Sep 29 09:05:07 2026')]);
  expect(members()).toEqual([10, 12]);
});

it.runIf(process.platform === 'darwin')('kills a new-session child whose parent exited at once, but not strays from other folders', async () => {
  const cwd = await folder();
  const elsewhere = await folder();
  const since = Date.now();
  const orphan = (dir: string) => new Promise<number>(resolve => {
    // The leader exits at once; its detached child is adopted by launchd.
    const script = `const c = require('node:child_process').spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore', cwd: ${JSON.stringify(dir)} }); console.log(c.pid); c.unref();`;
    const leader = spawn(process.execPath, ['-e', script], { cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    leader.stdout.once('data', chunk => { const pid = Number(String(chunk)); strays.push(pid); resolve(pid); });
  });
  const [inside, outside] = await Promise.all([orphan(cwd), orphan(elsewhere)]);
  await expect.poll(async () => (await import('node:child_process')).execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(inside)], { encoding: 'utf8' }).trim()).toBe('1');
  await killStrays(cwd, since);
  await expect.poll(() => alive(inside)).toBe(false);
  expect(alive(outside)).toBe(true);
});

it.runIf(process.platform !== 'win32')('kills a group together with a child that started its own session', async () => {
  const cwd = await folder();
  // The leader spawns a detached (new-session) child, then keeps running.
  const script = `const c = require('node:child_process').spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
    process.stdout.write(String(c.pid)); setInterval(() => {}, 1000);`;
  const since = Date.now();
  const leader = spawn(process.execPath, ['-e', script], { cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const escaped = await new Promise<number>(resolve => leader.stdout.once('data', chunk => resolve(Number(String(chunk)))));
  strays.push(escaped);
  expect(alive(escaped)).toBe(true);
  const exited = new Promise(resolve => leader.once('exit', resolve));
  await killProcessFamily(leader.pid!, { cwd, since });
  await exited;
  await expect.poll(() => alive(escaped)).toBe(false);
});

it('ignores groups that are gone and never signals its own process', async () => {
  const options = { cwd: '/nonexistent-powermove', since: Date.now() };
  await expect(killProcessFamily(process.pid, options)).resolves.toBeUndefined();
  await expect(killProcessFamily(1, options)).resolves.toBeUndefined();
  await expect(killProcessFamily(2 ** 22 - 7, options)).resolves.toBeUndefined();
  expect(alive(process.pid)).toBe(true);
});

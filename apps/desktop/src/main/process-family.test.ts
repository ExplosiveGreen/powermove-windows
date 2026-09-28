import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { killProcessFamily, parseProcessTable, processFamily } from './process-family';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

it('parses ps rows and ignores launchd and malformed lines', () => {
  expect(parseProcessTable('    1     0     1\n  200     1   200\nnoise\n  201   200   200\n')).toEqual([
    { pid: 200, ppid: 1, pgid: 200 }, { pid: 201, ppid: 200, pgid: 200 }
  ]);
});

it('includes descendants that left the group while their parent lives, never strangers', () => {
  const rows = [
    { pid: 10, ppid: 5, pgid: 10 }, { pid: 11, ppid: 10, pgid: 10 },
    { pid: 12, ppid: 11, pgid: 12 }, { pid: 13, ppid: 12, pgid: 12 },
    { pid: 20, ppid: 1, pgid: 20 }, { pid: 21, ppid: 5, pgid: 21 }
  ];
  expect([...processFamily(rows, 10)].sort()).toEqual([10, 11, 12, 13]);
  expect(processFamily(rows, 99).size).toBe(0);
});

it.runIf(process.platform !== 'win32')('kills a group together with a child that started its own session', async () => {
  // The leader spawns a detached (new-session) child, then keeps running.
  const script = `const c = require('node:child_process').spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
    process.stdout.write(String(c.pid)); setInterval(() => {}, 1000);`;
  const leader = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const escaped = await new Promise<number>(resolve => leader.stdout.once('data', chunk => resolve(Number(String(chunk)))));
  expect(alive(escaped)).toBe(true);
  const exited = new Promise(resolve => leader.once('exit', resolve));
  await killProcessFamily(leader.pid!);
  await exited;
  await expect.poll(() => alive(escaped)).toBe(false);
});

it('ignores groups that are gone and never signals its own process', async () => {
  await expect(killProcessFamily(process.pid)).resolves.toBeUndefined();
  await expect(killProcessFamily(1)).resolves.toBeUndefined();
  await expect(killProcessFamily(2 ** 22 - 7)).resolves.toBeUndefined();
});

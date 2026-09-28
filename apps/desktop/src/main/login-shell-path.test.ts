import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
const userInfo = vi.hoisted(() => vi.fn(() => ({ shell: '/bin/zsh' })));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, userInfo } };
});

import { absolutePathEntries, loginShellCommand, loginShellPath, markedPath, resetLoginShellPathForTests } from './login-shell-path';

const originalPath = process.env.PATH;
beforeEach(() => { resetLoginShellPathForTests(); spawn.mockReset(); userInfo.mockReturnValue({ shell: '/bin/zsh' }); process.env.PATH = '/usr/bin:/bin'; });
afterEach(() => { process.env.PATH = originalPath; vi.useRealTimers(); });

/** A child that prints `stdout` and exits, or hangs when `stdout` is null. */
function reply(stdout: string | null, { close = true } = {}) {
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
    if (stdout !== null) queueMicrotask(() => { child.stdout.write(stdout); if (close) child.emit('close', 0); });
    return child;
  });
}

it('keeps absolute, unique entries only', () => {
  expect(absolutePathEntries('/opt/homebrew/bin:bin:./node_modules/.bin::/usr/bin:/opt/homebrew/bin:~/x')).toEqual(['/opt/homebrew/bin', '/usr/bin']);
  expect(absolutePathEntries(undefined)).toEqual([]);
});

it('reads the PATH between markers and ignores profile noise', () => {
  expect(markedPath('Welcome!\n__POWERMOVE_PATH_START__/a:/b__POWERMOVE_PATH_END__')).toBe('/a:/b');
  expect(markedPath('no markers')).toBeNull();
});

it('asks the login shell in its own syntax and falls back to zsh for unknown shells', () => {
  expect(loginShellCommand('/opt/homebrew/bin/bash')).toEqual(['/opt/homebrew/bin/bash', ['-ilc', expect.stringContaining('"$PATH"')]]);
  expect(loginShellCommand('/opt/homebrew/bin/fish')).toEqual(['/opt/homebrew/bin/fish', ['-l', '-i', '-c', expect.stringContaining('(string join : $PATH)')]]);
  expect(loginShellCommand('/usr/local/bin/nu')).toEqual(['/bin/zsh', ['-ilc', expect.stringContaining('"$PATH"')]]);
  expect(loginShellCommand(undefined)[0]).toBe('/bin/zsh');
  expect(loginShellCommand('fish')[0]).toBe('/bin/zsh');
});

it.runIf(process.platform === 'darwin')('probes the login shell once, without stdin, and always adds Homebrew and bun folders', async () => {
  userInfo.mockReturnValue({ shell: '/opt/homebrew/bin/bash' });
  reply('motd\n__POWERMOVE_PATH_START__/Users/me/.cargo/bin:relative:/usr/bin__POWERMOVE_PATH_END__');
  const expected = '/Users/me/.cargo/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/Users/me/.bun/bin:/bin:/usr/sbin:/sbin';
  expect(await loginShellPath('/Users/me')).toBe(expected);
  expect(await loginShellPath('/Users/me')).toBe(expected);
  expect(spawn).toHaveBeenCalledTimes(1);
  const [file, args, options] = spawn.mock.calls[0] ?? [];
  expect(file).toBe('/opt/homebrew/bin/bash');
  expect(args).toEqual(['-ilc', expect.stringContaining('"$PATH"')]);
  expect(options.stdio[0]).toBe('ignore');
  expect(options.env).toBeUndefined();
});

it.runIf(process.platform === 'darwin')('uses the marked PATH even when a profile daemon keeps stdout open', async () => {
  reply('__POWERMOVE_PATH_START__/opt/tools/bin__POWERMOVE_PATH_END__', { close: false });
  expect((await loginShellPath('/Users/me')).split(':')[0]).toBe('/opt/tools/bin');
});

it.runIf(process.platform === 'darwin')('falls back to common tool folders for a minute after a failed probe, then retries it', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  reply('no markers');
  const fallback = '/opt/homebrew/bin:/usr/local/bin:/Users/me/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  expect(await loginShellPath('/Users/me')).toBe(fallback);
  reply('__POWERMOVE_PATH_START__/opt/tools/bin__POWERMOVE_PATH_END__');
  vi.setSystemTime(Date.now() + 59_000);
  expect(await loginShellPath('/Users/me')).toBe(fallback);
  expect(spawn).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 1_000);
  expect((await loginShellPath('/Users/me')).split(':')[0]).toBe('/opt/tools/bin');
  expect(spawn).toHaveBeenCalledTimes(2);
});

it.runIf(process.platform === 'darwin')('gives up on a login shell that hangs', async () => {
  vi.useFakeTimers();
  reply(null);
  const pending = loginShellPath('/Users/me');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await pending).toBe('/opt/homebrew/bin:/usr/local/bin:/Users/me/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  expect(spawn.mock.results[0]?.value.kill).toHaveBeenCalledWith('SIGKILL');
});

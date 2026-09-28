import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

import { absolutePathEntries, loginShellPath, markedPath, resetLoginShellPathForTests } from './login-shell-path';

const originalPath = process.env.PATH;
beforeEach(() => { resetLoginShellPathForTests(); execFile.mockReset(); process.env.PATH = '/usr/bin:/bin'; });
afterEach(() => { process.env.PATH = originalPath; });
const reply = (error: Error | null, stdout = '') => execFile.mockImplementation((_file, _args, _options, callback) => callback(error, stdout));

it('keeps absolute, unique entries only', () => {
  expect(absolutePathEntries('/opt/homebrew/bin:bin:./node_modules/.bin::/usr/bin:/opt/homebrew/bin:~/x')).toEqual(['/opt/homebrew/bin', '/usr/bin']);
  expect(absolutePathEntries(undefined)).toEqual([]);
});

it('reads the PATH between markers and ignores profile noise', () => {
  expect(markedPath('Welcome!\n__POWERMOVE_PATH_START__/a:/b__POWERMOVE_PATH_END__')).toBe('/a:/b');
  expect(markedPath('no markers')).toBeNull();
});

it.runIf(process.platform === 'darwin')('probes the login shell once and passes nothing but PATH', async () => {
  reply(null, 'motd\n__POWERMOVE_PATH_START__/opt/homebrew/bin:relative:/Users/me/.bun/bin__POWERMOVE_PATH_END__');
  expect(await loginShellPath('/Users/me')).toBe('/opt/homebrew/bin:/Users/me/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  expect(await loginShellPath('/Users/me')).toBe('/opt/homebrew/bin:/Users/me/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  expect(execFile).toHaveBeenCalledTimes(1);
  const [file, args] = execFile.mock.calls[0] ?? [];
  expect(file).toBe('/bin/zsh');
  expect(args).toEqual(['-ilc', expect.stringContaining('"$PATH"')]);
});

it.runIf(process.platform === 'darwin')('falls back to common tool folders when the login shell fails', async () => {
  reply(new Error('timed out'));
  expect(await loginShellPath('/Users/me')).toBe('/opt/homebrew/bin:/usr/local/bin:/Users/me/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  expect(execFile).toHaveBeenCalledTimes(1);
});

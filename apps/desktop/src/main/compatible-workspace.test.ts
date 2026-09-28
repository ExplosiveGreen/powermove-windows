import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { COMPATIBLE_WORKSPACE_TOOLS, CompatibleWorkspace, runWorkspaceCommand } from './compatible-workspace';
import { prepareAgentWorkspace } from './codex/workspace';
import { agentResultSchema } from './codex/instructions';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const signal = () => new AbortController().signal;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pm-api-workspace-')); directories.push(directory);
  const layout = await prepareAgentWorkspace({ projectId: 'proof', provider: 'compatible', projectJSON: '{}', images: [], attachments: [] } as any, directory, 'project', agentResultSchema(), { extensionsDir: path.join(directory, 'extensions'), apiPackFiles: [] });
  return new CompatibleWorkspace(layout, 'project');
}

it('creates, reads and lists files and rejects path and symbolic-link escapes', async () => {
  const ws = await workspace();
  await ws.call('write_file', { path: 'nested/file.txt', text: 'hello' }, signal());
  expect(await readFile(path.join(ws.layout.root, 'nested/file.txt'), 'utf8')).toBe('hello');
  expect(JSON.stringify(await ws.call('read_file', { path: 'nested/file.txt', offset: 1, limit: 2 }, signal()))).toContain('el');
  expect(JSON.stringify(await ws.call('list_files', { path: 'nested' }, signal()))).toContain('file.txt');
  await expect(ws.call('write_file', { path: '../escaped.txt', text: 'no' }, signal())).rejects.toThrow('outside');
  await symlink(path.dirname(ws.layout.root), path.join(ws.layout.root, 'escape'));
  await expect(ws.call('write_file', { path: 'escape/escaped.txt', text: 'no' }, signal())).rejects.toThrow('symbolic link');
});

it.runIf(process.platform === 'darwin')('writes files and compiles where a planted dangling link cannot lead outside', async () => {
  const ws = await workspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pm-planted-')); directories.push(outside);
  await symlink(path.join(outside, 'created.txt'), path.join(ws.layout.root, 'dangling.txt'));
  await expect(ws.call('write_file', { path: 'dangling.txt', text: 'escaped' }, signal())).rejects.toThrow();
  await symlink(outside, path.join(ws.layout.runDirectory, '.compiled'));
  const dir = path.join(ws.layout.stagingDirectory, 'linked-out');
  await ws.call('write_file', { path: path.join(dir, 'manifest.json'), text: JSON.stringify({ id: 'linked-out', name: 'Linked', version: '1.0.0', apiVersion: 1, contributes: ['effects'] }) }, signal());
  await ws.call('write_file', { path: path.join(dir, 'index.ts'), text: 'export default function activate() {}' }, signal());
  expect(JSON.parse(((await ws.call('compile_extension', { id: 'linked-out' }, signal()))[0] as any).text)).toMatchObject({ ok: true });
  expect(await readdir(outside)).toEqual([]);
});

it('reports real compile errors before publishing and exports created artifacts', async () => {
  const ws = await workspace();
  const dir = path.join(ws.layout.stagingDirectory, 'broken-effect');
  await ws.call('write_file', { path: path.join(dir, 'manifest.json'), text: JSON.stringify({ id: 'broken-effect', name: 'Broken', version: '1.0.0', apiVersion: 1, contributes: ['effects'] }) }, signal());
  await ws.call('write_file', { path: path.join(dir, 'index.ts'), text: 'export const = ;' }, signal());
  const result = { summary: 'Done', commands: [], artifacts: [], extensions: [{ id: 'broken-effect', action: 'created' }], notes: [], externalActions: [] };
  await expect(ws.finish(result, signal())).rejects.toThrow('failed compilation');
  await expect(access(path.join(ws.layout.liveDirectory, 'broken-effect'))).rejects.toThrow();
  await ws.call('write_file', { path: path.join(dir, 'index.ts'), text: 'export default function activate() {}' }, signal());
  await ws.call('write_file', { path: path.join(ws.layout.runDirectory, 'note.txt'), text: 'proof' }, signal());
  const finished = await ws.finish(result, signal());
  expect(finished.ok).toBe(true);
  if (finished.ok) expect(JSON.parse(finished.text).artifacts).toEqual([expect.objectContaining({ name: 'note.txt', size: 5 })]);
});

it.runIf(process.platform === 'darwin')('runs commands with real Project write isolation and propagates cancellation', async () => {
  const ws = await workspace();
  const outside = path.join(path.dirname(ws.layout.root), 'outside.txt');
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const success = await runWorkspaceCommand(ws.layout.root, 'project', 'printf proof > proof.txt && cat proof.txt', 5000, signal());
  expect(success).toMatchObject({ output: 'proof', exitCode: 0 });
  const denied = await runWorkspaceCommand(ws.layout.root, 'project', `printf denied > ${quote(outside)}`, 5000, signal());
  expect(denied.exitCode).not.toBe(0);
  await expect(access(outside)).rejects.toThrow();
  await expect(runWorkspaceCommand(ws.layout.root, 'project', 'sleep 10', 25, signal())).rejects.toThrow('timed out');
  const controller = new AbortController();
  const pending = runWorkspaceCommand(ws.layout.root, 'project', 'sleep 10', 5000, controller.signal);
  setTimeout(() => controller.abort(new Error('Stopped by test')), 30);
  await expect(pending).rejects.toThrow('Stopped by test');
});

it.runIf(process.platform === 'darwin')('keeps Project temp files, heredocs and mktemp inside the workspace scratch folder', async () => {
  const ws = await workspace();
  const scratch = path.join(await realpath(ws.layout.root), '.powermove', 'tmp');
  const heredoc = await runWorkspaceCommand(ws.layout.root, 'project', 'cat <<EOF\nheredoc works\nEOF', 5000, signal());
  expect(heredoc).toMatchObject({ output: 'heredoc works\n', exitCode: 0 });
  const script = [
    'a=$(mktemp) && b=$(mktemp -d) && c=$(mktemp -t render) && d=$(mktemp -dq -t clip)',
    'e=$(mktemp -p "$TMPDIR/.." inside.XXXXXX) && f=$(mktemp local.XXXXXX)',
    'printf data > "$a" && printf "%s\\n" "$a" "$b" "$c" "$d" "$e" "$f" && [ -d "$b" ] && [ -d "$d" ] && cat "$a"'
  ].join(' && ');
  const made = await runWorkspaceCommand(ws.layout.root, 'project', script, 5000, signal());
  expect(made.exitCode, made.output).toBe(0);
  const [a = '', b = '', c = '', d = '', e = '', f = '', data] = made.output.split('\n');
  for (const file of [a, b, c, d]) expect(path.dirname(file)).toBe(scratch);
  expect(path.basename(c)).toMatch(/^render\.[A-Za-z0-9]{8}$/);
  expect(path.basename(d)).toMatch(/^clip\./);
  expect(path.normalize(e)).toMatch(new RegExp(`^${escapeRegExp(path.dirname(scratch))}/inside\\.[A-Za-z0-9]{6}$`));
  expect(f).toMatch(/^local\.[A-Za-z0-9]{6}$/);
  expect(data).toBe('data');
  expect((await runWorkspaceCommand(ws.layout.root, 'project', 'printf "%s|%s|%s" "$TMP" "$TEMP" "$TMPPREFIX"', 5000, signal())).output)
    .toBe(`${scratch}|${scratch}|${path.join(scratch, 'zsh')}`);
  // An explicit template outside the workspace is still refused.
  expect((await runWorkspaceCommand(ws.layout.root, 'project', 'mktemp /private/tmp/pm-escape.XXXXXX', 5000, signal())).exitCode).not.toBe(0);
});

it.runIf(process.platform === 'darwin')('never writes tool shims or scratch folders through links a command planted', async () => {
  const ws = await workspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pm-planted-')); directories.push(outside);
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const target = path.join(outside, 'zshrc');
  await writeFile(target, 'keep', { mode: 0o600 });
  const plant = (script: string) => runWorkspaceCommand(ws.layout.root, 'project', script, 5000, signal());
  expect((await plant(`mkdir -p .powermove/bin && ln -sf ${quote(target)} .powermove/bin/mktemp`)).exitCode).toBe(0);
  expect((await plant('mktemp')).exitCode).toBe(0);
  expect(await readFile(target, 'utf8')).toBe('keep');
  expect((await stat(target)).mode & 0o777).toBe(0o600);
  // A linked bin/ or scratch folder must not let main create files or folders elsewhere.
  expect((await plant(`rm -rf .powermove/bin .powermove/tmp && ln -s ${quote(outside)} .powermove/bin && ln -s ${quote(path.join(outside, 'scratch'))} .powermove/tmp`)).exitCode).toBe(0);
  await plant('true');
  expect(await readdir(outside)).toEqual(['zshrc']);
});

it.runIf(process.platform === 'darwin')('gives commands the login PATH without the rest of the host environment', async () => {
  const ws = await workspace();
  process.env.PM_TEST_PROVIDER_TOKEN = 'must-not-leak';
  try {
    const result = await runWorkspaceCommand(ws.layout.root, 'project', 'env', 5000, signal());
    expect(result.output).not.toContain('must-not-leak');
    const PATH = /^PATH=(.*)$/m.exec(result.output)?.[1]?.split(':') ?? [];
    // ~/.zshenv may still prepend its own entries inside the shell.
    const bin = path.join(path.dirname(path.dirname(await realpath(ws.layout.root))), 'Agent Tools', 'bin');
    expect(PATH).toEqual(expect.arrayContaining([bin, '/usr/bin', '/bin']));
    expect(PATH.indexOf(bin)).toBeLessThan(PATH.indexOf('/usr/bin'));
    expect(PATH.every(entry => path.isAbsolute(entry))).toBe(true);
  } finally { delete process.env.PM_TEST_PROVIDER_TOKEN; }
});

it.runIf(process.platform === 'darwin')('caches bun and npm installs in the workspace while HOME stays unwritable', async ({ skip }) => {
  const ws = await workspace();
  const root = await realpath(ws.layout.root);
  const probe = path.join(os.homedir(), `.powermove-sandbox-probe-${process.pid}`);
  const home = await runWorkspaceCommand(ws.layout.root, 'project', `printf x > ${JSON.stringify(probe)}`, 5000, signal());
  expect(home.exitCode).not.toBe(0);
  await expect(access(probe)).rejects.toThrow();
  const cache = (tool: string) => path.join(root, '.powermove', 'cache', tool);
  const env = await runWorkspaceCommand(ws.layout.root, 'project', 'printf "%s|%s|%s|%s" "$BUN_INSTALL_CACHE_DIR" "$npm_config_cache" "$XDG_CACHE_HOME" "$PIP_CACHE_DIR"', 5000, signal());
  expect(env.output).toBe([cache('bun'), cache('npm'), cache('xdg'), cache('pip')].join('|'));
  const tools = await runWorkspaceCommand(ws.layout.root, 'project', 'command -v bun >/dev/null && command -v npm >/dev/null', 5000, signal());
  if (tools.exitCode !== 0) skip('bun and npm are not installed');
  await writeFile(path.join(root, 'package.json'), '{"name":"cache-proof","private":true}');
  const bun = await runWorkspaceCommand(ws.layout.root, 'project', 'bun add is-number@7.0.0', 120_000, signal());
  expect(bun.exitCode, bun.output).toBe(0);
  expect((await readdir(cache('bun'))).some(name => name.startsWith('is-number'))).toBe(true);
  const npm = await runWorkspaceCommand(ws.layout.root, 'project', 'npm install --no-audit --no-fund --no-save is-odd@3.0.1', 120_000, signal());
  expect(npm.exitCode, npm.output).toBe(0);
  expect(await readdir(cache('npm'))).toContain('_cacache');
}, 300_000);

it.runIf(process.platform === 'darwin')('keeps outbound network in Project access for research and downloads', async () => {
  const ws = await workspace();
  const result = await runWorkspaceCommand(ws.layout.root, 'project', 'curl -sI --max-time 20 https://images.pexels.com -o /dev/null -w "%{http_code}"', 30_000, signal());
  expect(result.exitCode, result.output).toBe(0);
  expect(Number(result.output)).toBeGreaterThan(0);
}, 40_000);

it.runIf(process.platform === 'darwin')('stops what a command leaves running and refuses new sessions', async () => {
  const ws = await workspace();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const leftover = await runWorkspaceCommand(ws.layout.root, 'project', 'sleep 30 >/dev/null 2>&1 & printf %s $!', 5000, signal());
  await expect.poll(() => alive(Number(leftover.output))).toBe(false);
  // Piped, so perl is not already a session leader (which would refuse anyway).
  const setsid = await runWorkspaceCommand(ws.layout.root, 'project', `perl -MPOSIX -e 'POSIX::setsid() < 0 and die "setsid: $!\\n"; print "escaped"' 2>&1 | cat`, 5000, signal());
  expect(setsid.output).toBe('setsid: Operation not permitted\n');
  // posix_spawn can still start a new session; its live parent leads to it.
  const script = `const c = require('node:child_process').spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000);`;
  const node = JSON.stringify(process.execPath);
  const timedOut = await runWorkspaceCommand(ws.layout.root, 'project', `${node} -e ${JSON.stringify(script)}`, 1500, signal()).catch((error: Error) => error.message);
  const escaped = Number(/(\d+)/.exec(String(timedOut))?.[1]);
  expect(escaped).toBeGreaterThan(1);
  await expect.poll(() => alive(escaped)).toBe(false);
});

it.runIf(process.platform === 'darwin')('stops detached children after their parent exits, at once or after they moved away', async () => {
  const ws = await workspace();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const node = (script: string) => `${quote(process.execPath)} -e ${quote(script)}`;
  // The parent exits immediately, so no parent link leads to the child.
  const late = `require('node:child_process').spawn('/bin/sh', ['-c', 'echo $$ > late.pid; sleep 1; echo late > late.txt'], { detached: true, stdio: 'ignore' }).unref()`;
  expect((await runWorkspaceCommand(ws.layout.root, 'project', node(late), 5000, signal())).exitCode).toBe(0);
  // This one leaves the workspace folder while its parent still lives.
  const moved = `const c = require('node:child_process').spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore', cwd: '/' }); c.unref(); console.log(c.pid); setTimeout(() => {}, 800)`;
  const escaped = Number((await runWorkspaceCommand(ws.layout.root, 'project', node(moved), 5000, signal())).output);
  expect(escaped).toBeGreaterThan(1);
  await expect.poll(() => alive(escaped)).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await expect(access(path.join(ws.layout.root, 'late.txt'))).rejects.toThrow();
  const latePid = Number(await readFile(path.join(ws.layout.root, 'late.pid'), 'utf8').catch(() => '0'));
  if (latePid) expect(alive(latePid)).toBe(false);
});

it('allows up to ten minutes per command and keeps the thirty second default', async () => {
  const ws = await workspace();
  await expect(ws.call('run_command', { command: 'true', timeoutMs: 600_001 }, signal())).rejects.toThrow('between 1 and 600000');
  await expect(ws.call('run_command', { command: 'true', background: 'yes' }, signal())).rejects.toThrow('background');
  const spec = COMPATIBLE_WORKSPACE_TOOLS.find(tool => tool.name === 'run_command')!;
  expect((spec.inputSchema as any).properties.timeoutMs.maximum).toBe(600_000);
  expect(spec.description).toContain('30 seconds');
});

it.runIf(process.platform === 'darwin')('runs background jobs, reports them and stops them with everything they started', async () => {
  const ws = await workspace();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const json = async (name: string, args: Record<string, unknown>) => JSON.parse(((await ws.call(name, args, signal()))[0] as any).text);
  expect(await json('run_command', { command: 'sleep 0.2; printf done', background: true })).toEqual({ jobId: 'job-1', state: 'running' });
  expect(await json('command_status', { jobId: 'job-1', waitMs: 10_000 })).toMatchObject({ jobId: 'job-1', state: 'exited', exitCode: 0, output: 'done' });
  await ws.call('run_command', { command: 'printf "%s " $$; sleep 30 & printf "%s" $!; wait', background: true }, signal());
  await expect.poll(async () => (await json('command_status', { jobId: 'job-2' })).output).toMatch(/^\d+ \d+$/);
  const pids = (await json('command_status', { jobId: 'job-2' })).output.split(' ').map(Number) as number[];
  expect(pids.every(alive)).toBe(true);
  expect(await json('command_status', { jobId: 'job-2', stop: true })).toMatchObject({ state: 'stopped' });
  for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false);
  await expect(ws.call('command_status', { jobId: 'job-9' }, signal())).rejects.toThrow('Unknown background job');
  for (let index = 0; index < 4; index++) await ws.call('run_command', { command: 'sleep 30', background: true }, signal());
  await expect(ws.call('run_command', { command: 'sleep 30', background: true }, signal())).rejects.toThrow('At most 4');
  await ws.stopCommands();
  expect((await json('command_status', { jobId: 'job-6' })).state).toBe('stopped');
});

it.runIf(process.platform === 'darwin')('stops background jobs before complete_task validates and when the run is stopped', async () => {
  const ws = await workspace();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const pidOf = async (file: string) => {
    await expect.poll(() => readFile(path.join(ws.layout.root, file), 'utf8').then(text => /^\d+\n$/.test(text), () => false)).toBe(true);
    return Number(await readFile(path.join(ws.layout.root, file), 'utf8'));
  };
  await ws.call('run_command', { command: 'echo $$ > a.pid; exec sleep 30', background: true }, signal());
  const first = await pidOf('a.pid');
  // Validation fails, but the job is already gone.
  await expect(ws.finish({ summary: 'x' }, signal())).rejects.toThrow('complete_task requires');
  expect(alive(first)).toBe(false);
  const controller = new AbortController();
  await ws.call('run_command', { command: 'echo $$ > b.pid; exec sleep 30', background: true }, controller.signal);
  const second = await pidOf('b.pid');
  controller.abort(new Error('Stopped by test'));
  await expect.poll(() => alive(second)).toBe(false);
});

it.runIf(process.platform === 'darwin')('lets Project commands write to their inherited stdio but not other devices', async () => {
  const ws = await workspace();
  const result = await runWorkspaceCommand(ws.layout.root, 'project', 'printf out > /dev/stdout && printf fd > /dev/fd/1 && printf err > /dev/stderr', 5000, signal());
  expect(result.exitCode).toBe(0);
  // stdout and stderr are separate pipes, so only their own order is fixed.
  expect(result.output.replace('err', '')).toBe('outfd');
  expect(result.output).toContain('err');
  const device = await runWorkspaceCommand(ws.layout.root, 'project', 'printf x > /dev/zero', 5000, signal());
  expect(device.exitCode).not.toBe(0);
  expect(device.output).toContain('not permitted');
});

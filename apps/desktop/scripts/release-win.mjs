import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repository = path.resolve(import.meta.dirname, '..');

async function run(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: repository,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    if (error?.stdout) process.stdout.write(error.stdout);
    if (error?.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

async function main() {
  if (process.argv.includes('--check')) {
    process.stdout.write('Windows release lane needs no signing credentials (unsigned NSIS).\n');
    return;
  }

  const { version } = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
  const channel = /^\d+\.\d+\.\d+-([a-z]+)\./i.exec(version)?.[1]?.toLowerCase() ?? 'latest';

  await run('bun', ['run', 'build']);
  await run(path.join(repository, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.exe' : 'electron-builder'), [
    '--win', '--x64', '--publish', 'never',
    '--config', 'electron-builder.win.yml',
    `--config.publish.channel=${channel}`,
  ]);

  const dist = path.join(repository, 'dist');
  const entries = await readdir(dist);
  const setup = entries.find((name) => name.endsWith('-setup.exe'));
  if (!setup) throw new Error('The Windows NSIS setup was not found in dist/.');
  process.stdout.write(`Verified Windows release: ${path.join(dist, setup)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { updatedRuntimeCandidates } from '../runtime-updates';

export const PACKAGED_CLAUDE_RELATIVE_PATH = path.join('claude', 'bin', 'claude');
export const PACKAGED_CLAUDE_WINDOWS_RELATIVE_PATHS = [
  path.join('claude', 'bin', 'claude.exe'),
  path.join('claude.exe'),
] as const;
// Development (node_modules) layout differs per OS. The darwin package carries
// a `claude` file; the win32 package carries `claude.exe`.
export const DEVELOPMENT_CLAUDE_DARWIN_RELATIVE_PATH = path.join(
  'node_modules',
  '@anthropic-ai',
  'claude-code-darwin-arm64',
  'claude'
);
export const DEVELOPMENT_CLAUDE_WINDOWS_RELATIVE_PATH = path.join(
  'node_modules',
  '@anthropic-ai',
  'claude-code-win32-x64',
  'claude.exe'
);
export const DEVELOPMENT_CLAUDE_RELATIVE_PATH = process.platform === 'win32'
  ? DEVELOPMENT_CLAUDE_WINDOWS_RELATIVE_PATH
  : DEVELOPMENT_CLAUDE_DARWIN_RELATIVE_PATH;

export const CLAUDE_NOT_FOUND_MESSAGE =
  "Powermove's built-in Claude runtime is missing or unavailable. Reinstall Powermove or set CLAUDE_BINARY.";

let loginShellProbe: Promise<string | null> | null = null;

async function executable(candidate: string | null | undefined): Promise<string | null> {
  const value = candidate?.trim();
  if (!value) return null;
  try {
    if (!(await stat(value)).isFile()) return null;
    await access(value, constants.X_OK);
    return value;
  } catch {
    return null;
  }
}

function execFileText(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function probeLoginShell(): Promise<string | null> {
  // Windows has no zsh login shell; PATH discovery happens in
  // login-shell-path.ts, so skip the POSIX probe here.
  if (process.platform === 'win32') return null;
  if (loginShellProbe === null) {
    loginShellProbe = (async () => {
      try {
        const stdout = await execFileText('/bin/zsh', ['-ilc', 'command -v claude']);
        return executable(stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1));
      } catch {
        return null;
      }
    })();
  }
  return loginShellProbe;
}

export function bundledClaudeCandidates(
  appRoot = process.cwd(),
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
): string[] {
  const candidates: string[] = [];
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, PACKAGED_CLAUDE_RELATIVE_PATH));
    for (const relative of PACKAGED_CLAUDE_WINDOWS_RELATIVE_PATHS) {
      const candidate = path.join(resourcesPath, relative);
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  }
  candidates.push(path.join(appRoot, DEVELOPMENT_CLAUDE_RELATIVE_PATH));
  return [...updatedRuntimeCandidates('claude'), ...candidates];
}

export async function discoverClaudeBinary(
  preference: string | null = null,
  options: { bundledCandidates?: readonly string[] } = {}
): Promise<string> {
  for (const candidate of [
    process.env.CLAUDE_BINARY,
    preference,
    ...(options.bundledCandidates ?? bundledClaudeCandidates())
  ]) {
    const found = await executable(candidate);
    if (found) return found;
  }
  const shellBinary = await probeLoginShell();
  if (shellBinary !== null) return shellBinary;
  throw new Error(CLAUDE_NOT_FOUND_MESSAGE);
}

export function resetClaudeEnvironmentCacheForTests(): void {
  loginShellProbe = null;
}

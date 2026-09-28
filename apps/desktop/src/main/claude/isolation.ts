import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { prepareUserResources } from '../agent-tools/user-resources';

export const ISOLATED_CLAUDE_HOME_NAME = 'claude-runtime';

export function isolatedClaudeHome(userData: string): string {
  return path.join(userData, ISOLATED_CLAUDE_HOME_NAME);
}

export async function prepareIsolatedClaudeHome(
  userData: string,
  sourceHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude')
): Promise<string> {
  const directory = isolatedClaudeHome(userData);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await prepareUserResources(directory, sourceHome, 'claude');
  return directory;
}

/** Claude Code owns every credential inside this directory. Powermove never
 * reads or copies OAuth material, and logout cannot affect a terminal login. */
export function isolatedClaudeEnvironment(configDirectory: string): NodeJS.ProcessEnv {
  // Safe mode suppresses MCP servers, including the run-scoped Powermove tools.
  // Keep private authentication while loading shared user resources.
  const environment = { ...process.env };
  delete environment.CLAUDE_CODE_SAFE_MODE;
  return {
    ...environment,
    CLAUDE_CONFIG_DIR: configDirectory
  };
}

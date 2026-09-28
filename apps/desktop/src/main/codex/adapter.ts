import { execFile } from 'node:child_process';
import type { CodexAccess, ReasoningEffort } from '../../shared/ipc';
import { discoverCodexBinary } from './env';
import { AGENT_TESTING_INSTRUCTIONS } from '../../shared/agent-testing';
import type { NativeMcpServerConfig } from '../agent-tools/spec';

import { userMcpArgv, type UserMcpServers } from '../agent-tools/user-mcp';

export const ADAPTER_VERSION = '5';

export const REQUIRED_CODEX_FLAGS = [
  '--ephemeral',
  '--skip-git-repo-check',
  '--sandbox',
  '--output-schema',
  '--output-last-message',
  '--json',
  '--model',
  '--config',
  '--image',
  '--search',
  '--add-dir',
  '--approve-for-me',
  '--dangerously-bypass-approvals-and-sandbox'
] as const;

/** Documented workspace-write switch. Codex 0.156 has no stable per-host
 * allowlist for it, so this is all outbound hosts. */
export const PROJECT_NETWORK_CONFIG = 'sandbox_workspace_write.network_access=true';

interface CommonArgvOptions {
  schemaPath: string;
  outputPath: string;
  prompt: string;
  imagePaths: readonly string[];
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  externalMcpServers?: UserMcpServers;
}

export interface EditorArgvOptions extends CommonArgvOptions {}

export interface AutonomousArgvOptions extends CommonArgvOptions {
  access: Exclude<CodexAccess, 'editor'>;
  extensionsDir: string;
  sessionId: string | null;
  instructions: string;
  nativeTools?: NativeMcpServerConfig;
}

function appendModelOptions(
  argv: string[],
  model: string | null,
  reasoningEffort: ReasoningEffort | null
): void {
  if (model !== null) argv.push('--model', model);
  if (reasoningEffort !== null) {
    argv.push('--config', `model_reasoning_effort="${reasoningEffort}"`);
  }
}

function appendPromptAndImages(argv: string[], prompt: string, imagePaths: readonly string[]): void {
  argv.push(prompt);
  for (const imagePath of imagePaths) argv.push('--image', imagePath);
}

function nativeMcpArgv(config?: NativeMcpServerConfig): string[] {
  if (!config) return [];
  const argv = [
    '--config', `mcp_servers.powermove.command=${JSON.stringify(config.command)}`,
    '--config', `mcp_servers.powermove.args=${JSON.stringify(config.args)}`,
    '--config', 'mcp_servers.powermove.required=true',
    '--config', 'mcp_servers.powermove.startup_timeout_sec=30',
    '--config', 'mcp_servers.powermove.tool_timeout_sec=120'
  ];
  for (const [name, value] of Object.entries(config.env).sort(([a], [b]) => a.localeCompare(b))) {
    argv.push('--config', `mcp_servers.powermove.env.${name}=${JSON.stringify(value)}`);
  }
  return argv;
}

export function buildEditorArgv(options: EditorArgvOptions): string[] {
  const argv = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    ...userMcpArgv(options.externalMcpServers),
    '--sandbox',
    'read-only',
    '--output-schema',
    options.schemaPath,
    '--output-last-message',
    options.outputPath,
    '--json'
  ];
  appendModelOptions(argv, options.model, options.reasoningEffort);
  appendPromptAndImages(argv, `${AGENT_TESTING_INSTRUCTIONS}\n\n${options.prompt}`, options.imagePaths);
  return argv;
}

export function buildAutonomousArgv(options: AutonomousArgvOptions): string[] {
  const argv = ['--search'];
  if (options.access === 'computer') {
    argv.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    // codex ≥ 0.147 rejects an explicit --sandbox alongside --approve-for-me;
    // --approve-for-me itself routes approvals through the workspace-write
    // sandbox (the Swift shell's flag pair predates that change).
    // Shell commands get outbound network so research-and-download tasks can
    // finish; writes stay confined to the workspace and --add-dir roots.
    argv.push('--approve-for-me', '--config', PROJECT_NETWORK_CONFIG);
  }
  argv.push('--add-dir', options.extensionsDir);

  argv.push('exec');
  if (options.sessionId !== null && options.sessionId.trim() !== '') argv.push('resume');
  argv.push(
    '--skip-git-repo-check',
    ...userMcpArgv(options.externalMcpServers),
    ...nativeMcpArgv(options.nativeTools),
    '--output-schema',
    options.schemaPath,
    '--output-last-message',
    options.outputPath,
    '--json'
  );
  appendModelOptions(argv, options.model, options.reasoningEffort);
  if (options.sessionId !== null && options.sessionId.trim() !== '') argv.push(options.sessionId.trim());
  const fullPrompt = `${options.instructions}\n\nUSER REQUEST\n${options.prompt}`;
  appendPromptAndImages(argv, fullPrompt, options.imagePaths);
  return argv;
}

export interface AdapterCapabilities {
  adapterVersion: string;
  supported: string[];
  missing: string[];
}

function execFileText(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export async function capabilities(binary?: string | null): Promise<AdapterCapabilities> {
  const executable = binary ?? await discoverCodexBinary(null);
  const help = await execFileText(executable, ['exec', '--help']);
  const supported = REQUIRED_CODEX_FLAGS.filter((flag) => help.includes(flag));
  const missing = REQUIRED_CODEX_FLAGS.filter((flag) => !help.includes(flag));
  return { adapterVersion: ADAPTER_VERSION, supported: [...supported], missing: [...missing] };
}

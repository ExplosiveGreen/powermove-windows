import { execFile } from 'node:child_process';
import type { CodexAccess, ReasoningEffort } from '../../shared/ipc';
import { discoverCodexBinary } from './env';
import { AGENT_TESTING_INSTRUCTIONS } from '../../shared/agent-testing';
import type { NativeMcpServerConfig } from '../agent-tools/spec';

import { userMcpArgv, type UserMcpServers } from '../agent-tools/user-mcp';
import { AGENT_SHELL_NETWORK_HOSTS, AGENT_SHELL_NETWORK_INSTRUCTIONS } from '../agent-network';

export const ADAPTER_VERSION = '6';

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
  '--dangerously-bypass-approvals-and-sandbox'
] as const;

/** The permission profile sandboxed Project shells run under. */
export const PROJECT_PERMISSION_PROFILE = 'powermove';

/**
 * `--approve-for-me` without its legacy `sandbox_mode="workspace-write"`,
 * which would override a permission profile. The profile extends Codex's
 * workspace sandbox, denies credential reads, and with shell network routes
 * commands through Codex's network proxy, which admits only the shared
 * allowlist; the sandbox blocks direct sockets and DNS. They follow `exec`
 * because root-level approval and profile overrides do not reach it.
 */
export function projectSandboxArgv(options: { shellNetwork: boolean; deniedReads: readonly string[] }): string[] {
  const profile = `permissions.${PROJECT_PERMISSION_PROFILE}`;
  const table = (entries: [string, string][]) => `{${entries.map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',')}}`;
  const config = [
    'approvals_reviewer="auto_review"',
    'approval_policy="on-request"',
    `default_permissions=${JSON.stringify(PROJECT_PERMISSION_PROFILE)}`,
    `${profile}.extends=":workspace"`
  ];
  if (options.deniedReads.length) config.push(`${profile}.filesystem=${table(options.deniedReads.map(file => [file, 'deny']))}`);
  if (options.shellNetwork) {
    config.push(
      'features.network_proxy=true',
      `${profile}.network.enabled=true`,
      `${profile}.network.domains=${table(AGENT_SHELL_NETWORK_HOSTS.map(host => [host, 'allow']))}`
    );
  }
  return config.flatMap(value => ['--config', value]);
}

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
  /** Outbound network for sandboxed shell commands, limited to the shared
   * allowlist. Only the Project access choice grants it; Edit project runs
   * keep project authority without it. */
  shellNetwork?: boolean;
  /** Paths sandboxed shell commands may not read. */
  deniedReads?: readonly string[];
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
  const sandboxed = options.access !== 'computer';
  if (!sandboxed) argv.push('--dangerously-bypass-approvals-and-sandbox');
  argv.push('--add-dir', options.extensionsDir);

  argv.push('exec');
  if (options.sessionId !== null && options.sessionId.trim() !== '') argv.push('resume');
  argv.push(
    '--skip-git-repo-check',
    ...sandboxed ? projectSandboxArgv({ shellNetwork: options.shellNetwork === true, deniedReads: options.deniedReads ?? [] }) : [],
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
  const network = sandboxed && options.shellNetwork ? `\n\nSHELL NETWORK\n${AGENT_SHELL_NETWORK_INSTRUCTIONS}` : '';
  const fullPrompt = `${options.instructions}${network}\n\nUSER REQUEST\n${options.prompt}`;
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

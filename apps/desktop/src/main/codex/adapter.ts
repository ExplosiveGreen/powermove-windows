import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
 * The sandbox is final: `never` stops the model from asking for an
 * unsandboxed command, and there is no approval reviewer to grant one. No
 * legacy `sandbox_mode` either, which would override a permission profile.
 * The profile extends Codex's workspace sandbox, denies credential reads,
 * and with shell network routes commands through Codex's network proxy,
 * which admits only the shared allowlist; the sandbox blocks direct sockets
 * and DNS. They follow `exec` because root-level approval and profile
 * overrides do not reach it.
 *
 * The workspace is marked untrusted: other agents can write it, and a trusted
 * project would load its `.codex` config, MCP servers, hooks and rules
 * outside the sandbox.
 */
export function projectSandboxArgv(options: { shellNetwork: boolean; deniedReads: readonly string[]; workspaceRoots: readonly string[] }): string[] {
  const profile = `permissions.${PROJECT_PERMISSION_PROFILE}`;
  const table = (entries: [string, string][]) => `{${entries.map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',')}}`;
  const config = [
    'approval_policy="never"',
    `default_permissions=${JSON.stringify(PROJECT_PERMISSION_PROFILE)}`,
    `${profile}.extends=":workspace"`
  ];
  if (options.workspaceRoots.length) {
    config.push(`projects={${[...new Set(options.workspaceRoots)].map(root => `${JSON.stringify(root)}={trust_level="untrusted"}`).join(',')}}`);
  }
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
  /** The workspace as given and as its real path; Codex keys trust by the real one. */
  workspaceRoots?: readonly string[];
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
    // `never` would otherwise refuse the run-scoped tools, which carry no annotations.
    '--config', 'mcp_servers.powermove.default_tools_approval_mode="approve"',
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

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export function buildAutonomousArgv(options: AutonomousArgvOptions): string[] {
  const argv = ['--search'];
  const sandboxed = options.access !== 'computer';
  if (!sandboxed) argv.push('--dangerously-bypass-approvals-and-sandbox');
  argv.push('--add-dir', options.extensionsDir);

  const sessionId = options.sessionId?.trim() || null;
  if (sessionId !== null && !SESSION_ID.test(sessionId)) throw new Error('Invalid Codex session id.');
  argv.push('exec');
  if (sessionId !== null) argv.push('resume');
  argv.push(
    '--skip-git-repo-check',
    ...sandboxed ? projectSandboxArgv({
      shellNetwork: options.shellNetwork === true, deniedReads: options.deniedReads ?? [], workspaceRoots: options.workspaceRoots ?? []
    }) : [],
    ...userMcpArgv(options.externalMcpServers),
    ...nativeMcpArgv(options.nativeTools),
    '--output-schema',
    options.schemaPath,
    '--output-last-message',
    options.outputPath,
    '--json'
  );
  appendModelOptions(argv, options.model, options.reasoningEffort);
  for (const imagePath of options.imagePaths) argv.push('--image', imagePath);
  // Positionals follow `--`, so neither the session id nor the prompt can read as a flag.
  argv.push('--');
  if (sessionId !== null) argv.push(sessionId);
  const network = sandboxed && options.shellNetwork ? `\n\nSHELL NETWORK\n${AGENT_SHELL_NETWORK_INSTRUCTIONS}` : '';
  argv.push(`${options.instructions}${network}\n\nUSER REQUEST\n${options.prompt}`);
  return argv;
}

export interface AdapterCapabilities {
  adapterVersion: string;
  supported: string[];
  missing: string[];
}

function execFileText(file: string, args: readonly string[], env?: NodeJS.ProcessEnv, timeout = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024, env }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export const PERMISSION_PROFILES_UNSUPPORTED =
  'This Codex runtime cannot enforce the Project sandbox, so Powermove will not run it with Project access. Use the built-in runtime or update Codex, then retry.';

/** A Codex that does not know permission profiles ignores them and runs its
 * default sandbox instead, so the profile a Project run uses must first be
 * seen denying a read. */
async function probePermissionProfiles(binary: string, env: NodeJS.ProcessEnv): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'powermove-codex-profile-')));
  try {
    const secret = path.join(directory, 'secret');
    const workspace = path.join(directory, 'workspace');
    const [token, marker] = [randomUUID(), randomUUID()];
    await writeFile(secret, token, { mode: 0o600 });
    await mkdir(workspace);
    const config = projectSandboxArgv({ shellNetwork: false, deniedReads: [secret], workspaceRoots: [workspace] });
    const output = await execFileText(binary, ['sandbox', ...config, '--permission-profile', PROJECT_PERMISSION_PROFILE,
      '--cd', workspace, '--', '/bin/sh', '-c', 'cat "$1" 2>/dev/null; echo "$2"', 'sh', secret, marker], env, 15_000)
      .catch(() => '');
    if (output.includes(token) || !output.includes(marker)) {
      throw new Error(PERMISSION_PROFILES_UNSUPPORTED);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const verifiedProfiles = new Map<string, Promise<void>>();
/** Checked once per binary version; a failed check is retried next run. */
export async function verifyPermissionProfiles(binary: string, env: NodeJS.ProcessEnv): Promise<void> {
  const { mtimeMs, size } = await stat(binary);
  const key = `${binary}\0${mtimeMs}\0${size}`;
  let check = verifiedProfiles.get(key);
  if (!check) {
    check = probePermissionProfiles(binary, env);
    verifiedProfiles.set(key, check);
    check.catch(() => verifiedProfiles.delete(key));
  }
  return check;
}

export async function capabilities(binary?: string | null): Promise<AdapterCapabilities> {
  const executable = binary ?? await discoverCodexBinary(null);
  const help = await execFileText(executable, ['exec', '--help']);
  const supported = REQUIRED_CODEX_FLAGS.filter((flag) => help.includes(flag));
  const missing = REQUIRED_CODEX_FLAGS.filter((flag) => !help.includes(flag));
  return { adapterVersion: ADAPTER_VERSION, supported: [...supported], missing: [...missing] };
}

import type { SandboxSettings } from '@anthropic-ai/claude-agent-sdk';

import type { CodexAccess, ReasoningEffort } from '../../shared/ipc';
import { AGENT_TESTING_INSTRUCTIONS } from '../../shared/agent-testing';
import { modelEffort } from '../../shared/agent-models';
import {
  POWERMOVE_LIVE_INSPECTION_MCP_TOOL_NAMES,
  POWERMOVE_MCP_TOOL_NAMES,
  type NativeMcpServerConfig
} from '../agent-tools/spec';

import type { UserMcpServers } from '../agent-tools/user-mcp';
import { AGENT_SHELL_NETWORK_HOSTS } from '../agent-network';

const PROJECT_TOOLS = 'Read,Glob,Grep,Write,Edit,Bash,WebSearch,WebFetch,Skill,Agent,Task';
const EDITOR_TOOLS = 'Read,Glob,Grep,Skill,Agent,Task';

const STRICT_SANDBOX_SETTINGS = {
  enabled: true,
  autoAllowBashIfSandboxed: true,
  allowUnsandboxedCommands: false,
  failIfUnavailable: true
} satisfies SandboxSettings;

// dontAsk still auto-approves sandboxed Bash under autoAllowBashIfSandboxed,
// so Edit runs turn that off and deny every shell and file-writing tool.
const EDITOR_SANDBOX_SETTINGS = { ...STRICT_SANDBOX_SETTINGS, autoAllowBashIfSandboxed: false } satisfies SandboxSettings;
const EDITOR_SANDBOX = JSON.stringify({ sandbox: EDITOR_SANDBOX_SETTINGS });
const EDITOR_DISALLOWED_TOOLS = 'Bash,Monitor,PowerShell,Write,Edit,NotebookEdit';

/** Claude project Bash shares the one agent shell allowlist. WebSearch and
 * WebFetch stay available for research on any site. */
export const CLAUDE_PROJECT_NETWORK_HOSTS = AGENT_SHELL_NETWORK_HOSTS;

// strictAllowlist denies every other host outright instead of prompting, and
// stops a command's allowed_domains parameter from widening the list.
const PROJECT_SANDBOX_SETTINGS = {
  ...STRICT_SANDBOX_SETTINGS,
  network: { allowedDomains: [...CLAUDE_PROJECT_NETWORK_HOSTS], strictAllowlist: true }
} satisfies SandboxSettings;
const PROJECT_SANDBOX = JSON.stringify({ sandbox: PROJECT_SANDBOX_SETTINGS });

/** The sandbox keeps Bash from reading credential paths; Read deny rules keep
 * Read, Grep and Glob out of them too. `//` marks an absolute path. */
function sandboxSettings(access: 'editor' | 'project', deniedReads: readonly string[]): string {
  if (!deniedReads.length) return access === 'editor' ? EDITOR_SANDBOX : PROJECT_SANDBOX;
  const sandbox = access === 'editor' ? EDITOR_SANDBOX_SETTINGS : PROJECT_SANDBOX_SETTINGS;
  return JSON.stringify({
    permissions: { deny: deniedReads.flatMap(file => [`Read(/${file})`, `Read(/${file}/**)`]) },
    sandbox: { ...sandbox, filesystem: { denyRead: [...deniedReads] } } satisfies SandboxSettings
  });
}

const PROJECT_NETWORK_INSTRUCTIONS = `SHELL NETWORK
Sandboxed Bash can download only from ${CLAUDE_PROJECT_NETWORK_HOSTS.join(', ')}; other hosts are refused. Research any site with WebSearch and WebFetch, then download the file itself from one of those hosts into the deliverable directory.`;

interface ClaudeArgvOptions {
  schema: Record<string, unknown>;
  prompt: string;
  imagePaths: readonly string[];
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  sessionId: string | null;
  access: CodexAccess;
  extensionsDir?: string;
  instructions?: string;
  nativeTools?: NativeMcpServerConfig;
  externalMcpServers?: UserMcpServers;
  /** Absolute paths no tool may read outside Computer access. */
  deniedReads?: readonly string[];
}

function promptWithImages(prompt: string, imagePaths: readonly string[]): string {
  if (imagePaths.length === 0) return prompt;
  return `${prompt}\n\nREFERENCE IMAGES\nInspect these files with the Read tool:\n${imagePaths.map((file) => `- ${file}`).join('\n')}`;
}

/** CLI arguments intentionally use only documented Claude Code flags. The
 * bundled executable remains Anthropic's unmodified native distribution. */
export function buildClaudeArgv(options: ClaudeArgvOptions): string[] {
  const external = Object.fromEntries(Object.entries(options.externalMcpServers ?? {}).filter(([name]) => name !== 'powermove'));
  const mcpConfig = JSON.stringify({ mcpServers: {
    ...external,
    ...(options.nativeTools ? { powermove: { type: 'stdio', ...options.nativeTools } } : {})
  } });
  const externalTools = Object.keys(external).map(name => `mcp__${name}__*`);
  const withExternal = (tools: string): string => [tools, ...externalTools].join(',');
  const projectTools = options.nativeTools
    ? `${PROJECT_TOOLS},${POWERMOVE_MCP_TOOL_NAMES.join(',')}`
    : PROJECT_TOOLS;
  const editorTools = options.nativeTools
    ? `${EDITOR_TOOLS},${POWERMOVE_LIVE_INSPECTION_MCP_TOOL_NAMES.join(',')}`
    : EDITOR_TOOLS;
  // The working directory is an Agent Workspace other agents can write, so its
  // .claude settings, hooks, agents, skills and .mcp.json never load; user
  // settings are the runtime home Powermove writes.
  const argv = [
    '--print',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--setting-sources', 'user',
    '--mcp-config', mcpConfig,
    '--json-schema', JSON.stringify(options.schema)
  ];

  if (options.model) argv.push('--model', options.model);
  const effort = modelEffort('claude', options.model, options.reasoningEffort);
  if (effort) argv.push('--effort', effort);
  if (options.access === 'editor') argv.push('--no-session-persistence');
  if (options.sessionId) argv.push('--resume', options.sessionId);

  if (options.access === 'computer') {
    argv.push('--dangerously-skip-permissions', '--tools', 'default');
  } else {
    argv.push(
      '--permission-mode', options.access === 'editor' ? 'dontAsk' : 'acceptEdits',
      '--settings', sandboxSettings(options.access === 'editor' ? 'editor' : 'project', options.deniedReads ?? []),
      '--tools', 'default',
      '--allowedTools', withExternal(options.access === 'editor' ? editorTools : projectTools)
    );
    if (options.access === 'editor') argv.push('--disallowedTools', EDITOR_DISALLOWED_TOOLS);
  }

  if (options.extensionsDir) argv.push('--add-dir', options.extensionsDir);
  const network = options.access === 'project' ? `\n\n${PROJECT_NETWORK_INSTRUCTIONS}` : '';
  const systemPrompt = options.instructions
    ? `${options.instructions}${network}\n\nReturn the final answer only through the requested JSON schema.`
    : `${AGENT_TESTING_INSTRUCTIONS}\n\nUse the supplied reference files as read-only context. Return only a value matching the requested JSON schema.`;
  argv.push('--system-prompt', systemPrompt);
  argv.push(promptWithImages(options.prompt, options.imagePaths));
  return argv;
}

export const CLAUDE_PROJECT_SANDBOX_SETTINGS = PROJECT_SANDBOX;
export const CLAUDE_EDITOR_SANDBOX_SETTINGS = EDITOR_SANDBOX;

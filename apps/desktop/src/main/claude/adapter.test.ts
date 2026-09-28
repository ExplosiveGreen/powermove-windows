import { describe, expect, it } from 'vitest';

import {
  buildClaudeArgv,
  CLAUDE_EDITOR_SANDBOX_SETTINGS,
  CLAUDE_PROJECT_NETWORK_HOSTS,
  CLAUDE_PROJECT_SANDBOX_SETTINGS
} from './adapter';

const schema = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

describe('Claude CLI adapter', () => {
  it.each(['editor', 'project', 'computer'] as const)('exposes every configured external server in %s mode', access => {
    const externalMcpServers = {
      studio: { type: 'stdio', command: 'fixture-server', args: ['--test'] },
      remote: { type: 'http', url: 'https://example.test/mcp' },
      powermove: { command: 'wrong-server' }
    };
    const argv = buildClaudeArgv({
      schema, prompt: 'Use a tool', imagePaths: [], model: null, reasoningEffort: null,
      sessionId: null, access, externalMcpServers
    });
    expect(JSON.parse(argv[argv.indexOf('--mcp-config') + 1]!)).toEqual({
      mcpServers: { studio: externalMcpServers.studio, remote: externalMcpServers.remote }
    });
    if (access !== 'computer') {
      for (const flag of ['--allowedTools']) {
        expect(argv[argv.indexOf(flag) + 1]).toContain('mcp__studio__*');
        expect(argv[argv.indexOf(flag) + 1]).toContain('mcp__remote__*');
      }
    }
  });

  it('uses structured streaming and user resources with the selected project sandbox', () => {
    const argv = buildClaudeArgv({
      schema,
      prompt: 'Make the title bounce',
      imagePaths: ['/tmp/reference.png'],
      model: 'sonnet',
      reasoningEffort: 'high',
      sessionId: '11111111-1111-4111-8111-111111111111',
      access: 'project',
      extensionsDir: '/tmp/extensions',
      instructions: 'Work inside Powermove.'
    });

    expect(argv).toEqual(expect.arrayContaining([
      '--print', '--output-format', 'stream-json', '--include-partial-messages',
      '--tools', 'default', '--mcp-config', '{"mcpServers":{}}',
      '--json-schema', JSON.stringify(schema), '--model', 'sonnet', '--effort', 'high',
      '--resume', '11111111-1111-4111-8111-111111111111',
      '--permission-mode', 'acceptEdits', '--settings', CLAUDE_PROJECT_SANDBOX_SETTINGS,
      '--add-dir', '/tmp/extensions'
    ]));
    expect(argv).not.toContain('--dangerously-skip-permissions');
    expect(argv).not.toContain('--safe-mode');
    expect(argv).not.toContain('--strict-mcp-config');
    expect(argv).not.toContain('--disable-slash-commands');
    expect(argv[argv.indexOf('--allowedTools') + 1]).toContain('Skill');
    expect(argv.at(-1)).toContain('/tmp/reference.png');
    expect(JSON.parse(CLAUDE_PROJECT_SANDBOX_SETTINGS)).toMatchObject({
      sandbox: { enabled: true, allowUnsandboxedCommands: false, failIfUnavailable: true }
    });
  });

  it.each(['editor', 'project', 'computer'] as const)('loads only user settings in %s mode, never the shared workspace', access => {
    const argv = buildClaudeArgv({
      schema, prompt: 'Build', imagePaths: [], model: null, reasoningEffort: null, sessionId: null, access, instructions: 'Build.'
    });
    // A workspace .claude/settings.json hook, .mcp.json server, agent or skill
    // would otherwise run outside the sandbox on the next Claude run.
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('user');
    expect(argv.indexOf('--setting-sources')).toBeLessThan(argv.indexOf('--system-prompt'));
  });

  it('lets project Bash reach only read-only media and package CDNs', () => {
    const argv = buildClaudeArgv({
      schema, prompt: 'Find useful footage', imagePaths: [], model: null, reasoningEffort: null,
      sessionId: null, access: 'project', instructions: 'Work inside Powermove.'
    });
    const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]!);
    expect(settings).toEqual({
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        failIfUnavailable: true,
        network: { allowedDomains: [...CLAUDE_PROJECT_NETWORK_HOSTS], strictAllowlist: true }
      }
    });
    expect(CLAUDE_PROJECT_NETWORK_HOSTS).toEqual(expect.arrayContaining([
      'videos.pexels.com', 'images.pexels.com', 'cdn.pixabay.com', 'upload.wikimedia.org'
    ]));
    // Hosts that accept authenticated uploads would be exfiltration channels.
    for (const host of ['*', 'github.com', 'api.github.com', 'uploads.github.com', 'registry.npmjs.org', 'pypi.org', 'archive.org']) {
      expect(CLAUDE_PROJECT_NETWORK_HOSTS).not.toContain(host);
    }
    for (const host of CLAUDE_PROJECT_NETWORK_HOSTS) expect(host).toMatch(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);
    const allowed = argv[argv.indexOf('--allowedTools') + 1]!.split(',');
    expect(allowed).toEqual(expect.arrayContaining(['Bash', 'WebSearch', 'WebFetch']));
    expect(argv[argv.indexOf('--system-prompt') + 1]).toContain('Sandboxed Bash can download only from');
    expect(argv[argv.indexOf('--system-prompt') + 1]).toContain('videos.pexels.com');
  });

  it('keeps editor runs without shell network', () => {
    const argv = buildClaudeArgv({
      schema, prompt: 'Inspect', imagePaths: [], model: null, reasoningEffort: null,
      sessionId: null, access: 'editor', instructions: 'Inspect only.'
    });
    expect(argv[argv.indexOf('--settings') + 1]).toBe(CLAUDE_EDITOR_SANDBOX_SETTINGS);
    expect(JSON.parse(CLAUDE_EDITOR_SANDBOX_SETTINGS).sandbox.network).toBeUndefined();
    expect(argv[argv.indexOf('--system-prompt') + 1]).not.toContain('Sandboxed Bash');
    expect(argv[argv.indexOf('--allowedTools') + 1]!.split(',')).not.toContain('Bash');
  });

  it('never runs Bash or writes files in editor runs, and keeps Powermove tools', () => {
    const nativeTools = { command: '/Applications/Powermove.app/Contents/MacOS/Powermove', args: ['mcp-server.mjs'], env: {} };
    const argv = buildClaudeArgv({
      schema, prompt: 'Inspect', imagePaths: [], model: null, reasoningEffort: null,
      sessionId: null, access: 'editor', instructions: 'Inspect only.', nativeTools
    });
    // dontAsk would otherwise still auto-approve sandboxed Bash.
    expect(JSON.parse(argv[argv.indexOf('--settings') + 1]!).sandbox).toMatchObject({ enabled: true, autoAllowBashIfSandboxed: false });
    const disallowed = argv[argv.indexOf('--disallowedTools') + 1]!.split(',');
    expect(disallowed).toEqual(expect.arrayContaining(['Bash', 'Monitor', 'PowerShell', 'Write', 'Edit', 'NotebookEdit']));
    const allowed = argv[argv.indexOf('--allowedTools') + 1]!.split(',');
    expect(allowed).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep', 'mcp__powermove__get_project_state']));
    expect(allowed.filter(tool => disallowed.includes(tool))).toEqual([]);
    expect(JSON.parse(argv[argv.indexOf('--mcp-config') + 1]!).mcpServers.powermove).toMatchObject({ type: 'stdio', command: nativeTools.command });
    // Project runs keep sandboxed Bash.
    const project = buildClaudeArgv({ schema, prompt: 'Build', imagePaths: [], model: null, reasoningEffort: null, sessionId: null, access: 'project', instructions: 'Build.' });
    expect(project).not.toContain('--disallowedTools');
    expect(JSON.parse(project[project.indexOf('--settings') + 1]!).sandbox.autoAllowBashIfSandboxed).toBe(true);
  });

  it('only enables unrestricted CLI permissions after computer consent is handled by main', () => {
    const argv = buildClaudeArgv({
      schema,
      prompt: 'Use the Mac',
      imagePaths: [],
      model: null,
      reasoningEffort: null,
      sessionId: null,
      access: 'computer'
    });
    expect(argv).toContain('--dangerously-skip-permissions');
    expect(argv).not.toContain('--settings');
  });

  it('gives the native Claude harness only the run-scoped Powermove MCP tools', () => {
    const nativeTools = {
      command: '/Applications/Powermove.app/Contents/MacOS/Powermove',
      args: ['/Applications/Powermove.app/Contents/Resources/agent-tools/mcp-server.mjs'],
      env: { ELECTRON_RUN_AS_NODE: '1', POWERMOVE_AGENT_TOOL_TOKEN: 'secret' }
    };
    const argv = buildClaudeArgv({
      schema,
      prompt: 'Edit the live composition',
      imagePaths: [],
      model: 'sonnet',
      reasoningEffort: 'high',
      sessionId: null,
      access: 'project',
      extensionsDir: '/tmp/extensions',
      instructions: 'Use Powermove tools.',
      nativeTools
    });
    const config = JSON.parse(argv[argv.indexOf('--mcp-config') + 1]!);
    expect(config).toEqual({ mcpServers: { powermove: { type: 'stdio', ...nativeTools } } });
    const allowed = argv[argv.indexOf('--allowedTools') + 1]!;
    expect(allowed).toContain('mcp__powermove__get_project_state');
    expect(allowed).toContain('mcp__powermove__apply_commands');
  });

  it('limits editor runs to live Powermove inspection and capture tools', () => {
    const nativeTools = {
      command: '/Applications/Powermove.app/Contents/MacOS/Powermove',
      args: ['/Applications/Powermove.app/Contents/Resources/agent-tools/mcp-server.mjs'],
      env: { ELECTRON_RUN_AS_NODE: '1', POWERMOVE_AGENT_TOOL_TOKEN: 'secret' }
    };
    const argv = buildClaudeArgv({
      schema,
      prompt: 'Inspect the built-in inspector',
      imagePaths: [],
      model: 'sonnet',
      reasoningEffort: 'high',
      sessionId: null,
      access: 'editor',
      nativeTools
    });
    const allowed = argv[argv.indexOf('--allowedTools') + 1]!;
    expect(allowed).toContain('mcp__powermove__capture_panel');
    expect(allowed).toContain('mcp__powermove__render_frames');
    expect(allowed).not.toContain('mcp__powermove__apply_commands');
    expect(allowed).not.toContain('mcp__powermove__computer_use_panel');
  });
});

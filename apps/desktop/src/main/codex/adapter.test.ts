import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_TESTING_INSTRUCTIONS } from '../../shared/agent-testing';
import { AGENT_SHELL_NETWORK_HOSTS } from '../agent-network';
import {
  ADAPTER_VERSION,
  REQUIRED_CODEX_FLAGS,
  buildAutonomousArgv,
  PERMISSION_PROFILES_UNSUPPORTED,
  PROJECT_PERMISSION_PROFILE,
  buildEditorArgv,
  capabilities,
  verifyPermissionProfiles
} from './adapter';

describe('Codex CLI adapter', () => {
  it('makes configured external tools available in the editor CLI path', () => {
    const argv = buildEditorArgv({
      schemaPath: '/tmp/schema.json', outputPath: '/tmp/result.json', prompt: 'Make audio',
      imagePaths: [], model: null, reasoningEffort: null,
      externalMcpServers: { studio: { command: 'fixture-server' } }
    });
    expect(argv).toContain('mcp_servers."studio"={"command"="fixture-server"}');
  });

  it('builds the exact editor argv with the prompt before every image', () => {
    expect(
      buildEditorArgv({
        schemaPath: '/tmp/editor/schema.json',
        outputPath: '/tmp/editor/result.json',
        prompt: 'Polish this composition',
        imagePaths: ['/tmp/editor/frame-0.png', '/tmp/editor/frame-1.jpg'],
        model: 'gpt-5-codex',
        reasoningEffort: 'high',
      })
    ).toEqual([
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--output-schema',
      '/tmp/editor/schema.json',
      '--output-last-message',
      '/tmp/editor/result.json',
      '--json',
      '--model',
      'gpt-5-codex',
      '--config',
      'model_reasoning_effort="high"',
      `${AGENT_TESTING_INSTRUCTIONS}\n\nPolish this composition`,
      '--image',
      '/tmp/editor/frame-0.png',
      '--image',
      '/tmp/editor/frame-1.jpg'
    ]);
  });

  it('builds the exact fresh project-authority autonomous argv', () => {
    expect(
      buildAutonomousArgv({
        schemaPath: '/workspace/.powermove/result-schema.json',
        outputPath: '/workspace/.powermove/result-run-1.json',
        prompt: 'Make a launch trailer',
        imagePaths: ['/workspace/inputs/references/reference-0.png'],
        model: null,
        reasoningEffort: null,
        access: 'project',
        shellNetwork: true,
        deniedReads: ['/Users/me/.ssh', '/user-data/codex-runtime/auth.json'],
        workspaceRoots: ['/workspace', '/workspace'],
        extensionsDir: '/user-data/extensions',
        sessionId: null,
        instructions: 'AGENT INSTRUCTIONS',
      })
    ).toEqual([
      '--search',
      '--add-dir',
      '/user-data/extensions',
      'exec',
      '--skip-git-repo-check',
      '--config', 'approval_policy="never"',
      '--config', 'default_permissions="powermove"',
      '--config', 'permissions.powermove.extends=":workspace"',
      '--config', 'projects={"/workspace"={trust_level="untrusted"}}',
      '--config', 'permissions.powermove.filesystem={"/Users/me/.ssh"="deny","/user-data/codex-runtime/auth.json"="deny"}',
      '--config', 'features.network_proxy=true',
      '--config', 'permissions.powermove.network.enabled=true',
      '--config', `permissions.powermove.network.domains={${AGENT_SHELL_NETWORK_HOSTS.map(host => `"${host}"="allow"`).join(',')}}`,
      '--output-schema',
      '/workspace/.powermove/result-schema.json',
      '--output-last-message',
      '/workspace/.powermove/result-run-1.json',
      '--json',
      '--image',
      '/workspace/inputs/references/reference-0.png',
      '--',
      `AGENT INSTRUCTIONS\n\nSHELL NETWORK\nShell commands can download only over HTTPS from ${AGENT_SHELL_NETWORK_HOSTS.join(', ')}; other hosts are refused.\n\nUSER REQUEST\nMake a launch trailer`
    ]);
  });

  it('gives shell commands allowlisted network only for the Project access choice', () => {
    const common = {
      schemaPath: '/workspace/schema.json', outputPath: '/workspace/result.json', prompt: 'Find useful footage',
      imagePaths: [], model: null, reasoningEffort: null, extensionsDir: '/user-data/extensions',
      instructions: 'AGENT INSTRUCTIONS', deniedReads: ['/Users/me/.ssh']
    };
    const configs = (argv: string[]) => argv.flatMap((arg, index) => argv[index - 1] === '--config' ? [arg] : []);
    for (const sessionId of [null, 'thread-123']) {
      const argv = buildAutonomousArgv({ ...common, access: 'project', shellNetwork: true, sessionId });
      // exec options, so they apply to `exec resume` too, and never a legacy sandbox mode.
      const proxy = argv.indexOf('features.network_proxy=true');
      expect(proxy).toBeGreaterThan(argv.indexOf(sessionId ? 'resume' : 'exec'));
      expect(argv[proxy - 1]).toBe('--config');
      expect(configs(argv)).toEqual(expect.arrayContaining([
        `default_permissions="${PROJECT_PERMISSION_PROFILE}"`, 'permissions.powermove.network.enabled=true',
        'permissions.powermove.filesystem={"/Users/me/.ssh"="deny"}'
      ]));
      const domains = configs(argv).find(value => value.startsWith('permissions.powermove.network.domains='))!;
      expect(domains).toContain('"images.pexels.com"="allow"');
      expect(domains).not.toMatch(/"\*"|"github\.com"|registry\.npmjs\.org/);
      expect(argv).toContain('--search');
      expect(argv).not.toContain('--sandbox');
      expect(argv).not.toContain('--approve-for-me');
      expect(argv).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(argv.join(' ')).not.toMatch(/writable_roots|danger-full-access|sandbox_mode|network_access/);
    }
    // Edit project collapses to project authority but keeps the shell offline and credentials unreadable.
    const offline = buildAutonomousArgv({ ...common, access: 'project', sessionId: null });
    expect(configs(offline)).toEqual(expect.arrayContaining([`default_permissions="${PROJECT_PERMISSION_PROFILE}"`,
      'permissions.powermove.filesystem={"/Users/me/.ssh"="deny"}']));
    expect(offline.join(' ')).not.toMatch(/network_proxy|network\.enabled|SHELL NETWORK/);
    const computer = buildAutonomousArgv({ ...common, access: 'computer', shellNetwork: true, sessionId: null });
    expect(computer.join(' ')).not.toMatch(/network_proxy|default_permissions/);
    expect(buildEditorArgv(common).join(' ')).not.toMatch(/network_proxy|default_permissions/);
    expect(buildEditorArgv(common)).toEqual(expect.arrayContaining(['--sandbox', 'read-only']));
  });

  it('marks the shared workspace untrusted so its .codex config never loads', () => {
    const common = {
      schemaPath: '/workspace/schema.json', outputPath: '/workspace/result.json', prompt: 'Build',
      imagePaths: [], model: null, reasoningEffort: null, extensionsDir: '/user-data/extensions',
      instructions: 'AGENT INSTRUCTIONS', workspaceRoots: ['/var/ws', '/private/var/ws']
    };
    for (const sessionId of [null, 'thread-123']) {
      const argv = buildAutonomousArgv({ ...common, access: 'project', sessionId });
      const trust = argv.indexOf('projects={"/var/ws"={trust_level="untrusted"},"/private/var/ws"={trust_level="untrusted"}}');
      expect(argv[trust - 1]).toBe('--config');
      // An exec option, so `exec resume` applies it too.
      expect(trust).toBeGreaterThan(argv.indexOf(sessionId ? 'resume' : 'exec'));
    }
  });

  it('builds the exact resumed computer-authority autonomous argv', () => {
    expect(
      buildAutonomousArgv({
        schemaPath: '/workspace/.powermove/result-schema.json',
        outputPath: '/workspace/.powermove/result-run-2.json',
        prompt: 'Publish the approved deliverable',
        imagePaths: [],
        model: 'gpt-5-codex',
        reasoningEffort: 'medium',
        access: 'computer',
        extensionsDir: '/user-data/extensions',
        sessionId: ' thread-123\n',
        instructions: 'AGENT INSTRUCTIONS',
      })
    ).toEqual([
      '--search',
      '--dangerously-bypass-approvals-and-sandbox',
      '--add-dir',
      '/user-data/extensions',
      'exec',
      'resume',
      '--skip-git-repo-check',
      '--output-schema',
      '/workspace/.powermove/result-schema.json',
      '--output-last-message',
      '/workspace/.powermove/result-run-2.json',
      '--json',
      '--model',
      'gpt-5-codex',
      '--config',
      'model_reasoning_effort="medium"',
      '--',
      'thread-123',
      'AGENT INSTRUCTIONS\n\nUSER REQUEST\nPublish the approved deliverable'
    ]);
  });

  it('never lets a sandboxed run ask for an unsandboxed command, and keeps Powermove tools approved', () => {
    const common = {
      schemaPath: '/workspace/schema.json', outputPath: '/workspace/result.json', prompt: 'Build',
      imagePaths: [], model: null, reasoningEffort: null, extensionsDir: '/user-data/extensions', instructions: 'AGENT INSTRUCTIONS',
      nativeTools: { command: '/Applications/Powermove.app/Contents/MacOS/Powermove', args: ['mcp-server.mjs'], env: {} }
    };
    for (const sessionId of [null, 'thread-123']) {
      const argv = buildAutonomousArgv({ ...common, access: 'project', shellNetwork: true, sessionId });
      expect(argv).toContain('approval_policy="never"');
      expect(argv.join(' ')).not.toMatch(/on-request|approvals_reviewer|auto_review/);
      expect(argv).toContain('mcp_servers.powermove.default_tools_approval_mode="approve"');
    }
  });

  it('passes the session id after -- and refuses one that is not an id', () => {
    const common = {
      schemaPath: '/workspace/schema.json', outputPath: '/workspace/result.json', prompt: '--help',
      imagePaths: ['/workspace/a.png'], model: null, reasoningEffort: null, extensionsDir: '/user-data/extensions',
      instructions: 'AGENT INSTRUCTIONS', access: 'project' as const
    };
    const argv = buildAutonomousArgv({ ...common, sessionId: '019999aa-0000-7000-8000-000000000000' });
    const separator = argv.indexOf('--');
    expect(argv.slice(separator + 1, separator + 2)).toEqual(['019999aa-0000-7000-8000-000000000000']);
    expect(argv.indexOf('--image')).toBeLessThan(separator);
    expect(argv).toHaveLength(separator + 3);
    for (const sessionId of ['--dangerously-bypass-approvals-and-sandbox', '-c', 'a b', '../thread']) {
      expect(() => buildAutonomousArgv({ ...common, sessionId }), sessionId).toThrow('Invalid Codex session id.');
    }
  });

  it('runs Project access only on a Codex that is seen enforcing its permission profile', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'powermove-profile-'));
    const script = async (name: string, body: string) => {
      const file = path.join(directory, name);
      await writeFile(file, `#!/bin/sh\n${body}\n`, 'utf8');
      await chmod(file, 0o755);
      return file;
    };
    // Runs the probe command unsandboxed, as a Codex that ignores the profile would.
    const leaky = await script('leaky', 'while [ "$1" != "--" ]; do shift; done; shift; exec "$@"');
    const unsupported = await script('unsupported', 'echo "error: unrecognized subcommand" >&2; exit 2');
    const enforcing = await script('enforcing', 'for argument in "$@"; do last="$argument"; done; echo "$last"');
    await expect(verifyPermissionProfiles(leaky, process.env)).rejects.toThrow(PERMISSION_PROFILES_UNSUPPORTED);
    await expect(verifyPermissionProfiles(unsupported, process.env)).rejects.toThrow(PERMISSION_PROFILES_UNSUPPORTED);
    await expect(verifyPermissionProfiles(enforcing, process.env)).resolves.toBeUndefined();
  });

  it('allows user resources instead of suppressing integrations, rules and skills', () => {
    const argv = buildAutonomousArgv({
      schemaPath: '/workspace/.powermove/result-schema.json',
      outputPath: '/workspace/.powermove/result-run-3.json',
      prompt: 'Retry without integrations',
      imagePaths: [],
      model: null,
      reasoningEffort: null,
      access: 'project',
      extensionsDir: '/user-data/extensions',
      sessionId: null,
      instructions: 'AGENT INSTRUCTIONS',
    });
    expect(argv).not.toContain('--ignore-user-config');
    expect(argv).not.toContain('--ignore-rules');
    expect(argv).not.toContain('--disable');
    expect(argv).not.toContain('mcp_servers={}');
    expect(argv.join(' ')).not.toContain('skills.');
  });

  it('adds user tools and the run-scoped Powermove MCP server without clearing inherited resources', () => {
    const argv = buildAutonomousArgv({
      schemaPath: '/workspace/schema.json',
      outputPath: '/workspace/result.json',
      prompt: 'Inspect and edit the live composition',
      imagePaths: [],
      model: null,
      reasoningEffort: null,
      access: 'project',
      extensionsDir: '/workspace/extensions',
      sessionId: null,
      instructions: 'AGENT INSTRUCTIONS',
      externalMcpServers: { external: { command: 'fixture-server' }, powermove: { command: 'wrong-server' } },
      nativeTools: {
        command: '/Applications/Powermove.app/Contents/MacOS/Powermove',
        args: ['/Applications/Powermove.app/Contents/Resources/agent-tools/mcp-server.mjs'],
        env: { POWERMOVE_AGENT_TOOL_TOKEN: 'secret', ELECTRON_RUN_AS_NODE: '1' }
      }
    });
    const command = argv.indexOf('mcp_servers.powermove.command="/Applications/Powermove.app/Contents/MacOS/Powermove"');
    expect(command).toBeGreaterThan(-1);
    expect(argv.indexOf('mcp_servers."external"={"command"="fixture-server"}')).toBeGreaterThan(-1);
    expect(argv.join(' ')).not.toContain('wrong-server');
    expect(argv).toContain('mcp_servers.powermove.args=["/Applications/Powermove.app/Contents/Resources/agent-tools/mcp-server.mjs"]');
    expect(argv).toContain('mcp_servers.powermove.env.ELECTRON_RUN_AS_NODE="1"');
    expect(argv).toContain('mcp_servers.powermove.env.POWERMOVE_AGENT_TOOL_TOKEN="secret"');
    expect(argv).toContain('mcp_servers.powermove.required=true');
  });

  it('reports supported and missing flags from codex exec --help', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'powermove-adapter-'));
    const binary = path.join(directory, 'codex');
    const shown = REQUIRED_CODEX_FLAGS.filter((_, index) => index % 2 === 0);
    await writeFile(
      binary,
      `#!/bin/sh\n[ "$1 $2" = "exec --help" ] || exit 9\nprintf '%s\\n' '${shown.join(' ')}'\n`,
      'utf8'
    );
    await chmod(binary, 0o755);

    const result = await capabilities(binary);
    expect(result).toEqual({
      adapterVersion: ADAPTER_VERSION,
      supported: [...shown],
      missing: REQUIRED_CODEX_FLAGS.filter((flag) => !shown.includes(flag))
    });
  });
});

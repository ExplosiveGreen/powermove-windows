// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SandboxCheckStatus from './SandboxCheckStatus.svelte';
import { sandboxCheckLines, type SandboxCheckReport } from './sandbox-check';

const report = (patch: Partial<SandboxCheckReport>): SandboxCheckReport => ({
  ok: false, activation: 'ok', permissionErrors: [], cspViolations: [], asyncMisuse: [],
  panels: [], runtimeErrors: [], durationMs: 1, ...patch
});

it('renders each blocked reason as a separate row', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const blocked = report({
    permissionErrors: [{ namespace: 'render', member: 'gl.bounds', count: 1 }],
    panels: [{ id: 'ease-lab', mounted: false, error: 'panel boom' }]
  });
  const component = mount(SandboxCheckStatus, { target, props: { state: { status: 'done', report: blocked } } });
  flushSync();
  const rows = [...target.querySelectorAll('[data-sandbox="problem"]')].map(row => row.textContent?.trim());
  expect(rows).toEqual(sandboxCheckLines(blocked));
  expect(rows[0]).toContain('api.render.gl.bounds');
  expect(rows[1]).toContain("Panel 'ease-lab' failed to mount: panel boom");
  await unmount(component);
  target.remove();
});

it('names project:read for an undeclared project read', () => {
  const lines = sandboxCheckLines(report({
    permissionErrors: [{ namespace: 'project', member: 'get', count: 1, needs: 'project:read' }],
    runtimeErrors: ['project.get requires project:read permission. Declare "project:read" in the manifest\'s permissions.']
  }));
  expect(lines).toEqual(['Reads the project with api.project.get without permission. Declare `permissions: ["project:read"]`.']);
});

it('tells apiVersion 2 code to set apiVersion 3 before declaring a permission', () => {
  const lines = sandboxCheckLines(report({
    apiVersion: 2,
    permissionErrors: [{ namespace: 'project', member: 'get', count: 1, needs: 'project:read' }, { namespace: 'render', member: 'gl', count: 1 }],
    cspViolations: [{ directive: 'connect-src', blockedUri: 'https://example.com/data' }],
    runtimeErrors: ['project.get requires project:read permission. Set "apiVersion": 3 and declare "project:read" in the manifest\'s permissions.']
  }));
  expect(lines).toEqual([
    'Reads the project with api.project.get without permission. Set `apiVersion: 3` and declare `permissions: ["project:read"]`.',
    'Calls api.render.gl, which needs full access. Set `apiVersion: 3` and declare `permissions: ["full-access"]` or use api.project instead.',
    'Reaches example.com without the network permission. Set `apiVersion: 3` and declare `permissions: ["network"]`.'
  ]);
});

it('renders the success line', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(SandboxCheckStatus, { target, props: { state: { status: 'done', report: report({ ok: true }) } } });
  flushSync();
  expect(target.querySelector('[data-sandbox="ok"]')?.textContent).toContain('Compatible with the sandbox');
  expect(target.querySelector('[data-sandbox="problem"]')).toBeNull();
  await unmount(component);
  target.remove();
});

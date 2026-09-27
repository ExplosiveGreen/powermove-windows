// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SandboxCheckSheet from './SandboxCheckSheet.svelte';
import type { SandboxCheckReport } from './sandbox-check';

const failed: SandboxCheckReport = {
  ok: false, activation: { error: 'Registration id must start with hello.' },
  permissionErrors: [], cspViolations: [], asyncMisuse: [], panels: [], runtimeErrors: [], durationMs: 1
};

it.each([true, false])('hands the actual failure to the agent and closes only on acceptance (%s)', async (accepted) => {
  const target = document.createElement('div');
  document.body.append(target);
  const onclose = vi.fn();
  const onfix = vi.fn(async () => accepted);
  const component = mount(SandboxCheckSheet, { target, props: { name: 'Hello', check: async () => failed, onclose, onfix } });
  try {
    flushSync();
    await vi.waitFor(() => expect(target.textContent).toContain('Fix with agent'));
    const button = [...target.querySelectorAll('button')].find(button => button.textContent === 'Fix with agent')!;
    button.click();
    await vi.waitFor(() => expect(onfix).toHaveBeenCalledWith(failed));
    await vi.waitFor(() => accepted ? expect(onclose).toHaveBeenCalledOnce() : expect(target.textContent).toContain('couldn’t start the repair'));
    if (!accepted) expect(onclose).not.toHaveBeenCalled();
  } finally { await unmount(component); target.remove(); }
});

it('does not offer a code repair for a passing check', async () => {
  const target = document.createElement('div');
  document.body.append(target);
  const onfix = vi.fn(async () => true);
  const component = mount(SandboxCheckSheet, { target, props: { name: 'Hello', check: async () => ({ ...failed, ok: true, activation: 'ok' }), onclose() {}, onfix } });
  try {
    flushSync();
    await vi.waitFor(() => expect(target.textContent).toContain('Compatible with the sandbox'));
    expect(target.textContent).not.toContain('Fix with agent');
    expect(onfix).not.toHaveBeenCalled();
  } finally { await unmount(component); target.remove(); }
});

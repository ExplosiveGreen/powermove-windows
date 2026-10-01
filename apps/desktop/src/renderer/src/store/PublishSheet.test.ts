// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PublishPlanDto } from '../../../shared/publish';
import type { StoreBridge } from '../../../shared/store-ipc';
import PublishSheet from './PublishSheet.svelte';

const plan: PublishPlanDto = {
  localId: 'demo', coordinate: 'maker/demo', version: '1.0.0', suggestedVersion: '1.0.0', lastVersion: null,
  firstPublish: true, treeSha: 'a'.repeat(40), fileCount: 2, sizeBytes: 120, isFork: false,
  blockedFindings: [], permissionFindings: [], waivableFindings: [],
  manifest: { id: 'demo', name: 'Demo', description: null },
  listing: { name: 'Demo', tagline: '', category: 'effects', licence: 'MIT' }
};

it.each(['permissions', 'secrets'])('opens with multiple %s findings on the same line and keeps publishing blocked', async (kind) => {
  const findings = kind === 'permissions'
    ? { permissionFindings: [
      { path: 'index.ts', line: 1, needs: 'full-access' as const, text: 'Uses api.render. Declare full-access.' },
      { path: 'index.ts', line: 1, needs: 'full-access' as const, text: 'Uses api.host. Declare full-access.' }
    ] }
    : { blockedFindings: [{ path: 'index.ts', line: 1, kind: 'aws_access_key' as const }, { path: 'index.ts', line: 1, kind: 'aws_access_key' as const }] };
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(PublishSheet, { target, props: {
    plan: { ...plan, ...findings }, bridge: { onPublishProgress: () => () => {} } as unknown as StoreBridge,
    check: async () => ({ ok: true, activation: 'ok', permissionErrors: [], cspViolations: [], asyncMisuse: [], panels: [], runtimeErrors: [], durationMs: 1 }),
    onclose() {}, onpublished() {}
  } });
  try {
    flushSync();
    await vi.waitFor(() => expect(target.textContent).toContain('Compatible with the sandbox'));
    expect(target.querySelectorAll('.pub-problem')).toHaveLength(2);
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  } finally { await unmount(component); target.remove(); }
});

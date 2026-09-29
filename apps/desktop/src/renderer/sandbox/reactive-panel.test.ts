// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRpc } from '../../shared/sandbox-rpc';
import { bootView, installSandboxRuntime } from './boot';
import type { SandboxSnapshot, SandboxViewInit } from './shim-api';

const close: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of close.splice(0)) await fn(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/* happy-dom's WAAPI stub never finishes; Svelte's transitions wait on
   `onfinish`, so this one finishes on the next task. */
function finishingAnimations(): void {
  vi.spyOn(Element.prototype, 'animate').mockImplementation(() => {
    let done: (() => void) | null = null;
    return {
      cancel() {}, effect: null, currentTime: 0, playState: 'finished',
      get onfinish() { return done; },
      set onfinish(fn: (() => void) | null) { done = fn; if (fn) setTimeout(() => { if (done === fn) fn(); }); }
    } as unknown as Animation;
  });
}

it('the fixture panel re-renders from reactive api reads alone and its fade-in runs', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'powermove-reactive-panel-'));
  close.push(() => rm(output, { recursive: true, force: true }));
  const compilerPath = '../../main/extensions/compiler';
  const { compileExtension } = await import(/* @vite-ignore */ compilerPath);
  const compiled = await compileExtension({ dir: path.resolve('test/fixtures/sandboxed-ext'), entry: 'index.ts', outDir: output });
  expect(compiled.ok ? '' : compiled.error).toBe('');
  const source = await readFile(compiled.bundlePath);
  installSandboxRuntime();
  finishingAnimations();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network mocked'))));

  const snapshots: Record<number, { layers: unknown[] }> = { 1: { layers: [{ id: 'a' }, { id: 'b' }] }, 2: { layers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } };
  let generation = 1;
  const readouts: Array<Record<string, unknown>> = [];
  const registered: string[] = [];
  const notes: string[] = [];
  const kernelChannel = new MessageChannel();
  const runtimeChannel = new MessageChannel();
  const kernel = createRpc(kernelChannel.port1, {
    register: (kind: string, _token: string, value: { event?: string }) => { registered.push(value?.event ?? kind); },
    'dispose-registration': () => {},
    invoke: (namespace: string, method: string, args: unknown[]) => {
      if (namespace === 'events' && method === 'emit' && args[0] === 'readout') readouts.push(args[1] as Record<string, unknown>);
    },
    'project-snapshot': (): SandboxSnapshot => ({ generation, json: JSON.stringify(snapshots[generation]) }),
    mounted: () => { notes.push('mounted'); },
    'view-error': (error: { message: string }) => { notes.push(`error:${error.message}`); },
    'runtime-error': (error: { message: string }) => { notes.push(`runtime:${error.message}`); }
  });
  const runtime = createRpc(runtimeChannel.port1, { definition: (id: string) => ({ id, title: 'Sandbox panel', kind: 'component' }) });
  close.push(() => { kernel.close(); runtime.close(); });
  const init: SandboxViewInit = {
    id: 'sandboxed-ext', apiVersion: 3, manifest: { id: 'sandboxed-ext', name: 'Fixture', version: '1.0.0', apiVersion: 3, permissions: ['network', 'project:write'] }, vars: {},
    theme: { scheme: 'dark', tokens: {} }, bundleUrl: 'fixture://bundle',
    state: { time: 0, playing: false, revision: 3, generation: 1, selection: null },
    mode: 'view', panelId: 'sandboxed-ext.panel', spec: {}, keys: [], size: { width: 220, height: 400 }
  };
  const target = document.createElement('div');
  document.body.append(target);
  const view = await bootView(init, kernelChannel.port2, runtimeChannel.port2, {
    load: () => import(/* @vite-ignore */ `data:text/javascript;base64,${source.toString('base64')}`), target
  });
  close.unshift(() => view.dispose());
  const latest = () => readouts.at(-1);
  const text = (key: string) => target.querySelector(`[data-readout="${key}"]`)?.textContent;

  await vi.waitFor(() => expect(notes).toEqual(['mounted']));
  expect(readouts[0]).toEqual({ revision: '3', time: '0.00', faded: false }); // mounted before the first snapshot
  // The first reactive latest() read pulls the snapshot; the row it gates fades in.
  await vi.waitFor(() => expect(latest()).toEqual({ revision: '3', time: '0.00', layers: '2', faded: true }));

  // The playhead moves: only the tick state changes, and the text follows.
  kernel.notify('tick', { time: 1.5 }, []);
  await vi.waitFor(() => expect(text('time')).toBe('1.50'));
  expect(latest()).toMatchObject({ time: '1.50', layers: '2' });

  // The project changes: revision and a new generation arrive, latest() pulls it.
  generation = 2;
  kernel.notify('tick', { revision: 4, generation: 2 }, [['project:changed', { kind: 'edit' }]]);
  await vi.waitFor(() => expect(latest()).toEqual({ revision: '4', time: '1.50', layers: '3', faded: true }));
  expect(text('layers')).toBe('3');
  // No listener was ever needed for any of it.
  expect(registered).not.toContain('project:changed');
  expect(registered).not.toContain('time');
  expect(notes).toEqual(['mounted']);
});

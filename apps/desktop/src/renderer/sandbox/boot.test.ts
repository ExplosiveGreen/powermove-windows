// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { createRpc } from '../../shared/sandbox-rpc';
import { bootView, holdFormSubmissions, installSandboxRuntime, keyToForward } from './boot';
import type { SandboxViewInit } from './shim-api';

afterEach(() => { document.body.replaceChildren(); });

const init = (panelId: string): SandboxViewInit => ({
  id: 'fake-ext', apiVersion: 3, manifest: { id: 'fake-ext', name: 'Fake', version: '1.0.0', apiVersion: 3, permissions: [] }, vars: {},
  theme: { scheme: 'dark', tokens: { '--accent': 'rgb(1 2 3)' } }, bundleUrl: 'fake://bundle',
  state: { time: 0, playing: false, revision: 3, generation: 1, selection: null },
  mode: 'view', panelId, spec: { from: 'workspace' }, keys: [], size: { width: 320, height: 200 }
});

it('replays activate quietly, keeps registrations local, and mounts the recorded build panel', async () => {
  installSandboxRuntime();
  const kernelChannel = new MessageChannel();
  const runtimeChannel = new MessageChannel();
  const calls: string[] = [];
  const notes: string[] = [];
  const kernel = createRpc(kernelChannel.port1, {
    register: (kind: string) => { calls.push(`register:${kind}`); },
    invoke: (namespace: string, method: string) => { calls.push(`${namespace}.${method}`); return 'stored'; },
    mounted: () => { notes.push('mounted'); },
    'view-error': (error: { message: string }) => { notes.push(`error:${error.message}`); }
  });
  const runtime = createRpc(runtimeChannel.port1, { definition: (id: string) => (id === 'fake-panel' ? { id, title: 'Fake', kind: 'build' } : null) });
  const module = {
    default(api: any) {
      api.commands.register({ id: 'fake-command', label: 'Fake', run: () => 1 });
      api.panels.open('fake-panel'); // runtime already did this; the view's replay must not
      api.ui.toast('hello');
      api.panels.register({ id: 'fake-panel', title: 'Fake', build(body: HTMLElement, inst: { spec: Record<string, unknown> }) {
        const out = document.createElement('p');
        out.textContent = `revision ${api.project.revision()} from ${inst.spec.from}`;
        body.append(out);
        api.events.on('project:changed', () => {});
        void api.storage.get('k');
      } });
    }
  };
  const target = document.createElement('div');
  document.body.append(target);
  const view = await bootView(init('fake-panel'), kernelChannel.port2, runtimeChannel.port2, { load: async () => module, target });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(notes).toEqual(['mounted']);
  expect(target.textContent).toBe('revision 3 from workspace');
  // Only the event subscription and the read crossed; commands/panels/toast did not.
  expect(calls.sort()).toEqual(['register:events', 'storage.get']);
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('rgb(1 2 3)');
  expect(document.documentElement.style.width).toBe('320px');
  view.dispose();
  kernel.close(); runtime.close();
});

it('keeps ticks and theme pushes that arrive before the view has its API', async () => {
  installSandboxRuntime();
  const kernelChannel = new MessageChannel();
  const runtimeChannel = new MessageChannel();
  let answer!: (value: unknown) => void;
  const kernel = createRpc(kernelChannel.port1, { mounted: () => {} });
  const runtime = createRpc(runtimeChannel.port1, { definition: (id: string) => new Promise(resolve => { answer = resolve; }).then(() => ({ id, title: 'Fake', kind: 'build' })) });
  const seen: unknown[] = [];
  let viewApi: any;
  const module = { default(api: any) { viewApi = api; api.panels.register({ id: 'fake-panel', title: 'Fake', build() { seen.push(api.project.revision(), api.project.time(), api.theme.active(), api.theme.scheme()); } }); } };
  const target = document.createElement('div');
  const pending = bootView(init('fake-panel'), kernelChannel.port2, runtimeChannel.port2, { load: async () => module, target });
  kernel.notify('tick', { revision: 4 }, []);
  kernel.notify('tick', { time: 2 }, []);
  kernel.notify('theme', { id: 'day', scheme: 'light', tokens: {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  answer(null);
  const view = await pending;
  expect(seen).toEqual([4, 2, 'day', 'light']);
  kernel.notify('theme', { id: 'night', scheme: 'dark', tokens: {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect([viewApi.theme.active(), viewApi.theme.scheme()]).toEqual(['night', 'dark']);
  view.dispose();
  kernel.close(); runtime.close();
});

it('shows a message and reports when the runtime no longer has the panel', async () => {
  installSandboxRuntime();
  const kernelChannel = new MessageChannel();
  const runtimeChannel = new MessageChannel();
  const notes: string[] = [];
  const kernel = createRpc(kernelChannel.port1, { 'view-error': (error: { message: string }) => { notes.push(error.message); } });
  const runtime = createRpc(runtimeChannel.port1, { definition: () => null });
  const target = document.createElement('div');
  const view = await bootView(init('gone'), kernelChannel.port2, runtimeChannel.port2, { load: async () => ({}), target });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(notes).toEqual(['Panel "gone" is no longer registered.']);
  expect(target.querySelector('.pm-view-error')).not.toBeNull();
  view.dispose();
  kernel.close(); runtime.close();
});

it('forwards only keys the host binds, and Escape', () => {
  const keys = [{ chord: 'cmd+z', inFields: false, repeat: false, looseModifiers: true }, { chord: 'space', inFields: false, repeat: false, looseModifiers: false }];
  const decide = (init: KeyboardEventInit, target: HTMLElement = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return keyToForward(event, keys);
  };
  expect(decide({ key: 'z', ctrlKey: true })?.prevent).toBe(true); // loose: ctrl reads as cmd
  expect(decide({ key: 'q' })).toBeNull();
  expect(decide({ key: 'Escape' })).toMatchObject({ prevent: false, forward: { key: 'Escape', field: false } });
  const input = document.createElement('input');
  expect(decide({ key: ' ' }, input)).toBeNull();
  expect(decide({ key: 'Escape' }, input)?.forward.field).toBe(true);
  const button = document.createElement('button');
  expect(keyToForward(Object.defineProperty(new KeyboardEvent('keydown', { key: 'Enter' }), 'target', { value: button }), [{ chord: 'enter', inFields: false, repeat: false, looseModifiers: false }])).toBeNull();
});

it('lets a submit reach the form’s own handler, then cancels its navigation', () => {
  const release = holdFormSubmissions(window);
  try {
    const form = document.createElement('form');
    form.innerHTML = '<input name="q"><button type="submit">Go</button>';
    document.body.append(form);
    const seen: boolean[] = [];
    form.addEventListener('submit', event => { seen.push(event.defaultPrevented); });
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    // The handler ran first and saw an uncancelled event; the window listener cancelled it after.
    expect(seen).toEqual([false]);
    expect(submit.defaultPrevented).toBe(true);

    const dialog = document.createElement('form');
    dialog.setAttribute('method', 'dialog');
    document.body.append(dialog);
    const close = new Event('submit', { bubbles: true, cancelable: true });
    dialog.dispatchEvent(close);
    expect(close.defaultPrevented).toBe(false); // closing a dialog is not a navigation
  } finally { release(); }
  const after = new Event('submit', { bubbles: true, cancelable: true });
  document.body.append(document.createElement('form'));
  document.body.lastElementChild!.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

it('keeps a catalog push that arrives before the view has its API, and follows later ones', async () => {
  installSandboxRuntime();
  const kernelChannel = new MessageChannel();
  const runtimeChannel = new MessageChannel();
  let answer!: (value: unknown) => void;
  const kernel = createRpc(kernelChannel.port1, { mounted: () => {} });
  const runtime = createRpc(runtimeChannel.port1, { definition: (id: string) => new Promise(resolve => { answer = resolve; }).then(() => ({ id, title: 'Fake', kind: 'build' })) });
  const seen: unknown[] = [];
  let viewApi: any;
  const module = { default(api: any) { viewApi = api; api.panels.register({ id: 'fake-panel', title: 'Fake', build() { seen.push(api.effects.list().map((effect: { id: string }) => effect.id)); } }); } };
  const target = document.createElement('div');
  const pending = bootView(init('fake-panel'), kernelChannel.port2, runtimeChannel.port2, { load: async () => module, target });
  kernel.notify('catalog', { effects: [{ id: 'other-ext.glow', label: 'Glow' }] });
  await new Promise(resolve => setTimeout(resolve, 10));
  answer(null);
  const view = await pending;
  expect(seen).toEqual([['other-ext.glow']]);
  kernel.notify('catalog', { effects: [] });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(viewApi.effects.list()).toEqual([]);
  view.dispose();
  kernel.close(); runtime.close();
});

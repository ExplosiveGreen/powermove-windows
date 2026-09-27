// @vitest-environment happy-dom
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import ProjectPicker from './ProjectPicker.svelte';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({matches:true})));
afterEach(() => vi.unstubAllGlobals());

it('filters projects and opens the matching project with Enter', async () => {
  const target = document.createElement('div'), anchor = document.createElement('button');
  document.body.append(target, anchor);
  const onchoose = vi.fn(async () => {}), onclose = vi.fn();
  const instance = mount(ProjectPicker, { target, props: { anchor, projects: [{id: 'a', name: 'Demo'}, {id: 'b', name: 'Launch film'}], onchoose, onclose } });
  flushSync();
  const search = target.querySelector('input')!;
  flushSync(() => { search.value = 'launch'; search.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(target.querySelectorAll('[role="option"]')).toHaveLength(1);
  search.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
  await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  expect(onchoose).toHaveBeenCalledWith('b');
  await unmount(instance); target.remove(); anchor.remove();
});

it('keeps a failed project selection open and displays the reason', async () => {
  const target = document.createElement('div'), anchor = document.createElement('button');
  document.body.append(target, anchor);
  const onclose = vi.fn();
  const instance = mount(ProjectPicker, { target, props: { anchor, projects: [{id:'a',name:'Demo'}], onchoose: async () => {throw new Error('Project unavailable');}, onclose } });
  flushSync(); target.querySelector<HTMLElement>('[role="option"]')!.click();
  await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toBe('Project unavailable'));
  expect(onclose).not.toHaveBeenCalled();
  await unmount(instance); target.remove(); anchor.remove();
});

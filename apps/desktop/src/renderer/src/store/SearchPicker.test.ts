// @vitest-environment happy-dom
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import SearchPicker from './SearchPicker.svelte';

const base = { placeholder: 'Search projects…', label: 'Open in project', emptyNone: 'Create a project first to use this extension.' };

beforeEach(() => vi.stubGlobal('matchMedia', () => ({matches:true})));
afterEach(() => vi.unstubAllGlobals());

it('filters items and chooses the matching one with Enter', async () => {
  const target = document.createElement('div'), anchor = document.createElement('button');
  document.body.append(target, anchor);
  const onchoose = vi.fn(async () => {}), onclose = vi.fn();
  const instance = mount(SearchPicker, { target, props: { ...base, anchor, items: [{id: 'a', title: 'Demo'}, {id: 'b', title: 'Launch film'}], onchoose, onclose } });
  flushSync();
  const search = target.querySelector('input')!;
  flushSync(() => { search.value = 'launch'; search.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(target.querySelectorAll('[role="option"]')).toHaveLength(1);
  search.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
  await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  expect(onchoose).toHaveBeenCalledWith('b');
  await unmount(instance); target.remove(); anchor.remove();
});

it('keeps a failed choice open and displays the reason', async () => {
  const target = document.createElement('div'), anchor = document.createElement('button');
  document.body.append(target, anchor);
  const onclose = vi.fn();
  const instance = mount(SearchPicker, { target, props: { ...base, anchor, items: [{id:'a',title:'Demo'}], onchoose: async () => {throw new Error('Project unavailable');}, onclose } });
  flushSync(); target.querySelector<HTMLElement>('[role="option"]')!.click();
  await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toBe('Project unavailable'));
  expect(onclose).not.toHaveBeenCalled();
  await unmount(instance); target.remove(); anchor.remove();
});

it('shows the meta line and marks the current item', async () => {
  const target = document.createElement('div'), anchor = document.createElement('button');
  document.body.append(target, anchor);
  const instance = mount(SearchPicker, { target, props: { ...base, anchor, items: [{id:'a',title:'Demo',meta:'Current',current:true}], onchoose: async () => {}, onclose: () => {} } });
  flushSync();
  const option = target.querySelector<HTMLElement>('[role="option"]')!;
  expect(option.getAttribute('aria-selected')).toBe('true');
  expect(option.textContent).toContain('Current');
  await unmount(instance); target.remove(); anchor.remove();
});

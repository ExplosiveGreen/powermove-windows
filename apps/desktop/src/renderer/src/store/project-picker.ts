import { mount, unmount } from 'svelte';
import SearchPicker, { type SearchPickerItem } from './SearchPicker.svelte';
import { relativeOpened } from '../panels/agent/threads';

let currentAnchor: HTMLElement | undefined;
let closeCurrent: (() => void) | undefined;

/** A searchable listbox anchored to a button — the select-menu sheet with a
 * search field and gliding hover (search-picker.css). One is open at a time; a
 * second activation of the same anchor toggles it shut. */
export function openSearchPicker(anchor: HTMLElement, opts: {
  items: SearchPickerItem[]; placeholder: string; label: string; emptyNone: string;
  onchoose: (id: string) => Promise<void>;
}): void {
  if (currentAnchor === anchor && closeCurrent) { closeCurrent(); anchor.focus(); return; }
  closeCurrent?.();
  const host = document.createElement('div');
  document.body.append(host);
  let closed = false;
  const close = () => { if (closed) return; closed = true; if (currentAnchor === anchor) { closeCurrent = undefined; currentAnchor = undefined; } void unmount(instance); host.remove(); anchor.setAttribute('aria-expanded', 'false'); };
  const instance = mount(SearchPicker, { target: host, props: {
    anchor, items: opts.items, placeholder: opts.placeholder, label: opts.label, emptyNone: opts.emptyNone, onchoose: opts.onchoose, onclose: close
  } });
  closeCurrent = () => instance.dismiss();
  currentAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
}

export function openProjectPicker(anchor: HTMLElement, PM: Record<string, any>, onchoose: (id: string) => Promise<void>): void {
  const currentId = PM.proj?.id;
  const openedAt = Date.now();
  const items: SearchPickerItem[] = (PM.Projects?.list?.() ?? []).map((project: { id: string; name: string; updatedAt?: number }) => ({
    id: project.id,
    title: project.name,
    current: project.id === currentId,
    meta: project.id === currentId ? 'Current' : project.updatedAt ? relativeOpened(project.updatedAt, openedAt) : 'Saved project'
  }));
  openSearchPicker(anchor, { items, placeholder: 'Search projects…', label: 'Open in project', emptyNone: 'Create a project first to use this extension.', onchoose });
}

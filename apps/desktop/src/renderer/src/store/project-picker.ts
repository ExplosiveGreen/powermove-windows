import { mount, unmount } from 'svelte';
import ProjectPicker from './ProjectPicker.svelte';

let currentAnchor: HTMLElement | undefined;
let closeCurrent: (() => void) | undefined;
export function openProjectPicker(anchor: HTMLElement, PM: Record<string, any>, onchoose: (id: string) => Promise<void>): void {
  if (currentAnchor === anchor && closeCurrent) { closeCurrent(); anchor.focus(); return; }
  closeCurrent?.();
  const host = document.createElement('div');
  document.body.append(host);
  let closed = false;
  const close = () => { if (closed) return; closed = true; if (currentAnchor === anchor) { closeCurrent = undefined; currentAnchor = undefined; } void unmount(instance); host.remove(); anchor.setAttribute('aria-expanded', 'false'); };
  const instance = mount(ProjectPicker, { target: host, props: {
    anchor, currentId: PM.proj?.id, projects: PM.Projects?.list?.() ?? [], onchoose, onclose: close
  } });
  closeCurrent = () => instance.dismiss();
  currentAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
}

/* Scritto's roll for DOM that Svelte does not own (the legacy home screen):
   a label that changes rolls its letters into the new value, the way the
   Store's title does, instead of snapping. Anything that is not a live
   element (test doubles) just gets its text set. */
import { mount, unmount } from 'svelte';
import Scritto from '@scritto/svelte';

export interface RollText {
  set(value: string): void;
  dispose(): void;
}

export function rollText(target: unknown, initial = ''): RollText {
  const live = typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && typeof customElements !== 'undefined';
  if (!live) {
    const plain = target as { textContent?: string | null };
    plain.textContent = initial;
    return { set: (value) => { plain.textContent = value; }, dispose: () => {} };
  }
  const props = $state({ value: initial });
  target.textContent = '';
  const instance = mount(Scritto, { target, props });
  return {
    set: (value) => { props.value = value; },
    dispose: () => { void unmount(instance); }
  };
}

import { SvelteMap, SvelteSet } from 'svelte/reactivity';

/*
 * Pinned layers, shared by the outline and its header. A rune module: every
 * component that imports `pins` reads and writes the same reactive state. In
 * the sandbox each open panel has its own copy of this module.
 */
class Pins {
  readonly ids = new SvelteSet<string>();
  /** Layer id → the playhead time the layer was pinned at. */
  readonly at = new SvelteMap<string, number>();
  readonly count = $derived(this.ids.size);

  has(id: string): boolean {
    return this.ids.has(id);
  }

  toggle(id: string, time: number): void {
    if (this.ids.delete(id)) { this.at.delete(id); return; }
    this.ids.add(id);
    this.at.set(id, time);
  }

  /** Forgets layers that no longer exist. */
  keep(live: ReadonlySet<string>): void {
    for (const id of [...this.ids]) if (!live.has(id)) { this.ids.delete(id); this.at.delete(id); }
  }
}

export const pins = new Pins();

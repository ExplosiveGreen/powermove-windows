<script lang="ts" module>
  export type Row = { id: string; name: string; type: string };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { Attachment } from 'svelte/attachments';
  import { cubicOut } from 'svelte/easing';
  import { on } from 'svelte/events';
  import { fade, slide } from 'svelte/transition';
  import { pins } from './pins.svelte';

  let { rows, time, tc, hovered = $bindable(null), empty, onmotion }: {
    rows: Row[];
    /** The playhead, read only when a row is pinned. */
    time: () => number;
    tc: (seconds: number) => string;
    hovered?: string | null;
    empty: Snippet<[]>;
    /** Called when a row's enter, exit or move animation finishes. */
    onmotion?: (kind: 'in' | 'out' | 'move') => void;
  } = $props();

  const hover = (id: string): Attachment<HTMLElement> => node => {
    const offEnter = on(node, 'pointerenter', () => { hovered = id; });
    const offLeave = on(node, 'pointerleave', () => { if (hovered === id) hovered = null; });
    return () => { offEnter(); offLeave(); };
  };

  /* flip, with a note for the caller: Svelte animates a row only when it moved. */
  function move(node: HTMLElement, rects: { from: DOMRect; to: DOMRect }, params?: Parameters<typeof flip>[2]) {
    queueMicrotask(() => onmotion?.('move'));
    return flip(node, rects, params);
  }
</script>

{#snippet row(layer: Row)}
  <span class="name">{layer.name}</span>
  <span class="meta">{pins.has(layer.id) ? `pinned ${tc(pins.at.get(layer.id) ?? 0)}` : layer.type}</span>
{/snippet}

{#if rows.length}
  <ul class="rows">
    {#each rows as layer (layer.id)}
      <li
        class="row"
        class:pinned={pins.has(layer.id)}
        class:hovered={hovered === layer.id}
        data-layer={layer.id}
        animate:move={{ duration: 160, easing: cubicOut }}
        in:fade={{ duration: 140 }}
        out:slide={{ duration: 140 }}
        onintroend={() => onmotion?.('in')}
        onoutroend={() => onmotion?.('out')}
        {@attach hover(layer.id)}
      >
        <button type="button" class="pin" aria-pressed={pins.has(layer.id)} onclick={() => pins.toggle(layer.id, time())}>
          {@render row(layer)}
        </button>
      </li>
    {/each}
  </ul>
{:else}
  {@render empty()}
{/if}

<style>
  .rows { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
  .row { display: block; }
  .pin { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; width: 100%; min-height: var(--row-h, 24px); padding: 0 6px; border: 0; border-radius: var(--r-sm, 6px); background: transparent; color: var(--tx-2); font: inherit; text-align: start; cursor: default; }
  .hovered .pin { background: var(--ink-1, var(--bg-field)); }
  .pinned .pin { color: var(--tx); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { flex: none; color: var(--tx-3, var(--tx-2)); font-variant-numeric: tabular-nums; }
</style>

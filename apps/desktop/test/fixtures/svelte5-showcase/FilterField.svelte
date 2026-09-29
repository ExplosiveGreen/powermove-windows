<script lang="ts">
  import { on } from 'svelte/events';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let { value = $bindable(''), ...rest }: { value?: string } & Omit<HTMLInputAttributes, 'value'> = $props();

  // Escape clears the field from anywhere in the panel.
  $effect(() => on(window, 'keydown', event => {
    if (event.key === 'Escape') value = '';
  }));
</script>

<input class="filter" type="search" spellcheck="false" autocomplete="off" bind:value {...rest} />

<style>
  .filter { width: 100%; height: var(--ctl-h, 26px); box-sizing: border-box; padding: 0 8px; border: 0; border-radius: var(--r-sm, 6px); background: var(--bg-field); color: var(--tx); font: inherit; outline: none; }
  .filter::placeholder { color: var(--tx-3, var(--tx-2)); }
</style>

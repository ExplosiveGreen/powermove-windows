<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { PanelProps } from 'powermove';

  let { api }: PanelProps = $props();
  let note = $state('');
  let runs = $state(0);
  let faded = $state(false);
  let root: HTMLElement;
  // Reactive api reads: each re-runs when the kernel's value changes, no events.on.
  const revision = $derived(api!.project.revision());
  const time = $derived(api!.project.time().toFixed(2));
  // undefined until this view's first snapshot lands, so the row fades in.
  const layers = $derived(api!.project.latest()?.layers.length);

  /* Playwright cannot read inside this out-of-process frame, so the panel
     reports what it rendered after each update (e2e/extension-sandbox.spec.ts). */
  $effect(() => {
    void [revision, time, layers, faded];
    const shown = Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-readout]')].map(el => [el.dataset.readout, el.textContent]));
    api!.events.emit('readout', { ...shown, faded });
  });

  async function run(): Promise<void> {
    const result = await api!.commands.run(`${api!.id}.command`);
    if (result === 'ran') runs += 1;
  }
</script>

<section class="fixture" bind:this={root}>
  <p class="row"><span>Project revision</span><b data-readout="revision">{revision}</b></p>
  <p class="row"><span>Runs</span><b>{runs}</b></p>
  <input class="field" placeholder="Note" bind:value={note} aria-label="Note" />
  <button class="button" type="button" onclick={run}>Run sandbox command</button>
  <p class="row"><span>Time</span><b data-readout="time">{time}</b></p>
  {#if layers !== undefined}
    <p class="row" transition:fade={{ duration: 120 }} onintroend={() => { faded = true; }}><span>Layers</span><b data-readout="layers">{layers}</b></p>
  {/if}
</section>

<style>
  .fixture { display: flex; flex-direction: column; gap: 6px; padding: var(--pad); }
  .row { display: flex; align-items: center; justify-content: space-between; min-height: var(--row-h); margin: 0; color: var(--tx-2); }
  .row b { color: var(--tx); font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; }
  .field { height: var(--ctl-h); padding: 0 8px; border: 0; border-radius: var(--r-sm); background: var(--bg-field); color: var(--tx); font: inherit; outline: none; }
  .field:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .button { height: var(--ctl-h); border: 0; border-radius: var(--r-sm); background: var(--ink-2); color: var(--tx); font: inherit; font-weight: var(--fw-medium); }
  .button:hover { background: var(--ink-3); }
  .button:focus-visible { box-shadow: 0 0 0 2px var(--accent); outline: none; }
</style>

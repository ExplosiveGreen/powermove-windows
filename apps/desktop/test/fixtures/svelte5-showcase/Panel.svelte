<script lang="ts">
  import { tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { cubicOut } from 'svelte/easing';
  import { Spring, Tween } from 'svelte/motion';
  import { MediaQuery } from 'svelte/reactivity';
  import type { PanelProps } from 'powermove';
  import FilterField from './FilterField.svelte';
  import LayerList, { type Row } from './LayerList.svelte';
  import { pins } from './pins.svelte';

  let { api }: PanelProps = $props();
  const ext = $derived(api!);

  let filter = $state('');
  let hovered = $state<string | null>(null);
  let width = $state(0);
  const motion = $state({ in: 0, out: 0, move: 0 });

  // Reactive API reads: markup and $derived re-run when the value changes.
  const timecode = $derived(ext.util.tc(ext.project.time()));
  const rows = $derived<Row[] | undefined>(ext.project.latest()?.layers.map(({ id, name, type }) => ({ id, name, type })));
  const shown = $derived(rows?.filter(layer => layer.name.toLowerCase().includes(filter.trim().toLowerCase())) ?? []);

  // Keep the pins to layers that still exist.
  $effect(() => { if (rows) pins.keep(new Set(rows.map(layer => layer.id))); });

  // The meter eases to the share of layers shown; the dot springs to the share pinned.
  const fill = new Tween(0, { duration: 260, easing: cubicOut });
  const pinned = new Spring(0, { stiffness: 0.18, damping: 0.7 });
  const settled = $state({ fill: 0, pinned: 0 });
  $effect(() => {
    const target = rows?.length ? shown.length / rows.length : 0;
    void fill.set(target).then(() => { settled.fill = target; });
  });
  $effect(() => {
    const target = rows?.length ? pins.count / rows.length : 0;
    void pinned.set(target).then(() => { settled.pinned = target; });
  });

  const narrow = new MediaQuery('max-width: 240px');
  const measure: Attachment<HTMLElement> = node => {
    const observer = new ResizeObserver(() => { width = Math.round(node.clientWidth); });
    observer.observe(node);
    return () => observer.disconnect();
  };

  /*
   * Playwright cannot look inside a sandboxed frame, so the panel reports what
   * it rendered, read back from its own DOM, as an extension event. While
   * playing it samples four times a second, the pattern EXTENSIONS.md
   * recommends, so a playing panel does no per-frame work of its own beyond
   * the timecode text.
   */
  let root: HTMLElement;
  let samplers = 0;
  function report(): void {
    const text = (selector: string) => root.querySelector(selector)?.textContent?.trim() ?? null;
    // Extension events are not in KernelEvents, hence the cast.
    (ext.events.emit as (event: string, payload: unknown) => void)('showcase-report', {
      timecode: text('[data-readout="timecode"]'),
      playing: ext.project.playing(),
      layers: [...root.querySelectorAll<HTMLElement>('[data-layer]')].map(node => node.querySelector('.name')?.textContent ?? ''),
      empty: text('[data-readout="empty"]'),
      pinned: [...pins.ids],
      filter,
      hovered,
      motion: { ...motion },
      settled: { ...settled },
      fill: root.querySelector<HTMLElement>('.fill')?.style.width ?? null,
      narrow: narrow.current,
      width,
      samplers,
      theme: ext.theme.active(),
      // Where the controls are in this document, so a test can point at them.
      rects: Object.fromEntries([...root.querySelectorAll<HTMLElement>('[data-layer], .filter')].map(node => {
        const rect = node.getBoundingClientRect();
        return [node.dataset.layer ?? 'filter', [rect.x, rect.y, rect.width, rect.height].map(Math.round)];
      }))
    });
  }
  $effect(() => {
    void [rows, shown, filter, hovered, motion.in, motion.out, motion.move, settled.fill, settled.pinned, pins.count, narrow.current, width];
    void tick().then(report);
  });
  $effect(() => {
    if (!ext.project.playing()) { void timecode; void tick().then(report); return; }
    samplers += 1;
    const timer = setInterval(report, 250);
    return () => { clearInterval(timer); samplers -= 1; };
  });
</script>

{#snippet empty()}
  <p class="empty" data-readout="empty">{rows ? 'No layers match' : 'Reading the project…'}</p>
{/snippet}

<section class="showcase" class:narrow={narrow.current} bind:this={root} {@attach measure}>
  <header class="head">
    <output class="timecode" data-readout="timecode">{timecode}</output>
    <span class="state">{ext.project.playing() ? 'Playing' : 'Paused'}</span>
  </header>
  <div class="meter" aria-hidden="true">
    <div class="fill" style:width="{fill.current * 100}%"></div>
    <div class="dot" style:left="{pinned.current * 100}%"></div>
  </div>
  <FilterField bind:value={filter} placeholder="Filter layers" aria-label="Filter layers" />
  <LayerList rows={shown} time={() => ext.project.time()} tc={seconds => ext.util.tc(seconds)} bind:hovered {empty} onmotion={kind => { motion[kind] += 1; }} />
  <footer class="foot">{pins.count} pinned{rows ? ` of ${rows.length}` : ''}</footer>
</section>

<style>
  .showcase { display: flex; flex-direction: column; gap: 8px; padding: var(--pad, 10px); color: var(--tx); }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  .timecode { font-size: 20px; font-weight: var(--fw-medium, 500); font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
  .state, .foot, .empty { margin: 0; color: var(--tx-2); }
  .meter { position: relative; height: 4px; border-radius: 2px; background: var(--ink-2, var(--bg-field)); }
  .fill { height: 100%; border-radius: inherit; background: var(--accent); }
  .dot { position: absolute; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--tx); }
  .narrow .state { display: none; }
</style>

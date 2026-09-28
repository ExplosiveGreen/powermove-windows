<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fromAction, type Attachment } from 'svelte/attachments';
  import { cubicOut } from 'svelte/easing';
  import { on } from 'svelte/events';
  import { Spring, Tween } from 'svelte/motion';
  import { createSubscriber, MediaQuery, SvelteMap } from 'svelte/reactivity';
  import { innerWidth } from 'svelte/reactivity/window';
  import { writable } from 'svelte/store';
  import { fade } from 'svelte/transition';
  import { bell } from './bell';
  import { counter, increment } from './counter.svelte';

  let shown = $state(false);
  const tags = new SvelteMap<string, number>();
  const wide = new MediaQuery('min-width: 600px');
  const tween = new Tween(0, { duration: 0 });
  const spring = new Spring(0);
  const label = writable('surface');
  let rings = 0;
  const subscribe = createSubscriber(update => on(bell, 'ring', () => { rings += 1; update(); }));
  const bells = { get rings() { subscribe(); return rings; } };
  const clicks: Attachment<HTMLButtonElement> = node => on(node, 'click', increment);
  const mark = (node: HTMLElement, value: string) => {
    node.dataset.mark = value;
    return { update: (next: string) => { node.dataset.mark = next; } };
  };
  onMount(() => label.set('mounted'));

  function toggle(): void {
    shown = !shown;
    tags.set(`tag-${tags.size}`, tags.size);
    tween.target = 10;
    spring.target = 5;
  }
</script>

<button class="count" {@attach clicks}>{counter.count}</button>
<button class="toggle" onclick={toggle}>toggle</button>
<output class="tags">{tags.size}</output>
<output class="rings">{bells.rings}</output>
<output class="wide">{wide.current}</output>
<output class="width">{innerWidth.current}</output>
<output class="motion">{tween.target}/{spring.target}</output>
<output class="label" {@attach fromAction(mark, () => $label)}>{$label}</output>
{#if shown}<p class="faded" transition:fade={{ duration: 100, easing: cubicOut }}>faded</p>{/if}
<ul>{#each [...tags.keys()] as key (key)}<li animate:flip>{key}</li>{/each}</ul>

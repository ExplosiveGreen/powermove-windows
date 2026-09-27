<script lang="ts">
  import type { AdminLogEntry } from '@powermove/registry/wire';
  import { actionLabel, time } from '$lib/format';

  let { data } = $props();

  const href = (target: AdminLogEntry['target']) =>
    target?.kind === 'repo' ? `/extensions/${target.id}` : target?.kind === 'publisher' ? `/publishers/${target.id}` : null;
  const targetLabel = (target: AdminLogEntry['target']) => (target ? (target.label ?? target.id) : 'Unknown');
</script>

<svelte:head><title>Moderation log · Powermove Admin</title></svelte:head>

<header class="heading">
  <h1>Moderation log</h1>
  <p>The latest 100 actions, newest first.</p>
</header>

<section class="section">
  <h2 class="section-title">Recent</h2>
  <div class="group">
    {#each data.items as entry (entry.id)}
      {@const link = href(entry.target)}
      <svelte:element this={link ? 'a' : 'div'} class="row" href={link ?? undefined}>
        <div class="copy">
          <b>{actionLabel(entry.action)} · {targetLabel(entry.target)}</b>
          <span>{[`By ${entry.actor.label ?? entry.actor.id}`, time(entry.createdAt), entry.reason].filter(Boolean).join(' · ')}</span>
        </div>
      </svelte:element>
    {:else}
      <p class="empty">Nothing yet.</p>
    {/each}
  </div>
</section>

<script lang="ts">
  import Markdown from '../panels/agent/Markdown.svelte';
  import type { WhatsNew } from '../../../shared/ipc';

  /* The release notes shown on the first launch after an update: one section
     per version since the one the user last ran, newest first. */
  let { notes }: { notes: WhatsNew } = $props();

  function day(date: string | null): string {
    if (!date) return '';
    const value = new Date(date);
    return Number.isNaN(value.getTime()) ? '' : value.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
</script>

<div class="whats-new">
  <p class="whats-new-lede">Powermove updated from {notes.previous} to {notes.current}.</p>
  {#each notes.releases as release (release.version)}
    <section class="whats-new-release">
      <header>
        <span class="whats-new-version">{release.name}</span>
        {#if day(release.date)}<span class="whats-new-date">{day(release.date)}</span>{/if}
      </header>
      {#if release.notes}
        <div class="whats-new-notes"><Markdown text={release.notes} /></div>
      {:else}
        <p class="whats-new-empty">Fixes and improvements.</p>
      {/if}
    </section>
  {/each}
</div>

<style>
  .whats-new { display: flex; flex-direction: column; gap: 18px; font-size: 12.5px; line-height: 1.5; color: var(--tx-2); }
  .whats-new-lede { margin: 0; color: var(--tx-3); }
  .whats-new-release { display: flex; flex-direction: column; gap: 8px; }
  .whats-new-release + .whats-new-release { padding-top: 16px; border-top: 1px solid var(--line); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .whats-new-version { font-weight: var(--fw-semibold); color: var(--tx); font-size: 13.5px; }
  .whats-new-date { color: var(--tx-3); font-size: 11.5px; white-space: nowrap; }
  .whats-new-empty { margin: 0; }
</style>

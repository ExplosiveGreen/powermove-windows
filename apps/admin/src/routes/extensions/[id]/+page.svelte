<script lang="ts">
  import { enhance } from '$app/forms';
  import { date, extensionState } from '$lib/format';

  let { data, form } = $props();
  const e = $derived(data.extension);
  let busy = $state(false);
  let confirming = $state(false);

  const submit = () => {
    busy = true;
    return async ({ update }: { update: (options?: { reset?: boolean }) => Promise<void> }) => {
      await update();
      busy = false;
      confirming = false;
    };
  };
</script>

<svelte:head><title>{e.name} · Powermove Admin</title></svelte:head>

<header class="heading">
  <a class="back" href="/extensions">Extensions</a>
  <h1>{e.name}</h1>
  <p>{e.owner.handle}/{e.slug} · {extensionState(e)}</p>
</header>

<section class="section">
  <h2 class="section-title">Moderation</h2>
  <form class="group" method="POST" action="?/moderate" use:enhance={submit}>
    {#if e.moderation === 'removed'}
      <div class="row">
        <div class="copy"><b>Removed</b><span class="wrap">Gone for everyone. Removal can't be undone.</span></div>
      </div>
    {:else}
      <div class="row">
        <div class="copy"><b>Reason</b><span>Saved with the action in the moderation log.</span></div>
        <input class="input" name="reason" maxlength="1000" autocomplete="off" aria-label="Reason" />
      </div>
      <div class="row">
        {#if e.moderation === 'hidden'}
          <div class="copy"><b>Hidden</b><span class="wrap">Out of browse and search, and only its owner can open it.</span></div>
          <button class="btn" type="submit" name="action" value="unhide" disabled={busy}>Restore</button>
        {:else}
          <div class="copy"><b>Hide</b><span class="wrap">Takes it out of browse and search; only its owner can open it.</span></div>
          <button class="btn" type="submit" name="action" value="hide" disabled={busy}>Hide</button>
        {/if}
      </div>
      <div class="row">
        <div class="copy"><b>Remove</b><span class="wrap">Gone for everyone. Removal can't be undone.</span></div>
        <button class="btn danger" type="button" onclick={() => (confirming = true)} disabled={busy || confirming}>Remove…</button>
      </div>
      {#if confirming}
        <div class="confirm">
          <p>Remove {e.owner.handle}/{e.slug}? It can't be restored afterwards.</p>
          <div class="controls">
            <button class="btn danger" type="submit" name="action" value="remove" disabled={busy}>Remove</button>
            <button class="btn" type="button" onclick={() => (confirming = false)}>Cancel</button>
          </div>
        </div>
      {/if}
    {/if}
  </form>
  {#if form?.message}<p class="note error" role="alert">{form.message}</p>{/if}
</section>

<section class="section">
  <h2 class="section-title">Details</h2>
  <div class="group">
    <a class="row" href="/publishers/{e.owner.id}">
      <div class="copy"><b>Publisher</b></div>
      <span class="value">@{e.owner.handle}{e.owner.verified ? ' · Verified' : ''}</span>
    </a>
    <div class="row"><div class="copy"><b>Latest version</b></div><span class="value">{e.latestVersion ?? '—'}</span></div>
    <div class="row"><div class="copy"><b>Visibility</b></div><span class="value">{e.visibility === 'public' ? 'Public' : 'Unlisted'}</span></div>
    <div class="row"><div class="copy"><b>Installs</b></div><span class="value">{e.installCount}</span></div>
    <div class="row"><div class="copy"><b>Updated</b></div><span class="value">{date(e.updatedAt)}</span></div>
    <div class="row"><div class="copy"><b>Repo ID</b></div><span class="value mono">{e.repoId}</span></div>
  </div>
</section>

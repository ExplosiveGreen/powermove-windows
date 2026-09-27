<script lang="ts">
  import { enhance } from '$app/forms';
  import { date, extensionState } from '$lib/format';

  let { data, form } = $props();
  const p = $derived(data.publisher);
  let busy = $state(false);
</script>

<svelte:head><title>@{p.publisher.handle} · Powermove Admin</title></svelte:head>

<header class="heading">
  <a class="back" href="/publishers">Publishers</a>
  <h1>@{p.publisher.handle}</h1>
  <p>{p.user ? p.user.email : 'No account'}{p.publisher.tombstoned ? ' · Deleted' : ''}</p>
</header>

<section class="section">
  <h2 class="section-title">Status</h2>
  <div class="group">
    <form
      class="row"
      method="POST"
      action="?/verified"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          await update({ reset: false });
          busy = false;
        };
      }}
    >
      <div class="copy">
        <b>{p.publisher.verified ? 'Verified' : 'Not verified'}</b>
        <span>{p.verifiedAt ? `Since ${date(p.verifiedAt)}. The Store shows a check next to @${p.publisher.handle}.` : `The Store shows a check next to verified publishers.`}</span>
      </div>
      <input type="hidden" name="verified" value={p.publisher.verified ? 'false' : 'true'} />
      <button class="btn" type="submit" disabled={busy}>{p.publisher.verified ? 'Unverify' : 'Verify'}</button>
    </form>
  </div>
  {#if form?.message}<p class="note error" role="alert">{form.message}</p>{/if}
</section>

<section class="section">
  <h2 class="section-title">Account</h2>
  <div class="group">
    <div class="row"><div class="copy"><b>Email</b></div><span class="value">{p.user?.email ?? '—'}</span></div>
    <div class="row"><div class="copy"><b>Name</b></div><span class="value">{p.user?.name || '—'}</span></div>
    <div class="row"><div class="copy"><b>User ID</b></div><span class="value mono">{p.user?.id ?? '—'}</span></div>
    <div class="row"><div class="copy"><b>Publisher ID</b></div><span class="value mono">{p.publisher.id}</span></div>
    <div class="row"><div class="copy"><b>Handle claimed</b></div><span class="value">{date(p.claimedAt)}</span></div>
    {#if p.tombstonedAt}
      <div class="row"><div class="copy"><b>Deleted</b></div><span class="value">{date(p.tombstonedAt)}</span></div>
    {/if}
  </div>
</section>

<section class="section">
  <h2 class="section-title">Extensions</h2>
  <div class="group">
    {#each p.extensions as e (e.repoId)}
      <a class="row" href="/extensions/{e.repoId}">
        <div class="copy">
          <b>{e.name}</b>
          <span>{[`${e.owner.handle}/${e.slug}`, e.latestVersion, extensionState(e)].filter(Boolean).join(' · ')}</span>
        </div>
      </a>
    {:else}
      <p class="empty">No extensions.</p>
    {/each}
  </div>
</section>

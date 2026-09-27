<script lang="ts">
  import { enhance } from '$app/forms';
  import { date } from '$lib/format';

  let { data, form } = $props();
  let busy = $state(false);
  const submit = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };
</script>

<svelte:head><title>Admins · Powermove Admin</title></svelte:head>

<header class="heading">
  <h1>Admins</h1>
  <p>Admins can verify publishers, moderate extensions and manage admins.</p>
</header>

<section class="section">
  <h2 class="section-title">Admins</h2>
  <div class="group">
    {#each data.items as a (a.user.id)}
      <form class="row" method="POST" action="?/revoke" use:enhance={submit}>
        <div class="copy">
          <b>{a.user.email}{a.user.id === data.me ? ' (you)' : ''}</b>
          <span>Granted {date(a.grantedAt)}{a.grantedBy ? ` by ${a.grantedBy.email}` : ''}</span>
        </div>
        <input type="hidden" name="userId" value={a.user.id} />
        <button class="btn" type="submit" disabled={busy || data.items.length <= 1} title={data.items.length <= 1 ? "The last admin can't be removed." : undefined}>Revoke</button>
      </form>
    {/each}
  </div>
  {#if form && !form.grant && form.message}<p class="note error" role="alert">{form.message}</p>{/if}
</section>

<section class="section">
  <h2 class="section-title">Grant</h2>
  <form class="group" method="POST" action="?/grant" use:enhance={submit}>
    <div class="row">
      <div class="copy"><b>Grant admin</b><span>The account must have signed in to Powermove once.</span></div>
      <div class="controls">
        <input class="input" type="email" name="email" value={form?.grant ? form.email : ''} placeholder="Email" aria-label="Email" autocomplete="off" required />
        <button class="btn" type="submit" disabled={busy}>Grant</button>
      </div>
    </div>
  </form>
  {#if form?.grant && form.message}<p class="note error" role="alert">{form.message}</p>{/if}
</section>

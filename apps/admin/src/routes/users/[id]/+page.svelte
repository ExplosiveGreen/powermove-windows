<script lang="ts">
  import { enhance } from '$app/forms';
  import { date, time, extensionState } from '$lib/format';
  let { data, form } = $props();
  const u = $derived(data.account);
  let busy = $state(false);
</script>
<svelte:head><title>{u.name || u.email} · Powermove Admin</title></svelte:head>
<header class="heading"><a class="back" href="/users">Users</a><h1>{u.name || u.email}</h1><p>{u.email}{u.publisher ? ` · @${u.publisher.handle}` : ''}</p></header>
<section class="section"><h2 class="section-title">Account</h2><div class="group">
  {@render field('Email', u.email)}
  {@render field('Email verification', u.emailVerified ? 'Verified' : 'Not verified')}
  {@render field('User ID', u.id, true)}
  {@render field('Joined', date(u.createdAt))}
  {@render field('Account updated', date(u.updatedAt))}
  {@render field('Latest retained sign-in', u.lastSessionAt ? time(u.lastSessionAt) : 'No retained sessions')}
  {@render field('Linked sign-in providers', u.providers.length ? u.providers.join(', ') : 'No linked providers')}
  <div class="row"><div class="copy"><b>Admin access</b><span>{u.adminGrantedAt ? `Granted ${date(u.adminGrantedAt)}` : 'Standard account'}</span></div><a class="btn" href="/admins">Manage admins</a></div>
</div></section>
<section class="section"><h2 class="section-title">Publisher</h2><div class="group">
{#if u.publisher && u.publisherDetails}
  {@render field('Handle', `@${u.publisher.handle}`)}
  {@render field('Publisher ID', u.publisher.id, true)}
  {@render field('Handle claimed', date(u.publisherDetails.claimedAt))}
  {#if u.publisherDetails.tombstonedAt}{@render field('Publisher deleted', date(u.publisherDetails.tombstonedAt))}{/if}
  <form class="row" method="POST" action="?/verified" use:enhance={() => { busy = true; return async ({ update }) => { try { await update({ reset: false }); } finally { busy = false; } }; }}>
    <div class="copy"><b>{u.publisher.verified ? 'Verified publisher' : 'Not verified'}</b><span class="wrap">{u.publisherDetails.verifiedAt ? `Verified ${date(u.publisherDetails.verifiedAt)}. ` : ''}Controls the blue check in the Store. Separate from email verification.</span></div>
    <input type="hidden" name="verified" value={u.publisher.verified ? 'false' : 'true'} />
    <button class="btn" type="submit" disabled={busy || u.publisher.tombstoned}>{busy ? 'Saving…' : u.publisher.verified ? 'Unverify' : 'Verify'}</button>
  </form>
{:else}<p class="empty">This user hasn’t claimed a publisher handle. They can still sign in and install extensions.</p>{/if}
</div>{#if form?.message}<p class="note error" role="alert">{form.message}</p>{/if}{#if form?.success}<p class="note" role="status">Publisher verification updated.</p>{/if}</section>
<section class="section"><h2 class="section-title">Published extensions · {u.extensionCount}</h2><div class="group">
{#each u.extensions as e (e.repoId)}<a class="row" href="/extensions/{e.repoId}"><div class="copy"><b>{e.name}</b><span>{e.owner.handle}/{e.slug} · {e.latestVersion ?? 'No release'} · {extensionState(e)}</span><span>{e.installCount} installs · Updated {date(e.updatedAt)}</span></div></a>{:else}<p class="empty">No published extensions.</p>{/each}
</div>{#if u.extensionCount > u.extensions.length}<p class="note">Showing the latest {u.extensions.length}. <a href="/extensions?q={encodeURIComponent(u.publisher?.handle ?? '')}">Search extensions</a></p>{/if}</section>
<section class="section"><h2 class="section-title">Saved library · {u.installCount}</h2><div class="group">
{#each u.library as e (e.repoId)}<a class="row" href="/extensions/{e.repoId}"><div class="copy"><b>{e.name}</b><span>{e.handle}/{e.slug} · {e.version} · Added {date(e.installedAt)}</span></div></a>{:else}<p class="empty">No saved installs. Local installs may not be synced to the cloud.</p>{/each}
</div>{#if u.installCount > u.library.length}<p class="note">Showing the latest {u.library.length} saved installs.</p>{/if}</section>
<section class="section"><h2 class="section-title">Active sessions · {u.activeSessions}</h2><p class="note">Latest {u.sessions.length} active sessions. Sign-in dates reflect retained sessions, not a complete login history.</p><div class="group">
{#each u.sessions as s}<div class="row"><div class="copy"><b>Signed in {time(s.createdAt)}</b><span>Updated {time(s.updatedAt)} · Expires {time(s.expiresAt)}</span><span class="wrap session-agent">{s.userAgent || 'Device information unavailable'}</span></div></div>{:else}<p class="empty">No active sessions.</p>{/each}
</div></section>
{#snippet field(label: string, value: string, mono = false)}<div class="row"><div class="copy"><b>{label}</b></div><span class:mono class="value">{value}</span></div>{/snippet}

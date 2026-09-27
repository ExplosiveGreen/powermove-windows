<script lang="ts">
  import { date } from '$lib/format';
  let { data } = $props();
  const pageLink = (offset: number) => `/users?${new URLSearchParams({ q: data.q, filter: data.filter, offset: String(offset), limit: String(data.limit) })}`;
</script>

<svelte:head><title>Users · Powermove Admin</title></svelte:head>
<header class="heading"><h1>Users</h1><p>Every account, including admins and people who haven’t published yet.</p></header>
<div class="stats" aria-label="Account totals">
  <a href="/users"><b>{data.counts.users}</b><span>Users</span></a>
  <a href="/users?filter=admins"><b>{data.counts.admins}</b><span>Admins</span></a>
  <a href="/users?filter=publishers"><b>{data.counts.publishers}</b><span>Publishers</span></a>
  <a href="/users?filter=verified"><b>{data.counts.verified}</b><span>Verified publishers</span></a>
</div>
<form class="search user-search" method="GET" role="search">
  <input class="input" type="search" name="q" value={data.q} placeholder="Name, email, handle or user ID" aria-label="Search users" autocomplete="off" maxlength="200" />
  <select class="input" name="filter" value={data.filter} aria-label="Filter users">
    <option value="all">All users</option><option value="admins">Admins</option><option value="publishers">Publishers</option><option value="verified">Verified publishers</option><option value="unverified-email">Unverified email</option>
  </select>
  <button class="btn" type="submit">Search</button>
</form>
<section class="section">
  <h2 class="section-title">{data.total} {data.total === 1 ? 'user' : 'users'}{data.q || data.filter !== 'all' ? ' matching your search' : ' · newest first'}</h2>
  <div class="group">
    {#each data.items as item (item.id)}
      <a class="row user-row" href="/users/{encodeURIComponent(item.id)}">
        <div class="copy">
          <b>{item.name || item.email}{#if item.adminGrantedAt}<span class="badge">Admin</span>{/if}{#if item.publisher?.verified}<span class="badge verified">Verified publisher</span>{/if}</b>
          <span>{item.email}{item.publisher ? ` · @${item.publisher.handle}` : ''}</span>
          <span>Joined {date(item.createdAt)} · {item.extensionCount} {item.extensionCount === 1 ? 'extension' : 'extensions'} · {item.activeSessions} active {item.activeSessions === 1 ? 'session' : 'sessions'}{!item.emailVerified ? ' · Email unverified' : ''}{item.publisher?.tombstoned ? ' · Publisher deleted' : ''}</span>
        </div>
        <span class="row-arrow" aria-hidden="true">›</span>
      </a>
    {:else}<p class="empty">No users match this search. <a href="/users">Show all users</a></p>{/each}
  </div>
  <nav class="pagination" aria-label="User pages">
    <span>{data.total ? `${Math.min(data.offset + 1, data.total)}–${Math.min(data.offset + data.items.length, data.total)} of ${data.total}` : '0 users'}</span>
    <div class="controls">
      {#if data.offset > 0}<a class="btn" href={pageLink(Math.max(0, data.offset - data.limit))}>Previous</a>{/if}
      {#if data.offset + data.limit < data.total}<a class="btn" href={pageLink(data.offset + data.limit)}>Next</a>{/if}
    </div>
  </nav>
</section>

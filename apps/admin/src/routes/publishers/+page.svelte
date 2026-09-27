<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Publishers · Powermove Admin</title></svelte:head>

<header class="heading">
  <h1>Publishers</h1>
  <p>Search by handle or account email.</p>
</header>

<form class="search" method="GET" data-sveltekit-keepfocus data-sveltekit-replacestate role="search">
  <input class="input" type="search" name="q" value={data.q} placeholder="Handle or email" aria-label="Search publishers" autocomplete="off" />
</form>

<section class="section">
  <h2 class="section-title">{data.q ? 'Results' : 'Newest'}</h2>
  <div class="group">
    {#each data.items as item (item.publisher.id)}
      <a class="row" href="/publishers/{item.publisher.id}">
        <div class="copy">
          <b>@{item.publisher.handle}</b>
          <span>{[item.user?.email ?? 'No account', item.publisher.verified && 'Verified', item.publisher.tombstoned && 'Deleted'].filter(Boolean).join(' · ')}</span>
        </div>
      </a>
    {:else}
      <p class="empty">{data.q ? `No publishers match “${data.q}”.` : 'No publishers yet.'}</p>
    {/each}
  </div>
</section>

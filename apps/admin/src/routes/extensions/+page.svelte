<script lang="ts">
  import { extensionState } from '$lib/format';

  let { data } = $props();
</script>

<svelte:head><title>Extensions · Powermove Admin</title></svelte:head>

<header class="heading">
  <h1>Extensions</h1>
  <p>Search by name, slug or publisher handle, in every state.</p>
</header>

<form class="search" method="GET" data-sveltekit-keepfocus data-sveltekit-replacestate role="search">
  <input class="input" type="search" name="q" value={data.q} placeholder="Name, slug or handle" aria-label="Search extensions" autocomplete="off" />
</form>

<section class="section">
  <h2 class="section-title">{data.q ? 'Results' : 'Recently updated'}</h2>
  <div class="group">
    {#each data.items as e (e.repoId)}
      <a class="row" href="/extensions/{e.repoId}">
        <div class="copy">
          <b>{e.name}</b>
          <span>{`${e.owner.handle}/${e.slug}`} · {extensionState(e)}</span>
        </div>
      </a>
    {:else}
      <p class="empty">{data.q ? `No extensions match “${data.q}”.` : 'No extensions yet.'}</p>
    {/each}
  </div>
</section>

<script lang="ts">
  let { url, art, hero = false }: { url: string | null; art: [string, string]; hero?: boolean } = $props();
  let failedUrl = $state<string | null>(null);
</script>

<span class="st-thumb" class:is-hero={hero} style={`--art-a:${art[0]};--art-b:${art[1]}`}>
  {#if url && url !== failedUrl}
    <img src={url} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => { failedUrl = url; }} />
  {/if}
</span>

<style>
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>

<script lang="ts">
  /* The publish sheet while main prepares the plan: same title, sections and
     footer, so the sheet appears on click and only its contents fill in. */
  let { name, onclose }: { name: string; onclose: () => void } = $props();
</script>

<div class="pub-sheet" tabindex="-1" data-autofocus aria-busy="true">
  <header class="pub-head">
    <h2>Publish {name}</h2>
    <p>Getting it ready…</p>
  </header>
  <div class="pub-form sg-column">
    <section class="pub-section">
      <h3 class="pub-title">Release</h3>
      <div class="sg-group pub-group" aria-live="polite">
        <div class="settings-row pub-row">
          <span class="settings-copy"><b>Preparing</b><span>Reading the folder and checking what’s on the store.</span></span>
          <svg class="acct-spinner pub-state" viewBox="0 0 16 16" aria-hidden="true">
            {#each { length: 12 } as _, i}
              <line x1="8" y1="1.75" x2="8" y2="4.5" transform={`rotate(${i * 30} 8 8)`} opacity={0.16 + 0.84 * ((i + 1) / 12)} />
            {/each}
          </svg>
        </div>
      </div>
    </section>
  </div>
  <footer class="pub-foot">
    <span></span>
    <button class="btn" type="button" onclick={onclose}>Cancel</button>
    <button class="btn pri" type="button" disabled>Publish…</button>
  </footer>
</div>

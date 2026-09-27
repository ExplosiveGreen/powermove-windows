<script lang="ts">
  import { SANDBOX_OK, SANDBOX_SKIPPED, sandboxCheckLines, type SandboxCheckState } from './sandbox-check';

  /* The sandbox check as Settings rows: a title and a line under it, the
     state at the right edge (a spinner, a tick, or Check Again). A failure
     adds one row per problem, the exact reason as its text. */
  let { state, onretry }: { state: SandboxCheckState; onretry?: () => void } = $props();

  const lines = $derived(state.status === 'done' ? sandboxCheckLines(state.report) : []);
</script>

<div class="sg-group pub-group pub-sandbox" aria-live="polite" aria-busy={state.status === 'running'}>
  {#if state.status === 'running'}
    <div class="settings-row pub-row">
      <span class="settings-copy"><b>Checking compatibility</b><span>Running it in the sandbox with the permissions it declares.</span></span>
      <svg class="acct-spinner pub-state" viewBox="0 0 16 16" aria-hidden="true">
        {#each { length: 12 } as _, i}
          <line x1="8" y1="1.75" x2="8" y2="4.5" transform={`rotate(${i * 30} 8 8)`} opacity={0.16 + 0.84 * ((i + 1) / 12)} />
        {/each}
      </svg>
    </div>
  {:else if state.status === 'error'}
    <div class="settings-row pub-row">
      <span class="settings-copy"><b>Couldn’t check</b><span class="pub-problem">{state.message}</span></span>
      {#if onretry}<button class="btn" type="button" onclick={onretry}>Check Again</button>{/if}
    </div>
  {:else if state.report.skipped}
    <div class="settings-row pub-row" data-sandbox="skipped">
      <span class="settings-copy"><b>Full access</b><span>{SANDBOX_SKIPPED}</span></span>
    </div>
  {:else if state.report.ok}
    <div class="settings-row pub-row" data-sandbox="ok">
      <span class="settings-copy"><b>{SANDBOX_OK}</b><span>It runs with only the permissions it declares.</span></span>
      <svg class="pub-check-mark pub-state" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </div>
  {:else}
    <div class="settings-row pub-row" data-sandbox="failed">
      <span class="settings-copy"><b>Not compatible with the sandbox</b><span>Fix {lines.length === 1 ? 'this' : 'these'}, then check again.</span></span>
      {#if onretry}<button class="btn" type="button" onclick={onretry}>Check Again</button>{/if}
    </div>
    {#each lines as line, index (index)}
      <div class="settings-row pub-row is-problem" data-sandbox="problem">
        <span class="settings-copy"><span class="pub-problem pub-sandbox-line">{line}</span></span>
      </div>
    {/each}
  {/if}
</div>

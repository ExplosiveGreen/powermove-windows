<script lang="ts">
  import { untrack } from 'svelte';
  import SandboxCheckStatus from './SandboxCheckStatus.svelte';
  import { SANDBOX_UNAVAILABLE, type SandboxCheckReport, type SandboxCheckState } from './sandbox-check';

  /* "Test in Sandbox…" from the Library: the publish sheet's check on its
     own, so an extension can be tried as others will run it before publishing. */
  let { name, check, onclose, onfix }: {
    name: string;
    check: () => Promise<SandboxCheckReport>;
    onclose: () => void;
    onfix?: (report: SandboxCheckReport) => Promise<boolean>;
  } = $props();

  let checkState = $state<SandboxCheckState>({ status: 'running' });
  let fixing = $state(false);
  let fixError = $state('');
  async function fix(): Promise<void> {
    if (!onfix || fixing || checkState.status !== 'done' || checkState.report.ok || checkState.report.skipped) return;
    fixing = true;
    fixError = '';
    try {
      if (await onfix(checkState.report)) onclose();
      else fixError = 'The agent couldn’t start the repair. Try again.';
    } catch { fixError = 'The agent couldn’t start the repair. Try again.'; }
    finally { fixing = false; }
  }
  let run = 0;
  async function start(): Promise<void> {
    const current = ++run;
    checkState = { status: 'running' };
    let next: SandboxCheckState;
    try {
      next = { status: 'done', report: await check() };
    } catch {
      next = { status: 'error', message: SANDBOX_UNAVAILABLE };
    }
    if (current === run) checkState = next;
  }
  $effect(() => { untrack(() => void start()); });
</script>

<div class="pub-sheet" tabindex="-1" data-autofocus>
  <header class="pub-head">
    <h2>Check {name} in the sandbox</h2>
    <p>Runs it with only the permissions in its manifest, the way it runs for people who install it.</p>
  </header>
<div class="pub-form sg-column">
    <SandboxCheckStatus state={checkState} onretry={() => void start()} onfix={onfix ? () => void fix() : undefined} {fixing} />
    {#if fixError}<p class="pub-error" role="alert">{fixError}</p>{/if}
  </div>
  <footer class="pub-foot">
    <span></span>
    <button class="btn pri" type="button" onclick={onclose}>Done</button>
  </footer>
</div>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy } from 'svelte';

  let { data, form } = $props();

  const step = $derived(form?.step ?? 'email');
  const email = $derived(form?.email ?? '');
  let busy = $state(false);
  let resend: HTMLFormElement | undefined = $state();
  let timer: ReturnType<typeof setInterval> | undefined;
  let waiting = $state(false);

  // While the verification tab is open, ask the server whether the API has a
  // result for this ticket; when it does, send the code again.
  function watch(ticket: string) {
    stop();
    waiting = true;
    const started = Date.now();
    timer = setInterval(async () => {
      if (Date.now() - started > 3 * 60_000) return stop();
      const response = await fetch('/sign-in/human', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { done?: boolean } | null;
      if (result?.done) {
        stop();
        resend?.requestSubmit();
      }
    }, 1500);
  }
  function stop() {
    clearInterval(timer);
    waiting = false;
  }
  onDestroy(stop);

  const submit = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      busy = false;
    };
  };
</script>

<svelte:head><title>Sign in · Powermove Admin</title></svelte:head>

<header class="heading">
  <h1>Sign in</h1>
  <p>Use your Powermove account.</p>
</header>

<section class="section">
  <h2 class="section-title">Google</h2>
  <div class="group">
    <div class="row">
      <div class="copy"><b>Continue with Google</b><span>The Google account you use in Powermove.</span></div>
      <a class="btn" href="/auth/google" data-sveltekit-reload>Continue</a>
    </div>
  </div>
  {#if data.error}<p class="note error" role="alert">{data.error}</p>{/if}
</section>

<section class="section">
  <h2 class="section-title">Email</h2>
  <div class="group">
    {#if step === 'code'}
      <form class="row" method="POST" action="?/verify" use:enhance={submit}>
        <div class="copy"><b>Code</b><span>Sent to {email}. It expires in 5 minutes.</span></div>
        <div class="controls">
          <input type="hidden" name="email" value={email} />
          <input class="input code" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Code" required />
          <button class="btn" type="submit" disabled={busy}>Sign in</button>
        </div>
      </form>
    {:else if step === 'human' && form && 'verifyUrl' in form}
      <div class="row">
        <div class="copy">
          <b>Verification</b>
          <span class="wrap">{waiting ? 'Waiting for the check to finish in the other tab…' : 'Powermove asks for a quick check before it emails a code.'}</span>
        </div>
        <a class="btn" href={form.verifyUrl} target="_blank" rel="noopener noreferrer" onclick={() => form.ticket && watch(form.ticket)}>Verify</a>
      </div>
      <form method="POST" action="?/send" use:enhance={submit} bind:this={resend} hidden>
        <input type="hidden" name="email" value={email} />
      </form>
    {:else}
      <form class="row" method="POST" action="?/send" use:enhance={submit}>
        <div class="copy"><b>Email</b><span>We'll send a sign-in code.</span></div>
        <div class="controls">
          <input class="input" type="email" name="email" value={email} autocomplete="email" placeholder="you@example.com" aria-label="Email" required />
          <button class="btn" type="submit" disabled={busy}>Send code</button>
        </div>
      </form>
    {/if}
  </div>
  {#if form && 'message' in form && form.message}<p class="note error" role="alert">{form.message}</p>{/if}
</section>

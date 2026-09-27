<script lang="ts">
  import Markdown from './agent/Markdown.svelte';
  import type { createRepairSession } from './repair-agent.svelte';
  let { name, session, onclose, onsettings }: { name: string; session: ReturnType<typeof createRepairSession>; onclose: () => void; onsettings: () => void } = $props();
  let transcript: HTMLDivElement;
  $effect(() => { session.state.messages.length; session.state.activity; transcript?.scrollTo?.({ top: transcript.scrollHeight }); });
</script>
<section aria-label={`Repair agent: ${name}`} class="repair-chat">
  <header><div><strong>Repair extension</strong><span>{name}</span></div><button type="button" aria-label="Close repair chat" onclick={onclose}>×</button></header>
  <div class="repair-transcript" bind:this={transcript} role="log" aria-live="polite">
    {#each session.state.messages as message}<div class:user={message.role === 'user'} class="repair-message"><Markdown text={message.text} /></div>{/each}
    {#if session.state.activity}<p class="repair-activity">{session.state.activity}</p>{/if}
    {#if session.state.error}<p role="alert" class="repair-error">{session.state.error}</p>{/if}
    {#if session.state.needsConnection}<div class="repair-connection"><p>Connect your agent to repair this extension.</p><button type="button" onclick={onsettings}>Connection settings</button></div>{/if}
  </div>
  <form onsubmit={(event) => { event.preventDefault(); void session.send(); }}>
    <textarea aria-label="Message repair agent" placeholder="Ask about this repair…" bind:value={session.state.draft} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void session.send(); } }}></textarea>
    <div class="repair-actions">{#if session.state.running}<button type="button" onclick={session.stop}>Stop</button>{:else}<button type="submit" disabled={!session.state.draft.trim()}>Send</button>{/if}</div>
  </form>
</section>
<style>
  :global(.extension-repair-popup) { position:fixed; right:24px; bottom:24px; width:min(420px,calc(100vw - 48px)); height:min(620px,calc(100vh - 88px)); z-index:70; -webkit-app-region:no-drag; }
  :global(.extension-repair-popup[hidden]) { display:none; }
  .repair-chat { height:100%; display:flex; flex-direction:column; min-height:0; background:var(--bg-panel); color:var(--tx); border-radius:var(--r-xl); box-shadow:var(--shadow-float); overflow:hidden; }
  header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; gap:12px; }
  header div { display:flex; flex-direction:column; min-width:0; gap:4px; }
  header span { color:var(--tx-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-sm); }
  header button { font-size:24px; width:32px; height:32px; color:var(--tx-3); }
  button { border-radius:var(--r-sm); padding:6px 12px; }
  button:focus-visible,textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .repair-transcript { flex:1; min-height:0; overflow:auto; padding:0 18px; overscroll-behavior:contain; }
  .repair-message { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.5; font-size:var(--fs-sm); margin:12px 0; }
  .repair-message.user { background:var(--bg-float); border-radius:var(--r-md); padding:12px; }
  .repair-activity { color:var(--tx-3); font-size:var(--fs-sm); }
  .repair-error { color:var(--danger, #f66); }
  .repair-connection button { background:var(--bg-float); }
  form { margin:12px; padding:10px; background:var(--bg-float); border-radius:var(--r-lg); }
  textarea { width:100%; box-sizing:border-box; resize:none; min-height:80px; max-height:180px; background:transparent; border:0; color:var(--tx); font:inherit; }
  .repair-actions { display:flex; justify-content:flex-end; }
  .repair-actions button { background:var(--accent); color:var(--on-accent); }
  button:disabled { opacity:.4; }
</style>

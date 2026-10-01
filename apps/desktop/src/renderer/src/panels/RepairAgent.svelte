<script lang="ts">
  import { onMount } from 'svelte';
  import ErrorNotice from '../errors/ErrorNotice.svelte';
  import Icon from './Icon.svelte';
  import AgentOptions from './agent/AgentOptions.svelte';
  import AttachmentChips from './agent/AttachmentChips.svelte';
  import Markdown from './agent/Markdown.svelte';
  import TextRow from './agent/TextRow.svelte';
  import ThoughtRow from './agent/ThoughtRow.svelte';
  import ToolActivity from './agent/ToolActivity.svelte';
  import Turn from './agent/Turn.svelte';
  import WorkingTimer from './agent/WorkingTimer.svelte';
  import { activityRows } from './agent/activity-rows';
  import type { AgentMessage } from './agent/agent-state.svelte';
  import { ATTACHMENT_HINT, readPromptAttachment } from './agent/attachments';
  import type { createRepairSession } from './repair-agent.svelte';

  /* The floating agent window, 1:1: its header, the thread bar, the
     transcript (Turn, the live activity rows, the working timer) and the
     composer with its options foot. Only the run is the repair session's,
     so nothing here touches the project agent's thread. */
  let { PM, name, session, onclose, onsettings }: {
    PM: Record<string, any>; name: string; session: ReturnType<typeof createRepairSession>;
    onclose: () => void; onsettings: () => void;
  } = $props();

  const repair = $derived(session.state);
  const rows = $derived(activityRows(repair.trace));
  const fallback = $derived(rows.length === 0 ? repair.activity : '');
  const streamingIndex = $derived(repair.running && rows.at(-1)?.kind === 'text' ? rows.length - 1 : -1);
  const answeringIndex = $derived(repair.running ? lastUserIndex(repair.messages) : -1);
  function lastUserIndex(messages: Array<{ role: string }>): number {
    for (let index = messages.length - 1; index >= 0; index--) if (messages[index]!.role === 'user') return index;
    return -1;
  }
  const sendable = $derived(repair.draft.trim().length > 0 || repair.attachments.length > 0);

  /* Window placement: bottom-right like the floating agent until moved. */
  const EDGE = 24, TOP = 52;
  let surface = $state<HTMLElement>();
  let position = $state<{ x: number; y: number } | null>(null);
  function clampTo(x: number, y: number): { x: number; y: number } {
    const width = surface?.offsetWidth ?? 400, height = surface?.offsetHeight ?? 620;
    return {
      x: Math.min(Math.max(x, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE)),
      y: Math.min(Math.max(y, TOP), Math.max(TOP, window.innerHeight - height - EDGE))
    };
  }
  let grab: { dx: number; dy: number } | null = null;
  function dragStart(event: PointerEvent): void {
    if (event.button !== 0 || !surface) return;
    const rect = surface.getBoundingClientRect();
    grab = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function dragMove(event: PointerEvent): void {
    if (grab) position = clampTo(event.clientX - grab.dx, event.clientY - grab.dy);
  }
  function dragKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move || !surface) return;
    event.preventDefault();
    const rect = surface.getBoundingClientRect();
    position = clampTo(rect.left + move[0], rect.top + move[1]);
  }
  onMount(() => {
    const keepInside = () => { if (position) position = clampTo(position.x, position.y); };
    window.addEventListener('resize', keepInside);
    return () => window.removeEventListener('resize', keepInside);
  });

  /* The transcript owns its scroll: pinned to the end while the reader is
     near it, with the agent panel's jump button otherwise. */
  let scroller = $state<HTMLDivElement>();
  let showJump = $state(false);
  let userScrolled = false;
  const distanceFromBottom = () => scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : 0;
  function onScroll(): void {
    showJump = distanceFromBottom() > 48;
    userScrolled = showJump;
  }
  function jumpToLatest(): void {
    userScrolled = false;
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  $effect(() => {
    void repair.messages.length; void repair.activity; void JSON.stringify(repair.trace);
    const el = scroller;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => {
      if (!userScrolled || distanceFromBottom() < 160) el.scrollTo?.({ top: el.scrollHeight });
    });
    return () => window.cancelAnimationFrame(frame);
  });

  let textarea = $state<HTMLTextAreaElement>();
  let fileInput: HTMLInputElement;
  let dragDepth = $state(0);
  function autosize(): void {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 140 ? 'auto' : 'hidden';
  }
  $effect(() => { void repair.draft; queueMicrotask(autosize); });

  async function addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      try { repair.attachments.push(await readPromptAttachment(file, PM.uid?.('attachment-') ?? `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`)); }
      catch (error) { PM.toast?.(error instanceof Error ? error.message : `Could not attach ${file.name}.`, 6000); }
    }
  }
  function submit(): void {
    if (!sendable || repair.running) return;
    void session.send();
    textarea?.focus();
  }
  function keydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); textarea?.blur(); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  }
  function paste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  }
  function drop(event: DragEvent): void {
    dragDepth = 0;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void addFiles(files);
  }
</script>

<section
  bind:this={surface}
  class="agent-floating-window repair-window"
  class:is-placed={!!position}
  style:left={position ? `${position.x}px` : undefined}
  style:top={position ? `${position.y}px` : undefined}
  aria-label={`Repair agent: ${name}`}
>
  <header class="agent-floating-header">
    <button class="agent-floating-drag" type="button" aria-label="Move repair window. Use arrow keys to move." title="Move repair window"
      onpointerdown={dragStart} onpointermove={dragMove} onpointerup={() => { grab = null; }} onpointercancel={() => { grab = null; }} onkeydown={dragKey}>
      <Icon {PM} name="grip" />
    </button>
    <span class="agent-floating-title">Repair extension</span>
    <span class="agent-floating-spacer"></span>
    <button class="agent-floating-control" type="button" aria-label="Close repair chat" title="Close" onclick={onclose}><Icon {PM} name="x" /></button>
  </header>

  <div class="agent-panel-body agent-shell" data-agent-panel data-agent-phase={repair.running ? 'running' : 'idle'}>
    <div class="repair-thread-bar" role="group" aria-label="Repair thread">
      <span class="repair-thread-title" title={name}>{name}</span>
      {#if repair.running}<span class="repair-thread-dot" aria-hidden="true"></span>{/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable transcript needs keyboard focus for text selection and scrolling.) -->
    <div
      class="agent-scroll repair-transcript"
      data-native-text
      tabindex="0"
      role="log"
      aria-label="Repair conversation"
      aria-live="polite"
      aria-atomic="false"
      bind:this={scroller}
      onscroll={onScroll}
      data-overflow-bottom={showJump ? '1' : '0'}
    >
      {#each repair.messages as message, index (`${message.role}-${index}`)}
        {#if message.role === 'assistant' && message.error}
          <div class="agent-msg assistant is-error repair-message">
            <ErrorNotice markdown error={message.text} live={Boolean(message.entering)} kind="alert">
              {#snippet actions()}
                <button type="button" class="btn" disabled={repair.running} onclick={session.retry}>Try again</button>
              {/snippet}
            </ErrorNotice>
          </div>
        {:else}
          <div class="repair-message" class:repair-turn={message.role !== 'trace'}>
            <Turn {PM} message={message as AgentMessage} messageIndex={index} answering={index === answeringIndex} />
          </div>
        {/if}
      {/each}
      {#if repair.startedAt !== null}<WorkingTimer startedAt={repair.startedAt} />{/if}
      {#if fallback}
        <div class="agent-trace">
          <p class="agent-trace-loading">
            <span class="agent-pixel-loader" aria-hidden="true">{#each Array(9) as _, cell (cell)}<i style="--cell-delay:{((cell % 3) + Math.abs(Math.floor(cell / 3) - 1)) * 90}ms"></i>{/each}</span>
            <span class="agent-trace-thought shimmer-text"><Markdown text={fallback} inline links={false} /></span>
          </p>
        </div>
      {:else if rows.length}
        <div class="agent-trace is-live">
          {#each rows as row, index (row.renderKey)}
            {#if row.kind === 'text'}
              <TextRow text={row.text} streaming={index === streamingIndex} animated />
            {:else if row.kind === 'thought'}
              <ThoughtRow text={row.text} streaming={repair.running && row.pulsing} animated />
            {:else if row.kind === 'tools'}
              <ToolActivity {row} animated live={repair.running && index === rows.length - 1} />
            {/if}
          {/each}
        </div>
      {/if}
      {#if repair.needsConnection}
        <div class="agent-msg assistant repair-connection">
          <div class="agent-reply"><p>Connect your agent to repair this extension.</p></div>
          <button type="button" class="btn" onclick={onsettings}>Connection Settings</button>
        </div>
      {/if}
    </div>

    <div class="agent-footer">
      {#if showJump}
        <button class="agent-jump" type="button" aria-label="Scroll to latest" onclick={jumpToLatest}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      {/if}
      <div
        class="agent-composer"
        class:is-dropping={dragDepth > 0}
        role="group"
        aria-label="Message composer"
        ondragenter={(event) => { event.preventDefault(); dragDepth += 1; }}
        ondragover={(event) => event.preventDefault()}
        ondragleave={() => { dragDepth = Math.max(0, dragDepth - 1); }}
        ondrop={drop}
      >
        <div class="agent-composer-field">
          {#if repair.attachments.length}
            <div class="agent-attachment-rail repair-attachments">
              <AttachmentChips {PM} items={repair.attachments} removable onRemove={(id) => { repair.attachments = repair.attachments.filter(item => item.id !== id); }} />
            </div>
          {/if}
          <div class="agent-input-row">
            <input hidden bind:this={fileInput} type="file" multiple onchange={() => { if (fileInput.files) void addFiles([...fileInput.files]); fileInput.value = ''; }} />
            <textarea
              bind:this={textarea}
              rows="1"
              aria-label="Message repair agent"
              placeholder={repair.running ? 'Working on the repair…' : 'Ask about this repair…'}
              title="Enter to send · Shift+Enter for a new line"
              bind:value={repair.draft}
              oninput={autosize}
              onkeydown={keydown}
              onpaste={paste}
            ></textarea>
          </div>
          <div class="agent-composer-actions">
            <button class="agent-round agent-attach" type="button" title={ATTACHMENT_HINT} aria-label="Add attachments" onclick={() => fileInput.click()}><Icon {PM} name="plus" /></button>
            <span class="sp"></span>
            {#if repair.running}
              <button class="agent-round agent-stop" type="button" aria-label="Stop repair" title="Stop repair" onclick={session.stop}><i aria-hidden="true"></i></button>
            {:else}
              <button class="agent-round agent-send" class:is-sendable={sendable} type="button" aria-label="Send message" title="Send message"
                disabled={!sendable} onpointerdown={event => event.preventDefault()} onclick={submit}><Icon {PM} name="return" /></button>
            {/if}
          </div>
        </div>
        <div class="agent-composer-foot">
          <AgentOptions {PM} />
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  :global(.extension-repair-popup[hidden]) { display: none; }
  /* agent-shell.css places the floating agent from script; this window sits
     where the floating agent opens until it is moved. */
  .repair-window { z-index: 70; right: 22px; bottom: 22px; -webkit-app-region: no-drag; }
  .repair-window.is-placed { right: auto; bottom: auto; }
  .repair-window .agent-panel-body { display: flex; flex: 1; min-height: 0; }
  /* ThreadPicker's bar, with the extension as the thread. */
  .repair-thread-bar { display: flex; align-items: center; gap: 6px; min-width: 0; height: 28px; margin: 6px 10px 0 18px; padding: 0 0 6px; flex-shrink: 0; color: var(--tx-2); font-size: var(--fs-sm); }
  .repair-thread-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .repair-thread-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--accent); }
  .repair-message { display: contents; }
  .repair-attachments { padding: 8px 8px 0; }
  .repair-connection { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .agent-composer textarea::placeholder { color: var(--tx-3); }
</style>

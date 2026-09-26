<script lang="ts">
  import Markdown from './Markdown.svelte';

  /* Reasoning the model narrated between calls. It stays inline, in stream
     order and quieter than the reply, the way Codex and Claude Code show it —
     not folded into a tool group as a "Thought for 1s" chip. */

  let { text, streaming = false, animated = false }: { text: string; streaming?: boolean; animated?: boolean } = $props();
</script>

<div class="agent-trace-prose agent-thought-prose"><Markdown {text} {streaming} {animated} paragraphClass="agent-trace-text" /></div>

<style>
  .agent-thought-prose { color: var(--tx-3); font-size: var(--fs-sm); line-height: 1.55; }
  .agent-thought-prose :global(.agent-md-h), .agent-thought-prose :global(.is-bold) { color: var(--tx-2); }
</style>

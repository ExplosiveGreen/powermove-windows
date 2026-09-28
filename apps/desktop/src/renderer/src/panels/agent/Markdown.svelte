<script lang="ts">
  import { blocksFromMarkdown, inlineRuns, wordsFromRuns, type Run } from './markdown';
  import { revealText } from './text-reveal';
  import { bridge } from '../../kernel/bridge';

  /* Agent prose as real elements: paragraphs, headings, lists, fenced code,
     quotes, with bold / italic / code / links inline. Words are spans so the
     reveal can stagger while streaming; the last block carries the caret.
     Blocks re-parse on every chunk and keep their keys, so an existing word
     never remounts when the stream extends the paragraph. */

  let {
    text,
    streaming = false,
    animated = false,
    paragraphClass = '',
    inline = false,
    links = true
  }: { text: string; streaming?: boolean; animated?: boolean; paragraphClass?: string; inline?: boolean; links?: boolean } = $props();

  const blocks = $derived(blocksFromMarkdown(text));
  const last = $derived(blocks.length - 1);

  function openLink(event: MouseEvent, href: string): void {
    event.preventDefault();
    void bridge()?.openExternal?.(href);
  }
</script>

{#snippet words(runs: Run[], live: boolean)}{#each wordsFromRuns(runs) as word (word.key)}{#if word.href && links}<a href={word.href} class="agent-md-link" class:is-bold={word.b} class:is-italic={word.i} class:is-struck={word.s} onclick={(event) => openLink(event, word.href!)}>{word.text}</a>{:else if word.c}<code class="agent-trace-code">{word.text}</code>{:else}<span use:revealText={animated && live && Boolean(word.text.trim())} class:is-bold={word.b} class:is-italic={word.i} class:is-struck={word.s}>{word.text}</span>{/if}{/each}{/snippet}

{#if inline}
  {@render words(inlineRuns(text), false)}
{:else}
{#each blocks as block, bi (bi)}
  {@const live = streaming && bi === last}
  {#if block.kind === 'p'}
    <p class="agent-md-p {paragraphClass}" class:is-streaming={live}>{@render words(block.runs, live)}</p>
  {:else if block.kind === 'h'}
    <p class="agent-md-h {paragraphClass}" class:is-streaming={live} data-level={block.level}>{@render words(block.runs, live)}</p>
  {:else if block.kind === 'li'}
    <div class="agent-md-li" class:is-streaming={live}>
      {#if block.ordinal !== undefined}<span class="agent-md-ordinal">{block.ordinal}.</span>{:else}<i class="agent-md-bullet" aria-hidden="true"></i>{/if}
      <p class="agent-md-p {paragraphClass}">{@render words(block.runs, live)}</p>
    </div>
  {:else if block.kind === 'quote'}
    <blockquote class="agent-md-quote" class:is-streaming={live}><p class="agent-md-p {paragraphClass}">{@render words(block.runs, live)}</p></blockquote>
  {:else if block.kind === 'hr'}
    <hr class="agent-md-rule" />
  {:else if block.kind === 'table'}
    <div class="agent-md-table-wrap"><table>
      <thead><tr>{#each block.headers as cell, ci}<th style:text-align={block.align[ci]}>{@render words(cell, false)}</th>{/each}</tr></thead>
      <tbody>{#each block.rows as row}<tr>{#each row as cell, ci}<td style:text-align={block.align[ci]}>{@render words(cell, false)}</td>{/each}</tr>{/each}</tbody>
    </table></div>
  {:else}
    <pre class="agent-md-pre" data-lang={block.lang}><code>{block.text}</code></pre>
  {/if}
{/each}
{/if}

<style>
  .agent-trace-code { border-radius: var(--r-xs); padding: 0 4px; background: var(--ink-1); font-family: var(--f-mono); font-size: .92em; box-decoration-break: clone; }
  :is(.agent-md-p, .agent-md-h, .agent-md-li, .agent-md-quote, .agent-md-pre) + :is(.agent-md-p, .agent-md-h, .agent-md-quote, .agent-md-pre) { margin-top: .65em; }
  .agent-md-p, .agent-md-h { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .agent-md-h { font-weight: var(--fw-semibold); color: var(--tx); }
  .agent-md-h[data-level="1"], .agent-md-h[data-level="2"] { font-size: 1.08em; }
  .is-bold { font-weight: var(--fw-semibold); }
  .is-struck { text-decoration: line-through; }
  .agent-md-rule { border: 0; border-top: 1px solid var(--line-2); margin: .8em 0; }
  .agent-md-table-wrap { max-width: 100%; overflow-x: auto; margin: .65em 0; }
  table { width: 100%; border-collapse: collapse; font: inherit; }
  th, td { padding: 6px 8px; border-bottom: 1px solid var(--line-2); text-align: left; overflow-wrap: anywhere; }
  th { font-weight: var(--fw-semibold); }
  .is-italic { font-style: italic; }
  .agent-md-li { display: flex; gap: 8px; min-width: 0; }
  .agent-md-li > p { flex: 1; min-width: 0; }
  .agent-md-ordinal { flex: none; min-width: 1.1em; color: var(--tx-3); text-align: right; font-variant-numeric: tabular-nums; }
  .agent-md-bullet { flex: none; width: 5px; height: 5px; margin-top: .62em; border-radius: 50%; background: var(--tx-3); }
  .agent-md-quote { margin: 0; padding-left: 10px; border-left: 2px solid var(--line-2); color: var(--tx-2); }
  .agent-md-pre {
    margin: 0; padding: 8px 10px; border-radius: var(--r-md);
    background: var(--ink-1); box-shadow: inset 0 0 0 var(--hairline) var(--line-2);
    color: var(--tx); font: var(--fs-sm)/1.55 var(--f-mono); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .agent-md-link { color: var(--accent-tx); text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 35%, transparent); text-underline-offset: 2px; transition: text-decoration-color var(--dur-1); }
  .agent-md-link:hover { text-decoration-color: currentColor; }
</style>

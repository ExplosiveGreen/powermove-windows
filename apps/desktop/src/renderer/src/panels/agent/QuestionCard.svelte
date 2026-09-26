<script lang="ts">
  import type { TraceStep } from './agent-state.svelte';

  /* A question from the agent, answered in place. `reply` questions hold the
     run open (it may keep working meanwhile); `message` questions were posted
     without waiting and are answered with a follow-up message. Options and a
     typed answer combine; nothing is sent until the person chooses Answer. */

  type QuestionStep = Extract<TraceStep, { kind: 'question' }>;
  let { PM, step }: { PM: Record<string, any>; step: QuestionStep } = $props();

  let chosen = $state<Record<string, string>>({});
  let typed = $state<Record<string, string>>({});

  const open = $derived(step.status === 'open');
  const answers = $derived(Object.fromEntries(step.questions.map(item => [
    item.id,
    [chosen[item.id], typed[item.id]?.trim()].filter((value): value is string => Boolean(value))
  ])));
  const answered = $derived(Object.values(answers).some(list => list.length > 0));

  function choose(id: string, label: string): void {
    chosen[id] = chosen[id] === label ? '' : label;
  }

  function submit(): void {
    if (!open || !answered) return;
    PM.AgentUI?.answerQuestion?.(step.id, answers);
  }

  function skip(): void {
    if (open) PM.AgentUI?.answerQuestion?.(step.id, {});
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
  }
</script>

<section class="agent-question" class:is-settled={!open} aria-label="Question from the agent">
  {#each step.questions as item (item.id)}
    <div class="agent-question-item">
      {#if item.header}<div class="agent-question-header">{item.header}</div>{/if}
      <p class="agent-question-text">{item.question}</p>
      {#if open}
        {#if item.options.length}
          <div class="agent-question-options" role="group" aria-label={item.question}>
            {#each item.options as option (option.label)}
              <button type="button" class="agent-question-option" class:is-chosen={chosen[item.id] === option.label}
                aria-pressed={chosen[item.id] === option.label} onclick={() => choose(item.id, option.label)}>
                <span>{option.label}</span>
                {#if option.description}<small>{option.description}</small>{/if}
              </button>
            {/each}
          </div>
        {/if}
        {#if item.allowOther}
          <input class="agent-question-input" type={item.secret ? 'password' : 'text'} autocomplete="off" spellcheck={!item.secret}
            placeholder={item.options.length ? 'Or type an answer' : 'Type an answer'} aria-label={`Answer: ${item.question}`}
            bind:value={typed[item.id]} onkeydown={keydown} />
        {/if}
      {:else if step.status === 'answered' && step.answers?.[item.id]}
        <p class="agent-question-answer">{step.answers[item.id]}</p>
      {:else}
        <p class="agent-question-answer is-missing">{step.status === 'answered' ? 'Skipped' : 'Not answered'}</p>
      {/if}
    </div>
  {/each}
  {#if open}
    <div class="agent-question-actions">
      {#if step.transport === 'reply'}<button type="button" class="agent-btn" onclick={skip}>Skip</button>{/if}
      <button type="button" class="agent-btn pri" disabled={!answered} onclick={submit}>Answer</button>
    </div>
  {/if}
</section>

<style>
  .agent-question { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 10px 12px; border-radius: var(--r-lg); background: var(--ink-1); }
  .agent-question.is-settled { gap: 8px; padding: 8px 12px; background: transparent; box-shadow: inset 2px 0 0 var(--line-2); border-radius: 0; }
  .agent-question-item { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .agent-question-header { color: var(--tx-4); font-size: var(--fs-xs); font-weight: var(--fw-medium); }
  .agent-question-text { margin: 0; color: var(--tx); font-size: var(--fs-md); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .is-settled .agent-question-text { color: var(--tx-2); font-size: var(--fs-sm); }
  .agent-question-options { display: flex; flex-direction: column; gap: 4px; }
  .agent-question-option {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; padding: 6px 9px;
    border-radius: var(--r-md); color: var(--tx-2); font-size: var(--fs-sm); text-align: left;
    transition: background var(--dur-1), color var(--dur-1);
  }
  .agent-question-option:hover { background: var(--ink-2); color: var(--tx); }
  .agent-question-option.is-chosen { background: var(--tx); color: var(--bg-panel); }
  .agent-question-option small { color: var(--tx-3); font-size: var(--fs-xs); line-height: 1.4; }
  .agent-question-option.is-chosen small { color: color-mix(in srgb, var(--bg-panel) 72%, transparent); }
  .agent-question-input {
    height: 28px; padding: 0 9px; border-radius: var(--r-md); background: var(--bg-panel);
    color: var(--tx); font-size: var(--fs-sm); box-shadow: inset 0 0 0 var(--hairline) var(--line-2);
  }
  .agent-question-input:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--accent); }
  .agent-question-actions { display: flex; justify-content: flex-end; gap: 6px; }
  .agent-question-actions .agent-btn:disabled { opacity: .45; pointer-events: none; }
  .agent-question-answer { margin: 0; color: var(--tx); font-size: var(--fs-sm); white-space: pre-wrap; overflow-wrap: anywhere; }
  .agent-question-answer.is-missing { color: var(--tx-4); }
</style>

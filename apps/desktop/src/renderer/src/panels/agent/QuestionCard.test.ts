// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QuestionCard from './QuestionCard.svelte';
import Turn from './Turn.svelte';
import type { TraceStep } from './agent-state.svelte';

type QuestionStep = Extract<TraceStep, { kind: 'question' }>;

let target: HTMLDivElement;
let instance: Record<string, any> | undefined;

const step = (overrides: Partial<QuestionStep> = {}): QuestionStep => ({
  kind: 'question', id: 'call_q', transport: 'reply', blocking: true, status: 'open',
  questions: [
    { id: 'layout', header: 'Layout', question: 'Stack or grid?', allowOther: true, secret: false,
      options: [{ label: 'Stack', description: 'One column' }, { label: 'Grid', description: '' }] },
    { id: 'token', header: '', question: 'API token?', allowOther: true, secret: true, options: [] }
  ],
  ...overrides
});

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (instance) unmount(instance);
  instance = undefined;
  target.remove();
});

describe('QuestionCard', () => {
  it('sends chosen options and typed answers only when the person chooses Answer', () => {
    const answerQuestion = vi.fn();
    instance = mount(QuestionCard, { target, props: { PM: { AgentUI: { answerQuestion } }, step: step() } });
    flushSync();

    const answer = [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Answer')!;
    expect(answer.disabled).toBe(true);
    target.querySelectorAll<HTMLButtonElement>('.agent-question-option')[1]!.click();
    flushSync();
    expect(answerQuestion).not.toHaveBeenCalled();

    const [, secret] = target.querySelectorAll<HTMLInputElement>('.agent-question-input');
    expect(secret!.type).toBe('password');
    secret!.value = 'sk-test';
    secret!.dispatchEvent(new Event('input'));
    flushSync();
    answer.click();
    expect(answerQuestion).toHaveBeenCalledWith('call_q', { layout: ['Grid'], token: ['sk-test'] });
  });

  it('lets a held question be skipped, but not one answered by message', () => {
    const answerQuestion = vi.fn();
    instance = mount(QuestionCard, { target, props: { PM: { AgentUI: { answerQuestion } }, step: step() } });
    flushSync();
    [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Skip')!.click();
    expect(answerQuestion).toHaveBeenCalledWith('call_q', {});
    unmount(instance);

    instance = mount(QuestionCard, { target, props: { PM: {}, step: step({ transport: 'message', blocking: false }) } });
    flushSync();
    expect([...target.querySelectorAll('button')].some(button => button.textContent === 'Skip')).toBe(false);
  });

  it('shows what was answered once settled', () => {
    instance = mount(QuestionCard, { target, props: { PM: {}, step: step({ status: 'answered', answers: { layout: 'Grid', token: '••••••' } }) } });
    flushSync();
    expect([...target.querySelectorAll('.agent-question-answer')].map(node => node.textContent)).toEqual(['Grid', '••••••']);
    expect(target.querySelector('input')).toBeNull();
  });

  it('keeps archived questions visible alongside the response', () => {
    instance = mount(Turn, { target, props: { PM: {}, message: { role: 'trace', steps: [
      { kind: 'tool', id: 't1', toolName: 'bash', label: 'Run', status: 'done' },
      { kind: 'thought', id: 'th', label: 'Checking the cut.', live: false },
      step({ status: 'closed' }),
      { kind: 'text', id: 'reply', text: 'Done.' }
    ] } } });
    flushSync();
    expect(target.querySelector('.agent-work-log')).toBeNull();
    expect(target.querySelector('.agent-thought-prose')?.textContent).toContain('Checking the cut.');
    expect(target.querySelector('.agent-question .agent-question-answer')?.textContent).toBe('Not answered');
  });
});


it('formats question prose, options, and settled answers', () => {
  const question = step({ questions: [{ id: 'style', header: '**Style**', question: 'Use **bold** or `code`?',
    allowOther: true, secret: false, options: [{ label: '**Bold**', description: 'A *strong* choice' }] }] });
  instance = mount(QuestionCard, { target, props: { PM: {}, step: question } });
  flushSync();
  expect(target.querySelector('.agent-question-text .is-bold')?.textContent).toBe('bold');
  expect(target.querySelector('.agent-question-option .is-italic')?.textContent).toBe('strong');
  unmount(instance);
  instance = mount(QuestionCard, { target, props: { PM: {}, step: { ...question, status: 'answered', answers: { style: '**Bold**' } } } });
  flushSync();
  expect(target.querySelector('.agent-question-answer .is-bold')?.textContent).toBe('Bold');
});

import { mount, flushSync } from 'svelte';
import RepairAgent from './RepairAgent.svelte';
import type { AgentMessage, TraceStep } from './agent/agent-state.svelte';
import type { PromptAttachment } from './agent/attachments';

export type RepairMessage = Pick<AgentMessage, 'role' | 'text' | 'steps' | 'durationMs' | 'entering' | 'error' | 'notice'> & {
  attachments?: PromptAttachment[];
};
export type RepairRunExtras = {
  attachments: PromptAttachment[];
  /** The run's activity trail so far, sealed when the run ends. */
  trace: (steps: TraceStep[]) => void;
};
export type RepairRun = (prompt: string, history: Array<{ role: 'user' | 'assistant'; text: string }>, signal: AbortSignal, progress: (text: string) => void, extras: RepairRunExtras) => Promise<string>;

/** Repair runs deliberately share neither AgentUI nor the project's thread
 * state. The transcript keeps the agent panel's message shapes (user,
 * archived trace, assistant) so the popup renders with the same parts. */
export function createRepairSession(run: RepairRun, connected: () => Promise<boolean>) {
  const state = $state({
    messages: [] as RepairMessage[], draft: '', attachments: [] as PromptAttachment[],
    running: false, startedAt: null as number | null, activity: '', trace: [] as TraceStep[],
    error: '', needsConnection: false
  });
  let controller: AbortController | null = null;
  const settle = () => setTimeout(() => { for (const message of state.messages) message.entering = false; });

  async function send() {
    const prompt = state.draft.trim();
    if ((!prompt && !state.attachments.length) || state.running) return;
    state.running = true; state.error = ''; state.needsConnection = false;
    const current = new AbortController(); controller = current;
    const attachments = state.attachments;
    try {
      if (!await connected()) { state.needsConnection = true; return; }
      if (current.signal.aborted) return;
      const history = state.messages
        .filter((message): message is RepairMessage & { role: 'user' | 'assistant' } => message.role !== 'trace' && !message.error)
        .map(message => ({ role: message.role, text: message.text || '' }));
      state.messages.push({ role: 'user', text: prompt, entering: true, ...(attachments.length ? { attachments: attachments.map(item => ({ ...item })) } : {}) });
      state.draft = ''; state.attachments = []; settle();
      state.startedAt = Date.now(); state.trace = [];
      state.activity = 'Inspecting the extension…';
      let reply = '';
      try {
        reply = await run(prompt, history, current.signal, text => {
          if (!current.signal.aborted) state.activity = text;
        }, {
          attachments: attachments.map(item => ({ ...item })),
          trace: steps => { if (!current.signal.aborted) state.trace = steps.filter(step => step.kind !== 'question'); }
        });
      } finally {
        archive(state.startedAt);
      }
      if (!current.signal.aborted) state.messages.push({ role: 'assistant', text: reply, entering: true });
    } catch (error) {
      if (!current.signal.aborted) {
        state.messages.push({ role: 'assistant', error: true, entering: true, text: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (controller === current) { state.running = false; state.activity = ''; state.startedAt = null; controller = null; }
      settle();
    }
  }

  /* The run's activity moves into the transcript; its prose is dropped
     because the reply that follows says the same thing. */
  function archive(startedAt: number | null) {
    const steps = state.trace.filter(step => step.kind !== 'text');
    state.trace = [];
    if (steps.length) state.messages.push({ role: 'trace', steps, ...(startedAt === null ? {} : { durationMs: Math.max(0, Date.now() - startedAt) }) });
  }

  /** Sends the request before a failed reply again. */
  function retry() {
    if (state.running) return;
    let index = state.messages.length - 1;
    while (index >= 0 && state.messages[index]!.role !== 'user') index--;
    if (index < 0) return;
    const request = state.messages[index]!;
    state.messages.splice(index);
    state.draft = request.text || '';
    state.attachments = request.attachments ?? [];
    void send();
  }

  return { state, send, retry, stop() { controller?.abort(); state.activity = 'Stopping…'; } };
}

const repairs = new Map<string, { element: HTMLElement; session: ReturnType<typeof createRepairSession> }>();
export function openRepairAgent(PM: Record<string, any>, options: { id: string; name: string; prompt: string; run: RepairRun; connected: () => Promise<boolean> }): boolean {
  let entry = repairs.get(options.id);
  for (const other of repairs.values()) other.element.hidden = true;
  if (!entry) {
    const element = document.createElement('div');
    element.className = 'extension-repair-popup';
    element.addEventListener('keydown', event => event.stopPropagation());
    const session = createRepairSession(options.run, options.connected);
    document.body.append(element);
    mount(RepairAgent, { target: element, props: { PM, name: options.name, session, onclose: () => { element.hidden = true; }, onsettings: () => PM.SettingsUI?.open?.('accounts') } });
    flushSync();
    entry = { element, session }; repairs.set(options.id, entry);
  }
  entry.element.hidden = false;
  if (!entry.session.state.running && !entry.session.state.messages.length) {
    entry.session.state.draft = options.prompt;
    void entry.session.send();
  }
  return true;
}

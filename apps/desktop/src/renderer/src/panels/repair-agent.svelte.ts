import { mount, flushSync } from 'svelte';
import RepairAgent from './RepairAgent.svelte';

export type RepairMessage = { role: 'user' | 'assistant'; text: string };
export type RepairRun = (prompt: string, history: RepairMessage[], signal: AbortSignal, progress: (text: string) => void) => Promise<string>;

/** Repair runs deliberately share neither AgentUI nor the project's thread state. */
export function createRepairSession(run: RepairRun, connected: () => Promise<boolean>) {
  const state = $state({ messages: [] as RepairMessage[], draft: '', running: false, activity: '', error: '', needsConnection: false });
  let controller: AbortController | null = null;
  async function send() {
    const prompt = state.draft.trim();
    if (!prompt || state.running) return;
    state.running = true; state.error = ''; state.needsConnection = false;
    const current = new AbortController(); controller = current;
    try {
      if (!await connected()) { state.needsConnection = true; return; }
      if (current.signal.aborted) return;
      const history = state.messages.map(message => ({ ...message }));
      state.messages.push({ role: 'user', text: prompt }); state.draft = '';
      state.activity = 'Inspecting the extension…';
      const reply = await run(prompt, history, current.signal, text => {
        if (!current.signal.aborted) state.activity = text;
      });
      if (!current.signal.aborted) state.messages.push({ role: 'assistant', text: reply });
    } catch (error) {
      if (!current.signal.aborted) { state.error = error instanceof Error ? error.message : String(error); state.draft ||= prompt; }
    } finally {
      if (controller === current) { state.running = false; state.activity = ''; controller = null; }
    }
  }
  return { state, send, stop() { controller?.abort(); state.activity = 'Stopping…'; } };
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
    mount(RepairAgent, { target: element, props: { name: options.name, session, onclose: () => { element.hidden = true; }, onsettings: () => PM.SettingsUI?.open?.('accounts') } });
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

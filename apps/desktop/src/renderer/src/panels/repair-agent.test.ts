// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createRepairSession, openRepairAgent } from './repair-agent.svelte';

describe('independent repair chat', () => {
  it('opens and runs without moving or updating the project agent', async () => {
    const project = document.createElement('div'); project.id = 'panel-agent';
    const dock = document.createElement('div'); dock.append(project); document.body.append(dock);
    const PM = { AgentUI: { update: vi.fn(), setDraft: vi.fn() }, AgentShell: { openGlobal: vi.fn() } };
    const run = vi.fn(async () => 'Fixed `test-independent`. **Sandbox check passed.**');
    openRepairAgent(PM, { id: 'test-independent', name: 'Test', prompt: 'Fix it', connected: async () => true, run });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.querySelector('.repair-message code')?.textContent).toBe('test-independent'));
    expect(document.querySelector('.repair-transcript')?.textContent).not.toContain('**');
    expect(project.parentElement).toBe(dock);
    expect(PM.AgentUI.update).not.toHaveBeenCalled();
    expect(PM.AgentUI.setDraft).not.toHaveBeenCalled();
    expect(PM.AgentShell.openGlobal).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[aria-label="Close repair chat"]')!.click();
    expect(project.parentElement).toBe(dock);
    expect(document.querySelector<HTMLElement>('.extension-repair-popup')!.hidden).toBe(true);
  });

  it('keeps independent drafts and runs when another repair is stopped', async () => {
    let resolve!: (value: string) => void;
    let signal!: AbortSignal;
    const a = createRepairSession(async (_p, _h, s) => { signal = s; return new Promise(r => { resolve = r; }); }, async () => true);
    const b = createRepairSession(async () => 'Second result', async () => true);
    a.state.draft = 'First'; b.state.draft = 'Second';
    const pending = a.send(); await Promise.resolve();
    await b.send();
    expect(a.state.running).toBe(true);
    expect(b.state.messages.at(-1)?.text).toBe('Second result');
    a.stop(); expect(signal.aborted).toBe(true);
    resolve('Late result'); await pending;
    expect(a.state.messages.some(m => m.text === 'Late result')).toBe(false);
    expect(b.state.messages).toHaveLength(2);
  });

  it('preserves the draft while disconnected without submitting', async () => {
    const run = vi.fn(async () => 'Done');
    const session = createRepairSession(run, async () => false);
    session.state.draft = 'Repair my extension'; await session.send();
    expect(session.state.needsConnection).toBe(true);
    expect(session.state.draft).toBe('Repair my extension');
    expect(run).not.toHaveBeenCalled();
  });
});

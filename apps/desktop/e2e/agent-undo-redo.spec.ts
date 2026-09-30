import { expect, test } from './helpers/app';

test('selecting a layer after Undo keeps the completed agent run available to Redo', async ({ session }) => {
  await session.openEditor();
  const restored = await session.page.evaluate(async () => {
    const PM = (window as any).PM;
    PM.Edit.apply({ type: 'add_layer', id: 'existing-layer', layerType: 'shape' });
    const baseRevision = PM.proj.revision || 0;
    const call = (tool: string, args = {}) => PM.AgentHarness.test.handleLiveAgentTool({
      runId: 'undo-redo-e2e', callId: tool, tool, arguments: args, baseRevision,
    });
    await call('apply_commands', { commands: [{ type: 'add_layer', id: 'agent-title', layerType: 'text', content: { text: 'Keep me' } }] });
    await call('__finish_run', { commit: true });
    PM.hist.undo();
    const undone = !PM.L('agent-title');
    PM.selectLayers(['existing-layer']);
    const redone = PM.hist.redo() && PM.L('agent-title')?.d.text === 'Keep me';
    return { undone, redone, selection: PM.sel.layers };
  });
  expect(restored).toEqual({ undone: true, redone: true, selection: ['existing-layer'] });
});

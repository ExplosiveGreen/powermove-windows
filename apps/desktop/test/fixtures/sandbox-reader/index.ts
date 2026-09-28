import type { PowermoveAPI } from 'powermove';

/* Reads the whole project on every change, the heaviest ordinary pattern. The
   e2e installs several copies: one edit must still cost one snapshot build. */
export default function activate(api: PowermoveAPI) {
  const state = { changes: 0, reads: 0, errors: 0, layers: -1, revision: -1, error: '' };
  api.events.on('project:changed', async () => {
    state.changes += 1;
    try {
      const project = await api.project.get();
      state.reads += 1;
      state.layers = project.layers.length;
      state.revision = project.revision;
    } catch (error) {
      state.errors += 1;
      state.error = String((error as Error)?.message ?? error);
    }
  });
  api.commands.register({ id: `${api.id}.report`, label: 'Report reads', run: () => ({ ...state }) });
}

import type { PowermoveAPI } from 'powermove';
import Panel from './Panel.svelte';

/* Test fixture for the Svelte module surface: its panel reaches every runtime
   entry an extension may import, so it only works when each one resolves to
   the host's single Svelte. The named exports let unit tests drive it. */
export { Panel };
export { bell } from './bell';
export { counter } from './counter.svelte';

export default function activate(api: PowermoveAPI) {
  api.panels.register({ id: `${api.id}.panel`, title: 'Svelte surface', component: Panel });
}

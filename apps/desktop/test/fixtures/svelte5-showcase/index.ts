import type { PowermoveAPI } from 'powermove';
import Panel from './Panel.svelte';

/*
 * A Svelte 5 extension written the way an author would: a layer outline with
 * a live timecode, pins shared through a rune module, motion and transitions,
 * and a status item. It must behave the same in the editor (local install)
 * and in the sandbox (Store install); e2e/svelte5-showcase.spec.ts runs both.
 */
export default function activate(api: PowermoveAPI) {
  api.panels.register({ id: `${api.id}.panel`, title: 'Outline', icon: 'layers', size: 260, component: Panel });
  // Polled by the status bar; reads here are plain values, not subscriptions.
  api.status.register({ id: `${api.id}.status`, text: () => `Outline · revision ${api.project.revision()}` });
}

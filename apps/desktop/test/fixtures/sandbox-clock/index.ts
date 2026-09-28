import type { PowermoveAPI } from 'powermove';

/* Follows the playhead through `time` events, which need no permission and
   must never cause a project snapshot. */
export default function activate(api: PowermoveAPI) {
  const state = { times: 0, last: -1, transports: 0, playing: false };
  api.events.on('time', (time) => { state.times += 1; state.last = time; });
  api.events.on('transport', ({ playing }) => { state.transports += 1; state.playing = playing; });
  api.commands.register({ id: `${api.id}.report`, label: 'Report clock', run: () => ({ ...state }) });
}

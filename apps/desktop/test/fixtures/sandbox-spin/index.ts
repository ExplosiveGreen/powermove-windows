import type { PowermoveAPI } from 'powermove';

/* Isolation fixture. The e2e installs it twice: one copy is told to spin and
   must be killed by the watchdog, the other must keep answering `ping`. The
   spin is armed by a command, not a timer, so the spec can record pids and
   start measuring editor frames first; it starts after the reply has gone. */
export default function activate(api: PowermoveAPI) {
  let pings = 0;
  api.commands.register({ id: `${api.id}.ping`, label: 'Ping', run: () => ++pings });
  api.commands.register({ id: `${api.id}.spin`, label: 'Spin forever', run: () => {
    setTimeout(() => { for (;;) { /* never yields: only killing the process stops this */ } }, 50);
    return 'spinning';
  } });
  api.status.register({ id: `${api.id}.status`, text: () => `${api.id} ${pings}` });
}

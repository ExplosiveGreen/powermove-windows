import type { PowermoveAPI } from 'powermove';

/* A hello-world Store extension: a command, a status item and a panel, no
   permissions and no project reads. Playback must cost it nothing. */
export default function activate(api: PowermoveAPI) {
  let runs = 0;
  api.commands.register({ id: `${api.id}.hello`, label: 'Say hello', run: () => ++runs });
  api.status.register({ id: `${api.id}.status`, text: () => 'Hello' });
  api.panels.register({ id: `${api.id}.panel`, title: 'Hello', icon: 'puzzle', size: 200, build: (body) => {
    const text = document.createElement('p');
    text.textContent = 'Hello from a Store extension';
    body.append(text);
  } });
}

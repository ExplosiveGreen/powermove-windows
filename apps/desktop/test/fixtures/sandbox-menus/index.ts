import type { PowermoveAPI } from 'powermove';

/* A layer context-menu item whose label names no layer: only the action
   knows which layer the open was for. It answers after a short wait, as a
   sandbox that does some work before it replies would. */
export default function activate(api: PowermoveAPI) {
  const marked: string[] = [];
  api.menus.contribute('layer:context', async (ctx) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    const layerId = String(ctx.layerId);
    return [{ label: 'Mark this layer', run: () => { marked.push(layerId); } }];
  });
  api.commands.register({ id: `${api.id}.marked`, label: 'Marked layers', run: () => [...marked] });
}

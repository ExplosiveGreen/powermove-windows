/* After an update, the first window to boot shows the release notes since
   the version the user last ran (see main/whats-new.ts). Closing the dialog
   marks them seen; the notes come from the GitHub releases. */
import { flushSync, mount, unmount } from 'svelte';

import type { WhatsNew as WhatsNewNotes } from '../../../shared/ipc';
import type { PMRegistry } from '../legacy/registry';
import { bridge } from '../kernel/bridge';
import WhatsNew from './WhatsNew.svelte';

const RELEASES = 'https://github.com/iterative-computer/powermove/releases';

export function showWhatsNew(PM: PMRegistry, notes: WhatsNewNotes): void {
  const modal = PM.modal as ((options: object) => { el: HTMLElement; close(): void }) | undefined;
  if (typeof modal !== 'function') return;
  const body = document.createElement('div');
  let component: ReturnType<typeof mount> | null = null;
  const handle = modal({
    title: `What’s new in Powermove ${notes.current}`,
    body,
    width: 520,
    actions: [
      { label: 'View on GitHub', run: () => { void bridge()?.openExternal?.(notes.releases[0]?.url ?? RELEASES); } },
      { label: 'Continue', pri: true }
    ],
    onClose: () => {
      if (component) void unmount(component);
      component = null;
      void bridge()?.whatsNew?.seen().catch(() => undefined);
    }
  });
  handle.el.classList.add('whats-new-modal');
  component = mount(WhatsNew, { target: body, props: { notes } });
  flushSync();
}

export async function installWhatsNew(PM: PMRegistry): Promise<void> {
  const notes = await bridge()?.whatsNew?.pending().catch(() => null);
  if (notes?.releases.length) showWhatsNew(PM, notes);
}

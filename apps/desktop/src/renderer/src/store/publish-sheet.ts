/* Opens the publish sheet over the Store (via PM.modal), one at a time. The
   sheet opens on click with a preparing state; the plan comes from main
   (`store:publish-prepare`) and fills it in. The sheet only fills in the
   form, and main shows the native confirmation. */
import { flushSync, mount, unmount } from 'svelte';

import type { PublishPlanDto, StorePublishResult } from '../../../shared/publish';
import type { StoreBridge } from '../../../shared/store-ipc';
import type { ModalHandle, ModalOptions } from '../overlays/types';
import type { StorePM } from './data';
import PublishPreparing from './PublishPreparing.svelte';
import PublishSheet from './PublishSheet.svelte';
import { checkInSandbox, sandboxCheckLines, type SandboxCheckReport } from './sandbox-check';

let open: { localId: string; close(): void } | null = null;

export type PendingPublishSheet = {
  /** Swap the preparing state for the form. A no-op once the sheet was closed. */
  ready(plan: PublishPlanDto): void;
  close(): void;
  readonly closed: boolean;
};

export function openPublishSheet(
  PM: StorePM,
  bridge: StoreBridge,
  item: { localId: string; name: string },
  onpublished: (result: Extract<StorePublishResult, { published: true }>) => void
): PendingPublishSheet | null {
  const modal: ((options: ModalOptions) => ModalHandle) | undefined = PM.modal;
  if (!modal) return null;
  open?.close();
  const body = document.createElement('div');
  let component: ReturnType<typeof mount> | null = null;
  let closed = false;
  const handle = modal({
    body,
    width: 580,
    actions: [],
    onClose: () => {
      closed = true;
      if (component) void unmount(component);
      component = null;
      if (open === current) open = null;
    }
  });
  handle.el.classList.add('publish-modal');
  const current = { localId: item.localId, close: () => handle.close() };
  open = current;
  const onclose = () => handle.close();
  try {
    component = mount(PublishPreparing, { target: body, props: { name: item.name, onclose } });
    flushSync();
  } catch (error) {
    handle.close();
    throw error;
  }

  /* The sandbox check needs only the local extension, so it runs while main
     prepares; the sheet's first check picks it up and Check Again runs fresh. */
  let early: Promise<SandboxCheckReport> | null = checkInSandbox(PM, item.localId);
  early.catch(() => {});
  const check = (): Promise<SandboxCheckReport> => {
    const pending = early;
    early = null;
    return pending ?? checkInSandbox(PM, item.localId);
  };

  return {
    get closed() { return closed; },
    close: onclose,
    ready(plan) {
      if (closed) return;
      if (component) void unmount(component);
      component = null;
      try {
        component = mount(PublishSheet, {
          target: body,
          props: { plan, bridge, check, onclose, onpublished,
            onfix: async (report) => Boolean(await PM.AgentUI?.repairExtension?.({ id: plan.localId, name: plan.manifest.name, diagnostics: sandboxCheckLines(report) }))
          }
        });
        flushSync();
      } catch (error) {
        // A failed mount must not leave an empty modal and its scrim behind.
        handle.close();
        throw error;
      }
    }
  };
}

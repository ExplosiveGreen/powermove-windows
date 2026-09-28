/*
 * The Svelte half of `__powermove_runtime`, shared by the editor window
 * (runtime-globals.ts) and the extension sandbox document (sandbox/boot.ts).
 * `svelte/internal/disclose-version` is absent on purpose: compiled components
 * import it only for its side effect, and the compiler shims it as `export {}`.
 *
 * Every entry is a static namespace import of the package the document already
 * runs, so Vite bundles exactly ONE copy of Svelte per document and extension
 * components join the host's reactivity graph (a second copy would mean
 * effects that never run, transitions on a scheduler nobody flushes).
 */
import * as svelte from 'svelte';
import * as animate from 'svelte/animate';
import * as attachments from 'svelte/attachments';
import * as easing from 'svelte/easing';
import * as events from 'svelte/events';
/* `svelte/internal/client` ships no declaration file. Compiled components
   call into it; nothing here does, so the missing types cost us nothing. */
// @ts-expect-error -- untyped Svelte internal entrypoint
import * as internalClient from 'svelte/internal/client';
import * as motion from 'svelte/motion';
import * as reactivity from 'svelte/reactivity';
import * as reactivityWindow from 'svelte/reactivity/window';
import * as store from 'svelte/store';
import * as transition from 'svelte/transition';
import type { SvelteRuntimeModule } from '../../../shared/extension-runtime';

export const svelteRuntime = {
  svelte,
  'svelte/animate': animate,
  'svelte/attachments': attachments,
  'svelte/easing': easing,
  'svelte/events': events,
  'svelte/internal/client': internalClient as Record<string, unknown>,
  'svelte/motion': motion,
  'svelte/reactivity': reactivity,
  'svelte/reactivity/window': reactivityWindow,
  'svelte/store': store,
  'svelte/transition': transition
} satisfies Record<SvelteRuntimeModule, object>;

export type SvelteRuntime = typeof svelteRuntime;

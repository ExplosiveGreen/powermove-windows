/*
 * Shared runtime for extension bundles.
 *
 * Main compiles user/project extensions with every `svelte` import pointed at
 * `globalThis.__powermove_runtime`, so their bundles resolve those specifiers
 * at load time against the table installed here: the host's own Svelte (see
 * svelte-runtime.ts) plus the `powermove` editor helpers.
 */
import * as editorHelpers from './editor-helpers';
import * as svelte from 'svelte';
import { svelteRuntime, type SvelteRuntime } from './svelte-runtime';
import type { Component } from 'svelte';

export interface PowermoveRuntime extends SvelteRuntime {
  powermove: typeof editorHelpers;
}

declare global {
  // eslint-disable-next-line no-var
  var __powermove_runtime: PowermoveRuntime | undefined;
}

export const RUNTIME_GLOBAL = '__powermove_runtime' as const;

export function installRuntimeGlobals(): PowermoveRuntime {
  const runtime: PowermoveRuntime = { ...svelteRuntime, powermove: editorHelpers };
  globalThis.__powermove_runtime = runtime;
  return runtime;
}

export function runtimeGlobals(): PowermoveRuntime | undefined {
  return globalThis.__powermove_runtime;
}

/**
 * Mount a Svelte component and return its disposer. Effects are flushed
 * synchronously so callers (panel `build`, overlays) can read the DOM straight
 * after mounting — the same contract `registerSveltePanel` relies on.
 */
export function mountComponent<P extends Record<string, unknown>>(component: Component<P>, target: HTMLElement, props: P): () => void {
  const instance = svelte.mount(component, { target, props });
  svelte.flushSync();
  let unmounted = false;
  return () => {
    if (unmounted) return;
    unmounted = true;
    void svelte.unmount(instance);
  };
}

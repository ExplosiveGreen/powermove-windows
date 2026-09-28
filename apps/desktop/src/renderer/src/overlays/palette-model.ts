import type { OverlayPM } from './types';

export type PaletteEntry = {
  id: string;
  label: string;
  cat: string;
  kb?: string | null;
  run(): unknown;
};

/** The legacy matcher is case-insensitive trimmed substring matching. The
 * numeric result makes that contract testable without changing legacy order. */
export function scorePaletteMatch(value: unknown, query: unknown): number | null {
  const needle = String(query ?? '').toLowerCase().trim();
  if (!needle) return 0;
  const index = String(value ?? '').toLowerCase().indexOf(needle);
  return index < 0 ? null : index;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof (value as { then?: unknown }).then === 'function';

/**
 * The palette's rows for one query, in legacy order and capped at 60.
 * Asynchronous answers (sandboxed providers and command `when`s) are left
 * out of the returned list; as each settles, `onLate` gets the whole list
 * again with it in place. A caller keeps those only while it still shows
 * `query`.
 */
export function paletteEntries(PM: OverlayPM, query: string, onLate?: (entries: PaletteEntry[]) => void): PaletteEntry[] {
  const hasQuery = query.toLowerCase().trim().length > 0;
  const matches = (value: unknown): boolean => scorePaletteMatch(value, query) != null;
  /* Rows in order, a run of them per part; a part still answering is a Promise. */
  const parts: Array<PaletteEntry[] | PromiseLike<PaletteEntry[]>> = [];
  let entries: PaletteEntry[] = [];
  parts.push(entries);
  const later = (answer: PromiseLike<PaletteEntry[]>): void => {
    parts.push(answer);
    entries = [];
    parts.push(entries);
  };
  for (const command of Object.values(PM.commands ?? {}) as Array<Record<string, any>>) {
    if (hasQuery && !matches(command.label)) continue;
    const entry: PaletteEntry = {
      id: `command:${command.id}`,
      label: String(command.label),
      cat: String(command.cat ?? 'General'),
      kb: command.kb,
      run: () => PM.cmd(command.id)
    };
    /* `when` is the kernel's "runnable by id, but not offered here" flag. */
    const shown = typeof command.when === 'function' ? command.when() : true;
    if (isThenable(shown)) later(Promise.resolve(shown).then(value => value ? [entry] : [], () => []));
    else if (shown) entries.push(entry);
  }
  for (const layer of PM.proj?.layers ?? []) {
    if (hasQuery && matches(layer.name)) {
      entries.push({
        id: `layer:${layer.id}`,
        label: String(layer.name),
        cat: 'Layer',
        run: () => PM.selectLayers(layer.id)
      });
    }
  }
  for (const workspace of PM.WS?.list?.() ?? []) {
    if (!hasQuery || matches(workspace.name)) {
      entries.push({
        id: `workspace:${workspace.id}`,
        label: `Workspace · ${workspace.name}`,
        cat: 'Workspace',
        run: () => PM.WS.activate(workspace.id)
      });
    }
  }
  for (const [key, definition] of Object.entries(PM.FX ?? {}) as Array<[string, Record<string, any>]>) {
    if (hasQuery && matches(definition.label)) {
      entries.push({
        id: `effect:${key}`,
        label: `Effect · ${definition.label}`,
        cat: 'Effect',
        run: () => {
          const layer = PM.firstSel();
          if (layer) {
            return PM.Edit.apply(
              { type: 'add_effect', target: layer.id, effect: key },
              { label: `Add ${definition.label}`, origin: 'command-palette' }
            );
          }
        }
      });
    }
  }
  /* Extension-contributed entries come last and share the same 60-item cap.
     Providers do their own matching — the raw query is passed straight through. */
  const providers = (PM as Record<string, any>).Kernel?.paletteProviders?.() ?? [];
  for (const { provider } of providers as Array<{ provider: (q: string) => unknown }>) {
    let produced: unknown;
    try {
      produced = provider(query);
    } catch (error) {
      console.error('[palette] provider failed', error);
      continue;
    }
    if (isThenable(produced)) {
      later(Promise.resolve(produced).then(providerEntries, error => {
        console.error('[palette] provider failed', error);
        return [];
      }));
    } else entries.push(...providerEntries(produced));
  }
  const assemble = (): PaletteEntry[] => parts.flatMap(part => Array.isArray(part) ? part : []).slice(0, 60);
  parts.forEach((part, index) => {
    if (Array.isArray(part)) return;
    void Promise.resolve(part).then(settled => {
      parts[index] = settled;
      onLate?.(assemble());
    });
  });
  return assemble();
}

function providerEntries(produced: unknown): PaletteEntry[] {
  if (!Array.isArray(produced)) return [];
  const out: PaletteEntry[] = [];
  for (const item of produced as Array<Record<string, any>>) {
    if (!item || typeof item.run !== 'function') continue;
    out.push({
      id: String(item.id ?? `provider:${out.length}`),
      label: String(item.label ?? ''),
      cat: String(item.category ?? 'Extension'),
      kb: item.kb ?? null,
      run: () => item.run()
    });
  }
  return out;
}

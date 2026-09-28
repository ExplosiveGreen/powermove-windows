/*
 * The project as sandboxed extensions read it (sandbox data plane, design §3).
 *
 * One ProjectSnapshots per kernel, shared by every sandboxed runtime and view
 * in the window. Documents pull (`project-snapshot`); nothing is pushed. The
 * JSON is built lazily, at most once per generation, with native
 * JSON.stringify over a sanitized shallow view of the live project: the big
 * subtrees (layers) are not walked in JS, and N extensions reading after one
 * change cost one build.
 */
import type { Kernel } from './registries';

export interface ProjectSource { get(): unknown; revision(): number; selection?(): unknown }
export type ProjectSnapshot = { generation: number; json: string } | { generation: number; tooLarge: true };
/** The selection as documents hold it (a plain copy) and its JSON, to compare by. */
export interface SharedSelection { value: unknown; json: string }
/** In JSON characters. */
export const SNAPSHOT_LIMIT = 8 * 1024 * 1024;

export interface SandboxStats { snapshotBuilds: number; snapshotMs: number; ticks: number; selectionBuilds: number }
/** Host-side counters for tests and profiling (`globalThis.__powermoveSandboxStats`). */
export function sandboxStats(): SandboxStats {
  const scope = globalThis as { __powermoveSandboxStats?: SandboxStats };
  return scope.__powermoveSandboxStats ??= { snapshotBuilds: 0, snapshotMs: 0, ticks: 0, selectionBuilds: 0 };
}

const ASSET_KEYS = /blob|source/i;
const SECRET_KEYS = /token|secret|password|key$/i;

/**
 * A structured-clone and JSON-safe deep copy: functions drop out, Maps and
 * Sets become arrays, Dates ISO strings, and keys matching `drop` are removed
 * at any depth. Shared references stay shared.
 */
export function plain(value: unknown, drop?: RegExp, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map || value instanceof Set) {
    const entries: unknown[] = [];
    seen.set(value, entries);
    if (value instanceof Map) for (const [key, item] of value) entries.push([plain(key, drop, seen), plain(item, drop, seen)]);
    else for (const item of value) entries.push(plain(item, drop, seen));
    return entries;
  }
  const target: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, target);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' || drop && !Array.isArray(value) && drop.test(key)) continue;
    (target as Record<string, unknown>)[key] = plain(item, drop, seen);
  }
  return target;
}

/* Asset ids are keys of the map and never redacted; each asset drops its
   source paths and blob handles at any depth. */
const assetMap = (assets: unknown): unknown => {
  if (!assets || typeof assets !== 'object') return plain(assets);
  if (Array.isArray(assets)) return assets.map(asset => plain(asset, ASSET_KEYS));
  return Object.fromEntries(Object.entries(assets).filter(([, asset]) => typeof asset !== 'function').map(([id, asset]) => [id, plain(asset, ASSET_KEYS)]));
};

/**
 * The project as sandboxes see it, sharing everything it does not rewrite
 * with the live project. `edits` (the edit log) is omitted; `assets`,
 * `library` and `notes` are redacted copies; each comp gets the same rules.
 */
export function sanitizeProject(project: unknown, depth = 0): unknown {
  if (!project || typeof project !== 'object' || Array.isArray(project) || depth > 32) return plain(project);
  const view: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (key === 'edits' || typeof value === 'function') continue;
    view[key] = key === 'assets' ? assetMap(value)
      : key === 'library' || key === 'notes' ? plain(value, SECRET_KEYS)
      : key === 'comps' && value && typeof value === 'object' ? Array.isArray(value) ? value.map(comp => sanitizeProject(comp, depth + 1))
        : Object.fromEntries(Object.entries(value).filter(([, comp]) => typeof comp !== 'function').map(([id, comp]) => [id, sanitizeProject(comp, depth + 1)]))
      : value;
  }
  return view;
}

export class ProjectSnapshots {
  private counter = 0;
  private seen: { project: unknown; revision: number } | null = null;
  private built: ProjectSnapshot | null = null;
  private selected: { project: unknown; revision: number; selection: SharedSelection } | null = null;
  constructor(private readonly source: ProjectSource, private readonly limit = SNAPSHOT_LIMIT) {}
  /** Advances on every kernel `project:changed`, and when the project object or its revision is not the one last seen. */
  get generation(): number {
    const project = this.source.get(), revision = this.source.revision();
    if (!this.seen || this.seen.project !== project || this.seen.revision !== revision) { this.seen = { project, revision }; this.counter += 1; }
    return this.counter;
  }
  /** A kernel `project:changed`, of any kind. */
  changed(): void { this.counter += 1; this.selected = null; }
  /** A kernel `selection`. */
  selectionChanged(): void { this.selected = null; }
  /**
   * The selection every document in the window is told, copied and
   * stringified once after each kernel `selection` or `project:changed`, or
   * when the project object or its revision moved; between those (playback
   * frames) it costs two source reads, whatever its size.
   */
  selection(): SharedSelection {
    const project = this.source.get(), revision = this.source.revision();
    const held = this.selected;
    if (held && held.project === project && held.revision === revision) return held.selection;
    const value = plain(this.source.selection?.() ?? null);
    sandboxStats().selectionBuilds += 1;
    this.selected = { project, revision, selection: { value, json: JSON.stringify(value) ?? 'null' } };
    return this.selected.selection;
  }
  read(): ProjectSnapshot {
    const generation = this.generation;
    if (this.built?.generation === generation) return this.built;
    const stats = sandboxStats();
    const start = performance.now();
    const json = JSON.stringify(sanitizeProject(this.source.get())) ?? 'null';
    stats.snapshotBuilds += 1; stats.snapshotMs += performance.now() - start;
    this.built = json.length > this.limit ? { generation, tooLarge: true } : { generation, json };
    return this.built;
  }
}

const perKernel = new WeakMap<Kernel, ProjectSnapshots>();
/** The kernel's snapshots. Every host dep in a window reads the same live project, so the first source is the one kept. */
export function projectSnapshots(kernel: Kernel, source: ProjectSource): ProjectSnapshots {
  let snapshots = perKernel.get(kernel);
  if (!snapshots) {
    const created = snapshots = new ProjectSnapshots(source);
    kernel.events.on('project:changed', () => created.changed());
    kernel.events.on('selection', () => created.selectionChanged());
    perKernel.set(kernel, snapshots);
  }
  return snapshots;
}

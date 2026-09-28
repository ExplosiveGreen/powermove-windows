import { expect, it } from 'vitest';
import { syntheticProject } from './__fixtures__/synthetic-project';
import { plain, ProjectSnapshots, projectSnapshots, sandboxStats, sanitizeProject } from './project-snapshots';
import { createKernel } from './registries';

it('redacts asset sources and secret-shaped fields, drops the edit log, and leaves the source alone', () => {
  const shared = { blob: 'private bytes', sourcePath: '/private/file', name: 'safe' };
  const project = { loose: shared, edits: [{ label: 'private' }], run: () => 1, assets: { a: shared },
    comps: { nested: { edits: [], assets: { a: shared }, library: { accessToken: 'secret', title: 'nested' }, notes: { password: 'secret', body: 'safe' } } },
    library: { token: 'secret', nested: { apiKey: 'secret', title: 'safe', list: [{ secret: 'x', ok: 1 }] } }, notes: { password: 'secret', body: 'safe' } };
  expect(JSON.parse(JSON.stringify(sanitizeProject(project)))).toEqual({ loose: shared, assets: { a: { name: 'safe' } },
    comps: { nested: { assets: { a: { name: 'safe' } }, library: { title: 'nested' }, notes: { body: 'safe' } } },
    library: { nested: { title: 'safe', list: [{ ok: 1 }] } }, notes: { body: 'safe' } });
  expect(project.library.token).toBe('secret');
  expect(project.edits).toHaveLength(1);
  // Everything the rules do not rewrite is the live object, not a copy: no JS walk over the big subtrees.
  const layers = [{ id: 'l1' }];
  expect((sanitizeProject({ layers }) as { layers: unknown }).layers).toBe(layers);
});

it('copies plain data: Maps and Sets become arrays, functions drop out, shared references stay shared', () => {
  const inner = { x: 1 };
  expect(plain({ map: new Map([['k', inner]]), set: new Set([1]), fn: () => 1, a: inner, b: inner, at: new Date(0) }))
    .toEqual({ map: [['k', { x: 1 }]], set: [1], a: { x: 1 }, b: { x: 1 }, at: '1970-01-01T00:00:00.000Z' });
  const copy = plain({ a: inner, b: inner }) as { a: unknown; b: unknown };
  expect(copy.a).toBe(copy.b);
});

it('builds once per generation and advances on changes, revisions and a replaced project', () => {
  let project: Record<string, unknown> = { revision: 1, layers: [] };
  const snapshots = new ProjectSnapshots({ get: () => project, revision: () => Number(project.revision) });
  const before = sandboxStats().snapshotBuilds;
  const first = snapshots.read();
  expect(snapshots.read()).toBe(first);
  expect(sandboxStats().snapshotBuilds - before).toBe(1);
  snapshots.changed();
  const second = snapshots.read();
  expect(second.generation).toBeGreaterThan(first.generation);
  project.revision = 2;
  expect(snapshots.generation).toBeGreaterThan(second.generation);
  const third = snapshots.read();
  project = { revision: 2, layers: [1] };
  expect(snapshots.read().generation).toBeGreaterThan(third.generation);
  expect(JSON.parse((snapshots.read() as { json: string }).json)).toEqual({ revision: 2, layers: [1] });
  expect(sandboxStats().snapshotBuilds - before).toBe(4);
});

it('copies the selection once until a selection or project change, a new revision, or a replaced project', () => {
  let project: Record<string, unknown> = { revision: 1 };
  let reads = 0;
  const snapshots = new ProjectSnapshots({ get: () => project, revision: () => Number(project.revision), selection: () => ({ layers: [`l${++reads}`], fn: () => 1 }) });
  const first = snapshots.selection();
  expect(first).toEqual({ value: { layers: ['l1'] }, json: '{"layers":["l1"]}' });
  expect(snapshots.selection()).toBe(first);
  snapshots.selectionChanged();
  expect(snapshots.selection().json).toBe('{"layers":["l2"]}');
  snapshots.changed();
  expect(snapshots.selection().json).toBe('{"layers":["l3"]}');
  project.revision = 2;
  expect(snapshots.selection().json).toBe('{"layers":["l4"]}');
  project = { revision: 2 };
  expect(snapshots.selection().json).toBe('{"layers":["l5"]}');
  expect(snapshots.selection().json).toBe('{"layers":["l5"]}');
  expect(new ProjectSnapshots({ get: () => project, revision: () => 1 }).selection()).toEqual({ value: null, json: 'null' });
});

it('refuses a snapshot over the character limit', () => {
  const snapshots = new ProjectSnapshots({ get: () => ({ notes: 'x'.repeat(9 * 1024 * 1024) }), revision: () => 8 });
  expect(snapshots.read()).toEqual({ generation: 1, tooLarge: true });
});

it('keeps one snapshot store per kernel, advanced by the kernel’s project:changed', () => {
  const kernel = createKernel();
  const project = {};
  const source = { get: () => project, revision: () => 1 };
  const snapshots = projectSnapshots(kernel, source);
  expect(projectSnapshots(kernel, { get: () => ({}), revision: () => 2 })).toBe(snapshots);
  expect(projectSnapshots(createKernel(), source)).not.toBe(snapshots);
  const generation = snapshots.generation;
  kernel.events.emit('project:changed', { kind: 'values' });
  expect(snapshots.generation).toBe(generation + 1);
});

it('benchmarks a snapshot of a real-shaped 1.5 MB project against a bare JSON.stringify', () => {
  const project = syntheticProject();
  const raw = JSON.stringify(project);
  expect(raw.length).toBeGreaterThan(1.4e6);
  const runs = 20;
  const time = (fn: () => void): number => { fn(); const start = performance.now(); for (let index = 0; index < runs; index++) fn(); return (performance.now() - start) / runs; };
  const bare = time(() => JSON.stringify(project));
  const sanitize = time(() => sanitizeProject(project));
  let generation = 0;
  const snapshots = new ProjectSnapshots({ get: () => project, revision: () => 4 });
  const build = time(() => { snapshots.changed(); generation = snapshots.read().generation; });
  const cachedRead = time(() => snapshots.read());
  const json = (snapshots.read() as { generation: number; json: string }).json;
  expect(generation).toBe(snapshots.generation);
  expect(json.length).toBeLessThan(raw.length); // no edit log
  expect(json).not.toContain('sourcePath');
  expect(json).not.toContain('apiToken');
  console.info(`[bench] project ${(raw.length / 1e6).toFixed(2)} MB, snapshot ${(json.length / 1e6).toFixed(2)} MB: JSON.stringify ${bare.toFixed(2)} ms, sanitize ${sanitize.toFixed(3)} ms, snapshot build ${build.toFixed(2)} ms, cached read ${(cachedRead * 1000).toFixed(1)} µs`);
  expect(sanitize).toBeLessThan(1);
});

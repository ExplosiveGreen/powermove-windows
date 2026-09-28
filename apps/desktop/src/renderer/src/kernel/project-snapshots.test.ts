import { expect, it, vi } from 'vitest';
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

it('reuses the redacted library, notes and assets until a change that can move them, with the same redaction', () => {
  let walks = 0;
  // Object.entries reads a getter: each JS walk over a live subtree counts once.
  const counted = <T extends Record<string, unknown>>(value: T, key: string): T => {
    const item = value[key];
    delete value[key];
    return Object.defineProperty(value, key, { enumerable: true, configurable: true, get: () => { walks += 1; return item; } });
  };
  const project: Record<string, any> = { revision: 1, layers: [{ id: 'l1' }], edits: [{ label: 'private' }],
    library: counted({ token: 'secret', sections: [{ id: 's1', apiKey: 'secret', layers: [{ id: 'copy' }] }] }, 'sections'),
    notes: counted({ password: 'secret', body: 'safe' }, 'body'),
    assets: { a: counted({ id: 'a', name: 'clip', sourcePath: '/private', blob: 'blob:x' }, 'name') },
    comps: { c: { library: counted({ secret: 'x', title: 'nested' }, 'title') } } };
  const expected = { revision: 1, layers: [{ id: 'l1' }], library: { sections: [{ id: 's1', layers: [{ id: 'copy' }] }] },
    notes: { body: 'safe' }, assets: { a: { id: 'a', name: 'clip' } }, comps: { c: { library: { title: 'nested' } } } };
  const snapshots = new ProjectSnapshots({ get: () => project, revision: () => 1 });
  const read = () => JSON.parse((snapshots.read() as { json: string }).json);
  expect(read()).toEqual(expected);
  expect(JSON.parse(JSON.stringify(sanitizeProject(project)))).toEqual(expected);
  walks = 0;
  for (const kind of ['values', 'structure', 'history']) {
    project.layers[0].id = kind;
    snapshots.changed(kind);
    expect(read()).toEqual({ ...expected, layers: [{ id: kind }] });
  }
  expect(walks).toBe(0);
  for (const kind of ['library', 'assets', 'project', 'replace', undefined]) {
    snapshots.changed(kind);
    read();
    expect(walks).toBe(4);
    walks = 0;
  }
  // A replaced subtree is copied again even after a kind that keeps copies.
  project.notes = 'plain text';
  project.library = { token: 'secret', sections: [] };
  snapshots.changed('values');
  expect(read()).toMatchObject({ notes: 'plain text', library: { sections: [] } });
  expect(walks).toBe(0);
  project.library.sections.push({ id: 's2', apiKey: 'secret' });
  snapshots.changed('library');
  expect(read().library).toEqual({ sections: [{ id: 's2' }] });
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
  const changed = vi.spyOn(snapshots, 'changed');
  kernel.events.emit('project:changed', { kind: 'library' });
  expect(changed).toHaveBeenCalledWith('library');
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

it('benchmarks a snapshot of a project whose library holds full layer copies, by change kind', () => {
  const project = syntheticProject();
  const copy = (from: number) => JSON.parse(JSON.stringify(project.layers.slice(from, from + 30)));
  project.library = { apiToken: 'secret', looks: [], sections: Array.from({ length: 6 }, (_, index) => ({ id: `S${index}`, name: `Section ${index}`, layers: copy(index * 30),
    versions: [{ id: `S${index}v1`, layers: copy(index * 30) }, { id: `S${index}v2`, layers: copy(index * 30) }] })) };
  const raw = JSON.stringify(project);
  const runs = 20;
  const time = (fn: () => void): number => { fn(); const start = performance.now(); for (let index = 0; index < runs; index++) fn(); return (performance.now() - start) / runs; };
  const bare = time(() => JSON.stringify(project));
  const snapshots = new ProjectSnapshots({ get: () => project, revision: () => 4 });
  const values = time(() => { snapshots.changed('values'); snapshots.read(); });
  const library = time(() => { snapshots.changed('library'); snapshots.read(); });
  const json = (snapshots.read() as { json: string }).json;
  expect(json).not.toContain('apiToken');
  expect(JSON.parse(json).library.sections[5].versions[1].layers).toEqual(project.library.sections[5].versions[1].layers);
  console.info(`[bench] project with a ${(JSON.stringify(project.library).length / 1e6).toFixed(2)} MB library, ${(raw.length / 1e6).toFixed(2)} MB: JSON.stringify ${bare.toFixed(2)} ms, snapshot build after values/structure/history ${values.toFixed(2)} ms, after library/assets/project ${library.toFixed(2)} ms`);
});

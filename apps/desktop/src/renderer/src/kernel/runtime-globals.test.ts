// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SVELTE_RUNTIME_MODULES } from '../../../shared/extension-runtime';
import { installSandboxRuntime } from '../../sandbox/boot';
import { installRuntimeGlobals } from './runtime-globals';
import { svelteRuntime } from './svelte-runtime';

const realms = [['editor', installRuntimeGlobals], ['sandbox', installSandboxRuntime]] as const;
let output = '';
let bundle = '';

beforeAll(async () => {
  output = await mkdtemp(path.join(os.tmpdir(), 'powermove-svelte-surface-'));
  const compilerPath = '../../../main/extensions/compiler';
  const { compileExtension } = await import(/* @vite-ignore */ compilerPath);
  const compiled = await compileExtension({ dir: path.resolve('test/fixtures/svelte-surface'), entry: 'index.ts', outDir: output });
  if (!compiled.ok) throw new Error(compiled.error);
  bundle = await readFile(compiled.bundlePath, 'utf8');
});
afterAll(() => rm(output, { recursive: true, force: true }));

it('shares the host namespace object for every runtime module', async () => {
  expect(Object.keys(svelteRuntime).sort()).toEqual([...SVELTE_RUNTIME_MODULES].sort());
  for (const specifier of SVELTE_RUNTIME_MODULES) expect(svelteRuntime[specifier]).toBe(await import(/* @vite-ignore */ specifier));
  for (const [, install] of realms) {
    install();
    const table = globalThis.__powermove_runtime as unknown as Record<string, unknown>;
    expect(Object.keys(table).sort()).toEqual([...SVELTE_RUNTIME_MODULES, 'powermove'].sort());
    for (const specifier of SVELTE_RUNTIME_MODULES) expect(table[specifier]).toBe(svelteRuntime[specifier]);
  }
});

/* Main lists each entry's exports under Node's default conditions (server
   builds); the table holds the browser builds. A name only one side has would
   either fail the extension build or bind `undefined` at runtime. */
it('exports the same names from the browser builds as the compiler reads in main', () => {
  const script = `const out = {}; for (const s of ${JSON.stringify(SVELTE_RUNTIME_MODULES)}) out[s] = Object.keys(await import(s)).sort(); console.log(JSON.stringify(out));`;
  const main = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })) as Record<string, string[]>;
  expect(main).toEqual(Object.fromEntries(SVELTE_RUNTIME_MODULES.map(specifier => [specifier, Object.keys(svelteRuntime[specifier]).sort()])));
});

describe.each(realms)('a compiled extension in the %s realm', (realm, install) => {
  it('runs transitions, motion, reactivity, events, attachments and rune modules on the host Svelte', async () => {
    install();
    // A distinct URL per realm: the bundle binds the runtime table when it evaluates.
    const module = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(`// ${realm}\n${bundle}`).toString('base64')}`);
    const animate = vi.spyOn(Element.prototype, 'animate');
    const target = document.createElement('div');
    document.body.append(target);
    const instance = mount(module.Panel, { target });
    flushSync();
    const text = (selector: string) => target.querySelector(selector)?.textContent;

    expect(text('.label')).toBe('mounted');
    expect(target.querySelector<HTMLElement>('.label')?.dataset.mark).toBe('mounted');
    expect(text('.wide')).toBe(String(matchMedia('(min-width: 600px)').matches));
    expect(text('.width')).toBe(String(window.innerWidth));

    target.querySelector<HTMLButtonElement>('.count')!.click();
    flushSync();
    expect([text('.count'), module.counter.count]).toEqual(['1', 1]);

    module.bell.dispatchEvent(new Event('ring'));
    module.bell.dispatchEvent(new Event('ring'));
    flushSync();
    expect(text('.rings')).toBe('2');

    target.querySelector<HTMLButtonElement>('.toggle')!.click();
    flushSync();
    await Promise.resolve();
    expect([text('.tags'), text('li'), text('.motion'), text('.faded')]).toEqual(['1', 'tag-0', '10/5', 'faded']);
    expect(animate.mock.contexts).toContain(target.querySelector('.faded'));

    await unmount(instance);
    animate.mockRestore();
    target.remove();
  });
});

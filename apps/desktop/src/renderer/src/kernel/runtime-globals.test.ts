// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { SVELTE_RUNTIME_MODULES } from '../../../shared/extension-runtime';
import { installSandboxRuntime } from '../../sandbox/boot';
import { installRuntimeGlobals } from './runtime-globals';
import { svelteRuntime } from './svelte-runtime';

const realms = [['editor', installRuntimeGlobals], ['sandbox', installSandboxRuntime]] as const;

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

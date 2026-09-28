import { describe, expect, it } from 'vitest';
import { permissionFindings } from './permission-scan';

describe('permission scan', () => {
  it('reports undeclared direct capabilities and trusted-only namespaces with repair text', () => {
    expect(permissionFindings([{ path: 'index.ts', text: 'fetch("https://example.com");\napi.render.draw();\napi.ui.modal.open();\nnavigator.clipboard.writeText("x");' }])).toEqual([
      { path: 'index.ts', line: 1, needs: 'network', text: 'Uses fetch() at index.ts:1 but doesn\'t declare the network permission. Add `permissions: ["network"]` to manifest.json.' },
      { path: 'index.ts', line: 2, needs: 'full-access', text: 'Uses api.render (full access) at index.ts:2 but doesn\'t declare the full-access permission. Add `permissions: ["full-access"]` to manifest.json.' },
      { path: 'index.ts', line: 3, needs: 'full-access', text: 'Uses api.ui.modal (full access) at index.ts:3 but doesn\'t declare the full-access permission. Add `permissions: ["full-access"]` to manifest.json.' },
      { path: 'index.ts', line: 4, needs: 'clipboard', text: 'Uses navigator.clipboard at index.ts:4 but doesn\'t declare the clipboard permission. Add `permissions: ["clipboard"]` to manifest.json.' }
    ]);
  });

  it('honors declarations and limits scanning to source files', () => {
    const files = [{ path: 'index.ts', text: 'fetch("https://example.com");\napi.media.audio.play();' }, { path: 'README.md', text: 'api.render fetch(' }];
    expect(permissionFindings(files, ['network', 'full-access'])).toEqual([]);
  });

  it('reports undeclared project reads once, and accepts project:read or project:write', () => {
    const files = [{ path: 'index.ts', text: 'const p = await api.project.get();\napi.events.on("selection", draw);\napi.on(\'time\', draw);\napi.project.revision();' }];
    expect(permissionFindings(files, ['network'])).toEqual([
      { path: 'index.ts', line: 1, needs: 'project:read', text: 'Uses api.project.get at index.ts:1 but doesn\'t declare the project:read permission. Add `permissions: ["project:read"]` to manifest.json.' },
      { path: 'index.ts', line: 2, needs: 'project:read', text: 'Uses the \'selection\' event at index.ts:2 but doesn\'t declare the project:read permission. Add `permissions: ["project:read"]` to manifest.json.' }
    ]);
    expect(permissionFindings(files, ['project:read'])).toEqual([]);
    expect(permissionFindings(files, ['project:write'])).toEqual([]);
  });
});

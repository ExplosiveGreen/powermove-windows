import { expect, test } from 'bun:test';
import { declarePermissionsHint, scanCapabilities, scanFiles, scanText, undeclaredCapabilities, undeclaredCapabilitiesText } from '../src/scan';
/* Fixtures are assembled at runtime so no provider-shaped literal exists in
   the source: GitHub push protection and our own publish scanner would
   otherwise flag this test file. */
const samples = {
  openai_key: 'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  anthropic_key: 'sk-ant-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  aws_access_key: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  github_token: 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  gitlab_token: 'glpat-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  slack_token: 'xoxb-' + '1234567890-1234567890-abcdefghijkl',
  stripe_key: 'sk_live_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  google_api_key: 'AIza' + 'A'.repeat(35),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.'),
  pem_private_key: '-----BEGIN ' + 'RSA PRIVATE KEY-----'
} as const;
for (const [kind, token] of Object.entries(samples)) test(kind, () => expect(scanText('index.ts', `const value = '${token}'`).some((f) => f.kind === kind && f.hard)).toBe(true));
test('entropy waiver and hard override', () => {
  const entropy = 'q7Az9M2bP4xT8nV6kR3wY5cH1jL0sD4fG9uQ';
  const result = scanFiles([{ path: 'index.ts', text: `// powermove-secret-ok: test fixture\nconst v = '${entropy}';\nconst key = '${samples.github_token}'; // powermove-secret-ok: test fixture` }]);
  expect(result.waived.some((f) => f.kind === 'high_entropy' && f.waived === 'test fixture')).toBe(true);
  expect(result.blocked.some((f) => f.kind === 'github_token' && f.hard)).toBe(true);
});
test('nonsecret content and binary skipped', () => {
  expect(scanText('manifest.json', '{"id":"my-extension","version":"1.2.3"}')).toEqual([]);
  expect(scanText('index.ts', 'const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAABAAAA"')).toEqual([]);
  expect(scanText('style.css', '.card { content: "flex grow-0 shrink-0 rounded-md border-neutral-200 bg-slate-100 text-center"; }')).toEqual([]);
  expect(scanText('image.png', samples.aws_access_key)).toEqual([]);
  expect(scanText('index.ts', `\0${samples.aws_access_key}`)).toEqual([]);
});

test('inline CSS declaration lists are not credentials', () => {
  const css = "el.style.cssText='position:absolute;right:124px;top:7px;z-index:6;display:flex;align-items:center';";
  expect(scanText('viewer.ts', css)).toEqual([]);
});
test('capability scanner finds direct project reads in source files only', () => {
  expect(scanCapabilities([
    { path: 'index.ts', text: 'api.project.get()\napi.project . selection()\napi.events.on("project:changed", f)\napi.on(\'selection\', f)\napi.events.on(`time`, f)\napi.project.revision()\napi.project.getter\non("selectionchange", f)' },
    { path: 'Panel.svelte', text: '<script>const p = await api.project.get();</script>' },
    { path: 'README.md', text: 'Call api.project.get() and on("selection", fn).' }
  ])).toEqual([
    { path: 'index.ts', line: 1, capability: 'project:read' },
    { path: 'index.ts', line: 2, capability: 'project:read' },
    { path: 'index.ts', line: 3, capability: 'project:read' },
    { path: 'index.ts', line: 4, capability: 'project:read' },
    { path: 'Panel.svelte', line: 1, capability: 'project:read' }
  ]);
});
test('capability scanner finds network and clipboard uses in text files', () => {
  expect(scanCapabilities([
    { path: 'index.ts', text: 'fetch("https://example.com")\nnew WebSocket("wss://example.com")\nXMLHttpRequest\nnew EventSource("/events")\nnavigator.sendBeacon("/ping")\nnavigator.clipboard.writeText("hi")' },
    { path: 'panel.svelte', text: '<script>navigator.clipboard.readText()</script>' },
    { path: 'image.png', text: 'fetch(\nnavigator.clipboard' },
    { path: 'binary.ts', text: '\0fetch(' }
  ])).toEqual([
    { path: 'index.ts', line: 1, capability: 'network' },
    { path: 'index.ts', line: 2, capability: 'network' },
    { path: 'index.ts', line: 3, capability: 'network' },
    { path: 'index.ts', line: 4, capability: 'network' },
    { path: 'index.ts', line: 5, capability: 'network' },
    { path: 'index.ts', line: 6, capability: 'clipboard' },
    { path: 'panel.svelte', line: 1, capability: 'clipboard' }
  ]);
});
test('below apiVersion 3 nothing is declared, and the repair says to raise apiVersion', () => {
  const files = [{ path: 'panel.ts', text: 'api.on("project:changed", draw)\nfetch("https://example.com")' }];
  // A legacy manifest can't carry permissions; one that does anyway grants nothing.
  expect(undeclaredCapabilities(files, { apiVersion: 2, permissions: ['project:read', 'network'] })).toEqual([
    { path: 'panel.ts', line: 1, capability: 'project:read' },
    { path: 'panel.ts', line: 2, capability: 'network' }
  ]);
  expect(undeclaredCapabilities(files, { apiVersion: 3, permissions: ['project:write', 'network'] })).toEqual([]);
  expect(undeclaredCapabilities(files, { apiVersion: 3, permissions: ['network'] })).toEqual([{ path: 'panel.ts', line: 1, capability: 'project:read' }]);
  expect(declarePermissionsHint(['project:read'], 1)).toBe('Set `apiVersion: 3` and add `permissions: ["project:read"]` to manifest.json.');
  expect(declarePermissionsHint(['project:read'], 3)).toBe('Add `permissions: ["project:read"]` to manifest.json.');
  expect(undeclaredCapabilitiesText(undeclaredCapabilities(files, { apiVersion: 2 }), 2)).toBe(
    'panel.ts:1 and 1 more place need the project:read, network permissions, which manifest.json doesn\'t declare. Set `apiVersion: 3` and add `permissions: ["project:read", "network"]` to manifest.json.'
  );
  expect(undeclaredCapabilitiesText([{ path: 'panel.ts', line: 1, capability: 'project:read' }], 3)).toBe(
    'panel.ts:1 needs the project:read permission, which manifest.json doesn\'t declare. Add `permissions: ["project:read"]` to manifest.json.'
  );
  expect(undeclaredCapabilitiesText([], 3)).toBe('');
});

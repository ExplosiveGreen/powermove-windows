import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type LaunchedApp } from './helpers/app';
import { installStoreExtensions, sandboxStats } from './helpers/sandbox';

/*
 * The Svelte 5 extension API as an author meets it. test/fixtures/svelte5-showcase
 * is a layer outline written with runes, a rune module, snippets, $bindable,
 * attachments, svelte/events, motion, transitions and reactive api reads. It
 * runs once as a local extension (in the editor's realm) and once as a Store
 * install (sandboxed, in its own view iframe), and has to behave the same.
 *
 * Playwright cannot look inside a sandboxed frame, so the panel reports what
 * it rendered (read from its own DOM) as an extension event; the in-realm run
 * reads the same reports so both realms are held to one standard.
 */

const ID = 'svelte5-showcase';
const PANEL = `${ID}.panel`;
const SHOTS = '/tmp/pm-bench/svelte-verify';

type Realm = 'editor' | 'sandbox';
type Report = {
  timecode: string | null; playing: boolean; layers: string[]; empty: string | null; pinned: string[]; filter: string;
  hovered: string | null; motion: { in: number; out: number; move: number }; settled: { fill: number; pinned: number };
  fill: string | null; narrow: boolean; width: number; samplers: number; theme: string; rects: Record<string, [number, number, number, number]>;
};

async function install(session: LaunchedApp, realm: Realm): Promise<void> {
  if (realm === 'sandbox') {
    await installStoreExtensions(session, [{ fixture: ID }]);
  } else {
    const extensions = path.join(session.userData, 'extensions');
    await mkdir(extensions, { recursive: true });
    await cp(path.resolve('test/fixtures', ID), path.join(extensions, ID), { recursive: true });
  }
  await session.relaunch();
  await session.openEditor();
}

async function exercise(session: LaunchedApp, realm: Realm, testInfo: { outputPath(name: string): string }): Promise<void> {
  const { page } = session;
  // Health first, so a build error (an unresolved import, a compile error) names itself.
  await expect.poll(() => page.evaluate((id) => {
    const record = ((window as any).PM?.Kernel?.loader?.records?.() ?? []).find((r: any) => r.id === id);
    return record?.health?.error ?? record?.health?.state ?? null;
  }, ID), { timeout: 20_000 }).toBe('ok');
  expect(await page.evaluate((id) => ((window as any).PM.Kernel.loader.records() as any[]).find(r => r.id === id)?.trust ?? 'local', ID))
    .toBe(realm === 'sandbox' ? 'store' : 'local');

  // Three layers the outline will list, then the panel, with a listener for its reports.
  const event = realm === 'sandbox' ? `ext:${ID}:showcase-report` : 'showcase-report';
  await page.evaluate(({ id, event }) => {
    const PM = (window as any).PM;
    for (const [layer, name] of [['sc-title', 'Title'], ['sc-backdrop', 'Backdrop'], ['sc-logo', 'Logo']]) {
      const result = PM.Edit.apply({ type: 'add_layer', id: layer, layerType: 'text', name });
      if (!result?.ok) throw new Error(`add_layer failed: ${result?.message}`);
    }
    PM.setTime(0, { force: true });
    (window as any).__reports = [];
    PM.Kernel.api('e2e-showcase').events.on(event, (value: unknown) => (window as any).__reports.push(value));
    PM.WS.mutate((workspace: any) => PM.Layout.addPanel(workspace, id, 'right'));
  }, { id: PANEL, event });

  const panel = page.locator(`[id="panel-${PANEL}"]`);
  await expect(panel).toBeVisible();
  await expect(panel.locator('header .ptitle')).toHaveText('Outline');
  const frame = panel.locator('iframe.ext-panel-frame');
  if (realm === 'sandbox') {
    await expect(panel).toHaveClass(/\bframe\b/);
    await expect(frame).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  } else {
    await expect(panel.locator('.showcase')).toBeVisible();
    await expect(frame).toHaveCount(0);
  }

  const last = () => page.evaluate(() => (window as any).__reports.at(-1) as Report | undefined);
  const count = () => page.evaluate(() => (window as any).__reports.length as number);
  const host = () => page.evaluate(() => {
    const PM = (window as any).PM;
    const api = PM.Kernel.api('e2e-showcase');
    return { timecode: api.util.tc(api.project.time()) as string, layers: (api.project.get().layers as { name: string }[]).map(layer => layer.name),
      revision: api.project.revision() as number, theme: PM.Kernel.theme.activeId as string };
  });
  const offset = async () => realm === 'sandbox' ? (await frame.boundingBox())! : { x: 0, y: 0 };
  const point = async (name: string) => {
    const report = (await last())!;
    const rect = report.rects[name];
    if (!rect) throw new Error(`no rect for ${name}: ${JSON.stringify(report.rects)}`);
    const origin = await offset();
    return { x: origin.x + rect[0] + Math.min(24, rect[2] / 2), y: origin.y + rect[1] + rect[3] / 2 };
  };

  // It compiled, mounted, read the project (a pulled snapshot in the sandbox) and the list faded in.
  const initial = await host();
  await expect.poll(async () => (await last())?.layers, { timeout: 10_000 }).toEqual(initial.layers);
  await expect.poll(async () => (await last())?.settled.fill).toBe(1); // the Tween reached 3 of 3
  let report = (await last())!;
  expect(report).toMatchObject({ timecode: initial.timecode, playing: false, empty: null, pinned: [], filter: '', samplers: 0, theme: initial.theme, fill: '100%' });
  expect(report.width).toBeGreaterThan(100);
  expect(typeof report.narrow).toBe('boolean');
  const motion0 = report.motion;

  // The timecode follows the playhead: scrubbing, then playback, then the pause.
  await page.evaluate(() => (window as any).PM.setTime(1.5, { force: true }));
  const scrubbed = await host();
  expect(scrubbed.timecode).not.toBe(initial.timecode);
  await expect.poll(async () => (await last())?.timecode).toBe(scrubbed.timecode);

  const playback = await page.evaluate(async ({ ms, sandbox }) => {
    const PM = (window as any).PM;
    const sleep = (value: number) => new Promise(resolve => setTimeout(resolve, value));
    const stats = () => { const value = (globalThis as any).__powermoveSandboxStats; return { builds: Number(value?.snapshotBuilds ?? 0), ticks: Number(value?.ticks ?? 0) }; };
    PM.setTime(0, { force: true }); PM.loop = true;
    await sleep(200);
    let times = 0;
    const off = PM.bus.on('time', () => { times++; });
    const reportsBefore = (window as any).__reports.length;
    const before = stats();
    PM.play();
    await sleep(ms);
    const during = (window as any).__reports.slice(reportsBefore);
    PM.pause();
    off();
    await sleep(150);
    const after = stats();
    return { times, reports: during.length, timecodes: [...new Set(during.map((entry: Report) => entry.timecode))], samplers: during.map((entry: Report) => entry.samplers),
      playing: during.map((entry: Report) => entry.playing), builds: after.builds - before.builds, ticks: after.ticks - before.ticks, sandbox };
  }, { ms: 1_500, sandbox: realm === 'sandbox' });
  console.log('SVELTE5 SHOWCASE PLAYBACK', realm, JSON.stringify(playback));
  expect(playback.times).toBeGreaterThan(10);
  // Sampled four times a second while playing, not once per frame, and the markup moved.
  expect(playback.reports).toBeGreaterThanOrEqual(3);
  expect(playback.reports).toBeLessThanOrEqual(Math.ceil(1_500 / 250) + 3);
  expect(playback.timecodes.length).toBeGreaterThanOrEqual(3);
  expect(playback.playing).toContain(true);
  expect(Math.max(...playback.samplers)).toBe(1);
  if (realm === 'sandbox') {
    // Reading time/playing/latest reactively adds no host work per frame: no snapshot
    // builds, and at most one tick per engine frame for each of the two documents.
    expect(playback.builds).toBe(0);
    expect(playback.ticks).toBeLessThanOrEqual((playback.times + 4) * 2);
  }
  // Paused: the sampler's $effect cleanup ran and the readout is the exact playhead.
  const paused = await host();
  await expect.poll(async () => { const entry = await last(); return entry && [entry.playing, entry.samplers, entry.timecode]; }).toEqual([false, 0, paused.timecode]);

  // The outline follows edits: an added layer fades in, a rename, a move (flip) and a delete (slide out).
  await page.evaluate(() => (window as any).PM.Edit.apply({ type: 'add_layer', id: 'sc-caption', layerType: 'text', name: 'Caption' }));
  const added = await host();
  expect(added.layers).toContain('Caption');
  await expect.poll(async () => (await last())?.layers).toEqual(added.layers);
  await expect.poll(async () => (await last())?.motion.in).toBeGreaterThan(motion0.in);

  await page.evaluate(() => (window as any).PM.Edit.apply({ type: 'set_layer', target: 'sc-backdrop', patch: { name: 'Background' } }));
  const renamed = await host();
  expect(renamed.layers).toContain('Background');
  await expect.poll(async () => (await last())?.layers).toEqual(renamed.layers);

  await page.evaluate(() => (window as any).PM.Edit.apply({ type: 'reorder_layer', target: 'sc-title', index: 0 }));
  const moved = await host();
  expect(moved.layers).not.toEqual(renamed.layers);
  await expect.poll(async () => (await last())?.layers).toEqual(moved.layers);
  await expect.poll(async () => (await last())?.motion.move).toBeGreaterThan(motion0.move);

  await page.evaluate(() => (window as any).PM.Edit.apply({ type: 'delete_layers', targets: ['sc-logo'] }));
  const removed = await host();
  expect(removed.layers).not.toContain('Logo');
  await expect.poll(async () => (await last())?.layers).toEqual(removed.layers);
  await expect.poll(async () => (await last())?.motion.out).toBeGreaterThan(motion0.out);

  // Real pointer input: hovering a row reaches the parent through bind:hovered, and a
  // click pins it in the rune module's SvelteSet/SvelteMap; the Spring settles on 1 of n.
  const title = await point('sc-title');
  await page.mouse.move(title.x - 30, title.y - 60);
  await page.mouse.move(title.x, title.y, { steps: 4 });
  await expect.poll(async () => (await last())?.hovered).toBe('sc-title');
  await page.mouse.click(title.x, title.y);
  await expect.poll(async () => (await last())?.pinned).toEqual(['sc-title']);
  await expect.poll(async () => (await last())?.settled.pinned).toBeCloseTo(1 / removed.layers.length, 5);

  // $bindable filter: typing narrows the list; Escape (an on() listener) clears it.
  const field = await point('filter');
  await page.mouse.click(field.x, field.y);
  await page.keyboard.type('ti');
  await expect.poll(async () => (await last())?.filter).toBe('ti');
  const filtered = removed.layers.filter(name => name.toLowerCase().includes('ti'));
  await expect.poll(async () => (await last())?.layers).toEqual(filtered);
  await page.keyboard.type('zz');
  await expect.poll(async () => (await last())?.empty).toBe('No layers match');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await last())?.filter).toBe('');
  await expect.poll(async () => (await last())?.layers).toEqual(removed.layers);
  await expect.poll(async () => (await last())?.settled.fill).toBe(1);

  // The status item is polled by the status bar and shows the current revision.
  const revision = (await host()).revision;
  await expect(page.locator('.status-contribution', { hasText: 'Outline · revision' })).toHaveText(`Outline · revision ${revision}`, { timeout: 5_000 });

  await mkdir(SHOTS, { recursive: true });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const windowShot = await page.screenshot();
  await writeFile(path.join(SHOTS, `${realm}-window.png`), windowShot);
  await writeFile(testInfo.outputPath(`${realm}-window.png`), windowShot);
  const shot = await panel.screenshot();
  await writeFile(path.join(SHOTS, `${realm}-panel.png`), shot);
  await writeFile(testInfo.outputPath(`${realm}-panel.png`), shot);

  expect(await count()).toBeGreaterThan(0);
  expect(session.diagnostics.pageErrors).toEqual([]);
  const errors = session.diagnostics.console.filter(entry => entry.type === 'error');
  expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
}

test('@extensions the Svelte 5 showcase works as a local extension in the editor realm', async ({ session }, testInfo) => {
  test.setTimeout(90_000);
  await install(session, 'editor');
  await exercise(session, 'editor', testInfo);
});

test('@extensions the Svelte 5 showcase works sandboxed as a Store install', async ({ session }, testInfo) => {
  test.setTimeout(90_000);
  await install(session, 'sandbox');
  await exercise(session, 'sandbox', testInfo);
  expect((await sandboxStats(session)).present).toBe(true);
});

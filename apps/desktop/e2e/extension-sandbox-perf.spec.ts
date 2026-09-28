import { expect, test } from './helpers/app';
import type { LaunchedApp } from './helpers/app';
import { installStoreExtensions, runCommand, sandboxStats, waitForCommands } from './helpers/sandbox';

/* docs/sandbox-data-plane.md, Acceptance: Store extensions that do not read
   the project cost playback nothing (no snapshot builds, rate within noise of
   none installed), and readers share one snapshot build per change. Numbers
   are logged with the SANDBOX PERF prefix for the integration report. */

const PROJECT_NAME = 'Sandbox perf';
const PLAY_MS = 3_000;

type Playback = { rate: number; fps: number; maxGapMs: number; builds: number; ticks: number; snapshotMs: number; statsPresent: boolean };
type ReaderReport = { changes: number; reads: number; errors: number; layers: number; revision: number; error: string };
type ClockReport = { times: number; last: number; transports: number; playing: boolean };

/** ~1.5 MB of JSON once hydrated: staggered text and shape layers with keyframed transforms, opened the way the app opens a project. */
async function openLargeProject(session: LaunchedApp): Promise<{ bytes: number; layers: number }> {
  const result = await session.page.evaluate((name) => {
    const PM = (window as any).PM;
    const project = PM.mkProject({ name, w: 1280, h: 720, fps: 30, dur: 10 });
    const channels = ['position.x', 'position.y', 'opacity', 'rotation'];
    // Opening hydrates (fills defaults), which more than doubles a layer; size what the app will hold.
    const hydratedSize = () => JSON.stringify(PM.hydrateProject(structuredClone(project))).length;
    let index = 0;
    while (hydratedSize() < 1.5e6) {
      for (let batch = 0; batch < 10; batch++, index++) {
        const text = index % 2 === 0, from = (index % 20) * 0.5;
        const layer = PM.mkLayer(text ? 'text' : 'shape', {
          name: `Layer ${index}`, from, dur: 1.5,
          p: { 'position.x': 40 + (index * 37) % 1200, 'position.y': 30 + (index * 53) % 660 },
          d: text ? { text: `Line ${index} ${'the quick brown fox jumps over the lazy dog '.repeat(3)}`, size: 20 } : { w: 60, h: 40, radius: 6, color: `#${(index * 2371 & 0xffffff).toString(16).padStart(6, '0')}` },
        }, project);
        for (const channel of channels) {
          const base = layer.p[channel].v;
          layer.p[channel].kf = Array.from({ length: 12 }, (_, key) => PM.KF(from + key * 0.125, channel === 'opacity' ? (key % 2 ? 40 : 100) : base + key * 7, 'linear'));
        }
        project.layers.push(layer);
      }
    }
    window.dispatchEvent(new CustomEvent('pm-open-project', { detail: project }));
    PM.ProjectsScreen.hide();
    return project.layers.length;
  }, PROJECT_NAME);
  await session.page.waitForFunction((name) => {
    const PM = (window as any).PM;
    return PM.proj?.name === name && Boolean(PM.GL?.gl && PM.Kernel.services.get('viewer')?.stage?.isConnected);
  }, PROJECT_NAME);
  await session.page.waitForTimeout(1_000);
  const bytes = await session.page.evaluate(() => JSON.stringify((window as any).PM.proj).length);
  return { bytes, layers: result };
}

/** Plays from 0 for `ms` and counts `time` events (one per engine frame) and sandbox counters. */
function play(session: LaunchedApp, ms = PLAY_MS): Promise<Playback> {
  return session.page.evaluate(async (ms) => {
    const PM = (window as any).PM;
    const sleep = (value: number) => new Promise(resolve => setTimeout(resolve, value));
    const stats = () => {
      const value = (globalThis as any).__powermoveSandboxStats;
      return { present: Boolean(value), builds: Number(value?.snapshotBuilds ?? 0), ticks: Number(value?.ticks ?? 0), ms: Number(value?.snapshotMs ?? 0) };
    };
    PM.pause(); PM.setTime(0); PM.loop = true;
    await sleep(300);
    let times = 0, maxGap = 0, last = performance.now(), stop = false;
    const off = PM.bus.on('time', () => { times++; });
    const frame = (now: number) => { if (stop) return; maxGap = Math.max(maxGap, now - last); last = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const before = stats();
    const start = performance.now();
    PM.play();
    await sleep(ms);
    const fps = Number(PM.perf?.fps ?? 0);
    PM.pause();
    const elapsed = performance.now() - start;
    off(); stop = true;
    await sleep(100); // let the pause's own tick land before reading counters
    const after = stats();
    return { rate: times * 1000 / elapsed, fps, maxGapMs: maxGap, builds: after.builds - before.builds, ticks: after.ticks - before.ticks, snapshotMs: after.ms - before.ms, statsPresent: after.present };
  }, ms);
}

/** One warm-up pass (rasters, decoders), then the measured pass. */
async function measure(session: LaunchedApp, scenario: string, extra: Record<string, unknown> = {}): Promise<Playback> {
  await play(session, 1_500);
  const result = await play(session);
  console.log('SANDBOX PERF', JSON.stringify({ scenario, ...extra, ...result, rate: Math.round(result.rate * 10) / 10, maxGapMs: Math.round(result.maxGapMs), snapshotMs: Math.round(result.snapshotMs * 100) / 100 }));
  return result;
}

test('store extensions that do not read the project cost playback nothing, and readers share one snapshot per change', async ({ session }) => {
  test.setTimeout(240_000);

  // (1) No Store extensions.
  await session.openEditor();
  const size = await openLargeProject(session);
  expect(size.bytes).toBeGreaterThanOrEqual(1.5e6);
  expect(size.bytes).toBeLessThan(2e6);
  const baseline = await measure(session, 'none', size);
  expect(baseline.rate).toBeGreaterThan(10);

  // (2) A hello-world extension with a panel and no permissions, panel closed then open.
  await installStoreExtensions(session, [{ fixture: 'sandbox-hello' }]);
  await session.relaunch();
  await session.openEditor();
  await waitForCommands(session, ['sandbox-hello'], 'hello');
  expect(await runCommand(session, 'sandbox-hello.hello')).toBe(1);
  await openLargeProject(session);
  const closed = await measure(session, 'hello, panel closed');
  const panelId = 'sandbox-hello.panel';
  await session.page.evaluate((id) => {
    const PM = (window as any).PM;
    PM.WS.mutate((workspace: any) => PM.Layout.addPanel(workspace, id, 'right'));
  }, panelId);
  await expect(session.page.locator(`[id="panel-${panelId}"] iframe.ext-panel-frame`)).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  const open = await measure(session, 'hello, panel open');
  for (const result of [closed, open]) {
    expect(result.statsPresent).toBe(true);
    expect(result.builds).toBe(0);
    expect(result.rate).toBeGreaterThanOrEqual(baseline.rate * 0.9);
  }

  // (3) Several extensions without permissions reading on every change, plus one following `time`.
  const readers = ['sandbox-reader', 'sandbox-reader-2', 'sandbox-reader-3'];
  await installStoreExtensions(session, [...readers.map(id => ({ fixture: 'sandbox-reader', id })), { fixture: 'sandbox-clock' }]);
  await session.relaunch();
  await session.openEditor();
  await waitForCommands(session, readers, 'report');
  await waitForCommands(session, ['sandbox-clock'], 'report');
  await openLargeProject(session);
  const clockBefore = await runCommand<ClockReport>(session, 'sandbox-clock.report') as ClockReport;
  const reading = await measure(session, 'readers + clock, playback');
  const clockAfter = await runCommand<ClockReport>(session, 'sandbox-clock.report') as ClockReport;
  console.log('SANDBOX PERF', JSON.stringify({ scenario: 'clock', timesDuringBothPasses: clockAfter.times - clockBefore.times, transports: clockAfter.transports - clockBefore.transports }));
  expect(reading.statsPresent).toBe(true);
  expect(reading.builds).toBe(0);
  expect(reading.rate).toBeGreaterThanOrEqual(baseline.rate * 0.9);
  // Coalesced per flush, so at most one per engine frame, but it must follow playback.
  expect(clockAfter.times - clockBefore.times).toBeGreaterThan(reading.rate * PLAY_MS / 1000 * 0.5);
  expect(clockAfter.transports - clockBefore.transports).toBeGreaterThanOrEqual(2);

  // One edit: every reader reads it, from a single shared build.
  const report = async () => Promise.all(readers.map(id => runCommand<ReaderReport>(session, `${id}.report`) as Promise<ReaderReport>));
  const readsBefore = await report();
  const buildsBefore = (await sandboxStats(session)).snapshotBuilds;
  const layers = await session.page.evaluate(() => {
    const PM = (window as any).PM;
    const layer = PM.proj.layers.find((entry: any) => entry.type === 'shape');
    PM.Edit.apply({ type: 'set_property', target: layer.id, path: 'scale.x', value: 150, mode: 'static', preserveHandEdits: false });
    return PM.proj.layers.length;
  });
  await expect.poll(async () => (await report()).every((entry, index) => entry.reads > readsBefore[index]!.reads)).toBe(true);
  await session.page.waitForTimeout(500);
  const readsAfter = await report();
  const buildsAfter = await sandboxStats(session);
  console.log('SANDBOX PERF', JSON.stringify({ scenario: 'one edit', readers: readers.length, builds: buildsAfter.snapshotBuilds - buildsBefore, snapshotMsTotal: Math.round(buildsAfter.snapshotMs * 100) / 100, reads: readsAfter.map((entry, index) => entry.reads - readsBefore[index]!.reads) }));
  for (const entry of readsAfter) {
    expect(entry.errors).toBe(0);
    expect(entry.layers).toBe(layers);
  }
  expect(buildsAfter.snapshotBuilds - buildsBefore).toBe(1);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

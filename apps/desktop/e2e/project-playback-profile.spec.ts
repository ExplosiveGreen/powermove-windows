import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './helpers/app';

test('profiles actual playback of a copied media project', async ({ session }) => {
  test.skip(!process.env.PM_PLAYBACK_PROJECT, 'Set PM_PLAYBACK_PROJECT to a project to measure');
  test.setTimeout(180_000);
  const directory = await mkdtemp(join(tmpdir(), 'powermove-playback-profile-'));
  const copy = join(directory, 'Project.pmv');
  await copyFile(process.env.PM_PLAYBACK_PROJECT!, copy);
  await session.openEditor();
  await session.page.setViewportSize({ width: 1728, height: 1117 });
  const cdp = await session.page.context().newCDPSession(session.page);
  if (process.env.PM_PLAYBACK_DPR) await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1728, height: 1117, deviceScaleFactor: Number(process.env.PM_PLAYBACK_DPR), mobile: false,
  });
  await session.app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, copy);
  await session.page.evaluate(() => (window as any).PM.openProject());
  await session.page.waitForFunction(() => !(window as any).PM.assets.loading?.size);
  await session.page.evaluate(() => {
    const PM = (window as any).PM;
    if (PM.Comps) {
      const largest: any = PM.Comps.list().sort((a: any, b: any) => (PM.Comps.get(b.id)?.layers.length || 0) - (PM.Comps.get(a.id)?.layers.length || 0))[0];
      if (largest) PM.Comps.open(largest.id);
    } else {
      // Profile nested footage on builds without composition-tab navigation too.
      const project = PM.proj;
      const largest: any = Object.values(project.comps || {}).sort((a: any, b: any) => b.layers.length - a.layers.length)[0];
      if (largest?.layers.length > project.layers.length) PM.replaceProject({ ...project, ...largest,
        id: project.id, name: project.name, assets: project.assets, comps: project.comps, work: [0, largest.dur] });
    }
    PM.pause(); PM.setTime(0); PM.loop = true;
  });
  await session.page.waitForTimeout(1000);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  const results = await session.page.evaluate(async ({ seconds, auto, zooms }) => {
    const PM = (window as any).PM, viewer = PM.Kernel.services.get('viewer');
    const results = [], render = PM.GL.render, raster = PM.raster;
    let frames: any[] = [], costs = new Map<string, { calls: number; ms: number }>();
    PM.raster = (layer: any, ...args: any[]) => {
      const start = performance.now(), result = raster(layer, ...args);
      const item = costs.get(layer.type) || { calls: 0, ms: 0 }; item.calls++; item.ms += performance.now() - start; costs.set(layer.type, item);
      return result;
    };
    PM.GL.render = (...args: any[]) => {
      const start = performance.now(), result = render(...args);
      if (PM.playing) frames.push({ at: start, time: args[0], ms: performance.now() - start, presented: result !== false, quality: PM.quality,
        draws: PM.GL.stats.draws, hit: PM.GL.stats.previewHit });
      return result;
    };
    try {
      for (const zoom of zooms) {
        PM.pause(); PM.setTime(0); PM.perf.auto = auto; PM.quality = 1;
        viewer.fit = zoom === 0; viewer.zoom = zoom || 1; viewer.pan = [0, 0]; viewer.layout();
        await new Promise(resolve => setTimeout(resolve, 300));
        frames = []; costs = new Map();
        const start = performance.now(); PM.play();
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        const elapsed = performance.now() - start; PM.pause();
        results.push({ zoom, elapsed, frames, raster: Object.fromEntries(costs), layers: PM.proj.layers.length,
          fps: PM.proj.fps, canvas: [PM.GL.canvas.width, PM.GL.canvas.height], memory: PM.Memory.stats() });
      }
    } finally { PM.pause(); PM.GL.render = render; PM.raster = raster; }
    return results;
  }, { seconds: Number(process.env.PM_PLAYBACK_SECONDS) || 21, auto: process.env.PM_PLAYBACK_AUTO === '1', zooms: (process.env.PM_PLAYBACK_ZOOMS || '0,1').split(',').map(Number) });
  const output = process.env.PM_PLAYBACK_OUTPUT || join(directory, 'playback.json');
  await writeFile(output, JSON.stringify(results));
  await writeFile(output + '.cpuprofile', JSON.stringify((await cdp.send('Profiler.stop')).profile));
  for (const result of results) {
    const costs = result.frames.map((frame: any) => frame.ms).sort((a: number, b: number) => a - b);
    console.log('PROJECT_PLAYBACK', JSON.stringify({ zoom: result.zoom, layers: result.layers, actualFps: result.frames.filter((f: any) => f.presented).length * 1000 / result.elapsed,
      median: costs[Math.floor(costs.length / 2)], p95: costs[Math.floor(costs.length * .95)], max: costs.at(-1), raster: result.raster, canvas: result.canvas }));
    expect(result.frames.length).toBeGreaterThan(10);
  }
  expect(session.diagnostics.pageErrors).toEqual([]);
});

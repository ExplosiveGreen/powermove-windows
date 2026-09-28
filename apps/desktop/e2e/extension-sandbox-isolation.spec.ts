import { expect, test } from './helpers/app';
import { installStoreExtensions, processAlive, runCommand, sandboxFrames, waitForCommands } from './helpers/sandbox';

/* docs/sandbox-data-plane.md, Acceptance: two Store extensions run in two
   processes, neither the editor's; a spinning one is killed, turned off, and
   the other keeps working while editor frames stay smooth. */
test('each store extension gets its own process and a spinning one is killed without touching the rest', async ({ session }) => {
  test.setTimeout(90_000);
  const [spin, alive] = await installStoreExtensions(session, [
    { fixture: 'sandbox-spin', id: 'sandbox-spin' },
    { fixture: 'sandbox-spin', id: 'sandbox-alive' },
  ]) as [string, string];
  await session.relaunch();
  await session.openEditor();
  const { page } = session;
  await waitForCommands(session, [spin, alive], 'ping');
  expect(await runCommand(session, `${spin}.ping`)).toBe(1);
  expect(await runCommand(session, `${alive}.ping`)).toBe(1);

  await expect.poll(async () => (await sandboxFrames(session)).map(frame => frame.id).sort()).toEqual([alive, spin]);
  const frames = await sandboxFrames(session);
  const byId = Object.fromEntries(frames.map(frame => [frame.id, frame]));
  const editorPid = byId[spin]!.editorPid;
  console.log('SANDBOX ISOLATION', JSON.stringify({ editorPid, frames: frames.map(({ id, pid, host }) => ({ id, pid, host })) }));
  expect(byId[alive]!.editorPid).toBe(editorPid);
  expect(byId[spin]!.pid).not.toBe(byId[alive]!.pid);
  expect(byId[spin]!.pid).not.toBe(editorPid);
  expect(byId[alive]!.pid).not.toBe(editorPid);
  expect(byId[spin]!.host).not.toBe(byId[alive]!.host);
  const spinPid = byId[spin]!.pid;

  // Editor frame pacing, measured from before the spin until after the kill.
  await page.evaluate(() => {
    const gaps = { max: 0, frames: 0, last: performance.now(), stop: false };
    (window as any).__sandboxRafGaps = gaps;
    const tick = (now: number) => {
      if (gaps.stop) return;
      gaps.max = Math.max(gaps.max, now - gaps.last); gaps.last = now; gaps.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  expect(await runCommand(session, `${spin}.spin`)).toBe('spinning');
  const spunAt = Date.now();
  await page.waitForTimeout(300); // the fixture starts spinning 50 ms after replying
  // It really spins (its own ping goes unanswered) while the other extension still answers.
  expect(await runCommand(session, `${spin}.ping`, 1_500)).toBe('timeout');
  expect(await runCommand(session, `${alive}.ping`, 2_000)).toBe(2);

  await expect.poll(async () => (await sandboxFrames(session)).some(frame => frame.id === spin), { timeout: 20_000, intervals: [250] }).toBe(false);
  await expect.poll(() => processAlive(session, spinPid), { timeout: 5_000 }).toBe(false);
  const killedAfter = Date.now() - spunAt;
  await expect.poll(() => page.evaluate((id) => {
    const record = (window as any).PM.Kernel.loader.records().find((entry: { id: string }) => entry.id === id);
    return record ? { enabled: record.enabled, health: record.health?.state } : null;
  }, spin)).toEqual({ enabled: false, health: 'runtime-error' });
  expect(await page.evaluate((id) => [...document.querySelectorAll('iframe')].filter((frame) => {
    try { return new URL(frame.src).searchParams.get('id') === id; } catch { return false; }
  }).length, spin)).toBe(0);
  expect(await page.evaluate((id) => Boolean((window as any).PM.Kernel.commands.get(`${id}.ping`)), spin)).toBe(false);

  // The survivor keeps its process and keeps answering.
  expect(await runCommand(session, `${alive}.ping`)).toBe(3);
  const survivor = (await sandboxFrames(session)).find(frame => frame.id === alive);
  expect(survivor?.pid).toBe(byId[alive]!.pid);
  expect(await processAlive(session, byId[alive]!.pid)).toBe(true);

  const gaps = await page.evaluate(() => { const gaps = (window as any).__sandboxRafGaps; gaps.stop = true; return { max: gaps.max, frames: gaps.frames }; });
  console.log('SANDBOX WATCHDOG', JSON.stringify({ killedAfterMs: killedAfter, maxRafGapMs: Math.round(gaps.max), rafFrames: gaps.frames }));
  expect(killedAfter).toBeLessThan(20_000);
  expect(gaps.frames).toBeGreaterThan(0);
  expect(gaps.max).toBeLessThan(250);
  expect(session.diagnostics.pageErrors).toEqual([]);
});

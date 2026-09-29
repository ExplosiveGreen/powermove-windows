// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createTimelineRuntime } from './timeline';
import { fakePowermoveAPI } from './fake-api.test-helper';
import { install as installUIState } from '../../renderer/src/legacy/core/ui-state';

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function harness(options: { collapsed?: boolean; height?: number } = {}) {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  // Keep the decorative playhead trail stationary in this structural test.
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const value = fakePowermoveAPI(vi);
  value.state.project.layers = Array.from({ length: 200 }, (_, i) => ({
    id: `layer-${i}`, name: `Layer ${i}`, type: 'solid', collapsed: options.collapsed ?? false,
    from: 0, dur: 10, d: {}, fx: [], masks: [],
    p: { opacity: { v: 100, kf: [{ i: `key-${i}`, t: 0, v: 100 }] } },
  }));
  const PM: any = { proj: value.state.project, bus: { on() {} } };
  installUIState(PM);
  Object.assign(value.api.uiState, PM.UIState);
  const paint = vi.fn();
  const text = vi.fn(), paths = vi.fn(), copies = vi.fn(), fonts = vi.fn(), moves = vi.fn();
  const context = new Proxy({ setTransform: paint, fillText: text, beginPath: paths, drawImage: copies, moveTo: moves, measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { return key in target ? target[key as keyof typeof target] : () => {}; },
    set(target, key, next) { if (key === 'font') fonts(next); (target as any)[key] = next; return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any);
  const timeline = createTimelineRuntime(value.api);
  timeline.cv = document.createElement('canvas');
  timeline.ctx = context;
  timeline.w = 900;
  timeline.hgt = options.height ?? 28;
  timeline.cv.width = timeline.w;
  timeline.cv.height = timeline.hgt;
  disposers.push(() => timeline.disposeRuntime());
  let pending = false;
  vi.mocked(value.api.transport.invalidate).mockImplementation(() => {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(() => { pending = false; value.emit('invalidate', 'timeline'); });
  });
  const flush = () => {
    const batch = [...frames.values()]; frames.clear();
    batch.forEach(fn => fn(0));
  };
  value.emit('invalidate', 'timeline');
  paint.mockClear();
  text.mockClear(); paths.mockClear(); copies.mockClear(); fonts.mockClear();
  vi.mocked(value.api.anim.allProps).mockClear();
  return { ...value, timeline, paint, text, paths, copies, fonts, moves, flush };
}

it.each([true, false])('preserves all 120 subpixel playback positions with playing=%s', playing => {
  const value = harness({ collapsed: true, height: 300 });
  value.state.playing = playing;
  value.timeline.pps = 30;
  const positions = [];
  for (let frame = 1; frame <= 120; frame++) {
    value.moves.mockClear();
    value.state.time = frame / 120;
    value.emit('time', value.state.time); value.flush();
    positions.push(value.moves.mock.calls.find(([, y]) => y === 7)![0]);
  }
  expect(new Set(positions).size).toBe(120);
  expect(positions[1] - positions[0]).toBeCloseTo(.25);
});

it('moves ruler ticks, labels, and rows continuously through fractional pans', () => {
  const value = harness({ collapsed: true, height: 300 });
  value.timeline.pps = 30;
  const positions = [];
  for (let i = 0; i < 4; i++) {
    value.timeline.scrollT = .1 + i / 120;
    value.timeline.scrollY = 10 + i / 4;
    value.moves.mockClear(); value.text.mockClear();
    value.emit('invalidate', 'timeline');
    const labelX = value.text.mock.calls.find(([, x, y]) => y === 13 && x > value.timeline.gut)![1];
    positions.push({
      tick: value.moves.mock.calls.find(([x, y]) => y === value.timeline.ruler - 8 && x === labelX)![0],
      label: labelX,
      row: value.text.mock.calls.find(([label]) => label === 'Layer 0')![2],
    });
  }
  for (let i = 1; i < positions.length; i++) {
    expect(positions[i]!.tick - positions[i - 1]!.tick).toBeCloseTo(-.25);
    expect(positions[i]!.label - positions[i - 1]!.label).toBeCloseTo(-.25);
    expect(positions[i]!.row - positions[i - 1]!.row).toBeCloseTo(-.25);
  }
});

it('settles the playhead trail on every host frame without an extra RAF hop', () => {
  const value = harness({ collapsed: true, height: 300 });
  vi.mocked(performance.now).mockReturnValue(100);
  value.state.time = 1; value.emit('time', 1); value.flush();
  vi.mocked(performance.now).mockReturnValue(116);
  value.state.time = 1.1; value.emit('time', 1.1); value.flush();
  value.paint.mockClear();
  vi.mocked(performance.now).mockReturnValue(124);
  value.flush();
  expect(value.paint).toHaveBeenCalledTimes(1);
});

it.each(['up', 'cancel'])('scrubs at pointer precision, selects project frames, and settles on %s', finish => {
  const value = harness({ collapsed: true, height: 300 });
  const wrap = document.createElement('div');
  value.timeline.cv.id = 'tl-canvas';
  wrap.append(value.timeline.cv); document.body.append(wrap);
  const bounds = vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 300, left: 0, top: 0 } as DOMRect);
  value.timeline.attachCanvas(wrap); value.flush(); value.flush();
  value.timeline.pps = 30;
  vi.mocked(value.api.transport.setTime).mockImplementation(time => {
    value.state.time = Math.round(time * 30) / 30;
    value.emit('time', value.state.time);
  });
  let drag: any;
  vi.mocked(value.api.ui.drag).mockImplementation((_event, options) => { drag = options; return { cancel: () => drag.cancel() }; });
  const startX = value.timeline.gut + 30;
  const down = new PointerEvent('pointerdown', { button: 0, clientX: startX, clientY: 18 });
  Object.defineProperties(down, { offsetX: { value: startX }, offsetY: { value: 18 } });
  value.timeline.cv.dispatchEvent(down);
  expect(drag).toBeDefined();
  value.flush(); bounds.mockClear();
  const positions = [];
  for (let frame = 1; frame <= 120; frame++) {
    const dx = frame / 4;
    drag.move(dx, 0, { clientX: startX + dx });
    value.moves.mockClear(); value.flush();
    positions.push(value.moves.mock.calls.find(([, y]) => y === 7)![0]);
    expect(value.state.time * 30).toBeCloseTo(Math.round(value.state.time * 30));
  }
  expect(new Set(positions).size).toBe(120);
  expect(bounds).not.toHaveBeenCalled();
  // Magnetic snapping controls both the selected frame and pointer feedback;
  // releasing Shift restores the raw pointer position immediately.
  drag.move(267, 0, { clientX: startX + 267, shiftKey: true });
  value.moves.mockClear(); value.flush();
  // Snaps to the strip's last visible frame, not the exclusive out edge.
  expect(value.state.time).toBeCloseTo(10 - 1 / 30, 9);
  expect(value.moves.mock.calls.find(([, y]) => y === 7)![0]).toBeCloseTo(value.timeline.gut + 299 + .5);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
  value.moves.mockClear(); value.flush();
  expect(value.state.time).toBe(9.9);
  expect(value.moves.mock.calls.find(([, y]) => y === 7)![0]).toBeCloseTo(value.timeline.gut + 297 + .5);
  drag.move(30.25, 0, { clientX: startX + 30.25 }); value.flush();
  drag[finish](); value.moves.mockClear(); value.flush();
  expect(value.moves.mock.calls.find(([, y]) => y === 7)![0]).toBeCloseTo(value.timeline.gut + value.state.time * 30 + .5);
});

it('keeps static clip, waveform, ruler, and gutter drawing out of ordinary playback ticks', () => {
  const value = harness({ collapsed: true, height: 600 });
  value.state.playing = true;
  for (let i = 0; i < 8; i++) {
    value.state.time += 1 / 30;
    value.emit('time', value.state.time);
    value.flush();
  }
  expect(value.text.mock.calls.length).toBe(0);
  expect(value.paths.mock.calls.length).toBeLessThanOrEqual(8 * 6);
  expect(value.copies).toHaveBeenCalledTimes(8);
  expect(value.fonts.mock.calls.length).toBe(0);
});

it('keeps expanded static property evaluation and artwork out of time-only frames', () => {
  const value = harness({ height: 600 });
  for (const layer of value.state.project.layers) {
    layer.p.opacity.kf = [];
    value.api.uiState.setReveal(layer, ['opacity']);
  }
  value.emit('project:changed', { kind: 'structure' }); value.flush();
  value.text.mockClear(); value.fonts.mockClear(); vi.mocked(value.api.anim.evP).mockClear();
  for (let i = 1; i <= 8; i++) {
    value.state.time = i / 120; value.emit('time', value.state.time); value.flush();
  }
  expect(value.api.anim.evP).not.toHaveBeenCalled();
  expect(value.text).not.toHaveBeenCalled();
  expect(value.fonts).not.toHaveBeenCalled();
  // A real edit must replace the retained value immediately.
  value.state.project.layers[0].p.opacity.v = 42;
  value.emit('project:changed', { kind: 'values' }); value.flush();
  expect(value.text.mock.calls.some(([text]) => text === '42')).toBe(true);
});

it('retains held property values until their value or key-navigation state changes', () => {
  const value = harness({ height: 300 });
  value.state.time = 1; value.emit('time', 1); value.flush();
  value.text.mockClear(); value.fonts.mockClear();
  value.state.time = 1.1; value.emit('time', 1.1); value.flush();
  expect(value.text).not.toHaveBeenCalled();
  expect(value.fonts).not.toHaveBeenCalled();
  vi.mocked(value.api.anim.evP).mockReturnValue(73);
  value.state.time = 1.2; value.emit('time', 1.2); value.flush();
  expect(value.text.mock.calls.some(([text]) => text === '73')).toBe(true);
  value.text.mockClear();
  value.state.time = 1.3; value.emit('time', 1.3); value.flush();
  expect(value.text).not.toHaveBeenCalled();
  // Moving onto a key changes the diamond even with an unchanged value.
  vi.mocked(value.api.anim.hasKeyAt).mockReturnValue({ t: 1.4 } as any);
  value.state.time = 1.4; value.emit('time', 1.4); value.flush();
  expect(value.text.mock.calls.length).toBeGreaterThan(0);
});

it('keeps library previews from consuming live row and readout invalidation', () => {
  const value = harness({ height: 300 });
  vi.mocked(value.api.anim.evP).mockReturnValue(73);
  value.state.time = 1;
  value.timeline.renderPreview(document.createElement('canvas'), 500, 300);
  value.text.mockClear();
  value.emit('time', 1); value.flush();
  expect(value.text.mock.calls.some(([text]) => text === '73')).toBe(true);
  const layer = value.state.project.layers[0];
  value.api.uiState.setLayerCollapsed(layer, true);
  value.timeline.renderPreview(document.createElement('canvas'), 500, 300);
  value.emit('time', 1); value.flush();
  expect(value.timeline.rows.filter((row: any) => row.L === layer)).toHaveLength(1);
});

it('advances the playback viewport in pages instead of rerasterizing it on every tick at the edge', () => {
  const value = harness({ collapsed: true, height: 300 });
  value.state.playing = true;
  value.state.time = 6.6;
  value.emit('time', value.state.time); value.flush();
  const firstPage = value.timeline.scrollT;
  expect(firstPage).toBeGreaterThan(0);
  value.text.mockClear();
  for (let i = 0; i < 60; i++) {
    value.state.time += 1 / 30;
    value.emit('time', value.state.time); value.flush();
    expect(value.timeline.scrollT).toBe(firstPage);
  }
  expect(value.text.mock.calls.length).toBe(0);
  value.state.time = 0;
  value.emit('time', 0); value.flush();
  expect(value.timeline.scrollT).toBeLessThanOrEqual(0);
});

it('updates visible property values while reusing static keyframes and labels', () => {
  const value = harness({ height: 300 });
  vi.mocked(value.api.anim.evP).mockClear();
  value.state.time = 1;
  value.emit('time', 1);
  value.flush();
  expect(value.copies.mock.calls.filter(args => args.length === 5)).toHaveLength(1);
  expect(value.copies.mock.calls.some(args => args.length === 9 && args[0] === value.timeline.cv)).toBe(true);
  expect(value.api.anim.evP).toHaveBeenCalled();
  expect(value.text.mock.calls.some(([text]) => String(text).startsWith('Layer '))).toBe(false);
  expect(value.text.mock.calls.some(([text]) => text === '100')).toBe(true);
});

it('refreshes the backdrop for edits, selection, viewport changes, and external repaint requests', () => {
  const value = harness({ collapsed: true, height: 300 });
  const tick = () => { value.state.time += 1 / 30; value.emit('time', value.state.time); value.flush(); };
  const expectRefresh = (change: () => void) => {
    value.text.mockClear(); change(); tick();
    expect(value.text.mock.calls.length).toBeGreaterThan(0);
    value.text.mockClear(); tick();
    expect(value.text.mock.calls.length).toBe(0);
  };
  expectRefresh(() => { value.timeline.pps = 120; });
  expectRefresh(() => { value.timeline.scrollY = 30; });
  expectRefresh(() => { value.timeline.w = 950; value.timeline.cv.width = 950; });
  expectRefresh(() => { value.state.project.revision = 1; });
  expectRefresh(() => { value.state.selection.layers = ['layer-0']; value.emit('selection', value.state.selection); });
  value.text.mockClear();
  value.emit('invalidate', 'timeline');
  expect(value.text.mock.calls.length).toBeGreaterThan(0);
});

it('refreshes an audio waveform that becomes ready between time ticks', () => {
  const value = harness({ collapsed: true, height: 300 });
  const layer = value.state.project.layers[0];
  layer.type = 'audio'; layer.d.asset = 'sound';
  const asset: any = { dur: 10, peaks: null };
  vi.mocked(value.api.media.assets.get).mockReturnValue(asset);
  value.emit('project:changed', { kind: 'structure' }); value.flush();
  vi.mocked(value.api.media.audio.drawWaveform).mockClear();
  value.emit('time', 1); value.flush();
  expect(value.api.media.audio.drawWaveform).not.toHaveBeenCalled();
  asset.peaks = new Float32Array([0, .5, 1]);
  value.emit('time', 2); value.flush();
  expect(value.api.media.audio.drawWaveform).toHaveBeenCalled();
});

it('fully redraws animated clip visibility and releases the single bitmap on disposal', () => {
  const value = harness({ collapsed: true, height: 300 });
  value.emit('time', 1); value.flush();
  const bitmap = value.copies.mock.calls[0]![0] as HTMLCanvasElement;
  expect(bitmap.width).toBe(900);
  value.state.project.layers[0].on = { v: true, kf: [{ t: 0, v: true }], expr: null };
  value.text.mockClear(); value.copies.mockClear();
  value.emit('time', 2); value.flush();
  expect(value.text.mock.calls.length).toBeGreaterThan(0);
  expect(value.copies).not.toHaveBeenCalled();
  expect(bitmap.width).toBe(0);
  delete value.state.project.layers[0].on;
  value.emit('time', 3); value.flush();
  value.copies.mockClear();
  value.emit('time', 4); value.flush();
  const replacement = value.copies.mock.calls[0]![0] as HTMLCanvasElement;
  value.timeline.disposeRuntime();
  expect(replacement.width).toBe(0);
});

it('repaints once per host frame and reuses rows while playing and scrubbing', () => {
  const value = harness();
  const rows = value.timeline.rows;
  for (const playing of [true, false]) {
    value.state.playing = playing;
    for (let i = 0; i < 4; i++) {
      value.state.time += 1 / 30;
      value.emit('time', value.state.time);
      value.api.transport.invalidate('timeline');
      value.flush();
    }
  }
  expect(value.paint).toHaveBeenCalledTimes(8);
  expect(value.api.anim.allProps).not.toHaveBeenCalled();
  expect(value.timeline.rows).toBe(rows);
});

it('refreshes cached rows for disclosure, reveal, keyframes, and search changes', () => {
  const value = harness();
  const layer = value.state.project.layers[0];
  value.api.uiState.setLayerCollapsed(layer, true);
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows.filter((row: any) => row.L === layer)).toHaveLength(1);
  value.api.uiState.setLayerCollapsed(layer, false);
  value.api.uiState.setReveal(layer, []);
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows.filter((row: any) => row.L === layer)).toHaveLength(1);
  value.api.uiState.setReveal(layer, ['opacity']);
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows.filter((row: any) => row.L === layer)).toHaveLength(2);
  const rows = value.timeline.rows;
  vi.mocked(value.api.anim.version).mockReturnValue(1);
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows).not.toBe(rows);
  value.timeline.search = 'Layer 199';
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows.filter((row: any) => row.kind === 'layer').map((row: any) => row.L.id)).toEqual(['layer-199']);
});

it('refreshes child rows when a group opens or closes', () => {
  const value = harness();
  const [group, child] = value.state.project.layers;
  group.type = 'group';
  child.group = group.id;
  vi.mocked(value.api.groups.ancestors).mockImplementation(layer => layer === child ? [group] : []);
  value.emit('project:changed', { kind: 'structure' });
  value.flush();
  expect(value.timeline.rows.some((row: any) => row.L === child)).toBe(true);
  value.api.uiState.setGroupCollapsed(group, true);
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows.some((row: any) => row.L === child)).toBe(false);
  value.api.uiState.setGroupCollapsed(group, false);
  value.emit('invalidate', 'timeline');
  expect(value.timeline.rows.some((row: any) => row.L === child)).toBe(true);
});

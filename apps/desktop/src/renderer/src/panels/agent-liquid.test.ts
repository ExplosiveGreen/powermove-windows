// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentLiquid } from './agent-liquid';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('reverses an interrupted morph and releases its frame and styles at rest', () => {
  let pending: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pending = null; });
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  const root = document.createElement('div'), surface = document.createElement('section'), bubble = document.createElement('button');
  root.append(surface, bubble); document.body.append(root);
  const liquid = createAgentLiquid(root, surface, bubble);
  const panel = { x: 40, y: 52, width: 400, height: 620 }, button = { x: 380, y: 700, width: 52, height: 52 };
  liquid.play(true, panel, button);
  expect(root.querySelector('svg')!.style.display).toBe('block');
  (pending as unknown as FrameRequestCallback)(60);
  const midShape = root.querySelector('rect')!.getAttribute('width');
  now.mockReturnValue(60);
  liquid.play(false, panel, button);
  expect(Number(root.querySelector('rect')!.getAttribute('width'))).toBeCloseTo(Number(midShape), 0);
  (pending as unknown as FrameRequestCallback)(650);
  expect(pending).toBeNull();
  expect(root.querySelector('svg')!.style.display).toBe('none');
  expect(surface.style.opacity).toBe('');
  expect(surface.style.filter).toBe('');
  liquid.destroy();
  expect(root.querySelector('svg')).toBeNull();
});
it('skips liquid motion for reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const request = vi.fn(); vi.stubGlobal('requestAnimationFrame', request);
  const root = document.createElement('div'), surface = document.createElement('section'), bubble = document.createElement('button');
  const liquid = createAgentLiquid(root, surface, bubble);
  const box = { x: 0, y: 0, width: 52, height: 52 };
  liquid.play(true, box, box);
  expect(request).not.toHaveBeenCalled();
  expect(root.querySelector('svg')!.style.display).toBe('none');
  liquid.destroy();
});

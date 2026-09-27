/** A temporary SVG silhouette carries the liquid; live chat is never filtered.
 * Inspired by liquid-gooey's separate silhouette/content architecture.
 * No observers or animation frames run while the agent is at rest. */
type Box = { x: number; y: number; width: number; height: number };
let nextId = 0;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function easeMorph(x: number): number {
  // Deliberate, reversible shape change: cubic-bezier(.77, 0, .175, 1).
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 12; i++) {
    t = (lo + hi) / 2;
    const curveX = 3 * (1 - t) ** 2 * t * .77 + 3 * (1 - t) * t ** 2 * .175 + t ** 3;
    if (curveX < x) lo = t; else hi = t;
  }
  return 3 * (1 - t) * t ** 2 + t ** 3;
}

export function createAgentLiquid(root: HTMLElement, surface: HTMLElement, bubble: HTMLElement) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const id = `agent-liquid-${++nextId}`;
  svg.classList.add('agent-liquid');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="6"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -8"/></filter></defs><g filter="url(#${id})" fill="currentColor"><rect/><circle/></g>`;
  const rect = svg.querySelector('rect')!;
  const tail = svg.querySelector('circle')!;
  root.prepend(svg);
  svg.style.display = 'none';
  let frame = 0;
  let progress = 0;
  let target = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    progress = target;
    svg.style.display = 'none';
    surface.style.removeProperty('opacity');
    bubble.style.removeProperty('opacity');
  };
  return {
    stop: finish,
    play(open: boolean, panel: Box, button: Box) {
      const wasAnimating = !!frame;
      cancelAnimationFrame(frame);
      target = open ? 1 : 0;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
      if (!wasAnimating) progress = open ? 0 : 1;
      const from = progress;
      const start = performance.now();
      const duration = 480 * Math.max(.35, Math.abs(target - from));
      const padding = 32;
      const left = Math.min(panel.x, button.x) - padding;
      const top = Math.min(panel.y, button.y) - padding;
      const width = Math.max(panel.x + panel.width, button.x + button.width) - left + padding;
      const height = Math.max(panel.y + panel.height, button.y + button.height) - top + padding;
      Object.assign(svg.style, { display: 'block', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
      const radius = Number.parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 16;
      const draw = (now: number) => {
        const elapsed = clamp((now - start) / duration);
        progress = mix(from, target, easeMorph(elapsed));
        const p = progress;
        const size = p;
        const w = mix(button.width, panel.width, size), h = mix(button.height, panel.height, size);
        const bx = button.x + button.width / 2, by = button.y + button.height / 2;
        const px = panel.x + panel.width / 2, py = panel.y + panel.height / 2;
        const cx = mix(bx, px, size), cy = mix(by, py, size);
        rect.setAttribute('x', String(cx - w / 2)); rect.setAttribute('y', String(cy - h / 2));
        rect.setAttribute('width', String(w)); rect.setAttribute('height', String(h));
        rect.setAttribute('rx', String(mix(26, radius, size)));
        const lag = 0;
        tail.setAttribute('cx', String(mix(bx, px, lag))); tail.setAttribute('cy', String(mix(by, py, lag)));
        tail.setAttribute('r', String(26 * (1 - p)));
        svg.style.color = `color-mix(in srgb, var(--accent) ${(1 - p) * 100}%, var(--bg-panel))`;
        surface.style.opacity = String(clamp((p - .7) / .3));
        bubble.style.opacity = String(clamp((.2 - p) / .2));
        if (elapsed < 1) frame = requestAnimationFrame(draw); else finish();
      };
      draw(start);
    },
    destroy() { finish(); svg.remove(); }
  };
}

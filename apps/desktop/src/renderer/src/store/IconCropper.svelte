<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { ICON_MIN_SIDE, type IconCrop } from './icon-image';

  /* Framing a store icon: the square is the icon, the image moves under it.
     Drag (or arrow keys) to move it, scroll, pinch, the slider or +/- to
     zoom. Zoom stops where the square would hold fewer than ICON_MIN_SIDE
     source pixels, so every framing it allows makes a sharp icon. */
  let { file, initial, busy = false, onconfirm, oncancel, onerror }: {
    file: Blob;
    initial?: IconCrop | null;
    busy?: boolean;
    onconfirm: (crop: IconCrop) => void;
    oncancel: () => void;
    onerror: (message: string) => void;
  } = $props();

  const VIEW = 168;
  const url = URL.createObjectURL(untrack(() => file));
  onDestroy(() => URL.revokeObjectURL(url));

  let width = $state(0);
  let height = $state(0);
  let zoom = $state(1);
  let cx = $state(0);
  let cy = $state(0);
  let dragging = $state(false);

  const short = $derived(Math.min(width, height));
  const maxZoom = $derived(short ? Math.max(1, Math.min(8, short / ICON_MIN_SIDE)) : 1);
  const side = $derived(short / zoom);
  const scale = $derived(side ? VIEW / side : 0);

  function clampCenter(): void {
    const half = side / 2;
    cx = Math.min(Math.max(cx, half), width - half);
    cy = Math.min(Math.max(cy, half), height - half);
  }

  function setZoom(next: number): void {
    zoom = Math.min(Math.max(next, 1), maxZoom);
    clampCenter();
  }

  function loaded(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    width = image.naturalWidth;
    height = image.naturalHeight;
    if (Math.min(width, height) < ICON_MIN_SIDE) {
      onerror(`Choose an image at least ${ICON_MIN_SIDE} pixels on its short side.`);
      return;
    }
    const framed = untrack(() => initial);
    if (framed) {
      zoom = Math.min(Math.max(short / framed.side, 1), maxZoom);
      cx = framed.x + framed.side / 2;
      cy = framed.y + framed.side / 2;
    } else {
      zoom = 1; cx = width / 2; cy = height / 2;
    }
    clampCenter();
  }

  let last: { x: number; y: number } | null = null;
  function pointerdown(event: PointerEvent): void {
    if (event.button !== 0 || !scale) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    (event.currentTarget as HTMLElement).focus();
    last = { x: event.clientX, y: event.clientY };
    dragging = true;
  }
  function pointermove(event: PointerEvent): void {
    if (!last || !scale) return;
    cx -= (event.clientX - last.x) / scale;
    cy -= (event.clientY - last.y) / scale;
    last = { x: event.clientX, y: event.clientY };
    clampCenter();
  }
  function pointerup(): void { last = null; dragging = false; }

  /* Wheel listeners are passive by default; zoom has to stop the sheet scrolling. */
  let view = $state<HTMLDivElement>();
  $effect(() => {
    const el = view;
    if (!el) return;
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  function wheel(event: WheelEvent): void {
    event.preventDefault();
    // Pinch arrives as ctrl+wheel with small deltas; both zoom.
    setZoom(zoom * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)));
  }

  function keydown(event: KeyboardEvent): void {
    const step = (event.shiftKey ? 40 : 8) / (scale || 1);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) { cx += moves[event.key]![0]; cy += moves[event.key]![1]; clampCenter(); }
    else if (event.key === '+' || event.key === '=') setZoom(zoom * 1.1);
    else if (event.key === '-') setZoom(zoom / 1.1);
    else if (event.key === 'Enter') confirm();
    else if (event.key === 'Escape') oncancel();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function confirm(): void {
    if (!short || busy) return;
    onconfirm({ x: cx - side / 2, y: cy - side / 2, side });
  }
</script>

<div class="pub-crop">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The framing square takes arrow keys to move the image and +/- to zoom.) -->
  <div
    class="pub-crop-view"
    class:is-dragging={dragging}
    style:width={`${VIEW}px`}
    style:height={`${VIEW}px`}
    role="group"
    aria-label="Icon framing. Drag or use the arrow keys to move, + and − to zoom."
    tabindex="0"
    onpointerdown={pointerdown}
    onpointermove={pointermove}
    onpointerup={pointerup}
    onpointercancel={pointerup}
    bind:this={view}
    onkeydown={keydown}
  >
    <img
      src={url}
      alt=""
      draggable="false"
      onload={loaded}
      onerror={() => onerror('Powermove can’t read this image. Choose a PNG, JPEG or WebP.')}
      style:width={`${width * scale}px`}
      style:height={`${height * scale}px`}
      style:transform={`translate(${VIEW / 2 - cx * scale}px, ${VIEW / 2 - cy * scale}px)`}
      style:opacity={short ? 1 : 0}
    />
    <span class="pub-crop-grid" aria-hidden="true"></span>
  </div>
  <div class="pub-crop-side">
    <span class="pub-icon-copy"><b>Frame your icon</b><span>Drag to move it. Scroll or use the slider to zoom.</span></span>
    <label class="pub-crop-zoom">
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" /></svg>
      <input type="range" min="1" max={maxZoom} step="0.01" value={zoom} disabled={maxZoom <= 1} aria-label="Zoom"
        oninput={(event) => setZoom(Number((event.currentTarget as HTMLInputElement).value))} />
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5" /></svg>
    </label>
    <span class="pub-icon">
      <button class="btn ghost" type="button" disabled={busy} onclick={oncancel}>Cancel</button>
      <button class="btn pri" type="button" disabled={busy || !short} onclick={confirm}>{busy ? 'Preparing…' : 'Use Icon'}</button>
    </span>
  </div>
</div>

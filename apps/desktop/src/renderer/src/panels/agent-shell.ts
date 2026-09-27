import { ensurePanel } from '../layout/panel';
import { movePreservingFocus, parkPanel } from '../layout/portal';
import './agent-shell.css';
import { AGENT_FEATURES } from './agent-features';
import { createAgentLiquid } from './agent-liquid';

export type AgentPresentation = 'floating' | 'docked';

type Point = { x: number; y: number };
type PM = Record<string, any>;

const MODE_KEY = 'agentPresentation';
const WINDOW_KEY = 'agentFloatingPosition';
const BUBBLE_KEY = 'agentBubblePosition';
const EDGE = 24;
const TOP = 52;
let activeShell: { destroy(): void } | null = null;

function storedPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function icon(PM: PM, name: string): Node | null {
  const result = PM.icon?.(name);
  return result instanceof Node ? result : null;
}

function button(PM: PM, name: string, label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.title = label;
  element.setAttribute('aria-label', label);
  const symbol = icon(PM, name);
  if (symbol) element.appendChild(symbol);
  return element;
}

/** One visual host for the registered panel. The panel's Svelte instance is
 * moved, never rebuilt, so drafts, selection and active runs survive changes
 * between the dock and the floating view. */
export function installAgentShell(PM: PM) {
  activeShell?.destroy();
  let preferredMode: AgentPresentation = AGENT_FEATURES.floating && PM.store?.get?.(MODE_KEY, 'docked') === 'floating' ? 'floating' : 'docked';
  let transientFloating = false;
  const getMode = (): AgentPresentation => transientFloating ? 'floating' : preferredMode;
  let open = false;
  let windowPosition = storedPoint(PM.store?.get?.(WINDOW_KEY, null));
  let bubblePosition = storedPoint(PM.store?.get?.(BUBBLE_KEY, null));

  const root = document.createElement('div');
  root.id = 'agent-floating-root';
  root.dataset.mode = getMode();
  const bubble = button(PM, 'sparkle', 'Open agent. Use arrow keys to move.', 'agent-floating-bubble');
  const surface = document.createElement('section');
  surface.className = 'agent-floating-window';
  surface.setAttribute('aria-label', 'Powermove agent');
  surface.inert = true;
  surface.setAttribute('aria-hidden', 'true');
  const header = document.createElement('header');
  header.className = 'agent-floating-header';
  const dragHandle = button(PM, 'grip', 'Move agent window. Use arrow keys to move.', 'agent-floating-drag');
  const heading = document.createElement('span');
  heading.className = 'agent-floating-title';
  heading.textContent = 'Agent';
  const spacer = document.createElement('span');
  spacer.className = 'agent-floating-spacer';
  const menuButton = button(PM, 'more', 'Agent presentation options', 'agent-floating-control');
  menuButton.hidden = !AGENT_FEATURES.floating;
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');
  const minimizeButton = button(PM, 'x', 'Minimize agent', 'agent-floating-control');
  const menu = document.createElement('div');
  menu.className = 'agent-floating-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Agent presentation');
  menu.hidden = true;
  const floatingItem = document.createElement('button');
  floatingItem.type = 'button';
  floatingItem.className = 'agent-floating-menu-item';
  floatingItem.setAttribute('role', 'menuitemradio');
  floatingItem.textContent = 'Floating';
  const dockedItem = document.createElement('button');
  dockedItem.type = 'button';
  dockedItem.className = 'agent-floating-menu-item';
  dockedItem.setAttribute('role', 'menuitemradio');
  dockedItem.textContent = 'Docked';
  menu.append(floatingItem, dockedItem);
  header.append(dragHandle, heading, spacer, menuButton, minimizeButton, menu);
  const dockButton = button(PM, 'more', 'Agent presentation options', 'agent-docked-presentation');
  dockButton.setAttribute('aria-haspopup', 'menu');
  dockButton.setAttribute('aria-expanded', 'false');
  const dockMenu = document.createElement('div');
  dockMenu.className = 'agent-docked-menu';
  dockMenu.setAttribute('role', 'menu');
  dockMenu.setAttribute('aria-label', 'Agent presentation');
  dockMenu.hidden = true;
  const dockFloatingItem = document.createElement('button');
  dockFloatingItem.type = 'button';
  dockFloatingItem.setAttribute('role', 'menuitemradio');
  dockFloatingItem.textContent = 'Floating';
  const dockDockedItem = document.createElement('button');
  dockDockedItem.type = 'button';
  dockDockedItem.setAttribute('role', 'menuitemradio');
  dockDockedItem.textContent = 'Docked';
  dockMenu.append(dockFloatingItem, dockDockedItem);
  const panelHost = document.createElement('div');
  panelHost.className = 'agent-floating-panel-host';
  surface.append(header, panelHost);
  root.append(bubble, surface, dockMenu);
  document.body.appendChild(root);
  const listeners = new AbortController();
  const liquid = createAgentLiquid(root, surface, bubble);

  function viewport() {
    return { width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight };
  }

  function sizeOf(element: HTMLElement, fallback: { width: number; height: number }) {
    // Use final layout dimensions, never an animated/scaled bounding rect.
    if (element === surface) {
      const view = viewport();
      return { width: Math.max(1, Math.min(400, view.width - EDGE * 2)), height: Math.max(1, Math.min(620, view.height - TOP - EDGE)) };
    }
    if (element === bubble) return { width: 52, height: 52 };
    const rect = element.getBoundingClientRect();
    return {
      width: element.offsetWidth || rect.width || fallback.width,
      height: element.offsetHeight || rect.height || fallback.height
    };
  }

  function constrain(point: Point, element: HTMLElement, fallback: { width: number; height: number }): Point {
    const { width, height } = sizeOf(element, fallback);
    return {
      x: clamp(point.x, EDGE, viewport().width - width - EDGE),
      y: clamp(point.y, TOP, viewport().height - height - EDGE)
    };
  }

  function initialWindowPosition(): Point {
    const size = sizeOf(surface, { width: 400, height: 620 });
    return { x: window.innerWidth - size.width - 22, y: window.innerHeight - size.height - 22 };
  }

  function initialBubblePosition(): Point {
    const size = sizeOf(bubble, { width: 52, height: 52 });
    return { x: window.innerWidth - size.width - 22, y: window.innerHeight - size.height - 22 };
  }

  function place(element: HTMLElement, value: Point): void {
    element.style.left = `${value.x}px`;
    element.style.top = `${value.y}px`;
  }

  function positionAll(): void {
    const size = sizeOf(surface, { width: 400, height: 620 });
    surface.style.width = `${size.width}px`;
    surface.style.height = `${size.height}px`;
    windowPosition = constrain(windowPosition ?? initialWindowPosition(), surface, { width: 400, height: 620 });
    bubblePosition = constrain(bubblePosition ?? initialBubblePosition(), bubble, { width: 52, height: 52 });
    place(surface, windowPosition);
    place(bubble, bubblePosition);
    const { width, height } = sizeOf(surface, { width: 400, height: 620 });
    surface.style.transformOrigin = `${clamp(bubblePosition.x + 26 - windowPosition.x, 0, width)}px ${clamp(bubblePosition.y + 26 - windowPosition.y, 0, height)}px`;
  }

  function currentPanel(): HTMLElement | null {
    return (PM.panelInst?.agent?.el as HTMLElement | undefined) ?? null;
  }

  function bindDockHeader(): void {
    if (!AGENT_FEATURES.floating) return;
    const panel = currentPanel();
    const panelHeader = panel?.querySelector<HTMLElement>(':scope > header');
    if (!panelHeader || dockButton.parentElement === panelHeader) return;
    const options = panelHeader.querySelector('.panel-options');
    if (options) options.before(dockButton);
    else panelHeader.append(dockButton);
  }

  function ensureAgentPanel(): HTMLElement | null {
    const existing = currentPanel();
    if (existing) return existing;
    if (!PM.PANELS?.agent || !PM.panelInst) return null;
    // The Projects home has no workspace manifest, but the global agent still
    // needs a live composer. This uses the same registered panel definition.
    return ensurePanel(PM, { id: 'agent' }, { id: 'right', panels: [] });
  }

  function attachFloatingPanel(): void {
    if (listeners.signal.aborted) return;
    if (getMode() !== 'floating') return;
    const panel = ensureAgentPanel();
    if (!panel) return;
    bindDockHeader();
    panel.dataset.agentFloating = '1';
    movePreservingFocus(panel, panelHost);
  }

  function menuOpen(next: boolean): void {
    menu.hidden = !next;
    menuButton.setAttribute('aria-expanded', String(next));
    if (next) floatingItem.focus();
  }

  function dockMenuOpen(next: boolean): void {
    dockMenu.hidden = !next;
    dockButton.setAttribute('aria-expanded', String(next));
    if (next) {
      const rect = dockButton.getBoundingClientRect();
      dockMenu.style.left = `${clamp(rect.left, EDGE, window.innerWidth - 150)}px`;
      dockMenu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 72)}px`;
      dockFloatingItem.focus();
    }
  }

  function sync(): void {
    root.dataset.mode = getMode();
    root.dataset.open = String(open);
    bubble.hidden = open || preferredMode !== 'floating';
    surface.inert = getMode() !== 'floating' || !open;
    surface.setAttribute('aria-hidden', String(getMode() !== 'floating' || !open));
    floatingItem.setAttribute('aria-checked', String(preferredMode === 'floating'));
    dockedItem.setAttribute('aria-checked', String(preferredMode === 'docked'));
    dockFloatingItem.setAttribute('aria-checked', String(preferredMode === 'floating'));
    dockDockedItem.setAttribute('aria-checked', String(preferredMode === 'docked'));
    if (!open) menuOpen(false);
    if (getMode() !== 'docked') dockMenuOpen(false);
    positionAll();
  }

  function refreshLayout(): void {
    const workspace = PM.Layout?.ws ?? PM.WS?.current;
    if (workspace && PM.Layout?.apply) PM.Layout.apply(workspace);
  }

  function setMode(next: AgentPresentation): void {
    if (next === 'floating' && !AGENT_FEATURES.floating) return;
    liquid.stop();
    if (next !== 'floating' && next !== 'docked') return;
    if (preferredMode === next && !transientFloating) return;
    preferredMode = next;
    transientFloating = false;
    dockMenuOpen(false);
    PM.store?.set?.(MODE_KEY, preferredMode);
    if (getMode() === 'floating') {
      open = false;
      attachFloatingPanel();
    } else {
      open = false;
      const panel = currentPanel();
      if (panel) {
        delete panel.dataset.agentFloating;
        parkPanel('agent', panel);
      }
    }
    sync();
    PM.bus?.emit?.('agent:presentation', getMode());
    refreshLayout();
  }

  function showFloating(): void {
    const opening = !open;
    if (opening && preferredMode === 'floating') {
      const size = sizeOf(surface, { width: 400, height: 620 });
      const anchor = bubblePosition!;
      windowPosition = constrain({
        x: anchor.x + (anchor.x + 26 > viewport().width / 2 ? 52 - size.width : 0),
        y: anchor.y + (anchor.y + 26 > viewport().height / 2 ? 52 - size.height : 0)
      }, surface, size);
    }
    open = true;
    sync();
    attachFloatingPanel();
    if (opening && preferredMode === 'floating') liquid.play(true, { ...windowPosition!, ...sizeOf(surface, { width: 400, height: 620 }) }, { ...bubblePosition!, width: 52, height: 52 });
    queueMicrotask(() => {
      const field = panelHost.querySelector<HTMLElement>('.agent-inline-prompt');
      field?.focus({ preventScroll: true });
      if (!field) dragHandle.focus({ preventScroll: true });
    });
  }

  function show(): void {
    if (transientFloating && !PM.ProjectsScreen?.isOpen && !PM.SettingsUI?.isOpen && !PM.isHomeProject?.()) {
      transientFloating = false;
      sync();
      PM.bus?.emit?.('agent:presentation', getMode());
    }
    if (getMode() === 'floating') { showFloating(); return; }
    refreshLayout();
    const panel = currentPanel();
    panel?.querySelector<HTMLElement>('.agent-inline-prompt')?.focus({ preventScroll: true });
  }

  function openGlobal(): void {
    if (getMode() !== 'floating') {
      transientFloating = true;
      PM.bus?.emit?.('agent:presentation', getMode());
      refreshLayout();
    }
    showFloating();
  }

  function minimize(): void {
    if (getMode() !== 'floating' || !open) return;
    const active = document.activeElement;
    open = false;
    if (transientFloating && preferredMode === 'docked') {
      liquid.stop();
      transientFloating = false;
      const panel = currentPanel();
      if (panel) { delete panel.dataset.agentFloating; parkPanel('agent', panel); }
      sync();
      PM.bus?.emit?.('agent:presentation', getMode());
      refreshLayout();
      return;
    }
    sync();
    // Keep the launcher attached to the moved panel, so it collapses locally
    // and the next open grows from exactly the same corner.
    const size = sizeOf(surface, { width: 400, height: 620 });
    bubblePosition = constrain({
      x: windowPosition!.x + (windowPosition!.x + size.width / 2 > viewport().width / 2 ? size.width - 52 : 0),
      y: windowPosition!.y + (windowPosition!.y + size.height / 2 > viewport().height / 2 ? size.height - 52 : 0)
    }, bubble, { width: 52, height: 52 });
    place(bubble, bubblePosition);
    PM.store?.set?.(BUBBLE_KEY, bubblePosition);
    liquid.play(false, { ...windowPosition!, ...size }, { ...bubblePosition, width: 52, height: 52 });
    if (active instanceof HTMLElement && surface.contains(active)) bubble.focus({ preventScroll: true });
  }

  function bindDrag(handle: HTMLElement, target: HTMLElement, kind: 'window' | 'bubble'): void {
    let start: { pointerId: number; x: number; y: number; position: Point; moved: boolean } | null = null;
    const point = () => kind === 'window' ? windowPosition! : bubblePosition!;
    const assign = (next: Point) => {
      if (kind === 'window') windowPosition = next;
      else bubblePosition = next;
      place(target, next);
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      liquid.stop();
      handle.focus({ preventScroll: true });
      start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, position: { ...point() }, moved: false };
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }, { signal: listeners.signal });
    handle.addEventListener('pointermove', (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) start.moved = true;
      if (!start.moved) return;
      assign(constrain({ x: start.position.x + dx, y: start.position.y + dy }, target,
        kind === 'window' ? { width: 400, height: 620 } : { width: 52, height: 52 }));
    }, { signal: listeners.signal });
    const finish = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      if (start.moved) {
        PM.store?.set?.(kind === 'window' ? WINDOW_KEY : BUBBLE_KEY, point());
        if (kind === 'bubble') bubble.dataset.dragged = '1';
      }
      start = null;
    };
    handle.addEventListener('pointerup', finish, { signal: listeners.signal });
    handle.addEventListener('pointercancel', finish, { signal: listeners.signal });
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 1 : 16;
      const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 }
        : event.key === 'ArrowRight' ? { x: step, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: -step }
        : event.key === 'ArrowDown' ? { x: 0, y: step } : null;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const old = point();
      const next = constrain({ x: old.x + delta.x, y: old.y + delta.y }, target,
        kind === 'window' ? { width: 400, height: 620 } : { width: 52, height: 52 });
      assign(next);
      PM.store?.set?.(kind === 'window' ? WINDOW_KEY : BUBBLE_KEY, next);
    }, { signal: listeners.signal });
  }

  bindDrag(dragHandle, surface, 'window');
  bindDrag(bubble, bubble, 'bubble');
  bubble.addEventListener('click', (event) => {
    if (bubble.dataset.dragged === '1') {
      delete bubble.dataset.dragged;
      event.preventDefault();
      return;
    }
    if (PM.SpatialAssistant?.open) PM.SpatialAssistant.open();
    else show();
  }, { signal: listeners.signal });
  minimizeButton.addEventListener('click', minimize, { signal: listeners.signal });
  menuButton.addEventListener('click', () => menuOpen(menu.hidden), { signal: listeners.signal });
  floatingItem.addEventListener('click', () => menuOpen(false), { signal: listeners.signal });
  dockedItem.addEventListener('click', () => { menuOpen(false); setMode('docked'); }, { signal: listeners.signal });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); menuOpen(false); menuButton.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      (document.activeElement === floatingItem ? dockedItem : floatingItem).focus();
    }
  }, { signal: listeners.signal });
  dockButton.addEventListener('click', () => dockMenuOpen(dockMenu.hidden), { signal: listeners.signal });
  dockFloatingItem.addEventListener('click', () => { dockMenuOpen(false); setMode('floating'); showFloating(); }, { signal: listeners.signal });
  dockDockedItem.addEventListener('click', () => dockMenuOpen(false), { signal: listeners.signal });
  dockMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); dockMenuOpen(false); dockButton.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      (document.activeElement === dockFloatingItem ? dockDockedItem : dockFloatingItem).focus();
    }
  }, { signal: listeners.signal });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !header.contains(event.target as Node)) menuOpen(false);
    if (!dockMenu.hidden && !dockMenu.contains(event.target as Node) && !dockButton.contains(event.target as Node)) dockMenuOpen(false);
  }, { signal: listeners.signal });
  root.addEventListener('keydown', (event) => {
    // Floating controls and chat own their keys, never the composition behind them.
    event.stopPropagation();
    if (event.key !== 'Escape' || getMode() !== 'floating' || !open || event.defaultPrevented) return;
    if (!surface.contains(document.activeElement)) return;
    if (!menu.hidden) return;
    // The composer owns Escape for command dismissal and field blur. A second
    // Escape from the shell minimizes the conversation.
    if (document.activeElement?.closest('.agent-composer')) return;
    event.preventDefault();
    minimize();
  }, { signal: listeners.signal });
  const onResize = () => { liquid.stop(); positionAll(); };
  window.addEventListener('resize', onResize, { signal: listeners.signal });
  window.visualViewport?.addEventListener('resize', onResize, { signal: listeners.signal });
  const onLayoutApplied = () => { bindDockHeader(); attachFloatingPanel(); };
  const offLayout = PM.bus?.on?.('layout:applied', onLayoutApplied);
  const offPresentation = PM.bus?.on?.('agent:presentation', attachFloatingPanel);
  const offProjects = PM.bus?.on?.('projects:screen', sync);
  const offSettings = PM.bus?.on?.('settings:screen', sync);
  sync();
  queueMicrotask(bindDockHeader);
  if (getMode() === 'floating') queueMicrotask(attachFloatingPanel);

  const api = {
    open: show,
    openGlobal,
    minimize,
    setMode,
    getMode,
    getPreference: () => preferredMode,
    isOpen: () => getMode() === 'floating' && open,
    destroy: () => {
      listeners.abort();
      liquid.destroy();
      offLayout?.();
      offPresentation?.();
      offProjects?.();
      offSettings?.();
      dockButton.remove();
      root.remove();
      if (activeShell === api) activeShell = null;
      if (PM.AgentShell === api) delete PM.AgentShell;
    }
  };
  PM.AgentShell = api;
  activeShell = api;
  return api;
}

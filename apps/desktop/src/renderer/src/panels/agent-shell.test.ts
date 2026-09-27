// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAgentShell } from './agent-shell';
import { AGENT_FEATURES } from './agent-features';
vi.mock('./agent-features', () => ({ AGENT_FEATURES: { floating: true } }));
import { parseStoreKey } from '../../../shared/store-keys';

type Shell = ReturnType<typeof installAgentShell>;
let shell: Shell | null = null;

function fixture(savedMode: 'floating' | 'docked' = 'floating', globalScreen = false) {
  const values = new Map<string, unknown>([['agentPresentation', savedMode]]);
  const subscriptions = new Map<string, Set<() => void>>();
  const panel = document.createElement('div');
  panel.id = 'panel-agent';
  const header = document.createElement('header');
  const options = document.createElement('button');
  options.className = 'panel-options';
  header.append(options);
  const body = document.createElement('div');
  body.className = 'body';
  body.append(document.createElement('input'));
  panel.append(header, body);
  const park = document.createElement('div');
  park.id = 'pm-panel-pool';
  const host = document.createElement('div');
  host.dataset.panelHost = 'agent';
  host.append(panel);
  park.append(host);
  document.body.append(park);
  const PM: Record<string, any> = {
    icon: () => document.createElement('svg'),
    panelInst: { agent: { el: panel } },
    store: {
      get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
      set: (key: string, value: unknown) => {
        if (!parseStoreKey(key)) throw new Error(`Unregistered store key: ${key}`);
        values.set(key, value);
      }
    },
    bus: {
      on: (name: string, listener: () => void) => {
        const group = subscriptions.get(name) ?? new Set();
        group.add(listener);
        subscriptions.set(name, group);
        return () => group.delete(listener);
      },
      emit: (name: string) => subscriptions.get(name)?.forEach((listener) => listener())
    },
    Layout: { ws: {}, apply: vi.fn() },
    ProjectsScreen: { isOpen: globalScreen },
    SpatialAssistant: { open: vi.fn() }
  };
  return { PM, panel, values };
}

beforeEach(() => {
  AGENT_FEATURES.floating = true;
  document.body.innerHTML = '';
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
});

afterEach(() => {
  shell?.destroy();
  shell = null;
  vi.unstubAllGlobals();
});

describe('agent shell', () => {
  it('ignores saved floating preferences and hides controls when the experiment is disabled', async () => {
    AGENT_FEATURES.floating = false;
    const { PM, panel } = fixture('floating');
    shell = installAgentShell(PM);
    await Promise.resolve();
    expect(shell.getPreference()).toBe('docked');
    shell.setMode('floating');
    expect(shell.getMode()).toBe('docked');
    expect(document.querySelector<HTMLButtonElement>('.agent-floating-bubble')!.hidden).toBe(true);
    expect(panel.querySelector('.agent-docked-presentation')).toBeNull();
    shell.openGlobal();
    expect(shell.isOpen()).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.agent-floating-control')!.hidden).toBe(true);
    shell.minimize();
    expect(shell.getMode()).toBe('docked');
    expect(document.querySelector<HTMLButtonElement>('.agent-floating-bubble')!.hidden).toBe(true);
  });

  it('moves one live panel between floating and docked presentation', async () => {
    const { PM, panel } = fixture();
    shell = installAgentShell(PM);
    await Promise.resolve();
    expect(document.querySelector('.agent-floating-panel-host > #panel-agent')).toBe(panel);
    expect(document.querySelector<HTMLButtonElement>('.agent-floating-bubble')?.hidden).toBe(false);

    shell.open();
    expect(shell.isOpen()).toBe(true);
    shell.minimize();
    expect(shell.isOpen()).toBe(false);
    shell.setMode('docked');
    expect(shell.getMode()).toBe('docked');
    expect(panel.closest('#pm-panel-pool')).not.toBeNull();
    expect(PM.Layout.apply).toHaveBeenCalled();
  });

  it('uses floating presentation temporarily for global chat without changing the saved preference', () => {
    const { PM, values } = fixture('docked', true);
    shell = installAgentShell(PM);
    const bubble = document.querySelector<HTMLButtonElement>('.agent-floating-bubble')!;
    expect(bubble.hidden).toBe(true);
    shell.openGlobal();
    expect(shell.getMode()).toBe('floating');
    expect(shell.getPreference()).toBe('docked');
    expect(values.get('agentPresentation')).toBe('docked');
    expect(bubble.hidden).toBe(true);
    shell.minimize();
    expect(shell.getMode()).toBe('docked');
    expect(shell.isOpen()).toBe(false);
    expect(bubble.hidden).toBe(true);
  });

  it('defaults to a docked panel with no launcher when no preference is saved', () => {
    const { PM, values, panel } = fixture();
    values.delete('agentPresentation');
    shell = installAgentShell(PM);
    expect(shell.getPreference()).toBe('docked');
    expect(panel.closest('#pm-panel-pool')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('.agent-floating-bubble')!.hidden).toBe(true);
  });

  it('clamps pointer dragging and keyboard movement to the viewport', () => {
    const { PM, values } = fixture();
    shell = installAgentShell(PM);
    const bubble = document.querySelector<HTMLButtonElement>('.agent-floating-bubble')!;
    const pointer = (name: string, x: number, y: number) => new PointerEvent(name, {
      bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y
    });
    bubble.dispatchEvent(pointer('pointerdown', 730, 530));
    expect(document.activeElement).toBe(bubble);
    bubble.dispatchEvent(pointer('pointermove', 3000, 3000));
    bubble.dispatchEvent(pointer('pointerup', 3000, 3000));
    expect(Number.parseFloat(bubble.style.left)).toBe(724);
    expect(Number.parseFloat(bubble.style.top)).toBe(524);
    bubble.click();
    expect(PM.SpatialAssistant.open).not.toHaveBeenCalled();
    bubble.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    expect(Number.parseFloat(bubble.style.left)).toBe(708);
    expect(values.get('agentBubblePosition')).toEqual({ x: 708, y: 524 });
  });

  it('keeps floating control shortcuts out of the editor', () => {
    const { PM } = fixture();
    shell = installAgentShell(PM);
    shell.open();
    const handle = document.querySelector<HTMLButtonElement>('.agent-floating-drag')!;
    const editorShortcut = vi.fn();
    window.addEventListener('keydown', editorShortcut);
    try {
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
      expect(document.activeElement).toBe(handle);
      handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
      handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
      expect(editorShortcut).not.toHaveBeenCalled();
      handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      expect(shell.isOpen()).toBe(false);
    } finally {
      window.removeEventListener('keydown', editorShortcut);
    }
  });

  it('keeps the chosen window position across reopen and restart', () => {
    const { PM, values } = fixture();
    values.set('agentFloatingPosition', { x: 120, y: 52 });
    values.set('agentBubblePosition', { x: 120, y: 524 });
    shell = installAgentShell(PM);
    shell.open();
    const surface = document.querySelector<HTMLElement>('.agent-floating-window')!;
    expect(surface.style.left).toBe('120px');
    shell.minimize();
    shell.open();
    expect(surface.style.left).toBe('120px');
    shell.destroy();
    shell = installAgentShell(PM);
    shell.open();
    expect(document.querySelector<HTMLElement>('.agent-floating-window')!.style.left).toBe('120px');
  });

  it('opens from the launcher instead of an unrelated saved panel position', () => {
    const { PM, values } = fixture();
    values.set('agentFloatingPosition', { x: 376, y: 52 });
    values.set('agentBubblePosition', { x: 60, y: 60 });
    shell = installAgentShell(PM);
    shell.open();
    const surface = document.querySelector<HTMLElement>('.agent-floating-window')!;
    expect(surface.style.left).toBe('60px');
    expect(surface.style.top).toBe('52px');
    shell.minimize();
    const bubble = document.querySelector<HTMLElement>('.agent-floating-bubble')!;
    expect(bubble.style.left).toBe('60px');
    expect(bubble.style.top).toBe('524px');
    shell.open();
    expect(surface.style.left).toBe('60px');
    expect(surface.style.top).toBe('52px');
  });

  it('fits the entire panel after edge dragging, rapid reopen, and viewport shrinking', () => {
    const { PM, values } = fixture();
    values.set('agentFloatingPosition', { x: 2000, y: 2000 });
    shell = installAgentShell(PM);
    shell.open();
    const surface = document.querySelector<HTMLElement>('.agent-floating-window')!;
    // Stale transformed geometry must never determine the final position.
    surface.getBoundingClientRect = () => ({ width: 180, height: 200 } as DOMRect);
    shell.minimize(); shell.open();
    expect(surface.style.left).toBe('376px');
    expect(surface.style.top).toBe('52px');
    expect(surface.style.width).toBe('400px');
    expect(surface.style.height).toBe('524px');
    shell.minimize();
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 450);
    window.dispatchEvent(new Event('resize'));
    shell.open();
    expect(surface.style.left).toBe('24px');
    expect(surface.style.width).toBe('312px');
    expect(surface.style.height).toBe('374px');
    expect(Number.parseFloat(surface.style.top) + Number.parseFloat(surface.style.height)).toBe(426);
  });
});

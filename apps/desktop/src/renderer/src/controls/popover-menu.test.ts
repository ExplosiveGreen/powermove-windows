// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPopoverMenu } from './popover-menu';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  window.dispatchEvent(new Event('blur'));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function trigger(label: string) {
  const button = document.createElement('button');
  const icon = document.createElement('span');
  button.append(icon);
  document.body.append(button);
  const run = vi.fn();
  const onClose = vi.fn();
  button.onclick = () => { openPopoverMenu({ anchor: button, label, items: [{ label: 'Action', run }], onClose }); };
  return { button, icon, run, onClose };
}
function press(node: HTMLElement) {
  node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  node.click();
}

describe('popover trigger toggling', () => {
  it('closes on a second trigger press, including its icon, and reopens on the next press', () => {
    const { button, icon, onClose, run } = trigger('Extension actions');
    press(icon);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    press(icon);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    expect(onClose).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    press(button);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });
  it('switches to another trigger and dismisses on outside press', () => {
    const a = trigger('First'), b = trigger('Second');
    press(a.button); press(b.button);
    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Second');
    expect(a.onClose).toHaveBeenCalledOnce();
    expect(a.button.getAttribute('aria-expanded')).toBe('false');
    press(document.body);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(b.onClose).toHaveBeenCalledOnce();
  });
  it('supports keyboard activation, Escape, and menu actions', () => {
    const { button, run } = trigger('Actions');
    button.click(); button.click(); // Keyboard-generated clicks have no pointerdown.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    button.click();
    document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    button.click();
    document.querySelector<HTMLElement>('[role="menuitem"]')!.click();
    expect(run).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

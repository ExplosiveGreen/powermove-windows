import { describe, expect, it, vi } from 'vitest';

import { createUserInput, USER_INPUT_MS, type InputContents } from './user-input';

/** A window's contents: emits Electron's input events, and answers for its main frame's activation. */
function contents(activation: boolean | Error = false) {
  const listeners = new Map<string, (event: unknown, input: { type: string; key?: string }) => void>();
  let blur = (): void => {};
  const executeJavaScript = vi.fn(async (_code: string) => { if (activation instanceof Error) throw activation; return activation; });
  const target = {
    on: (name: string, listener: (event: unknown, input: { type: string; key?: string }) => void) => { listeners.set(name, listener); return target; },
    isDestroyed: () => false,
    mainFrame: { executeJavaScript }
  };
  return {
    target: target as unknown as InputContents, executeJavaScript,
    key: (key: string, type = 'keyDown') => listeners.get('before-input-event')!({}, { type, key }),
    input: (type: string) => listeners.get('input-event')!({}, { type }),
    onBlur: (forget: () => void) => { blur = forget; },
    blur: () => blur()
  };
}

describe('user input', () => {
  it('counts a key or button press for 5 seconds', async () => {
    let clock = 1_000;
    const input = createUserInput(() => clock);
    const window = contents();
    input.track(window.target, window.onBlur);
    expect(await input.acted(window.target)).toBe(false);
    window.key('c');
    expect(await input.acted(window.target)).toBe(true);
    clock += USER_INPUT_MS;
    expect(await input.acted(window.target)).toBe(false);
    window.input('mouseDown');
    expect(await input.acted(window.target)).toBe(true);
  });

  it('ignores key releases, pointer moves, wheel, modifier keys and Escape alone', async () => {
    const input = createUserInput(() => 1_000);
    const window = contents();
    input.track(window.target);
    window.key('c', 'keyUp');
    for (const key of ['Meta', 'Shift', 'Alt', 'Control', 'CapsLock', 'Escape']) window.key(key);
    for (const type of ['mouseMove', 'mouseUp', 'mouseWheel', 'mouseEnter', 'keyDown', 'rawKeyDown']) window.input(type);
    expect(await input.acted(window.target)).toBe(false);
  });

  it('forgets presses when the window loses focus, so Command-Tab back is not an action', async () => {
    let clock = 1_000;
    const input = createUserInput(() => clock);
    const window = contents(true);
    input.track(window.target, window.onBlur);
    window.key('c');
    window.blur();
    clock += 1_000;
    // The document still holds the activation from before the blur: it does not count yet.
    expect(await input.acted(window.target)).toBe(false);
    expect(window.executeJavaScript).not.toHaveBeenCalled();
    clock += USER_INPUT_MS;
    expect(await input.acted(window.target)).toBe(true);
  });

  it('falls back to the app document’s own transient activation for clicks main does not see', async () => {
    const input = createUserInput(() => 1_000);
    const active = contents(true);
    input.track(active.target);
    expect(await input.acted(active.target)).toBe(true);
    expect(active.executeJavaScript).toHaveBeenCalledWith('navigator.userActivation?.isActive === true');
    for (const answer of [false, new Error('frame gone')]) {
      const window = contents(answer);
      input.track(window.target);
      expect(await input.acted(window.target)).toBe(false);
    }
  });
});

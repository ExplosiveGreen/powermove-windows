import type { WebContents } from 'electron';

/**
 * Whether a person just pressed a key or a button in an app window, for the
 * channels an extension may reach only in answer to one (`ui.copy`).
 *
 * Main records what it sees itself: key presses from `before-input-event`,
 * which covers keys typed into sandboxed extension views too (they are frames
 * of the same WebContents), and mouse, touch and key presses from
 * `input-event`. Modifier keys and Escape alone do not count, so the Command
 * of a Command-Tab away and back is not an action, and nothing counts from
 * before the window last lost focus. A click inside a view that runs in its
 * own process may reach the view's widget and not the window's, so main then
 * asks the app document itself for its transient user activation: Chromium
 * extends a frame's activation to all of its ancestors, lets it lapse after 5
 * seconds, and no script can grant it. That answer cannot tell when the
 * activation happened, so it counts only once the window has kept focus for
 * longer than an activation lasts.
 *
 * The agent's computer_use_panel input is real Chromium input too, so while it
 * drives a window, and for as long as an activation lasts after, nothing in
 * that window counts.
 */
export const USER_INPUT_MS = 5_000;

const PRESSES = new Set(['mouseDown', 'pointerDown', 'touchStart', 'gestureTapDown', 'rawKeyDown', 'keyDown']);
const NOT_AN_ACTION = new Set(['Meta', 'Control', 'Alt', 'AltGraph', 'Shift', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'Escape']);

export type InputContents = Pick<WebContents, 'on' | 'isDestroyed'> & {
  mainFrame: Pick<WebContents['mainFrame'], 'executeJavaScript'>;
};

export interface UserInput {
  /** Records presses in `contents`; `onBlur` subscribes to its window losing focus, which forgets them. */
  track(contents: InputContents, onBlur?: (forget: () => void) => void): void;
  /** True when the person pressed something in `contents` within USER_INPUT_MS. */
  acted(contents: InputContents): Promise<boolean>;
  /** Marks `contents` driven by the agent until the returned release runs, and for USER_INPUT_MS after. */
  drive(contents: object): () => void;
}

export function createUserInput(now: () => number = () => performance.now()): UserInput {
  const last = new WeakMap<object, number>();
  const blurred = new WeakMap<object, number>();
  const driving = new WeakMap<object, number>();
  const driven = new WeakMap<object, number>();
  const recent = (map: WeakMap<object, number>, contents: object): boolean => now() - (map.get(contents) ?? -Infinity) < USER_INPUT_MS;
  const press = (contents: object, type: string, key?: string): void => {
    if (!PRESSES.has(type) || (key !== undefined && NOT_AN_ACTION.has(key))) return;
    last.set(contents, now());
  };
  return {
    track(contents, onBlur) {
      contents.on('before-input-event', (_event, input) => press(contents, input.type, input.key));
      contents.on('input-event', (_event, input) => {
        // Key presses are before-input-event's, which knows the key.
        if (input.type !== 'rawKeyDown' && input.type !== 'keyDown') press(contents, input.type);
      });
      onBlur?.(() => { last.delete(contents); blurred.set(contents, now()); });
    },
    async acted(contents) {
      if (contents.isDestroyed() || driving.get(contents) || recent(driven, contents)) return false;
      if (recent(last, contents)) return true;
      if (recent(blurred, contents)) return false;
      try {
        return await contents.mainFrame.executeJavaScript('navigator.userActivation?.isActive === true') === true;
      } catch {
        return false;
      }
    },
    drive(contents) {
      driving.set(contents, (driving.get(contents) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        driving.set(contents, driving.get(contents)! - 1);
        driven.set(contents, now());
      };
    }
  };
}

/** The app windows' input, shared by the channels that need it. */
export const userInput = createUserInput();

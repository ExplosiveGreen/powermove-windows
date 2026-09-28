import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  clipboard: { writeText: vi.fn(), readText: vi.fn() }
}));

import { registerClipboardIpc } from './clipboard';
import { CLIPBOARD_TEXT_MAX_CHARS, IPC } from '../shared/ipc';

function register({ trusted = true, focused = true, window = true } = {}) {
  const handlers = new Map<string, (event: any, text: unknown) => unknown>();
  const writeText = vi.fn();
  registerClipboardIpc({ handle: (channel: string, handler: any) => { handlers.set(channel, handler); } } as any, {
    isTrustedSender: () => trusted,
    windowFor: () => window ? { isDestroyed: () => false, isFocused: () => focused } : null,
    writeText
  });
  return { handle: handlers.get(IPC.clipboardWriteText)!, writeText, channels: [...handlers.keys()] };
}

describe('registerClipboardIpc', () => {
  it('writes plain text from the trusted, focused app window', () => {
    const { handle, writeText, channels } = register();
    handle({ sender: {} }, 'hello');
    expect(writeText).toHaveBeenCalledWith('hello');
    // Write only: no channel reads the clipboard back.
    expect(channels).toEqual([IPC.clipboardWriteText]);
  });

  it('refuses untrusted senders, background windows, non-text and oversized text', () => {
    for (const options of [{ trusted: false }, { focused: false }, { window: false }]) {
      const { handle, writeText } = register(options);
      expect(() => handle({ sender: {} }, 'hello')).toThrow();
      expect(writeText).not.toHaveBeenCalled();
    }
    const { handle, writeText } = register();
    for (const value of [undefined, 42, { text: 'x' }, ['x'], 'x'.repeat(CLIPBOARD_TEXT_MAX_CHARS + 1)]) expect(() => handle({ sender: {} }, value)).toThrow();
    handle({ sender: {} }, 'x'.repeat(CLIPBOARD_TEXT_MAX_CHARS));
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

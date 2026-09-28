import { BrowserWindow, clipboard, type IpcMain, type IpcMainInvokeEvent } from 'electron';

import { CLIPBOARD_TEXT_MAX_CHARS, IPC } from '../shared/ipc';

export interface ClipboardIpcContext {
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  /** Test seams; default to the sender's BrowserWindow and Electron's clipboard. */
  windowFor?: (event: IpcMainInvokeEvent) => Pick<BrowserWindow, 'isDestroyed' | 'isFocused'> | null;
  writeText?: (text: string) => void | Promise<void>;
}

/**
 * Plain-text clipboard writes for the app document (`ui.copy` for sandboxed
 * extensions goes through here once the kernel has checked its permission
 * and focus). Main checks focus itself: a window in the background never
 * writes. There is no read channel.
 */
export function registerClipboardIpc(ipcMain: Pick<IpcMain, 'handle'>, ctx: ClipboardIpcContext): void {
  const windowFor = ctx.windowFor ?? ((event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender));
  const writeText = ctx.writeText ?? ((text: string) => clipboard.writeText(text));
  ipcMain.handle(IPC.clipboardWriteText, async (event: IpcMainInvokeEvent, text: unknown): Promise<void> => {
    if (!ctx.isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
    if (typeof text !== 'string' || text.length > CLIPBOARD_TEXT_MAX_CHARS) throw new Error(`${IPC.clipboardWriteText} takes text up to ${CLIPBOARD_TEXT_MAX_CHARS} characters`);
    const window = windowFor(event);
    if (!window || window.isDestroyed() || !window.isFocused()) throw new Error('The clipboard is written only from the focused window');
    await writeText(text);
  });
}

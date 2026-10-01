import { execFile } from 'node:child_process';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { fontFamilies } from '@powermove/macos-haptics';
import { IPC } from '../shared/ipc';

function windowsFontFamilies(): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) { resolve(null); return; }
        const families = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
        resolve(families.length ? [...new Set(families)].sort((a, b) => a.localeCompare(b)) : null);
      });
  });
}

export function registerFontsIpc(ipc: Pick<IpcMain, 'handle'>, ctx: {
  isTrustedSenderContents(sender: IpcMainInvokeEvent['sender']): boolean;
}) {
  ipc.handle(IPC.fontFamilies, event => {
    if (!ctx.isTrustedSenderContents(event.sender)) return null;
    if (process.platform === 'win32') return windowsFontFamilies();
    return fontFamilies();
  });
}

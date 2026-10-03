import { app, type WebContents } from 'electron';

/* A dead renderer is otherwise a dead app: the window stays blank, menu IPC
   goes nowhere, and the save-before-quit handshake never answers, so even the
   close button stops working. The most common native cause on a fresh machine
   is a broken GPU driver. After one native crash, restart once with software
   rendering rather than leaving the user stranded. Never loops: the flag
   disables itself, and a second crash (already software-rendered) is left
   alone for normal diagnosis. */
let softwareFallbackUsed = false;

export function resetRendererCrashRecoveryForTests(): void {
  softwareFallbackUsed = false;
}

export function installRendererCrashRecovery(contents: WebContents): void {
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'crashed') return;
    if (softwareFallbackUsed || process.argv.includes('--disable-gpu')) return;
    softwareFallbackUsed = true;
    console.error(`[recovery] renderer crashed (exit ${details.exitCode}); relaunching with software rendering`);
    app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu']) });
    app.exit(0);
  });
}

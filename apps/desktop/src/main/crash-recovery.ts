import { app, crashReporter, type WebContents } from 'electron';

/* Store native crash dumps locally (never uploaded) so a crash can be
   diagnosed from the .dmp file afterwards. */
export function initCrashReporter(): void {
  try {
    crashReporter.start({ uploadToServer: false });
    console.error(`[recovery] crash dumps: ${app.getPath('crashDumps')}`);
  } catch (error) {
    console.error(`[recovery] crash reporter unavailable: ${String(error)}`);
  }
}

/* A dead renderer is otherwise a dead app: the window stays blank, menu IPC
   goes nowhere, and the save-before-quit handshake never answers, so even the
   close button stops working. The most common native causes on a fresh machine
   are a broken GPU driver or an antivirus/overlay killing the renderer, so
   any abnormal renderer death (crash, kill, oom) restarts the app once with
   software rendering rather than leaving the user stranded. Never loops: the
   flag disables itself, and a second death (already software-rendered) is left
   alone for normal diagnosis. */
let softwareFallbackUsed = false;

export function resetRendererCrashRecoveryForTests(): void {
  softwareFallbackUsed = false;
}

export function installRendererCrashRecovery(contents: WebContents): void {
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'crashed' && details.reason !== 'killed' && details.reason !== 'oom') return;
    if (softwareFallbackUsed || process.argv.includes('--disable-gpu')) return;
    softwareFallbackUsed = true;
    console.error(`[recovery] renderer ${details.reason} (exit ${details.exitCode}); relaunching with software rendering`);
    app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu']) });
    app.exit(0);
  });
}

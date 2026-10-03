import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { relaunch: vi.fn(), exit: vi.fn(), getPath: vi.fn(() => '/tmp/crashes') },
  crashReporter: { start: vi.fn() },
}));

vi.mock('electron', () => ({ app: mocks.app, crashReporter: mocks.crashReporter }));

import { initCrashReporter, installRendererCrashRecovery, resetRendererCrashRecoveryForTests } from './crash-recovery';

function contents() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.({}, ...args),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRendererCrashRecoveryForTests();
});

describe('installRendererCrashRecovery', () => {
  it('ignores clean exits, only abnormal renderer deaths relaunch', () => {
    const webContents = contents();
    installRendererCrashRecovery(webContents as never);

    webContents.emit('render-process-gone', { reason: 'clean-exit' });
    expect(mocks.app.relaunch).not.toHaveBeenCalled();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });

  it.each(['crashed', 'killed', 'oom'])('relaunches once with software rendering after %s', (reason) => {
    resetRendererCrashRecoveryForTests();
    vi.clearAllMocks();
    const webContents = contents();
    installRendererCrashRecovery(webContents as never);

    webContents.emit('render-process-gone', { reason, exitCode: -1 });
    expect(mocks.app.relaunch).toHaveBeenCalledTimes(1);
    expect(mocks.app.relaunch.mock.calls[0]![0].args).toContain('--disable-gpu');
    expect(mocks.app.exit).toHaveBeenCalledWith(0);

    // A second death (already software-rendered) never loops.
    webContents.emit('render-process-gone', { reason, exitCode: -1 });
    expect(mocks.app.relaunch).toHaveBeenCalledTimes(1);
  });

  it('starts the local crash reporter', () => {
    initCrashReporter();
    expect(mocks.crashReporter.start).toHaveBeenCalledWith({ uploadToServer: false });
  });
});

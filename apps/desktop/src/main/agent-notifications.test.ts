import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ show: vi.fn(), play: vi.fn(), handle: vi.fn(), create: vi.fn() }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/test/powermove' },
  BrowserWindow: { fromWebContents: vi.fn() },
  Notification: class { static isSupported() { return true; } constructor(options: unknown) { mocks.create(options); } on() {} show() { mocks.show(); } },
}));
vi.mock('node:child_process', () => ({ execFile: mocks.play }));
import { registerAgentNotifications } from './agent-notifications';
beforeEach(() => vi.clearAllMocks());
function handler(trusted = true) {
  registerAgentNotifications({ handle: mocks.handle }, { isTrustedSenderContents: () => trusted });
  return (options: unknown) => mocks.handle.mock.calls[0]![1]({ sender: {} }, options);
}
it('shows one silent desktop banner on completion', () => {
  handler()({ sound: 'None' });
  expect(mocks.show).toHaveBeenCalledTimes(1);
  expect(mocks.play).not.toHaveBeenCalled();
});
it('previews without sending a banner', () => {
  handler()({ sound: 'Glass', preview: true });
  expect(mocks.show).not.toHaveBeenCalled();
  if (process.platform === 'darwin') expect(mocks.play).toHaveBeenCalledWith('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff'], expect.any(Function));
});
it('rejects untrusted senders and unknown sound paths', () => {
  handler(false)({ sound: 'Glass' });
  expect(mocks.show).not.toHaveBeenCalled();
  mocks.handle.mockClear();
  handler()({ sound: '../../bad' });
  expect(mocks.show).not.toHaveBeenCalled();
  expect(mocks.play).not.toHaveBeenCalled();
});

it('plays the approved bundled sound for completion and preview', () => {
  const notify = handler();
  notify({ sound: 'Little Victory (Deep)' });
  notify({ sound: 'Little Victory (Deep)', preview: true });
  expect(mocks.show).toHaveBeenCalledTimes(1);
  if (process.platform === 'darwin') {
    expect(mocks.play).toHaveBeenCalledTimes(2);
    expect(mocks.play).toHaveBeenCalledWith('/usr/bin/afplay', ['/test/powermove/resources/sounds/little-victory-deep.wav'], expect.any(Function));
  }
});

it('names the question when the agent asks one', () => {
  handler()({ sound: 'None', question: 'Replace the title\nor add a group?' });
  expect(mocks.create).toHaveBeenCalledWith({ title: 'Your agent has a question', body: 'Replace the title or add a group?', silent: true });
  expect(mocks.show).toHaveBeenCalledTimes(1);
});

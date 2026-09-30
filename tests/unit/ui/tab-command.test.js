import { sendTabCommand } from '../../../src/ui/popup/tab-command.js';
import { installChromeMock } from '../../helpers/chrome-mock.js';

describe('Popup commands across frames', () => {
  let listeners;
  let send;
  let command;

  beforeEach(() => {
    installChromeMock();
    vi.useFakeTimers();
    listeners = new Set();
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((listener) =>
      listeners.add(listener)
    );
    chrome.runtime.onMessage.removeListener = vi.fn((listener) => listeners.delete(listener));
    send = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tab, message, callback) => {
      command = message;
      callback({ ok: true, mediaCount: 0, currentSpeed: null, speeds: [] });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete chrome.runtime.onMessage.removeListener;
    vi.useRealTimers();
  });

  function reply(frameId, response, overrides = {}) {
    for (const listener of listeners) {
      listener(
        { type: 'VSC_FRAME_RESULT', commandId: command.commandId, response },
        {
          id: chrome.runtime.id,
          tab: { id: 1 },
          frameId,
          ...overrides,
        }
      );
    }
  }

  it('finds an iframe video when the media-less parent replies first', async () => {
    const result = sendTabCommand(1, { type: 'VSC_GET_STATUS' });
    reply(0, { ok: true, mediaCount: 0, speeds: [] });
    reply(2, { ok: true, mediaCount: 1, currentSpeed: 1.5, speeds: [1.5] });
    await vi.advanceTimersByTimeAsync(350);
    await expect(result).resolves.toEqual({
      ok: true,
      mediaCount: 1,
      currentSpeed: 1.5,
      speeds: [1.5],
    });
    expect(listeners.size).toBe(0);
    expect(send).toHaveBeenCalledOnce();
  });

  it('combines mixed speeds and does not double-count a frame', async () => {
    const result = sendTabCommand(1, { type: 'VSC_SET_SPEED', payload: { speed: 2 } });
    reply(0, { ok: true, mediaCount: 1, speeds: [1] });
    reply(0, { ok: true, mediaCount: 1, speeds: [1] });
    reply(4, { ok: true, mediaCount: 2, speeds: [1, 2] });
    reply(5, { ok: false, mediaCount: null });
    await vi.advanceTimersByTimeAsync(350);
    await expect(result).resolves.toEqual({
      ok: true,
      mediaCount: 3,
      currentSpeed: null,
      speeds: [1, 2],
    });
  });

  it('ignores responses from another tab, extension, or command', async () => {
    const result = sendTabCommand(1, { type: 'VSC_GET_STATUS' });
    reply(2, { ok: true, mediaCount: 1, speeds: [2] }, { tab: { id: 2 } });
    reply(2, { ok: true, mediaCount: 1, speeds: [2] }, { id: 'another-extension' });
    for (const listener of listeners) {
      listener(
        {
          type: 'VSC_FRAME_RESULT',
          commandId: 'another-command',
          response: { ok: true, mediaCount: 1 },
        },
        {
          id: chrome.runtime.id,
          tab: { id: 1 },
          frameId: 2,
        }
      );
    }
    await vi.advanceTimersByTimeAsync(350);
    await expect(result).resolves.toMatchObject({ ok: true, mediaCount: 0 });
  });

  it('still accepts the callback from a bridge that predates frame collection', async () => {
    send.mockImplementation((_tab, _message, callback) =>
      callback({ ok: true, mediaCount: 1, currentSpeed: 2 })
    );
    const result = sendTabCommand(1, { type: 'VSC_GET_STATUS' });
    await vi.advanceTimersByTimeAsync(350);
    await expect(result).resolves.toMatchObject({ ok: true, mediaCount: 1, currentSpeed: 2 });
  });

  it('cleans up after API exceptions, channel errors, and popup closure', async () => {
    send.mockImplementationOnce(() => {
      throw new Error('Invalid context');
    });
    await expect(sendTabCommand(1, {})).rejects.toThrow('Invalid context');
    expect(listeners.size).toBe(0);
    send.mockImplementationOnce((_tab, _message, callback) => {
      chrome.runtime.lastError = { message: 'No receiver' };
      callback();
      chrome.runtime.lastError = null;
    });
    await expect(sendTabCommand(1, {})).rejects.toThrow('No receiver');
    expect(listeners.size).toBe(0);
    const result = sendTabCommand(1, {});
    const expectation = expect(result).rejects.toThrow('Popup closed');
    window.dispatchEvent(new Event('pagehide'));
    await expectation;
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

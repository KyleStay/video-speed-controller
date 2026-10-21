import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  collectTabDiagnostics,
  initializeDiagnosticsPanel,
  projectDiagnosticReport,
} from '../../../src/ui/popup/diagnostics.js';
import { installChromeMock } from '../../helpers/chrome-mock.js';

const popupHtml = readFileSync(resolve(process.cwd(), 'src/ui/popup/popup.html'), 'utf8');
const report = (active = false) => ({
  schema: 1,
  active,
  reason: 'manual',
  events: [
    {
      seq: 1,
      t: 12,
      event: 'loadstart',
      page: { x: 0, y: 720 },
      media: { rect: { x: 0, y: 100, width: 240, height: 135 }, paused: true },
    },
  ],
});

describe('Popup video diagnostics', () => {
  let listeners;
  let command;
  let send;
  let cleanup;
  let timeout;
  let clearTimeoutSpy;
  let originalClipboard;
  let originalShare;
  let originalCanShare;
  let originalCreate;
  let originalRevoke;
  beforeEach(() => {
    installChromeMock();
    vi.useFakeTimers();
    timeout = vi.spyOn(globalThis, 'setTimeout');
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    listeners = new Set();
    vi.spyOn(chrome.runtime.onMessage, 'addListener').mockImplementation((listener) =>
      listeners.add(listener)
    );
    chrome.runtime.onMessage.removeListener = vi.fn((listener) => listeners.delete(listener));
    chrome.runtime.getManifest = vi.fn(() => ({ version: '0.11.3' }));
    send = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((_tab, message, callback) => {
      command = message;
      callback({ ok: true, diagnostics: report() });
    });
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
    originalCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');
    originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  });
  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
    for (const [object, key, descriptor] of [
      [navigator, 'clipboard', originalClipboard],
      [navigator, 'share', originalShare],
      [navigator, 'canShare', originalCanShare],
      [URL, 'createObjectURL', originalCreate],
      [URL, 'revokeObjectURL', originalRevoke],
    ]) {
      if (descriptor) {
        Object.defineProperty(object, key, descriptor);
      } else {
        delete object[key];
      }
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete chrome.runtime.onMessage.removeListener;
    vi.useRealTimers();
  });
  const response = (frameId, diagnostics = report(), sender = {}, request = {}) => {
    for (const listener of [...listeners]) {
      listener(
        {
          type: 'VSC_FRAME_RESULT',
          commandId: command.commandId,
          response: { ok: true, diagnostics },
          ...request,
        },
        { id: chrome.runtime.id, tab: { id: 1 }, frameId, ...sender }
      );
    }
  };
  const finish = async (promise) => {
    await vi.advanceTimersByTimeAsync(350);
    return promise;
  };
  const button = (action) => document.querySelector(`[data-diagnostic="${action}"]`);
  const status = () => document.querySelector('#video-diagnostics [role="status"]').textContent;
  const panel = async () => {
    document.body.innerHTML = popupHtml;
    cleanup = initializeDiagnosticsPanel();
    await vi.advanceTimersByTimeAsync(350);
  };
  const property = (object, key, value) =>
    Object.defineProperty(object, key, { configurable: true, value });

  it('collects the media-less parent and child reports instead of losing the child to the first reply', async () => {
    const pending = collectTabDiagnostics(1, 'stop');
    response(0, { ...report(), events: [] });
    response(3, report(true));
    const result = await finish(pending);
    expect(command).toMatchObject({ type: 'VSC_VIDEO_DIAGNOSTICS', payload: { action: 'stop' } });
    expect(result.frames.map((frame) => frame.frameId)).toEqual([0, 3]);
    expect(result.frames[1].report.active).toBe(true);
    expect(listeners.size).toBe(0);
    const deadlineIndex = timeout.mock.calls.findIndex(([, delay]) => delay === 350);
    expect(deadlineIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout.mock.results[deadlineIndex].value);
  });

  it('authenticates command, extension, tab, and nonnegative integer frame IDs', async () => {
    send.mockImplementation((_tab, message, callback) => {
      command = message;
      callback({ ok: false });
    });
    const pending = collectTabDiagnostics(1, 'report');
    response(2, report(), { id: 'other-extension' });
    response(2, report(), { tab: { id: 2 } });
    response(2, report(), {}, { commandId: 'other-command' });
    response(-1);
    response(1.5);
    response(undefined);
    const result = await finish(pending);
    expect(result).toEqual({ ok: false, frames: [] });
  });

  it('deduplicates frames and keeps at most eight', async () => {
    const pending = collectTabDiagnostics(1, 'report');
    for (let id = 0; id < 12; id++) {
      response(id);
    }
    response(0, report(true));
    const result = await finish(pending);
    expect(result.frames).toHaveLength(8);
    expect(result.frames[0].report.active).toBe(false);
  });

  it('retains a late main frame after eight empty ad frames reply first', async () => {
    const pending = collectTabDiagnostics(1, 'report');
    for (let frame = 1; frame <= 8; frame++) {
      response(frame, { ...report(), events: [] });
    }
    response(0, report());
    const result = await finish(pending);
    expect(result.frames.map(({ frameId }) => frameId)).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
    expect(result.frames.find(({ frameId }) => frameId === 0).report.events).toHaveLength(1);
  });

  it('replaces empty lower-priority children with a late child media trace', async () => {
    const pending = collectTabDiagnostics(1, 'report');
    for (let frame = 1; frame <= 8; frame++) {
      response(frame, { ...report(), events: [] });
    }
    response(20, { ...report(), events: [{ ...report().events[0], mediaId: 1 }] });
    const result = await finish(pending);
    expect(result.frames.map(({ frameId }) => frameId)).toEqual([1, 2, 3, 4, 5, 6, 7, 20]);
    expect(result.frames.at(-1).report.events[0].mediaId).toBe(1);
  });

  it('keeps media traces ahead of generic events and suspected jumps ahead of empty captures', async () => {
    const pending = collectTabDiagnostics(1, 'report');
    for (let frame = 1; frame <= 8; frame++) {
      response(frame, report());
    }
    response(20, { ...report(), events: [{ ...report().events[0], event: 'suspected-top-jump' }] });
    response(21, report());
    const result = await finish(pending);
    expect(result.frames).toHaveLength(8);
    expect(result.frames.some(({ frameId }) => frameId === 20)).toBe(true);
    expect(result.frames.some(({ frameId }) => frameId === 21)).toBe(false);
  });

  it('uses a legacy first callback with unknown frame identity only when no frame replies arrive', async () => {
    const result = await finish(collectTabDiagnostics(1, 'report'));
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].frameId).toBe(null);
  });

  it('rejects oversized raw frames and discards unknown text before export', async () => {
    send.mockImplementation((_tab, message, callback) => {
      command = message;
      callback({ ok: false });
    });
    const pending = collectTabDiagnostics(1, 'report');
    response(0, { ...report(), padding: 'a'.repeat(600000) });
    response(1, { ...report(), padding: 'private text' });
    const result = await finish(pending);
    expect(result.frames.map(({ frameId }) => frameId)).toEqual([1]);
    expect(JSON.stringify(result)).not.toContain('padding');
    expect(JSON.stringify(result)).not.toContain('private text');
  });

  it('caps aggregate projected reports below one megabyte', async () => {
    const geometry = {
      x: 1e9,
      y: 1e9,
      width: 1e9,
      height: 1e9,
      scrollWidth: 1e9,
      scrollHeight: 1e9,
    };
    const large = {
      schema: 1,
      active: false,
      reason: 'manual',
      events: Array.from({ length: 240 }, (_, seq) => ({
        seq,
        t: 1e9,
        event: 'scroll',
        page: geometry,
        viewport: { x: 1e9, y: 1e9, width: 1e9, height: 1e9, scale: 1e9 },
        scrollers: Array.from({ length: 8 }, () => geometry),
      })),
    };
    const pending = collectTabDiagnostics(1, 'report');
    for (let frame = 0; frame < 8; frame++) {
      response(frame, large);
    }
    const result = await finish(pending);
    expect(result.frames).toHaveLength(3);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(1024 * 1024);
  });

  it('evicts lower-priority children to retain the late main report within the byte budget', async () => {
    const geometry = {
      x: 1e9,
      y: 1e9,
      width: 1e9,
      height: 1e9,
      scrollWidth: 1e9,
      scrollHeight: 1e9,
    };
    const large = {
      schema: 1,
      active: false,
      reason: 'manual',
      events: Array.from({ length: 240 }, (_, seq) => ({
        seq,
        t: 1e9,
        event: 'scroll',
        page: geometry,
        viewport: { x: 1e9, y: 1e9, width: 1e9, height: 1e9, scale: 1e9 },
        scrollers: Array.from({ length: 8 }, () => geometry),
      })),
    };
    const pending = collectTabDiagnostics(1, 'report');
    response(1, large);
    response(2, large);
    response(3, large);
    response(0, large);
    const result = await finish(pending);
    expect(result.frames.map(({ frameId }) => frameId)).toEqual([1, 2, 0]);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(1024 * 1024);
  });

  it('preserves the recorder schema including jump, focus, native, and host geometry', () => {
    const entry = {
      ...report().events[0],
      event: 'suspected-top-jump',
      phase: 2,
      trigger: 'fullscreenchange',
      inputAgoMs: null,
      activeTag: 'BUTTON',
      viewport: { x: 0, y: 0, width: 320, height: 600, scale: 1 },
      scrollers: [
        { id: 1, x: 70, y: 220, width: 300, height: 240, scrollWidth: 600, scrollHeight: 2000 },
      ],
      media: {
        readyState: 4,
        networkState: 1,
        paused: false,
        rate: 1,
        time: 12,
        rect: { x: 20, y: 100, width: 240, height: 135 },
        controllerRect: { x: 24, y: 104, width: 92, height: 44 },
        hostRect: null,
        playsInline: true,
        webkitInline: true,
        controls: false,
        nativeFullscreen: false,
        nativeMode: 'inline',
        custom: false,
      },
    };
    const input = { schema: 1, active: false, reason: 'diagnostic-build', events: [entry] };
    expect(projectDiagnosticReport(input)).toEqual(input);
  });

  it('accepts plain cross-realm reports without serializing inherited toJSON hooks', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    try {
      const foreign = new iframe.contentWindow.Object();
      Object.assign(foreign, report());
      expect(projectDiagnosticReport(foreign)).toMatchObject({ schema: 1, active: false });
      const toJSON = vi.fn();
      foreign.toJSON = toJSON;
      expect(() => projectDiagnosticReport(foreign)).toThrow();
      expect(toJSON).not.toHaveBeenCalled();
    } finally {
      iframe.remove();
    }
  });

  it('projects numeric/boolean geometry and fixed labels, omitting URLs and arbitrary text', () => {
    const safe = projectDiagnosticReport({
      ...report(),
      url: 'https://private.example/',
      title: '<script>secret</script>',
      events: [
        {
          ...report().events[0],
          source: 'private',
          activeTag: 'VIDEO',
          page: { x: 0, y: 720, text: 'secret' },
        },
      ],
    });
    expect(safe.events[0]).toMatchObject({
      seq: 1,
      t: 12,
      event: 'loadstart',
      page: { x: 0, y: 720 },
    });
    expect(JSON.stringify(safe)).not.toMatch(/private|secret|script|https/);
  });

  it('rejects unsafe prototypes, accessors, nonfinite data and oversized event rings', () => {
    const getter = vi.fn(() => 'secret');
    const accessor = report();
    Object.defineProperty(accessor, 'url', { enumerable: true, get: getter });
    expect(() => projectDiagnosticReport(accessor)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      projectDiagnosticReport(Object.assign(Object.create({ evil: true }), report()))
    ).toThrow();
    expect(() =>
      projectDiagnosticReport(JSON.parse('{"schema":1,"active":false,"events":[],"__proto__":{}}'))
    ).toThrow();
    expect(() => projectDiagnosticReport({ ...report(), events: Array(241).fill({}) })).toThrow();
    expect(() => projectDiagnosticReport({ ...report(), events: Array(1) })).toThrow();
    expect(() =>
      projectDiagnosticReport({
        ...report(),
        events: [{ ...report().events[0], scrollers: Array(1) }],
      })
    ).toThrow();
    expect(() => projectDiagnosticReport({ ...report(), events: [{ t: Infinity }] })).toThrow();
  });

  it('rejects inherited required values and getters without invoking them', () => {
    const inherited = Object.create(null);
    const getter = vi.fn();
    for (const [key, value] of Object.entries({
      schema: 1,
      active: false,
      reason: 'other',
      events: [],
    })) {
      Object.defineProperty(inherited, key, {
        get: () => {
          getter();
          return value;
        },
      });
    }
    expect(() => projectDiagnosticReport(Object.create(inherited))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const values = Object.assign(Object.create(null), {
      schema: 1,
      active: false,
      reason: 'other',
      events: [],
    });
    expect(() => projectDiagnosticReport(Object.create(values))).toThrow();
    const eventProto = Object.create(null);
    Object.defineProperty(eventProto, 'event', {
      get: () => {
        getter();
        return 'scroll';
      },
    });
    const event = Object.assign(Object.create(eventProto), { seq: 1, t: 0 });
    expect(() => projectDiagnosticReport({ ...report(), events: [event] })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('requires dense own array indices without invoking inherited index getters', () => {
    const getter = vi.fn(() => report().events[0]);
    const events = Array(1);
    const proto = Object.create(Array.prototype);
    Object.defineProperty(proto, '0', { get: getter });
    Object.setPrototypeOf(events, proto);
    expect(() => projectDiagnosticReport({ ...report(), events })).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const scrollers = Array(1);
    Object.setPrototypeOf(scrollers, proto);
    expect(() =>
      projectDiagnosticReport({ ...report(), events: [{ ...report().events[0], scrollers }] })
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('cleans the deadline and runtime listener on popup closure and rejects invalid commands', async () => {
    const pending = collectTabDiagnostics(1, 'report');
    const check = expect(pending).rejects.toThrow('Popup closed');
    window.dispatchEvent(new Event('pagehide'));
    await check;
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(collectTabDiagnostics(-1, 'report')).rejects.toThrow();
    await expect(collectTabDiagnostics(1, 'unknown')).rejects.toThrow();
  });

  it('keeps the deadline after a first-channel error so a later authenticated child reply wins', async () => {
    send.mockImplementation((_tab, message, callback) => {
      command = message;
      chrome.runtime.lastError = { message: 'Receiver disappeared' };
      callback();
      chrome.runtime.lastError = null;
    });
    let settled = false;
    const pending = collectTabDiagnostics(1, 'report').then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(20);
    response(2, report());
    await vi.advanceTimersByTimeAsync(329);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).frames.map(({ frameId }) => frameId)).toEqual([2]);
    expect(listeners.size).toBe(0);
  });

  it('cleans listeners on API failure without exposing raw error messages', async () => {
    send.mockImplementationOnce(() => {
      throw new Error('https://private.example/token');
    });
    await expect(collectTabDiagnostics(1, 'report')).rejects.toThrow('Unable to contact this tab');
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retrieves stopped reports on open, then starts/stops only on explicit actions', async () => {
    await panel();
    expect(command.payload.action).toBe('report');
    expect(status()).toContain('Capture stopped');
    expect(button('copy').disabled).toBe(false);
    const parsed = JSON.parse(document.querySelector('textarea').value);
    expect(parsed).toMatchObject({
      schema: 1,
      extensionVersion: '0.11.3',
      frames: [{ frameId: null }],
    });
    expect(parsed).not.toHaveProperty('url');
    button('start').click();
    await vi.advanceTimersByTimeAsync(350);
    expect(command.payload.action).toBe('start');
    button('stop').click();
    await vi.advanceTimersByTimeAsync(350);
    expect(command.payload.action).toBe('stop');
  });

  it('invalidates prepared exports immediately on new capture and clear', async () => {
    await panel();
    expect(document.querySelector('textarea').value).not.toBe('');
    button('start').click();
    expect(document.querySelector('textarea').value).toBe('');
    expect(button('copy').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(350);
    expect(document.querySelector('textarea').value).not.toBe('');
    button('clear').click();
    expect(document.querySelector('textarea').value).toBe('');
    await vi.advanceTimersByTimeAsync(350);
    expect(command.payload.action).toBe('clear');
    expect(status()).toContain('Capture cleared');
    expect(button('copy').disabled).toBe(true);
    expect(button('share').disabled).toBe(true);
  });

  it('explicit panel cleanup aborts an in-flight collection and clears its deadline', async () => {
    document.body.innerHTML = popupHtml;
    cleanup = initializeDiagnosticsPanel();
    await Promise.resolve();
    expect(listeners.size).toBe(1);
    cleanup();
    await Promise.resolve();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('copies only on a later button gesture and announces success after clipboard resolves', async () => {
    let resolve;
    const writeText = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    property(navigator, 'clipboard', { writeText });
    await panel();
    expect(writeText).not.toHaveBeenCalled();
    button('copy').click();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(document.querySelector('textarea').value);
    expect(status()).not.toBe('Report copied.');
    resolve();
    await Promise.resolve();
    expect(status()).toBe('Report copied.');
  });

  it('keeps a selectable readonly report when clipboard is denied', async () => {
    property(navigator, 'clipboard', { writeText: vi.fn().mockRejectedValue(new Error('Denied')) });
    await panel();
    button('copy').click();
    await Promise.resolve();
    const output = document.querySelector('textarea');
    expect(output.readOnly).toBe(true);
    expect(document.activeElement).toBe(output);
    expect(output.selectionEnd).toBe(output.value.length);
    expect(status()).toContain('Clipboard unavailable');
    expect(status()).not.toBe('Report copied.');
  });

  it('shares a prepared file directly in the later button gesture', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    property(navigator, 'share', share);
    property(
      navigator,
      'canShare',
      vi.fn(() => true)
    );
    await panel();
    expect(share).not.toHaveBeenCalled();
    button('share').click();
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0].files[0].name).toBe('stayfast-video-diagnostics.json');
    await Promise.resolve();
    expect(status()).toBe('Report shared.');
  });

  it('does not report success after sharing is cancelled', async () => {
    property(
      navigator,
      'share',
      vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    );
    await panel();
    button('share').click();
    await Promise.resolve();
    expect(status()).toContain('Share cancelled.');
    expect(status()).not.toBe('Report shared.');
  });

  it('downloads as a fallback and releases its object URL and timer when the popup closes', async () => {
    property(navigator, 'share', undefined);
    const create = vi.fn(() => 'blob:owned-report');
    const revoke = vi.fn();
    property(URL, 'createObjectURL', create);
    property(URL, 'revokeObjectURL', revoke);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await panel();
    button('share').click();
    expect(click).toHaveBeenCalledOnce();
    expect(status()).toContain('download requested');
    expect(revoke).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:owned-report');
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('textarea').value).toBe('');
  });
});

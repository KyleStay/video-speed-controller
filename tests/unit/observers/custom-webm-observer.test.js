import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let observer, attach;
const make = (playing = true, source = 'https://example.test/clip.webm') => {
  const container = document.createElement('div');
  container.className = 'ogv-cnt expandedWebm';
  const original = document.createElement('ogvjs');
  let paused = !playing;
  Object.assign(original, {
    src: source,
    muted: true,
    volume: 0.5,
    currentTime: 2,
    seekable: { length: 1 },
    play: vi.fn(() => {
      paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      paused = true;
    }),
    stop: vi.fn(),
  });
  Object.defineProperty(original, 'paused', { get: () => paused });
  const chrome = document.createElement('div');
  chrome.className = 'ogv-ctrl';
  container.append(original, chrome);
  document.body.append(container);
  return { original, container, chrome, play: original.play, pause: original.pause };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window.VSC.IOSPlayer, 'isIOS').mockReturnValue(true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  attach = vi.fn();
});
afterEach(() => {
  observer?.cleanup();
  observer = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('native custom WebM ownership', () => {
  it('probes native metadata before pausing or hiding the original decoder', () => {
    const { original, chrome, pause } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    expect(row.video.src).toBe(original.src);
    expect(row.video.isConnected).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(getComputedStyle(original).display).not.toBe('none');
    expect(getComputedStyle(chrome).display).not.toBe('none');
    row.video.dispatchEvent(new Event('loadedmetadata'));
    expect(attach).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });
  it('owns the same WebM clip through native controls and restores the original renderer on handback', async () => {
    const { original, container, chrome, pause } = make();
    const stop = original.stop;
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original),
      video = row.video;
    video.dispatchEvent(new Event('loadeddata'));
    await Promise.resolve();
    expect(attach).toHaveBeenCalledWith(video, container);
    expect(video.parentNode).toBe(container);
    expect(video.currentTime).toBe(2);
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.5);
    expect(video.loop).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(getComputedStyle(original).display).toBe('none');
    expect(getComputedStyle(chrome).display).toBe('none');
    video.currentTime = 5;
    row.cleanup();
    expect(original.currentTime).toBe(5);
    expect(original.play).toHaveBeenCalledOnce();
    expect(original.stop).toBe(stop);
    expect(video.isConnected).toBe(false);
    expect(getComputedStyle(original).display).not.toBe('none');
    expect(getComputedStyle(chrome).display).not.toBe('none');
    expect(window.VSC.CustomWebMObserver.get(video)).toBeUndefined();
  });
  it('retains a deliberately paused clip and does not autoplay on attachment or cleanup', () => {
    const { original } = make(false);
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    expect(row.video.play).not.toHaveBeenCalled();
    row.cleanup();
    expect(original.play).not.toHaveBeenCalled();
  });
  it('falls back to the playing custom decoder when native playback is rejected', async () => {
    const { original } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.play.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    row.video.dispatchEvent(new Event('loadeddata'));
    await Promise.resolve();
    expect(observer.entries.size).toBe(0);
    expect(original.play).toHaveBeenCalledOnce();
    expect(getComputedStyle(original).display).not.toBe('none');
  });
  it('honors the site stop action without resuming the old decoder', () => {
    const { original } = make();
    const stop = original.stop;
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    original.stop();
    expect(stop).toHaveBeenCalledOnce();
    expect(original.stop).toBe(stop);
    expect(original.play).not.toHaveBeenCalled();
    expect(row.video.isConnected).toBe(false);
  });
  it('cancels a pending native probe when the site stops the decoder', () => {
    const { original } = make();
    const stop = original.stop;
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    original.stop();
    row.video.dispatchEvent(new Event('loadeddata'));
    expect(stop).toHaveBeenCalledOnce();
    expect(attach).not.toHaveBeenCalled();
    expect(observer.entries.size).toBe(0);
  });
  it.each(['play', 'pause'])('returns ownership before a site-issued %s', (name) => {
    const { original } = make();
    const method = original[name];
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    method.mockClear();
    row.video.currentTime = 7;
    original[name]();
    expect(method).toHaveBeenCalledOnce();
    expect(original.currentTime).toBe(7);
    expect(original.paused).toBe(name === 'pause');
    expect(row.video.paused).toBe(true);
    expect(row.video.isConnected).toBe(false);
    expect(original[name]).toBe(method);
    expect(observer.entries.size).toBe(0);
  });
  it('yields when a captured site play method restarts the original decoder', () => {
    const { original, play } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    play.call(original);
    original.dispatchEvent(new Event('playing'));
    expect(row.video.paused).toBe(true);
    expect(original.paused).toBe(false);
    expect(row.video.isConnected).toBe(false);
    expect(observer.entries.size).toBe(0);
    observer.consider(original);
    expect(observer.entries.size).toBe(0);
  });
  it('ignores an original playing notification queued before our pause', () => {
    const { original } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    original.dispatchEvent(new Event('playing'));
    expect(original.paused).toBe(true);
    expect(row.video.paused).toBe(false);
    expect(row.owned()).toBe(true);
  });
  it.each(['stop', 'source'])('does not resurrect a decoder after reentrant pause %s', (kind) => {
    const { original, pause } = make();
    pause.mockImplementation(() => {
      if (kind === 'stop') {
        original.stop();
      } else {
        original.src = 'https://example.test/new.webm';
      }
    });
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    expect(attach).not.toHaveBeenCalled();
    expect(observer.entries.size).toBe(0);
    expect(row.video.isConnected).toBe(false);
    expect(row.container.hasAttribute('data-vsc-custom-webm')).toBe(false);
  });
  it('does not play after controller attachment disposes the adapter', () => {
    const { original } = make();
    attach.mockImplementation((video) => window.VSC.CustomWebMObserver.get(video).cleanup(false));
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    expect(row.video.play).not.toHaveBeenCalled();
    expect(row.video.isConnected).toBe(false);
    expect(observer.entries.size).toBe(0);
  });
  it('does not seek or resume a source recycled during controller teardown', () => {
    const { original, play } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    row.video.currentTime = 7;
    row.video.vsc = {
      remove() {
        original.src = 'https://example.test/next.webm';
        original.currentTime = 0;
      },
    };
    row.cleanup();
    expect(original.currentTime).toBe(0);
    expect(play).not.toHaveBeenCalled();
    expect(row.video.isConnected).toBe(false);
  });
  it('releases an old source before considering a recycled decoder', () => {
    const { original, play } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const old = observer.entries.get(original);
    old.video.dispatchEvent(new Event('loadeddata'));
    original.src = 'https://example.test/next.webm';
    original.dispatchEvent(new Event('loadstart'));
    expect(old.video.isConnected).toBe(false);
    expect(observer.entries.get(original).source).toBe(original.src);
    expect(play).not.toHaveBeenCalled();
  });
  it('yields when a site moves the container across a shadow boundary', () => {
    const { original, container, chrome } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    row.video.dispatchEvent(new Event('loadeddata'));
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(container);
    row.video.dispatchEvent(new Event('timeupdate'));
    expect(observer.entries.size).toBe(0);
    expect(row.video.isConnected).toBe(false);
    expect(container.hasAttribute('data-vsc-custom-webm')).toBe(false);
    expect(getComputedStyle(chrome).display).not.toBe('none');
  });
  it.each([
    'desktop',
    'unsupported',
    'wrong-container',
    'ambiguous',
    'other-format',
    'immutable-stop',
  ])('leaves the custom renderer unchanged for %s', (kind) => {
    const { original, container, pause } = make();
    if (kind === 'desktop') {
      window.VSC.IOSPlayer.isIOS.mockReturnValue(false);
    }
    if (kind === 'unsupported') {
      HTMLMediaElement.prototype.canPlayType.mockReturnValue('');
    }
    if (kind === 'wrong-container') {
      container.className = 'unknown-player';
    }
    if (kind === 'ambiguous') {
      container.append(document.createElement('video'));
    }
    if (kind === 'other-format') {
      original.src = 'https://example.test/clip.ogv';
    }
    if (kind === 'immutable-stop') {
      Object.defineProperty(original, 'stop', {
        configurable: false,
        writable: false,
        value: original.stop,
      });
    }
    observer = new window.VSC.CustomWebMObserver(document, attach);
    expect(observer.entries.size).toBe(0);
    expect(pause).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });
  it('bounds failed native probes, suppresses retries, and releases removed decoders', async () => {
    const { original, pause } = make();
    observer = new window.VSC.CustomWebMObserver(document, attach);
    const row = observer.entries.get(original);
    await vi.advanceTimersByTimeAsync(10000);
    expect(observer.entries.size).toBe(0);
    observer.consider(original);
    expect(observer.entries.size).toBe(0);
    expect(pause).not.toHaveBeenCalled();
    original.remove();
    observer.remove(original);
    document.body.append(original);
    expect(row.video.isConnected).toBe(false);
  });
});

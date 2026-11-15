import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('frame stepping controls', () => {
  let parent;
  let media;
  let shadow;
  let config;
  let handler;
  let manager;
  let paused;
  let duration;
  let bindings;
  let rateWrite;
  const buttons = () => [
    shadow.querySelector('[data-action="rewindFrame"]'),
    shadow.querySelector('[data-action="advanceFrame"]'),
  ];

  function makeMedia(tag = 'video') {
    media = document.createElement(tag);
    parent.append(media);
    media.src = 'https://example.test/frames.mp4';
    media.currentTime = 10;
    Object.defineProperty(media, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(media, 'duration', { configurable: true, get: () => duration });
    rateWrite = vi.fn();
    Object.defineProperty(media, 'playbackRate', {
      configurable: true,
      get: () => 1.5,
      set: rateWrite,
    });
    media.play = vi.fn(() => {
      paused = false;
      media.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    media.pause = vi.fn(() => {
      paused = true;
      media.dispatchEvent(new Event('pause'));
    });
    media.getBoundingClientRect = () => ({
      left: 0,
      top: 40,
      right: 320,
      bottom: 220,
      width: 320,
      height: 180,
    });
    const div = document.createElement('vsc-controller');
    parent.append(div);
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(div);
    media.vsc = {
      video: media,
      div,
      config,
      actionHandler: handler,
      detectedFps: 24,
      remove: vi.fn(),
      repairDOMPlacement: vi.fn(),
    };
    manager = new window.VSC.ControlsManager(handler, config);
    manager.video = media;
    manager.setupButtonHandlers(shadow, media);
    vi.spyOn(window.VSC.stateManager, 'getControlledElements').mockReturnValue([media]);
  }

  beforeEach(() => {
    paused = true;
    duration = 120;
    bindings = { rewindFrame: 30, advanceFrame: 60, fast: 1.8 };
    config = {
      settings: { ...window.VSC.Constants.DEFAULT_SETTINGS },
      getKeyBinding: (action) => bindings[action],
    };
    handler = new window.VSC.ActionHandler(config, null);
    parent = document.createElement('section');
    document.body.append(parent);
    vi.spyOn(window.VSC.siteHandlerManager, 'handleSeek').mockImplementation((video, delta) => {
      video.currentTime = Math.max(0, Math.min(duration, video.currentTime + delta));
      return true;
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    manager?.cleanup();
    parent.remove();
    manager = null;
    vi.restoreAllMocks();
  });

  it('exposes accessible per-media frame controls in the common browser popover', () => {
    makeMedia();
    const [back, forward] = buttons();
    for (const [button, label] of [
      [back, 'Frame back'],
      [forward, 'Frame forward'],
    ]) {
      expect(button.closest('#controls')).not.toBeNull();
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(button.title).toBe(label);
      expect(button.disabled).toBe(false);
      expect(button.classList.contains('touch-only')).toBe(false);
    }
    back.click();
    expect(media.currentTime).toBeCloseTo(10 - 1 / 24, 10);
    forward.click();
    expect(media.currentTime).toBeCloseTo(10, 10);
    expect(rateWrite).not.toHaveBeenCalled();
    expect(media.play).not.toHaveBeenCalled();
    expect(media.pause).not.toHaveBeenCalled();
  });

  it('reads the current configured fallback for each direction after fps detection is unavailable', () => {
    makeMedia();
    media.vsc.detectedFps = undefined;
    buttons()[0].click();
    expect(media.currentTime).toBeCloseTo(10 - 1 / 30, 10);
    bindings.advanceFrame = 120;
    buttons()[1].click();
    expect(media.currentTime).toBeCloseTo(10 - 1 / 30 + 1 / 120, 10);
    bindings.rewindFrame = false;
    buttons()[0].click();
    expect(media.currentTime).toBeCloseTo(10 - 2 / 30 + 1 / 120, 10);
  });

  it('keeps the action local to the clicked video and clamps at seek bounds', () => {
    makeMedia();
    const other = document.createElement('video');
    other.currentTime = 25;
    other.vsc = { div: document.createElement('vsc-controller') };
    window.VSC.stateManager.getControlledElements.mockReturnValue([media, other]);
    media.currentTime = 0;
    buttons()[0].click();
    expect(media.currentTime).toBe(0);
    media.currentTime = duration;
    buttons()[1].click();
    expect(media.currentTime).toBe(duration);
    expect(other.currentTime).toBe(25);
  });

  it('disables while playing or unseekable and rejects a stale dispatched click without pausing', () => {
    makeMedia();
    paused = false;
    media.dispatchEvent(new Event('play'));
    expect(buttons().every((button) => button.disabled)).toBe(true);
    buttons()[0].dispatchEvent(new Event('click', { bubbles: true }));
    expect(media.currentTime).toBe(10);
    expect(media.pause).not.toHaveBeenCalled();
    paused = true;
    media.dispatchEvent(new Event('pause'));
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    duration = NaN;
    media.dispatchEvent(new Event('durationchange'));
    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(rateWrite).not.toHaveBeenCalled();
  });

  it('disables for audio and releases its media and click listeners on cleanup', () => {
    makeMedia('audio');
    expect(buttons().every((button) => button.disabled)).toBe(true);
    buttons()[0].dispatchEvent(new Event('click', { bubbles: true }));
    expect(media.currentTime).toBe(10);
    manager.cleanup();
    const [back] = buttons();
    back.disabled = false;
    media.dispatchEvent(new Event('play'));
    back.click();
    expect(back.disabled).toBe(false);
    expect(media.currentTime).toBe(10);
  });

  it('accepts a finite live seek window and fails closed when the site removes or breaks it', () => {
    makeMedia();
    duration = Infinity;
    Object.defineProperty(media, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 5, end: () => 15 },
    });
    media.dispatchEvent(new Event('progress'));
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    Object.defineProperty(media, 'seekable', {
      configurable: true,
      get: () => {
        throw new Error('site replaced the seek ranges');
      },
    });
    media.dispatchEvent(new Event('progress'));
    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(() => buttons()[0].dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();
    expect(media.currentTime).toBe(10);
  });
});

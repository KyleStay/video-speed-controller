import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AirPlay controls', () => {
  let media;
  let host;
  let shadow;
  let manager;
  let picker;
  let listen;
  const button = () => shadow.querySelector('[data-action="airplay"]');

  function setup(tag = 'video', supported = true) {
    media = document.createElement(tag);
    document.body.append(media);
    picker = vi.fn();
    if (supported) {
      media.webkitShowPlaybackTargetPicker = picker;
    }
    listen = vi.spyOn(media, 'addEventListener');
    manager.setupButtonHandlers(shadow, media);
  }

  beforeEach(() => {
    host = document.createElement('vsc-controller');
    document.body.append(host);
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(host);
    manager = new window.VSC.ControlsManager({ runAction: vi.fn() }, {});
  });

  afterEach(() => {
    manager.cleanup();
    media?.remove();
    host.remove();
    vi.restoreAllMocks();
  });

  it.each(['video', 'audio'])('opens the native picker synchronously for its own %s', (tag) => {
    setup(tag);
    media.src = 'https://example.test/media.mp4';
    media.currentTime = 12;
    media.playbackRate = 1.5;
    media.play = vi.fn();
    expect(button().hidden).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Choose AirPlay device');
    button().click();
    expect(picker).toHaveBeenCalledOnce();
    expect(picker.mock.instances[0]).toBe(media);
    expect(media.currentTime).toBe(12);
    expect(media.playbackRate).toBe(1.5);
    expect(media.src).toBe('https://example.test/media.mp4');
    expect(media.play).not.toHaveBeenCalled();
    expect(manager.actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('hides unsupported controls and never monitors receiver discovery', () => {
    setup('video', false);
    expect(button().hidden).toBe(true);
    expect(button().disabled).toBe(true);
    expect(listen).not.toHaveBeenCalledWith(
      'webkitcurrentplaybacktargetiswirelesschanged',
      expect.anything()
    );
    button().click();
    expect(picker).not.toHaveBeenCalled();
  });

  it.each([
    ['disableremoteplayback', ''],
    ['x-webkit-wirelessvideoplaybackdisabled', ''],
    ['x-webkit-airplay', 'deny'],
    ['controlslist', 'noremoteplayback'],
  ])('honors and observes the %s restriction without changing it', async (name, value) => {
    setup();
    media.setAttribute(name, value);
    // Recheck before the observer has delivered its mutation.
    button().click();
    expect(picker).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(button().hidden).toBe(true);
    expect(media.getAttribute(name)).toBe(value);
    media.removeAttribute(name);
    await Promise.resolve();
    expect(button().hidden).toBe(false);
    button().click();
    expect(picker).toHaveBeenCalledOnce();
  });

  it.each(['disableRemotePlayback', 'webkitWirelessVideoPlaybackDisabled'])(
    'rechecks the %s property at input time',
    (name) => {
      setup();
      media[name] = true;
      button().click();
      expect(picker).not.toHaveBeenCalled();
    }
  );

  it('reflects the selected route and releases listeners, observer and input on cleanup', async () => {
    setup();
    expect(listen).not.toHaveBeenCalledWith(
      'webkitplaybacktargetavailabilitychanged',
      expect.anything()
    );
    media.webkitCurrentPlaybackTargetIsWireless = true;
    media.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('aria-label')).toBe('Change AirPlay device');
    manager.cleanup();
    media.webkitCurrentPlaybackTargetIsWireless = false;
    media.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
    media.setAttribute('disableremoteplayback', '');
    await Promise.resolve();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().hidden).toBe(false);
    button().click();
    expect(picker).not.toHaveBeenCalled();
  });

  it('contains rejected pickers and page-defined getters', () => {
    setup();
    picker.mockImplementation(() => {
      throw new Error('picker unavailable');
    });
    expect(() => button().click()).not.toThrow();
    Object.defineProperty(media, 'disableRemotePlayback', {
      configurable: true,
      get: () => {
        throw new Error('page getter');
      },
    });
    expect(window.VSC.ControlsManager.canAirPlay(media)).toBe(false);
    expect(() => button().click()).not.toThrow();
    expect(picker).toHaveBeenCalledOnce();
  });
});

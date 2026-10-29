import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('compact iOS inline controls', () => {
  let host;
  let shadow;
  let video;
  let manager;
  let observer;
  let paused;
  let media;
  let originalViewport;
  const pointer = (target) => {
    const event = new Event('pointerdown', { bubbles: true, composed: true });
    Object.assign(event, { pointerType: 'touch' });
    target.dispatchEvent(event);
  };
  const openByTouch = () => {
    const pill = shadow.querySelector('.draggable');
    pointer(pill);
    pill.click();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          this.callback = callback;
          this.observe = vi.fn();
          this.disconnect = vi.fn();
          observer = this;
        }
      }
    );
    originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 320,
        height: 600,
        offsetLeft: 0,
        offsetTop: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    host = document.createElement('vsc-controller');
    video = document.createElement('video');
    document.body.append(host, video);
    paused = true;
    Object.defineProperty(video, 'paused', { get: () => paused });
    media = { left: 20, top: 40, width: 120, height: 68, right: 140, bottom: 108 };
    video.getBoundingClientRect = () => media;
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(host, { buttonSize: 18 });
    shadow.querySelector('#controller').getBoundingClientRect = () => {
      const controller = shadow.querySelector('#controller');
      const shift = controller.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      const left = 300 + (shift ? Number(shift[1]) : 0);
      const top = 100 + (shift ? Number(shift[2]) : 0);
      const width = host.hasAttribute('data-vsc-inline-tiny')
        ? 44
        : (parseFloat(controller.style.getPropertyValue('--vsc-inline-pill-width')) || 44) + 48;
      return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
    };
    const panel = shadow.querySelector('#controls');
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 112, height: 240 });
    panel.showPopover = vi.fn();
    panel.hidePopover = vi.fn();
    video.vsc = { iosPlayer: { enterNativeFullscreen: vi.fn(), open: vi.fn() } };
    manager = new window.VSC.ControlsManager(
      { runAction: vi.fn(), adjustSpeed: vi.fn() },
      { getKeyBinding: () => 0.1 }
    );
    manager.setupControlEvents(shadow, video);
  });
  afterEach(() => {
    manager.cleanup();
    host.remove();
    video.remove();
    if (originalViewport) {
      Object.defineProperty(window, 'visualViewport', originalViewport);
    } else {
      delete window.visualViewport;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('owned bottom video timeline', () => {
    let scale;
    let controller;
    const number = (property) => parseFloat(controller.style.getPropertyValue(property));
    const railRect = () => {
      const strip = controller.getBoundingClientRect();
      const left = strip.left + number('--vsc-inline-timeline-left') * scale.x;
      const top = strip.top + number('--vsc-inline-timeline-top') * scale.y;
      const width = number('--vsc-inline-timeline-width') * scale.x;
      return { left, top, width, right: left + width, bottom: top + 44 };
    };
    beforeEach(() => {
      scale = { x: 1, y: 1 };
      window.visualViewport.width = 1000;
      window.visualViewport.height = 800;
      media = { left: 20, top: 40, width: 700, height: 420, right: 720, bottom: 460 };
      Object.defineProperty(video, 'duration', { configurable: true, value: 120 });
      controller = shadow.querySelector('#controller');
      const usedWidth = () => number('--vsc-inline-owned-width') || 92;
      Object.defineProperty(controller, 'offsetWidth', { configurable: true, get: usedWidth });
      Object.defineProperty(controller, 'offsetHeight', {
        configurable: true,
        get: () => 44 / scale.y,
      });
      // Model the compact strip's transformed layout. Absolute rail coordinates
      // are then reconstructed independently in visual pixels, as a browser does.
      controller.getBoundingClientRect = () => {
        const shift = controller.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        const left = 300 + (shift ? Number(shift[1]) * scale.x : 0);
        const top = 100 + (shift ? Number(shift[2]) * scale.y : 0);
        const width = usedWidth() * scale.x;
        return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
      };
      manager.inlinePlayer.setOwned(true);
    });

    it('separates the rail at the video bottom before later readiness handlers run', () => {
      media = { left: 35, top: 80, width: 700, height: 500, right: 735, bottom: 580 };
      const ready = vi.fn(() => {
        expect(controller.getBoundingClientRect()).toMatchObject({
          top: 84,
          width: 420,
          height: 44,
        });
        expect(railRect()).toEqual({ left: 39, top: 532, width: 692, right: 731, bottom: 576 });
        expect(railRect().top - controller.getBoundingClientRect().bottom).toBeGreaterThan(300);
      });
      video.addEventListener('canplay', ready);
      video.dispatchEvent(new Event('canplay'));
      expect(ready).toHaveBeenCalledOnce();
      video.removeEventListener('canplay', ready);
    });

    it('follows scrolling through the existing coalesced refresh without page scroll writes', () => {
      const scroll = vi.spyOn(window, 'scrollTo');
      media = { left: 20, top: -80, width: 700, height: 420, right: 720, bottom: 340 };
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
      expect(railRect()).toEqual({ left: 24, top: 292, width: 692, right: 716, bottom: 336 });
      expect(controller.getBoundingClientRect().top).toBe(-76);
      expect(host.hasAttribute('data-vsc-inline-strip-hidden')).toBe(true);
      media = { ...media, top: 40, bottom: 460 };
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
      expect(controller.getBoundingClientRect().top).toBe(44);
      expect(host.hasAttribute('data-vsc-inline-strip-hidden')).toBe(false);
      expect(scroll).not.toHaveBeenCalled();
    });

    it('uses cropped media and the visual viewport rather than the uncropped video bottom', () => {
      const clip = document.createElement('section');
      clip.style.cssText = 'overflow-x:hidden;overflow-y:hidden';
      clip.getBoundingClientRect = () => ({
        left: 90,
        top: 60,
        width: 500,
        height: 320,
        right: 590,
        bottom: 380,
      });
      document.body.append(clip);
      clip.append(video);
      window.visualViewport.offsetLeft = 120;
      window.visualViewport.offsetTop = 100;
      window.visualViewport.width = 400;
      window.visualViewport.height = 240;
      try {
        observer.callback();
        expect(railRect()).toEqual({ left: 124, top: 292, width: 392, right: 516, bottom: 336 });
      } finally {
        document.body.append(video);
        clip.remove();
      }
    });

    it('repairs a hidden strip after page chrome changes without a media resize', () => {
      const player = new window.VSC.IOSPlayer({ video, div: host, controlsManager: manager });
      player.attached = player.mediaPrepared = true;
      video.vsc.iosPlayer = player;
      const occlusion = vi
        .spyOn(manager, 'avoidInlineOcclusion')
        .mockImplementation((_s, _v, placement) => {
          placement.y += 80;
        });
      manager.positionInlineControls(shadow, video);
      expect(host.hasAttribute('data-vsc-inline-strip-hidden')).toBe(true);
      occlusion.mockRestore();
      const position = vi.spyOn(manager, 'positionInlineControls');
      player.refreshSiteControls();
      player.refreshSiteControls();
      expect(host.hasAttribute('data-vsc-inline-strip-hidden')).toBe(true);
      vi.advanceTimersByTime(20);
      expect(host.hasAttribute('data-vsc-inline-strip-hidden')).toBe(false);
      expect(position).toHaveBeenCalledTimes(1);
      player.cleanup();
    });

    it('recalculates independent rail offsets after occlusion and nonuniform rescaling', () => {
      const occlusion = vi
        .spyOn(manager, 'avoidInlineOcclusion')
        .mockImplementation((_, __, placement) => {
          placement.x += 30;
          placement.y += 70;
        });
      for (const next of [
        { x: 0.6, y: 0.75 },
        { x: 1.25, y: 1.6 },
      ]) {
        scale = next;
        observer.callback();
        expect(manager.inlinePlayer.scale.x).toBeCloseTo(scale.x, 10);
        expect(manager.inlinePlayer.scale.y).toBeCloseTo(scale.y, 10);
        expect(railRect().left).toBeCloseTo(24, 10);
        expect(railRect().right).toBeCloseTo(716, 10);
        expect(railRect().bottom).toBeCloseTo(456, 10);
        expect(number('--vsc-inline-timeline-left')).toBeCloseTo(-30 / scale.x, 10);
        expect(controller.getBoundingClientRect().height).toBe(44);
      }
      expect(occlusion).toHaveBeenCalledTimes(2);
    });

    it('keeps the rail at the video bottom when local metadata overlaps it', () => {
      const scope = document.createElement('section');
      const picture = document.createElement('div');
      const metadata = document.createElement('a');
      const modal = document.createElement('div');
      metadata.href = '#profile';
      modal.setAttribute('role', 'dialog');
      document.body.append(scope, modal);
      scope.append(video, picture, metadata);
      manager.inlinePlayer.surfaceContainer = { node: scope };
      picture.getBoundingClientRect = () => media;
      metadata.getBoundingClientRect = () => ({ left: 30, right: 710, top: 410, bottom: 450 });
      const hitTest = vi.fn((x, y) => [y >= 410 && y <= 450 ? metadata : picture, video]);
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: hitTest });
      try {
        observer.callback();
        expect(railRect().bottom).toBe(456);
        expect(railRect().bottom - railRect().top).toBe(44);
        expect(metadata.style.cssText).toBe('');
        hitTest.mockImplementation(() => [picture, video]);
        observer.callback();
        expect(railRect().bottom).toBe(456);
        hitTest.mockImplementation(() => [modal, video]);
        observer.callback();
        expect(railRect().bottom).toBe(456);
        expect(hitTest.mock.calls.length).toBeLessThan(50);
      } finally {
        document.body.append(video);
        manager.inlinePlayer.surfaceContainer = null;
        scope.remove();
        modal.remove();
        delete document.elementsFromPoint;
      }
    });

    it('keeps the bottom rail on small media with overlapping metadata', () => {
      media = { left: 20, top: 0, width: 300, height: 144, right: 320, bottom: 144 };
      const scope = document.createElement('section');
      const metadata = document.createElement('a');
      metadata.href = '#profile';
      metadata.getBoundingClientRect = () => ({ left: 30, right: 310, top: 60, bottom: 100 });
      document.body.append(scope);
      scope.append(video, metadata);
      manager.inlinePlayer.surfaceContainer = { node: scope };
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: (x, y) => [y >= 60 && y <= 100 ? metadata : video],
      });
      try {
        observer.callback();
        expect(railRect().bottom).toBe(140);
        expect(railRect().top).toBeGreaterThan(controller.getBoundingClientRect().bottom);
      } finally {
        document.body.append(video);
        manager.inlinePlayer.surfaceContainer = null;
        scope.remove();
        delete document.elementsFromPoint;
      }
    });

    it('hides the rail and hands actual tiny media back without leaving a video-sized hit box', () => {
      const availability = vi.fn();
      video.vsc.iosPlayer.setInlineAvailability = availability;
      media = { left: 20, top: 40, width: 40, height: 420, right: 60, bottom: 460 };
      observer.callback();
      expect(availability).toHaveBeenCalledWith(false);
      expect(host.hasAttribute('data-vsc-inline-unavailable')).toBe(true);
      expect(manager.inlinePlayer.refs.timelineGroup.hidden).toBe(true);
      expect(controller.getBoundingClientRect().height).toBe(44);
      const css = shadow.querySelector('style').textContent;
      expect(css).toContain('.inline-owned-control[hidden] { display: none !important; }');
      expect(css).toContain('left: var(--vsc-inline-timeline-left, 0px)');
      expect(css).toContain('top: var(--vsc-inline-timeline-top, 0px)');
    });
  });

  it('hands actual tiny media back and reacquires it after resize without treating viewport clipping as tiny', () => {
    const availability = vi.fn();
    video.vsc.iosPlayer.setInlineAvailability = availability;
    media = { left: 20, top: 40, width: 40, height: 68, right: 60, bottom: 108 };
    manager.positionInlineControls(shadow, video);
    expect(availability.mock.calls).toEqual([[false]]);
    // Only 20px is on screen, but the actual media is wide enough after resize.
    media = { left: -100, top: 40, width: 120, height: 68, right: 20, bottom: 108 };
    manager.positionInlineControls(shadow, video);
    expect(availability.mock.calls).toEqual([[false], [true]]);
  });

  it('does not read layout or write position for a detached controller, including early readiness/resize', () => {
    manager.cleanup();
    host.remove();
    host = document.createElement('vsc-controller');
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(host, { buttonSize: 18 });
    const controller = shadow.querySelector('#controller');
    const controllerRect = vi.spyOn(controller, 'getBoundingClientRect');
    const mediaRect = vi.spyOn(video, 'getBoundingClientRect');
    manager = new window.VSC.ControlsManager(
      { runAction: vi.fn(), adjustSpeed: vi.fn() },
      { getKeyBinding: () => 0.1 }
    );
    manager.setupControlEvents(shadow, video);
    video.dispatchEvent(new Event('loadedmetadata'));
    window.dispatchEvent(new Event('resize'));
    observer.callback();
    expect(controllerRect).not.toHaveBeenCalled();
    expect(mediaRect).not.toHaveBeenCalled();
    expect(controller.style.transform).toBe('');
    // Label-derived CSS sizing is safe while detached; coordinates are not.
    expect(controller.style.getPropertyValue('--vsc-inline-pill-width')).toBe('44px');
    expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(false);
  });

  it('places the first connected controller inside its media before any ResizeObserver callback', () => {
    manager.cleanup();
    host.remove();
    const actionHandler = { runAction: vi.fn(), adjustSpeed: vi.fn() };
    const config = {
      settings: { ...window.VSC.Constants.DEFAULT_SETTINGS },
      getKeyBinding: () => 0.1,
    };
    manager = new window.VSC.ControlsManager(actionHandler, config);
    const actualCreate = window.VSC.ShadowDOMManager.createShadowDOM.bind(
      window.VSC.ShadowDOMManager
    );
    const detachedReads = vi.fn();
    const visualRect = (controller) => {
      if (!host.isConnected) {
        detachedReads();
        return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      }
      // jsdom has no layout. Model real pixel coordinates from the production
      // top/left plus transform, so an obsolete pre-insertion transform remains
      // observable after initializeControls applies the connected base position.
      const shift = controller.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      const left = (parseFloat(controller.style.left) || 0) + (shift ? Number(shift[1]) : 0);
      const top = (parseFloat(controller.style.top) || 0) + (shift ? Number(shift[2]) : 0);
      const width = host.hasAttribute('data-vsc-inline-tiny')
        ? 44
        : (parseFloat(controller.style.getPropertyValue('--vsc-inline-pill-width')) || 44) + 48;
      return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
    };
    vi.spyOn(window.VSC.ShadowDOMManager, 'createShadowDOM').mockImplementation(
      (wrapper, options) => {
        host = wrapper;
        shadow = actualCreate(wrapper, options);
        const controller = shadow.querySelector('#controller');
        controller.getBoundingClientRect = () => visualRect(controller);
        return shadow;
      }
    );
    vi.spyOn(window.VSC.siteHandlerManager, 'getControllerPosition').mockReturnValue({
      insertionPoint: video.parentElement,
      insertionMethod: 'firstChild',
    });
    const owner = Object.assign(Object.create(window.VSC.VideoController.prototype), {
      video,
      parent: video.parentElement,
      config,
      controlsManager: manager,
      shouldStartHidden: false,
    });
    // Exercise the actual initialization/insertion ordering, without constructing
    // unrelated speed, source-observer or owned-player lifecycle machinery.
    const wrapper = owner.initializeControls();
    expect(wrapper.isConnected).toBe(true);
    const rect = visualRect(shadow.querySelector('#controller'));
    expect(rect).toEqual({ left: 24, top: 44, width: 44, height: 44, right: 68, bottom: 88 });
    expect(rect.left).toBeGreaterThanOrEqual(media.left + 4);
    expect(rect.top).toBeGreaterThanOrEqual(media.top + 4);
    expect(rect.right).toBeLessThanOrEqual(media.right - 4);
    expect(rect.bottom).toBeLessThanOrEqual(media.bottom - 4);
    expect(detachedReads).not.toHaveBeenCalled();
    // No observer.callback(), readiness event, timer or layout-frame tick has
    // run: the first connected state itself must already have correct geometry.
  });

  it('repositions the same controller immediately when same-size media moves to a different parent offset', () => {
    window.visualViewport.width = 600;
    const first = document.createElement('section');
    const second = document.createElement('section');
    document.body.append(first, second);
    first.append(video, host);
    const controller = shadow.querySelector('#controller');
    controller.style.left = '20px';
    controller.style.top = '60px';
    const mediaRect = () => {
      const moved = video.parentNode === second;
      const left = moved ? 160 : 40;
      const top = moved ? 300 : 100;
      return { left, top, width: 240, height: 135, right: left + 240, bottom: top + 135 };
    };
    video.getBoundingClientRect = mediaRect;
    controller.getBoundingClientRect = () => {
      const moved = host.parentNode === second;
      const origin = moved ? { left: 100, top: 200 } : { left: 20, top: 40 };
      const shift = controller.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      const left = origin.left + parseFloat(controller.style.left) + (shift ? Number(shift[1]) : 0);
      const top = origin.top + parseFloat(controller.style.top) + (shift ? Number(shift[2]) : 0);
      const width = host.hasAttribute('data-vsc-inline-tiny')
        ? 44
        : (parseFloat(controller.style.getPropertyValue('--vsc-inline-pill-width')) || 44) + 48;
      return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
    };
    const owner = Object.assign(Object.create(window.VSC.VideoController.prototype), {
      video,
      div: host,
      parent: first,
      insertionParent: first,
      mediaParentAncestor: first.parentNode,
      controlsManager: manager,
      disposed: false,
    });
    video.vsc = owner;
    vi.spyOn(window.VSC.siteHandlerManager, 'getControllerPosition').mockImplementation(
      (parent) => ({
        insertionPoint: parent,
        insertionMethod: 'firstChild',
      })
    );
    const resize = vi.spyOn(observer, 'callback');
    try {
      manager.positionInlineControls(shadow, video);
      expect(controller.getBoundingClientRect()).toEqual({
        left: 44,
        top: 104,
        width: 92,
        height: 44,
        right: 136,
        bottom: 148,
      });
      const previousSize = { width: mediaRect().width, height: mediaRect().height };
      second.append(video);
      expect({ width: mediaRect().width, height: mediaRect().height }).toEqual(previousSize);
      expect(owner.repairDOMPlacement()).toBe(true);
      expect(host.parentNode).toBe(second);
      expect(owner.div).toBe(host);
      expect(owner.div.shadowRoot).toBe(shadow);
      expect(shadow.querySelector('#controller')).toBe(controller);
      expect(video.vsc).toBe(owner);
      // The video has not resized, so no ResizeObserver callback is owed. The
      // new parent's different media-relative offset must be repaired now.
      expect(resize).not.toHaveBeenCalled();
      expect(controller.getBoundingClientRect()).toEqual({
        left: 164,
        top: 304,
        width: 92,
        height: 44,
        right: 256,
        bottom: 348,
      });
    } finally {
      first.remove();
      second.remove();
    }
  });

  it('preserves desktop manual coordinates when repairing a removed controller', () => {
    manager.cleanup();
    window.VSC.IOSPlayer.isSupported.mockReturnValue(false);
    manager = new window.VSC.ControlsManager(
      { runAction: vi.fn(), adjustSpeed: vi.fn() },
      { getKeyBinding: () => 0.1 }
    );
    manager.setupControlEvents(shadow, video);
    const controller = shadow.querySelector('#controller');
    controller.style.left = '41px';
    controller.style.top = '73px';
    controller.style.transform = 'translate(11px, 19px)';
    const reposition = vi.spyOn(manager, 'positionInlineControls');
    const owner = Object.assign(Object.create(window.VSC.VideoController.prototype), {
      video,
      div: host,
      parent: video.parentElement,
      insertionParent: host.parentNode,
      mediaParentAncestor: video.parentElement.parentNode,
      controlsManager: manager,
      disposed: false,
    });
    vi.spyOn(window.VSC.siteHandlerManager, 'getControllerPosition').mockReturnValue({
      insertionPoint: video.parentElement,
      insertionMethod: 'firstChild',
    });
    host.remove();
    expect(owner.repairDOMPlacement()).toBe(true);
    expect(controller.style.left).toBe('41px');
    expect(controller.style.top).toBe('73px');
    expect(controller.style.transform).toBe('translate(11px, 19px)');
    expect(reposition).not.toHaveBeenCalled();
  });

  it.each([1, 1.8, 16, 64])(
    'uses a compact inline %s speed label without losing the accessible value',
    (speed) => {
      window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, speed);
      const pill = shadow.querySelector('.draggable');
      const indicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);
      expect(indicator.textContent).toBe(String(speed));
      const label = indicator.getAttribute('aria-label');
      expect(label).toMatch(/Tap to show speed controls/);
      const accepted = label.match(/Playback speed ([\d.]+)/);
      expect(Number(accepted?.[1])).toBe(speed);
      expect(pill.getAttribute('aria-expanded')).toBe('false');
      expect(pill.getAttribute('role')).toBe('button');
      expect(pill.tabIndex).toBe(0);
    }
  );

  it('keeps the full accepted Float32-range value accessible through touch-mode refreshes', () => {
    const accepted = 3.4028234663852886e38;
    const pill = shadow.querySelector('.draggable');
    const controller = shadow.querySelector('#controller');
    window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, accepted);
    expect(pill.textContent).toBe('3.4e38');
    for (const touch of [false, true, false, true]) {
      manager.setTouchMode(shadow, touch);
      expect(pill.dataset.speed).toBe(String(accepted));
      const full = pill.getAttribute('aria-label').match(/Playback speed ([\deE.+-]+)/);
      expect(Number(full?.[1])).toBe(accepted);
      expect(pill.textContent).toBe('3.4e38');
      const width = parseFloat(controller.style.getPropertyValue('--vsc-inline-pill-width'));
      expect(width).toBeGreaterThanOrEqual(44);
      expect(width).toBeLessThanOrEqual(56);
      expect(parseFloat(controller.style.getPropertyValue('--vsc-inline-font-size'))).toBe(11);
    }
  });

  it('keeps both primary hit targets at44px and retains flex alignment during speed flashes', () => {
    const css = shadow.querySelector('style').textContent;
    const rule = (selector) => css.slice(css.indexOf(selector)).split('}')[0];
    for (const selector of [
      ':host([data-vsc-ios-inline]) .draggable {',
      ':host([data-vsc-ios-inline]) .inline-fullscreen {',
    ]) {
      expect(css).toContain(selector);
      const declarations = rule(selector);
      expect(declarations).toContain('min-width: 44px');
      expect(declarations).toContain('min-height: 44px');
      expect(declarations).toContain('height: 44px');
    }
    expect(rule(':host([data-vsc-ios-inline].vsc-show) #controller {')).toContain(
      'display: inline-flex !important'
    );
    expect(
      rule(':host([data-vsc-ios-inline][data-vsc-inline-unavailable]) #controller,')
    ).toContain('display: none !important');
  });

  describe('responsive compact surface bounds', () => {
    function primaryRect() {
      const controller = shadow.querySelector('#controller');
      controller.getBoundingClientRect = () => {
        const shift = controller.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        const left = 300 + (shift ? Number(shift[1]) : 0);
        const top = 100 + (shift ? Number(shift[2]) : 0);
        const width = host.hasAttribute('data-vsc-inline-tiny')
          ? 44
          : (parseFloat(controller.style.getPropertyValue('--vsc-inline-pill-width')) || 44) + 48;
        return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
      };
      return controller;
    }

    it.each([
      [179, 120, true, false],
      [200, 95, true, false],
      [180, 96, false, false],
      [51, 120, true, true],
      [200, 51, true, true],
      [52, 52, true, false],
      [80, 45, true, true],
    ])('uses safe primary controls at %s×%s', (width, height, tiny, unavailable) => {
      const controller = primaryRect();
      media = { left: 20, top: 40, width, height, right: 20 + width, bottom: 40 + height };
      observer.callback();
      expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(tiny);
      expect(host.hasAttribute('data-vsc-inline-unavailable')).toBe(unavailable);
      if (!unavailable) {
        const rect = controller.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.left).toBeGreaterThanOrEqual(media.left + 4);
        expect(rect.top).toBeGreaterThanOrEqual(media.top + 4);
        expect(rect.right).toBeLessThanOrEqual(media.right - 4);
        expect(rect.bottom).toBeLessThanOrEqual(media.bottom - 4);
      }
    });

    it.each([
      [290, 40, true, true],
      [200, 40, true, false],
      [20, 570, true, true],
      [20, 520, true, false],
      [400, 40, false, false],
    ])(
      'uses the painted viewport intersection at(%s,%s) without pulling fully offscreen media back',
      (left, top, tiny, unavailable) => {
        const controller = primaryRect();
        media = { left, top, width: 240, height: 135, right: left + 240, bottom: top + 135 };
        observer.callback();
        expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(tiny);
        expect(host.hasAttribute('data-vsc-inline-unavailable')).toBe(unavailable);
        if (!unavailable) {
          const rect = controller.getBoundingClientRect();
          expect(rect.left).toBe(left + 4);
          expect(rect.top).toBe(top + 4);
          if (left < window.visualViewport.width) {
            expect(rect.right).toBeLessThanOrEqual(window.visualViewport.width - 4);
            expect(rect.bottom).toBeLessThanOrEqual(window.visualViewport.height - 4);
          }
        }
      }
    );

    it('restores the pill after a video grows from unavailable to fullscreen-only to a full surface', () => {
      primaryRect();
      for (const [width, height, tiny, unavailable] of [
        [80, 45, true, true],
        [120, 68, true, false],
        [320, 180, false, false],
      ]) {
        media = { left: 0, top: 40, width, height, right: width, bottom: 40 + height };
        observer.callback();
        expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(tiny);
        expect(host.hasAttribute('data-vsc-inline-unavailable')).toBe(unavailable);
      }
      const pill = shadow.querySelector('.draggable');
      expect(pill.getAttribute('role')).toBe('button');
      expect(pill.tabIndex).toBe(0);
      openByTouch();
      expect(pill.getAttribute('aria-expanded')).toBe('true');
      shadow
        .querySelector('#controls')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(pill.getAttribute('aria-expanded')).toBe('false');
    });

    it('anchors within a non-root clipping ancestor rather than the uncropped video rectangle', () => {
      const clip = document.createElement('section');
      clip.style.cssText = 'overflow-x: hidden; overflow-y: hidden';
      clip.getBoundingClientRect = () => ({
        left: 60,
        top: 100,
        right: 240,
        bottom: 200,
        width: 180,
        height: 100,
      });
      document.body.append(clip);
      clip.append(video);
      media = { left: 20, top: 40, width: 300, height: 200, right: 320, bottom: 240 };
      const controller = primaryRect();
      try {
        observer.callback();
        expect(manager.getInlineMediaBounds(video)).toEqual({
          left: 60,
          top: 100,
          right: 240,
          bottom: 200,
          width: 180,
          height: 100,
        });
        expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(false);
        expect(controller.getBoundingClientRect()).toEqual({
          left: 64,
          top: 104,
          right: 156,
          bottom: 148,
          width: 92,
          height: 44,
        });
      } finally {
        clip.remove();
      }
    });

    it('uses the clipping ancestor client area inside its borders', () => {
      const clip = document.createElement('section');
      clip.style.cssText = 'overflow-x: clip; overflow-y: clip';
      clip.getBoundingClientRect = () => ({
        left: 60,
        top: 100,
        right: 260,
        bottom: 220,
        width: 200,
        height: 120,
      });
      for (const [key, value] of Object.entries({
        clientLeft: 8,
        clientTop: 6,
        clientWidth: 184,
        clientHeight: 108,
      })) {
        Object.defineProperty(clip, key, { configurable: true, value });
      }
      document.body.append(clip);
      clip.append(video);
      media = { left: 20, top: 40, width: 300, height: 200, right: 320, bottom: 240 };
      const controller = primaryRect();
      try {
        observer.callback();
        const bounds = manager.getInlineMediaBounds(video);
        expect(bounds).toEqual({
          left: 68,
          top: 106,
          right: 252,
          bottom: 214,
          width: 184,
          height: 108,
        });
        const rect = controller.getBoundingClientRect();
        expect(rect.left).toBe(72);
        expect(rect.top).toBe(110);
        expect(rect.right).toBeLessThanOrEqual(bounds.right - 4);
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom - 4);
      } finally {
        clip.remove();
      }
    });

    it('keeps offscreen media anchored beyond scrolling ancestors instead of chasing the viewport', () => {
      const scroller = document.createElement('section');
      scroller.style.cssText = 'overflow-x: auto; overflow-y: auto';
      scroller.getBoundingClientRect = () => ({
        left: 60,
        top: 100,
        right: 240,
        bottom: 200,
        width: 180,
        height: 100,
      });
      document.body.append(scroller);
      scroller.append(video);
      media = { left: 20, top: 900, width: 240, height: 135, right: 260, bottom: 1035 };
      const controller = primaryRect();
      try {
        observer.callback();
        expect(manager.getInlineMediaBounds(video)).toEqual(media);
        expect(controller.getBoundingClientRect().top).toBe(904);
      } finally {
        scroller.remove();
      }
    });

    it('refreshes clipped bounds through IntersectionObserver and disconnects it on cleanup', () => {
      manager.cleanup();
      let intersection;
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback) {
            this.callback = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
            intersection = this;
          }
        }
      );
      manager = new window.VSC.ControlsManager(
        { runAction: vi.fn(), adjustSpeed: vi.fn() },
        { getKeyBinding: () => 0.1 }
      );
      primaryRect();
      const clip = document.createElement('section');
      clip.style.cssText = 'overflow-x: hidden; overflow-y: hidden';
      let width = 240;
      clip.getBoundingClientRect = () => ({
        left: 20,
        top: 40,
        right: 20 + width,
        bottom: 175,
        width,
        height: 135,
      });
      media = { left: 20, top: 40, width: 240, height: 135, right: 260, bottom: 175 };
      document.body.append(clip);
      clip.append(video);
      try {
        manager.setupControlEvents(shadow, video);
        expect(intersection.observe).toHaveBeenCalledExactlyOnceWith(video);
        expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(false);
        width = 120;
        intersection.callback([]);
        expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(true);
        manager.cleanup();
        expect(intersection.disconnect).toHaveBeenCalledOnce();
      } finally {
        clip.remove();
      }
    });
  });

  describe('bounded sticky-header avoidance', () => {
    let originalHitTest;
    let nodes;
    beforeEach(() => {
      originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
      nodes = [];
    });
    afterEach(() => {
      for (const node of nodes) {
        node.remove();
      }
      if (originalHitTest) {
        Object.defineProperty(document, 'elementsFromPoint', originalHitTest);
      } else {
        delete document.elementsFromPoint;
      }
    });
    function hitTest(implementation) {
      const query = vi.fn(implementation);
      Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: query });
      return query;
    }
    function playerRoot() {
      const player = document.createElement('section');
      player.setAttribute('data-testid', 'videoPlayer');
      document.body.append(player);
      player.append(video);
      nodes.push(player);
      return player;
    }
    function occluder(rect) {
      const cover = document.createElement('header');
      cover.style.position = 'fixed';
      cover.getBoundingClientRect = typeof rect === 'function' ? rect : () => rect;
      document.body.append(cover);
      nodes.push(cover);
      return cover;
    }

    it('moves a partly off-top video primary below the sticky header while staying in painted bounds', () => {
      playerRoot();
      media = { left: 20, top: -55.75, width: 280, height: 200, right: 300, bottom: 144.25 };
      const header = occluder({ left: 0, top: 0, right: 320, bottom: 64, width: 320, height: 64 });
      const query = hitTest((_x, y) => (y < 64 ? [header, video] : [video]));
      observer.callback();
      const rect = shadow.querySelector('#controller').getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(68);
      expect(rect.left).toBeGreaterThanOrEqual(media.left + 4);
      expect(rect.right).toBeLessThanOrEqual(Math.min(media.right, 320) - 4);
      expect(rect.bottom).toBeLessThanOrEqual(Math.min(media.bottom, 600) - 4);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('does not query page hit testing for wholly offscreen media', () => {
      media = { left: 20, top: 900, width: 240, height: 135, right: 260, bottom: 1035 };
      const query = hitTest(() => {
        throw new Error('Offscreen hit testing should not run');
      });
      observer.callback();
      expect(query).not.toHaveBeenCalled();
      expect(shadow.querySelector('#controller').getBoundingClientRect().top).toBe(904);
    });

    it('does not move outside the video to evade a viewport-covering modal', () => {
      playerRoot();
      media = { left: 20, top: 40, width: 240, height: 135, right: 260, bottom: 175 };
      const modal = occluder({ left: 0, top: 0, right: 320, bottom: 600, width: 320, height: 600 });
      const query = hitTest(() => [modal, video]);
      observer.callback();
      const rect = shadow.querySelector('#controller').getBoundingClientRect();
      expect(rect.left).toBe(24);
      expect(rect.top).toBe(44);
      expect(rect.right).toBeLessThanOrEqual(media.right - 4);
      expect(rect.bottom).toBeLessThanOrEqual(media.bottom - 4);
      expect(query).toHaveBeenCalledOnce();
    });

    it('uses at most three hit-test passes and never starts polling an occluder', () => {
      playerRoot();
      media = { left: 20, top: 40, width: 240, height: 400, right: 260, bottom: 440 };
      let center = 0;
      const cover = occluder(() => ({
        left: 0,
        top: center - 5,
        right: 320,
        bottom: center + 5,
        width: 320,
        height: 10,
      }));
      const query = hitTest((_x, y) => {
        center = y;
        return [cover, video];
      });
      observer.callback();
      expect(query).toHaveBeenCalledTimes(3);
      const rect = shadow.querySelector('#controller').getBoundingClientRect();
      expect(rect.top).toBeGreaterThan(media.top + 4);
      expect(rect.bottom).toBeLessThanOrEqual(media.bottom - 4);
      vi.advanceTimersByTime(5000);
      expect(query).toHaveBeenCalledTimes(3);
    });

    it('ignores the StayFast host and accepts site controls inside the selected player root', () => {
      const player = playerRoot();
      const siteControls = document.createElement('div');
      player.append(siteControls);
      media = { left: 20, top: 40, width: 240, height: 135, right: 260, bottom: 175 };
      const query = hitTest(() => [host, siteControls, video]);
      observer.callback();
      const rect = shadow.querySelector('#controller').getBoundingClientRect();
      expect(rect.left).toBe(24);
      expect(rect.top).toBe(44);
      expect(query).toHaveBeenCalledOnce();
    });
  });

  it('opens owned fullscreen beside the pill without expanding or entering Apple playback', () => {
    expect(host.hasAttribute('data-vsc-ios-inline')).toBe(true);
    expect(host.hasAttribute('data-vsc-touch')).toBe(true);
    const fullscreen = shadow.querySelector('.inline-fullscreen');
    expect(fullscreen.dataset.action).toBe('ownedFullscreen');
    expect(fullscreen.getAttribute('aria-label')).toMatch(/fullscreen/i);
    fullscreen.click();
    expect(video.vsc.iosPlayer.open).toHaveBeenCalledExactlyOnceWith({ fullscreen: true });
    expect(video.vsc.iosPlayer.enterNativeFullscreen).not.toHaveBeenCalled();
    expect(host.classList.contains('vsc-touch-open')).toBe(false);
  });

  it('uses media-relative positioning and honors the configured font while keeping touch targets', () => {
    expect(shadow.querySelector('#controller').style.transform).toBe('translate(-276px, -56px)');
    expect(
      shadow.querySelector('#controller').style.getPropertyValue('--vsc-inline-pill-width')
    ).toBe('44px');
    expect(
      shadow.querySelector('#controller').style.getPropertyValue('--vsc-controller-font-size')
    ).toBe('18px');
    expect(shadow.querySelector('style').textContent).toContain('min-height: 44px');
    expect(observer.observe).toHaveBeenCalledExactlyOnceWith(video);
  });

  describe('shared event-driven scroll refresh', () => {
    let surfaces;
    let intersections;
    let frames;
    let requestFrame;
    let cancelFrame;
    let windowAdd;
    let windowRemove;
    let viewportAdd;
    let viewportRemove;
    let hitTestDescriptor;

    beforeEach(() => {
      manager.cleanup();
      surfaces = [];
      intersections = [];
      frames = new Map();
      let nextFrame = 0;
      requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
      cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id);
      });
      const viewport = Object.assign(new EventTarget(), {
        width: 320,
        height: 600,
        offsetLeft: 0,
        offsetTop: 0,
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      windowAdd = vi.spyOn(window, 'addEventListener');
      windowRemove = vi.spyOn(window, 'removeEventListener');
      viewportAdd = vi.spyOn(viewport, 'addEventListener');
      viewportRemove = vi.spyOn(viewport, 'removeEventListener');
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback) {
            this.callback = vi.fn(callback);
            this.observe = vi.fn();
            this.disconnect = vi.fn();
            intersections.push(this);
          }
        }
      );
      hitTestDescriptor = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');
    });

    afterEach(() => {
      for (const surface of surfaces) {
        surface.manager.cleanup();
        surface.root.remove();
        surface.video.remove();
      }
      if (hitTestDescriptor) {
        Object.defineProperty(document, 'elementsFromPoint', hitTestDescriptor);
      } else {
        delete document.elementsFromPoint;
      }
    });

    const surface = () => {
      const root = document.createElement('section');
      root.dataset.testid = 'videoPlayer';
      const video = document.createElement('video');
      const host = document.createElement('vsc-controller');
      root.append(video, host);
      document.body.append(root);
      let bounds = { left: 20, top: 100, width: 240, height: 180, right: 260, bottom: 280 };
      video.getBoundingClientRect = () => bounds;
      video.vsc = { iosPlayer: { enterNativeFullscreen: vi.fn(), open: vi.fn() } };
      const shadow = window.VSC.ShadowDOMManager.createShadowDOM(host, { buttonSize: 18 });
      const primary = shadow.querySelector('#controller');
      primary.getBoundingClientRect = () => {
        const shift = primary.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        const left = 300 + (shift ? Number(shift[1]) : 0);
        const top = 100 + (shift ? Number(shift[2]) : 0);
        const width = host.hasAttribute('data-vsc-inline-tiny')
          ? 44
          : (parseFloat(primary.style.getPropertyValue('--vsc-inline-pill-width')) || 44) + 48;
        return { left, top, width, height: 44, right: left + width, bottom: top + 44 };
      };
      const manager = new window.VSC.ControlsManager(
        { runAction: vi.fn(), adjustSpeed: vi.fn() },
        { getKeyBinding: () => 0.1 }
      );
      manager.setupControlEvents(shadow, video);
      const position = vi.spyOn(manager, 'positionInlineControls');
      const result = {
        root,
        host,
        video,
        primary,
        manager,
        position,
        intersection: intersections.at(-1),
        move: (rect) => {
          bounds = rect;
        },
      };
      surfaces.push(result);
      return result;
    };
    const setVisible = (surface, visible) => {
      surface.intersection.callback([
        { target: surface.video, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 },
      ]);
      surface.position.mockClear();
    };
    const flushFrame = () => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(16));
    };
    const scrollCalls = (spy) => spy.mock.calls.filter(([type]) => type === 'scroll');

    it('shares passive scroll listeners and one coalesced frame between two visible controllers', () => {
      const first = surface();
      const second = surface();
      setVisible(first, true);
      setVisible(second, true);
      expect(scrollCalls(windowAdd)).toHaveLength(1);
      expect(scrollCalls(windowAdd)[0][2]).toEqual({ capture: true, passive: true });
      expect(scrollCalls(viewportAdd)).toHaveLength(1);
      expect(scrollCalls(viewportAdd)[0][2]).toEqual({ passive: true });
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      window.visualViewport.dispatchEvent(new Event('scroll'));
      expect(requestFrame).toHaveBeenCalledOnce();
      expect(first.position).not.toHaveBeenCalled();
      expect(second.position).not.toHaveBeenCalled();
      flushFrame();
      expect(first.position).toHaveBeenCalledExactlyOnceWith(
        first.primary.getRootNode(),
        first.video
      );
      expect(second.position).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);
      vi.advanceTimersByTime(5000);
      expect(requestFrame).toHaveBeenCalledOnce();
    });

    it('refreshes only media reported intersecting when IntersectionObserver is available', () => {
      const visible = surface();
      const hidden = surface();
      const outside = surface();
      setVisible(visible, true);
      setVisible(hidden, false);
      outside.move({ left: 20, top: 900, width: 240, height: 180, right: 260, bottom: 1080 });
      setVisible(outside, false);
      window.dispatchEvent(new Event('scroll'));
      flushFrame();
      expect(visible.position).toHaveBeenCalledOnce();
      expect(hidden.position).not.toHaveBeenCalled();
      expect(outside.position).not.toHaveBeenCalled();
    });

    it('recovers after a visual viewport pan without an IntersectionObserver change', () => {
      const player = surface();
      setVisible(player, true);
      window.visualViewport.offsetTop = 700;
      window.visualViewport.dispatchEvent(new Event('scroll'));
      flushFrame();
      expect(player.primary.getBoundingClientRect().top).toBe(104);
      expect(player.position).toHaveBeenCalledOnce();
      window.visualViewport.offsetTop = 0;
      window.visualViewport.dispatchEvent(new Event('scroll'));
      flushFrame();
      expect(player.primary.getBoundingClientRect().bottom).toBeLessThanOrEqual(276);
      expect(player.primary.getBoundingClientRect().top).toBe(104);
      expect(player.position).toHaveBeenCalledTimes(2);
      expect(player.intersection.callback).toHaveBeenCalledOnce();
    });

    it('skips a controller cleaned by an earlier callback in the same frame snapshot', () => {
      const first = surface();
      const second = surface();
      setVisible(first, true);
      setVisible(second, true);
      first.position.mockImplementationOnce(() => second.manager.cleanup());
      window.dispatchEvent(new Event('scroll'));
      flushFrame();
      expect(first.position).toHaveBeenCalledOnce();
      expect(second.position).not.toHaveBeenCalled();
    });

    it('does not position disconnected hosts or media adopted before the scheduled frame', () => {
      const detached = surface();
      const adopted = surface();
      setVisible(detached, true);
      setVisible(adopted, true);
      window.dispatchEvent(new Event('scroll'));
      detached.host.remove();
      document.implementation.createHTMLDocument('replacement').adoptNode(adopted.video);
      flushFrame();
      expect(detached.position).not.toHaveBeenCalled();
      expect(adopted.position).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
    });

    it('refreshes known media on scroll when IntersectionObserver is unavailable', () => {
      vi.stubGlobal('IntersectionObserver', undefined);
      const known = surface();
      window.visualViewport.dispatchEvent(new Event('scroll'));
      flushFrame();
      expect(known.position).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);
    });

    it('releases the original window frame and listeners only after the last adopted controller cleans up', () => {
      const first = surface();
      const second = surface();
      setVisible(first, true);
      setVisible(second, true);
      window.dispatchEvent(new Event('scroll'));
      const pendingFrame = requestFrame.mock.results[0].value;
      first.manager.cleanup();
      expect(cancelFrame).not.toHaveBeenCalled();
      expect(scrollCalls(windowRemove)).toHaveLength(0);
      expect(scrollCalls(viewportRemove)).toHaveLength(0);
      const inert = document.implementation.createHTMLDocument('replacement');
      inert.adoptNode(second.video);
      expect(inert.defaultView).toBe(null);
      expect(() => second.manager.cleanup()).not.toThrow();
      expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(pendingFrame);
      expect(frames.size).toBe(0);
      expect(scrollCalls(windowRemove)).toEqual([['scroll', scrollCalls(windowAdd)[0][1], true]]);
      expect(scrollCalls(viewportRemove)).toEqual([['scroll', scrollCalls(viewportAdd)[0][1]]]);
      window.dispatchEvent(new Event('scroll'));
      window.visualViewport.dispatchEvent(new Event('scroll'));
      expect(requestFrame).toHaveBeenCalledOnce();
      expect(intersections.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(
        true
      );
    });

    it('moves fully visible controls below a sticky header on scroll without another intersection callback', () => {
      const player = surface();
      const header = document.createElement('header');
      header.style.position = 'fixed';
      header.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 320,
        bottom: 53,
        width: 320,
        height: 53,
      });
      document.body.append(header);
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: vi.fn((x, y) => (y < 53 ? [header] : [player.video])),
      });
      try {
        setVisible(player, true);
        expect(player.primary.getBoundingClientRect().top).toBe(104);
        player.move({ left: 20, top: 20, width: 240, height: 180, right: 260, bottom: 200 });
        window.dispatchEvent(new Event('scroll'));
        flushFrame();
        const rect = player.primary.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(57);
        expect(rect.bottom).toBeLessThanOrEqual(196);
        expect(rect.left).toBeGreaterThanOrEqual(24);
        expect(rect.right).toBeLessThanOrEqual(256);
        expect(player.intersection.callback).toHaveBeenCalledOnce();
        expect(player.position).toHaveBeenCalledOnce();
      } finally {
        header.remove();
      }
    });
  });

  it('retains an accessible two-column top-layer panel after media shrinks around the compact primary', () => {
    const small = media;
    media = { left: 20, top: 40, width: 240, height: 135, right: 260, bottom: 175 };
    observer.callback();
    openByTouch();
    media = small;
    observer.callback();
    const panel = shadow.querySelector('#controls');
    expect(panel.showPopover).toHaveBeenCalledOnce();
    expect(panel.getAttribute('popover')).toBe('manual');
    expect(panel.style.width).toBe('176px');
    expect(panel.style.getPropertyValue('--vsc-touch-columns')).toBe('2');
    expect(panel.style.left).toBe('24px');
    expect(panel.style.top).toBe('94px');
    shadow.querySelector('[data-action="close"]').click();
    expect(panel.hidePopover).toHaveBeenCalledOnce();
    expect(panel.hasAttribute('popover')).toBe(false);
    expect(panel.style.top).toBe('');
  });

  it('positions the panel above media near the viewport bottom and updates when resized', () => {
    media = { ...media, top: 522, bottom: 590 };
    observer.callback();
    openByTouch();
    expect(shadow.querySelector('#controls').style.top).toBe('280px');
    media = { ...media, width: 240, right: media.left + 240 };
    observer.callback();
    expect(shadow.querySelector('#controls').style.width).toBe('232px');
    expect(shadow.querySelector('#controls').style.getPropertyValue('--vsc-touch-columns')).toBe(
      '3'
    );
  });

  it('collapses only idle touch-opened controls while playing and leaves the compact primary surface', () => {
    paused = false;
    video.dispatchEvent(new Event('playing'));
    openByTouch();
    vi.advanceTimersByTime(3999);
    expect(host.classList.contains('vsc-touch-open')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(host.classList.contains('vsc-touch-open')).toBe(false);
    expect(host.classList.contains('vsc-inline-playing')).toBe(true);
    expect(host.classList.contains('vsc-hidden')).toBe(false);
  });

  it('keeps paused and keyboard-operated panels available without idle collapse', () => {
    openByTouch();
    vi.advanceTimersByTime(10000);
    expect(host.classList.contains('vsc-touch-open')).toBe(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    shadow
      .querySelector('.draggable')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    vi.advanceTimersByTime(10000);
    expect(host.classList.contains('vsc-touch-open')).toBe(true);
    paused = true;
    video.dispatchEvent(new Event('pause'));
    expect(host.classList.contains('vsc-inline-playing')).toBe(false);
  });

  it('refreshes the playing idle deadline on each genuine touch interaction', () => {
    paused = false;
    openByTouch();
    vi.advanceTimersByTime(2000);
    pointer(shadow.querySelector('[data-action="faster"]'));
    vi.advanceTimersByTime(2000);
    expect(host.classList.contains('vsc-touch-open')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(host.classList.contains('vsc-touch-open')).toBe(false);
  });

  it('cleans the resize observer, idle timer, popover and media listeners on disposal', () => {
    paused = false;
    openByTouch();
    const panel = shadow.querySelector('#controls');
    manager.cleanup();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(manager.inlineHideTimer).toBe(null);
    expect(panel.hidePopover).toHaveBeenCalledOnce();
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(10000);
    expect(host.classList.contains('vsc-touch-open')).toBe(false);
  });

  it('keeps offscreen controls with their media instead of pulling them into the viewport', () => {
    media = { left: 20, top: 900, width: 120, height: 68, right: 140, bottom: 968 };
    observer.callback();
    expect(shadow.querySelector('#controller').style.transform).toBe('translate(-276px, 804px)');
  });

  it('keeps a 44px fullscreen target on very narrow or horizontally clipped media', () => {
    media = { left: -60, top: 40, width: 120, height: 68, right: 60, bottom: 108 };
    shadow.querySelector('#controller').getBoundingClientRect = () => ({
      left: 300,
      top: 100,
      width: 44,
      height: 44,
      right: 344,
      bottom: 144,
    });
    observer.callback();
    expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(true);
    expect(shadow.querySelector('#controller').style.transform).toBe('translate(-296px, -56px)');
    media = { left: 20, top: 40, width: 240, height: 135, right: 260, bottom: 175 };
    observer.callback();
    expect(host.hasAttribute('data-vsc-inline-tiny')).toBe(false);
  });

  it('keeps owned fullscreen available without Apple fullscreen capability', () => {
    video.vsc.iosPlayer.canEnterNativeFullscreen = vi.fn(() => false);
    video.vsc.iosPlayer.nativeFullscreenError = 'Apple player unavailable';
    video.dispatchEvent(new Event('loadedmetadata'));
    const fullscreen = shadow.querySelector('.inline-fullscreen');
    expect(fullscreen.disabled).toBe(false);
    video.dispatchEvent(new Event('canplay'));
    expect(fullscreen.disabled).toBe(false);
    fullscreen.click();
    expect(video.vsc.iosPlayer.open).toHaveBeenCalledExactlyOnceWith({ fullscreen: true });
    expect(video.vsc.iosPlayer.enterNativeFullscreen).not.toHaveBeenCalled();
    expect(fullscreen.hasAttribute('aria-description')).toBe(false);
  });

  it('keeps readable touch columns when large configured fonts are clamped for inline controls', () => {
    shadow.querySelector('#controls').style.fontSize = '64px';
    window.visualViewport.width = 180;
    openByTouch();
    expect(shadow.querySelector('#controls').style.width).toBe('164px');
    expect(shadow.querySelector('#controls').style.getPropertyValue('--vsc-touch-columns')).toBe(
      '2'
    );
    expect(shadow.querySelector('style').textContent).toContain('overflow-wrap: anywhere');
  });

  it('clears its original-window idle timer when a site adopts the video into an inert document', () => {
    paused = false;
    openByTouch();
    document.implementation.createHTMLDocument('replacement').adoptNode(video);
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.inlineHideTimer).toBe(null);
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('falls back safely if top-layer presentation is unavailable', () => {
    shadow.querySelector('#controls').showPopover.mockImplementation(() => {
      throw new Error('Unavailable');
    });
    expect(openByTouch).not.toThrow();
    expect(host.classList.contains('vsc-touch-open')).toBe(true);
    expect(shadow.querySelector('#controls').style.top).toBe('94px');
  });
});

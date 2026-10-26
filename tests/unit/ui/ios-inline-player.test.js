import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-inline-player.js';

describe('owned iOS inline transport', () => {
  let host;
  let shadow;
  let video;
  let manager;
  let player;
  let paused;
  let ended;
  let duration;
  let media;
  let actionHandler;
  let source;

  const position = (width = 400, height = 240) => {
    media = { left: 20, top: 40, width, height, right: 20 + width, bottom: 40 + height };
    manager.positionInlineControls(shadow, video);
  };
  const touch = (node) =>
    node.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));

  const scrubPointer = (type, x = 40, y = 122, pointerId = 7) => {
    player.refs.timeline.getBoundingClientRect = () => ({
      left: 10,
      top: 100,
      width: 300,
      height: 44,
    });
    const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId,
      clientX: x,
      clientY: y,
      button: 0,
      isPrimary: true,
    })) {
      Object.defineProperty(event, key, { value });
    }
    (type === 'pointerdown' ? player.refs.timeline : window).dispatchEvent(event);
    return event;
  };

  beforeAll(async () => {
    // Module loading starts initialization without awaiting its storage migrations.
    // Settle those real-timer callbacks before teardown switches to fake timers.
    await vi.waitFor(() => {
      expect(window.VSC_controller.initializationInProgress).toBe(false);
    });
  });

  beforeEach(() => {
    window.VSC_controller.teardown();
    vi.useFakeTimers();
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    host = document.createElement('vsc-controller');
    video = document.createElement('video');
    document.body.append(host, video);
    video.src = 'https://example.test/original.mp4';
    source = { original: true };
    Object.defineProperty(video, 'srcObject', { configurable: true, value: source });
    paused = true;
    ended = false;
    duration = 120;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => ended });
    Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
    video.currentTime = 12;
    video.playbackRate = 1.5;
    video.controls = false;
    video.play = vi.fn(() => {
      paused = false;
      video.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    video.pause = vi.fn(() => {
      paused = true;
      video.dispatchEvent(new Event('pause'));
    });
    video.vsc = { iosPlayer: { active: false, disposed: false, open: vi.fn() } };
    media = { left: 20, top: 40, width: 400, height: 240, right: 420, bottom: 280 };
    video.getBoundingClientRect = () => media;
    shadow = window.VSC.ShadowDOMManager.createShadowDOM(host, { buttonSize: 18 });
    const root = shadow.querySelector('#controller');
    root.getBoundingClientRect = () => {
      const width = parseFloat(root.style.getPropertyValue('--vsc-inline-owned-width')) || 92;
      const height = manager?.inlinePlayer?.refs.timelineGroup.hidden === false ? 92 : 44;
      return { left: 0, top: 0, width, height, right: width, bottom: height };
    };
    actionHandler = {
      runAction: vi.fn(),
      seek: vi.fn((target, delta) => {
        target.currentTime += delta;
      }),
    };
    manager = new window.VSC.ControlsManager(actionHandler, { getKeyBinding: () => 0.1 });
    manager.setupControlEvents(shadow, video);
    player = manager.inlinePlayer;
  });

  afterEach(() => {
    manager.cleanup();
    host.remove();
    video.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leaves the established pair unchanged until explicitly owned, then releases it', () => {
    expect(player.owned).toBe(false);
    expect(host.hasAttribute('data-vsc-inline-owned')).toBe(false);
    expect(player.refs.play.hidden).toBe(true);
    player.refs.play.click();
    expect(video.play).not.toHaveBeenCalled();
    player.setOwned(true);
    expect(player.refs.play.hidden).toBe(false);
    expect(host.hasAttribute('data-vsc-inline-owned')).toBe(true);
    player.setOwned(false);
    expect(player.refs.play.hidden).toBe(true);
    expect(host.hasAttribute('data-vsc-inline-owned')).toBe(false);
    expect(
      shadow.querySelector('#controller').style.getPropertyValue('--vsc-inline-owned-width')
    ).toBe('');
    expect(shadow.querySelector('.draggable').hidden).toBe(false);
    expect(shadow.querySelector('.inline-fullscreen').hidden).toBe(false);
  });

  it('plays and pauses original inline media with native controls removed and never opens a portal', () => {
    const parent = video.parentNode;
    const src = video.src;
    player.setOwned(true);
    expect(player.refs.play.getAttribute('aria-label')).toBe('Play video');
    expect(player.refs.play.dataset.vscIcon).toBe('play');
    expect(player.refs.play.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    player.refs.play.click();
    expect(video.play).toHaveBeenCalledOnce();
    expect(player.refs.play.getAttribute('aria-label')).toBe('Pause video');
    expect(player.refs.play.dataset.vscIcon).toBe('pause');
    player.refs.play.click();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(player.refs.play.getAttribute('aria-label')).toBe('Play video');
    expect(video.controls).toBe(false);
    expect(video.parentNode).toBe(parent);
    expect(video.src).toBe(src);
    expect(video.srcObject).toBe(source);
    expect(video.currentTime).toBe(12);
    expect(video.playbackRate).toBe(1.5);
    expect(video.vsc.iosPlayer.open).not.toHaveBeenCalled();
    expect(actionHandler.runAction).not.toHaveBeenCalled();
  });

  it('replays ended original media through the same bounded seek and play paths', () => {
    ended = true;
    video.currentTime = 120;
    actionHandler.seek.mockImplementation((target, delta) => {
      target.currentTime += delta;
      ended = false;
    });
    player.setOwned(true);
    expect(player.refs.play.getAttribute('aria-label')).toBe('Replay video');
    player.refs.play.click();
    expect(video.currentTime).toBe(0);
    expect(video.play).toHaveBeenCalledOnce();
    expect(player.refs.play.getAttribute('aria-label')).toBe('Pause video');
    expect(video.srcObject).toBe(source);
    expect(video.playbackRate).toBe(1.5);
  });

  it('does not control media adopted into another document and still clears the original timer', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('play'));
    const other = document.implementation.createHTMLDocument('other');
    other.body.append(other.adoptNode(video));
    player.refs.play.click();
    expect(video.pause).not.toHaveBeenCalled();
    player.cleanup();
    expect(player.timer).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(host.hasAttribute('data-vsc-inline-idle')).toBe(false);
  });

  it('clamps media-local skip and timeline actions, keeps pause/rate intact, and toggles mute', () => {
    player.setOwned(true);
    video.currentTime = 2;
    player.refs.rewind.click();
    expect(video.currentTime).toBe(0);
    video.currentTime = 117;
    player.refs.forward.click();
    expect(video.currentTime).toBe(120);
    player.refs.timeline.value = '45';
    player.refs.timeline.dispatchEvent(new Event('input', { bubbles: true }));
    expect(video.currentTime).toBe(45);
    expect(actionHandler.seek.mock.calls.map(([, delta]) => delta)).toEqual([-2, 3, -75]);
    expect(player.refs.timeline.min).toBe('0');
    expect(player.refs.timeline.max).toBe('120');
    player.refs.mute.click();
    expect(video.muted).toBe(true);
    expect(player.refs.mute.getAttribute('aria-label')).toBe('Unmute video');
    player.refs.mute.click();
    expect(video.muted).toBe(false);
    expect(paused).toBe(true);
    expect(video.playbackRate).toBe(1.5);
    expect(video.vsc.iosPlayer.open).not.toHaveBeenCalled();
  });

  it('uses a finite live seek window and disables seeking when the window/current time is unavailable', () => {
    duration = Infinity;
    video.currentTime = 120;
    Object.defineProperty(video, 'seekable', {
      configurable: true,
      value: { length: 1, start: () => 100, end: () => 150 },
    });
    player.setOwned(true);
    expect(player.refs.timeline.min).toBe('100');
    expect(player.refs.timeline.max).toBe('150');
    expect(player.refs.timelineGroup.hidden).toBe(false);
    player.seekTo(200);
    expect(video.currentTime).toBe(150);
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => NaN });
    video.dispatchEvent(new Event('durationchange'));
    expect(player.refs.timeline.disabled).toBe(true);
    expect(player.refs.timelineGroup.hidden).toBe(true);
    expect(player.refs.rewind.disabled).toBe(true);
    expect(player.refs.forward.disabled).toBe(true);
  });

  it.each([
    [80, 200, 'minimal', false, false, false],
    [120, 68, 'compact', false, false, false],
    [200, 120, 'standard', false, false, false],
    [239, 144, 'standard', false, false, false],
    [240, 95, 'compact', false, false, false],
    [240, 96, 'standard', false, false, true],
    [300, 200, 'standard', false, true, true],
    [360, 200, 'standard', true, true, true],
  ])(
    'progressively fits owned targets to %s×%s',
    (width, height, mode, secondary, timeline, mute) => {
      position(width, height);
      player.setOwned(true);
      expect(host.getAttribute('data-vsc-inline-layout')).toBe(mode);
      expect(player.refs.play.hidden).toBe(false);
      expect(player.refs.mute.hidden).toBe(!mute);
      expect(player.refs.rewind.hidden).toBe(!secondary);
      expect(player.refs.timelineGroup.hidden).toBe(!timeline);
      expect(parseFloat(player.root.style.getPropertyValue('--vsc-inline-owned-width'))).toBe(
        width - 8
      );
      const css = shadow.querySelector('style').textContent;
      expect(css).toContain('min-height: 44px');
      expect(css).toContain("[data-vsc-inline-layout='minimal']");
    }
  );

  it('uses clipping and occlusion before readiness returns without a separate geometry scan', () => {
    player.setOwned(true);
    const place = vi.spyOn(player, 'position');
    const hit = vi.spyOn(manager, 'avoidInlineOcclusion');
    media = { left: -40, top: 40, width: 200, height: 200, right: 160, bottom: 240 };
    const ready = vi.fn(() => {
      expect(host.getAttribute('data-vsc-inline-layout')).toBe('compact');
      expect(player.root.style.getPropertyValue('--vsc-inline-owned-width')).toBe('152px');
      expect(player.refs.play.hidden).toBe(false);
    });
    video.addEventListener('loadedmetadata', ready);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(ready).toHaveBeenCalledOnce();
    expect(place).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 160,
        height: 200,
        clipped: expect.objectContaining({ left: 0, right: 160 }),
      })
    );
    expect(hit).toHaveBeenCalled();
  });

  it.each(['unavailable', 'throwing'])(
    'keeps the owned bar inside painted media with %s computed geometry',
    (computed) => {
      const root = player.root;
      if (computed === 'throwing') {
        const original = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
          if (node === root) {
            throw new Error('unavailable');
          }
          return original(node);
        });
      }
      const scale = () => Number(root.style.getPropertyValue('--vsc-inline-scale-y')) || 1;
      Object.defineProperty(root, 'offsetWidth', {
        configurable: true,
        get: () => parseFloat(root.style.getPropertyValue('--vsc-inline-owned-width')) || 92,
      });
      Object.defineProperty(root, 'offsetHeight', {
        configurable: true,
        get: () => (player.refs.timelineGroup.hidden ? 44 : 92) / scale(),
      });
      root.getBoundingClientRect = () => {
        const match = root.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
        const left = match ? Number(match[1]) * 2 : 0;
        const top = match ? Number(match[2]) * 2 : 0;
        const width = root.offsetWidth * 2;
        const height = root.offsetHeight * 2;
        return { left, top, width, height, right: left + width, bottom: top + height };
      };
      player.setOwned(true);
      const actual = root.getBoundingClientRect();
      expect(player.scale).toEqual({ x: 2, y: 2 });
      expect(actual.left).toBeGreaterThanOrEqual(media.left + 4);
      expect(actual.right).toBeLessThanOrEqual(media.right - 4);
      expect(actual.bottom).toBeLessThanOrEqual(media.bottom - 4);
      expect(root.style.getPropertyValue('--vsc-inline-owned-width')).toBe('196px');
    }
  );

  it('converges across repeated 0.75 scale placement with fractional used boxes and rounded offsets', () => {
    const root = player.root;
    const transformScale = 0.75;
    const usedWidth = () =>
      parseFloat(root.style.getPropertyValue('--vsc-inline-owned-width')) || 169 + 1 / 3;
    const usedHeight = () =>
      44 / (Number(root.style.getPropertyValue('--vsc-inline-scale-y')) || 1);
    Object.defineProperty(root, 'offsetWidth', {
      configurable: true,
      get: () => Math.round(usedWidth()),
    });
    Object.defineProperty(root, 'offsetHeight', {
      configurable: true,
      get: () => Math.round(usedHeight()),
    });
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) =>
      node === root
        ? { boxSizing: 'border-box', width: `${usedWidth()}px`, height: `${usedHeight()}px` }
        : original(node)
    );
    root.getBoundingClientRect = () => {
      const match = root.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      const left = match ? Number(match[1]) * transformScale : 0;
      const top = match ? Number(match[2]) * transformScale : 0;
      const width = usedWidth() * transformScale;
      const height = usedHeight() * transformScale;
      return { left, top, width, height, right: left + width, bottom: top + height };
    };
    position(135, 180);
    player.setOwned(true);
    for (let index = 0; index < 20; index++) {
      manager.positionInlineControls(shadow, video);
      expect(player.scale.x).toBeCloseTo(transformScale, 12);
      expect(player.scale.y).toBeCloseTo(transformScale, 12);
      const paintedWidth =
        (44 / Number(root.style.getPropertyValue('--vsc-inline-scale-x'))) * transformScale;
      const paintedHeight =
        (44 / Number(root.style.getPropertyValue('--vsc-inline-scale-y'))) * transformScale;
      expect(paintedWidth).toBeCloseTo(44, 10);
      expect(paintedHeight).toBeCloseTo(44, 10);
      const actual = root.getBoundingClientRect();
      expect(actual.width).toBeCloseTo(127, 10);
      expect(actual.left).toBeCloseTo(media.left + 4, 10);
      expect(actual.right).toBeCloseTo(media.right - 4, 10);
    }
  });

  it('starts a relative picture scrub while the entire transport is idle and suppresses its click', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(4000);
    expect(player.idle).toBe(true);
    const point = (type, x, target = video) => {
      const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
      Object.assign(event, { pointerId: 17, pointerType: 'touch', clientX: x, clientY: 170 });
      target.dispatchEvent(event);
      return event;
    };
    point('pointerdown', 140);
    expect(point('pointermove', 180).defaultPrevented).toBe(true);
    expect(player.scrubber.surface).toBe(video);
    expect(player.idle).toBe(false);
    expect(Number(player.refs.timeline.value)).toBe(24);
    expect(paused).toBe(true);
    point('pointerup', 200, window);
    expect(video.currentTime).toBe(30);
    expect(video.play).toHaveBeenCalledOnce();
    video.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(player.idle).toBe(false);
    point('pointerdown', 200);
    point('pointerup', 200, video);
    video.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(player.idle).toBe(true);
  });

  it('restores scoped touch policy on handback without changing inline touch styles', () => {
    video.style.touchAction = 'manipulation';
    video.setAttribute('data-vsc-inline-scrub', 'site-value');
    player.setOwned(true);
    const policy = player.surfacePolicy;
    expect(policy.style.isConnected).toBe(true);
    expect(video.style.touchAction).toBe('manipulation');
    expect(policy.style.textContent).toContain('pan-y pinch-zoom');
    player.setOwned(false);
    expect(video.getAttribute('data-vsc-inline-scrub')).toBe('site-value');
    expect(policy.style.isConnected).toBe(false);
    expect(player.gestures.stage).toBeNull();
    expect(video.style.touchAction).toBe('manipulation');
  });

  it('installs touch policy in the media open shadow root and releases it on cleanup', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const root = parent.attachShadow({ mode: 'open' });
    root.append(video);
    player.setOwned(true);
    expect(player.surfacePolicy.style.getRootNode()).toBe(root);
    const style = player.surfacePolicy.style;
    player.cleanup();
    expect(style.isConnected).toBe(false);
    expect(video.hasAttribute('data-vsc-inline-scrub')).toBe(false);
    parent.remove();
  });

  it('refreshes scoped touch policy through document and shadow-root placement repairs', () => {
    player.setOwned(true);
    const first = document.createElement('section'),
      second = document.createElement('section');
    document.body.append(first, second);
    const a = first.attachShadow({ mode: 'open' }),
      b = second.attachShadow({ mode: 'open' });
    for (const root of [a, b, document.body]) {
      const previous = player.surfacePolicy;
      root.append(video);
      position();
      expect(player.surfacePolicy.root).toBe(video.getRootNode());
      expect(player.surfacePolicy.style.getRootNode()).toBe(video.getRootNode());
      expect(previous.style.isConnected).toBe(false);
      expect(video.currentTime).toBe(12);
      expect(video.pause).not.toHaveBeenCalled();
    }
    first.remove();
    second.remove();
  });

  it('scrubs through a recognized picture overlay and removes its gesture subscriptions', () => {
    const container = document.createElement('section');
    document.body.append(container);
    const cover = document.createElement('button');
    cover.getBoundingClientRect = () => media;
    container.append(video, cover);
    video.vsc.iosPlayer.siteControls = { container };
    player.setOwned(true);
    const release = player.observeSurface(container);
    const pointer = (type, x) => {
      const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
      Object.assign(event, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: 170 });
      cover.dispatchEvent(event);
    };
    pointer('pointerdown', 140);
    pointer('pointermove', 180);
    expect(player.scrubber.active).toBe(true);
    pointer('pointerup', 180);
    expect(video.currentTime).toBe(24);
    release();
    pointer('pointerdown', 140);
    pointer('pointermove', 180);
    expect(player.scrubber.active).toBe(false);
    container.appendChild(video); // Keep normal fixture teardown ownership.
    document.body.append(video);
    container.remove();
  });

  it('scrubs a focusable X picture inside a navigable tweet without claiming mute or vertical input', () => {
    vi.spyOn(window.VSC.IOSSiteControls, 'isXDocument').mockReturnValue(true);
    const post = document.createElement('article');
    post.setAttribute('role', 'link');
    post.tabIndex = 0;
    const container = document.createElement('div');
    const trigger = document.createElement('div');
    trigger.setAttribute('data-slot', 'xds-context-menu-trigger');
    trigger.tabIndex = 0;
    const cover = document.createElement('button');
    cover.setAttribute('aria-label', 'Play');
    const controls = document.createElement('div');
    controls.className = 'group/controls';
    const mute = document.createElement('button');
    mute.setAttribute('aria-label', 'Mute');
    controls.append(mute);
    trigger.append(cover, controls);
    container.append(video, trigger);
    post.append(container);
    document.body.append(post);
    video.vsc.iosPlayer.siteControls = { container };
    player.setOwned(true);
    const release = player.observeSurface(container);
    const pointer = (type, x, y, target = trigger) => {
      const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
      Object.assign(event, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y });
      target.dispatchEvent(event);
      return event;
    };
    pointer('pointerdown', 140, 170);
    expect(pointer('pointermove', 140, 210).defaultPrevented).toBe(false);
    pointer('pointerup', 140, 210);
    expect(video.currentTime).toBe(12);
    pointer('pointerdown', 140, 170, mute);
    pointer('pointermove', 180, 170, mute);
    pointer('pointerup', 180, 170, mute);
    expect(video.currentTime).toBe(12);
    pointer('pointerdown', 140, 170);
    pointer('pointermove', 180, 170);
    expect(player.scrubber.active).toBe(true);
    pointer('pointerup', 180, 170);
    expect(video.currentTime).toBe(24);
    release();
    document.body.append(video);
    post.remove();
  });

  describe('unknown picture overlays', () => {
    let container, cover, pointDescriptor;
    const pointer = (type, x = 140, y = 170, target = cover, id = 7) => {
      const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
      Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
      target.dispatchEvent(event);
      return event;
    };

    beforeEach(() => {
      container = document.createElement('section');
      cover = document.createElement('div');
      container.getBoundingClientRect = () => media;
      cover.getBoundingClientRect = () => media;
      document.body.append(container);
      container.append(video, cover);
      pointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn(() => cover),
      });
      cover.addEventListener('pointermove', (event) => event.stopImmediatePropagation());
      player.setOwned(true);
    });

    afterEach(() => {
      document.body.append(video);
      container.remove();
      if (pointDescriptor) {
        Object.defineProperty(document, 'elementFromPoint', pointDescriptor);
      } else {
        delete document.elementFromPoint;
      }
    });

    it('captures horizontal intent through an unknown overlay without hiding it', () => {
      expect(player.surfaceContainer.node).toBe(container);
      expect(pointer('pointerdown').defaultPrevented).toBe(false);
      expect(video.pause).not.toHaveBeenCalled();
      expect(pointer('pointermove', 180).defaultPrevented).toBe(true);
      expect(player.scrubber.active).toBe(true);
      pointer('pointerup', 180, 170, window);
      expect(video.currentTime).toBe(24);
      expect(cover.style.cssText).toBe('');
      expect(container.hasAttribute('data-vsc-ios-site-controls')).toBe(false);
    });

    it('dismisses an open speed menu with a picture tap and releases interaction observers', () => {
      manager.setTouchExpanded(shadow, true);
      pointer('pointerdown');
      pointer('pointerup');
      cover.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          composed: true,
          detail: 1,
          clientX: 140,
          clientY: 170,
        })
      );
      expect(host.classList.contains('vsc-touch-open')).toBe(false);
      expect(player.idle).toBe(false);
      const clicked = vi.spyOn(player, 'pictureClicked');
      player.setOwned(false);
      cover.click();
      expect(clicked).not.toHaveBeenCalled();
    });

    it.each(['video', 'audio', 'iframe'])(
      'rejects a new %s inserted after pointerdown before commitment',
      (tag) => {
        pointer('pointerdown');
        container.append(document.createElement(tag));
        pointer('pointermove', 180);
        expect(player.scrubber.active).toBe(false);
        expect(video.pause).not.toHaveBeenCalled();
        expect(video.currentTime).toBe(12);
      }
    );

    it('rejects a newly covering dialog despite implicit capture retaining the old target', () => {
      pointer('pointerdown');
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      document.elementFromPoint.mockReturnValue(dialog);
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
      expect(video.pause).not.toHaveBeenCalled();
      dialog.remove();
    });

    it('rejects an independent control appearing at the original touch point', () => {
      pointer('pointerdown');
      const button = document.createElement('button');
      button.getBoundingClientRect = () => ({ left: 120, top: 150, right: 164, bottom: 194 });
      cover.append(button);
      document.elementFromPoint.mockReturnValue(button);
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
      expect(video.pause).not.toHaveBeenCalled();
    });

    it('checks the original hit once and lets a committed precision drag leave the picture', () => {
      pointer('pointerdown');
      pointer('pointermove', 440);
      expect(player.scrubber.active).toBe(true);
      expect(document.elementFromPoint).toHaveBeenCalledExactlyOnceWith(140, 170);
      document.elementFromPoint.mockReturnValue(document.body);
      pointer('pointermove', 450, 10, window);
      expect(player.scrubber.active).toBe(true);
      expect(document.elementFromPoint).toHaveBeenCalledTimes(1);
    });

    it('resolves the current hit through an open shadow root at commitment', () => {
      const shell = document.createElement('div');
      document.body.append(shell);
      const root = shell.attachShadow({ mode: 'open' });
      root.append(container);
      root.elementFromPoint = vi.fn(() => cover);
      document.elementFromPoint.mockReturnValue(shell);
      player.installSurfacePolicy();
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(true);
      expect(root.elementFromPoint).toHaveBeenCalledExactlyOnceWith(140, 170);
      document.body.append(container);
      shell.remove();
    });

    it('rejects a throwing commitment hit test without consuming the movement', () => {
      pointer('pointerdown');
      document.elementFromPoint.mockImplementation(() => {
        throw new Error('site replacement');
      });
      expect(pointer('pointermove', 180).defaultPrevented).toBe(false);
      expect(player.scrubber.active).toBe(false);
    });

    it('rechecks source identity after the commitment hit test', () => {
      pointer('pointerdown');
      document.elementFromPoint.mockImplementation(() => {
        video.src = 'https://example.test/replaced.mp4';
        return cover;
      });
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
      expect(video.pause).not.toHaveBeenCalled();
    });

    it('rejects a replaced scope before commitment without cancelling direct video scrubs', () => {
      pointer('pointerdown');
      player.releaseSurfaceContainer();
      player.refreshSurfaceContainer();
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
      pointer('pointerup');
      pointer('pointerdown', 140, 170, video);
      container.append(document.createElement('video'));
      pointer('pointermove', 180, 170, video);
      expect(player.scrubber.active).toBe(true);
    });

    it('retains recognized picture gestures in a focusable player and enclosing dialog', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.tabIndex = -1;
      container.tabIndex = 0;
      document.body.append(dialog);
      dialog.append(container);
      video.vsc.iosPlayer.siteControls = { container };
      player.refreshSurfaceContainer();
      const release = player.observeSurface(container);
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(true);
      release();
      document.body.append(container);
      dialog.remove();
    });

    it('leaves vertical intent and two-finger browser gestures alone', () => {
      pointer('pointerdown');
      expect(pointer('pointermove', 140, 210).defaultPrevented).toBe(false);
      pointer('pointerup', 140, 210);
      pointer('pointerdown');
      expect(pointer('pointerdown', 180, 170, cover, 8).defaultPrevented).toBe(false);
      expect(pointer('pointermove', 190).defaultPrevented).toBe(false);
      expect(player.scrubber.active).toBe(false);
      expect(video.currentTime).toBe(12);
      expect(video.pause).not.toHaveBeenCalled();
    });

    it.each([
      'button',
      'a',
      'input',
      'label',
      'summary',
      'slider',
      'editable',
      'dialog',
      'focusable',
    ])('preserves independent %s input', (kind) => {
      const control = document.createElement(
        ['slider', 'editable', 'dialog', 'focusable'].includes(kind) ? 'div' : kind
      );
      if (kind === 'slider') {
        control.setAttribute('role', 'slider');
      }
      if (kind === 'editable') {
        control.setAttribute('contenteditable', 'true');
      }
      if (kind === 'dialog') {
        control.setAttribute('role', 'dialog');
      }
      if (kind === 'focusable') {
        control.tabIndex = 0;
      }
      control.getBoundingClientRect = () => ({ left: 100, top: 100, right: 144, bottom: 144 });
      cover.append(control);
      pointer('pointerdown', 120, 120, control);
      expect(pointer('pointermove', 160, 120, control).defaultPrevented).toBe(false);
      expect(player.scrubber.active).toBe(false);
      expect(video.pause).not.toHaveBeenCalled();
    });

    it('accepts a full-picture ARIA button, preserving its ordinary taps', () => {
      cover.setAttribute('role', 'button');
      pointer('pointerdown');
      expect(pointer('pointerup').defaultPrevented).toBe(false);
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(true);
    });

    it.each(['video', 'audio', 'iframe'])(
      'rejects a recycled scope containing another %s',
      (tag) => {
        container.append(document.createElement(tag));
        pointer('pointerdown');
        pointer('pointermove', 180);
        expect(player.scrubber.active).toBe(false);
        player.refreshSurfaceContainer();
        expect(player.surfaceContainer).toBeNull();
      }
    );

    it('does not climb into a larger page region to claim an unrelated overlay', () => {
      container.getBoundingClientRect = () => ({ ...media, bottom: media.bottom + 80 });
      player.refreshSurfaceContainer();
      expect(player.surfaceContainer).toBeNull();
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
    });

    it('releases the old scope on reparenting and restores marker intent on handback', () => {
      const old = player.surfaceContainer;
      document.body.append(video);
      position();
      expect(old.style.isConnected).toBe(false);
      expect(container.hasAttribute(old.attribute)).toBe(false);
      container.append(video);
      container.setAttribute(old.attribute, 'site-original');
      position();
      const current = player.surfaceContainer;
      player.setOwned(false);
      expect(current.style.isConnected).toBe(false);
      expect(container.getAttribute(old.attribute)).toBe('site-original');
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
    });

    it('reaches sibling feed overlays across a zero-height tracking wrapper', () => {
      const tracker = document.createElement('div');
      tracker.style.overflowX = tracker.style.overflowY = 'visible';
      tracker.getBoundingClientRect = () => ({ ...media, height: 0, bottom: media.top });
      const inner = document.createElement('div');
      inner.getBoundingClientRect = () => media;
      container.prepend(tracker);
      tracker.append(inner);
      inner.append(video);
      player.installSurfacePolicy();
      expect(player.surfaceContainer.node).toBe(container);
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(true);
      pointer('pointerup', 180, 170, window);
      expect(video.currentTime).toBe(24);
      tracker.style.overflowY = 'hidden';
      player.refreshSurfaceContainer();
      expect(player.surfaceContainer.node).toBe(inner);
      pointer('pointerdown');
      pointer('pointermove', 220);
      expect(player.scrubber.active).toBe(false);
    });

    it('scrubs an expanded site viewer overlay outside its recognized player', () => {
      const known = document.createElement('div');
      known.getBoundingClientRect = () => media;
      container.prepend(known);
      known.append(video);
      video.vsc.iosPlayer.siteControls = { container: known };
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.tabIndex = -1;
      container.tabIndex = 0;
      document.body.append(dialog);
      dialog.append(container);
      player.installSurfacePolicy();
      expect(player.surfaceContainer.node).toBe(container);
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(true);
      pointer('pointerup', 180, 170, window);
      expect(video.currentTime).toBe(24);
      document.body.append(container);
      dialog.remove();
    });

    it('preserves a navigation link wrapping the picture scope', () => {
      const link = document.createElement('a');
      link.href = '#post';
      document.body.append(link);
      link.append(container);
      pointer('pointerdown');
      pointer('pointermove', 180);
      expect(player.scrubber.active).toBe(false);
      document.body.append(container);
      link.remove();
    });
  });

  it('fades the entire playing transport together, retaining layout and restoring on pause', () => {
    player.setOwned(true);
    vi.advanceTimersByTime(5000);
    expect(player.idle).toBe(false);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(3999);
    expect(player.idle).toBe(false);
    vi.advanceTimersByTime(1);
    expect(host.hasAttribute('data-vsc-inline-idle')).toBe(true);
    // Geometry stays stable; one parent visibility state hides every control.
    expect(player.refs.rewind.hidden).toBe(false);
    expect(player.refs.timelineGroup.hidden).toBe(false);
    expect(player.refs.play.hidden).toBe(false);
    video.click();
    expect(player.idle).toBe(false);
    paused = true;
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(5000);
    expect(player.idle).toBe(false);
  });

  it('does not write hidden progress until the inline transport is revealed', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(4000);
    expect(player.idle).toBe(true);
    const previous = player.refs.timeline.value;
    const observer = new MutationObserver(() => {});
    observer.observe(player.root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    video.currentTime = 40;
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('progress'));
    expect(observer.takeRecords()).toEqual([]);
    expect(player.refs.timeline.value).toBe(previous);
    player.reveal();
    expect(player.idle).toBe(false);
    expect(player.refs.timeline.value).toBe('40');
    expect(player.refs.timeline.getAttribute('aria-valuetext')).toBe('0:40 / 2:00');
    observer.disconnect();
  });

  it('toggles on picture taps while playing or paused without changing playback', () => {
    player.setOwned(true);
    for (const playing of [true, false]) {
      paused = !playing;
      video.dispatchEvent(new Event(playing ? 'playing' : 'pause'));
      video.click();
      expect(player.idle).toBe(true);
      video.dispatchEvent(new Event('timeupdate'));
      expect(player.idle).toBe(true);
      video.click();
      expect(player.idle).toBe(false);
      vi.advanceTimersByTime(4000);
      expect(player.idle).toBe(playing);
    }
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    player.setOwned(false);
    video.click();
    expect(player.timer).toBeNull();
  });

  it('keeps a long scrub visible and starts a fresh interval after release', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    scrubPointer('pointerdown');
    vi.advanceTimersByTime(7000);
    expect(player.scrubber.active).toBe(true);
    expect(player.idle).toBe(false);
    scrubPointer('pointerup', 60);
    expect(video.play).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(3999);
    expect(player.idle).toBe(false);
    vi.advanceTimersByTime(1);
    expect(player.idle).toBe(true);
  });

  it.each(['click', 'keydown', 'focusin', 'pointermove'])(
    'reveals the entire transport on picture %s without consuming input',
    (type) => {
      player.setOwned(true);
      paused = false;
      video.dispatchEvent(new Event('playing'));
      vi.advanceTimersByTime(4000);
      expect(player.idle).toBe(true);
      const event = new Event(type, { bubbles: true, cancelable: true });
      video.dispatchEvent(event);
      expect(player.idle).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(video.pause).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4000);
      expect(player.idle).toBe(true);
    }
  );

  it.each(['touch', 'mouse'])(
    'uses the pre-press visibility for a %s picture click and holds the idle deadline',
    (pointerType) => {
      player.setOwned(true);
      paused = false;
      video.dispatchEvent(new Event('playing'));
      const pointer = (type, target = video) => {
        const event = new Event(type, { bubbles: true });
        Object.assign(event, { pointerId: 17, pointerType });
        target.dispatchEvent(event);
      };
      pointer('pointerdown');
      vi.advanceTimersByTime(6000);
      expect(player.idle).toBe(false);
      pointer('pointerup', window);
      video.dispatchEvent(new MouseEvent('click', { detail: 1 }));
      expect(player.idle).toBe(true);
      pointer('pointerdown');
      pointer('pointerup', window);
      video.dispatchEvent(new MouseEvent('click', { detail: 1 }));
      expect(player.idle).toBe(false);
      vi.advanceTimersByTime(3999);
      expect(player.idle).toBe(false);
      vi.advanceTimersByTime(1);
      expect(player.idle).toBe(true);
      expect(player.heldPointers.size).toBe(0);
      expect(player.pointerRemovers).toHaveLength(0);
    }
  );

  it('retains held input and the picture snapshot through ordinary control focus transfer', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    player.refs.play.focus();
    const down = new Event('pointerdown', { bubbles: true });
    Object.assign(down, { pointerId: 17, pointerType: 'touch' });
    video.dispatchEvent(down);
    player.refs.rewind.focus();
    expect(player.heldPointers.size).toBe(1);
    expect(player.pictureTap).toEqual({ visible: true });
    vi.advanceTimersByTime(6000);
    expect(player.idle).toBe(false);
    const up = new Event('pointerup');
    Object.assign(up, { pointerId: 17 });
    window.dispatchEvent(up);
    expect(player.heldPointers.size).toBe(0);
    expect(player.pointerRemovers).toHaveLength(0);
    video.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(player.idle).toBe(true);
  });

  it.each(['pointercancel', 'blur', 'pagehide', 'loadstart', 'handback', 'cleanup'])(
    'releases held pointers on %s',
    (type) => {
      player.setOwned(true);
      const event = new Event('pointerdown', { bubbles: true });
      Object.assign(event, { pointerId: 7, pointerType: 'touch' });
      player.refs.play.dispatchEvent(event);
      expect(player.heldPointers.size).toBe(1);
      if (type === 'handback') {
        player.setOwned(false);
      } else if (type === 'cleanup') {
        player.cleanup();
      } else {
        const end = new Event(type);
        Object.assign(end, { pointerId: 7 });
        (type === 'loadstart' ? video : window).dispatchEvent(end);
      }
      expect(player.heldPointers.size).toBe(0);
      expect(player.pointerRemovers).toHaveLength(0);
    }
  );

  it('keeps the speed menu open and starts a fresh shared interval on picture dismissal', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    shadow.querySelector('.draggable').click();
    vi.advanceTimersByTime(7000);
    expect(host.classList.contains('vsc-touch-open')).toBe(true);
    expect(player.idle).toBe(false);
    expect(manager.inlineHideTimer).toBeNull();
    video.click();
    expect(host.classList.contains('vsc-touch-open')).toBe(false);
    expect(player.idle).toBe(false);
    vi.advanceTimersByTime(4000);
    expect(player.idle).toBe(true);
  });

  it('lets keyboard focus reveal idle controls without introducing another tab stop', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(4000);
    expect(player.idle).toBe(true);
    expect(player.root.inert).toBeFalsy();
    player.refs.play.focus();
    expect(player.idle).toBe(false);
    expect(shadow.activeElement).toBe(player.refs.play);
    vi.advanceTimersByTime(5000);
    expect(player.idle).toBe(false);
  });

  it('keeps the compact fallback reachable and restores it when resized from an idle player', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(4000);
    expect(player.idle).toBe(true);
    position(200, 120);
    expect(player.idle).toBe(false);
    video.click();
    vi.advanceTimersByTime(6000);
    expect(player.idle).toBe(false);
    position();
    vi.advanceTimersByTime(4000);
    expect(player.idle).toBe(true);
  });

  it.each(['pointercancel', 'handback', 'loadstart'])(
    'ignores late range input/change after %s and accepts a fresh gesture',
    (change) => {
      player.setOwned(true);
      scrubPointer('pointerdown');
      if (change === 'pointercancel') {
        scrubPointer('pointercancel');
      } else if (change === 'handback') {
        player.setOwned(false);
        player.setOwned(true);
      } else {
        video.dispatchEvent(new Event('loadstart'));
      }
      player.refs.timeline.value = '80';
      player.refs.timeline.dispatchEvent(new Event('input', { bubbles: true }));
      player.refs.timeline.dispatchEvent(new Event('change', { bubbles: true }));
      expect(actionHandler.seek).not.toHaveBeenCalled();
      expect(video.currentTime).toBe(12);
      scrubPointer('pointerdown');
      scrubPointer('pointermove', 85);
      scrubPointer('pointerup', 85);
      expect(video.currentTime).toBe(30);
    }
  );

  it.each(['play', 'speed', 'fullscreen'])(
    'keeps the revealed %s target in place through pointerdown, focus, pointerup and activation',
    (control) => {
      player.setOwned(true);
      paused = false;
      video.dispatchEvent(new Event('playing'));
      vi.advanceTimersByTime(4000);
      video.click();
      expect(player.idle).toBe(false);
      const primary = [
        player.refs.play,
        shadow.querySelector('.draggable'),
        shadow.querySelector('.inline-fullscreen'),
      ];
      const target = primary[['play', 'speed', 'fullscreen'].indexOf(control)];
      const targets = new Set([
        ...primary,
        player.refs.rewind,
        player.refs.forward,
        player.refs.mute,
      ]);
      // jsdom does not lay out flex rows. Model painted offsets from the actual
      // visible flex-item order; inserted/hidden predecessors change the target.
      const offset = () => {
        let left = 0;
        for (const node of player.root.children) {
          if (node === target) {
            return left;
          }
          if (targets.has(node) && !node.hidden) {
            left += 48;
          }
        }
        return -1;
      };
      expect([...player.root.children].slice(0, 3)).toEqual(primary);
      const before = offset();
      expect(player.refs.rewind.hidden).toBe(false);
      touch(target);
      expect(player.refs.rewind.hidden).toBe(false);
      expect(offset()).toBe(before);
      target.focus();
      expect(offset()).toBe(before);
      target.dispatchEvent(new Event('pointerup', { bubbles: true, composed: true }));
      expect(offset()).toBe(before);
      target.click();
      expect(actionHandler.seek).not.toHaveBeenCalled();
      if (control === 'play') {
        expect(video.pause).toHaveBeenCalledOnce();
        expect(paused).toBe(true);
      } else if (control === 'speed') {
        expect(host.classList.contains('vsc-touch-open')).toBe(true);
        expect(video.pause).not.toHaveBeenCalled();
      } else {
        expect(video.vsc.iosPlayer.open).toHaveBeenCalledExactlyOnceWith({ fullscreen: true });
        expect(video.pause).not.toHaveBeenCalled();
      }
    }
  );

  it('keeps focused keyboard transport available and ignores actions during owned/system presentation', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('play'));
    player.refs.play.focus();
    vi.advanceTimersByTime(4000);
    expect(player.refs.rewind.hidden).toBe(false);
    video.vsc.iosPlayer.active = true;
    player.refs.play.click();
    expect(video.pause).not.toHaveBeenCalled();
    video.vsc.iosPlayer.active = false;
    host.classList.add('vsc-native-presentation');
    player.refs.play.click();
    expect(video.pause).not.toHaveBeenCalled();
    host.classList.remove('vsc-native-presentation');
    player.refs.play.click();
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it.each(['src', 'srcObject'])(
    'ignores a stale play rejection after %s replacement before loadstart',
    async (property) => {
      let reject;
      video.play.mockImplementation(() => new Promise((resolve, failure) => (reject = failure)));
      player.setOwned(true);
      player.refs.play.click();
      const generation = player.generation;
      if (property === 'src') {
        video.src = 'https://example.test/replacement.mp4';
      } else {
        Object.defineProperty(video, 'srcObject', { configurable: true, value: {} });
      }
      // Native loadstart is queued; its generation invalidation has not run yet.
      expect(player.generation).toBe(generation);
      reject(new Error('old source rejected'));
      await Promise.resolve();
      expect(player.refs.status.textContent).toBe('');
    }
  );

  it('still reports a pending play rejection for the same source before loadstart', async () => {
    let reject;
    video.play.mockImplementation(() => new Promise((resolve, failure) => (reject = failure)));
    player.setOwned(true);
    player.refs.play.click();
    reject(new Error('current source rejected'));
    await Promise.resolve();
    expect(player.refs.status.textContent).toBe('Playback could not start.');
  });

  it('reports a rejected play but ignores rejection after a newer resource or handback', async () => {
    let reject;
    video.play = vi.fn(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        })
    );
    player.setOwned(true);
    player.refs.play.click();
    reject(new Error('denied'));
    await Promise.resolve();
    expect(player.refs.status.textContent).toBe('Playback could not start.');
    player.refs.play.click();
    video.dispatchEvent(new Event('loadstart'));
    reject(new Error('old source'));
    await Promise.resolve();
    expect(player.refs.status.textContent).toBe('');
    player.refs.play.click();
    player.setOwned(false);
    reject(new Error('after handback'));
    await Promise.resolve();
    expect(player.refs.status.textContent).toBe('');
  });

  it('does not call play after source inspection reenters inline ownership', () => {
    player.setOwned(true);
    const currentSrc = video.currentSrc;
    let reads = 0;
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      get() {
        if (++reads === 2) {
          Object.defineProperty(video, 'currentSrc', { configurable: true, value: currentSrc });
          player.setOwned(false);
          player.setOwned(true);
        }
        return currentSrc;
      },
    });
    player.play();
    expect(reads).toBe(2);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('ignores an old failure after a source getter reenters inline ownership', async () => {
    let reject;
    video.play.mockImplementation(() => new Promise((_resolve, failure) => (reject = failure)));
    player.setOwned(true);
    player.play();
    const generation = player.generation;
    const currentSrc = video.currentSrc;
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      get() {
        Object.defineProperty(video, 'currentSrc', { configurable: true, value: currentSrc });
        player.setOwned(false);
        player.setOwned(true);
        return currentSrc;
      },
    });
    reject(new Error('old ownership rejected'));
    await Promise.resolve();
    expect(player.generation).toBeGreaterThan(generation);
    expect(player.owned).toBe(true);
    expect(player.refs.status.textContent).toBe('');
  });

  it.each(['cleanup', 'fullscreen'])(
    'does not arm a hide timer after a media getter triggers %s during refresh',
    (transition) => {
      player.setOwned(true);
      paused = false;
      Object.defineProperty(video, 'duration', {
        configurable: true,
        get() {
          Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
          if (transition === 'cleanup') {
            player.cleanup();
          } else {
            video.vsc.iosPlayer.active = true;
          }
          return duration;
        },
      });
      video.dispatchEvent(new Event('playing'));
      expect(player.available()).toBe(false);
      expect(player.timer).toBeNull();
    }
  );

  it.each(['play', 'playing', 'pause', 'ended', 'emptied', 'loadstart'])(
    'refreshes once and reveals current controls immediately on %s',
    (type) => {
      player.setOwned(true);
      paused = !['play', 'playing'].includes(type);
      ended = type === 'ended';
      player.idle = true;
      host.setAttribute('data-vsc-inline-idle', '');
      player.applyLayout();
      const generation = player.generation;
      const durationRead = vi.fn(() => duration);
      Object.defineProperty(video, 'duration', { configurable: true, get: durationRead });
      const update = vi.spyOn(player, 'update');
      video.dispatchEvent(new Event(type));
      expect({
        refreshes: update.mock.calls.length,
        durationReads: durationRead.mock.calls.length,
      }).toEqual({ refreshes: 1, durationReads: paused ? 4 : 3 });
      expect(player.idle).toBe(false);
      expect(host.hasAttribute('data-vsc-inline-idle')).toBe(false);
      expect(player.refs.timelineGroup.hidden).toBe(false);
      expect(player.refs.play.getAttribute('aria-label')).toBe(
        ended ? 'Replay video' : paused ? 'Play video' : 'Pause video'
      );
      expect(player.generation).toBe(
        generation + (['emptied', 'loadstart'].includes(type) ? 1 : 0)
      );
      expect(player.timer === null).toBe(paused);
      vi.advanceTimersByTime(3999);
      expect(player.idle).toBe(false);
      vi.advanceTimersByTime(1);
      expect(player.idle).toBe(!paused);
      expect(player.timer).toBeNull();
    }
  );

  it.each(['play', 'playing', 'pause', 'ended', 'emptied', 'loadstart'])(
    'releases pending scrubbing and hide timers on unavailable %s',
    (type) => {
      player.setOwned(true);
      paused = false;
      player.reveal();
      scrubPointer('pointerdown');
      scrubPointer('pointermove', 70);
      expect(player.scrubber.active).toBe(true);
      expect(player.scrubber.pending).not.toBeNull();
      const writes = actionHandler.seek.mock.calls.length;
      video.vsc.iosPlayer.active = true;
      video.dispatchEvent(new Event(type));
      expect(player.scrubber.active).toBe(false);
      expect(player.scrubber.pending).toBeNull();
      expect(player.timer).toBeNull();
      vi.advanceTimersByTime(3000);
      expect(actionHandler.seek).toHaveBeenCalledTimes(writes);
      expect(video.play).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('does not rewrite unchanged controls on progress and tolerates throwing page getters', () => {
    player.setOwned(true);
    const observer = new MutationObserver(() => {});
    observer.observe(player.root, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    for (const type of ['timeupdate', 'progress', 'volumechange']) {
      video.dispatchEvent(new Event(type));
    }
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get() {
        throw new Error('gone');
      },
    });
    expect(() => player.update()).not.toThrow();
    expect(player.refs.timeline.disabled).toBe(true);
  });

  it('releases its timers, media/window/button listeners and nodes on manager cleanup', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('play'));
    const remove = vi.spyOn(video, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const oldPlay = player.refs.play;
    scrubPointer('pointerdown');
    manager.cleanup();
    expect(manager.inlinePlayer).toBeNull();
    expect(player.disposed).toBe(true);
    expect(player.timer).toBeNull();
    expect(oldPlay.isConnected).toBe(false);
    expect(remove).toHaveBeenCalledWith('timeupdate', expect.any(Function), undefined);
    expect(removeWindow).toHaveBeenCalledWith('pointerup', expect.any(Function), true);
    expect(removeWindow).toHaveBeenCalledWith('pointercancel', expect.any(Function), true);
    oldPlay.click();
    vi.advanceTimersByTime(5000);
    expect(video.play).not.toHaveBeenCalled();
    expect(host.hasAttribute('data-vsc-inline-owned')).toBe(false);
  });
  it('uses one captured inline gesture across precision bands and commits the final release', () => {
    player.setOwned(true);
    paused = false;
    scrubPointer('pointerdown');
    expect(video.pause).toHaveBeenCalledOnce();
    let x = 40;
    let expected = 12;
    for (const [distance, gain, direction] of [
      [0, 1, 1],
      [60, 0.5, 1],
      [100, 0.25, 1],
      [150, 0.1, 1],
      [100, 0.25, -1],
      [60, 0.5, -1],
      [0, 1, -1],
    ]) {
      const y = 122 - distance;
      scrubPointer('pointermove', x, y);
      expect(player.scrubber.value).toBeCloseTo(expected, 8);
      x += direction * 30;
      expected += direction * 12 * gain;
      scrubPointer('pointermove', x, y);
      expect(Number(player.refs.timeline.value)).toBeCloseTo(expected, 8);
      expect(player.refs.time.textContent).toMatch(/\d+:\d{2}\.\d{2} \/ 2:00/);
      expect(player.refs.scrubHint.textContent).toBe(
        gain === 1 ? '' : gain === 0.5 ? '×1/2' : gain === 0.25 ? '×1/4' : '×1/10'
      );
      if (gain === 0.1) {
        expect(player.refs.scrubHint.textContent).toBe('×1/10');
        expect(player.refs.time.textContent).toBe('0:34.20 / 2:00');
      }
      expect(video.play).not.toHaveBeenCalled();
    }
    scrubPointer('pointerup', x + 3);
    expect(video.currentTime).toBeCloseTo(expected + 1.2, 8);
    expect(video.play).toHaveBeenCalledOnce();
    expect(player.scrubber.active).toBe(false);
    expect(player.refs.scrubHint.textContent).toBe('');
    expect(video.vsc.iosPlayer.open).not.toHaveBeenCalled();
  });

  it('restores an inline cancelled scrub and never changes a previously paused playback state', () => {
    player.setOwned(true);
    scrubPointer('pointerdown');
    scrubPointer('pointermove', 100);
    vi.advanceTimersByTime(50);
    expect(video.currentTime).toBeCloseTo(36);
    scrubPointer('pointercancel', 100);
    expect(video.currentTime).toBe(12);
    expect(video.play).not.toHaveBeenCalled();
    expect(player.scrubber.gestureListeners).toHaveLength(0);
    expect(player.scrubber.timer).toBeNull();
  });

  it('keeps playback running if the site resumes during an inline scrub', () => {
    player.setOwned(true);
    paused = false;
    scrubPointer('pointerdown');
    scrubPointer('pointermove', 100);
    paused = false;
    scrubPointer('pointerup', 100);
    expect(paused).toBe(false);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('does not resume a source replaced by the final inline seek', () => {
    player.setOwned(true);
    paused = false;
    scrubPointer('pointerdown');
    scrubPointer('pointermove', 100);
    actionHandler.seek.mockImplementation((target, delta) => {
      target.currentTime += delta;
      target.dispatchEvent(new Event('loadstart'));
    });
    player.scrubber.finish(null);
    expect(actionHandler.seek).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(player.scrubber.active).toBe(false);
    expect(player.scrubber.gestureListeners).toHaveLength(0);
    expect(player.scrubber.timer).toBeNull();
  });

  it.each(['src', 'srcObject'])(
    'does not resume a %s replacement before queued native source events arrive',
    (kind) => {
      player.setOwned(true);
      paused = false;
      scrubPointer('pointerdown');
      scrubPointer('pointermove', 100);
      actionHandler.seek.mockImplementation((target, delta) => {
        target.currentTime += delta;
        if (kind === 'src') {
          target.src = 'https://example.test/next.mp4';
        } else {
          Object.defineProperty(target, 'srcObject', { configurable: true, value: {} });
        }
      });
      player.scrubber.finish(null);
      expect(video.play).not.toHaveBeenCalled();
      expect(player.scrubber.active).toBe(false);
      expect(player.scrubber.gestureListeners).toHaveLength(0);
      expect(player.scrubber.timer).toBeNull();
    }
  );

  it.each(['loadstart', 'handback', 'fullscreen', 'cleanup'])(
    'abandons pending inline scrubbing after %s without a stale seek or resume',
    (reason) => {
      player.setOwned(true);
      paused = false;
      scrubPointer('pointerdown');
      scrubPointer('pointermove', 100);
      if (reason === 'loadstart') {
        video.dispatchEvent(new Event('loadstart'));
      } else if (reason === 'handback') {
        player.setOwned(false);
      } else if (reason === 'fullscreen') {
        video.vsc.iosPlayer.active = true;
        player.update();
      } else {
        manager.cleanup();
      }
      const count = actionHandler.seek.mock.calls.length;
      scrubPointer('pointermove', 200);
      scrubPointer('pointerup', 200);
      vi.advanceTimersByTime(300);
      expect(actionHandler.seek).toHaveBeenCalledTimes(count);
      expect(video.play).not.toHaveBeenCalled();
      expect(player.scrubber.active).toBe(false);
      expect(player.scrubber.timer).toBeNull();
    }
  );
  it('does not play a recycled source when replay seeking synchronously loads another clip', () => {
    player.setOwned(true);
    ended = true;
    actionHandler.seek.mockImplementation(() => video.dispatchEvent(new Event('loadstart')));
    player.play();
    expect(actionHandler.seek).toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });
  it('does not play a replay source replaced before loadstart is dispatched', () => {
    player.setOwned(true);
    ended = true;
    actionHandler.seek.mockImplementation(() => {
      video.src = 'https://example.test/next.mp4';
    });
    player.play();
    expect(actionHandler.seek).toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });

  it.each(['currentSrc', 'srcObject'])(
    'keeps native Play available when %s inspection throws',
    async (property) => {
      player.setOwned(true);
      const generation = player.generation;
      video.play.mockImplementation(() => Promise.reject(new Error('current playback failed')));
      Object.defineProperty(video, property, {
        configurable: true,
        get() {
          throw new Error('page source getter unavailable');
        },
      });

      player.play();

      expect(video.play).toHaveBeenCalledOnce();
      expect(player.owned).toBe(true);
      expect(player.generation).toBe(generation);
      await Promise.resolve();
      expect(player.refs.status.textContent).toBe('');
    }
  );

  it('does not call native Play when throwing inspection changes ownership', () => {
    player.setOwned(true);
    Object.defineProperty(video, 'currentSrc', {
      configurable: true,
      get() {
        player.setOwned(false);
        player.setOwned(true);
        throw new Error('page source getter changed ownership');
      },
    });

    player.play();

    expect(video.play).not.toHaveBeenCalled();
  });

  it('leaves no orphan hide timer after ownership reenters reveal update', () => {
    player.setOwned(true);
    paused = false;
    player.clearTimer();
    const schedule = vi.spyOn(window, 'setTimeout');
    const clear = vi.spyOn(window, 'clearTimeout');
    let reentered = false;
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get() {
        if (!reentered) {
          reentered = true;
          Object.defineProperty(video, 'duration', {
            configurable: true,
            get: () => duration,
          });
          player.setOwned(false);
          player.setOwned(true);
        }
        return duration;
      },
    });

    player.reveal();

    expect(reentered).toBe(true);
    const hideCalls = schedule.mock.calls
      .map(([, delay], index) => (delay === 4000 ? index : -1))
      .filter((index) => index >= 0);
    expect(hideCalls).toHaveLength(1);
    const hideTimer = schedule.mock.results[hideCalls[0]].value;
    expect(player.timer).toBe(hideTimer);
    manager.cleanup();
    expect(player.timer).toBeNull();
    expect(clear).toHaveBeenCalledWith(hideTimer);
  });
});

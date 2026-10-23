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
    player.refs.play.click();
    expect(video.play).toHaveBeenCalledOnce();
    expect(player.refs.play.getAttribute('aria-label')).toBe('Pause video');
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
    [80, 200, 'minimal', false, false],
    [120, 68, 'compact', false, false],
    [200, 120, 'standard', false, false],
    [300, 200, 'standard', false, true],
    [360, 200, 'standard', true, true],
  ])('progressively fits owned targets to %s×%s', (width, height, mode, secondary, timeline) => {
    position(width, height);
    player.setOwned(true);
    expect(host.getAttribute('data-vsc-inline-layout')).toBe(mode);
    expect(player.refs.play.hidden).toBe(false);
    expect(player.refs.mute.hidden).toBe(!secondary);
    expect(player.refs.rewind.hidden).toBe(!secondary);
    expect(player.refs.timelineGroup.hidden).toBe(!timeline);
    expect(parseFloat(player.root.style.getPropertyValue('--vsc-inline-owned-width'))).toBe(
      width - 8
    );
    const css = shadow.querySelector('style').textContent;
    expect(css).toContain('min-height: 44px');
    expect(css).toContain("[data-vsc-inline-layout='minimal']");
  });

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

  it('keeps paused controls available, collapses playing secondary controls and restores on interaction', () => {
    player.setOwned(true);
    vi.advanceTimersByTime(5000);
    expect(player.refs.rewind.hidden).toBe(false);
    paused = false;
    video.dispatchEvent(new Event('playing'));
    vi.advanceTimersByTime(2500);
    expect(host.hasAttribute('data-vsc-inline-idle')).toBe(true);
    expect(player.refs.rewind.hidden).toBe(true);
    expect(player.refs.timelineGroup.hidden).toBe(true);
    expect(player.refs.play.hidden).toBe(false);
    touch(player.refs.play);
    expect(player.refs.rewind.hidden).toBe(false);
    expect(player.refs.timelineGroup.hidden).toBe(false);
    paused = true;
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(5000);
    expect(host.hasAttribute('data-vsc-inline-idle')).toBe(false);
    expect(player.refs.rewind.hidden).toBe(false);
  });

  it('does not write hidden progress until the inline transport is revealed', () => {
    player.setOwned(true);
    paused = false;
    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(2500);
    expect(player.refs.timelineGroup.hidden).toBe(true);
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
    expect(player.refs.timelineGroup.hidden).toBe(false);
    expect(player.refs.timeline.value).toBe('40');
    expect(player.refs.timeline.getAttribute('aria-valuetext')).toBe('0:40 / 2:00');
    observer.disconnect();
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
    'keeps the idle %s target in place through pointerdown, focus, pointerup and activation',
    (control) => {
      player.setOwned(true);
      paused = false;
      video.dispatchEvent(new Event('playing'));
      vi.advanceTimersByTime(2500);
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
      expect(player.refs.rewind.hidden).toBe(true);
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
    vi.advanceTimersByTime(2500);
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
      vi.advanceTimersByTime(2499);
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
      expect(player.refs.scrubHint.textContent).not.toBe('');
      if (gain === 0.1) {
        expect(player.refs.scrubHint.textContent).toContain('Tenth');
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
      .map(([, delay], index) => (delay === 2500 ? index : -1))
      .filter((index) => index >= 0);
    expect(hideCalls).toHaveLength(1);
    const hideTimer = schedule.mock.results[hideCalls[0]].value;
    expect(player.timer).toBe(hideTimer);
    manager.cleanup();
    expect(player.timer).toBeNull();
    expect(clear).toHaveBeenCalledWith(hideTimer);
  });
});

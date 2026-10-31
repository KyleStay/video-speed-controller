import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/core/twitter-playback-health.js';

describe('Twitter owned-MP4 decoded playback recovery', () => {
  const MP4 = 'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/clip.mp4';
  let doc, view, video, controller, health, state, recovery, identity, frames, intersections;
  let previousRecovery;

  class FixtureIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnect = vi.fn();
      intersections.push(this);
    }
    observe() {}
    unobserve() {}
  }

  const emit = (type) => video.dispatchEvent(new Event(type));
  const intersect = (visible) => {
    state.intersecting = visible;
    for (const observer of intersections) {
      observer.callback([
        { target: video, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 },
      ]);
    }
  };
  const deliverMetadata = (metadata) => {
    for (const [handle, callback] of [...frames]) {
      frames.delete(handle);
      callback(view.performance.now(), metadata);
    }
  };
  const deliveredFrame = () => {
    state.decoded++;
    deliverMetadata({ presentedFrames: state.decoded, mediaTime: state.time });
  };
  async function elapse(ms, { clock = true, decoded = false } = {}) {
    for (let remaining = ms; remaining > 0;) {
      const step = Math.min(250, remaining);
      if (clock) {
        state.time += (step / 1000) * state.rate;
      }
      if (decoded) {
        deliveredFrame();
      }
      await vi.advanceTimersByTimeAsync(step);
      remaining -= step;
    }
  }
  function attach() {
    health = new window.VSC.TwitterPlaybackHealth(controller);
    controller.playbackHealth = health;
    intersect(true);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    intersections = [];
    doc = document.implementation.createHTMLDocument('Owned X playback fixture');
    view = new EventTarget();
    Object.assign(view, {
      navigator: { userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 },
      location: new URL('https://x.com/example/status/123'),
      performance: window.performance,
      innerWidth: 390,
      innerHeight: 844,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      getComputedStyle: window.getComputedStyle.bind(window),
      IntersectionObserver: FixtureIntersectionObserver,
    });
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: view });
    Object.defineProperty(doc, 'URL', { configurable: true, value: view.location.href });
    state = {
      paused: false,
      ended: false,
      seeking: false,
      readyState: 4,
      time: 10,
      duration: 300,
      rate: 4,
      decoded: 0,
      hidden: false,
      intersecting: true,
      currentSrc: MP4,
    };
    Object.defineProperty(doc, 'hidden', { configurable: true, get: () => state.hidden });
    Object.defineProperty(doc, 'visibilityState', {
      configurable: true,
      get: () => (state.hidden ? 'hidden' : 'visible'),
    });
    vi.stubGlobal('IntersectionObserver', FixtureIntersectionObserver);
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
    video = doc.createElement('video');
    video.src = MP4;
    doc.body.append(video);
    for (const name of ['paused', 'ended', 'seeking', 'readyState', 'duration', 'currentSrc']) {
      Object.defineProperty(video, name, { configurable: true, get: () => state[name] });
    }
    for (const [name, key] of [
      ['currentTime', 'time'],
      ['playbackRate', 'rate'],
    ]) {
      Object.defineProperty(video, name, {
        configurable: true,
        get: () => state[key],
        set: (value) => {
          state[key] = value;
        },
      });
    }
    Object.defineProperty(video, 'buffered', {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => state.duration },
    });
    video.muted = false;
    video.volume = 0.65;
    video.getBoundingClientRect = () => ({
      x: 0,
      y: state.intersecting ? 0 : 1000,
      left: 0,
      right: 390,
      top: state.intersecting ? 0 : 1000,
      bottom: state.intersecting ? 220 : 1220,
      width: 390,
      height: 220,
    });
    video.getVideoPlaybackQuality = vi.fn(() => ({
      totalVideoFrames: state.decoded,
      droppedVideoFrames: 0,
    }));
    let handle = 0;
    video.requestVideoFrameCallback = vi.fn((callback) => {
      frames.set(++handle, callback);
      return handle;
    });
    video.cancelVideoFrameCallback = vi.fn((id) => frames.delete(id));
    video.load = vi.fn();
    video.play = vi.fn(() => Promise.resolve());
    video.pause = vi.fn();
    controller = { video, disposed: false, config: { settings: { enabled: true } } };
    video.vsc = controller;
    identity = {};
    previousRecovery = window.VSC.TwitterPlaybackRecovery;
    recovery = {
      identity: vi.fn(() => identity),
      reload: vi.fn(() => true),
      ownsTransition: vi.fn(() => false),
      reportStall: vi.fn((owner) => previousRecovery.reportStall.call(recovery, owner)),
      clearStall: vi.fn((owner) => previousRecovery.clearStall.call(recovery, owner)),
    };
    window.VSC.TwitterPlaybackRecovery = recovery;
  });

  afterEach(() => {
    health?.cleanup();
    health = null;
    window.VSC.TwitterPlaybackRecovery = previousRecovery;
    doc.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('recovers when no frame has ever arrived although the buffered media clock advances', async () => {
    attach();
    await elapse(3500);
    expect(state.time).toBeGreaterThan(20);
    expect(video.requestVideoFrameCallback).toHaveBeenCalled();
    expect(recovery.reload).toHaveBeenCalledExactlyOnceWith(controller);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.65);
  });

  it.each(['loadeddata', 'canplay', 'progress'])(
    'arms on %s after attachment and intersection occurred before buffered readiness',
    async (type) => {
      state.readyState = 1;
      Object.defineProperty(video, 'buffered', { configurable: true, value: { length: 0 } });
      attach();
      expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
      state.readyState = 4;
      Object.defineProperty(video, 'buffered', {
        configurable: true,
        value: { length: 1, start: () => 0, end: () => state.duration },
      });
      // No replacement constructor, artificial refresh(), or extra playing
      // event: the browser's data/readiness event must start observation.
      emit(type);
      await elapse(3500);
      expect(recovery.reload).toHaveBeenCalledExactlyOnceWith(controller);
    }
  );

  it('does not mistake an advancing clock for decoded frame progress after a healthy start', async () => {
    attach();
    await elapse(2000, { decoded: true });
    expect(recovery.reload).not.toHaveBeenCalled();
    await elapse(4000);
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('leaves sustained decoded playback alone', async () => {
    attach();
    await elapse(20000, { decoded: true });
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(frames.size).toBeLessThanOrEqual(1);
  });

  it('accepts quality-counter progress when frame callbacks have not arrived', async () => {
    attach();
    for (let n = 0; n < 24; n++) {
      state.decoded++;
      await elapse(500);
    }
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('does not mistake repeated identical frame metadata for newly presented frames', async () => {
    attach();
    for (let n = 0; n < 16; n++) {
      for (const [handle, callback] of [...frames]) {
        frames.delete(handle);
        callback(view.performance.now(), { presentedFrames: 0, mediaTime: 10 });
      }
      await elapse(250);
    }
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('detects frozen metadata first delivered off the deadline boundary instead of postponing forever', async () => {
    attach();
    await elapse(125);
    for (let n = 0; n < 12; n++) {
      deliverMetadata({ presentedFrames: 0, mediaTime: 10 });
      await elapse(250);
      if (n === 10) {
        expect(recovery.reload).not.toHaveBeenCalled();
      }
    }
    // One real sample at125ms followed by duplicates must be stale at3125ms.
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('keeps the pending frame callback and its metadata across a healthy deadline', async () => {
    attach();
    await elapse(125);
    deliverMetadata({ presentedFrames: 1, mediaTime: 10 });
    await elapse(2825);
    deliverMetadata({ presentedFrames: 2, mediaTime: 11 });
    const pending = [...frames.keys()];
    expect(pending).toHaveLength(1);
    await elapse(100);
    expect([...frames.keys()]).toEqual(pending);
    expect(video.cancelVideoFrameCallback).not.toHaveBeenCalled();
    deliverMetadata({ presentedFrames: 2, mediaTime: 11 });
    await elapse(2900);
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('reports a reload request separately from recovery until two finite advancing samples arrive', async () => {
    attach();
    await elapse(3500);
    expect(health.lastRecovery).toMatchObject({ status: 'requested', attempt: 1, frames: 0 });
    deliverMetadata({ presentedFrames: 1, mediaTime: 12 });
    expect(health.lastRecovery.status).toBe('requested');
    deliverMetadata({ presentedFrames: 2, mediaTime: 12.1 });
    expect(health.lastRecovery).toMatchObject({ status: 'frames-resumed', frames: 2 });
    expect(recovery.reportStall).not.toHaveBeenCalled();
  });

  it.each([
    [
      'nonfinite',
      { presentedFrames: NaN, mediaTime: Infinity },
      { presentedFrames: Infinity, mediaTime: NaN },
    ],
    ['identical', { presentedFrames: 1, mediaTime: 12 }, { presentedFrames: 1, mediaTime: 12 }],
    ['regressing', { presentedFrames: 2, mediaTime: 12 }, { presentedFrames: 1, mediaTime: 11 }],
    ['different fields', { presentedFrames: 1 }, { mediaTime: 12 }],
  ])('does not claim decoded recovery from %s samples', async (_reason, first, second) => {
    attach();
    await elapse(3500);
    deliverMetadata(first);
    deliverMetadata(second);
    expect(health.lastRecovery.status).toBe('requested');
  });

  it('does not let a replaced identity or cancelled frame callback declare recovery', async () => {
    attach();
    await elapse(3500);
    deliverMetadata({ presentedFrames: 1, mediaTime: 12 });
    identity = {};
    deliverMetadata({ presentedFrames: 2, mediaTime: 13 });
    expect(health.lastRecovery.status).toBe('requested');
    const stale = [...frames.values()];
    health.sourceChanged(false);
    for (const callback of stale) {
      callback(view.performance.now(), { presentedFrames: 3, mediaTime: 14 });
      callback(view.performance.now(), { presentedFrames: 4, mediaTime: 15 });
    }
    expect(health.lastRecovery).toBeNull();
  });

  it('observes the accepted second reload for a full window before exhaustion, with no third reload', async () => {
    attach();
    await elapse(6100);
    expect(recovery.reload).toHaveBeenCalledTimes(2);
    expect(health.lastRecovery).toMatchObject({ status: 'requested', attempt: 2 });
    expect(frames.size).toBe(1);
    expect(recovery.reportStall).not.toHaveBeenCalled();
    await elapse(2800);
    expect(health.lastRecovery.status).toBe('requested');
    await elapse(200);
    expect(health.lastRecovery).toMatchObject({ status: 'exhausted', attempt: 2 });
    expect(recovery.reportStall).toHaveBeenCalledExactlyOnceWith(controller);
    await elapse(12000);
    expect(recovery.reload).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it('can confirm decoded recovery after the second accepted reload instead of stopping at its budget', async () => {
    attach();
    await elapse(6100);
    expect(recovery.reload).toHaveBeenCalledTimes(2);
    deliverMetadata({ presentedFrames: 1, mediaTime: 12 });
    expect(health.lastRecovery.status).toBe('requested');
    deliverMetadata({ presentedFrames: 2, mediaTime: 12.1 });
    expect(health.lastRecovery).toMatchObject({ status: 'frames-resumed', attempt: 2 });
    await elapse(4000, { decoded: true });
    expect(recovery.reportStall).not.toHaveBeenCalled();
    expect(recovery.reload).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'clears only its own exhausted warning when later frames resume; replaced=%s',
    async (replaced) => {
      const status = doc.createElement('span');
      controller.controlsManager = { inlinePlayer: { refs: { status } } };
      attach();
      await elapse(9100);
      expect(status.textContent).toBe('Playback is still stalled. Try the site player.');
      if (replaced) {
        status.textContent = 'A newer site error.';
      }
      emit('playing');
      deliverMetadata({ presentedFrames: 1, mediaTime: 12 });
      expect(status.textContent).toBe(
        replaced ? 'A newer site error.' : 'Playback is still stalled. Try the site player.'
      );
      deliverMetadata({ presentedFrames: 2, mediaTime: 13 });
      expect(health.lastRecovery.status).toBe('frames-resumed');
      expect(status.textContent).toBe(replaced ? 'A newer site error.' : '');
      expect(recovery.reload).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ['source change', true],
    ['cleanup', true],
    ['new identity', true],
    ['source change', false],
    ['cleanup', false],
    ['new identity', false],
  ])(
    'releases an owned warning on %s only while its controller remains current=%s',
    async (reason, current) => {
      const status = doc.createElement('span');
      controller.controlsManager = { inlinePlayer: { refs: { status } } };
      attach();
      await elapse(9100);
      expect(status.textContent).toBe('Playback is still stalled. Try the site player.');
      recovery.clearStall.mockClear();
      if (!current) {
        video.vsc = {};
      }
      if (reason === 'source change') {
        health.sourceChanged(false);
      } else if (reason === 'cleanup') {
        health.cleanup();
      } else {
        identity = {};
        health.refresh();
      }
      expect(status.textContent).toBe(
        current ? '' : 'Playback is still stalled. Try the site player.'
      );
      expect(recovery.clearStall).toHaveBeenCalledTimes(current ? 1 : 0);
    }
  );

  it.each([undefined, NaN, -1, '1', 0.5])(
    'fails closed when the frame request returns invalid handle %s',
    async (handle) => {
      video.requestVideoFrameCallback.mockReturnValue(handle);
      attach();
      await elapse(10000);
      expect(recovery.reload).not.toHaveBeenCalled();
      expect(health.lastRecovery).toBeNull();
      expect(frames.size).toBe(0);
    }
  );

  it('accepts and cleans up native frame callback handle zero', async () => {
    video.requestVideoFrameCallback.mockImplementation((callback) => {
      frames.set(0, callback);
      return 0;
    });
    attach();
    await elapse(3500);
    expect(recovery.reload).toHaveBeenCalledOnce();
    health.cleanup();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(0);
    expect(frames.size).toBe(0);
  });

  it.each([
    ['opacity', false],
    ['contentVisibility', false],
    ['opacity', true],
    ['contentVisibility', true],
  ])('rejects hidden composed ancestors via %s; shadow=%s', async (property, shadow) => {
    const host = doc.createElement('div');
    host.style[property] = property === 'opacity' ? '0' : 'hidden';
    doc.body.append(host);
    (shadow ? host.attachShadow({ mode: 'open' }) : host).append(video);
    attach();
    await elapse(5000);
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });

  it('also recovers a fully buffered decoder that produces neither clock nor frame progress', async () => {
    attach();
    await elapse(3500, { clock: false });
    expect(state.time).toBe(10);
    expect(recovery.reload).toHaveBeenCalledExactlyOnceWith(controller);
  });

  it('retains its two-attempt budget across its own reload lifecycle', async () => {
    recovery.reload.mockImplementation(() => {
      health.sourceChanged(true);
      recovery.ownsTransition.mockReturnValue(true);
      emit('emptied');
      emit('loadstart');
      recovery.ownsTransition.mockReturnValue(false);
      emit('loadeddata');
      emit('playing');
      return true;
    });
    attach();
    await elapse(20000);
    expect(recovery.reload).toHaveBeenCalledTimes(2);
    await elapse(60000);
    emit('playing');
    health.refresh();
    await elapse(10000);
    expect(recovery.reload).toHaveBeenCalledTimes(2);
  });

  it('does not loop when the adapter refuses recovery', async () => {
    recovery.reload.mockReturnValue(false);
    attach();
    await elapse(20000);
    for (let n = 0; n < 5; n++) {
      emit('playing');
      health.refresh();
      await elapse(4000);
    }
    expect(recovery.reload.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('gives a genuinely new owned clip a fresh recovery budget', async () => {
    recovery.reload.mockReturnValue(false);
    attach();
    await elapse(12000);
    identity = {};
    state.currentSrc = MP4.replace('/123/', '/456/');
    video.src = state.currentSrc;
    health.sourceChanged(false);
    emit('loadstart');
    emit('playing');
    const previousAttempts = recovery.reload.mock.calls.length;
    await elapse(4000);
    expect(recovery.reload.mock.calls.length).toBeGreaterThan(previousAttempts);
  });

  it.each([
    'pause',
    'seeking',
    'hidden',
    'offscreen',
    'near end',
    'removed',
    'disposed',
    'replaced controller',
  ])('does not reload media after it becomes %s during observation', async (reason) => {
    attach();
    await elapse(1000);
    if (reason === 'pause') {
      state.paused = true;
      emit('pause');
    } else if (reason === 'seeking') {
      state.seeking = true;
      emit('seeking');
    } else if (reason === 'hidden') {
      state.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
    } else if (reason === 'offscreen') {
      intersect(false);
    } else if (reason === 'near end') {
      state.time = state.duration - 0.5;
    } else if (reason === 'removed') {
      video.remove();
    } else if (reason === 'disposed') {
      controller.disposed = true;
    } else {
      video.vsc = {};
    }
    await elapse(5000, { clock: reason !== 'near end' });
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('cancels a stale observation when source ownership is lost', async () => {
    attach();
    await elapse(1000);
    identity = null;
    state.currentSrc = 'https://example.test/site-owned.mp4';
    video.src = state.currentSrc;
    health.sourceChanged(false);
    emit('loadstart');
    emit('playing');
    await elapse(5000);
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it.each(['identity', 'frame request', 'quality'])(
    'contains an inaccessible %s API',
    async (kind) => {
      if (kind === 'identity') {
        recovery.identity.mockImplementation(() => {
          throw Error('site getter');
        });
      } else if (kind === 'frame request') {
        video.requestVideoFrameCallback.mockImplementation(() => {
          throw Error('unavailable');
        });
      } else {
        video.getVideoPlaybackQuality.mockImplementation(() => {
          throw Error('unavailable');
        });
      }
      expect(attach).not.toThrow();
      await elapse(5000);
      expect(recovery.reload).not.toHaveBeenCalled();
      expect(() => health.cleanup()).not.toThrow();
    }
  );

  it('does no recovery work without an explicitly owned MP4 identity', async () => {
    identity = null;
    attach();
    await elapse(20000);
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'loading',
    'unbuffered',
    'quality unavailable',
    'ordinary speed',
    'native fullscreen',
    'PiP',
  ])('does not reload %s playback even when no frames arrive', async (reason) => {
    if (reason === 'loading') {
      state.readyState = 2;
    } else if (reason === 'unbuffered') {
      Object.defineProperty(video, 'buffered', { configurable: true, value: { length: 0 } });
    } else if (reason === 'quality unavailable') {
      video.getVideoPlaybackQuality = undefined;
    } else if (reason === 'ordinary speed') {
      state.rate = 1;
    } else if (reason === 'native fullscreen') {
      video.webkitDisplayingFullscreen = true;
    } else {
      Object.defineProperty(doc, 'pictureInPictureElement', { configurable: true, value: video });
    }
    attach();
    await elapse(10000);
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });

  it('starts a fresh observation after pause, rather than counting paused wall time as a stall', async () => {
    attach();
    await elapse(1000);
    state.paused = true;
    emit('pause');
    await elapse(10000, { clock: false });
    expect(recovery.reload).not.toHaveBeenCalled();
    state.paused = false;
    emit('playing');
    await elapse(2000);
    expect(recovery.reload).not.toHaveBeenCalled();
    await elapse(1500);
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('contains a throwing reload and retains its attempt limit', async () => {
    recovery.reload.mockImplementation(() => {
      throw Error('decoder unavailable');
    });
    attach();
    await elapse(4000);
    for (let n = 0; n < 5; n++) {
      emit('playing');
      await elapse(4000);
    }
    expect(recovery.reload).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(false);
  });

  it('stays suspended after pagehide until a persisted pageshow begins a new observation', async () => {
    attach();
    await elapse(1000);
    view.dispatchEvent(new Event('pagehide'));
    emit('progress');
    emit('loadeddata');
    await elapse(10000);
    expect(recovery.reload).not.toHaveBeenCalled();
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    view.dispatchEvent(restored);
    await elapse(3500);
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('releases its frame callback, timer, and listeners so retained callbacks cannot revive recovery', async () => {
    // The shared jsdom/module fixture already has one pending task before
    // health exists. Verify the health-owned timeout and return to that baseline.
    const beforeAttach = vi.getTimerCount();
    const scheduled = vi.spyOn(view, 'setTimeout');
    const cleared = vi.spyOn(view, 'clearTimeout');
    const removals = vi.spyOn(video, 'removeEventListener');
    attach();
    const staleCallbacks = [...frames.values()];
    const whileArmed = vi.getTimerCount();
    health.cleanup();
    expect(whileArmed).toBe(beforeAttach + 1);
    expect(scheduled).toHaveBeenCalledOnce();
    expect(cleared).toHaveBeenCalledWith(scheduled.mock.results[0].value);
    expect(frames.size).toBe(0);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(beforeAttach);
    expect(removals).toHaveBeenCalled();
    for (const callback of staleCallbacks) {
      callback(view.performance.now(), { presentedFrames: 1, mediaTime: state.time });
    }
    emit('playing');
    doc.dispatchEvent(new Event('visibilitychange'));
    await elapse(10000);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(recovery.reload).not.toHaveBeenCalled();
  });
});

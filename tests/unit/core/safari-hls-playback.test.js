import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/core/safari-hls-playback.js';

describe('Safari native HLS progressive playback ownership', () => {
  const HLS = 'https://video.twimg.com/ext_tw_video/123/pu/pl/original.m3u8';
  const MP4 = 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/720x1280/original.mp4';
  let doc, view, video, controller, state, order, resolver;
  let previousResolver;

  function begin(rate = 4, source = 'internal') {
    return window.VSC.SafariHLSPlayback.begin(controller, rate, source);
  }

  function event(type) {
    video.dispatchEvent(new Event(type));
  }

  function loaded() {
    state.currentSrc = MP4;
    state.readyState = 4;
    event('loadeddata');
  }

  function wireSpeedAction() {
    const setSpeed = vi.fn((media, rate, source) => {
      const session = begin(rate, source);
      media.playbackRate = rate;
      session?.finish();
      return true;
    });
    controller.actionHandler = { setSpeed };
    return setSpeed;
  }

  function pendingSitePlay() {
    let resolve, reject;
    let settled = false;
    const promise = new Promise((fulfill, fail) => {
      resolve = () => {
        settled = true;
        fulfill();
      };
      reject = fail;
    });
    // Calling play while already requested joins the site's current promise.
    video.play.mockImplementation(() => {
      state.paused = false;
      return promise;
    });
    const originalLoad = video.load.getMockImplementation();
    video.load.mockImplementation(() => {
      if (!settled) {
        reject(new DOMException('The play request was interrupted by load', 'AbortError'));
      }
      originalLoad();
    });
    return { promise, resolve, reject };
  }

  async function flushInitialization() {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    doc = document.implementation.createHTMLDocument('Playback fixture');
    view = new EventTarget();
    vi.spyOn(view, 'addEventListener');
    Object.assign(view, {
      navigator: { userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 },
      location: { hostname: 'x.com' },
      MutationObserver,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: view });
    Object.defineProperty(doc, 'visibilityState', { configurable: true, value: 'visible' });
    video = doc.createElement('video');
    vi.spyOn(video, 'addEventListener');
    video.src = HLS;
    doc.body.append(video);
    order = [];
    state = {
      paused: false,
      ended: false,
      readyState: 4,
      duration: 120,
      currentSrc: HLS,
      time: 13.455377,
      rate: 1,
    };
    for (const name of ['paused', 'ended', 'readyState', 'duration', 'currentSrc']) {
      Object.defineProperty(video, name, { configurable: true, get: () => state[name] });
    }
    for (const [name, key] of [
      ['currentTime', 'time'],
      ['playbackRate', 'rate'],
    ]) {
      Object.defineProperty(video, name, {
        configurable: true,
        get: () => state[key],
        set(value) {
          order.push([name, value]);
          state[key] = value;
        },
      });
    }
    video.load = vi.fn(() => {
      order.push(['load', video.src]);
      state.paused = true;
      state.currentSrc = '';
      state.readyState = 0;
      state.rate = 1;
    });
    video.play = vi.fn(() => {
      order.push(['play', state.rate, state.time]);
      state.paused = false;
      return Promise.resolve();
    });
    video.pause = vi.fn(() => {
      order.push(['pause']);
      state.paused = true;
    });
    controller = { video, iosPlayer: { nativeSession: false } };
    video.vsc = controller;
    previousResolver = window.VSC.ProgressiveMediaSource;
    resolver = vi.fn(() => ({ originalUrl: HLS, progressiveUrl: MP4, mediaId: '123' }));
    window.VSC.ProgressiveMediaSource = { findCandidate: resolver };
  });

  afterEach(() => {
    controller.safariPlaybackPending?.cleanup();
    controller.safariPlayback?.cleanup({ restore: false });
    window.VSC.ProgressiveMediaSource = previousResolver;
    vi.useRealTimers();
  });

  it('matches iOS video documents across sites', () => {
    expect(window.VSC.SafariHLSPlayback.matches(video)).toBe(true);
    view.location.hostname = 'www.twitter.com';
    expect(window.VSC.SafariHLSPlayback.matches(video)).toBe(true);
    view.location.hostname = 'facebook.com';
    expect(window.VSC.SafariHLSPlayback.matches(video)).toBe(true);
    view.location.hostname = 'x.com';
    view.navigator.userAgent = 'Mozilla/5.0 Macintosh';
    view.navigator.maxTouchPoints = 0;
    expect(window.VSC.SafariHLSPlayback.matches(video)).toBe(false);
  });

  it('does not replace a new site source while currentSrc still identifies the old clip', () => {
    video.src = HLS.replace('/123/', '/456/');
    expect(begin()).toBeNull();
    expect(video.load).not.toHaveBeenCalled();
    expect(video.src).toContain('/456/');
  });

  it.each(['lastSpeed', 'siteDefaultSpeed'])(
    'can initialize subsequent feed media from an explicit %s preference',
    async (key) => {
      controller.config = { settings: { [key]: 3 } };
      wireSpeedAction();
      state.rate = 3;
      expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 3, 'init')).toBe(true);
      expect(video.src).toBe(HLS);
      expect(controller.safariPlayback).toBeUndefined();
      expect(video.load).not.toHaveBeenCalled();
      expect(begin(3, 'init')).toBeNull();
      expect(controller.safariPlaybackPending).toBeDefined();
      expect(video.src).toBe(HLS);
      await flushInitialization();
      expect(controller.safariPlayback).toBeDefined();
      expect(video.src).toBe(MP4);
    }
  );

  it('never treats an unrelated preference or an external site rate as switch authority', () => {
    controller.config = { settings: { lastSpeed: 4 } };
    expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 3, 'init')).toBe(false);
    expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 4, 'external')).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
  });

  it('settles the original site play promise before loading the saved-speed rendition', async () => {
    controller.config = { settings: { lastSpeed: 3 } };
    state.rate = 3;
    const setSpeed = wireSpeedAction();
    const requested = pendingSitePlay();
    const sitePlay = video.play();
    const siteFulfilled = vi.fn(() => order.push(['site-play-fulfilled']));
    expect(begin(3, 'init')).toBeNull();
    sitePlay.then(siteFulfilled);
    expect(controller.safariPlaybackPending).toBeDefined();
    expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 3, 'init')).toBe(false);
    expect(begin(3, 'init')).toBeNull();
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(video.load).not.toHaveBeenCalled();
    expect(order).toEqual([]);

    requested.resolve();
    await sitePlay;
    expect(siteFulfilled).toHaveBeenCalledTimes(1);
    expect(video.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(setSpeed).toHaveBeenCalledExactlyOnceWith(video, 3, 'init');
    expect(controller.safariPlaybackPending).toBeNull();
    expect(video.src).toBe(MP4);
    expect(video.currentTime).toBe(13.455377);
    expect(video.playbackRate).toBe(3);
    expect(video.paused).toBe(false);
    expect(order.findIndex(([type]) => type === 'site-play-fulfilled')).toBeLessThan(
      order.findIndex(([type]) => type === 'load')
    );
  });

  it('does not join or switch paused initialization until a later playing lifecycle', async () => {
    controller.config = { settings: { lastSpeed: 3 } };
    wireSpeedAction();
    state.paused = true;
    expect(begin(3, 'init')).toBeNull();
    expect(controller.safariPlaybackPending).toBeUndefined();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    state.paused = false;
    expect(begin(3, 'init')).toBeNull();
    await flushInitialization();
    expect(video.src).toBe(MP4);
  });

  it.each(['reject', 'throw', 'no promise'])(
    'releases a %s joining play request without loading or retrying',
    async (cause) => {
      controller.config = { settings: { lastSpeed: 3 } };
      const action = wireSpeedAction();
      if (cause === 'reject') {
        video.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
      } else if (cause === 'throw') {
        video.play.mockImplementationOnce(() => {
          throw new Error('site play override');
        });
      } else {
        video.play.mockReturnValueOnce(undefined);
      }
      expect(begin(3, 'init')).toBeNull();
      await flushInitialization();
      vi.advanceTimersByTime(10000);
      expect(controller.safariPlaybackPending).toBeFalsy();
      expect(video.src).toBe(HLS);
      expect(video.load).not.toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(video.play).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['input', 'pause', 'hidden', 'pagehide', 'cleanup', 'detach', 'controller', 'disposed'])(
    'cancels deferred initialization after %s, without late load or playback',
    async (cause) => {
      controller.config = { settings: { lastSpeed: 3 } };
      const action = wireSpeedAction();
      const requested = pendingSitePlay();
      begin(3, 'init');
      if (cause === 'input') {
        view.addEventListener.mock.calls.find(([type]) => type === 'pointerdown')[1]({
          isTrusted: true,
        });
      } else if (cause === 'pause') {
        state.paused = true;
        event('pause');
      } else if (cause === 'hidden') {
        Object.defineProperty(doc, 'visibilityState', { value: 'hidden' });
        doc.dispatchEvent(new Event('visibilitychange'));
      } else if (cause === 'pagehide') {
        view.dispatchEvent(new Event('pagehide'));
      } else if (cause === 'cleanup') {
        controller.safariPlaybackPending.cleanup();
      } else if (cause === 'detach') {
        video.remove();
      } else if (cause === 'controller') {
        video.vsc = {};
      } else {
        controller.disposed = true;
      }
      requested.resolve();
      await flushInitialization();
      expect(controller.safariPlaybackPending).toBeNull();
      expect(video.src).toBe(HLS);
      expect(video.load).not.toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(video.play).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['same src', 'away and back', 'poster', 'loadstart'])(
    'preserves newer site %s intent while waiting for the play promise',
    async (cause) => {
      controller.config = { settings: { lastSpeed: 3 } };
      const action = wireSpeedAction();
      const requested = pendingSitePlay();
      begin(3, 'init');
      if (cause === 'same src') {
        video.src = HLS;
      } else if (cause === 'away and back') {
        video.src = HLS.replace('/123/', '/456/');
        video.src = HLS;
      } else if (cause === 'poster') {
        video.poster = 'https://pbs.twimg.com/changed.jpg';
      } else {
        event('loadstart');
      }
      requested.resolve();
      await flushInitialization();
      expect(video.src).toBe(HLS);
      expect(video.load).not.toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(controller.safariPlaybackPending).toBeNull();
    }
  );

  it.each(['lastSpeed', 'siteDefaultSpeed', 'speedPreferenceRevision'])(
    'never reapplies an older deferred rate after %s changes',
    async (key) => {
      controller.config = { settings: { lastSpeed: 3 }, speedPreferenceRevision: 0 };
      const action = wireSpeedAction();
      const requested = pendingSitePlay();
      begin(3, 'init');
      if (key === 'speedPreferenceRevision') {
        controller.config.speedPreferenceRevision++;
      } else {
        controller.config.settings[key] = 4;
      }
      requested.resolve();
      await flushInitialization();
      expect(video.load).not.toHaveBeenCalled();
      expect(action).not.toHaveBeenCalled();
      expect(controller.safariPlaybackPending).toBeNull();
    }
  );

  it.each(['external', 'slower explicit', 'faster explicit'])(
    'gives a newer %s command precedence over the pending init',
    async (kind) => {
      controller.config = { settings: { lastSpeed: 3 } };
      const action = wireSpeedAction();
      const requested = pendingSitePlay();
      begin(3, 'init');
      const session = begin(
        kind === 'slower explicit' ? 2 : 4,
        kind === 'external' ? 'external' : 'internal'
      );
      expect(controller.safariPlaybackPending).toBeNull();
      if (kind === 'faster explicit') {
        expect(session).toBeDefined();
        expect(video.load).toHaveBeenCalledTimes(1);
      } else {
        expect(session).toBeNull();
        expect(video.load).not.toHaveBeenCalled();
      }
      requested.resolve();
      await flushInitialization();
      expect(action).not.toHaveBeenCalled();
      expect(video.load).toHaveBeenCalledTimes(kind === 'faster explicit' ? 1 : 0);
    }
  );

  it('bounds the joining play wait and ignores fulfillment after its deadline', async () => {
    controller.config = { settings: { lastSpeed: 3 } };
    const action = wireSpeedAction();
    const requested = pendingSitePlay();
    begin(3, 'init');
    vi.advanceTimersByTime(10000);
    expect(controller.safariPlaybackPending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    requested.resolve();
    await flushInitialization();
    expect(video.load).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('cancels input received after fulfillment but before the deferred load task', async () => {
    controller.config = { settings: { lastSpeed: 3 } };
    const action = wireSpeedAction();
    const requested = pendingSitePlay();
    begin(3, 'init');
    requested.resolve();
    await Promise.resolve();
    view.addEventListener.mock.calls.find(([type]) => type === 'keydown')[1]({ isTrusted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(controller.safariPlaybackPending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('catches pending-observer construction failure without leaving ownership or a timer', () => {
    controller.config = { settings: { lastSpeed: 3 } };
    view.MutationObserver = class {
      constructor() {
        throw new Error('observer unavailable');
      }
    };
    expect(begin(3, 'init')).toBeNull();
    expect(controller.safariPlaybackPending).toBeNull();
    expect(video.load).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases pending work if a later page-owned source getter throws', async () => {
    controller.config = { settings: { lastSpeed: 3 } };
    const action = wireSpeedAction();
    const requested = pendingSitePlay();
    begin(3, 'init');
    Object.defineProperty(video, 'currentSrc', {
      get() {
        throw new Error('site getter');
      },
    });
    requested.resolve();
    await flushInitialization();
    expect(controller.safariPlaybackPending).toBeNull();
    expect(video.load).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the original node and queues position before the same-call rate write and play', () => {
    const child = doc.createElement('source');
    child.src = HLS;
    video.append(child);
    const session = begin();
    expect(controller.safariPlayback).toBe(session);
    expect(controller.video).toBe(video);
    expect(video.firstChild).toBe(child);
    expect(video.src).toBe(MP4);
    expect(video.readyState).toBe(0);
    video.playbackRate = 4;
    session.finish();
    expect(order).toEqual([
      ['load', MP4],
      ['currentTime', 13.455377],
      ['playbackRate', 4],
      ['play', 4, 13.455377],
    ]);
    expect(session.ownsTransition()).toBe(true);
    loaded();
    expect(session.ownsTransition()).toBe(false);
    expect(session.ownsSource()).toBe(true);
  });

  it('never starts or later resumes a paused video', () => {
    state.paused = true;
    const session = begin();
    video.playbackRate = 4;
    session.finish();
    loaded();
    event('playing');
    vi.advanceTimersByTime(20000);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
  });

  it.each([
    [2, 'internal'],
    [1, 'internal'],
    [NaN, 'internal'],
    [Infinity, 'internal'],
    [4, 'init'],
    [4, 'external'],
  ])('does not resolve or switch for rate %s, source %s', (rate, source) => {
    expect(begin(rate, source)).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
  });

  it.each([
    [
      'desktop',
      () => {
        view.navigator.userAgent = 'Mozilla/5.0 Macintosh';
        view.navigator.maxTouchPoints = 0;
      },
    ],
    ['live', () => (state.duration = Infinity)],
    ['unknown duration', () => (state.duration = NaN)],
    ['unready', () => (state.readyState = 0)],
    ['stream', () => Object.defineProperty(video, 'srcObject', { value: {} })],
    ['DRM', () => Object.defineProperty(video, 'mediaKeys', { value: {} })],
    ['legacy DRM', () => Object.defineProperty(video, 'webkitKeys', { value: {} })],
    ['multiple audio', () => Object.defineProperty(video, 'audioTracks', { value: [{}, {}] })],
    ['in-band text', () => Object.defineProperty(video, 'textTracks', { value: [{}] })],
    ['native fullscreen', () => (controller.iosPlayer.nativeSession = true)],
    [
      'PiP',
      () => Object.defineProperty(video, 'webkitPresentationMode', { value: 'picture-in-picture' }),
    ],
    ['detached', () => video.remove()],
    ['replacement controller', () => (video.vsc = {})],
    ['site player', () => window.VSC.IOSPlayer.siteRelinquished.add(video)],
  ])('leaves %s untouched', (_name, change) => {
    change();
    expect(begin()).toBeNull();
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
  });

  it('rejects missing, stale, and throwing candidate resolution without breaking playback', () => {
    resolver.mockReturnValueOnce(null);
    expect(begin()).toBeNull();
    resolver.mockReturnValueOnce({ originalUrl: `${HLS}?stale=1`, progressiveUrl: MP4 });
    expect(begin()).toBeNull();
    resolver.mockImplementationOnce(() => {
      throw null;
    });
    expect(begin()).toBeNull();
    expect(video.load).not.toHaveBeenCalled();
  });

  it('allows Safari’s single unnamed empty caption placeholder', () => {
    Object.defineProperty(video, 'textTracks', {
      value: [
        { kind: 'captions', label: '', language: '', mode: 'showing', cues: [], activeCues: [] },
      ],
    });
    expect(begin()).not.toBeNull();
    expect(video.src).toBe(MP4);
  });

  it('keeps externally supplied track nodes and their track identity across the switch', () => {
    const element = doc.createElement('track');
    const track = { kind: 'subtitles', label: 'English', language: 'en', cues: [{}] };
    Object.defineProperty(element, 'track', { value: track });
    Object.defineProperty(video, 'textTracks', { value: [track] });
    video.append(element);
    expect(begin()).not.toBeNull();
    expect(video.firstChild).toBe(element);
    expect(video.textTracks[0]).toBe(track);
  });

  it('rejects multiple empty in-band placeholders', () => {
    const empty = { kind: 'captions', label: '', language: '', cues: [], activeCues: [] };
    Object.defineProperty(video, 'textTracks', { value: [empty, { ...empty }] });
    expect(begin()).toBeNull();
    expect(video.load).not.toHaveBeenCalled();
  });

  it('preserves a verified SDK-created metadata track while blocking any unrelated in-band metadata', () => {
    const track = {
      kind: 'metadata',
      label: 'media-cues',
      inBandMetadataTrackDispatchType: '',
      cues: [{}],
    };
    Object.defineProperty(video, 'textTracks', { configurable: true, value: [track] });
    resolver.mockReturnValue({
      originalUrl: HLS,
      progressiveUrl: MP4,
      provider: 'videojs',
      persistentMetadataTrack: track,
    });
    const session = begin();
    expect(session).toBeTruthy();
    expect(video.textTracks[0]).toBe(track);
    session.cleanup();
    state.currentSrc = HLS;
    video.src = HLS;
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: [track, { kind: 'metadata' }],
    });
    expect(begin()).toBeNull();
  });
  it('checks the track count before attempting iteration', () => {
    const iterate = vi.fn(() => {
      throw new Error('must not iterate an oversized track list');
    });
    Object.defineProperty(video, 'textTracks', {
      value: { length: 17, [Symbol.iterator]: iterate },
    });
    expect(begin()).toBeNull();
    expect(iterate).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'English' },
    { language: 'en' },
    { kind: 'subtitles' },
    { kind: 'metadata' },
    { cues: [{}] },
    { activeCues: [{}] },
    { cues: null },
  ])('preserves real or unknown in-band text tracks (%j)', (change) => {
    Object.defineProperty(video, 'textTracks', {
      value: [{ kind: 'captions', label: '', language: '', cues: [], activeCues: [], ...change }],
    });
    expect(begin()).toBeNull();
    expect(video.load).not.toHaveBeenCalled();
  });

  it('resolves an active owned player through only its validated connected origin', () => {
    const anchor = doc.createComment('origin');
    const host = doc.createElement('vsc-ios-player');
    doc.body.insertBefore(anchor, video);
    doc.body.append(host);
    host.append(video);
    Object.assign(controller.iosPlayer, {
      active: true,
      video,
      doc,
      originParent: doc.body,
      anchor,
      portalNode: video,
      ui: { host },
    });
    expect(begin()).not.toBeNull();
    expect(resolver).toHaveBeenCalledWith(video, doc.body);
  });

  it('does not resolve an active portal with a missing origin anchor', () => {
    Object.assign(controller.iosPlayer, { active: true, video, doc, originParent: doc.body });
    expect(begin()).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('updates an existing pending or settled session without reloading or replaying', () => {
    const session = begin();
    video.playbackRate = 4;
    session.finish();
    expect(begin(2)).toBe(session);
    video.playbackRate = 2;
    session.finish();
    loaded();
    expect(begin(3)).toBe(session);
    session.finish();
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('recognizes queued own source events before ordinary source-reset listeners run', () => {
    const reset = vi.fn();
    for (const type of ['emptied', 'loadstart']) {
      video.addEventListener(type, () => {
        if (!controller.safariPlayback?.ownsTransition()) {
          reset();
        }
      });
    }
    const session = begin();
    event('emptied');
    event('loadstart');
    expect(reset).not.toHaveBeenCalled();
    expect(session.ownsTransition()).toBe(true);
    event('loadstart');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(controller.safariPlayback).toBeNull();
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it('settles at loadeddata without retaining the transition deadline', () => {
    const session = begin();
    loaded();
    vi.advanceTimersByTime(10001);
    expect(video.src).toBe(MP4);
    expect(session.closed).toBe(false);
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it('never rolls back a source after the site enters native presentation', () => {
    const session = begin();
    controller.iosPlayer.nativeSession = true;
    session.abort();
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.play).not.toHaveBeenCalled();
  });

  it.each(['deadline', 'error', 'abort'])(
    'rolls %s back once, paused at the current point/rate',
    (cause) => {
      const session = begin();
      video.playbackRate = 4;
      session.finish();
      state.time = 30;
      if (cause === 'deadline') {
        vi.advanceTimersByTime(10000);
      } else if (cause === 'error') {
        event('error');
      } else {
        session.abort();
      }
      expect(video.src).toBe(HLS);
      expect(video.currentTime).toBe(30);
      expect(video.playbackRate).toBe(4);
      expect(video.paused).toBe(true);
      expect(video.play).toHaveBeenCalledTimes(1);
      expect(controller.safariPlayback).toBeNull();
      vi.advanceTimersByTime(20000);
      event('error');
      expect(video.load).toHaveBeenCalledTimes(2);
    }
  );

  it('restores absence of src without replacing source children', () => {
    video.removeAttribute('src');
    const child = doc.createElement('source');
    child.src = HLS;
    video.append(child);
    const session = begin();
    session.abort();
    expect(video.hasAttribute('src')).toBe(false);
    expect(video.firstChild).toBe(child);
  });

  it('hands back without overwriting an away-and-back src write', () => {
    const session = begin();
    video.src = HLS;
    video.src = MP4;
    session.abort();
    expect(video.src).toBe(MP4);
    expect(session.closed).toBe(true);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('treats a same-value site write or poster replacement as fresh site intent', () => {
    const session = begin();
    video.poster = 'https://pbs.twimg.com/new-poster.jpg';
    session.cleanup();
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it('rejects even a same-value site src write queued before cleanup', () => {
    const session = begin();
    video.src = MP4;
    session.cleanup();
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerdown', 'keydown', 'touchstart', 'wheel'])(
    'never rolls a newer trusted %s intent back on error',
    (type) => {
      const session = begin();
      const input = view.addEventListener.mock.calls.find(([name]) => name === type)[1];
      input({ isTrusted: true });
      state.time = 42;
      state.paused = true;
      event('error');
      expect(session.closed).toBe(true);
      expect(video.src).toBe(MP4);
      expect(video.currentTime).toBe(42);
      expect(video.load).toHaveBeenCalledTimes(1);
      expect(video.play).not.toHaveBeenCalled();
    }
  );

  it('does not treat a synthetic input as new playback intent', () => {
    const session = begin();
    view.dispatchEvent(new Event('pointerdown'));
    session.abort();
    expect(video.src).toBe(HLS);
  });

  it.each(['seeking', 'pause'])('preserves a newer native %s intent on failure', (type) => {
    const session = begin();
    session.finish();
    loaded();
    state.time = 42;
    state.paused = true;
    const handler = video.addEventListener.mock.calls.find(([name]) => name === type)[1];
    handler({ isTrusted: true });
    event('error');
    expect(video.src).toBe(MP4);
    expect(video.currentTime).toBe(42);
    expect(video.paused).toBe(true);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('reconciles restored authority/display through init without persisting another request', () => {
    const release = vi.fn();
    controller.config = { settings: { lastSpeed: 4 } };
    controller.actionHandler = {
      eventManager: { releaseMediaState: release },
      setSpeed: vi.fn((media, rate, source) => {
        expect(controller.safariPlayback).toBeNull();
        expect(source).toBe('init');
        media.playbackRate = rate;
      }),
    };
    const session = begin();
    video.playbackRate = 4;
    session.abort();
    expect(release).toHaveBeenCalledWith(video);
    expect(controller.config.settings.lastSpeed).toBe(4);
    expect(controller.actionHandler.setSpeed).toHaveBeenCalledWith(video, 4, 'init');
    expect(video.playbackRate).toBe(4);
  });

  it('preserves a newer remembered sibling command and current seek on a late failure', () => {
    const save = vi.fn(() => Promise.resolve(true));
    controller.config = { settings: { lastSpeed: 4, rememberSpeed: true }, save };
    const session = begin();
    video.playbackRate = 4;
    controller.config.settings.lastSpeed = 8;
    video.currentTime = 37;
    session.abort();
    expect(controller.config.settings.lastSpeed).toBe(8);
    expect(video.currentTime).toBe(37);
    expect(video.playbackRate).toBe(4);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not request another lifecycle transition while the chosen rendition is pending', () => {
    begin();
    state.readyState = 4;
    state.currentSrc = HLS;
    expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 4, 'init')).toBe(false);
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it('never overwrites a newer source on a late play rejection', async () => {
    let reject;
    video.play.mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail)));
    const session = begin();
    session.finish();
    video.src = 'https://video.twimg.com/ext_tw_video/456/pu/pl/next.m3u8';
    reject(new Error('interrupted by new load'));
    await Promise.resolve();
    expect(video.src).toContain('/456/');
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(controller.safariPlayback).toBeNull();
  });

  it('rolls a current rejected play back paused without another play attempt', async () => {
    video.play.mockRejectedValueOnce(new Error('play denied'));
    const session = begin();
    session.finish();
    await Promise.resolve();
    expect(video.src).toBe(HLS);
    expect(video.paused).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('restores the current point on a settled rendition error, without rewinding watched content', () => {
    const session = begin();
    session.finish();
    loaded();
    state.time = 50;
    event('error');
    expect(video.src).toBe(HLS);
    expect(video.currentTime).toBe(50);
    expect(video.paused).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('blocks failed-source init recursion while permitting an explicit retry and a new source', async () => {
    controller.config = { settings: { lastSpeed: 3 } };
    wireSpeedAction();
    state.rate = 3;
    expect(begin(3, 'init')).toBeNull();
    await flushInitialization();
    const session = controller.safariPlayback;
    video.playbackRate = 3;
    session.abort();
    expect(controller.safariPlaybackFailedSource).toBe(HLS);
    state.readyState = 4;
    state.currentSrc = HLS;
    expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 3, 'init')).toBe(false);
    expect(begin(3, 'init')).toBeNull();
    expect(begin(3)).not.toBeNull();
    expect(controller.safariPlaybackFailedSource).toBeNull();
    controller.safariPlayback.cleanup({ restore: false });
    controller.safariPlaybackFailedSource = HLS;
    const nextHLS = HLS.replace('/123/', '/456/');
    const nextMP4 = MP4.replace('/123/', '/456/');
    video.src = nextHLS;
    state.currentSrc = nextHLS;
    state.readyState = 4;
    state.paused = false;
    resolver.mockReturnValue({ originalUrl: nextHLS, progressiveUrl: nextMP4, mediaId: '456' });
    expect(window.VSC.SafariHLSPlayback.canSwitch(controller, 3, 'init')).toBe(true);
    expect(controller.safariPlaybackFailedSource).toBe(HLS);
    expect(begin(3, 'init')).toBeNull();
    await flushInitialization();
    expect(video.src).toBe(nextMP4);
  });

  it.each(['hidden', 'pagehide', 'detached', 'controller'])(
    'cancels %s without resuming or restoring stale media',
    (cause) => {
      const session = begin();
      if (cause === 'hidden') {
        Object.defineProperty(doc, 'visibilityState', { value: 'hidden' });
        doc.dispatchEvent(new Event('visibilitychange'));
      } else if (cause === 'pagehide') {
        view.dispatchEvent(new Event('pagehide'));
      } else if (cause === 'detached') {
        video.remove();
      } else {
        video.vsc = {};
      }
      session.finish();
      event('loadeddata');
      vi.advanceTimersByTime(10000);
      expect(video.play).not.toHaveBeenCalled();
      expect(video.load).toHaveBeenCalledTimes(1);
      expect(session.closed).toBe(true);
    }
  );

  it('restores the current position/rate on cleanup and never retries from a late callback', () => {
    const session = begin();
    loaded();
    state.time = 31;
    state.rate = 3;
    state.paused = false;
    session.cleanup();
    expect(video.src).toBe(HLS);
    expect(video.currentTime).toBe(31);
    expect(video.playbackRate).toBe(3);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(false);
    event('error');
    vi.advanceTimersByTime(10000);
    expect(video.load).toHaveBeenCalledTimes(2);
  });

  it('Use site player retains the selected source and leaves no timers/listeners', () => {
    const session = begin();
    session.cleanup({ restore: false });
    event('error');
    event('loadstart');
    vi.advanceTimersByTime(10000);
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(video.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('catches a synchronous load failure and restores the original paused source', () => {
    video.load.mockImplementationOnce(() => {
      throw new Error('site load override');
    });
    expect(begin()).toBeNull();
    expect(video.src).toBe(HLS);
    expect(video.paused).toBe(true);
    expect(controller.safariPlayback).toBeNull();
  });
});

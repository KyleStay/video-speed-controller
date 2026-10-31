/** Counterfactual62: real legacy caption readiness, strict veto, finite native opportunities. */
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

describe('Counterfactual62 finite native-playing HLS readiness', () => {
  const HLS = 'https://video.twimg.com/amplify_video/12345/pl/master.m3u8';
  const MP4 = 'https://video.twimg.com/amplify_video/12345/vid/1280x720/clip.mp4';
  let dom,
    video,
    controller,
    config,
    manager,
    action,
    selected,
    sdk,
    nativeTrack,
    resolver,
    order,
    visibility,
    added;
  const emit = (type) => video.dispatchEvent(new Event(type));
  const nativePlaying = () => {
    const listener = controller.handlePlayingReadiness;
    // jsdom cannot construct isTrusted=true. Invoke only the actual function
    // registered for native playing, using the same trusted shape as HLS tests.
    if (
      listener &&
      added.mock.calls.some(([type, handler]) => type === 'playing' && handler === listener)
    ) {
      listener({ target: video, type: 'playing', isTrusted: true });
    } else {
      emit('playing');
    } // Old BASE513 has no such listener: reproduce its gap.
  };
  const flush = async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
  };
  beforeEach(async () => {
    installChromeMock();
    resetMockStorage();
    dom = createMockDOM();
    dom.container.dataset.testid = 'videoComponent';
    config = new window.VSC.VideoSpeedConfig();
    await config.load();
    config.settings.lastSpeed = 4;
    config.settings.rememberSpeed = true;
    vi.spyOn(config, 'save');
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.useFakeTimers();
    manager = new window.VSC.EventManager(config, null);
    action = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = action;
    vi.spyOn(window.VSC.SafariHLSPlayback, 'matches').mockReturnValue(true);
    resolver = vi.spyOn(window.VSC.ProgressiveMediaSource, 'findCandidate');
    vi.spyOn(action, 'adjustSpeed');
    selected = {
      id: 0,
      contentType: 'media_entity',
      hasCaptions: undefined,
      durationMs: 20000,
      mediaAvailability: { status: 'available' },
      currentVariantIndex: 0,
      variants: [
        { src: HLS, type: 'application/x-mpegURL' },
        { src: MP4, type: 'video/mp4' },
      ],
    };
    sdk = {
      source: { type: 'tweet', trackId: 0 },
      currentTrackId: 0,
      hasCaptions: false,
      tracks: [selected],
    };
    dom.container.__reactProps$counterfactual62 = {
      children: [null, { props: { playerState: sdk } }],
    };
    video = createMockVideo({
      readyState: 1,
      currentSrc: HLS,
      playbackRate: 1,
      currentTime: 2.5,
      duration: 20,
    });
    for (const key of [
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
      'matches',
      'querySelector',
      'querySelectorAll',
    ]) {
      delete video[key];
    }
    video.src = HLS;
    dom.container.append(video);
    order = [];
    nativeTrack = { kind: 'captions', label: '', language: '', cues: [], activeCues: [] };
    Object.defineProperty(video, 'textTracks', { configurable: true, value: [nativeTrack] });
    let rate = 1;
    Object.defineProperty(video, 'playbackRate', {
      configurable: true,
      get: () => rate,
      set: (value) => {
        rate = value;
        order.push(['rate', value, video.src]);
      },
    });
    video.load = vi.fn(() => {
      order.push(['load', video.src]);
      video.currentSrc = '';
      video.readyState = 0;
      video.paused = true;
      rate = 1;
    });
    video.play = vi.fn(() => {
      order.push(['play', video.src, video.playbackRate, video.currentTime]);
      video.paused = false;
      return Promise.resolve();
    });
    video.pause = vi.fn(() => {
      video.paused = true;
    });
    added = vi.spyOn(video, 'addEventListener');
    controller = new window.VSC.VideoController(video, dom.container, config, action);
    expect(resolver).toHaveReturnedWith(null);
    expect(controller.safariPlaybackPending).toBeFalsy();
    expect(video.playbackRate).toBe(4);
    expect(video.load).not.toHaveBeenCalled();
    video.readyState = 2;
    action.adjustSpeed.mockClear();
    resolver.mockClear();
    order.length = 0;
  });
  afterEach(() => {
    if (!controller.disposed) {
      controller.remove();
    }
    manager.cleanup();
    if (config.saveTimer) {
      clearTimeout(config.saveTimer);
    }
    window.VSC.stateManager.controllers.clear();
    dom.cleanup();
    cleanupChromeMock();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps early unknown captions vetoed, then uses a later native playing opportunity after explicit false', async () => {
    const original = video;
    emit('loadeddata');
    nativePlaying();
    await vi.advanceTimersByTimeAsync(500);
    emit('waiting');
    nativePlaying();
    expect(resolver).toHaveReturnedWith(null);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6500);
    selected.hasCaptions = false;
    const reads = resolver.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(resolver).toHaveBeenCalledTimes(reads);
    expect(video.load).not.toHaveBeenCalled();
    nativePlaying();
    expect(action.adjustSpeed).toHaveBeenCalledExactlyOnceWith(video, 4, { source: 'init' });
    expect(controller.safariPlaybackPending).toBeTruthy();
    expect(video.load).not.toHaveBeenCalled();
    await flush();
    expect(controller.video).toBe(original);
    expect(video.textTracks[0]).toBe(nativeTrack);
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.playbackRate).toBe(4);
    expect(order.find(([type]) => type === 'load')).toEqual(['load', MP4]);
    expect(order.at(-1)).toEqual(['play', MP4, 4, 2.5]);
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.save).not.toHaveBeenCalled();
  });

  it.each(['undefined', 'true', 'null', 'string false'])(
    'never treats selected captions %s as permission',
    async (kind) => {
      selected.hasCaptions =
        kind === 'true'
          ? true
          : kind === 'null'
            ? null
            : kind === 'string false'
              ? 'false'
              : undefined;
      for (let n = 0; n < 40; n++) {
        nativePlaying();
      }
      await flush();
      expect(resolver).toHaveBeenCalledTimes(32);
      expect(resolver).toHaveReturnedWith(null);
      expect(video.load).not.toHaveBeenCalled();
      expect(video.play).not.toHaveBeenCalled();
      expect(action.adjustSpeed).not.toHaveBeenCalled();
    }
  );

  it('exhausts exactly32 opportunities per source without a timer or quiet-time polling', async () => {
    const timer = vi.spyOn(window, 'setTimeout');
    for (let n = 0; n < 32; n++) {
      nativePlaying();
    }
    expect(controller.hlsPlayingReadiness).toMatchObject({ events: 32 });
    expect(resolver).toHaveBeenCalledTimes(32);
    expect(timer).not.toHaveBeenCalled();
    selected.hasCaptions = false;
    nativePlaying();
    await vi.advanceTimersByTimeAsync(20000);
    expect(resolver).toHaveBeenCalledTimes(32);
    expect(video.load).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });

  it('expires10seconds after the first qualifying event, without an autonomous deadline timer', async () => {
    nativePlaying();
    expect(resolver).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10001);
    selected.hasCaptions = false;
    nativePlaying();
    expect(resolver).toHaveBeenCalledOnce();
    expect(video.load).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });

  it.each(['loadstart', 'emptied'])(
    'rearms the finite budget on actual %s source lifecycle',
    async (type) => {
      for (let n = 0; n < 32; n++) {
        nativePlaying();
      }
      expect(resolver).toHaveBeenCalledTimes(32);
      emit(type);
      selected.hasCaptions = false;
      video.readyState = 2;
      nativePlaying();
      await flush();
      expect(video.load).toHaveBeenCalledOnce();
      expect(video.src).toBe(MP4);
      expect(config.settings.lastSpeed).toBe(4);
    }
  );

  it.each([
    'SDK captions',
    'SDK DRM',
    'SDK live',
    'ambiguous selected',
    'HLS identity',
    'native DRM',
    'meaningful native caption',
  ])('honors fresh %s veto even after selected captions become false', async (reason) => {
    selected.hasCaptions = false;
    if (reason === 'SDK captions') {
      sdk.hasCaptions = true;
    } else if (reason === 'SDK DRM') {
      selected.keySystems = { protected: true };
    } else if (reason === 'SDK live') {
      selected.live = true;
    } else if (reason === 'ambiguous selected') {
      sdk.tracks.push({ ...selected });
    } else if (reason === 'HLS identity') {
      selected.variants[0].src = `${HLS}?other=1`;
    } else if (reason === 'native DRM') {
      Object.defineProperty(video, 'mediaKeys', { configurable: true, value: {} });
    } else {
      nativeTrack.label = 'English';
    }
    nativePlaying();
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(config.settings.lastSpeed).toBe(4);
  });

  it.each([
    'pause',
    'hidden',
    'removed',
    'not ready',
    'nonfinite clip',
    'srcObject',
    'MP4',
    'blob',
    'overlong',
    'non-string',
    'slower target',
  ])('skips nonqualifying %s media without an SDK probe or budget consumption', async (reason) => {
    selected.hasCaptions = false;
    if (reason === 'pause') {
      video.paused = true;
    } else if (reason === 'hidden') {
      visibility = 'hidden';
    } else if (reason === 'removed') {
      video.remove();
    } else if (reason === 'not ready') {
      video.readyState = 1;
    } else if (reason === 'nonfinite clip') {
      video.duration = Infinity;
    } else if (reason === 'srcObject') {
      Object.defineProperty(video, 'srcObject', { configurable: true, value: {} });
    } else if (reason === 'MP4') {
      video.src = video.currentSrc = MP4;
    } else if (reason === 'blob') {
      video.src = video.currentSrc = 'blob:https://x.com/mse';
    } else if (reason === 'overlong') {
      video.currentSrc = `${HLS}?padding=${'x'.repeat(4096)}`;
    } else if (reason === 'non-string') {
      video.currentSrc = {
        toString() {
          throw Error('source coercion');
        },
      };
    } else {
      config.speedPreferenceRevision++;
      config.settings.lastSpeed = 2;
    }
    nativePlaying();
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    expect(controller.hlsPlayingReadiness).toBeFalsy();
  });

  it.each(['synthetic', 'desktop'])(
    'rejects %s playing before shared authority or source reads',
    (reason) => {
      const stateRead = vi.spyOn(manager, 'getMediaRateState');
      Object.defineProperty(video, 'currentSrc', {
        configurable: true,
        get() {
          throw Error('DOM read should be skipped');
        },
      });
      if (reason === 'desktop') {
        window.VSC.SafariHLSPlayback.matches.mockReturnValue(false);
        nativePlaying();
      } else {
        emit('playing');
      }
      expect(stateRead).not.toHaveBeenCalled();
      expect(resolver).not.toHaveBeenCalled();
      expect(controller.hlsPlayingReadiness).toBeFalsy();
      Object.defineProperty(video, 'currentSrc', {
        configurable: true,
        writable: true,
        value: HLS,
      });
    }
  );

  it.each([
    'source',
    'poster',
    'pause',
    'hidden',
    'preference',
    'local authority',
    'srcObject',
    'DRM',
    'ready',
    'controller',
    'removed',
  ])('revalidates after the real resolver synchronously mutates %s', async (reason) => {
    selected.hasCaptions = false;
    resolver.mockRestore();
    const original = window.VSC.ProgressiveMediaSource.findCandidate;
    resolver = vi
      .spyOn(window.VSC.ProgressiveMediaSource, 'findCandidate')
      .mockImplementation((...args) => {
        const result = original(...args);
        expect(result).toMatchObject({ progressiveUrl: MP4 });
        if (reason === 'source') {
          video.src = video.currentSrc = `${HLS}?new=1`;
        } else if (reason === 'poster') {
          video.poster = 'https://files.example.test/new.jpg';
        } else if (reason === 'pause') {
          video.paused = true;
        } else if (reason === 'hidden') {
          visibility = 'hidden';
        } else if (reason === 'preference') {
          config.speedPreferenceRevision++;
          config.settings.lastSpeed = 3;
        } else if (reason === 'local authority') {
          const local = manager.getMediaRateState(video);
          local.lifecycleSpeed = 3;
          local.lifecycleSpeedRevision = config.speedPreferenceRevision;
        } else if (reason === 'srcObject') {
          Object.defineProperty(video, 'srcObject', { configurable: true, value: {} });
        } else if (reason === 'DRM') {
          Object.defineProperty(video, 'mediaKeys', { configurable: true, value: {} });
        } else if (reason === 'ready') {
          video.readyState = 1;
        } else if (reason === 'controller') {
          video.vsc = {};
        } else {
          video.remove();
        }
        return result;
      });
    nativePlaying();
    await flush();
    expect(resolver).toHaveBeenCalledOnce();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    if (reason === 'controller') {
      video.vsc = controller;
    }
  });

  it.each(['cleanup', 'source', 'transient poster', 'pause', 'hidden', 'trusted input'])(
    'lets existing deferred-init ownership cancel before stale handoff after %s',
    async (reason) => {
      selected.hasCaptions = false;
      let resolve;
      video.play.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const listeners = vi.spyOn(window, 'addEventListener');
      nativePlaying();
      expect(controller.safariPlaybackPending).toBeTruthy();
      if (reason === 'cleanup') {
        controller.remove();
      } else if (reason === 'source') {
        video.src = `${HLS}?site=1`;
      } else if (reason === 'transient poster') {
        video.poster = 'https://files.example.test/new.jpg';
        video.removeAttribute('poster');
      } else if (reason === 'pause') {
        video.paused = true;
        emit('pause');
      } else if (reason === 'hidden') {
        visibility = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        listeners.mock.calls.find(([type]) => type === 'pointerdown')[1]({ isTrusted: true });
      }
      resolve();
      await flush();
      expect(video.load).not.toHaveBeenCalled();
      expect(video.play).toHaveBeenCalledOnce();
      expect(config.settings.lastSpeed).toBe(4);
      expect(config.save).not.toHaveBeenCalled();
    }
  );

  it('does no SDK work for a sourceless media readiness event', async () => {
    video.currentSrc = '';
    video.removeAttribute('src');
    nativePlaying();
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(controller.hlsPlayingReadiness).toBeFalsy();
  });

  it('suppresses native-playing retries while an existing init is pending or transitioning', async () => {
    selected.hasCaptions = false;
    let resolve;
    video.play.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    nativePlaying();
    expect(controller.safariPlaybackPending).toBeTruthy();
    resolver.mockClear();
    action.adjustSpeed.mockClear();
    nativePlaying();
    expect(resolver).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    resolve();
    await flush();
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledOnce();
    resolver.mockClear();
    action.adjustSpeed.mockClear();
    video.currentSrc = HLS;
    nativePlaying();
    expect(resolver).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(video.load).toHaveBeenCalledOnce();
  });

  it('uses current local authority with its revision instead of a sibling global value', async () => {
    selected.hasCaptions = false;
    const local = manager.getMediaRateState(video);
    local.lifecycleSpeed = 2.5;
    local.lifecycleSpeedRevision = config.speedPreferenceRevision;
    config.settings.siteDefaultSpeed = 1;
    expect(config.settings.lastSpeed).toBe(4);
    nativePlaying();
    await flush();
    expect(video.src).toBe(MP4);
    expect(video.playbackRate).toBe(2.5);
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('cancels a locally authorized pending init when exact-media authority changes at the same revision', async () => {
    selected.hasCaptions = false;
    const local = manager.getMediaRateState(video);
    local.lifecycleSpeed = 2.5;
    local.lifecycleSpeedRevision = config.speedPreferenceRevision;
    config.settings.siteDefaultSpeed = 1;
    video.playbackRate = 2.5;
    let resolve;
    video.play.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const command = vi.spyOn(action, 'setSpeed');
    nativePlaying();
    expect(controller.safariPlaybackPending).toBeTruthy();
    command.mockClear();
    local.lifecycleSpeed = local.acceptedSpeed = 3;
    local.lifecycleSpeedRevision = local.acceptedSpeedRevision = config.speedPreferenceRevision;
    video.playbackRate = 3;
    resolve();
    await flush();
    expect(command).not.toHaveBeenCalled();
    expect(controller.safariPlaybackPending).toBeNull();
    expect(video.src).toBe(HLS);
    expect(video.playbackRate).toBe(3);
    expect(local.lifecycleSpeed).toBe(3);
    expect(video.load).not.toHaveBeenCalled();
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.settings.siteDefaultSpeed).toBe(1);
    expect(config.save).not.toHaveBeenCalled();
  });

  it.each([
    'unknown captions',
    'true captions',
    'SDK DRM',
    'SDK live',
    'ambiguous identity',
    'failed source',
  ])('retains %s veto with independent local2.5/global4/default1 authority', async (reason) => {
    const local = manager.getMediaRateState(video);
    local.lifecycleSpeed = 2.5;
    local.lifecycleSpeedRevision = config.speedPreferenceRevision;
    config.settings.siteDefaultSpeed = 1;
    video.playbackRate = 2.5;
    order.length = 0;
    selected.hasCaptions = false;
    if (reason === 'unknown captions') {
      selected.hasCaptions = undefined;
    } else if (reason === 'true captions') {
      selected.hasCaptions = true;
    } else if (reason === 'SDK DRM') {
      selected.keySystems = { protected: true };
    } else if (reason === 'SDK live') {
      selected.live = true;
    } else if (reason === 'ambiguous identity') {
      sdk.tracks.push({ ...selected });
    } else {
      controller.safariPlaybackFailedSource = HLS;
    }
    nativePlaying();
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.playbackRate).toBe(2.5);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.settings.siteDefaultSpeed).toBe(1);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('lets a new external preference revision supersede stale local authority', async () => {
    selected.hasCaptions = false;
    config.speedPreferenceRevision++;
    config.settings.lastSpeed = 3;
    nativePlaying();
    await flush();
    expect(video.src).toBe(MP4);
    expect(video.playbackRate).toBe(3);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('recovers a refused coordinated MP4 Play through the existing HLS fallback and does not retry it', async () => {
    selected.hasCaptions = false;
    video.play.mockImplementation(() => {
      video.paused = false;
      return video.src === MP4
        ? Promise.reject(new DOMException('Blocked', 'NotAllowedError'))
        : Promise.resolve();
    });
    nativePlaying();
    await flush();
    expect(video.src).toBe(HLS);
    expect(controller.safariPlaybackFailedSource).toBe(HLS);
    expect(controller.safariPlayback).toBeNull();
    resolver.mockClear();
    action.adjustSpeed.mockClear();
    const loads = video.load.mock.calls.length;
    video.currentSrc = HLS;
    video.readyState = 2;
    nativePlaying();
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(video.load).toHaveBeenCalledTimes(loads);
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('removes the native listener and clears its finite source state on controller cleanup', () => {
    nativePlaying();
    expect(controller.hlsPlayingReadiness).toBeTruthy();
    const listener = controller.handlePlayingReadiness;
    const remove = vi.spyOn(video, 'removeEventListener');
    controller.remove();
    expect(remove).toHaveBeenCalledWith('playing', listener);
    expect(controller.hlsPlayingReadiness).toBeNull();
    listener({ target: video, type: 'playing', isTrusted: true });
    expect(video.load).not.toHaveBeenCalled();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });
});

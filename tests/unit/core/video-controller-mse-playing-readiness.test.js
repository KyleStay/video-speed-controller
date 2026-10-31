/** Late current-X SDK metadata must get a finite, trusted native-playing opportunity. */
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

describe('VideoController finite iOS X MSE playing readiness', () => {
  let config, manager, action, clips, supported, documentUrl, rejectCompanion;
  const property = (object, key, value) =>
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  const emit = (clip, type) => clip.video.dispatchEvent(new Event(type));
  const nativePlaying = (clip) => {
    const listener = clip.controller.handlePlayingReadiness;
    // jsdom cannot create trusted events. Exercise the exact registered callback,
    // while separately proving dispatched synthetic playing remains powerless.
    if (
      listener &&
      clip.added.mock.calls.some(([type, fn]) => type === 'playing' && fn === listener)
    ) {
      listener({ target: clip.video, type: 'playing', isTrusted: true });
    }
  };
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  function attach(index = 1) {
    const contentId = String(2041611432752742400n + BigInt(index));
    const postId = String(2041611432752742500n + BigInt(index));
    const sourceUrl = `https://video.twimg.com/amplify_video/${contentId}/pl/current.m3u8?tag=21`;
    const mp4 = `https://video.twimg.com/amplify_video/${contentId}/vid/avc1/1280x720/current.mp4?tag=21`;
    const blob = `blob:https://x.com/11111111-2222-4333-8444-${String(index).padStart(12, '0')}`;
    const parent = document.createElement('div'),
      video = document.createElement('video');
    parent.append(video);
    document.body.append(parent);
    video.src = blob;
    for (const [key, value] of Object.entries({
      currentSrc: blob,
      readyState: 4,
      duration: 20.456,
      currentTime: 2,
      paused: false,
      ended: false,
      seeking: false,
    })) {
      property(video, key, value);
    }
    video.muted = false;
    video.volume = 0.65;
    video.pause = vi.fn(() => {
      video.paused = true;
    });
    video.play = vi.fn(() => {
      video.paused = false;
      return Promise.resolve();
    });
    const content = {
      contentId,
      contentType: 'video',
      sourceType: 'tweet',
      sourceId: postId,
      tweetId: postId,
      durationMs: 20400,
      mediaAssetUrl: sourceUrl,
      unavailability: undefined,
    };
    const state = {
      content,
      source: { kind: 'hls', src: sourceUrl, playlistDurationSec: 20.4 },
      session: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      textTracks: { tracks: [], preferredLanguage: 'en', captionInsets: {} },
      playback: { shouldLoop: true },
      media: { volume: 0.65, muted: false, paused: false },
    };
    const api = {
      getMediaElement: vi.fn(() => video),
      getState: vi.fn(() => state),
      seekTo: vi.fn(),
    };
    const store = { getSnapshot: vi.fn(() => state), subscribe: vi.fn(() => vi.fn()) };
    const sdk = { controller: { api }, element: video, store, src: sourceUrl };
    const props = {
      content,
      hostKey: `${postId}:${contentId}`,
      src: sourceUrl,
      preroll: undefined,
    };
    const modern = {
      downloadUrl: mp4,
      poppedOutSource: {
        hostKey: props.hostKey,
        playerProps: { content, src: sourceUrl, downloadUrl: mp4 },
      },
      timeRemainingAccessory: {
        props: {
          media: {
            id_str: contentId,
            video_download_url: mp4,
            video_info: {
              duration_millis: 20400,
              variants: [
                { content_type: 'application/x-mpegURL', url: sourceUrl },
                { content_type: 'video/mp4', url: mp4, bitrate: 1000 },
              ],
            },
          },
        },
      },
    };
    const hooks = Array.from({ length: 12 }, () => ({ memoizedState: null, next: null }));
    hooks.forEach((hook, n) => {
      hook.next = hooks[n + 1] || null;
    });
    const fiber = {
      memoizedState: hooks[0],
      memoizedProps: props,
      return: { memoizedState: null, memoizedProps: modern, return: null },
    };
    property(parent, '__reactFiber$mseReadiness', fiber);
    const added = vi.spyOn(video, 'addEventListener');
    const controller = new window.VSC.VideoController(video, parent, config, action);
    const clip = {
      video,
      parent,
      controller,
      content,
      state,
      sdk,
      hooks,
      fiber,
      api,
      store,
      blob,
      added,
      bind() {
        hooks[11].memoizedState = sdk;
      },
    };
    clips.push(clip);
    return clip;
  }
  beforeEach(async () => {
    installChromeMock();
    resetMockStorage();
    document.body.replaceChildren();
    clips = [];
    supported = true;
    rejectCompanion = false;
    documentUrl = 'https://x.com/example/status/2041611432752742501';
    vi.spyOn(document, 'URL', 'get').mockImplementation(() => documentUrl);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockImplementation(() => supported);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
      rejectCompanion
        ? Promise.reject(new DOMException('Refused', 'NotAllowedError'))
        : Promise.resolve()
    );
    config = new window.VSC.VideoSpeedConfig();
    await config.load();
    config.settings.lastSpeed = 4;
    config.settings.rememberSpeed = true;
    config.settings.enabled = true;
    vi.spyOn(config, 'save');
    manager = new window.VSC.EventManager(config, null);
    action = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = action;
    vi.spyOn(action, 'adjustSpeed');
    vi.useFakeTimers();
  });
  afterEach(() => {
    window.VSC.TwitterMP4Playback.cleanupAll();
    for (const clip of clips) {
      if (!clip.controller.disposed) {
        clip.controller.remove();
      }
    }
    manager.cleanup();
    if (config.saveTimer) {
      clearTimeout(config.saveTimer);
    }
    window.VSC.stateManager.controllers.clear();
    document.body.replaceChildren();
    cleanupChromeMock();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses late exact SDK hook metadata on trusted playing after loadeddata without changing saved speed', () => {
    const clip = attach();
    expect(window.VSC.TwitterPlayer.resolve(clip.video)).toBeNull();
    expect(clip.video.playbackRate).toBe(4);
    action.adjustSpeed.mockClear();
    clip.bind();
    expect(window.VSC.TwitterPlayer.resolve(clip.video)?.current()).toBe(true);
    expect(window.VSC.TwitterMP4Playback.canBegin(clip.controller, 4, 'init')).toBe(true);
    emit(clip, 'loadeddata');
    nativePlaying(clip);
    expect(action.adjustSpeed).toHaveBeenCalledExactlyOnceWith(clip.video, 4, { source: 'init' });
    expect(window.VSC.TwitterMP4Playback.getPending(clip.video)).toBeTruthy();
    expect(clip.video.src).toBe(clip.blob);
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('does not authorize synthetic playing or poll quietly after metadata arrives', async () => {
    const clip = attach();
    action.adjustSpeed.mockClear();
    clip.bind();
    emit(clip, 'playing');
    await vi.advanceTimersByTimeAsync(20000);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(window.VSC.TwitterMP4Playback.getPending(clip.video)).toBeFalsy();
    nativePlaying(clip);
    expect(window.VSC.TwitterMP4Playback.getPending(clip.video)).toBeTruthy();
  });

  it('bounds unavailable SDK reads to32 native opportunities with no polling timer', () => {
    const clip = attach();
    const resolver = vi.spyOn(window.VSC.TwitterPlayer, 'resolve');
    const timer = vi.spyOn(window, 'setTimeout');
    action.adjustSpeed.mockClear();
    for (let n = 0; n < 40; n++) {
      nativePlaying(clip);
    }
    expect(resolver).toHaveBeenCalledTimes(32);
    expect(timer).not.toHaveBeenCalled();
    clip.bind();
    nativePlaying(clip);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });

  it('expires10seconds after the first event and gives another controller its own budget', async () => {
    const clip = attach();
    nativePlaying(clip);
    await vi.advanceTimersByTimeAsync(10001);
    clip.bind();
    action.adjustSpeed.mockClear();
    nativePlaying(clip);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    const next = attach(2);
    next.bind();
    action.adjustSpeed.mockClear();
    nativePlaying(next);
    expect(action.adjustSpeed).toHaveBeenCalledExactlyOnceWith(next.video, 4, { source: 'init' });
  });

  it.each(['loadstart', 'emptied'])(
    'gives a recycled source a fresh finite budget after %s',
    (type) => {
      const clip = attach();
      for (let n = 0; n < 32; n++) {
        nativePlaying(clip);
      }
      clip.video.src = `${clip.blob}-replacement`;
      clip.video.currentSrc = clip.video.src;
      emit(clip, type);
      clip.bind();
      action.adjustSpeed.mockClear();
      nativePlaying(clip);
      expect(action.adjustSpeed).toHaveBeenCalledExactlyOnceWith(clip.video, 4, { source: 'init' });
    }
  );

  it.each(['captions', 'live', 'DRM', 'ambiguous SDK', 'ambiguous media'])(
    'retains a late %s capability veto',
    (kind) => {
      const clip = attach();
      clip.bind();
      if (kind === 'captions') {
        clip.state.textTracks.tracks.push({ kind: 'captions' });
      } else if (kind === 'live') {
        clip.sdk.live = true;
      } else if (kind === 'DRM') {
        property(clip.video, 'mediaKeys', {});
      } else if (kind === 'ambiguous SDK') {
        clip.hooks[10].memoizedState = { ...clip.sdk };
      } else {
        clip.parent.append(document.createElement('video'));
      }
      action.adjustSpeed.mockClear();
      nativePlaying(clip);
      expect(action.adjustSpeed).not.toHaveBeenCalled();
      expect(clip.video.src).toBe(clip.blob);
      expect(window.VSC.TwitterMP4Playback.getPending(clip.video)).toBeFalsy();
    }
  );

  it.each(['desktop', 'other host', 'foreign blob origin'])(
    'does not admit %s blob playback',
    (kind) => {
      const clip = attach();
      clip.bind();
      if (kind === 'desktop') {
        supported = false;
      } else if (kind === 'other host') {
        documentUrl = 'https://example.test/video';
      } else {
        clip.video.src = 'blob:https://example.test/source';
        clip.video.currentSrc = clip.video.src;
      }
      action.adjustSpeed.mockClear();
      nativePlaying(clip);
      expect(action.adjustSpeed).not.toHaveBeenCalled();
    }
  );

  it('uses a newer preference and refuses a preference changed during candidate resolution', () => {
    const clip = attach();
    clip.bind();
    config.settings.lastSpeed = 2.1;
    config.speedPreferenceRevision++;
    action.adjustSpeed.mockClear();
    nativePlaying(clip);
    expect(action.adjustSpeed).toHaveBeenCalledExactlyOnceWith(clip.video, 2.1, { source: 'init' });
    window.VSC.TwitterMP4Playback.cleanupAll();
    const next = attach(2);
    next.bind();
    action.adjustSpeed.mockClear();
    const original = window.VSC.TwitterMP4Playback.canBegin.bind(window.VSC.TwitterMP4Playback);
    vi.spyOn(window.VSC.TwitterMP4Playback, 'canBegin').mockImplementation((...args) => {
      const result = original(...args);
      config.settings.lastSpeed = 4;
      config.speedPreferenceRevision++;
      return result;
    });
    nativePlaying(next);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });

  it('ignores a retained trusted listener after controller cleanup', () => {
    const clip = attach();
    clip.bind();
    const listener = clip.controller.handlePlayingReadiness;
    clip.controller.remove();
    action.adjustSpeed.mockClear();
    listener({ target: clip.video, type: 'playing', isTrusted: true });
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });

  it('respects disabled state before and during candidate resolution', () => {
    const clip = attach();
    clip.bind();
    config.settings.enabled = false;
    action.adjustSpeed.mockClear();
    nativePlaying(clip);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    config.settings.enabled = true;
    const original = window.VSC.TwitterMP4Playback.canBegin.bind(window.VSC.TwitterMP4Playback);
    vi.spyOn(window.VSC.TwitterMP4Playback, 'canBegin').mockImplementation((...args) => {
      const result = original(...args);
      config.settings.enabled = false;
      return result;
    });
    nativePlaying(clip);
    expect(action.adjustSpeed).not.toHaveBeenCalled();
  });

  it('does not retry an automatically failed companion Play for the same exact SDK identity', async () => {
    const clip = attach();
    clip.bind();
    rejectCompanion = true;
    action.adjustSpeed.mockClear();
    nativePlaying(clip);
    await flush();
    expect(action.adjustSpeed).toHaveBeenCalledOnce();
    expect(window.VSC.TwitterMP4Playback.getPending(clip.video)).toBeFalsy();
    expect(window.VSC.TwitterMP4Playback.canBegin(clip.controller, 4, 'init')).toBe(false);
    action.adjustSpeed.mockClear();
    for (let n = 0; n < 40; n++) {
      nativePlaying(clip);
    }
    await flush();
    expect(action.adjustSpeed).not.toHaveBeenCalled();
    expect(clip.video.src).toBe(clip.blob);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('X retained MediaSource MP4 playback', () => {
  const MSE = 'blob:https://x.com/retained-media';
  const MP4 = 'https://video.twimg.com/ext_tw_video/123/pu/vid/clip.mp4';
  let original, controller, candidate, notify, unsubscribe, state, nativePlay, nativePause;
  let previousPlayer, previousController, previousExtension, companionCtor, originalPlay;
  let timers, clearTimers, addedListeners, removedListeners;
  let pictureInPictureDescriptor;
  let presentationRevision;
  let uiPlayers;
  const api = () => window.VSC.TwitterMP4Playback;
  const mediaState = (video) => {
    if (!state.has(video)) {
      state.set(video, { paused: true, ended: false });
    }
    return state.get(video);
  };
  const begin = (rate = 4, source = 'internal') => api().begin(controller, rate, source);
  const loaded = async (session) => {
    session.video.dispatchEvent(new Event('loadeddata'));
    await Promise.resolve();
  };
  const commit = async () => {
    const session = begin();
    session.finish();
    await loaded(session);
    return session;
  };
  const attachedPlayer = ({ realClose = false } = {}) => {
    const player = new window.VSC.IOSPlayer(controller);
    controller.iosPlayer = player;
    controller.controlsManager = { inlinePlayer: { error: vi.fn() } };
    for (const name of [
      'enableInlinePlayback',
      'captureNativeFullscreenMethods',
      'prepareMedia',
      'close',
      'releaseMediaOwnership',
      'releaseInlinePlayback',
    ].filter((name) => !realClose || name !== 'close')) {
      vi.spyOn(player, name).mockImplementation(() => {});
    }
    vi.spyOn(window.VSC.IOSPlayerTakeover, 'register').mockReturnValue(vi.fn());
    player.attach();
    uiPlayers.push(player);
    // The player retains its own listeners; release assertions below concern
    // only those added later by the companion session.
    addedListeners.mockClear();
    removedListeners.mockClear();
    return player;
  };
  const expectReleased = (session) => {
    expect(api().get(session.video)).toBeUndefined();
    expect(api().isRetained(original)).toBe(false);
    expect(session.video.isConnected).toBe(false);
    expect(document.querySelectorAll('[data-vsc-twitter-mp4]')).toHaveLength(0);
    expect(unsubscribe).toHaveBeenCalledOnce();
    for (const [index, args] of timers.mock.calls.entries()) {
      if (args[1] === 10000) {
        expect(clearTimers).toHaveBeenCalledWith(timers.mock.results[index].value);
      }
    }
    for (const args of addedListeners.mock.calls) {
      expect(removedListeners).toHaveBeenCalledWith(...args);
    }
  };

  beforeEach(() => {
    // Stop the real loader observer; this suite owns its mock controllers.
    window.VSC_controller?.mutationObserver?.stop();
    vi.useFakeTimers();
    uiPlayers = [];
    presentationRevision = window.VSC.IOSPlayer.presentationRevision;
    document.body.replaceChildren();
    pictureInPictureDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'pictureInPictureElement'
    );
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    state = new WeakMap();
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () {
      return mediaState(this).paused;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockImplementation(function () {
      return mediaState(this).ended;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    nativePlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
      mediaState(this).paused = false;
      return Promise.resolve();
    });
    nativePause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
      mediaState(this).paused = true;
    });
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
    vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(true);
    previousPlayer = window.VSC.TwitterPlayer;
    previousController = window.VSC.VideoController;
    previousExtension = window.VSC_controller;
    const parent = document.createElement('div');
    parent.style.position = 'static';
    original = document.createElement('video');
    original.src = MSE;
    original.currentTime = 12.5;
    original.playbackRate = 1;
    original.muted = true;
    original.volume = 0.4;
    Object.defineProperty(original, 'currentSrc', { configurable: true, get: () => original.src });
    Object.defineProperty(original, 'srcObject', { configurable: true, writable: true, value: {} });
    originalPlay = vi.fn(function () {
      mediaState(this).paused = false;
      return Promise.resolve();
    });
    original.play = originalPlay;
    original.pause = vi.fn(function () {
      mediaState(this).paused = true;
    });
    original.load = vi.fn();
    mediaState(original).paused = false;
    parent.append(original);
    document.body.append(parent);
    controller = {
      video: original,
      config: { settings: { enabled: true } },
      actionHandler: {},
      iosPlayer: { active: false },
      remove: vi.fn(function () {
        this.disposed = true;
        if (this.video.vsc === this) {
          delete this.video.vsc;
        }
        api().controllerRemoved(this.video);
      }),
    };
    original.vsc = controller;
    addedListeners = vi.spyOn(original, 'addEventListener');
    removedListeners = vi.spyOn(original, 'removeEventListener');
    timers = vi.spyOn(window, 'setTimeout');
    clearTimers = vi.spyOn(window, 'clearTimeout');
    unsubscribe = vi.fn();
    candidate = {
      originalUrl: MSE,
      sourceUrl: 'https://video.twimg.com/ext_tw_video/123/pu/pl/clip.m3u8',
      contentId: '123',
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      sdk: {},
      store: {},
      progressiveUrl: MP4,
      loop: true,
      current: vi.fn(() => original.src === MSE && original.isConnected),
      identityCurrent: vi.fn(() => original.src === MSE && original.isConnected),
      subscribe: vi.fn((callback) => {
        notify = callback;
        return unsubscribe;
      }),
      api: {
        seekTo: vi.fn((time) => {
          original.currentTime = time;
        }),
      },
    };
    window.VSC.TwitterPlayer = { resolve: vi.fn(() => candidate) };
    window.VSC_controller = { teardownRequested: false, onVideoFound: vi.fn() };
    companionCtor = vi.fn(function (video, parent, config, actionHandler) {
      Object.assign(this, { video, parent, config, actionHandler, iosPlayer: { open: vi.fn() } });
      this.remove = vi.fn(() => {
        delete video.vsc;
        api().controllerRemoved(video);
      });
      video.vsc = this;
    });
    window.VSC.VideoController = companionCtor;
  });

  afterEach(() => {
    window.VSC_controller.teardownRequested = true;
    for (const player of uiPlayers) {
      player.cleanup();
    }
    api().cleanupAll();
    window.VSC.TwitterPlayer = previousPlayer;
    window.VSC.VideoController = previousController;
    window.VSC_controller = previousExtension;
    window.VSC.IOSPlayer.presentationRevision = presentationRevision;
    if (pictureInPictureDescriptor) {
      Object.defineProperty(document, 'pictureInPictureElement', pictureInPictureDescriptor);
    } else {
      delete document.pictureInPictureElement;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  describe('presentation-only source-child binding', () => {
    let source;

    beforeEach(() => {
      original.removeAttribute('src');
      source = document.createElement('source');
      source.src = MSE;
      source.type = 'video/mp4';
      original.append(source);
      Object.defineProperty(original, 'currentSrc', { configurable: true, get: () => MSE });
      candidate.sourceNode = source;
      candidate.current.mockImplementation(() => source.parentNode === original);
      candidate.identityCurrent.mockImplementation(() => source.parentNode === original);
      window.VSC.TwitterPlayer.resolve.mockImplementation((_video, _parent, options) =>
        options?.allowSourceChild ? candidate : null
      );
    });

    it('allows explicit presentation while leaving init and ordinary speed commands with the site', async () => {
      expect(api().canBegin(controller, 4)).toBe(false);
      expect(begin(4, 'init')).toBeNull();
      expect(begin(4)).toBeNull();
      expect(api().open(controller, { automatic: true })).toBe(false);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(api().open(controller)).toBe(true);
      const session = api().getPending(original);
      expect(window.VSC.TwitterPlayer.resolve).toHaveBeenLastCalledWith(original, null, {
        allowSourceChild: true,
      });
      expect(original.hasAttribute('src')).toBe(false);
      expect(original.firstElementChild).toBe(source);
      expect(source.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      await loaded(session);
      expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
      expect(nativePlay).toHaveBeenCalledOnce();
      session.video.currentTime = 18;
      session.cleanup();
      expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(18);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.firstElementChild).toBe(source);
      expect(source.src).toBe(MSE);
      expectReleased(session);
    });

    it.each(['replacement', 'remove-reinsert', 'duplicate', 'src', 'type', 'media', 'video-src'])(
      'does not resume after an intervening %s write even when the representation is restored',
      async (kind) => {
        const session = begin(4, 'presentation');
        session.finish();
        await loaded(session);
        if (kind === 'replacement') {
          source.replaceWith(source.cloneNode());
        } else if (kind === 'remove-reinsert') {
          source.remove();
          original.append(source);
        } else if (kind === 'duplicate') {
          const duplicate = source.cloneNode();
          original.append(duplicate);
          duplicate.remove();
        } else if (kind === 'video-src') {
          original.src = MSE;
          original.removeAttribute('src');
        } else {
          const initial = source.getAttribute(kind);
          source.setAttribute(kind, kind === 'src' ? 'blob:https://x.com/other' : 'other');
          if (initial === null) {
            source.removeAttribute(kind);
          } else {
            source.setAttribute(kind, initial);
          }
        }
        // Consume pending records synchronously, before observer delivery.
        session.cleanup();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
        expectReleased(session);
      }
    );

    it('cancels from a selected-child mutation delivered before metadata', async () => {
      const session = begin(4, 'presentation');
      session.finish();
      source.type = 'video/webm';
      source.type = 'video/mp4';
      await Promise.resolve();
      await loaded(session);
      expect(companionCtor).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(session.originalIntentChanged).toBe(true);
      expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
      expectReleased(session);
    });

    it('detects a transient source write during subscription before starting playback', () => {
      candidate.subscribe.mockImplementationOnce(() => {
        source.media = 'other';
        source.removeAttribute('media');
        return unsubscribe;
      });
      const session = begin(4, 'presentation');
      expect(session).toBeNull();
      expect(original.pause).not.toHaveBeenCalled();
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('detects restored child writes from reentrant companion teardown before handback', async () => {
      const session = begin(4, 'presentation');
      session.finish();
      await loaded(session);
      session.video.vsc.remove.mockImplementationOnce(() => {
        source.type = 'video/webm';
        source.type = 'video/mp4';
      });
      session.cleanup();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expectReleased(session);
    });

    it('disconnects the bounded child observer and releases it after handback', async () => {
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const session = begin(4, 'presentation');
      const observer = session.observer;
      expect(observe).toHaveBeenCalledWith(original, {
        attributes: true,
        attributeFilter: ['src', 'poster'],
        childList: true,
      });
      expect(observe).toHaveBeenCalledWith(source, {
        attributes: true,
        attributeFilter: ['src', 'type', 'media'],
      });
      session.finish();
      await loaded(session);
      session.cleanup();
      expect(disconnect.mock.instances).toContain(observer);
      source.type = 'video/webm';
      await Promise.resolve();
      expect(observer.takeRecords()).toEqual([]);
      expect(originalPlay).toHaveBeenCalledOnce();
      expectReleased(session);
    });
  });

  it('keeps one pending probe for repeated fast speeds and cancels at 2×', () => {
    const session = begin(3);
    expect(session).toBeTruthy();
    expect(begin(5)).toBe(session);
    expect(session.video.playbackRate).toBe(5);
    expect(window.VSC.TwitterPlayer.resolve).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(nativePlay).not.toHaveBeenCalled();
    expect(begin(2)).toBeNull();
    expectReleased(session);
  });

  it.each(['rate', 'external', 'desktop', 'disposed', 'site', 'missing'])(
    'does not probe an ineligible %s request',
    (reason) => {
      if (reason === 'desktop') {
        window.VSC.IOSPlayer.isSupported.mockReturnValue(false);
      }
      if (reason === 'disposed') {
        controller.disposed = true;
      }
      if (reason === 'site') {
        window.VSC.IOSPlayer.siteRelinquished.add(original);
      }
      if (reason === 'missing') {
        window.VSC.TwitterPlayer.resolve.mockReturnValue(null);
      }
      expect(
        begin(reason === 'rate' ? 2 : 4, reason === 'external' ? 'external' : 'internal')
      ).toBeNull();
      expect(nativePlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
      expect(timers.mock.calls.filter((args) => args[1] === 10000)).toHaveLength(0);
    }
  );

  it('requests companion Play in the speed command, never from loadeddata', async () => {
    const session = begin();
    await loaded(session);
    expect(nativePlay).not.toHaveBeenCalled();
    session.finish();
    expect(nativePlay).toHaveBeenCalledOnce();
    expect(nativePlay.mock.instances[0]).toBe(session.video);
    await loaded(session);
    session.finish();
    expect(nativePlay).toHaveBeenCalledOnce();
    expect(controller.remove).toHaveBeenCalledOnce();
    expect(api().isRetained(original)).toBe(true);
  });

  it('commits separate controls without unloading or replacing original MSE identity', async () => {
    const sourceObject = original.srcObject;
    const sourceWrite = vi.spyOn(original, 'setAttribute');
    const session = await commit();
    expect(original.isConnected).toBe(true);
    expect(original.src).toBe(MSE);
    expect(original.srcObject).toBe(sourceObject);
    expect(original.load).not.toHaveBeenCalled();
    expect(sourceWrite.mock.calls.filter(([name]) => name === 'src')).toHaveLength(0);
    expect(original.paused).toBe(true);
    expect(session.video.src).toBe(MP4);
    expect(document.querySelectorAll('video')).toHaveLength(2);
    expect(api().get(session.video)).toBe(session);
    expect(companionCtor).toHaveBeenCalledExactlyOnceWith(
      session.video,
      session.video.parentElement,
      controller.config,
      controller.actionHandler,
      false,
      4
    );
    expect(begin(6)).toBe(session);
    expect(session.video.playbackRate).toBe(6);
  });

  it('never autoplays an originally paused clip', async () => {
    mediaState(original).paused = true;
    const session = await commit();
    expect(nativePlay).not.toHaveBeenCalled();
    expect(session.video.paused).toBe(true);
    session.cleanup();
    expect(originalPlay).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it.each(['reject', 'timeout', 'error'])(
    'falls back and suppresses retry after %s',
    async (kind) => {
      const session = begin();
      if (kind === 'reject') {
        nativePlay.mockRejectedValueOnce(new Error('Denied'));
      }
      session.finish();
      if (kind === 'timeout') {
        await vi.advanceTimersByTimeAsync(10000);
      }
      if (kind === 'error') {
        session.video.dispatchEvent(new Event('error'));
      }
      await Promise.resolve();
      expectReleased(session);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(api().canBegin(controller, 4, 'init')).toBe(false);
      expect(begin(4, 'init')).toBeNull();
    }
  );

  it('forwards explicit site Play and Pause to the companion while retaining original media', async () => {
    const session = await commit();
    nativePlay.mockClear();
    nativePause.mockClear();
    original.pause();
    expect(session.video.paused).toBe(true);
    expect(nativePause.mock.instances).toContain(session.video);
    original.play();
    expect(session.video.paused).toBe(false);
    expect(nativePlay.mock.instances).toContain(session.video);
    expect(originalPlay).not.toHaveBeenCalled();
    expect(original.src).toBe(MSE);
  });

  it('restores time, accepted rate and controls on Use site player without native source mutation', async () => {
    const session = await commit();
    session.video.currentTime = 18.25;
    session.video.playbackRate = 3;
    session.cleanup({ site: true });
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(18.25);
    expect(original.playbackRate).toBe(3);
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(window.VSC.IOSPlayer.siteRelinquished.has(original)).toBe(true);
    expect(window.VSC_controller.onVideoFound).toHaveBeenCalledExactlyOnceWith(
      original,
      original.parentElement,
      { forceAttach: true, initialSpeed: 3 }
    );
    expectReleased(session);
  });

  it.each(['source', 'subscription', 'encrypted', 'pagehide', 'seek', 'captured-play'])(
    'hands back safely on %s changes',
    async (kind) => {
      const session = await commit();
      if (kind === 'source') {
        original.src = 'blob:https://x.com/replacement';
      }
      if (kind === 'subscription') {
        candidate.current.mockReturnValue(false);
        candidate.identityCurrent.mockReturnValue(false);
        notify();
      }
      if (kind === 'encrypted') {
        candidate.identityCurrent.mockReturnValue(false);
        original.dispatchEvent(new Event('encrypted'));
      }
      if (kind === 'pagehide') {
        window.dispatchEvent(new Event('pagehide'));
      }
      if (kind === 'seek') {
        original.dispatchEvent(new Event('seeking'));
      }
      if (kind === 'captured-play') {
        originalPlay.call(original);
        original.dispatchEvent(new Event('playing'));
        originalPlay.mockClear();
      }
      await Promise.resolve();
      expectReleased(session);
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    }
  );

  it('ignores an original playing event queued before the pause', async () => {
    const session = await commit();
    original.dispatchEvent(new Event('playing'));
    expect(api().get(session.video)).toBe(session);
    expect(original.paused).toBe(true);
  });

  it('does not let companion speed commands recursively create another probe', async () => {
    const session = await commit();
    expect(api().begin(session.video.vsc, 8, 'internal')).toBeNull();
    expect(window.VSC.TwitterPlayer.resolve).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('video')).toHaveLength(2);
  });

  it('retains ownership on a subscription update that still identifies the same clip', async () => {
    const session = await commit();
    notify();
    expect(api().get(session.video)).toBe(session);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it.each(['subscription', 'track-add', 'track-change', 'encrypted'])(
    'preserves same-clip progress and playing intent on a %s capability veto',
    async (kind) => {
      const tracks = new EventTarget();
      Object.defineProperty(original, 'textTracks', { configurable: true, value: tracks });
      const session = await commit();
      session.video.currentTime = 31.75;
      candidate.current.mockReturnValue(false);
      if (kind === 'subscription') {
        notify();
      } else if (kind === 'encrypted') {
        original.dispatchEvent(new Event('encrypted'));
      } else {
        tracks.dispatchEvent(new Event(kind === 'track-add' ? 'addtrack' : 'change'));
      }
      expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(31.75);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.paused).toBe(false);
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
      expectReleased(session);
    }
  );

  it('immediately hands back a same-clip encrypted event before MediaKeys appears', async () => {
    const session = await commit();
    session.video.currentTime = 26;
    expect(candidate.current()).toBe(true);
    original.dispatchEvent(new Event('encrypted'));
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(26);
    expect(originalPlay).toHaveBeenCalledOnce();
    expectReleased(session);
  });

  it('keeps a paused clip paused when captions force same-clip handback', async () => {
    const session = await commit();
    session.video.pause();
    session.video.currentTime = 22;
    candidate.current.mockReturnValue(false);
    notify();
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(22);
    expect(originalPlay).not.toHaveBeenCalled();
    expect(original.paused).toBe(true);
    expectReleased(session);
  });

  it.each([true, false])('honors a fullscreen-close playing snapshot of %s', async (playing) => {
    const session = await commit();
    session.video.currentTime = 17;
    session.video.pause();
    session.cleanup({ site: true, playing });
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(17);
    expect(originalPlay).toHaveBeenCalledTimes(playing ? 1 : 0);
    expect(original.paused).toBe(!playing);
    expectReleased(session);
  });

  it('does not let an explicit playing snapshot resume a newer original source', async () => {
    const session = await commit();
    original.src = 'blob:https://x.com/new-item';
    session.cleanup({ site: true, playing: true });
    expect(candidate.api.seekTo).not.toHaveBeenCalled();
    expect(originalPlay).not.toHaveBeenCalled();
    expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('can check initialization without allocating a probe and skips paused init', () => {
    const play = original.play;
    expect(api().canBegin(controller, 4, 'init')).toBe(true);
    expect(candidate.subscribe).not.toHaveBeenCalled();
    expect(original.play).toBe(play);
    expect(nativePlay).not.toHaveBeenCalled();
    mediaState(original).paused = true;
    expect(api().canBegin(controller, 4, 'init')).toBe(false);
    expect(begin(4, 'init')).toBeNull();
    expect(api().canBegin(controller, 4, 'internal')).toBe(true);
    expect(begin(4, 'internal')).toBeTruthy();
  });

  it('permits an explicit internal retry after suppressing failed same-source init', () => {
    const session = begin();
    session.finish();
    session.video.dispatchEvent(new Event('error'));
    expectReleased(session);
    expect(api().canBegin(controller, 4, 'init')).toBe(false);
    expect(begin(4, 'init')).toBeNull();
    expect(api().canBegin(controller, 4, 'internal')).toBe(true);
    expect(begin(4, 'internal')).toBeTruthy();
  });

  it.each(['sessionId', 'sourceUrl', 'contentId', 'sdk', 'api', 'store', 'progressiveUrl'])(
    'permits saved-speed initialization for a newly validated %s on the same blob',
    (key) => {
      const session = begin();
      session.finish();
      session.video.dispatchEvent(new Event('error'));
      expectReleased(session);
      expect(api().canBegin(controller, 4, 'init')).toBe(false);
      if (['sdk', 'api', 'store'].includes(key)) {
        candidate[key] = { ...candidate[key] };
      } else {
        candidate[key] += '-new';
      }
      expect(original.src).toBe(MSE);
      expect(api().canBegin(controller, 4, 'init')).toBe(true);
      expect(begin(4, 'init')).toBeTruthy();
    }
  );

  it('disposes a synchronous invalidating subscription before setup can continue', () => {
    const play = original.play;
    const pause = original.pause;
    const loadedSources = [];
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function () {
      loadedSources.push(this.src);
    });
    candidate.subscribe.mockImplementation((callback) => {
      candidate.current.mockReturnValue(false);
      candidate.identityCurrent.mockReturnValue(false);
      callback();
      return unsubscribe;
    });
    expect(begin()).toBeNull();
    expect(original.play).toBe(play);
    expect(original.pause).toBe(pause);
    expect(loadedSources).not.toContain(MP4);
    expect(nativePlay).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(api().isRetained(original)).toBe(false);
    expect(timers.mock.calls.filter((args) => args[1] === 10000)).toHaveLength(0);
    expect(document.querySelectorAll('video')).toHaveLength(1);
  });

  it.each(['captured-play', 'companion-removal'])(
    'does not automatically recapture a clip during reentrant %s handback',
    async (kind) => {
      const session = await commit();
      let replacement;
      let automatic;
      const eligible = [];
      window.VSC_controller.onVideoFound.mockImplementation((video) => {
        replacement = {
          video,
          config: controller.config,
          actionHandler: controller.actionHandler,
          iosPlayer: { active: false },
          disposed: false,
        };
        original.vsc = replacement;
        const allowed = api().canBegin(replacement, 4, 'init');
        eligible.push(allowed);
        if (allowed) {
          automatic = api().begin(replacement, 4, 'init');
        }
      });
      if (kind === 'captured-play') {
        originalPlay.call(original);
        original.dispatchEvent(new Event('playing'));
      } else {
        session.video.remove();
        api().mediaRemoved(session.video);
      }
      expect(eligible).toEqual([false]);
      expect(automatic).toBeUndefined();
      expectReleased(session);
      expect(document.querySelectorAll('video')).toHaveLength(1);
      expect(original.paused).toBe(false);
      expect(api().canBegin(replacement, 4, 'internal')).toBe(true);
      expect(api().begin(replacement, 4, 'internal')).toBeTruthy();
    }
  );

  it.each(['hidden', 'native-session', 'native-fullscreen', 'picture-in-picture', 'invalid-rate'])(
    'does not start automatic replacement during %s',
    (kind) => {
      if (kind === 'hidden') {
        vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden').get).mockReturnValue(true);
      }
      if (kind === 'native-session') {
        controller.iosPlayer.nativeSession = true;
      }
      if (kind === 'native-fullscreen') {
        Object.defineProperty(original, 'webkitDisplayingFullscreen', {
          configurable: true,
          value: true,
        });
      }
      if (kind === 'picture-in-picture') {
        Object.defineProperty(document, 'pictureInPictureElement', {
          configurable: true,
          value: original,
        });
      }
      const rate = kind === 'invalid-rate' ? NaN : 4;
      expect(api().canBegin(controller, rate, 'init')).toBe(false);
      expect(begin(rate, 'init')).toBeNull();
      expect(candidate.subscribe).not.toHaveBeenCalled();
    }
  );

  it.each(['src', 'currentSrc', 'srcObject', 'mediaKeys', 'webkitKeys', 'throwing-currentSrc'])(
    'restores only original controls when the companion loses %s ownership',
    async (kind) => {
      const session = await commit();
      session.video.currentTime = 99;
      if (kind === 'src') {
        session.video.src = 'https://video.twimg.com/ext_tw_video/999/pu/vid/other.mp4';
      } else if (kind === 'throwing-currentSrc') {
        Object.defineProperty(session.video, 'currentSrc', {
          configurable: true,
          get() {
            throw new Error('Page getter');
          },
        });
      } else {
        Object.defineProperty(session.video, kind, {
          configurable: true,
          value: kind === 'currentSrc' ? 'https://example.test/other.mp4' : {},
        });
      }
      session.video.dispatchEvent(new Event('loadstart'));
      await Promise.resolve();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.currentTime).toBe(12.5);
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
      expectReleased(session);
    }
  );

  it.each(['', MP4])('accepts an owned companion currentSrc of %s', async (currentSrc) => {
    const session = await commit();
    Object.defineProperty(session.video, 'currentSrc', { configurable: true, value: currentSrc });
    session.video.dispatchEvent(new Event('loadstart'));
    expect(api().get(session.video)).toBe(session);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('cleans up and restores original controls when companion construction fails', async () => {
    companionCtor.mockImplementationOnce(() => {
      throw new Error('Page player changed');
    });
    const session = await commit();
    expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
    expect(originalPlay).toHaveBeenCalledOnce();
    expectReleased(session);
  });

  it('cancels original removal while pending but retains it during UI transfer', async () => {
    const session = begin();
    api().controllerRemoved(original);
    await loaded(session);
    session.finish();
    expect(companionCtor).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('releases companion removal exactly once and clears listeners and subscriptions', async () => {
    const session = await commit();
    api().controllerRemoved(session.video);
    api().controllerRemoved(session.video);
    session.video.dispatchEvent(new Event('error'));
    original.dispatchEvent(new Event('encrypted'));
    expectReleased(session);
  });

  it('releases a removed original even after its controller was transferred', async () => {
    const session = await commit();
    expect(original.vsc).toBeUndefined();
    original.remove();
    api().mediaRemoved(original);
    expect(session.video.paused).toBe(true);
    expect(originalPlay).not.toHaveBeenCalled();
    expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('hands back to the retained original when only the companion is removed', async () => {
    const session = await commit();
    session.video.currentTime = 24;
    session.video.remove();
    api().mediaRemoved(session.video);
    expect(original.isConnected).toBe(true);
    expect(original.src).toBe(MSE);
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(24);
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
    expectReleased(session);
  });

  it('does not dispose a companion during a connected presentation move', async () => {
    const session = await commit();
    const portal = document.createElement('div');
    document.body.append(portal);
    portal.append(session.video);
    api().mediaRemoved(session.video);
    expect(api().get(session.video)).toBe(session);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('cleanupAll releases all state without reattaching original controls', async () => {
    const session = await commit();
    api().cleanupAll();
    expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('preserves accepted rate and volume before decoder load resets them during teardown', async () => {
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function () {
      this.playbackRate = this.defaultPlaybackRate;
      this.muted = false;
      this.volume = 1;
    });
    const session = await commit();
    session.video.currentTime = 27.5;
    session.video.playbackRate = 4;
    session.video.muted = true;
    session.video.volume = 0.25;
    api().cleanupAll();
    expect(session.video.playbackRate).toBe(1);
    expect(original.playbackRate).toBe(4);
    expect(original.muted).toBe(true);
    expect(original.volume).toBe(0.25);
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(27.5);
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it.each(['currentTime', 'playbackRate'])(
    'releases resources and restores controls when companion %s throws',
    async (property) => {
      const session = await commit();
      Object.defineProperty(session.video, property, {
        configurable: true,
        get() {
          throw new Error('Page getter changed');
        },
      });
      expect(() => session.cleanup()).not.toThrow();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
      expectReleased(session);
    }
  );

  it('does not seek or play a source replaced during companion controller teardown', async () => {
    const session = await commit();
    session.video.vsc.remove.mockImplementation(() => {
      original.src = 'blob:https://x.com/recycled';
    });
    session.cleanup();
    expect(candidate.api.seekTo).not.toHaveBeenCalled();
    expect(originalPlay).not.toHaveBeenCalled();
    expect(window.VSC_controller.onVideoFound).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('does not resurrect a session disposed synchronously by original Pause', async () => {
    const pause = original.pause;
    pause.mockImplementation(() => api().controllerRemoved(original));
    const session = begin();
    session.finish();
    await loaded(session);
    expect(nativePlay).not.toHaveBeenCalled();
    expect(companionCtor).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('resumes the same producer when eligibility is lost during the handoff Pause', () => {
    // Pause can publish new capabilities before the SDK subscription callback.
    // The producer is still the same, so rejecting the companion must not leave
    // the previously playing source paused with neither player running.
    original.pause.mockImplementation(() => {
      mediaState(original).paused = true;
      candidate.current.mockReturnValue(false);
    });
    const session = begin();
    expect(candidate.identityCurrent()).toBe(true);
    session.finish();
    expect(nativePlay).not.toHaveBeenCalled();
    expect(companionCtor).not.toHaveBeenCalled();
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(original.paused).toBe(false);
    expect(original.src).toBe(MSE);
    expect(original.load).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('pauses a stale native Play promise completion after teardown', async () => {
    let resolve;
    nativePlay.mockImplementationOnce(function () {
      mediaState(this).paused = false;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const session = begin();
    session.finish();
    session.cleanup({ resume: false });
    nativePause.mockClear();
    resolve();
    await Promise.resolve();
    expect(nativePause).toHaveBeenCalledExactlyOnceWith();
    expect(nativePause.mock.instances[0]).toBe(session.video);
    expectReleased(session);
  });

  it('transfers an already owned fullscreen presentation to the companion once', async () => {
    controller.iosPlayer.active = true;
    controller.iosPlayer.originParent = original.parentElement;
    const session = await commit();
    expect(window.VSC.TwitterPlayer.resolve).toHaveBeenCalledWith(
      original,
      original.parentElement,
      {
        allowSourceChild: false,
      }
    );
    expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
    await loaded(session);
    expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
  });

  it('stays inline when the user closes fullscreen while MP4 is loading', async () => {
    controller.iosPlayer.active = true;
    controller.iosPlayer.originParent = original.parentElement;
    const session = begin();
    session.finish();
    controller.iosPlayer.active = false;
    await loaded(session);
    expect(api().get(session.video)).toBe(session);
    expect(session.video.vsc.iosPlayer.open).not.toHaveBeenCalled();
  });

  it('transfers fullscreen newly opened while MP4 is loading', async () => {
    const session = begin();
    session.finish();
    controller.iosPlayer.active = true;
    controller.iosPlayer.originParent = original.parentElement;
    await loaded(session);
    expect(api().get(session.video)).toBe(session);
    expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
  });

  it.each([1, 2])(
    'opens a paused %s× presentation through a separate native video',
    async (rate) => {
      original.playbackRate = rate;
      mediaState(original).paused = true;
      const parent = original.parentElement;
      const sourceObject = original.srcObject;
      expect(api().open(controller)).toBe(true);
      const session = api().getPending(original);
      expect(session).toBeTruthy();
      expect(original.parentElement).toBe(parent);
      expect(original.src).toBe(MSE);
      expect(original.srcObject).toBe(sourceObject);
      expect(original.load).not.toHaveBeenCalled();
      expect(nativePlay).not.toHaveBeenCalled();
      await loaded(session);
      expect(api().getPending(original)).toBeNull();
      expect(original.parentElement).toBe(parent);
      expect(original.isConnected).toBe(true);
      expect(session.video.playbackRate).toBe(rate);
      expect(session.video.paused).toBe(true);
      expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledExactlyOnceWith();
      expect(nativePlay).not.toHaveBeenCalled();
    }
  );

  it.each([1, 2])(
    'requests Play for an explicit %s× presentation in the entry stack',
    async (rate) => {
      original.playbackRate = rate;
      mediaState(original).paused = true;
      expect(api().open(controller, { play: true })).toBe(true);
      const session = api().getPending(original);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(nativePlay.mock.instances[0]).toBe(session.video);
      expect(companionCtor).not.toHaveBeenCalled();
      await loaded(session);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledExactlyOnceWith();
    }
  );

  it('reuses pending presentation opens without resetting time or pause intent', async () => {
    mediaState(original).paused = true;
    expect(api().open(controller, { play: true })).toBe(true);
    const session = api().getPending(original);
    session.video.currentTime = 20;
    original.pause();
    nativePlay.mockClear();
    expect(api().open(controller)).toBe(true);
    expect(api().getPending(original)).toBe(session);
    expect(session.video.currentTime).toBe(20);
    expect(session.video.paused).toBe(true);
    expect(nativePlay).not.toHaveBeenCalled();
    expect(candidate.subscribe).toHaveBeenCalledOnce();
    await loaded(session);
    expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
  });

  it('joins an existing fast probe for presentation without creating another decoder', async () => {
    const session = begin(4);
    original.playbackRate = 4;
    session.finish();
    session.video.currentTime = 18;
    nativePlay.mockClear();
    expect(api().open(controller)).toBe(true);
    expect(api().getPending(original)).toBe(session);
    expect(session.video.currentTime).toBe(18);
    expect(session.video.playbackRate).toBe(4);
    expect(candidate.subscribe).toHaveBeenCalledOnce();
    expect(nativePlay).not.toHaveBeenCalled();
    await loaded(session);
    expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
  });

  it.each(['desktop', 'foreign-host', 'direct-source', 'companion'])(
    'returns outside-scope for a %s presentation',
    async (kind) => {
      let target = controller;
      if (kind === 'desktop') {
        window.VSC.IOSPlayer.isSupported.mockReturnValue(false);
      } else if (kind === 'foreign-host') {
        window.VSC.EventManager.isTwitterHost.mockReturnValue(false);
      } else if (kind === 'direct-source') {
        original.src = MP4;
      } else {
        const session = await commit();
        target = session.video.vsc;
      }
      expect(api().open(target)).toBeNull();
    }
  );

  it.each(['unsupported', 'automatic'])(
    'refuses %s MSE presentation without falling back to the original portal',
    (kind) => {
      if (kind === 'unsupported') {
        window.VSC.TwitterPlayer.resolve.mockReturnValue(null);
      }
      const parent = original.parentElement;
      const player = attachedPlayer();
      vi.spyOn(player, 'openPresentation').mockReturnValue(false);
      expect(player.open({ automatic: kind === 'automatic' })).toBe(false);
      expect(player.openPresentation).not.toHaveBeenCalled();
      expect(original.parentElement).toBe(parent);
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(candidate.subscribe).not.toHaveBeenCalled();
      if (kind === 'automatic') {
        expect(controller.controlsManager.inlinePlayer.error).not.toHaveBeenCalled();
        expect(player.button.textContent).toBe('Custom player');
      }
    }
  );

  it('offers an explicit site-player action after an unsupported MSE presentation', () => {
    window.VSC.TwitterPlayer.resolve.mockReturnValue(null);
    const player = attachedPlayer();
    original.webkitEnterFullscreen = vi.fn();
    const handback = vi.spyOn(player, 'restoreSitePlayer').mockImplementation(() => {});
    const open = vi.spyOn(player, 'open');
    expect(player.open()).toBe(false);
    expect(player.button.textContent).toBe('Use site player');
    expect(player.button.getAttribute('aria-label')).toBe('Use site player');
    player.button.click();
    expect(handback).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(original.webkitEnterFullscreen).not.toHaveBeenCalled();
    expect(original.src).toBe(MSE);
    expect(original.load).not.toHaveBeenCalled();
  });

  it('clears the site-player fallback label when a new entry is valid', () => {
    const player = attachedPlayer();
    player.setPresentationUnavailable(true);
    mediaState(original).paused = true;
    expect(player.open()).toBe(true);
    expect(player.presentationUnavailable).toBe(false);
    expect(player.button.textContent).toBe('Custom player');
    expect(player.button.getAttribute('aria-label')).toBe('Open StayFast player');
  });

  it.each(['emptied', 'loadstart'])('clears fallback UI on source reset %s', (type) => {
    const player = attachedPlayer();
    player.setPresentationUnavailable(true);
    original.dispatchEvent(new Event(type));
    expect(player.presentationUnavailable).toBe(false);
    expect(player.button.textContent).toBe('Custom player');
    expect(player.button.getAttribute('aria-label')).toBe('Open StayFast player');
  });

  it('offers site handback after asynchronous failure of a requested presentation', () => {
    const player = attachedPlayer();
    expect(player.open()).toBe(true);
    const session = api().getPending(original);
    session.video.dispatchEvent(new Event('error'));
    expect(player.presentationUnavailable).toBe(true);
    expect(player.button.textContent).toBe('Use site player');
    expect(controller.controlsManager.inlinePlayer.error).toHaveBeenCalledOnce();
    expectReleased(session);
  });

  it('does not mark a newer source unavailable after an old presentation fails', () => {
    const player = attachedPlayer();
    expect(player.open()).toBe(true);
    const session = api().getPending(original);
    candidate.current.mockReturnValue(false);
    candidate.identityCurrent.mockReturnValue(false);
    session.video.dispatchEvent(new Event('error'));
    expect(player.presentationUnavailable).toBe(false);
    expect(player.button.textContent).toBe('Custom player');
    expect(controller.controlsManager.inlinePlayer.error).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it.each([false, true])(
    'ignores canceled Play rejection when a new entry exists: %s',
    async (newEntry) => {
      let reject;
      nativePlay.mockImplementationOnce(function () {
        mediaState(this).paused = false;
        return new Promise((resolve, fail) => {
          reject = fail;
        });
      });
      const player = attachedPlayer();
      expect(player.open({ play: true })).toBe(true);
      const first = api().getPending(original);
      api().cancelPresentation(original, { resume: false });
      expectReleased(first);
      let second;
      if (newEntry) {
        expect(player.open({ play: true })).toBe(true);
        second = api().getPending(original);
      }
      reject(new DOMException('Play interrupted by cleanup', 'AbortError'));
      await Promise.resolve();
      await Promise.resolve();
      expect(player.presentationUnavailable).toBe(false);
      expect(player.button.textContent).toBe('Custom player');
      expect(controller.controlsManager.inlinePlayer.error).not.toHaveBeenCalled();
      expect(api().getPending(original)).toBe(second ?? null);
      expect(unsubscribe).toHaveBeenCalledOnce();
    }
  );

  it('cancels pagehide before real IOSPlayer.close can resume pending playback', () => {
    const player = attachedPlayer({ realClose: true });
    const close = vi.spyOn(player, 'close');
    expect(player.open({ play: true })).toBe(true);
    const session = api().getPending(original);
    window.dispatchEvent(new Event('pagehide'));
    expect(close).toHaveBeenCalledWith({ settle: false });
    expect(originalPlay).not.toHaveBeenCalled();
    expect(original.paused).toBe(true);
    expect(api().getPending(original)).toBeNull();
    expectReleased(session);
  });

  it('keeps committed presentation source, time and rate across visibility suspension', async () => {
    const player = attachedPlayer();
    expect(player.open({ play: true })).toBe(true);
    const session = api().getPending(original);
    await loaded(session);
    session.video.currentTime = 28;
    session.video.playbackRate = 4;
    const source = session.video.src;
    const originalSource = original.src;
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden').get).mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api().get(session.video)).toBe(session);
    expect(session.video.isConnected).toBe(true);
    expect(session.video.currentTime).toBe(28);
    expect(session.video.playbackRate).toBe(4);
    expect(session.video.src).toBe(source);
    expect(original.src).toBe(originalSource);
    expect(unsubscribe).not.toHaveBeenCalled();
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden').get).mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api().get(session.video)).toBe(session);
    expect(nativePlay).toHaveBeenCalledOnce();
  });

  it('cancels only the matching pending presentation and cannot attach after cancellation', async () => {
    expect(api().open(controller)).toBe(true);
    const session = api().getPending(original);
    api().cancelPresentation(document.createElement('video'));
    expect(api().getPending(original)).toBe(session);
    api().cancelPresentation(original);
    await loaded(session);
    expect(companionCtor).not.toHaveBeenCalled();
    expect(api().getPending(original)).toBeNull();
    expectReleased(session);
  });

  it('does not cancel an ordinary fast probe through presentation close', () => {
    const session = begin();
    api().cancelPresentation(original);
    expect(api().getPending(original)).toBe(session);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('retains a presentation while transferring through original controller close', async () => {
    const remove = controller.remove.getMockImplementation();
    controller.remove.mockImplementation(() => {
      api().cancelPresentation(original);
      remove.call(controller);
    });
    expect(api().open(controller)).toBe(true);
    const session = api().getPending(original);
    await loaded(session);
    expect(api().get(session.video)).toBe(session);
    expect(api().getPending(original)).toBeNull();
    expect(session.video.vsc.iosPlayer.open).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('does not reopen a stale pending presentation after a newer presentation revision', async () => {
    expect(api().open(controller)).toBe(true);
    const session = api().getPending(original);
    window.VSC.IOSPlayer.presentationRevision++;
    await loaded(session);
    expect(session.video.vsc.iosPlayer.open).not.toHaveBeenCalled();
    expect(nativePlay).toHaveBeenCalledOnce();
  });

  it('releases hidden pending presentation without opening UI or resuming', async () => {
    expect(api().open(controller)).toBe(true);
    const session = api().getPending(original);
    vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden').get).mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await loaded(session);
    expect(companionCtor).not.toHaveBeenCalled();
    expect(originalPlay).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it('seeds companion rate authority before construction without writing the saved preference', async () => {
    const rateState = {};
    controller.config.settings.lastSpeed = 7;
    controller.config.speedPreferenceRevision = 19;
    controller.config.save = vi.fn();
    controller.actionHandler.eventManager = { getOrCreateMediaRateState: vi.fn(() => rateState) };
    original.playbackRate = 2;
    mediaState(original).paused = true;
    const construct = companionCtor.getMockImplementation();
    let construction;
    companionCtor.mockImplementation(function (...args) {
      construction = { initialSpeed: args[5], authority: { ...rateState } };
      return construct.apply(this, args);
    });
    expect(api().open(controller)).toBe(true);
    const session = api().getPending(original);
    await loaded(session);
    expect(construction).toEqual({
      initialSpeed: 2,
      authority: {
        lifecycleSpeed: 2,
        acceptedSpeed: 2,
        lifecycleSpeedRevision: 19,
        acceptedSpeedRevision: 19,
      },
    });
    expect(api().get(session.video)).toBe(session);
    expect(session.video.playbackRate).toBe(2);
    expect(controller.config.settings.lastSpeed).toBe(7);
    expect(controller.config.save).not.toHaveBeenCalled();
  });

  it('initializes from an explicit accepted speed instead of the saved preference', () => {
    const target = document.createElement('video');
    Object.defineProperty(target, 'readyState', { configurable: true, value: 4 });
    target.playbackRate = 1;
    const shell = {
      video: target,
      getTargetSpeed: vi.fn(() => 7),
      actionHandler: { adjustSpeed: vi.fn() },
      config: { settings: { lastSpeed: 7 } },
    };
    previousController.prototype.initializeSpeed.call(shell, 2);
    expect(shell.getTargetSpeed).not.toHaveBeenCalled();
    expect(shell.actionHandler.adjustSpeed).toHaveBeenCalledExactlyOnceWith(target, 2, {
      source: 'init',
    });
    expect(shell.config.settings.lastSpeed).toBe(7);
  });

  it('seeds restored original authority before Play and reinitialization without preference writes', async () => {
    const rates = new WeakMap();
    const local = (video) => {
      if (!rates.has(video)) {
        rates.set(video, {});
      }
      return rates.get(video);
    };
    controller.config.settings.lastSpeed = 7;
    controller.config.speedPreferenceRevision = 19;
    controller.config.save = vi.fn();
    controller.actionHandler.eventManager = { getOrCreateMediaRateState: vi.fn(local) };
    const session = await commit();
    session.video.playbackRate = 3.5;
    session.video.currentTime = 21;
    const expected = {
      lifecycleSpeed: 3.5,
      acceptedSpeed: 3.5,
      lifecycleSpeedRevision: 19,
      acceptedSpeedRevision: 19,
    };
    const checkpoints = [];
    originalPlay.mockImplementation(() => {
      checkpoints.push({ stage: 'play', authority: { ...local(original) } });
      mediaState(original).paused = false;
      return Promise.resolve();
    });
    window.VSC_controller.onVideoFound.mockImplementation((video, parent, options) => {
      checkpoints.push({ stage: 'reinitialize', authority: { ...local(video) }, options });
    });
    session.cleanup();
    expect(checkpoints).toEqual([
      { stage: 'play', authority: expected },
      {
        stage: 'reinitialize',
        authority: expected,
        options: { forceAttach: true, initialSpeed: 3.5 },
      },
    ]);
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
    expect(controller.config.settings.lastSpeed).toBe(7);
    expect(controller.config.save).not.toHaveBeenCalled();
    expectReleased(session);
  });

  it.each(['pending', 'active', 'active-new-command'])(
    'does not promote stale rate authority after an external preference change while %s',
    async (phase) => {
      const states = new WeakMap();
      const local = (video) => {
        if (!states.has(video)) {
          states.set(video, {});
        }
        return states.get(video);
      };
      controller.config.settings.lastSpeed = 4;
      controller.config.speedPreferenceRevision = 1;
      controller.actionHandler.eventManager = {
        getMediaRateState: vi.fn((video) => states.get(video)),
        getOrCreateMediaRateState: vi.fn(local),
      };
      controller.actionHandler.adjustSpeed = vi.fn((video, rate) => {
        video.playbackRate = rate;
      });
      original.playbackRate = 4;
      const session = begin(4, 'init');
      session.finish();
      if (phase !== 'pending') {
        await loaded(session);
      }
      const retainedRate = phase === 'active-new-command' ? 5 : 4;
      const retainedRevision = phase === 'active-new-command' ? 2 : 1;
      if (phase === 'active-new-command') {
        session.video.playbackRate = retainedRate;
        Object.assign(local(session.video), {
          lifecycleSpeed: retainedRate,
          acceptedSpeed: retainedRate,
          lifecycleSpeedRevision: retainedRevision,
          acceptedSpeedRevision: retainedRevision,
        });
      }
      controller.config.settings.lastSpeed = 6;
      controller.config.speedPreferenceRevision = retainedRevision + 1;
      if (phase === 'pending') {
        await loaded(session);
      }
      expect(local(session.video)).toMatchObject({
        lifecycleSpeed: retainedRate,
        lifecycleSpeedRevision: retainedRevision,
      });
      let lifecycle;
      window.VSC_controller.onVideoFound.mockImplementation((video) => {
        lifecycle = {
          video,
          config: controller.config,
          actionHandler: controller.actionHandler,
          getTargetSpeed: previousController.prototype.getTargetSpeed,
        };
        previousController.prototype.setupEventHandlers.call(lifecycle);
      });
      session.cleanup();
      expect(local(original)).toMatchObject({
        lifecycleSpeed: retainedRate,
        lifecycleSpeedRevision: retainedRevision,
      });
      expect(controller.config.settings.lastSpeed).toBe(6);
      original.dispatchEvent(new Event('play'));
      expect(controller.actionHandler.adjustSpeed).toHaveBeenCalledExactlyOnceWith(original, 6, {
        source: 'init',
      });
      expect(original.playbackRate).toBe(6);
      for (const [type, handler] of [
        ['play', lifecycle.handlePlay],
        ['playing', lifecycle.handlePlayingReadiness],
        ['seeked', lifecycle.handleSeek],
        ['emptied', lifecycle.handleRateSourceReset],
        ['loadstart', lifecycle.handleRateSourceReset],
        ['ratechange', lifecycle.handleShadowRateChange],
      ]) {
        original.removeEventListener(type, handler);
      }
      expectReleased(session);
    }
  );

  it('keeps matching original authority through repeated pending presentation requests', async () => {
    const states = new WeakMap();
    const local = (video) => {
      if (!states.has(video)) {
        states.set(video, {});
      }
      return states.get(video);
    };
    states.set(original, { lifecycleSpeed: 2, lifecycleSpeedRevision: 1 });
    controller.actionHandler.eventManager = {
      getMediaRateState: vi.fn((video) => states.get(video)),
      getOrCreateMediaRateState: vi.fn(local),
    };
    controller.config.settings.lastSpeed = 7;
    controller.config.speedPreferenceRevision = 2;
    original.playbackRate = 2;
    expect(api().open(controller)).toBe(true);
    const session = api().getPending(original);
    original.playbackRate = 3;
    controller.config.speedPreferenceRevision = 3;
    expect(api().open(controller)).toBe(true);
    expect(api().getPending(original)).toBe(session);
    expect(session.video.playbackRate).toBe(2);
    await loaded(session);
    expect(local(session.video)).toMatchObject({ lifecycleSpeed: 2, lifecycleSpeedRevision: 1 });
    expect(controller.config.settings.lastSpeed).toBe(7);
  });

  it('updates pending authority revision for a new explicit speed command', async () => {
    const states = new WeakMap();
    controller.actionHandler.eventManager = {
      getMediaRateState: vi.fn((video) => states.get(video)),
      getOrCreateMediaRateState: vi.fn((video) => {
        if (!states.has(video)) {
          states.set(video, {});
        }
        return states.get(video);
      }),
    };
    controller.config.speedPreferenceRevision = 1;
    const session = begin(4);
    session.finish();
    controller.config.speedPreferenceRevision = 2;
    expect(begin(5)).toBe(session);
    await loaded(session);
    expect(session.video.playbackRate).toBe(5);
    expect(states.get(session.video)).toMatchObject({
      lifecycleSpeed: 5,
      lifecycleSpeedRevision: 2,
    });
  });

  describe('pending companion Play acceptance', () => {
    const deferNextPlay = ({ startsPlaying = false } = {}) => {
      const pending = {};
      nativePlay.mockImplementationOnce(function () {
        if (startsPlaying) {
          mediaState(this).paused = false;
        }
        return new Promise((resolve, reject) => {
          Object.assign(pending, { resolve, reject });
        });
      });
      return pending;
    };
    const installRateState = () => {
      const rates = new WeakMap();
      const local = (video) => {
        if (!rates.has(video)) {
          rates.set(video, {});
        }
        return rates.get(video);
      };
      controller.config.settings.lastSpeed = 4;
      controller.config.speedPreferenceRevision = 3;
      controller.config.save = vi.fn();
      controller.actionHandler.eventManager = {
        getMediaRateState: vi.fn((video) => rates.get(video)),
        getOrCreateMediaRateState: vi.fn(local),
      };
      Object.assign(local(original), {
        lifecycleSpeed: 4,
        acceptedSpeed: 4,
        lifecycleSpeedRevision: 3,
        acceptedSpeedRevision: 3,
      });
      return local;
    };

    it.each([
      [2.1, false],
      [4, false],
      [2.1, true],
      [4, true],
    ])('waits for %s× Play acceptance while retaining mute=%s intent', async (rate, muted) => {
      original.muted = muted;
      const pending = deferNextPlay({ startsPlaying: true });
      const session = begin(rate, 'init');
      session.finish();
      session.video.dispatchEvent(new Event('loadeddata'));
      expect(api().getPending(original)).toBe(session);
      expect(controller.remove).not.toHaveBeenCalled();
      expect(companionCtor).not.toHaveBeenCalled();
      expect(original.vsc).toBe(controller);
      expect(session.video.muted).toBe(muted);
      expect(original.load).not.toHaveBeenCalled();
      pending.resolve();
      await Promise.resolve();
      expect(api().getPending(original)).toBeNull();
      expect(api().isRetained(original)).toBe(true);
      expect(controller.remove).toHaveBeenCalledOnce();
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(session.video.playbackRate).toBe(rate);
      expect(session.video.muted).toBe(muted);
    });

    it.each([false, true])(
      'recovers a refused audible Play after ready=%s without committing',
      async (ready) => {
        const local = installRateState();
        original.muted = false;
        const element = document.createElement('div');
        const shadow = element.attachShadow({ mode: 'open' });
        controller.div = element;
        const display = vi
          .spyOn(window.VSC.ShadowDOMManager, 'updateSpeedDisplay')
          .mockImplementation(() => {});
        const pending = deferNextPlay();
        const session = begin(4, 'init');
        // ActionHandler starts a transition before applying its native rate write.
        original.playbackRate = 4;
        session.finish();
        if (ready) {
          session.video.dispatchEvent(new Event('loadeddata'));
        }
        expect(controller.remove).not.toHaveBeenCalled();
        pending.reject(new DOMException('Fresh gesture required', 'NotAllowedError'));
        await Promise.resolve();
        expectReleased(session);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(original.paused).toBe(false);
        expect(original.muted).toBe(false);
        expect(original.playbackRate).toBe(1);
        expect(original.currentTime).toBe(12.5);
        expect(original.src).toBe(MSE);
        expect(original.load).not.toHaveBeenCalled();
        expect(controller.remove).not.toHaveBeenCalled();
        expect(local(original)).toMatchObject({
          lifecycleSpeed: 1,
          acceptedSpeed: 1,
          lifecycleSpeedRevision: 3,
          acceptedSpeedRevision: 3,
        });
        expect(display).toHaveBeenCalledExactlyOnceWith(shadow, 1);
        expect(controller.config.settings.lastSpeed).toBe(4);
        expect(controller.config.save).not.toHaveBeenCalled();
        expect(api().canBegin(controller, 4, 'init')).toBe(false);
      }
    );

    it('releases a synchronous Play exception and restores the prior producer rate', () => {
      original.muted = false;
      nativePlay.mockImplementationOnce(() => {
        throw new DOMException('Fresh gesture required', 'NotAllowedError');
      });
      const session = begin(4, 'init');
      original.playbackRate = 4;
      expect(() => session.finish()).not.toThrow();
      expectReleased(session);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.playbackRate).toBe(1);
      expect(original.muted).toBe(false);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('keeps the readiness deadline while Play never settles', async () => {
      deferNextPlay();
      const session = begin(4, 'init');
      session.finish();
      session.video.dispatchEvent(new Event('loadeddata'));
      expect(controller.remove).not.toHaveBeenCalled();
      expect(api().getPending(original)).toBe(session);
      await vi.advanceTimersByTimeAsync(10000);
      expectReleased(session);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.paused).toBe(false);
      expect(companionCtor).not.toHaveBeenCalled();
    });

    it('honors Pause while Play is pending and ignores its later rejection', async () => {
      const pending = deferNextPlay({ startsPlaying: true });
      const session = begin();
      session.finish();
      session.video.dispatchEvent(new Event('loadeddata'));
      original.pause();
      expect(session.video.paused).toBe(true);
      pending.reject(new DOMException('Play interrupted by Pause', 'AbortError'));
      await Promise.resolve();
      expect(api().get(session.video)).toBe(session);
      expect(session.video.paused).toBe(true);
      expect(originalPlay).not.toHaveBeenCalled();
      session.cleanup();
      expect(originalPlay).not.toHaveBeenCalled();
      expectReleased(session);
    });

    it('ignores an old rejection while a newer explicit Play is pending', async () => {
      const first = deferNextPlay();
      const session = begin();
      session.finish();
      session.video.dispatchEvent(new Event('loadeddata'));
      const second = deferNextPlay({ startsPlaying: true });
      original.play();
      first.reject(new DOMException('Superseded Play', 'AbortError'));
      await Promise.resolve();
      expect(api().getPending(original)).toBe(session);
      expect(controller.remove).not.toHaveBeenCalled();
      expect(unsubscribe).not.toHaveBeenCalled();
      second.resolve();
      await Promise.resolve();
      expect(api().isRetained(original)).toBe(true);
      expect(companionCtor).toHaveBeenCalledOnce();
      expect(originalPlay).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'reject'])(
      'ignores stale %s after a new session replaces the pending one',
      async (settlement) => {
        const pending = deferNextPlay();
        const first = begin();
        first.finish();
        first.cleanup({ resume: false });
        expectReleased(first);
        mediaState(original).paused = false;
        const second = begin(4, 'internal');
        second.finish();
        await loaded(second);
        const releaseCount = unsubscribe.mock.calls.length;
        pending[settlement](new DOMException('Old Play settled', 'AbortError'));
        await Promise.resolve();
        expect(api().get(second.video)).toBe(second);
        expect(second.video.paused).toBe(false);
        expect(unsubscribe).toHaveBeenCalledTimes(releaseCount);
        expect(originalPlay).not.toHaveBeenCalled();
      }
    );

    it.each(['src', 'identity'])(
      'does not recover or redraw a newer producer after pending rejection changes %s',
      async (change) => {
        const pending = deferNextPlay();
        const session = begin();
        session.finish();
        session.video.dispatchEvent(new Event('loadeddata'));
        const display = vi
          .spyOn(window.VSC.ShadowDOMManager, 'updateSpeedDisplay')
          .mockImplementation(() => {});
        if (change === 'src') {
          original.src = 'blob:https://x.com/new-item';
        } else {
          candidate.current.mockReturnValue(false);
          candidate.identityCurrent.mockReturnValue(false);
        }
        pending.reject(new DOMException('Play refused', 'NotAllowedError'));
        await Promise.resolve();
        expectReleased(session);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(display).not.toHaveBeenCalled();
        expect(companionCtor).not.toHaveBeenCalled();
      }
    );

    it.each([false, true])(
      'reports refused original recovery only while its source remains current: %s',
      async (replaced) => {
        const pending = deferNextPlay();
        const error = vi.fn();
        controller.controlsManager = { inlinePlayer: { error } };
        originalPlay.mockRejectedValueOnce(
          new DOMException('Original needs Play', 'NotAllowedError')
        );
        const session = begin();
        session.finish();
        pending.reject(new DOMException('Companion needs Play', 'NotAllowedError'));
        await Promise.resolve();
        if (replaced) {
          original.src = 'blob:https://x.com/new-item';
        }
        await Promise.resolve();
        expectReleased(session);
        if (replaced) {
          expect(error).not.toHaveBeenCalled();
        } else {
          expect(error).toHaveBeenCalledExactlyOnceWith('Playback could not start.');
        }
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(nativePlay).toHaveBeenCalledOnce();
        expect(original.paused).toBe(true);
      }
    );

    it('keeps an intentional Pause silent when original recovery Play is interrupted', async () => {
      const pending = deferNextPlay();
      const error = vi.fn();
      controller.controlsManager = { inlinePlayer: { error } };
      let rejectRecovery;
      originalPlay.mockImplementationOnce(function () {
        mediaState(this).paused = false;
        return new Promise((resolve, reject) => {
          rejectRecovery = reject;
        });
      });
      const session = begin();
      session.finish();
      pending.reject(new DOMException('Companion needs Play', 'NotAllowedError'));
      await Promise.resolve();
      expectReleased(session);
      expect(original.paused).toBe(false);
      original.pause();
      rejectRecovery(new DOMException('Recovery interrupted by Pause', 'AbortError'));
      await Promise.resolve();
      expect(error).not.toHaveBeenCalled();
      expect(original.paused).toBe(true);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(original.currentTime).toBe(12.5);
      expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('restores local rate authority after failure even when the producer should remain paused', () => {
      const local = installRateState();
      mediaState(original).paused = true;
      const session = begin(4, 'internal');
      original.playbackRate = 4;
      session.finish();
      session.video.dispatchEvent(new Event('error'));
      expectReleased(session);
      expect(original.paused).toBe(true);
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.playbackRate).toBe(1);
      expect(local(original)).toMatchObject({
        lifecycleSpeed: 1,
        acceptedSpeed: 1,
        lifecycleSpeedRevision: 3,
        acceptedSpeedRevision: 3,
      });
      expect(controller.config.settings.lastSpeed).toBe(4);
    });

    it('preserves a newer site rate when a pending companion fails', async () => {
      const pending = deferNextPlay();
      const session = begin();
      original.playbackRate = 4;
      session.finish();
      original.playbackRate = 2;
      pending.reject(new DOMException('Play refused', 'NotAllowedError'));
      await Promise.resolve();
      expectReleased(session);
      expect(original.playbackRate).toBe(2);
      expect(originalPlay).toHaveBeenCalledOnce();
    });

    it('rejects an actual ActionHandler speed command after synchronous companion Play failure', () => {
      const local = installRateState();
      controller.config.settings.lastSpeed = 1;
      controller.config.settings.rememberSpeed = true;
      controller.actionHandler.eventManager.refreshCoolDown = vi.fn();
      const handler = new window.VSC.ActionHandler(
        controller.config,
        controller.actionHandler.eventManager
      );
      controller.actionHandler = handler;
      const element = document.createElement('div');
      const shadow = element.attachShadow({ mode: 'open' });
      controller.div = element;
      controller.speedIndicator = document.createElement('span');
      const display = vi
        .spyOn(window.VSC.ShadowDOMManager, 'updateSpeedDisplay')
        .mockImplementation(() => {});
      vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation(
        (video, rate) => {
          video.playbackRate = rate;
        }
      );
      const started = vi.spyOn(api(), 'begin');
      nativePlay.mockImplementationOnce(() => {
        throw new DOMException('Fresh gesture required', 'NotAllowedError');
      });
      expect(handler.setSpeed(original, 4, 'internal')).toBe(false);
      const session = started.mock.results[0].value;
      expectReleased(session);
      expect(original.playbackRate).toBe(1);
      expect(controller.config.settings.lastSpeed).toBe(1);
      expect(controller.config.save).not.toHaveBeenCalled();
      expect(display).toHaveBeenCalledExactlyOnceWith(shadow, 1);
      expect(local(original)).toMatchObject({ lifecycleSpeed: 1, acceptedSpeed: 1 });
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('does not roll back a newer site rate after reopening a pending presentation', async () => {
      const pending = deferNextPlay();
      const session = begin(4);
      original.playbackRate = 4;
      session.finish({ speedCommand: true });
      session.video.dispatchEvent(new Event('loadeddata'));
      original.playbackRate = 2;
      expect(api().open(controller)).toBe(true);
      expect(api().getPending(original)).toBe(session);
      pending.reject(new DOMException('Play refused', 'NotAllowedError'));
      await Promise.resolve();
      expectReleased(session);
      expect(original.playbackRate).toBe(2);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('updates the applied-rate snapshot for a newer explicit speed command', async () => {
      const pending = deferNextPlay();
      const session = begin(4);
      original.playbackRate = 4;
      session.finish({ speedCommand: true });
      expect(begin(6)).toBe(session);
      original.playbackRate = 6;
      session.finish({ speedCommand: true });
      pending.reject(new DOMException('Play refused', 'NotAllowedError'));
      await Promise.resolve();
      expectReleased(session);
      expect(original.playbackRate).toBe(1);
      expect(originalPlay).toHaveBeenCalledOnce();
    });

    it.each(['begin', 'command', 'playing'])(
      'ignores an original recovery rejection after newer same-source %s intent',
      async (newer) => {
        const pending = deferNextPlay();
        const error = vi.fn();
        controller.controlsManager = { inlinePlayer: { error } };
        let rejectRecovery;
        originalPlay.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              rejectRecovery = reject;
            })
        );
        const first = begin();
        first.finish();
        pending.reject(new DOMException('Companion needs Play', 'NotAllowedError'));
        await Promise.resolve();
        expectReleased(first);
        expect(original.paused).toBe(true);
        let second;
        if (newer === 'begin') {
          second = begin(4, 'internal');
          second.finish();
        } else if (newer === 'command') {
          controller.config.settings.lastSpeed = 1;
          const handler = new window.VSC.ActionHandler(controller.config, null);
          controller.actionHandler = handler;
          vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation(
            (video, rate) => {
              video.playbackRate = rate;
            }
          );
          expect(handler.setSpeed(original, 2, 'internal')).toBe(true);
        } else {
          mediaState(original).paused = false;
          original.dispatchEvent(new Event('playing'));
        }
        rejectRecovery(new DOMException('Old recovery refused', 'NotAllowedError'));
        await Promise.resolve();
        expect(error).not.toHaveBeenCalled();
        if (second) {
          expect(api().getPending(original)).toBe(second);
          expect(unsubscribe).toHaveBeenCalledOnce();
        }
        expect(original.src).toBe(MSE);
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each(['closed', 'finished'])(
      'does not read a replaced rate getter during a %s finish no-op',
      (phase) => {
        const session = begin();
        session.finish();
        if (phase === 'closed') {
          session.cleanup({ resume: false });
        }
        const getter = vi.fn(() => {
          throw new Error('Page getter replaced');
        });
        Object.defineProperty(original, 'playbackRate', { configurable: true, get: getter });
        expect(() => session.finish()).not.toThrow();
        expect(getter).not.toHaveBeenCalled();
      }
    );

    it('releases a first finish with an inaccessible rate getter', () => {
      const session = begin();
      Object.defineProperty(original, 'playbackRate', {
        configurable: true,
        get() {
          throw new Error('Page getter replaced');
        },
      });
      expect(() => session.finish({ speedCommand: true })).not.toThrow();
      expectReleased(session);
      expect(originalPlay).not.toHaveBeenCalled();
      expect(companionCtor).not.toHaveBeenCalled();
    });
  });
});

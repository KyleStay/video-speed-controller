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

  describe('continuous-loop companion integration', () => {
    let previousLoop, loopCtor, loops;

    beforeEach(() => {
      previousLoop = window.VSC.TwitterLoopPlayback;
      loops = [];
      original.currentTime = 1.25;
      Object.defineProperty(original, 'duration', { configurable: true, value: 5 });
      loopCtor = vi.fn(function (owner, callbacks) {
        const video = owner.video;
        this.owner = owner;
        this.callbacks = callbacks;
        this.ready = false;
        this.holdingInitialRate = true;
        video.playbackRate = 0;
        this.readyState = 0;
        this.closed = false;
        this.time = owner.time;
        this.source = `blob:https://x.com/continuous-${loops.length}`;
        this.sources = [document.createElement('source'), document.createElement('source')];
        this.sources[0].src = this.source;
        this.sources[0].type = 'video/mp4';
        this.sources[1].src = owner.candidate.sourceUrl;
        this.sources[1].type = 'application/x-mpegURL';
        video.append(...this.sources);
        const transport = this;
        // These getters model native source/readiness; only currentTime belongs to the transport.
        Object.defineProperties(video, {
          currentSrc: {
            configurable: true,
            get: () => video.getAttribute('src') || video.firstElementChild?.src || '',
          },
          readyState: { configurable: true, get: () => transport.readyState },
          currentTime: {
            configurable: true,
            get: () => transport.time,
            set: (value) => {
              if (transport.seekError) {
                throw transport.seekError;
              }
              transport.time = value;
            },
          },
        });
        this.sourceCurrent = () =>
          !this.closed &&
          !video.hasAttribute('src') &&
          video.children.length === 2 &&
          this.sources.every(
            (source, index) =>
              video.children[index] === source &&
              source.src === (index === 0 ? this.source : owner.candidate.sourceUrl) &&
              source.type === (index === 0 ? 'video/mp4' : 'application/x-mpegURL')
          );
        this.cleanup = vi.fn(() => {
          if (this.closed) {
            return;
          }
          this.closed = true;
          delete video.currentTime;
          for (const [index, source] of this.sources.entries()) {
            if (
              source.src === (index === 0 ? this.source : owner.candidate.sourceUrl) &&
              source.type === (index === 0 ? 'video/mp4' : 'application/x-mpegURL')
            ) {
              source.remove();
            }
          }
        });
        this.prepared = () => {
          if (this.closed || !owner.originCurrent() || !this.sourceCurrent()) {
            return;
          }
          this.readyState = 4;
          video.playbackRate = owner.rate;
          this.holdingInitialRate = false;
          this.ready = true;
          callbacks.ready();
        };
        loops.push(this);
      });
      loopCtor.canUse = vi.fn(() => true);
      window.VSC.TwitterLoopPlayback = loopCtor;
    });

    afterEach(() => {
      window.VSC.TwitterLoopPlayback = previousLoop;
    });

    const deferPlay = () => {
      let resolve, reject;
      const promise = new Promise((accepted, refused) => {
        resolve = accepted;
        reject = refused;
      });
      nativePlay.mockImplementationOnce(function () {
        mediaState(this).paused = false;
        return promise;
      });
      return { resolve, reject };
    };

    describe('caption-owned MMS session', () => {
      let caption, originalTrack, proveSource, proveAttachment;
      beforeEach(() => {
        originalTrack = { mode: 'showing' };
        candidate.captionBinding = {
          original,
          track: originalTrack,
          isCurrent: () => candidate.current(),
        };
        candidate.current.mockImplementation(
          () => original.src === MSE && original.isConnected && originalTrack.mode === 'showing'
        );
        window.VSC.TwitterPlayer.resolve.mockReturnValue(null);
        window.VSC.TwitterPlayer.resolveCaptionedLoop = vi.fn(() => candidate);
        vi.spyOn(window.VSC.TwitterCaptionPlayback, 'createLoopOwner').mockImplementation(
          (_binding, video) => {
            const node = document.createElement('track'),
              track = { mode: 'showing' };
            let sourceReady = false,
              attachmentReady = false;
            caption = {
              node,
              track,
              closed: false,
              assigned: false,
              promise: new Promise((resolve) => {
                proveSource = () => {
                  sourceReady = true;
                  if (!caption.closed) {
                    caption.assigned = true;
                    node.src = 'blob:https://x.com/owned-caption';
                  }
                  resolve(caption);
                };
              }),
              get mode() {
                return caption.modeCertified === false ? undefined : track.mode;
              },
              attach: vi.fn(() => {
                video.append(node);
                Object.defineProperty(video, 'textTracks', { configurable: true, value: [track] });
                return new Promise((resolve) => {
                  proveAttachment = () => {
                    attachmentReady = true;
                    resolve();
                  };
                });
              }),
              setInvalidated: vi.fn((callback) => {
                caption.invalidate = callback;
              }),
              isCurrent: () => !caption.closed && candidate.current(),
              ownsTrack: (value) =>
                !caption.closed &&
                node.parentNode === value &&
                (caption.assigned
                  ? node.src === 'blob:https://x.com/owned-caption'
                  : !node.hasAttribute('src')) &&
                value.textTracks.length === 1 &&
                value.textTracks[0] === track,
              attestsInitialTrackWrite: (record) =>
                record.type === 'attributes' &&
                record.attributeName === 'src' &&
                record.target === node &&
                record.oldValue === null &&
                caption.assigned &&
                node.src === 'blob:https://x.com/owned-caption',
              verifyEpoch: () => sourceReady && attachmentReady,
              readyToPlay: () => sourceReady && attachmentReady,
              cleanup: vi.fn(() => {
                caption.closed = true;
                node.remove();
              }),
            };
            return caption;
          }
        );
        vi.spyOn(window.VSC.TwitterCaptionPlayback, 'isLoopOwner').mockImplementation(
          (value) => !!value && value === caption
        );
        const construct = loopCtor.getMockImplementation();
        loopCtor.mockImplementation(function (owner, callbacks) {
          construct.call(this, owner, callbacks);
          const loop = this,
            video = owner.video;
          this.sourceCurrent = () =>
            !loop.closed &&
            !video.hasAttribute('src') &&
            video.children.length === 3 &&
            this.sources.every(
              (source, index) =>
                video.querySelectorAll('source')[index] === source &&
                source.src === (index ? owner.candidate.sourceUrl : this.source)
            ) &&
            caption.ownsTrack(video);
          this.nativeTime = () => this.time;
          this.maybeReady = () => {
            if (
              loop.closed ||
              !caption.verifyEpoch(0) ||
              !caption.readyToPlay(this.time) ||
              !owner.prepareLoopRelease()
            ) {
              return;
            }
            this.prepared();
          };
        });
      });
      async function prepared(session) {
        proveSource();
        proveAttachment();
        await Promise.resolve();
        loops[0].readyState = 4;
        loops[0].maybeReady();
        await Promise.resolve();
        return session;
      }

      function nativeReadiness(session) {
        const loop = loops[0],
          video = session.video;
        let seeking = false;
        loop.video = video;
        loop.captionOwner = caption;
        loop.primed = true;
        loop.authorityCurrent = () => session.current();
        loop.verify = () => {
          if (!session.current()) {
            throw new Error('Session authority ended');
          }
        };
        loop.native = {
          playbackRate: {
            get() {
              return this.playbackRate;
            },
            set(value) {
              this.playbackRate = value;
            },
          },
        };
        Object.defineProperty(original, 'seeking', {
          configurable: true,
          get: () => !!mediaState(original).seeking,
        });
        Object.defineProperty(video, 'seeking', { configurable: true, get: () => seeking });
        Object.defineProperty(video, 'currentTime', {
          configurable: true,
          get: () => loop.time,
          set(value) {
            loop.time = value;
            seeking = true;
          },
        });
        loop.maybeReady = previousLoop.prototype.maybeReady.bind(loop);
        session.listen(video, 'seeked', () => loop.maybeReady());
        return {
          loop,
          settleSeek() {
            seeking = false;
            video.dispatchEvent(new Event('seeked'));
          },
        };
      }

      it('retains pending unlimited end-pause intent through the site restart and real native B seek readiness', async () => {
        original.currentTime = 4.75;
        const session = begin(4),
          video = session.video;
        const native = nativeReadiness(session);
        session.finish();
        await Promise.resolve();
        mediaState(original).ended = true;
        mediaState(original).paused = true;
        original.currentTime = 5;
        original.dispatchEvent(new Event('pause'));
        expect(session.closed).toBe(false);
        proveSource();
        proveAttachment();
        await Promise.resolve();
        await Promise.resolve();
        native.loop.readyState = 4;
        native.loop.maybeReady();
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(video.playbackRate).toBe(0);
        mediaState(original).ended = false;
        mediaState(original).seeking = true;
        original.currentTime = 0;
        original.dispatchEvent(new Event('seeking'));
        original.play();
        original.dispatchEvent(new Event('playing'));
        expect(session.closed).toBe(false);
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(video.playbackRate).toBe(0);
        mediaState(original).seeking = false;
        original.currentTime = 0.17;
        original.dispatchEvent(new Event('seeked'));
        expect(session.captionProducerPaused).toBe(true);
        expect(video.currentTime).toBe(0.17);
        expect(video.seeking).toBe(true);
        expect(video.playbackRate).toBe(0);
        expect(session.committed).toBe(false);
        native.settleSeek();
        expect(session.committed).toBe(true);
        expect(video.playbackRate).toBe(4);
        expect(nativePlay.mock.contexts).toEqual([video]);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(session.originalPause).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
      });

      it('defers readiness in the ended gap even before pause delivery, and waits through seeked until actual site playing', async () => {
        const session = begin(4),
          native = nativeReadiness(session);
        session.finish();
        await Promise.resolve();
        proveSource();
        proveAttachment();
        await Promise.resolve();
        await Promise.resolve();
        native.loop.readyState = 4;
        original.currentTime = 5;
        mediaState(original).ended = true;
        mediaState(original).paused = true;
        native.loop.maybeReady();
        expect(session.closed).toBe(false);
        expect(session.captionAwaitingRestart).toBe(true);
        original.dispatchEvent(new Event('pause'));
        mediaState(original).ended = false;
        original.currentTime = 0;
        mediaState(original).seeking = true;
        original.dispatchEvent(new Event('seeking'));
        mediaState(original).seeking = false;
        original.dispatchEvent(new Event('seeked'));
        expect(session.closed).toBe(false);
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(session.video.playbackRate).toBe(0);
        original.play();
        original.currentTime = 0.23;
        original.dispatchEvent(new Event('playing'));
        expect(session.time).toBe(0.23);
        expect(session.video.seeking).toBe(true);
        expect(session.video.playbackRate).toBe(0);
        native.settleSeek();
        expect(session.committed).toBe(true);
        expect(nativePlay).toHaveBeenCalledOnce();
        expect(originalPlay).toHaveBeenCalledOnce();
      });

      it('defers an in-flight producer seek and retries real B readiness only after settled original and B seeks', async () => {
        const session = begin(4),
          native = nativeReadiness(session);
        session.finish();
        await Promise.resolve();
        mediaState(original).seeking = true;
        original.currentTime = 3;
        original.dispatchEvent(new Event('seeking'));
        proveSource();
        proveAttachment();
        await Promise.resolve();
        await Promise.resolve();
        native.loop.readyState = 4;
        native.loop.maybeReady();
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(session.video.playbackRate).toBe(0);
        mediaState(original).seeking = false;
        original.currentTime = 3.05;
        original.dispatchEvent(new Event('seeked'));
        expect(session.time).toBe(3.05);
        expect(session.video.playbackRate).toBe(0);
        expect(session.committed).toBe(false);
        native.settleSeek();
        expect(session.committed).toBe(true);
        expect(nativePlay).toHaveBeenCalledOnce();
        expect(originalPlay).not.toHaveBeenCalled();
      });

      it.each([
        'wrapped Pause',
        'non-ended captured Pause',
        'finite policy',
        'source replacement',
        'caption choice',
        'DRM',
        'live policy',
        'timeout',
      ])(
        'does not implicitly resume or rewind a pre-ownership producer after %s during natural restart wait',
        async (reason) => {
          const capturedPause = original.pause,
            session = begin(4),
            native = nativeReadiness(session);
          session.finish();
          await Promise.resolve();
          original.currentTime = 5;
          mediaState(original).ended = true;
          mediaState(original).paused = true;
          original.dispatchEvent(new Event('pause'));
          expect(session.closed).toBe(false);
          if (reason === 'wrapped Pause') {
            original.pause();
          }
          if (reason === 'non-ended captured Pause') {
            mediaState(original).ended = false;
            mediaState(original).paused = false;
            capturedPause.call(original);
            original.dispatchEvent(new Event('pause'));
          }
          if (reason === 'finite policy') {
            candidate.loop = false;
            candidate.current.mockReturnValue(false);
            notify();
          }
          if (reason === 'source replacement') {
            original.src = 'blob:https://x.com/replaced';
            await Promise.resolve();
          }
          if (reason === 'caption choice') {
            originalTrack.mode = 'disabled';
            caption.invalidate();
          }
          if (reason === 'DRM') {
            original.dispatchEvent(new Event('encrypted'));
          }
          if (reason === 'live policy') {
            candidate.current.mockReturnValue(false);
            notify();
          }
          if (reason === 'timeout') {
            await vi.advanceTimersByTimeAsync(10001);
          }
          expect(session.closed).toBe(true);
          expect(session.captionProducerPaused).toBe(false);
          proveSource();
          proveAttachment();
          await Promise.resolve();
          native.loop.maybeReady();
          expect(session.committed).toBe(false);
          expect(originalPlay).not.toHaveBeenCalled();
          expect(original.load).not.toHaveBeenCalled();
          expect(candidate.api.seekTo).not.toHaveBeenCalled();
          expect(original.currentTime).toBe(5);
          expect(nativePlay).toHaveBeenCalledOnce();
        }
      );

      it('does not wait at EOF without an issued positive B Play intent or for a finite candidate', async () => {
        const session = begin(4);
        mediaState(original).ended = true;
        mediaState(original).paused = true;
        original.dispatchEvent(new Event('pause'));
        expect(session.closed).toBe(true);
        expect(nativePlay).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
      });

      it('retains producer playback until full caption proof and hands off its latest wrapped position using one B Play', async () => {
        const session = begin(4),
          video = session.video;
        session.finish();
        await Promise.resolve();
        expect(caption.attach).toHaveBeenCalledOnce();
        expect(caption.node.parentNode).toBe(video);
        expect(video.playbackRate).toBe(0);
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(original.paused).toBe(false);
        expect(nativePlay.mock.contexts).toEqual([video]);
        original.currentTime = 0.15;
        original.dispatchEvent(new Event('seeking'));
        original.play();
        original.dispatchEvent(new Event('playing'));
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(nativePlay.mock.contexts).toEqual([video]);
        expect(session.closed).toBe(false);
        proveSource();
        await Promise.resolve();
        loops[0].readyState = 4;
        loops[0].maybeReady();
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(video.playbackRate).toBe(0);
        proveAttachment();
        await Promise.resolve();
        loops[0].maybeReady();
        expect(session.originalPause).toHaveBeenCalledOnce();
        expect(video.currentTime).toBe(0.15);
        expect(video.playbackRate).toBe(4);
        expect(session.committed).toBe(true);
        expect(nativePlay.mock.contexts).toEqual([video]);
        expect(original.load).not.toHaveBeenCalled();
      });

      it.each([false, true])(
        'retains a captured native Pause during caption preparation (event queued %s)',
        async (queued) => {
          const capturedPause = original.pause;
          const session = begin(4),
            video = session.video;
          session.finish();
          await Promise.resolve();
          capturedPause.call(original);
          if (!queued) {
            original.dispatchEvent(new Event('pause'));
          }
          if (queued) {
            await prepared(session);
          }
          expect(session.closed).toBe(true);
          if (!queued) {
            proveSource();
            proveAttachment();
            await Promise.resolve();
            loops[0].maybeReady();
          }
          expect(session.committed).toBe(false);
          expect(original.paused).toBe(true);
          expect(nativePlay.mock.contexts).toEqual([video]);
          expect(originalPlay).not.toHaveBeenCalled();
          expect(original.load).not.toHaveBeenCalled();
        }
      );

      it.each([false, true])(
        'recognizes only its issued native pause during release (event delayed %s)',
        async (delayed) => {
          original.pause.mockImplementation(function () {
            mediaState(this).paused = true;
            if (delayed) {
              queueMicrotask(() => this.dispatchEvent(new Event('pause')));
            } else {
              this.dispatchEvent(new Event('pause'));
            }
          });
          const request = deferPlay();
          const session = begin(4);
          session.finish();
          await prepared(session);
          expect(session.closed).toBe(false);
          expect(session.committed).toBe(false);
          request.resolve();
          await Promise.resolve();
          expect(session.committed).toBe(true);
          expect(session.video.paused).toBe(false);
          expect(nativePlay).toHaveBeenCalledOnce();
          expect(originalPlay).not.toHaveBeenCalled();
        }
      );

      it('keeps an initially paused caption handoff paused without issuing a pause-event exemption', async () => {
        mediaState(original).paused = true;
        const session = begin(4);
        session.finish();
        await prepared(session);
        expect(session.committed).toBe(true);
        expect(session.video.paused).toBe(true);
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(nativePlay).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
      });

      it('does not treat a current metadata binding as full caption authority during preparation', async () => {
        const session = begin(4);
        session.finish();
        caption.isCurrent = () => false;
        proveSource();
        proveAttachment();
        await Promise.resolve();
        loops[0].readyState = 4;
        loops[0].maybeReady();
        expect(candidate.current()).toBe(true);
        expect(session.identityCurrent()).toBe(true);
        expect(session.current()).toBe(false);
        expect(session.video.playbackRate).toBe(0);
        expect(session.originalPause).not.toHaveBeenCalled();
        expect(session.committed).toBe(false);
        caption.invalidate();
      });

      it('never replays B for a producer SDK Play after proof but before the first Play settles', async () => {
        const request = deferPlay();
        const session = begin(4),
          video = session.video;
        session.finish();
        await prepared(session);
        expect(session.captionProducerPaused).toBe(true);
        expect(session.committed).toBe(false);
        original.play();
        expect(session.closed).toBe(true);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(nativePlay.mock.contexts).toEqual([video]);
        request.resolve();
        await Promise.resolve();
        expect(nativePlay.mock.contexts).toEqual([video]);
        expect(original.paused).toBe(false);
      });

      it('permits only the owner-certified asynchronous track source write during preparation', async () => {
        const session = begin(4),
          video = session.video;
        session.finish();
        proveSource();
        await Promise.resolve();
        await Promise.resolve();
        expect(session.closed).toBe(false);
        expect(session.nativeSourceIntent()).toBe(false);
        expect(video.playbackRate).toBe(0);
        caption.node.src = 'https://example.test/foreign.vtt';
        expect(session.nativeSourceIntent()).toBe(true);
        session.playbackFailed();
        expect(session.closed).toBe(true);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      });

      it('guards a throwing caption write certificate and does not resume the retained producer from that metadata failure', async () => {
        const session = begin(4);
        session.finish();
        caption.attestsInitialTrackWrite = () => {
          throw new Error('Caption certificate unavailable');
        };
        proveSource();
        await Promise.resolve();
        await Promise.resolve();
        expect(session.closed).toBe(true);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      });

      it('rejects a repeated track URL write even when it repeats the owned Blob', async () => {
        const session = begin(4);
        session.finish();
        proveSource();
        await Promise.resolve();
        await Promise.resolve();
        expect(session.closed).toBe(false);
        caption.node.src = 'blob:https://x.com/owned-caption';
        expect(session.nativeSourceIntent()).toBe(true);
        session.playbackFailed();
        expect(session.closed).toBe(true);
        expect(originalPlay).not.toHaveBeenCalled();
      });

      it('lets a newer producer Pause cancel pending caption preparation without a late Play or pause reversal', async () => {
        const session = begin(4),
          video = session.video;
        session.finish();
        await Promise.resolve();
        original.pause();
        expect(original.paused).toBe(true);
        expect(session.closed).toBe(true);
        expect(caption.cleanup).toHaveBeenCalledOnce();
        proveSource();
        proveAttachment();
        await Promise.resolve();
        loops[0].maybeReady();
        expect(nativePlay.mock.contexts).toEqual([video]);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
        expect(video.getAttribute('src')).not.toBe(MP4);
      });

      it('rejects a foreign caption owner without invoking its cleanup or any media operation', () => {
        const foreign = { cleanup: vi.fn(), attach: vi.fn() };
        window.VSC.TwitterCaptionPlayback.createLoopOwner.mockReturnValueOnce(foreign);
        expect(begin(4)).toBeNull();
        expect(foreign.cleanup).not.toHaveBeenCalled();
        expect(foreign.attach).not.toHaveBeenCalled();
        expect(nativePlay).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(original.pause).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      });

      it('does not copy technical pending B caption mode during a failed uncommitted handoff', async () => {
        const request = deferPlay();
        const session = begin(4);
        session.finish();
        await prepared(session);
        expect(session.committed).toBe(false);
        caption.track.mode = 'hidden';
        session.playbackFailed();
        expect(originalTrack.mode).toBe('showing');
        request.resolve();
        await Promise.resolve();
        expect(originalTrack.mode).toBe('showing');
      });

      it.each(['unsupported', 'constructor failure', 'precommit failure'])(
        'never falls back to progressive MP4 after caption MMS %s',
        async (failure) => {
          if (failure === 'unsupported') {
            loopCtor.canUse.mockReturnValue(false);
          }
          if (failure === 'constructor failure') {
            loopCtor.mockImplementationOnce(() => {
              throw new Error('MMS unavailable');
            });
          }
          const session = begin(4);
          if (failure === 'precommit failure') {
            session.finish();
            await Promise.resolve();
            loops[0].callbacks.failed(new Error('Caption append failed'));
            expect(session.closed).toBe(true);
            expect(session.video.getAttribute('src')).not.toBe(MP4);
          } else {
            expect(session).toBeNull();
          }
          expect(caption.cleanup).toHaveBeenCalledOnce();
          expect(original.pause).not.toHaveBeenCalled();
          expect(originalPlay).not.toHaveBeenCalled();
          expect(original.load).not.toHaveBeenCalled();
          expect(original.src).toBe(MSE);
        }
      );

      it('hands a committed caption failure back with latest B caption mode without reloading MP4', async () => {
        const session = begin(4);
        session.finish();
        await prepared(session);
        caption.track.mode = 'hidden';
        loops[0].callbacks.failed(new Error('Future caption epoch failed'));
        expect(session.closed).toBe(true);
        expect(originalTrack.mode).toBe('hidden');
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
        expect(session.video.getAttribute('src')).not.toBe(MP4);
        expect(caption.cleanup).toHaveBeenCalledOnce();
      });

      it('hands back a committed B caption-off intent even when disabled native cues become null', async () => {
        const session = begin(4);
        session.finish();
        await prepared(session);
        caption.track.mode = 'disabled';
        caption.track.cues = null;
        caption.invalidate();
        expect(originalTrack.mode).toBe('disabled');
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
        expect(caption.cleanup).toHaveBeenCalledOnce();
      });

      it.each(['refused cue certificate', 'invalid mode'])(
        'does not grant an original caption-mode write for %s',
        async (change) => {
          const session = begin(4);
          session.finish();
          await prepared(session);
          const writes = [];
          let mode = 'showing';
          Object.defineProperty(originalTrack, 'mode', {
            configurable: true,
            get: () => mode,
            set: (value) => {
              writes.push(value);
              mode = value;
            },
          });
          caption.track.mode = change === 'invalid mode' ? 'foreign-mode' : 'disabled';
          if (change === 'refused cue certificate') {
            caption.modeCertified = false;
          }
          caption.invalidate();
          expect(writes).toEqual([]);
          expect(originalTrack.mode).toBe('showing');
          expect(original.load).not.toHaveBeenCalled();
        }
      );

      it('preserves guarded position and playback handback when native caption mode assignment throws', async () => {
        const session = begin(4);
        session.finish();
        await prepared(session);
        session.video.currentTime = 3.5;
        caption.track.mode = 'hidden';
        Object.defineProperty(originalTrack, 'mode', {
          configurable: true,
          get: () => 'showing',
          set: () => {
            throw new Error('Native caption mode unavailable');
          },
        });
        session.playbackFailed();
        expect(original.currentTime).toBe(3.5);
        expect(original.playbackRate).toBe(4);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
      });

      it.each(['mode', 'source'])(
        'preserves newer original %s intent when the caption owner invalidates',
        async (change) => {
          const session = begin(4);
          session.finish();
          await prepared(session);
          caption.track.mode = 'disabled';
          if (change === 'mode') {
            originalTrack.mode = 'hidden';
          } else {
            original.src = 'blob:new-post';
          }
          caption.invalidate();
          expect(session.closed).toBe(true);
          expect(originalTrack.mode).toBe(change === 'mode' ? 'hidden' : 'showing');
          expect(originalPlay).toHaveBeenCalledTimes(change === 'mode' ? 1 : 0);
          expect(original.load).not.toHaveBeenCalled();
          expect(caption.cleanup).toHaveBeenCalledOnce();
        }
      );
    });

    it('issues the single gesture-stack Play at native zero and commits only after preparation releases the requested rate', async () => {
      const started = [];
      nativePlay.mockImplementationOnce(function () {
        started.push({ rate: this.playbackRate, time: this.currentTime });
        mediaState(this).paused = false;
        return Promise.resolve();
      });
      original.muted = false;
      const session = begin(4);
      const loop = loops[0];
      expect(session.video.playbackRate).toBe(0);
      session.finish();
      await loaded(session);
      expect(started).toEqual([{ rate: 0, time: 1.25 }]);
      expect(session.committed).toBe(false);
      expect(original.vsc).toBe(controller);
      expect(session.video).toMatchObject({ muted: false, volume: 0.4, loop: true });
      loop.prepared();
      expect(session.committed).toBe(true);
      expect(session.video.playbackRate).toBe(4);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(session.video.defaultPlaybackRate).toBe(1);
      expect(original.src).toBe(MSE);
    });

    it('keeps absolute and genuine relative input on the retained producer while the companion rate is held', async () => {
      controller.config.settings.lastSpeed = 2.1;
      controller.config.save = vi.fn();
      const handler = new window.VSC.ActionHandler(controller.config, null);
      controller.actionHandler = handler;
      vi.spyOn(handler, 'flashController').mockImplementation(() => {});
      expect(handler.adjustSpeed(original, 2.1)).toBe(true);
      const session = api().getPending(original),
        loop = loops[0];
      expect(session.video.playbackRate).toBe(0);
      expect(handler.adjustSpeed(original, 0.1, { relative: true })).toBe(true);
      expect(handler.adjustSpeed(original, 0.1, { relative: true })).toBe(true);
      expect(original.playbackRate).toBe(2.3);
      expect(session.video.playbackRate).toBe(0);
      loop.prepared();
      await Promise.resolve();
      expect(session.committed).toBe(true);
      expect(session.video.playbackRate).toBe(2.3);
      expect(controller.config.settings.lastSpeed).toBe(2.3);
      expect(nativePlay).toHaveBeenCalledOnce();
    });

    it('releases the latest rate after a genuine Pause without replaying a stale Play', async () => {
      const pending = deferPlay();
      const session = begin(2.1),
        loop = loops[0];
      session.finish();
      begin(4);
      original.pause();
      expect(session.video.playbackRate).toBe(0);
      loop.prepared();
      expect(session.committed).toBe(true);
      expect(session.video).toMatchObject({ playbackRate: 4, paused: true });
      pending.resolve();
      await Promise.resolve();
      expect(session.video.paused).toBe(true);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(originalPlay).not.toHaveBeenCalled();
    });

    it('uses the latest requested rate for verified MP4 fallback while native MMS is held at zero', async () => {
      original.muted = false;
      const session = begin(2.1),
        loop = loops[0];
      session.finish();
      begin(4);
      session.video.currentTime = 2.75;
      expect(session.video.playbackRate).toBe(0);
      loop.callbacks.failed(new Error('Native hold reset'));
      expect(session.video).toMatchObject({
        src: MP4,
        playbackRate: 4,
        currentTime: 2.75,
        muted: false,
        volume: 0.4,
      });
      loop.readyState = 4;
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('retains the actual released native rate on precommit fallback after an accepted rate changed locally', async () => {
      const waiting = deferPlay();
      const session = begin(4),
        loop = loops[0];
      session.finish();
      loop.prepared();
      session.video.playbackRate = 3.6;
      loop.callbacks.failed(new Error('Append failed after release'));
      expect(session.video.playbackRate).toBe(3.6);
      expect(session.video.src).toBe(MP4);
      waiting.reject(new DOMException('Old MMS request', 'AbortError'));
      await Promise.resolve();
      expect(session.closed).toBe(false);
      loop.readyState = 4;
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(session.video.playbackRate).toBe(3.6);
    });

    it.each([false, true])(
      'hands back the latest requested positive rate while native preparation is held (paused %s)',
      (paused) => {
        const session = begin(2.1);
        original.playbackRate = 2.1;
        session.finish();
        begin(4);
        original.playbackRate = 4;
        if (paused) {
          original.pause();
        }
        expect(session.video.playbackRate).toBe(0);
        // The retained paused producer still owns position until companion commit.
        original.currentTime = 2.75;
        session.cleanup();
        expect(original.playbackRate).toBe(4);
        expect(original.currentTime).toBe(2.75);
        expect(original.paused).toBe(paused);
        expect(originalPlay).toHaveBeenCalledTimes(paused ? 0 : 1);
        expect(original.load).not.toHaveBeenCalled();
        expect(original.src).toBe(MSE);
      }
    );

    it('falls back synchronously on unsupported native zero without a partial Play or original load', async () => {
      loopCtor.mockImplementationOnce((owner) => {
        owner.video.playbackRate = 1;
        throw new Error('Native zero rate unsupported');
      });
      const session = begin(4);
      expect(session.video).toMatchObject({ src: MP4, playbackRate: 4 });
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
      session.finish();
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(original.src).toBe(MSE);
    });

    it.each(['original source', 'capability', 'teardown'])(
      'does not release or commit held preparation after %s loss and a late Play result',
      async (loss) => {
        const waiting = deferPlay();
        const session = begin(4),
          loop = loops[0];
        session.finish();
        if (loss === 'original source') {
          original.src = 'blob:new-post';
          original.dispatchEvent(new Event('loadstart'));
        }
        if (loss === 'capability') {
          candidate.current.mockReturnValue(false);
        }
        if (loss === 'teardown') {
          session.cleanup({ resume: false });
        }
        loop.prepared();
        waiting.resolve();
        await Promise.resolve();
        expect(session.video.playbackRate).toBe(0);
        expect(session.committed).toBe(false);
        expect(companionCtor).not.toHaveBeenCalled();
        expect(nativePlay).toHaveBeenCalledOnce();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it('requires both complete loop preparation and native Play acceptance before replacing the producer', async () => {
      const pending = deferPlay();
      const session = begin();
      const loop = loops[0];
      session.finish();
      loop.readyState = 4;
      await loaded(session);
      expect(session.committed).toBe(false);
      expect(controller.remove).not.toHaveBeenCalled();
      loop.prepared();
      expect(session.committed).toBe(false);
      expect(api().getPending(original)).toBe(session);
      pending.resolve();
      await Promise.resolve();
      expect(session.committed).toBe(true);
      expect(session.video.currentSrc).toBe(loop.source);
      expect(controller.remove).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    const pendingLoopSeek = (session, loop) => {
      let seeking = true;
      Object.defineProperty(session.video, 'seeking', { configurable: true, get: () => seeking });
      loop.readyState = 4;
      return () => {
        seeking = false;
        session.video.dispatchEvent(new Event('seeked'));
        loop.prepared();
      };
    };

    it('keeps the producer controls while native Play is accepted but startup seeking is not ready', async () => {
      const session = begin();
      const loop = loops[0];
      const settleSeek = pendingLoopSeek(session, loop);
      session.finish();
      await loaded(session);
      expect(session.playReady).toBe(true);
      expect(session.video.readyState).toBe(4);
      expect(session.video.seeking).toBe(true);
      expect(session.ready).toBe(false);
      expect(session.committed).toBe(false);
      expect(original.vsc).toBe(controller);
      expect(controller.remove).not.toHaveBeenCalled();
      settleSeek();
      expect(session.video.seeking).toBe(false);
      expect(session.committed).toBe(true);
      expect(controller.remove).toHaveBeenCalledOnce();
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('retains a newer Pause when startup seek readiness arrives before the old Play settles', async () => {
      const pending = deferPlay();
      const session = begin();
      const loop = loops[0];
      const settleSeek = pendingLoopSeek(session, loop);
      session.finish();
      await loaded(session);
      original.pause();
      expect(session.committed).toBe(false);
      expect(session.video.paused).toBe(true);
      settleSeek();
      expect(session.committed).toBe(true);
      expect(session.video.paused).toBe(true);
      pending.reject(new DOMException('Initial Play was interrupted by Pause', 'AbortError'));
      await Promise.resolve();
      expect(session.closed).toBe(false);
      expect(session.video.paused).toBe(true);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each(['producer source replacement', 'explicit teardown'])(
      'ignores late startup readiness after %s',
      async (reason) => {
        const pending = deferPlay();
        const session = begin();
        const loop = loops[0];
        const settleSeek = pendingLoopSeek(session, loop);
        session.finish();
        await loaded(session);
        if (reason === 'producer source replacement') {
          original.src = 'blob:https://x.com/new-item';
          original.dispatchEvent(new Event('loadstart'));
        } else {
          session.cleanup({ resume: false });
        }
        expect(session.closed).toBe(true);
        settleSeek();
        pending.resolve();
        await Promise.resolve();
        expect(session.committed).toBe(false);
        expect(controller.remove).not.toHaveBeenCalled();
        expect(companionCtor).not.toHaveBeenCalled();
        expect(loop.cleanup).toHaveBeenCalledOnce();
        expect(api().getPending(original)).toBeNull();
        expect(session.video.isConnected).toBe(false);
        expect(nativePlay).toHaveBeenCalledOnce();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
        expect(original.src).toBe(
          reason === 'producer source replacement' ? 'blob:https://x.com/new-item' : MSE
        );
      }
    );

    it('commits the latest requested speed after startup seeking completes without another Play', async () => {
      const session = begin(2.1);
      const loop = loops[0];
      const settleSeek = pendingLoopSeek(session, loop);
      original.playbackRate = 2.1;
      session.finish();
      await loaded(session);
      expect(begin(4)).toBe(session);
      original.playbackRate = 4;
      session.finish({ speedCommand: true });
      expect(session.committed).toBe(false);
      expect(session.video.playbackRate).toBe(0);
      settleSeek();
      expect(session.committed).toBe(true);
      expect(session.video.playbackRate).toBe(4);
      expect(companionCtor.mock.calls[0].at(-1)).toBe(4);
      expect(loopCtor).toHaveBeenCalledOnce();
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('starts first Play from the actual paused position and never rewinds it on a repeated finish', () => {
      original.pause.mockImplementation(function () {
        this.currentTime = 2.75;
        mediaState(this).paused = true;
      });
      const session = begin();
      const loop = loops[0];
      expect(session.time).toBe(1.25);
      original.currentTime = 2.25;
      const starts = [];
      nativePlay.mockImplementationOnce(function () {
        starts.push(this.currentTime);
        mediaState(this).paused = false;
        return Promise.resolve();
      });
      expect(session.finish()).toBe(true);
      expect(starts).toEqual([2.75]);
      expect(session.time).toBe(2.75);
      expect(loop.time).toBe(2.75);
      expect(original.currentTime).toBe(2.75);
      session.video.currentTime = 3.5;
      expect(session.finish({ speedCommand: true })).toBe(true);
      expect(session.video.currentTime).toBe(3.5);
      expect(session.time).toBe(2.75);
      expect(nativePlay).toHaveBeenCalledOnce();
      expect(session.originalPause).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('retains the latest paused position without starting playback', async () => {
      mediaState(original).paused = true;
      const session = begin();
      const loop = loops[0];
      original.currentTime = 2.75;
      expect(session.finish()).toBe(true);
      expect(session.time).toBe(2.75);
      expect(session.video.currentTime).toBe(2.75);
      loop.prepared();
      await Promise.resolve();
      expect(session.committed).toBe(true);
      expect(session.video).toMatchObject({ currentTime: 2.75, paused: true });
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each(['no-op', 'exception'])(
      'does not start a companion or rewind a still-playing producer after a %s Pause',
      (failure) => {
        original.pause.mockImplementation(() => {
          if (failure === 'exception') {
            throw new Error('Site Pause failed');
          }
        });
        const session = begin();
        const loop = loops[0];
        original.currentTime = 2.75;
        expect(() => session.finish()).not.toThrow();
        expect(session.closed).toBe(true);
        expect(nativePlay).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original).toMatchObject({ src: MSE, currentTime: 2.75, paused: false });
        expect(loop.cleanup).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it('recovers the actual paused position if the first-play native target update throws', () => {
      original.pause.mockImplementation(function () {
        this.currentTime = 2.75;
        mediaState(this).paused = true;
      });
      const session = begin();
      const loop = loops[0];
      loop.seekError = new Error('Native target update failed');
      expect(() => session.finish()).not.toThrow();
      expect(session.closed).toBe(true);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original).toMatchObject({ src: MSE, currentTime: 2.75, paused: false });
      expect(candidate.api.seekTo.mock.calls.every(([time]) => time === 2.75)).toBe(true);
      expect(loop.cleanup).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('does not copy a replacement source position into the companion during handoff Pause', () => {
      original.pause.mockImplementation(function () {
        mediaState(this).paused = true;
        this.src = 'blob:https://x.com/new-item';
        this.currentTime = 4.25;
      });
      const session = begin();
      const loop = loops[0];
      expect(session.finish()).toBe(false);
      expect(session.closed).toBe(true);
      expect(loop.time).toBe(1.25);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(original).toMatchObject({ src: 'blob:https://x.com/new-item', currentTime: 4.25 });
      expect(original.load).not.toHaveBeenCalled();
    });

    it('recovers the actual paused position when capabilities change but the producer identity remains current', () => {
      original.pause.mockImplementation(function () {
        this.currentTime = 2.75;
        mediaState(this).paused = true;
        candidate.current.mockReturnValue(false);
      });
      const session = begin();
      expect(session.finish()).toBe(false);
      expect(session.closed).toBe(true);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original).toMatchObject({ src: MSE, currentTime: 2.75, paused: false });
      expect(candidate.api.seekTo.mock.calls.every(([time]) => time === 2.75)).toBe(true);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('leaves the producer untouched when the initial native target setter rejects before finish', () => {
      const constructLoop = loopCtor.getMockImplementation();
      loopCtor.mockImplementationOnce(function (...args) {
        constructLoop.apply(this, args);
        this.seekError = new Error('Initial native target failed');
      });
      expect(begin()).toBeNull();
      const loop = loops[0];
      expect(loop.cleanup).toHaveBeenCalledOnce();
      expect(loop.closed).toBe(true);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(original.pause).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(original).toMatchObject({ src: MSE, currentTime: 1.25, paused: false });
      expect(original.load).not.toHaveBeenCalled();
      expect(loop.owner.video.hasAttribute('src')).toBe(false);
      expect(api().getPending(original)).toBeNull();
    });

    it.each(['loader failure', 'native error', 'startup deadline'])(
      'preserves the current request on the same verified MP4 after %s',
      async (failure) => {
        original.muted = false;
        const pending = deferPlay();
        const session = begin();
        const loop = loops[0],
          video = session.video;
        session.finish();
        video.currentTime = 3.5;
        begin(2.1);
        expect(video.playbackRate).toBe(0);
        video.volume = 0.7;
        if (failure === 'loader failure') {
          loop.callbacks.failed(new Error('Unreadable fragments'));
        } else if (failure === 'native error') {
          video.dispatchEvent(new Event('error'));
        } else {
          await vi.advanceTimersByTimeAsync(10000);
        }
        expect(session.closed).toBe(false);
        expect(session.video).toBe(video);
        expect(video).toMatchObject({
          src: MP4,
          currentTime: 3.5,
          playbackRate: 2.1,
          muted: false,
          volume: 0.7,
        });
        expect(loop.cleanup).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(nativePlay.mock.contexts).toEqual([video, video]);
        pending.reject(new DOMException('Old MMS request aborted by MP4 load', 'AbortError'));
        await Promise.resolve();
        expect(session.closed).toBe(false);
        loop.readyState = 4;
        await loaded(session);
        expect(session.committed).toBe(true);
        expect(companionCtor).toHaveBeenCalledOnce();
      }
    );

    it('continues a rejected MMS Play on the same verified MP4 with its latest audible intent', async () => {
      original.muted = false;
      const pending = deferPlay();
      const session = begin();
      const loop = loops[0],
        video = session.video;
      session.finish();
      video.currentTime = 3.5;
      begin(2.1);
      expect(video.playbackRate).toBe(0);
      video.volume = 0.7;
      pending.reject(new DOMException('MMS codec unavailable', 'NotSupportedError'));
      await Promise.resolve();
      expect(session.closed).toBe(false);
      expect(session.video).toBe(video);
      expect(video).toMatchObject({
        src: MP4,
        currentTime: 3.5,
        playbackRate: 2.1,
        muted: false,
        volume: 0.7,
      });
      expect(nativePlay.mock.contexts).toEqual([video, video]);
      expect(loop.cleanup).toHaveBeenCalledOnce();
      loop.readyState = 4;
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(companionCtor).toHaveBeenCalledOnce();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('hands back once when the MP4 continuation also rejects Play', async () => {
      original.muted = false;
      const pending = deferPlay();
      const session = begin();
      const loop = loops[0],
        video = session.video;
      session.finish();
      nativePlay.mockRejectedValueOnce(new DOMException('Play refused', 'NotAllowedError'));
      pending.reject(new DOMException('MMS codec unavailable', 'NotSupportedError'));
      await Promise.resolve();
      await Promise.resolve();
      expect(session.closed).toBe(true);
      expect(session.committed).toBe(false);
      expect(nativePlay.mock.contexts).toEqual([video, video]);
      expect(loop.cleanup).toHaveBeenCalledOnce();
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.muted).toBe(false);
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(companionCtor).not.toHaveBeenCalled();
      expect(api().getPending(original)).toBeNull();
    });

    it('keeps a new bounded MP4 deadline after the loop deadline expires', async () => {
      deferPlay();
      const session = begin();
      session.finish();
      await vi.advanceTimersByTimeAsync(10000);
      expect(session.closed).toBe(false);
      expect(session.video.src).toBe(MP4);
      await vi.advanceTimersByTimeAsync(9999);
      expect(session.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(session.closed).toBe(true);
      expect(original.load).not.toHaveBeenCalled();
      expect(originalPlay).toHaveBeenCalledOnce();
    });

    it('does not resume a paused pending request when loop preparation fails', async () => {
      const pending = deferPlay();
      const session = begin();
      const loop = loops[0];
      session.finish();
      original.pause();
      loop.callbacks.failed(new Error('Unreadable fragments'));
      expect(session.video.src).toBe(MP4);
      expect(session.video.paused).toBe(true);
      expect(nativePlay).toHaveBeenCalledOnce();
      pending.reject(new DOMException('Interrupted old Play', 'AbortError'));
      await Promise.resolve();
      expect(session.closed).toBe(false);
      loop.readyState = 4;
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(session.video.paused).toBe(true);
      expect(originalPlay).not.toHaveBeenCalled();
    });

    it('ignores queued MMS readiness until the MP4 continuation is actually ready', async () => {
      const session = begin();
      const loop = loops[0];
      session.finish();
      original.pause();
      loop.callbacks.failed(new Error('Unreadable fragments'));
      await loaded(session);
      expect(session.committed).toBe(false);
      expect(controller.remove).not.toHaveBeenCalled();
      loop.readyState = 4;
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(session.video.paused).toBe(true);
    });

    it.each(['poster', 'src', 'source type'])(
      'preserves a queued companion %s write instead of selecting the fallback',
      async (change) => {
        const session = begin();
        const loop = loops[0];
        session.finish();
        nativePlay.mockClear();
        if (change === 'source type') {
          loop.sources[0].type = 'application/changed';
        } else {
          session.video.setAttribute(change, 'https://example.test/new-intent');
        }
        loop.callbacks.failed(new Error('Unreadable fragments'));
        await Promise.resolve();
        expect(session.closed).toBe(true);
        expect(nativePlay).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each(['source', 'SDK identity'])(
      'does not write or play a continuation after original %s changes',
      async (change) => {
        const session = begin();
        const loop = loops[0];
        session.finish();
        nativePlay.mockClear();
        if (change === 'source') {
          original.src = 'blob:https://x.com/new-item';
        } else {
          candidate.current.mockReturnValue(false);
          candidate.identityCurrent.mockReturnValue(false);
        }
        loop.callbacks.failed(new Error('Unreadable fragments'));
        await Promise.resolve();
        expect(session.closed).toBe(true);
        expect(nativePlay).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it('hands a committed loop back to its unchanged producer rather than reloading MP4', async () => {
      const session = begin();
      const loop = loops[0];
      session.finish();
      loop.prepared();
      await Promise.resolve();
      expect(session.committed).toBe(true);
      session.video.currentTime = 2.75;
      const load = vi.mocked(HTMLMediaElement.prototype.load);
      load.mockClear();
      loop.callbacks.failed(new Error('Native buffer failed'));
      expect(session.closed).toBe(true);
      expect(loop.cleanup).toHaveBeenCalledOnce();
      expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(2.75);
      expect(original.src).toBe(MSE);
      expect(original.load).not.toHaveBeenCalled();
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(load.mock.contexts).toEqual([session.video]);
      session.cleanup();
      expect(loop.cleanup).toHaveBeenCalledOnce();
    });

    it.each([false, true])(
      'preserves accepted 4× and current clip intent on committed loop failure while paused=%s',
      async (paused) => {
        original.muted = false;
        controller.config.settings.lastSpeed = 4;
        controller.config.save = vi.fn();
        const session = begin();
        const loop = loops[0],
          video = session.video;
        expect(session.originalRate).toBe(1);
        // ActionHandler applies the requested rate after creating the companion session.
        original.playbackRate = 4;
        session.finish();
        expect(session.appliedOriginalRate).toBe(4);
        loop.prepared();
        await Promise.resolve();
        expect(session.committed).toBe(true);
        Object.assign(video, { currentTime: 2.75, playbackRate: 4, muted: paused, volume: 0.65 });
        if (paused) {
          video.pause();
        }
        const load = vi.mocked(HTMLMediaElement.prototype.load);
        load.mockClear();
        loop.callbacks.failed(new Error('Native buffer failed after accepted playback'));
        expect(session.closed).toBe(true);
        expect(loop.cleanup).toHaveBeenCalledOnce();
        expect(original).toMatchObject({
          src: MSE,
          currentTime: 2.75,
          playbackRate: 4,
          muted: paused,
          volume: 0.65,
          paused,
        });
        expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(2.75);
        expect(originalPlay).toHaveBeenCalledTimes(paused ? 0 : 1);
        expect(original.load).not.toHaveBeenCalled();
        expect(load.mock.contexts).toEqual([video]);
        expect(window.VSC.IOSPlayer.siteRelinquished.has(original)).toBe(true);
        expect(controller.config.settings.lastSpeed).toBe(4);
        expect(controller.config.save).not.toHaveBeenCalled();
      }
    );

    it('retains the MP4 path if loop construction is unavailable', async () => {
      loopCtor.mockImplementationOnce(() => {
        throw new Error('MMS unavailable');
      });
      const session = begin();
      session.finish();
      await loaded(session);
      expect(session.committed).toBe(true);
      expect(session.video.src).toBe(MP4);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('does not construct a loop when the existing resolver vetoes the stream', () => {
      window.VSC.TwitterPlayer.resolve.mockReturnValue(null);
      expect(begin()).toBeNull();
      expect(loopCtor).not.toHaveBeenCalled();
      expect(original.pause).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each([
      ['MP4', 'direct source'],
      ['MMS', 'direct source'],
      ['MMS', 'source child'],
      ['MP4', 'reentrant direct source'],
      ['MMS', 'reentrant source child'],
    ])('does not unload foreign %s media after a %s replacement', async (kind, change) => {
      const { session, loop, video, controls } = await relativeSession(kind);
      const foreign = 'https://example.test/replacement.mp4';
      const child = change.includes('source child') ? loop.sources[0] : null;
      const replace = () => {
        if (child) {
          child.src = foreign;
        } else {
          video.src = foreign;
        }
      };
      if (change.startsWith('reentrant')) {
        controls.remove.mockImplementationOnce(() => {
          replace();
          delete video.vsc;
          api().controllerRemoved(video);
        });
      } else {
        replace();
      }
      const load = vi.mocked(HTMLMediaElement.prototype.load);
      load.mockClear();
      nativePause.mockClear();
      const pagePause = vi.fn();
      video.pause = pagePause;
      mediaState(video).paused = false;
      const seek = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set');
      const remove = video.remove;
      const detach = vi.spyOn(video, 'remove').mockImplementation(function () {
        expect(this.paused).toBe(true);
        remove.call(this);
      });
      const removeAttribute = vi.spyOn(video, 'removeAttribute');
      session.cleanup({ resume: false, reinitialize: false });
      expect(session.closed).toBe(true);
      expect(load.mock.contexts).not.toContain(video);
      expect(nativePause.mock.contexts).toEqual([video]);
      expect(pagePause).not.toHaveBeenCalled();
      expect(video.paused).toBe(true);
      expect(video.isConnected).toBe(false);
      expect(detach).toHaveBeenCalledOnce();
      expect(nativePlay).not.toHaveBeenCalled();
      expect(seek).not.toHaveBeenCalled();
      expect(removeAttribute).not.toHaveBeenCalledWith('src');
      if (child) {
        expect(child.parentNode).toBe(video);
        expect(child.src).toBe(foreign);
      } else {
        expect(video.src).toBe(foreign);
      }
      expect(original.src).toBe(MSE);
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each(['MP4', 'MMS'])(
      'does not seek or resume the original after %s source replacement during default teardown',
      async (kind) => {
        const { session, loop, video, controls } = await relativeSession(kind);
        const originalTime = original.currentTime,
          originalRate = original.playbackRate,
          foreign = 'https://example.test/replacement.mp4';
        video.currentTime = 3.25;
        controls.remove.mockImplementationOnce(() => {
          if (loop) {
            loop.sources[0].src = foreign;
          } else {
            video.src = foreign;
          }
          delete video.vsc;
          api().controllerRemoved(video);
        });
        const load = vi.mocked(HTMLMediaElement.prototype.load);
        load.mockClear();
        session.cleanup();
        expect(session.closed).toBe(true);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original).toMatchObject({
          src: MSE,
          currentTime: originalTime,
          playbackRate: originalRate,
          paused: true,
        });
        expect(original.load).not.toHaveBeenCalled();
        expect(load.mock.contexts).not.toContain(video);
        if (loop) {
          expect(loop.sources[0].parentNode).toBe(video);
          expect(loop.sources[0].src).toBe(foreign);
        } else {
          expect(video.src).toBe(foreign);
        }
      }
    );

    it.each([
      ['MP4', 'controller removal'],
      ['MMS', 'controller removal'],
      ['MP4', 'companion Pause'],
      ['MMS', 'companion Pause'],
    ])('honors a newer original Pause during %s %s', async (kind, phase) => {
      const { session, video, controls } = await relativeSession(kind);
      const originalTime = original.currentTime;
      video.currentTime = 3.25;
      expect(original.paused).toBe(true);
      session.originalPause.mockClear();
      if (phase === 'controller removal') {
        controls.remove.mockImplementationOnce(() => {
          original.pause();
          delete video.vsc;
          api().controllerRemoved(video);
        });
      } else {
        nativePause.mockImplementationOnce(function () {
          mediaState(this).paused = true;
          original.pause();
        });
      }
      session.cleanup();
      expect(session.closed).toBe(true);
      expect(session.originalPause).toHaveBeenCalledOnce();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(original).toMatchObject({ src: MSE, currentTime: originalTime, paused: true });
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each(['MP4', 'MMS'])(
      'does not duplicate a newer original Play during paused %s teardown',
      async (kind) => {
        const { session, video, controls } = await relativeSession(kind);
        const originalTime = original.currentTime;
        video.pause();
        video.currentTime = 3.25;
        controls.remove.mockImplementationOnce(() => {
          original.play();
          delete video.vsc;
          api().controllerRemoved(video);
        });
        session.cleanup();
        expect(session.closed).toBe(true);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original).toMatchObject({ src: MSE, currentTime: originalTime, paused: false });
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each(['MP4', 'MMS'])(
      'still pauses its %s node before removal when post-controller source reads throw',
      async (kind) => {
        const { session, video, controls } = await relativeSession(kind);
        const selectedSource = video.currentSrc || video.src;
        let reads = 0;
        const changedGetter = () => {
          if (kind === 'MP4' && ++reads <= 2) {
            return selectedSource;
          }
          throw new Error('Native source became inaccessible');
        };
        controls.remove.mockImplementationOnce(() => {
          Object.defineProperty(video, 'currentSrc', { configurable: true, get: changedGetter });
          delete video.vsc;
          api().controllerRemoved(video);
        });
        const pagePause = vi.fn();
        video.pause = pagePause;
        mediaState(video).paused = false;
        nativePause.mockClear();
        const remove = video.remove;
        const detach = vi.spyOn(video, 'remove').mockImplementation(function () {
          expect(this.paused).toBe(true);
          remove.call(this);
        });
        const load = vi.mocked(HTMLMediaElement.prototype.load);
        load.mockClear();
        expect(() => session.cleanup()).not.toThrow();
        expect(session.closed).toBe(true);
        expect(nativePause.mock.contexts).toEqual([video]);
        expect(pagePause).not.toHaveBeenCalled();
        expect(detach).toHaveBeenCalledOnce();
        expect(video.paused).toBe(true);
        expect(Object.getOwnPropertyDescriptor(video, 'currentSrc').get).toBe(changedGetter);
        expect(load.mock.contexts).not.toContain(video);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each(['MP4', 'MMS'])(
      'does not mistake an internal SDK seek Pause for newer intent during %s handback',
      async (kind) => {
        const { session, video } = await relativeSession(kind);
        video.currentTime = 3.25;
        candidate.api.seekTo.mockImplementation((time) => {
          original.pause();
          original.currentTime = time;
        });
        session.cleanup();
        expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(3.25);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(original).toMatchObject({
          src: MSE,
          currentTime: 3.25,
          playbackRate: 2.1,
          paused: false,
        });
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it('preserves later page media methods while honoring a teardown Pause', async () => {
      const { session, video, controls } = await relativeSession('MMS');
      const pagePlay = vi.fn(),
        pagePause = vi.fn();
      video.currentTime = 3.25;
      controls.remove.mockImplementationOnce(() => {
        original.pause();
        original.play = pagePlay;
        original.pause = pagePause;
        delete video.vsc;
        api().controllerRemoved(video);
      });
      session.cleanup();
      expect(original.play).toBe(pagePlay);
      expect(original.pause).toBe(pagePause);
      expect(pagePlay).not.toHaveBeenCalled();
      expect(pagePause).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(candidate.api.seekTo).not.toHaveBeenCalled();
      expect(original.paused).toBe(true);
    });

    it.each(['MP4', 'MMS'])(
      'honors a replacement-first original Pause during %s teardown',
      async (kind) => {
        const { session, video, controls } = await relativeSession(kind);
        const originalTime = original.currentTime,
          originalRate = original.playbackRate;
        video.currentTime = 3.25;
        expect(original.paused).toBe(true);
        session.originalPause.mockClear();
        const pagePause = vi.fn(function () {
          return session.originalPause.call(this);
        });
        controls.remove.mockImplementationOnce(() => {
          original.pause = pagePause;
          // Calling Pause on this already-paused producer need not emit an event.
          original.pause();
          delete video.vsc;
          api().controllerRemoved(video);
        });
        session.cleanup();
        expect(original.pause).toBe(pagePause);
        expect(pagePause).toHaveBeenCalledOnce();
        expect(session.originalPause).toHaveBeenCalledOnce();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original).toMatchObject({
          src: MSE,
          currentTime: originalTime,
          playbackRate: originalRate,
          paused: true,
        });
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each(['MP4', 'MMS'])(
      'preserves replacement-first original Play without a stale seek during %s teardown',
      async (kind) => {
        const { session, video, controls } = await relativeSession(kind);
        const originalTime = original.currentTime,
          originalRate = original.playbackRate;
        video.pause();
        video.currentTime = 3.25;
        const pagePlay = vi.fn(function () {
          return session.originalPlay.call(this);
        });
        controls.remove.mockImplementationOnce(() => {
          original.play = pagePlay;
          original.play();
          delete video.vsc;
          api().controllerRemoved(video);
        });
        session.cleanup();
        expect(original.play).toBe(pagePlay);
        expect(pagePlay).toHaveBeenCalledOnce();
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original).toMatchObject({
          src: MSE,
          currentTime: originalTime,
          playbackRate: originalRate,
          paused: false,
        });
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each(['MP4', 'MMS'])(
      'does not restore stale playback after a throwing replacement getter during %s teardown',
      async (kind) => {
        const { session, video, controls } = await relativeSession(kind);
        const originalTime = original.currentTime;
        video.currentTime = 3.25;
        const changedGetter = () => {
          throw new Error('Page media method is inaccessible');
        };
        controls.remove.mockImplementationOnce(() => {
          Object.defineProperty(original, 'pause', { configurable: true, get: changedGetter });
          delete video.vsc;
          api().controllerRemoved(video);
        });
        expect(() => session.cleanup()).not.toThrow();
        expect(Object.getOwnPropertyDescriptor(original, 'pause').get).toBe(changedGetter);
        expect(originalPlay).not.toHaveBeenCalled();
        expect(candidate.api.seekTo).not.toHaveBeenCalled();
        expect(original).toMatchObject({ src: MSE, currentTime: originalTime, paused: true });
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    async function relativeSession(kind = 'MP4') {
      loopCtor.canUse.mockReturnValue(kind !== 'MP4');
      Object.assign(controller.config.settings, { lastSpeed: 2.1, rememberSpeed: true });
      controller.config.speedPreferenceRevision = 3;
      controller.config.save = vi.fn();
      const handler = new window.VSC.ActionHandler(controller.config, null);
      controller.actionHandler = handler;
      vi.spyOn(handler, 'flashController').mockImplementation(() => {});
      const session = begin(2.1);
      session.finish();
      const loop = loops.at(-1);
      if (kind === 'MMS') {
        loop.prepared();
      } else {
        if (loop) {
          loop.callbacks.failed(new Error('Use verified MP4'));
          loop.readyState = 4;
        }
        await loaded(session);
      }
      await Promise.resolve();
      expect(session.committed).toBe(true);
      const video = session.video,
        controls = video.vsc,
        config = controller.config;
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<span class="draggable"></span><button class="touch-preset" data-value="4"></button>';
      controls.div = host;
      controls.speedIndicator = shadow.querySelector('.draggable');
      window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, 2.1);
      await vi.advanceTimersByTimeAsync(0);
      config.save.mockClear();
      const writes = vi
        .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
        .mockImplementation((target, rate) => {
          target.playbackRate = rate;
        });
      nativePlay.mockClear();
      return { session, loop, video, controls, handler, config, shadow, writes };
    }

    describe('committed fullscreen boundary certificate', () => {
      function certificate() {
        const boundary = {
          element: original.parentElement,
          current: vi.fn(() => true),
          activate: vi.fn(() => true),
        };
        candidate.fullscreenBoundary = vi.fn(() => boundary);
        return boundary;
      }

      it('does not consult site geometry for an original, unknown or pending companion', () => {
        certificate();
        const session = begin(4);
        for (const video of [original, document.createElement('video'), session.video]) {
          expect(window.VSC.TwitterMP4Playback.fullscreenBoundary(video)).toBeNull();
        }
        expect(candidate.fullscreenBoundary).not.toHaveBeenCalled();
      });

      it.each(['MP4', 'MMS'])(
        'delegates only the exact committed %s companion without native playback writes',
        async (kind) => {
          const { video } = await relativeSession(kind);
          const site = certificate();
          const boundary = window.VSC.TwitterMP4Playback.fullscreenBoundary(video);
          expect(boundary?.element).toBe(site.element);
          expect(boundary.current()).toBe(true);
          expect(site.activate).not.toHaveBeenCalled();
          expect(boundary.activate()).toBe(true);
          expect(site.activate).toHaveBeenCalledExactlyOnceWith();
          expect(site.activate.mock.contexts[0]).toBe(site);
          expect(nativePlay).not.toHaveBeenCalled();
          expect(original.load).not.toHaveBeenCalled();
          expect(candidate.api.seekTo).not.toHaveBeenCalled();
        }
      );

      it.each([
        'factory',
        'element',
        'current method',
        'activate method',
        'controller',
        'companion source',
        'companion poster',
        'original source',
        'site validity',
        'cleanup',
      ])('revokes a captured certificate after %s changes', async (kind) => {
        const { session, video } = await relativeSession();
        const site = certificate();
        const activate = site.activate;
        const boundary = window.VSC.TwitterMP4Playback.fullscreenBoundary(video);
        expect(boundary?.current()).toBe(true);
        switch (kind) {
          case 'factory':
            candidate.fullscreenBoundary = vi.fn(() => site);
            break;
          case 'element':
            site.element = document.createElement('div');
            break;
          case 'current method':
            site.current = vi.fn(() => true);
            break;
          case 'activate method':
            site.activate = vi.fn(() => true);
            break;
          case 'controller':
            video.vsc = { ...video.vsc };
            break;
          case 'companion source':
            video.src = 'https://media.example.test/new.mp4';
            break;
          case 'companion poster':
            video.poster = 'https://media.example.test/new.jpg';
            break;
          case 'original source':
            original.src = 'blob:new-site-source';
            break;
          case 'site validity':
            site.current.mockReturnValue(false);
            break;
          case 'cleanup':
            session.cleanup({ resume: false });
            break;
        }
        expect(boundary.current()).toBe(false);
        expect(boundary.activate()).toBe(false);
        expect(activate).not.toHaveBeenCalled();
        expect(nativePlay).not.toHaveBeenCalled();
      });

      it.each([
        'original',
        'companion',
        'body',
        'root',
        'foreign document',
        'throwing factory',
        'throwing validity',
      ])('declines a %s site boundary without native playback', async (kind) => {
        const { video } = await relativeSession();
        const site = certificate();
        if (kind === 'original') {
          site.element = original;
        }
        if (kind === 'companion') {
          site.element = video;
        }
        if (kind === 'body') {
          site.element = document.body;
        }
        if (kind === 'root') {
          site.element = document.documentElement;
        }
        if (kind === 'foreign document') {
          site.element = document.implementation.createHTMLDocument().body;
        }
        if (kind === 'throwing factory') {
          candidate.fullscreenBoundary.mockImplementation(() => {
            throw new Error('Page factory');
          });
        }
        if (kind === 'throwing validity') {
          site.current.mockImplementation(() => {
            throw new Error('Page validity');
          });
        }
        expect(window.VSC.TwitterMP4Playback.fullscreenBoundary(video)).toBeNull();
        expect(site.activate).not.toHaveBeenCalled();
        expect(nativePlay).not.toHaveBeenCalled();
      });

      it.each(['throw', 'source change', 'controller change'])(
        'reports failed activation on %s without another playback request',
        async (kind) => {
          const { video } = await relativeSession('MMS');
          const site = certificate();
          site.activate.mockImplementation(() => {
            if (kind === 'throw') {
              throw new Error('New site state');
            }
            if (kind === 'source change') {
              video.poster = 'https://media.example.test/new.jpg';
            } else {
              video.vsc = { ...video.vsc };
            }
            return true;
          });
          const boundary = window.VSC.TwitterMP4Playback.fullscreenBoundary(video);
          expect(boundary.activate()).toBe(false);
          expect(site.activate).toHaveBeenCalledOnce();
          expect(nativePlay).not.toHaveBeenCalled();
          expect(candidate.api.seekTo).not.toHaveBeenCalled();
        }
      );
    });

    it.each(['MP4', 'MMS', 'MP4 fallback'])(
      'applies one accepted native/UI/persisted rate after a burst on %s',
      async (kind) => {
        const { session, video, controls, handler, config, shadow, writes } =
          await relativeSession(kind);
        for (let click = 0; click < 19; click++) {
          expect(handler.adjustSpeed(video, 0.1, { relative: true })).toBe(false);
        }
        expect(session.requestedSpeed(controls)).toBe(4);
        expect(video.playbackRate).toBe(2.1);
        expect(config.settings.lastSpeed).toBe(2.1);
        expect(controls.speedIndicator.dataset.speed).toBe('2.1');
        expect(config.save).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(99);
        expect(writes).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(writes).toHaveBeenCalledExactlyOnceWith(video, 4);
        expect(video.playbackRate).toBe(4);
        expect(config.settings.lastSpeed).toBe(4);
        expect(controls.speedIndicator.dataset.speed).toBe('4');
        expect(shadow.querySelector('.touch-preset').getAttribute('aria-pressed')).toBe('true');
        expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 4 });
        expect(session.requestedSpeed(controls)).toBeNull();
        expect(nativePlay).not.toHaveBeenCalled();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it('starts the quiet interval at the last relative input and composes its pending target', async () => {
      const { session, video, controls, handler, writes } = await relativeSession();
      handler.adjustSpeed(video, 0.1, { relative: true });
      await vi.advanceTimersByTimeAsync(80);
      handler.adjustSpeed(video, 0.1, { relative: true });
      expect(session.requestedSpeed(controls)).toBe(2.3);
      await vi.advanceTimersByTimeAsync(99);
      expect(writes).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveBeenCalledExactlyOnceWith(video, 2.3);
    });

    it.each(['preference', 'settings', 'revision', 'handler', 'method', 'disposed', 'disabled'])(
      'does not accept a queued rate after its %s authority changes',
      async (change) => {
        const { session, video, controls, handler, config, writes } = await relativeSession();
        handler.adjustSpeed(video, 0.1, { relative: true });
        if (change === 'preference') {
          config.settings.lastSpeed = 6;
        }
        if (change === 'settings') {
          config.settings = { ...config.settings };
        }
        if (change === 'revision') {
          config.speedPreferenceRevision++;
        }
        if (change === 'handler') {
          controls.actionHandler = { setSpeed: vi.fn() };
        }
        if (change === 'method') {
          handler.setSpeed = vi.fn();
        }
        if (change === 'disposed') {
          controls.disposed = true;
        }
        if (change === 'disabled') {
          config.settings.enabled = false;
        }
        await vi.advanceTimersByTimeAsync(100);
        expect(writes).not.toHaveBeenCalled();
        expect(config.save).not.toHaveBeenCalled();
        expect(controls.speedIndicator.dataset.speed).toBe('2.1');
        expect(session.pendingRelative).toBeNull();
        expect(original.load).not.toHaveBeenCalled();
      }
    );

    it.each([
      'original source',
      'original poster',
      'companion source',
      'companion poster',
      'SDK',
      'navigation',
    ])('does not write a queued rate after %s changes', async (change) => {
      const { session, video, handler, config, writes } = await relativeSession();
      handler.adjustSpeed(video, 0.1, { relative: true });
      if (change === 'original source') {
        original.src = 'blob:https://x.com/new-item';
      }
      if (change === 'original poster') {
        original.poster = 'https://example.test/new.jpg';
      }
      if (change === 'companion source') {
        video.src = 'https://example.test/new.mp4';
      }
      if (change === 'companion poster') {
        video.poster = 'https://example.test/new.jpg';
      }
      if (change === 'SDK') {
        candidate.current.mockReturnValue(false);
        candidate.identityCurrent.mockReturnValue(false);
      }
      if (change === 'navigation') {
        vi.spyOn(document, 'URL', 'get').mockReturnValue('https://x.com/new-item');
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(writes).not.toHaveBeenCalled();
      expect(config.save).not.toHaveBeenCalled();
      expect(session.pendingRelative).toBeNull();
      expect(session.closed).toBe(true);
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each(['original source', 'companion poster'])(
      'consumes a new relative input after %s loss instead of falling through to a native write',
      async (change) => {
        const { session, video, handler, config, writes } = await relativeSession();
        handler.adjustSpeed(video, 0.1, { relative: true });
        if (change === 'original source') {
          original.src = 'blob:https://x.com/new-item';
        } else {
          video.poster = 'https://example.test/new.jpg';
        }
        expect(handler.adjustSpeed(video, 0.1, { relative: true })).toBe(false);
        await vi.advanceTimersByTimeAsync(100);
        expect(session.closed).toBe(true);
        expect(writes).not.toHaveBeenCalled();
        expect(config.save).not.toHaveBeenCalled();
        expect(config.settings.lastSpeed).toBe(2.1);
        expect(originalPlay).not.toHaveBeenCalled();
      }
    );

    it('begins a new batch from native acceptance after a saved-preference replacement', async () => {
      const { session, video, controls, handler, config, writes } = await relativeSession();
      handler.adjustSpeed(video, 0.1, { relative: true });
      config.settings.lastSpeed = 6;
      config.speedPreferenceRevision++;
      handler.adjustSpeed(video, 0.1, { relative: true });
      expect(session.requestedSpeed(controls)).toBe(2.2);
      expect(config.settings.lastSpeed).toBe(6);
      await vi.advanceTimersByTimeAsync(100);
      expect(writes).toHaveBeenCalledExactlyOnceWith(video, 2.2);
      expect(config.settings.lastSpeed).toBe(2.2);
      expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 2.2 });
    });

    it('hands back current accepted playback when only SDK capability is lost during queued input', async () => {
      const { session, video, handler, config, writes } = await relativeSession('MMS');
      video.currentTime = 3.25;
      handler.adjustSpeed(video, 0.1, { relative: true });
      candidate.current.mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(session.closed).toBe(true);
      expect(session.pendingRelative).toBeNull();
      expect(writes).not.toHaveBeenCalled();
      expect(config.save).not.toHaveBeenCalled();
      expect(config.settings.lastSpeed).toBe(2.1);
      expect(original).toMatchObject({ src: MSE, currentTime: 3.25, playbackRate: 2.1 });
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('keeps a queued speed change paused without requesting Play', async () => {
      const { video, handler, writes } = await relativeSession();
      handler.adjustSpeed(video, 0.1, { relative: true });
      video.pause();
      await vi.advanceTimersByTimeAsync(100);
      expect(writes).toHaveBeenCalledExactlyOnceWith(video, 2.2);
      expect(video.paused).toBe(true);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
    });

    it('lets an absolute command cancel the batch and remain the only accepted rate', async () => {
      const { session, video, controls, handler, config, writes } = await relativeSession();
      handler.adjustSpeed(video, 0.1, { relative: true });
      expect(handler.adjustSpeed(video, 1.5)).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(session.pendingRelative).toBeNull();
      expect(writes).toHaveBeenCalledExactlyOnceWith(video, 1.5);
      expect(controls.speedIndicator.dataset.speed).toBe('1.5');
      expect(config.settings.lastSpeed).toBe(1.5);
      expect(config.save).toHaveBeenCalledExactlyOnceWith({ lastSpeed: 1.5 });
    });

    it('cancels queued input on handback and cannot persist or revive it later', async () => {
      const { session, video, handler, config, writes } = await relativeSession('MMS');
      handler.adjustSpeed(video, 0.1, { relative: true });
      session.cleanup({ site: true, playing: false });
      await vi.advanceTimersByTimeAsync(100);
      expect(session.pendingRelative).toBeNull();
      expect(writes).not.toHaveBeenCalled();
      expect(config.save).not.toHaveBeenCalled();
      expect(original.playbackRate).toBe(2.1);
      expect(original.paused).toBe(true);
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    async function idleLoopClips() {
      const candidates = new Map();
      window.VSC.TwitterPlayer.resolve.mockImplementation((video) => candidates.get(video));
      const clips = Array.from({ length: 5 }, (_, index) => {
        const video = document.createElement('video');
        video.src = `${MSE}-${index}`;
        video.currentTime = 1;
        Object.defineProperty(video, 'currentSrc', { get: () => video.src });
        video.play = vi.fn(() => Promise.resolve());
        video.load = vi.fn();
        mediaState(video).paused = false;
        const parent = document.createElement('div');
        parent.append(video);
        document.body.append(parent);
        const owner = {
          video,
          config: controller.config,
          actionHandler: {},
          iosPlayer: { active: false },
          remove() {
            this.disposed = true;
            delete video.vsc;
            api().controllerRemoved(video);
          },
        };
        video.vsc = owner;
        const metadata = {
          ...candidate,
          originalUrl: video.src,
          progressiveUrl: `${MP4}?clip=${index}`,
          current: vi.fn(() => video.isConnected),
          identityCurrent: vi.fn(() => video.isConnected),
          subscribe: vi.fn(() => vi.fn()),
          api: { seekTo: vi.fn((time) => (video.currentTime = time)) },
        };
        candidates.set(video, metadata);
        return { video, owner, metadata, play: video.play };
      });
      for (const clip of clips.slice(0, 4)) {
        clip.session = api().begin(clip.owner, 4, 'init');
        clip.session.finish();
        clip.loop = loops.at(-1);
        clip.loop.prepared();
        await Promise.resolve();
        expect(clip.session.committed).toBe(true);
        clip.session.video.pause();
        clip.session.video.getBoundingClientRect = () => new DOMRect(0, -1000, 320, 180);
      }
      return clips;
    }

    it('reclaims a paused offscreen loop through position-preserving handback without loading its producer', async () => {
      const clips = await idleLoopClips();
      const first = clips[0];
      first.session.video.currentTime = 3.25;
      const next = api().begin(clips[4].owner, 4, 'init');
      expect(next).toBeTruthy();
      expect(first.session.closed).toBe(true);
      expect(first.loop.cleanup).toHaveBeenCalledOnce();
      expect(first.metadata.api.seekTo).toHaveBeenCalledExactlyOnceWith(3.25);
      expect(first.video.paused).toBe(true);
      for (const clip of clips) {
        expect(clip.video.load).not.toHaveBeenCalled();
        expect(clip.play).not.toHaveBeenCalled();
      }
      expect(clips.slice(1, 4).every((clip) => !clip.session.closed)).toBe(true);
    });

    it('retains an idle loop slot for queued relative intent until that intent clears', async () => {
      const clips = await idleLoopClips();
      const first = clips[0];
      first.session.video.currentTime = 3.25;
      first.session.pendingRelative = {
        controller: first.session.video.vsc,
        target: 4.1,
        source: 'internal',
      };
      for (const clip of clips.slice(1, 4)) {
        clip.session.video.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
      }
      expect(api().canBegin(clips[4].owner, 4, 'init')).toBe(false);
      expect(api().begin(clips[4].owner, 4, 'init')).toBeNull();
      expect(clips.slice(0, 4).every((clip) => !clip.session.closed)).toBe(true);
      expect(first.loop.cleanup).not.toHaveBeenCalled();
      expect(first.metadata.api.seekTo).not.toHaveBeenCalled();
      first.session.pendingRelative = null;
      const next = api().begin(clips[4].owner, 4, 'init');
      expect(next).toBeTruthy();
      expect(first.session.closed).toBe(true);
      expect(first.loop.cleanup).toHaveBeenCalledOnce();
      expect(first.metadata.api.seekTo).toHaveBeenCalledExactlyOnceWith(3.25);
      expect(first.video.paused).toBe(true);
      for (const clip of clips) {
        expect(clip.video.load).not.toHaveBeenCalled();
        expect(clip.play).not.toHaveBeenCalled();
      }
      expect(clips.slice(1, 4).every((clip) => !clip.session.closed)).toBe(true);
    });
  });

  describe('strict real loop-loader fallback integration', () => {
    const progressive = 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/720x1280/clip.mp4';
    let previousMMS, previousCreateURL, previousRevokeURL, fetchManifest, releaseManifest;
    let requests, descriptors, failures, nativeSources;
    const settleLoader = async () => {
      for (let index = 0; index < 120; index++) {
        await Promise.resolve();
      }
    };
    function master(kind) {
      const audio = (id, language = 'en') =>
        `#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="${id}",AUTOSELECT=YES,LANGUAGE="${language}",URI="mp4a/${id}/audio.m3u8"`;
      const stream = (dimensions, group, path) => [
        `#EXT-X-STREAM-INF:BANDWIDTH=2298669,RESOLUTION=${dimensions},CODECS="mp4a.40.2,avc1.64001F",AUDIO="${group}"`,
        `avc1/${dimensions}/${path}.m3u8`,
      ];
      return [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        audio('audio-high'),
        ...(kind === 'audio semantics' ? [audio('audio-low', 'fr')] : []),
        ...(kind === 'duplicate supplied dimensions' ? [audio('audio-low')] : []),
        ...stream(
          kind === 'missing supplied dimensions' ? '360x640' : '720x1280',
          'audio-high',
          'selected'
        ),
        ...(kind === 'duplicate supplied dimensions'
          ? stream('720x1280', 'audio-low', 'duplicate')
          : []),
        ...(kind === 'audio semantics' ? stream('360x640', 'audio-low', 'other') : []),
      ].join('\n');
    }
    const response = (text) => {
      let sent = false;
      return {
        status: 200,
        ok: true,
        redirected: false,
        type: 'cors',
        url: candidate.sourceUrl,
        body: {
          getReader: () => ({
            read: () =>
              Promise.resolve(
                sent
                  ? { done: true }
                  : ((sent = true),
                    { done: false, value: Uint8Array.from(new TextEncoder().encode(text)) })
              ),
            cancel: vi.fn(() => Promise.resolve()),
          }),
        },
      };
    };

    beforeEach(() => {
      requests = [];
      descriptors = [];
      failures = [];
      nativeSources = [];
      previousMMS = window.ManagedMediaSource;
      previousCreateURL = window.URL.createObjectURL;
      previousRevokeURL = window.URL.revokeObjectURL;
      original.currentTime = 1.25;
      original.muted = false;
      Object.defineProperty(original, 'duration', { configurable: true, value: 5 });
      Object.defineProperty(original, 'audioTracks', {
        configurable: true,
        value: [{ enabled: true }],
      });
      candidate.progressiveUrl = progressive;
      window.ManagedMediaSource = class extends EventTarget {
        constructor() {
          super();
          this.readyState = 'closed';
          this.addSourceBuffer = vi.fn(() => {
            throw new Error('Rejected master must not initialize a decoder');
          });
          nativeSources.push(this);
        }
      };
      window.URL.createObjectURL = vi.fn(() => 'blob:https://x.com/real-loader-companion');
      window.URL.revokeObjectURL = vi.fn();
      fetchManifest = vi.fn((url, options) => {
        requests.push({ url, options });
        if (url !== candidate.sourceUrl) {
          throw new Error('Selection rejection must precede media requests');
        }
        return new Promise((resolve) => {
          releaseManifest = resolve;
        });
      });
      const create = window.VSC.TwitterLoopSource.create;
      vi.spyOn(window.VSC.TwitterLoopSource, 'create').mockImplementation((descriptor) => {
        descriptors.push(descriptor);
        const load = create(descriptor, {
          URL,
          TextDecoder,
          AbortController,
          fetch: fetchManifest,
          setTimeout: window.setTimeout.bind(window),
          clearTimeout: window.clearTimeout.bind(window),
        });
        load.promise.catch((error) => failures.push(error));
        return load;
      });
    });

    afterEach(() => {
      api().cleanupAll();
      window.ManagedMediaSource = previousMMS;
      window.URL.createObjectURL = previousCreateURL;
      window.URL.revokeObjectURL = previousRevokeURL;
    });

    it.each([
      ['duplicate supplied dimensions', false],
      ['duplicate supplied dimensions', true],
      ['missing supplied dimensions', false],
      ['missing supplied dimensions', true],
      ['audio semantics', false],
      ['audio semantics', true],
    ])(
      'continues on the same supplied MP4 after %s rejection (paused %s)',
      async (kind, paused) => {
        let settleOldPlay;
        nativePlay.mockImplementationOnce(function () {
          mediaState(this).paused = false;
          return new Promise((_resolve, reject) => {
            settleOldPlay = reject;
          });
        });
        const session = begin(2.1),
          video = session.video;
        expect(session.loopPlayback).toBeInstanceOf(window.VSC.TwitterLoopPlayback);
        expect(descriptors[0].progressiveUrl).toBe(progressive);
        session.finish();
        expect(video.playbackRate).toBe(0);
        begin(4);
        video.currentTime = 2.75;
        video.volume = 0.7;
        if (paused) {
          original.pause();
        }
        releaseManifest(response(master(kind)));
        await settleLoader();
        expect(requests.map(({ url }) => url)).toEqual([candidate.sourceUrl]);
        expect(failures).toHaveLength(1);
        expect(failures[0].code).toBe('ambiguous');
        expect(nativeSources[0].addSourceBuffer).not.toHaveBeenCalled();
        expect(session.video).toBe(video);
        expect(video).toMatchObject({
          src: progressive,
          currentTime: 2.75,
          playbackRate: 4,
          muted: false,
          volume: 0.7,
          paused,
        });
        expect(nativePlay.mock.contexts).toEqual(paused ? [video] : [video, video]);
        settleOldPlay(new DOMException('Old held MMS request interrupted', 'AbortError'));
        await settleLoader();
        Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
        await loaded(session);
        expect(session.committed).toBe(true);
        expect(video.paused).toBe(paused);
        expect(original.src).toBe(MSE);
        expect(original.load).not.toHaveBeenCalled();
        expect(originalPlay).not.toHaveBeenCalled();
        expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
      }
    );

    it('preserves a source child and forbids unload after a foreign URL is restored before observer delivery', async () => {
      const session = begin(4),
        video = session.video;
      session.finish();
      const node = video.querySelector('source'),
        value = node.getAttribute('src');
      const loads = HTMLMediaElement.prototype.load.mock.calls.length;
      node.src = 'https://example.test/foreign.mp4';
      node.setAttribute('src', value);
      await Promise.resolve();
      await Promise.resolve();
      expect(session.closed).toBe(true);
      expect(node.parentNode).toBe(video);
      expect(node.getAttribute('src')).toBe(value);
      expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(loads);
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
    });

    it.each(['source', 'capability'])(
      'cancels the real pending manifest after %s loss without a late MP4 continuation',
      async (loss) => {
        const session = begin(4),
          video = session.video;
        session.finish();
        expect(requests).toHaveLength(1);
        if (loss === 'source') {
          original.src = 'blob:new-post';
          original.dispatchEvent(new Event('loadstart'));
        } else {
          candidate.current.mockReturnValue(false);
          notify();
        }
        expect(session.closed).toBe(true);
        expect(requests[0].options.signal.aborted).toBe(true);
        const plays = nativePlay.mock.calls.length,
          producerPlays = originalPlay.mock.calls.length;
        releaseManifest(response(master('missing supplied dimensions')));
        await settleLoader();
        expect(video.getAttribute('src')).not.toBe(progressive);
        expect(session.committed).toBe(false);
        expect(nativePlay).toHaveBeenCalledTimes(plays);
        expect(originalPlay).toHaveBeenCalledTimes(producerPlays);
        expect(original.load).not.toHaveBeenCalled();
        expect(nativeSources[0].addSourceBuffer).not.toHaveBeenCalled();
        expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
      }
    );
  });

  describe('feed companion capacity', () => {
    let candidates;
    beforeEach(() => {
      candidates = new Map();
      window.VSC.TwitterPlayer.resolve.mockImplementation((video) => candidates.get(video));
    });
    function clip(index) {
      const video = document.createElement('video');
      video.src = `${MSE}-${index}`;
      Object.defineProperty(video, 'currentSrc', { get: () => video.src });
      video.play = vi.fn(() => Promise.resolve());
      video.load = vi.fn();
      mediaState(video).paused = false;
      const parent = document.createElement('div');
      parent.append(video);
      document.body.append(parent);
      const owner = {
        video,
        config: controller.config,
        actionHandler: {},
        iosPlayer: { active: false },
        remove() {
          this.disposed = true;
          delete video.vsc;
          api().controllerRemoved(video);
        },
      };
      video.vsc = owner;
      const metadata = {
        ...candidate,
        originalUrl: video.src,
        progressiveUrl: `${MP4}?clip=${index}`,
        current: vi.fn(() => video.isConnected),
        identityCurrent: vi.fn(() => video.isConnected),
        subscribe: vi.fn(() => vi.fn()),
        api: {
          seekTo: vi.fn((time) => {
            video.currentTime = time;
          }),
        },
      };
      candidates.set(video, metadata);
      return { video, owner, metadata, play: video.play };
    }
    async function idleFour() {
      const rows = [];
      for (let index = 0; index < 4; index++) {
        const row = clip(index);
        row.session = api().begin(row.owner, 4, 'init');
        row.session.finish();
        await loaded(row.session);
        expect(row.session.committed).toBe(true);
        Object.defineProperty(row.session.video, 'currentSrc', {
          configurable: true,
          get: () => row.session.video.src,
        });
        Object.defineProperty(row.session.video, 'readyState', { configurable: true, value: 4 });
        row.session.video.pause();
        row.session.video.dispatchEvent(new Event('pause'));
        row.session.video.getBoundingClientRect = () => new DOMRect(0, -1000, 320, 180);
        rows.push(row);
      }
      return rows;
    }

    it('reclaims one idle offscreen decoder only on admission and preserves paused producer position', async () => {
      const rows = await idleFour();
      const oldest = rows[0];
      Object.assign(oldest.session.video, { currentTime: 28.25, muted: false, volume: 0.6 });
      const fifth = clip(5);
      expect(api().canBegin(fifth.owner, 4, 'init')).toBe(true);
      expect(rows.every(({ session }) => !session.closed)).toBe(true);
      expect(oldest.metadata.api.seekTo).not.toHaveBeenCalled();
      const next = api().begin(fifth.owner, 4, 'init');
      expect(next).toBeTruthy();
      expect(rows.filter(({ session }) => session.closed)).toHaveLength(1);
      expect(oldest.metadata.api.seekTo).toHaveBeenCalledWith(28.25);
      expect(oldest.video).toMatchObject({
        currentTime: 28.25,
        playbackRate: 4,
        muted: false,
        volume: 0.6,
        paused: true,
      });
      next.finish();
      await loaded(next);
      expect(document.querySelectorAll('[data-vsc-twitter-mp4]')).toHaveLength(4);
      for (const row of rows) {
        expect(row.video.load).not.toHaveBeenCalled();
        expect(row.play).not.toHaveBeenCalled();
      }
      const revisited = { ...oldest.owner, disposed: false };
      oldest.video.vsc = revisited;
      mediaState(oldest.video).paused = false;
      expect(api().canBegin(revisited, 4, 'init')).toBe(true);
    });

    it.each([
      'playing',
      'visible',
      'owned',
      'native',
      'PiP',
      'pending Play',
      'reload',
      'loading',
      'producer seek',
      'companion seek',
      'identity',
    ])('does not evict a %s companion', async (condition) => {
      const rows = await idleFour();
      for (const { session, metadata } of rows) {
        if (condition === 'playing') {
          mediaState(session.video).paused = false;
        }
        if (condition === 'visible') {
          session.video.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
        }
        if (condition === 'owned') {
          session.video.vsc.iosPlayer.active = true;
        }
        if (condition === 'native') {
          session.video.vsc.iosPlayer.nativeSession = true;
        }
        if (condition === 'PiP') {
          Object.defineProperty(session.video, 'webkitPresentationMode', {
            configurable: true,
            value: 'picture-in-picture',
          });
        }
        if (condition === 'pending Play') {
          nativePlay.mockImplementation(() => new Promise(() => {}));
          session.original.play();
        }
        if (condition === 'reload') {
          session.recovery.reload = {};
        }
        if (condition === 'loading') {
          Object.defineProperty(session.video, 'currentSrc', { configurable: true, value: '' });
        }
        if (condition === 'producer seek' || condition === 'companion seek') {
          const seeking = condition === 'producer seek' ? session.original : session.video;
          seeking.currentTime = 99;
          Object.defineProperty(seeking, 'seeking', { configurable: true, value: true });
        }
        if (condition === 'identity') {
          metadata.current.mockReturnValue(false);
        }
      }
      const fifth = clip(5);
      expect(api().canBegin(fifth.owner, 4, 'init')).toBe(false);
      expect(api().begin(fifth.owner, 4, 'init')).toBeNull();
      expect(rows.every(({ session }) => !session.closed)).toBe(true);
      expect(rows.every(({ metadata }) => !metadata.api.seekTo.mock.calls.length)).toBe(true);
      if (condition === 'producer seek') {
        expect(rows.map(({ video }) => video.currentTime)).toEqual([99, 99, 99, 99]);
      }
    });

    it('keeps the bound when final candidate validation admits another clip reentrantly', async () => {
      const rows = await idleFour(),
        fifth = clip(5),
        sixth = clip(6);
      let nested,
        reads = 0;
      fifth.metadata.current.mockImplementation(() => {
        if (++reads === 2) {
          nested = api().begin(sixth.owner, 4, 'init');
        }
        return true;
      });
      expect(api().begin(fifth.owner, 4, 'init')).toBeNull();
      expect(nested).toBeTruthy();
      expect(rows.filter(({ session }) => !session.closed)).toHaveLength(3);
      expect(rows.filter(({ session }) => !session.closed).length + Number(!nested.closed)).toBe(4);
      expect(api().getPending(fifth.video)).toBeNull();
      expect(fifth.video.load).not.toHaveBeenCalled();
    });

    it.each(['another clip', 'same original'])(
      'releases only the unstarted session when construction admits %s',
      async (kind) => {
        const rows = kind === 'another clip' ? await idleFour() : [];
        rows.pop()?.session.cleanup({ resume: false, reinitialize: false });
        const fifth = clip(5),
          sixth = kind === 'same original' ? fifth : clip(6);
        const cleanup = vi.spyOn(window.VSC.OwnedMP4Recovery.prototype, 'cleanup');
        const clock = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
        let entered = false,
          nested;
        Object.defineProperty(fifth.video, 'currentTime', {
          configurable: true,
          get() {
            if (!entered) {
              entered = true;
              nested = api().begin(sixth.owner, 4, 'init');
            }
            return clock.get.call(this);
          },
          set(value) {
            clock.set.call(this, value);
          },
        });
        expect(api().begin(fifth.owner, 4, 'init')).toBeNull();
        expect(nested).toBeTruthy();
        expect(nested.closed).toBe(false);
        expect(api().getPending(sixth.video)).toBe(nested);
        expect(sixth.video.vsc).toBe(sixth.owner);
        expect(sixth.owner.disposed).not.toBe(true);
        expect(rows.filter(({ session }) => !session.closed).length + 1).toBe(
          kind === 'another clip' ? 4 : 1
        );
        const rejected = cleanup.mock.contexts.find((recovery) => recovery.owner !== nested);
        expect(rejected.owner.closed).toBe(true);
        expect(rejected.listeners).toHaveLength(0);
        expect(rejected.owner.video.isConnected).toBe(false);
        expect(rejected.owner.video.hasAttribute('src')).toBe(false);
        expect(fifth.video.load).not.toHaveBeenCalled();
        expect(fifth.play).not.toHaveBeenCalled();
        nested.finish();
        await loaded(nested);
        expect(nested.committed).toBe(true);
        expect(api().get(nested.video)).toBe(nested);
      }
    );

    it.each(['invalid', 'failed init'])(
      'does not evict for an %s fifth clip',
      async (condition) => {
        const fifth = clip(5);
        if (condition === 'failed init') {
          const failed = api().begin(fifth.owner, 4, 'init');
          failed.abort();
        }
        const rows = await idleFour();
        if (condition === 'invalid') {
          candidates.delete(fifth.video);
        }
        expect(api().canBegin(fifth.owner, 4, 'init')).toBe(false);
        expect(api().begin(fifth.owner, 4, 'init')).toBeNull();
        expect(rows.every(({ session }) => !session.closed)).toBe(true);
      }
    );

    it.each(['source write', 'new Play'])(
      'does not hand back a victim changed by a reentrant %s',
      async (change) => {
        const rows = await idleFour();
        const fifth = clip(5),
          victim = rows[0];
        fifth.metadata.current.mockImplementation(() => {
          if (change === 'source write') {
            const src = victim.video.src;
            victim.video.src = `${src}-new`;
            victim.video.src = src;
          } else {
            mediaState(victim.session.video).paused = false;
          }
          return true;
        });
        expect(api().begin(fifth.owner, 4, 'init')).toBeNull();
        expect(rows.filter(({ session }) => session.closed)).toHaveLength(
          change === 'source write' ? 1 : 0
        );
        expect(rows.every(({ metadata }) => !metadata.api.seekTo.mock.calls.length)).toBe(true);
        expect(fifth.video.load).not.toHaveBeenCalled();
      }
    );

    it('releases queued source invalidation without consuming another idle slot', async () => {
      const rows = await idleFour(),
        stale = rows[0],
        fifth = clip(5);
      const src = stale.video.src;
      stale.video.src = `${src}-new`;
      stale.video.src = src;
      const next = api().begin(fifth.owner, 4, 'init');
      await Promise.resolve();
      expect(next).toBeTruthy();
      expect(stale.session.closed).toBe(true);
      expect(api().isRetained(stale.video)).toBe(false);
      expect(rows.slice(1).every(({ session }) => !session.closed)).toBe(true);
      expect(rows.every(({ metadata }) => !metadata.api.seekTo.mock.calls.length)).toBe(true);
      expect(stale.video.load).not.toHaveBeenCalled();
      expect(stale.play).not.toHaveBeenCalled();
    });
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

  describe('owned MP4 decoded-stall recovery', () => {
    let frames, total, ahead, reloads, session, video;
    async function playing(rate = 4) {
      frames = new Map();
      total = 10;
      ahead = 20;
      reloads = [];
      let id = 0,
        ready = 4,
        current = MP4;
      session = begin(rate);
      video = session.video;
      Object.defineProperties(video, {
        readyState: { configurable: true, get: () => ready },
        currentSrc: { configurable: true, get: () => current },
        duration: { configurable: true, value: 120 },
        videoWidth: { configurable: true, value: 640 },
        videoHeight: { configurable: true, value: 360 },
        buffered: {
          configurable: true,
          get: () => ({
            length: ahead ? 1 : 0,
            start: () => video.currentTime,
            end: () => video.currentTime + ahead,
          }),
        },
      });
      video.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
      video.style.opacity = '1';
      video.getVideoPlaybackQuality = () => ({ totalVideoFrames: total });
      video.requestVideoFrameCallback = (callback) => {
        frames.set(++id, callback);
        return id;
      };
      video.cancelVideoFrameCallback = (key) => frames.delete(key);
      video.load = vi.fn(() => {
        if (video.getAttribute('src') !== MP4) {
          return;
        }
        reloads.push({ source: video.src, time: video.currentTime });
        ready = 0;
        current = '';
        mediaState(video).paused = true;
        video.currentTime = 0;
        video.playbackRate = 1;
        video.dispatchEvent(new Event('emptied'));
        video.dispatchEvent(new Event('loadstart'));
        setTimeout(() => {
          ready = 4;
          current = MP4;
          video.dispatchEvent(new Event('loadeddata'));
          video.dispatchEvent(new Event('playing'));
        }, 1);
      });
      session.finish();
      await loaded(session);
      video.dispatchEvent(new Event('playing'));
      nativePlay.mockClear();
      return session;
    }
    const stall = () => vi.advanceTimersByTimeAsync(3100);
    function ownedPlayer() {
      controller.config.getKeyBinding = () => 1.8;
      const player = new window.VSC.IOSPlayer(video.vsc);
      video.vsc.iosPlayer = player;
      const remove = video.vsc.remove;
      video.vsc.remove = () => {
        player.cleanup();
        remove();
      };
      uiPlayers.push(player);
      player.attach();
      expect(player.openPresentation()).toBe(true);
      return player;
    }

    it.each([2.1, 4])(
      'reloads only the same buffered companion at %s× and preserves playback intent',
      async (rate) => {
        await playing(rate);
        const player = rate === 4 ? ownedPlayer() : null;
        video.currentTime = 18;
        video.muted = false;
        video.volume = 0.6;
        await stall();
        expect(reloads).toEqual([{ source: MP4, time: 18 }]);
        expect(video.currentTime).toBe(18);
        expect(video.playbackRate).toBe(rate);
        expect(video.muted).toBe(false);
        expect(video.volume).toBe(0.6);
        expect(video.paused).toBe(false);
        expect(original.load).not.toHaveBeenCalled();
        expect(original.src).toBe(MSE);
        expect(nativePlay.mock.contexts).toEqual([video]);
        if (player) {
          expect(player.active).toBe(true);
        }
      }
    );

    it.each([
      'buffering',
      'pause',
      'seek',
      'hidden',
      'below threshold',
      'decoded progress',
      'CSS visibility',
      'CSS opacity',
      'CSS checkVisibility',
    ])('does not reload during %s', async (condition) => {
      await playing();
      if (condition === 'buffering') {
        ahead = 0;
      } else if (condition === 'pause') {
        video.pause();
        video.dispatchEvent(new Event('pause'));
      } else if (condition === 'seek') {
        Object.defineProperty(video, 'seeking', { configurable: true, value: true });
        video.dispatchEvent(new Event('seeking'));
      } else if (condition === 'hidden') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (condition === 'below threshold') {
        video.playbackRate = 2;
        video.dispatchEvent(new Event('ratechange'));
      } else if (condition.startsWith('CSS')) {
        if (condition === 'CSS visibility') {
          video.style.visibility = 'hidden';
        } else if (condition === 'CSS opacity') {
          video.style.opacity = '0';
        } else {
          video.checkVisibility = () => false;
        }
      } else {
        total++;
        const callback = frames.values().next().value;
        frames.clear();
        callback?.(performance.now(), {
          mediaTime: video.currentTime + 0.1,
          presentedFrames: total,
        });
      }
      await vi.advanceTimersByTimeAsync(condition === 'decoded progress' ? 2900 : 3100);
      expect(reloads).toHaveLength(0);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('hands back the guarded original after two unsuccessful reloads instead of loading a third time', async () => {
      await playing();
      await stall();
      await stall();
      await stall();
      expect(reloads).toHaveLength(2);
      expect(session.closed).toBe(true);
      expect(originalPlay).toHaveBeenCalledOnce();
      expect(original.load).not.toHaveBeenCalled();
    });

    it('keeps watching after buffering ends without another Playing event', async () => {
      await playing();
      ahead = 0;
      await stall();
      expect(reloads).toHaveLength(0);
      ahead = 20;
      await stall();
      expect(reloads).toHaveLength(1);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('does not let repeated identical frame metadata conceal a decoded stall', async () => {
      await playing();
      for (let sample = 0; sample < 13; sample++) {
        await vi.advanceTimersByTimeAsync(sample === 0 ? 125 : 250);
        if (reloads.length) {
          break;
        }
        const callback = frames.values().next().value;
        frames.clear();
        expect(callback).toBeTypeOf('function');
        callback(performance.now(), { mediaTime: 12.5, presentedFrames: 10 });
      }
      expect(reloads).toHaveLength(1);
      expect(reloads[0].source).toBe(MP4);
      expect(original.load).not.toHaveBeenCalled();
    });

    it('stops monitoring after a page frame API returns an invalid handle without reloading', async () => {
      await playing();
      const callback = frames.values().next().value;
      frames.clear();
      video.requestVideoFrameCallback = vi.fn(() => NaN);
      callback(performance.now(), { mediaTime: 12.5, presentedFrames: 10 });
      await stall();
      expect(video.requestVideoFrameCallback).toHaveBeenCalled();
      expect(reloads).toHaveLength(0);
      expect(frames.size).toBe(0);
      expect(original.load).not.toHaveBeenCalled();
      session.cleanup({ resume: false });
      expectReleased(session);
    });

    it.each(['listener registration', 'next frame request'])(
      'contains a recovery %s exception while keeping base playback usable',
      async (failure) => {
        let removed, registration;
        if (failure === 'listener registration') {
          const Recovery = window.VSC.OwnedMP4Recovery;
          // Production constructs this mock with new, so it must remain constructable.
          // eslint-disable-next-line prefer-arrow-callback
          vi.spyOn(window.VSC, 'OwnedMP4Recovery').mockImplementation(function (owner) {
            const media = owner.video;
            const add = media.addEventListener.bind(media);
            removed = vi.spyOn(media, 'removeEventListener');
            const injected = vi.spyOn(media, 'addEventListener').mockImplementation((...args) => {
              if (args[0] === 'loadstart') {
                throw Error('Page rejected recovery listener');
              }
              registration = args;
              add(...args);
            });
            try {
              return new Recovery(owner);
            } finally {
              injected.mockRestore();
            }
          });
        }
        await playing();
        if (failure === 'listener registration') {
          expect(registration[0]).toBe('emptied');
          expect(removed).toHaveBeenCalledWith(...registration);
        } else {
          const callback = frames.values().next().value;
          frames.clear();
          video.requestVideoFrameCallback = () => {
            throw Error('Page replaced frame API');
          };
          expect(() =>
            callback(performance.now(), { mediaTime: 12.5, presentedFrames: 10 })
          ).not.toThrow();
        }
        await stall();
        expect(reloads).toHaveLength(0);
        expect(frames.size).toBe(0);
        expect(session.closed).toBe(false);
        expect(video.src).toBe(MP4);
        expect(video.paused).toBe(false);
        expect(original.load).not.toHaveBeenCalled();
        session.cleanup({ resume: false });
        expectReleased(session);
      }
    );

    it.each(['reject', 'timeout', 'second seek', 'different seek'])(
      'handles a queued own-seek before recovery %s without confusing newer seek intent',
      async (outcome) => {
        await playing();
        let reject;
        nativePlay.mockImplementationOnce(function () {
          mediaState(this).paused = false;
          return new Promise((_resolve, fail) => {
            reject = fail;
          });
        });
        const load = video.load.getMockImplementation();
        video.load.mockImplementationOnce(() => {
          load();
          setTimeout(() => {
            Object.defineProperty(video, 'seeking', { configurable: true, value: true });
            video.dispatchEvent(new Event('seeking'));
            Object.defineProperty(video, 'seeking', { configurable: true, value: false });
            video.dispatchEvent(new Event('seeked'));
          }, 0);
        });
        await stall();
        if (outcome.includes('seek')) {
          if (outcome === 'different seek') {
            video.currentTime += 1;
          }
          video.dispatchEvent(new Event('seeking'));
        }
        if (outcome === 'timeout') {
          await vi.advanceTimersByTimeAsync(10000);
        } else {
          reject(new DOMException('Interrupted', 'AbortError'));
          await Promise.resolve();
        }
        expect(original.load).not.toHaveBeenCalled();
        expect(originalPlay.mock.calls.length).toBe(outcome.includes('seek') ? 0 : 1);
        expect(session.closed).toBe(!outcome.includes('seek'));
      }
    );

    it.each(['close', 'reopen'])(
      'rearms ready playback after UI %s invalidates a pending recovery',
      async (change) => {
        await playing();
        const player = ownedPlayer();
        let resolve;
        nativePlay.mockImplementationOnce(function () {
          mediaState(this).paused = false;
          return new Promise((done) => {
            resolve = done;
          });
        });
        await stall();
        player.close();
        if (change === 'reopen') {
          expect(player.openPresentation()).toBe(true);
        }
        resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
        expect(video.readyState).toBe(4);
        expect(video.paused).toBe(false);
        expect(frames.size).toBe(1);
        expect(nativePlay).toHaveBeenCalledOnce();
        video.pause();
        video.dispatchEvent(new Event('pause'));
        expect(frames.size).toBe(0);
        expect(originalPlay).not.toHaveBeenCalled();
      }
    );

    it('does not Play after a synchronous reload callback replaces the producer source', async () => {
      await playing();
      video.load.mockImplementationOnce(() => {
        reloads.push({ source: video.src });
        original.src = 'blob:https://x.com/new-item';
        video.dispatchEvent(new Event('loadstart'));
      });
      await stall();
      expect(reloads).toHaveLength(1);
      expect(nativePlay).not.toHaveBeenCalled();
      expect(originalPlay).not.toHaveBeenCalled();
      expect(original.load).not.toHaveBeenCalled();
    });

    it.each(['load throws', 'Play rejects'])(
      'hands back the guarded original when recovery %s',
      async (failure) => {
        await playing();
        if (failure === 'load throws') {
          video.load.mockImplementationOnce(() => {
            throw Error('Load refused');
          });
        } else {
          nativePlay.mockRejectedValueOnce(new DOMException('Play refused', 'NotAllowedError'));
        }
        await stall();
        expect(session.closed).toBe(true);
        expect(originalPlay).toHaveBeenCalledOnce();
        expect(original.load).not.toHaveBeenCalled();
        expect(original.src).toBe(MSE);
      }
    );

    it.each(['pause', 'new speed', 'same speed', 'cleanup'])(
      'ignores stale recovery Play settlement after %s',
      async (cancel) => {
        await playing();
        let resolve, reject;
        nativePlay.mockImplementationOnce(function () {
          mediaState(this).paused = false;
          return new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          });
        });
        await stall();
        expect(reloads).toHaveLength(1);
        if (cancel === 'pause') {
          video.pause();
          video.dispatchEvent(new Event('pause'));
        } else if (cancel.endsWith('speed')) {
          controller.config.save = vi.fn();
          new window.VSC.ActionHandler(controller.config, null).setSpeed(
            video,
            cancel === 'same speed' ? 4 : 3,
            'user'
          );
        } else {
          session.cleanup({ resume: false });
        }
        if (cancel === 'pause') {
          reject(new DOMException('Paused', 'AbortError'));
        } else {
          resolve();
        }
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
        expect(reloads).toHaveLength(1);
        expect(originalPlay).not.toHaveBeenCalled();
        if (cancel === 'new speed') {
          expect(video.playbackRate).toBe(3);
        }
        if (!cancel.endsWith('speed')) {
          expect(video.paused).toBe(true);
        }
      }
    );
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

  it('resumes the retained producer when SDK handback seeking drops readiness and vetoes new takeover', async () => {
    const session = await commit();
    candidate.api.seekTo.mockImplementation((time) => {
      original.currentTime = time;
      Object.defineProperty(original, 'readyState', { configurable: true, value: 1 });
      candidate.current.mockReturnValue(false);
    });
    session.video.currentTime = 18;
    session.cleanup();
    expect(candidate.api.seekTo).toHaveBeenCalledExactlyOnceWith(18);
    expect(candidate.current()).toBe(false);
    expect(candidate.identityCurrent()).toBe(true);
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(window.VSC_controller.onVideoFound).toHaveBeenCalledOnce();
    expect(original.src).toBe(MSE);
    expect(original.load).not.toHaveBeenCalled();
    expectReleased(session);
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

/** Real HLS ownership through a same-MP4 decoder reload, without a blob load. */
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { installChromeMock, cleanupChromeMock } from '../../helpers/chrome-mock.js';

describe('owned X MP4 playback recovery', () => {
  const HLS = 'https://video.twimg.com/amplify_video/123/pl/current.m3u8';
  const MP4 = 'https://video.twimg.com/amplify_video/123/vid/1280x720/current.mp4';
  let dom, video, controller, config, manager, action, selected, visible, session, order;
  const event = (type) => video.dispatchEvent(new Event(type));
  const flush = async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
  };

  beforeEach(async () => {
    installChromeMock();
    visible = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
    vi.spyOn(document, 'URL', 'get').mockReturnValue('https://x.com/example/status/123');
    vi.spyOn(window.VSC.SafariHLSPlayback, 'matches').mockReturnValue(true);
    dom = createMockDOM();
    dom.container.dataset.testid = 'videoComponent';
    selected = {
      id: 0,
      contentType: 'media_entity',
      hasCaptions: false,
      durationMs: 45000,
      variants: [
        { src: HLS, type: 'application/x-mpegURL' },
        { src: MP4, type: 'video/mp4' },
      ],
      currentVariantIndex: 0,
    };
    dom.container.__reactProps$recovery = {
      children: [
        null,
        {
          props: {
            playerState: {
              source: { type: 'tweet', trackId: 0 },
              currentTrackId: 0,
              hasCaptions: false,
              tracks: [selected],
            },
          },
        },
      ],
    };
    video = createMockVideo({
      currentSrc: HLS,
      readyState: 4,
      paused: false,
      duration: 45,
      currentTime: 9,
      playbackRate: 1,
      muted: false,
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
    video.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 320,
      bottom: 180,
      width: 320,
      height: 180,
    });
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });
    Object.defineProperty(video, 'textTracks', { configurable: true, value: [] });
    order = [];
    let nativeRate = video.playbackRate;
    Object.defineProperty(video, 'playbackRate', {
      configurable: true,
      get: () => nativeRate,
      set: (value) => {
        nativeRate = value;
        order.push(['rate', value]);
      },
    });
    const media = video;
    const loadEvent = (type) => media.dispatchEvent(new Event(type));
    media.load = vi.fn(() => {
      order.push('load');
      media.currentSrc = '';
      media.readyState = 0;
      media.duration = NaN;
      media.currentTime = 0;
      media.playbackRate = 1;
      media.paused = true;
      loadEvent('emptied');
      loadEvent('loadstart');
      setTimeout(() => {
        media.currentSrc = media.src;
        media.readyState = 4;
        media.duration = 45;
        loadEvent('loadedmetadata');
        loadEvent('loadeddata');
      }, 0);
    });
    media.play = vi.fn(() => {
      order.push('play');
      media.paused = false;
      loadEvent('play');
      return Promise.resolve();
    });
    media.pause = vi.fn(() => {
      media.paused = true;
      loadEvent('pause');
    });
    dom.container.append(video);
    config = new window.VSC.VideoSpeedConfig();
    await config.load();
    vi.useFakeTimers();
    config.settings.lastSpeed = 1;
    config.settings.rememberSpeed = false;
    vi.spyOn(config, 'save');
    manager = new window.VSC.EventManager(config, null);
    action = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = action;
    controller = new window.VSC.VideoController(video, null, config, action);
    controller.iosPlayer = {
      active: false,
      nativeSession: false,
      session: 3,
      ui: undefined,
      cleanup: vi.fn(),
      restoreSitePlayer: vi.fn(),
    };
    action.setSpeed(video, 4, 'user');
    await flush();
    action.setSpeed(video, 4, 'user');
    session = controller.safariPlayback;
    expect(session).toBeTruthy();
    expect(session.pending).toBe(false);
    expect(video.currentSrc).toBe(MP4);
    video.currentTime = 12;
    video.muted = false;
    video.volume = 0.6;
    video.load.mockClear();
    video.play.mockClear();
    config.save.mockClear();
    order.length = 0;
    expect({
      rate: video.playbackRate,
      paused: video.paused,
      ready: video.readyState,
      valid: session.candidate.revalidate(),
      identity: window.VSC.TwitterPlaybackRecovery.identity(controller) === session,
    }).toEqual({ rate: 4, paused: false, ready: 4, valid: true, identity: true });
  });
  afterEach(() => {
    window.VSC.TwitterPlaybackRecovery.cancel(controller);
    session?.cleanup({ restore: false });
    controller.remove();
    manager.cleanup();
    dom.cleanup();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    cleanupChromeMock();
  });

  it('keeps exact adapter identity and authority through native ready0/NaN reset and asynchronous events', async () => {
    const local = manager.getMediaRateState(video),
      player = controller.iosPlayer;
    expect(window.VSC.TwitterPlaybackRecovery.identity(controller)).toBe(session);
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
    expect(video.readyState).toBe(0);
    expect(Number.isNaN(video.duration)).toBe(true);
    expect(window.VSC.TwitterPlaybackRecovery.identity(controller)).toBe(session);
    expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller, 'emptied')).toBe(true);
    expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller, 'loadstart')).toBe(true);
    expect(manager.getMediaRateState(video)).toBe(local);
    expect(video.currentTime).toBe(12);
    expect(video.playbackRate).toBe(4);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.6);
    expect(controller.iosPlayer).toBe(player);
    expect(order.filter((v) => typeof v === 'string')).toEqual(['load', 'play']);
    await flush();
    expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller)).toBe(false);
    expect(window.VSC.TwitterPlaybackRecovery.identity(controller)).toBe(session);
    expect(video.src).toBe(MP4);
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
    expect(config.save).not.toHaveBeenCalled();
  });
  it('does not reload after captions become unknown or protected', () => {
    selected.hasCaptions = undefined;
    expect(window.VSC.TwitterPlaybackRecovery.identity(controller) === null).toBe(true);
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
  });
  it('retains the modern SDK veto during a legacy-owned MP4 recovery', () => {
    const veto = vi.spyOn(window.VSC.TwitterPlayer, 'validateRetainedHls').mockReturnValue(false);
    try {
      expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(false);
      expect(video.load).not.toHaveBeenCalled();
    } finally {
      veto.mockRestore();
    }
  });
  it('rejects a second source load instead of extending the expected cycle', () => {
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
    event('loadstart');
    expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller)).toBe(false);
    expect(session.closed).toBe(true);
  });
  it('hands back rejected audible playback without muting or retrying', async () => {
    video.play.mockImplementationOnce(() => {
      video.paused = true;
      return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    });
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
    await flush();
    expect(controller.iosPlayer.restoreSitePlayer).toHaveBeenCalledOnce();
    expect(session.closed).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    expect(window.VSC.TwitterPlaybackRecovery.identity(controller) === null).toBe(true);
  });
  it.each(['pause', 'seek', 'hidden', 'source', 'command', 'removal'])(
    'cancels %s while Play is pending without late continuation',
    async (cause) => {
      let resolve;
      video.play.mockImplementationOnce(() => {
        video.paused = false;
        return new Promise((r) => {
          resolve = r;
        });
      });
      expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
      if (cause === 'pause') {
        video.paused = true;
        event('pause');
      } else if (cause === 'seek') {
        video.currentTime = 30;
        event('seeking');
      } else if (cause === 'hidden') {
        visible = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (cause === 'source') {
        video.src = 'https://example.com/replacement.mp4';
        await Promise.resolve();
      } else if (cause === 'command') {
        window.VSC.TwitterPlaybackRecovery.cancel(controller);
      } else {
        controller.remove();
      }
      expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller)).toBe(false);
      const calls = video.play.mock.calls.length;
      resolve();
      await flush();
      expect(video.play).toHaveBeenCalledTimes(calls);
      if (cause === 'pause') {
        expect(video.paused).toBe(true);
      }
      if (cause === 'seek') {
        expect(video.currentTime).toBe(30);
      }
      if (cause === 'source') {
        expect(video.src).toBe('https://example.com/replacement.mp4');
      }
    }
  );
  it('releases the token even when observer cleanup throws', () => {
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
    const spy = vi.spyOn(MutationObserver.prototype, 'disconnect').mockImplementation(() => {
      throw new Error('Page replaced observer');
    });
    window.VSC.TwitterPlaybackRecovery.cancel(controller);
    expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller)).toBe(false);
    spy.mockRestore();
  });
  it('preserves the token when native load events arrive after the synchronous Play command', async () => {
    const seen = [];
    const inspect = (event) =>
      seen.push([
        event.type,
        window.VSC.TwitterPlaybackRecovery.ownsTransition(controller, event.type),
      ]);
    video.addEventListener('emptied', inspect);
    video.addEventListener('loadstart', inspect);
    const media = video;
    video.load.mockImplementationOnce(() => {
      media.currentSrc = '';
      media.readyState = 0;
      media.duration = NaN;
      media.currentTime = 0;
      media.playbackRate = 1;
      media.paused = true;
      setTimeout(() => {
        media.dispatchEvent(new Event('emptied'));
        media.dispatchEvent(new Event('loadstart'));
        media.currentSrc = media.src;
        media.readyState = 4;
        media.duration = 45;
        media.dispatchEvent(new Event('loadeddata'));
      }, 0);
    });
    try {
      expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
      expect(video.readyState).toBe(0);
      expect(window.VSC.TwitterPlaybackRecovery.identity(controller)).toBe(session);
      expect(seen).toEqual([]);
      await flush();
      expect(seen).toEqual([
        ['emptied', true],
        ['loadstart', true],
      ]);
      expect(window.VSC.TwitterPlaybackRecovery.identity(controller)).toBe(session);
      expect(video.currentTime).toBe(12);
      expect(video.playbackRate).toBe(4);
      expect(video.muted).toBe(false);
      expect(video.volume).toBe(0.6);
      expect(video.play).toHaveBeenCalledOnce();
    } finally {
      video.removeEventListener('emptied', inspect);
      video.removeEventListener('loadstart', inspect);
    }
  });

  it.each(['poster', 'pause', 'rate', 'presentation'])(
    'rechecks %s intent after a page-owned capability read before Play',
    (reason) => {
      const original = session.recoveryCurrent.bind(session);
      let changed = false;
      const probe = vi.spyOn(session, 'recoveryCurrent').mockImplementation((currentController) => {
        const accepted = original(currentController);
        if (!changed && video.readyState === 0 && video.playbackRate === 4) {
          changed = true;
          if (reason === 'poster') {
            video.setAttribute('poster', 'https://example.com/new.jpg');
            video.removeAttribute('poster');
          } else if (reason === 'pause') {
            video.pause();
          } else if (reason === 'rate') {
            video.playbackRate = 2;
          } else {
            controller.iosPlayer.session++;
          }
        }
        return accepted;
      });
      try {
        expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(false);
        expect(changed).toBe(true);
        expect(video.play).not.toHaveBeenCalled();
        expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller)).toBe(false);
        if (reason === 'rate') {
          expect(video.playbackRate).toBe(2);
        }
      } finally {
        probe.mockRestore();
      }
    }
  );

  it('reports and clears only its owned inline and presentation warning', () => {
    const inline = document.createElement('span'),
      owned = document.createElement('span');
    controller.controlsManager.inlinePlayer = { refs: { status: inline } };
    controller.iosPlayer.ui = { refs: { status: owned } };
    window.VSC.TwitterPlaybackRecovery.reportStall(controller);
    expect(inline.textContent).toBe('Playback is still stalled. Try the site player.');
    expect(owned.textContent).toBe(inline.textContent);
    owned.textContent = 'A newer playback error';
    window.VSC.TwitterPlaybackRecovery.clearStall(controller);
    expect(inline.textContent).toBe('');
    expect(owned.textContent).toBe('A newer playback error');
    controller.controlsManager.inlinePlayer = null;
  });
  it('rejects an in-place replacement of the bound legacy track ID', () => {
    const state = dom.container.__reactProps$recovery.children[1].props.playerState;
    selected.id = 1;
    state.currentTrackId = 1;
    state.source.trackId = 1;
    expect(window.VSC.TwitterPlaybackRecovery.identity(controller) === null).toBe(true);
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
  });
  it('releases recovery even when an owned warning surface becomes inaccessible', () => {
    expect(window.VSC.TwitterPlaybackRecovery.reload(controller)).toBe(true);
    controller.controlsManager.inlinePlayer = {
      get refs() {
        throw new Error('Unavailable');
      },
    };
    expect(() => window.VSC.TwitterPlaybackRecovery.cancel(controller)).not.toThrow();
    expect(window.VSC.TwitterPlaybackRecovery.ownsTransition(controller)).toBe(false);
    controller.controlsManager.inlinePlayer = null;
  });
  it.each(['refs', 'read', 'write'])(
    'finishes real HLS cleanup despite a throwing warning %s',
    (failure) => {
      const inline = controller.controlsManager.inlinePlayer;
      const status = document.createElement('span');
      status.textContent = 'Playback is still stalled. Try the site player.';
      const bad = {};
      Object.defineProperty(bad, 'textContent', {
        get() {
          if (failure === 'read') {
            throw new Error('Discarded text');
          }
          return 'Playback is still stalled. Try the site player.';
        },
        set() {
          throw new Error('Discarded text');
        },
      });
      controller.controlsManager.inlinePlayer =
        failure === 'refs'
          ? {
              get refs() {
                throw new Error('Discarded refs');
              },
            }
          : { refs: { status: bad } };
      controller.iosPlayer.ui = { refs: { status } };
      const disconnect = vi.spyOn(session.observer, 'disconnect');
      try {
        expect(() => session.cleanup()).not.toThrow();
        expect(session.closed).toBe(true);
        expect(session.listeners).toHaveLength(0);
        expect(session.deadline).toBeNull();
        expect(disconnect).toHaveBeenCalled();
        expect(controller.safariPlayback).toBeNull();
        expect(video.src).toBe(HLS);
        expect(video.load).toHaveBeenCalledOnce();
        expect(status.textContent).toBe('');
      } finally {
        controller.controlsManager.inlinePlayer = inline;
      }
    }
  );

  it.each(['refs', 'read', 'write'])(
    'reports on the remaining surface when warning %s is inaccessible',
    (failure) => {
      const inline = controller.controlsManager.inlinePlayer;
      const status = document.createElement('span');
      const bad = {};
      Object.defineProperty(bad, 'textContent', {
        get() {
          if (failure === 'read') {
            throw new Error('Discarded text');
          }
          return '';
        },
        set() {
          throw new Error('Discarded text');
        },
      });
      controller.controlsManager.inlinePlayer =
        failure === 'refs'
          ? {
              get refs() {
                throw new Error('Discarded refs');
              },
            }
          : { refs: { status: bad } };
      controller.iosPlayer.ui = { refs: { status } };
      try {
        expect(() => window.VSC.TwitterPlaybackRecovery.reportStall(controller)).not.toThrow();
        expect(status.textContent).toBe('Playback is still stalled. Try the site player.');
        expect(() => window.VSC.TwitterPlaybackRecovery.clearStall(controller)).not.toThrow();
        expect(status.textContent).toBe('');
      } finally {
        controller.controlsManager.inlinePlayer = inline;
      }
    }
  );
});

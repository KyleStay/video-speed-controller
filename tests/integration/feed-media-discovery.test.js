describe('feed media discovery before idle mutation processing', () => {
  let extension;
  let observer;
  let feed;
  let config;
  let media;

  beforeEach(() => {
    // Keep the mutation queue pending, as on a busy infinite-scroll feed.
    vi.spyOn(window, 'requestIdleCallback').mockReturnValue(77);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.spyOn(window.VSC.EventManager, 'isTwitterHost').mockReturnValue(true);
    config = {
      settings: {
        ...window.VSC.Constants.DEFAULT_SETTINGS,
        lastSpeed: null,
        audioBoolean: false,
      },
      getKeyBinding: vi.fn(),
      save: vi.fn(),
    };
    extension = new window.VSC_controller.constructor();
    extension.logger = window.VSC.logger;
    extension.config = config;
    extension.VideoController = window.VSC.VideoController;
    extension.eventManager = new window.VSC.EventManager(config, null);
    extension.actionHandler = new window.VSC.ActionHandler(config, extension.eventManager);
    extension.eventManager.actionHandler = extension.actionHandler;
    extension.mediaObserver = new window.VSC.MediaElementObserver(
      config,
      window.VSC.siteHandlerManager
    );
    observer = new window.VSC.VideoMutationObserver(
      config,
      extension.onVideoFound.bind(extension),
      extension.onVideoRemoved.bind(extension),
      extension.mediaObserver
    );
    extension.mutationObserver = observer;
    feed = document.createElement('main');
    media = [];
    document.body.append(feed);
    observer.start(document);
  });

  afterEach(() => {
    observer.stop();
    for (const video of media) {
      extension.onVideoRemoved(video);
    }
    extension.eventManager.cleanup();
    feed.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function addVideo(readyState = 2) {
    const post = document.createElement('article');
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: readyState, configurable: true });
    post.append(video);
    feed.append(post);
    media.push(video);
    return video;
  }

  it.each(['loadeddata', 'canplay', 'play'])(
    'attaches later feed videos on %s and applies the same shortcut with older media present',
    async (eventType) => {
      const first = addVideo();
      extension.onVideoFound(first, first.parentElement);
      const later = addVideo();
      await Promise.resolve();
      expect(observer.pendingMutations.length).toBeGreaterThan(0);
      expect(later.vsc).toBeUndefined();

      later.dispatchEvent(new Event(eventType));
      expect(later.vsc?.div.isConnected).toBe(true);
      const key = new KeyboardEvent('keydown', { key: 'd', code: 'KeyD' });
      document.body.dispatchEvent(key);
      // Use the real keyboard handler without the singleton's global listeners.
      extension.eventManager.handleKeydown(key);
      expect(later.playbackRate).toBeGreaterThan(1);
      expect(first.playbackRate).toBe(later.playbackRate);
      const controller = later.vsc;
      observer.processMutations(observer.pendingMutations);
      expect(later.vsc).toBe(controller);
    }
  );

  it('discovers shadow media once and removes readiness listeners when its host leaves', () => {
    const host = document.createElement('div');
    feed.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 2 });
    root.append(video);
    media.push(video);
    const found = vi.spyOn(observer, 'onVideoFound');
    video.dispatchEvent(new Event('loadeddata', { composed: true }));
    expect(video.vsc?.div.isConnected).toBe(true);
    expect(found).toHaveBeenCalledOnce();

    const removeListener = vi.spyOn(root, 'removeEventListener');
    host.remove();
    observer.pruneDetachedShadowObservers();
    for (const type of ['loadeddata', 'canplay', 'play']) {
      expect(removeListener).toHaveBeenCalledWith(type, observer.mediaReadyHandler, true);
    }
  });

  it('keeps audio opt-in and skips readiness events on non-media elements', () => {
    const audio = document.createElement('audio');
    Object.defineProperty(audio, 'readyState', { value: 2 });
    feed.append(audio);
    media.push(audio);
    const found = vi.spyOn(observer, 'onVideoFound');
    feed.dispatchEvent(new Event('play'));
    audio.dispatchEvent(new Event('loadeddata'));
    expect(found).not.toHaveBeenCalled();
    config.settings.audioBoolean = true;
    audio.dispatchEvent(new Event('loadeddata'));
    expect(audio.vsc?.div.isConnected).toBe(true);
    expect(found).toHaveBeenCalledOnce();
  });

  it('clears a pending attachment once when media becomes ready', () => {
    const video = addVideo(0);
    extension.onVideoFound(video, video.parentElement);
    expect(extension.pendingVideoElements.has(video)).toBe(true);
    Object.defineProperty(video, 'readyState', { value: 2 });
    video.dispatchEvent(new Event('loadeddata'));
    expect(video.vsc?.div.isConnected).toBe(true);
    expect(extension.pendingVideoElements.has(video)).toBe(false);
    const controller = video.vsc;
    video.dispatchEvent(new Event('canplay'));
    expect(video.vsc).toBe(controller);
  });

  it('does not attach an unready placeholder or media after stop', () => {
    const unready = addVideo(0);
    unready.dispatchEvent(new Event('play'));
    expect(unready.vsc).toBeUndefined();
    expect(extension.pendingVideoElements.has(unready)).toBe(false);
    observer.stop();
    const later = addVideo();
    later.dispatchEvent(new Event('loadeddata'));
    expect(later.vsc).toBeUndefined();
  });

  it('preserves deferred insertion on YouTube and other non-feed sites', () => {
    observer.stop();
    window.VSC.EventManager.isTwitterHost.mockReturnValue(false);
    observer.start(document);
    const video = addVideo();
    const siteHandler = vi.fn(() => {
      // The site may restructure its player during loadeddata. VSC must not
      // insert a controller before that target listener finishes.
      expect(video.vsc).toBeUndefined();
      const container = document.createElement('div');
      video.parentElement.append(container);
      container.append(video);
    });
    video.addEventListener('loadeddata', siteHandler);
    video.dispatchEvent(new Event('loadeddata'));
    expect(siteHandler).toHaveBeenCalledOnce();
    observer.processMutations([
      { type: 'childList', target: feed, addedNodes: [video.parentElement], removedNodes: [] },
    ]);
    expect(video.vsc?.div.isConnected).toBe(true);
    expect(video.vsc.parent).toBe(video.parentElement);
  });
});

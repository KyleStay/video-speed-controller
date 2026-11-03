import '../../../src/site-handlers/twitter-player.js';

describe('TwitterPlayer current MSE identity', () => {
  const contentId = '2041611432752742400';
  const postId = '2041611432752742401';
  const sourceUrl = `https://video.twimg.com/amplify_video/${contentId}/pl/current.m3u8?tag=21`;
  const mp4 = (size) =>
    `https://video.twimg.com/amplify_video/${contentId}/vid/avc1/${size}/current.mp4?tag=21`;
  const blob = 'blob:https://x.com/11111111-2222-4333-8444-555555555555';
  let video, parent, content, state, sdk, api, store, props, modern, fiber, hooks;
  const property = (object, key, value) =>
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
  const resolve = (originParent) => window.VSC.TwitterPlayer.resolve(video, originParent);

  beforeEach(() => {
    document.body.replaceChildren();
    vi.spyOn(document, 'URL', 'get').mockReturnValue(
      'https://x.com/example/status/2041611432752742401'
    );
    parent = document.createElement('div');
    video = document.createElement('video');
    parent.append(video);
    document.body.append(parent);
    video.src = blob;
    property(video, 'currentSrc', blob);
    property(video, 'readyState', 4);
    property(video, 'duration', 20.456);
    property(video, 'currentTime', 2);
    content = {
      contentId,
      contentType: 'video',
      sourceType: 'tweet',
      sourceId: postId,
      tweetId: postId,
      durationMs: 20400,
      mediaAssetUrl: sourceUrl,
      unavailability: undefined,
    };
    state = {
      content,
      source: { kind: 'hls', src: sourceUrl, playlistDurationSec: 20.4 },
      session: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      textTracks: { tracks: [], preferredLanguage: 'en', captionInsets: {} },
      playback: { shouldLoop: true },
      media: { volume: 0.5, muted: true, paused: false },
    };
    api = { getMediaElement: vi.fn(() => video), getState: vi.fn(() => state), seekTo: vi.fn() };
    store = { getSnapshot: vi.fn(() => state), subscribe: vi.fn(() => vi.fn()) };
    sdk = { controller: { api }, element: video, store, src: sourceUrl };
    props = {
      content,
      hostKey: `${postId}:${contentId}`,
      src: sourceUrl,
      preroll: undefined,
      loop: true,
    };
    modern = {
      downloadUrl: mp4('1920x1080'),
      poppedOutSource: {
        hostKey: props.hostKey,
        playerProps: { content, src: sourceUrl, downloadUrl: mp4('1920x1080') },
      },
      timeRemainingAccessory: {
        props: {
          media: {
            id_str: contentId,
            video_download_url: mp4('1920x1080'),
            video_info: {
              duration_millis: 20400,
              variants: [
                { content_type: 'application/x-mpegURL', url: sourceUrl },
                { content_type: 'video/mp4', url: mp4('640x360'), bitrate: 500 },
                { content_type: 'video/mp4', url: mp4('1280x720'), bitrate: 1000 },
                { content_type: 'video/mp4', url: mp4('1920x1080'), bitrate: 2000 },
              ],
            },
          },
        },
      },
    };
    hooks = Array.from({ length: 12 }, () => ({ memoizedState: null, next: null }));
    hooks.forEach((hook, index) => {
      hook.next = hooks[index + 1] || null;
    });
    hooks[11].memoizedState = sdk;
    fiber = {
      memoizedState: hooks[0],
      memoizedProps: props,
      return: { memoizedState: null, memoizedProps: modern, return: null },
    };
    property(parent, '__reactFiber$fixture', fiber);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('recognizes the observed hook/schema and prefers a supplied 720p MP4 without touching playback', () => {
    const load = vi.spyOn(video, 'load');
    const play = vi.spyOn(video, 'play');
    const pause = vi.spyOn(video, 'pause');
    const candidate = resolve();
    expect(candidate).toMatchObject({
      originalUrl: blob,
      progressiveUrl: mp4('1280x720'),
      sourceUrl,
      contentId,
      sessionId: state.session.id,
      sdk,
      api,
      store,
      loop: true,
    });
    expect(candidate.current()).toBe(true);
    expect(video.src).toBe(blob);
    expect(video.currentSrc).toBe(blob);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  describe('creator unlimited-loop certificate', () => {
    it.each(['missing', 'inherited', 'accessor', 'false', 'string', 'number', 'ancestor'])(
      'leaves a finite producer untouched when creator loop is %s',
      (kind) => {
        Object.assign(content, {
          forceLoop: true,
          maxLoopCount: 2,
          maxLoopingThresholdSeconds: 10,
        });
        // Native loop and current SDK eligibility cannot override a finite creator policy.
        video.loop = true;
        const getter = vi.fn(() => true);
        delete props.loop;
        if (kind === 'inherited') {
          Object.setPrototypeOf(props, { loop: true });
        }
        if (kind === 'accessor') {
          Object.defineProperty(props, 'loop', { configurable: true, get: getter });
        }
        if (kind === 'false') {
          props.loop = false;
        }
        if (kind === 'string') {
          props.loop = 'true';
        }
        if (kind === 'number') {
          props.loop = 1;
        }
        if (kind === 'ancestor') {
          modern.loop = true;
        }
        const play = vi.spyOn(video, 'play'),
          pause = vi.spyOn(video, 'pause'),
          load = vi.spyOn(video, 'load');
        expect(state.playback.shouldLoop).toBe(true);
        expect(resolve()).toBeNull();
        expect(getter).not.toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
        expect(pause).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
        expect(api.seekTo).not.toHaveBeenCalled();
        expect(video).toMatchObject({ src: blob, currentTime: 2, loop: true });
      }
    );

    it('retains the exact creator override even when content declares finite bounds', () => {
      Object.assign(content, { forceLoop: true, maxLoopCount: 2, maxLoopingThresholdSeconds: 10 });
      video.loop = false;
      const candidate = resolve();
      expect(candidate?.loop).toBe(true);
      expect(candidate.current()).toBe(true);
      expect(video.loop).toBe(false);
      expect(api.seekTo).not.toHaveBeenCalled();
    });

    it.each(['missing', 'false', 'inherited', 'accessor', 'replaced props'])(
      'revokes loop takeover after the exact creator certificate becomes %s',
      (change) => {
        content.maxLoopCount = 2;
        const candidate = resolve();
        expect(candidate?.current()).toBe(true);
        const getter = vi.fn(() => true);
        if (change === 'replaced props') {
          const next = { ...props };
          delete next.loop;
          fiber.memoizedProps = next;
        } else {
          delete props.loop;
          if (change === 'false') {
            props.loop = false;
          }
          if (change === 'inherited') {
            Object.setPrototypeOf(props, { loop: true });
          }
          if (change === 'accessor') {
            Object.defineProperty(props, 'loop', { configurable: true, get: getter });
          }
        }
        expect(candidate.current()).toBe(false);
        expect(candidate.identityCurrent()).toBe(true);
        expect(getter).not.toHaveBeenCalled();
        expect(video.src).toBe(blob);
      }
    );

    it.each(['absent', 'null', 'undefined', 'mixed'])(
      'accepts explicit %s limits on both exact contents without a creator override',
      (kind) => {
        delete props.loop;
        content.forceLoop = true;
        state.content = { ...content };
        for (const object of [content, state.content]) {
          if (kind === 'null') {
            Object.assign(object, { maxLoopCount: null, maxLoopingThresholdSeconds: null });
          }
          if (kind === 'undefined') {
            Object.assign(object, {
              maxLoopCount: undefined,
              maxLoopingThresholdSeconds: undefined,
            });
          }
          if (kind === 'mixed') {
            Object.assign(object, { maxLoopCount: undefined, maxLoopingThresholdSeconds: null });
          }
        }
        const candidate = resolve();
        expect(candidate?.loop).toBe(true);
        expect(candidate.current()).toBe(true);
        expect(video.src).toBe(blob);
      }
    );

    it('retains the conservative veto for a creator loop accessor even with absent limits', () => {
      const getter = vi.fn(() => {
        throw new Error('No override needed');
      });
      Object.defineProperty(props, 'loop', { configurable: true, get: getter });
      expect(resolve()).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    });

    it('keeps the explicit creator override authoritative without reading limit accessors', () => {
      const getter = vi.fn(() => {
        throw new Error('Creator override bypasses limits');
      });
      Object.defineProperty(content, 'maxLoopCount', { configurable: true, get: getter });
      expect(resolve()?.current()).toBe(true);
      expect(getter).not.toHaveBeenCalled();
    });

    describe.each(['creator', 'selected'])('%s content limits', (which) => {
      const target = () => (which === 'creator' ? content : state.content);
      beforeEach(() => {
        delete props.loop;
        content.forceLoop = true;
        state.content = { ...content };
      });

      it.each(['maxLoopCount', 'maxLoopingThresholdSeconds'])(
        'vetoes a finite %s even when the other exact content is unlimited',
        (key) => {
          target()[key] = 2;
          const play = vi.spyOn(video, 'play'),
            pause = vi.spyOn(video, 'pause'),
            load = vi.spyOn(video, 'load');
          expect(resolve()).toBeNull();
          expect(play).not.toHaveBeenCalled();
          expect(pause).not.toHaveBeenCalled();
          expect(load).not.toHaveBeenCalled();
          expect(video.src).toBe(blob);
        }
      );

      it.each([0, NaN, Infinity, '2', false])('vetoes non-null count limit %s', (value) => {
        target().maxLoopCount = value;
        expect(resolve()).toBeNull();
      });

      it.each([
        'inherited null',
        'inherited undefined',
        'inherited finite',
        'inherited accessor',
        'own accessor',
      ])('does not treat %s as an absent limit', (kind) => {
        const getter = vi.fn(() => null),
          object = target();
        const inherited = kind.startsWith('inherited');
        const owner = inherited ? {} : object;
        if (kind.includes('accessor')) {
          Object.defineProperty(owner, 'maxLoopingThresholdSeconds', {
            configurable: true,
            get: getter,
          });
        } else {
          owner.maxLoopingThresholdSeconds =
            kind === 'inherited null' ? null : kind === 'inherited finite' ? 2 : undefined;
        }
        if (inherited) {
          Object.setPrototypeOf(object, owner);
        }
        expect(resolve()).toBeNull();
        expect(getter).not.toHaveBeenCalled();
      });

      it.each(['finite', 'accessor', 'inherited undefined'])(
        'revokes an existing no-limit certificate after %s limit drift',
        (kind) => {
          const candidate = resolve();
          expect(candidate?.current()).toBe(true);
          const getter = vi.fn(() => null);
          if (kind === 'finite') {
            target().maxLoopCount = 2;
          }
          if (kind === 'accessor') {
            Object.defineProperty(target(), 'maxLoopCount', { configurable: true, get: getter });
          }
          if (kind === 'inherited undefined') {
            Object.setPrototypeOf(target(), { maxLoopCount: undefined });
          }
          expect(candidate.current()).toBe(false);
          expect(candidate.identityCurrent()).toBe(true);
          expect(getter).not.toHaveBeenCalled();
        }
      );
    });

    describe('current no-limit loop eligibility', () => {
      beforeEach(() => {
        delete props.loop;
        content.loopingThresholdMs = 60000;
        state.content = { ...content };
      });

      it.each(['forceLoop', 'loop', 'threshold'])(
        'accepts the exact current %s eligibility on both content objects',
        (kind) => {
          for (const object of [content, state.content]) {
            delete object.loopingThresholdMs;
            if (kind === 'threshold') {
              object.loopingThresholdMs = object.durationMs;
            } else {
              object[kind] = true;
            }
          }
          const candidate = resolve();
          expect(candidate?.current()).toBe(true);
          expect(api.seekTo).not.toHaveBeenCalled();
        }
      );

      it.each(['creator', 'selected', 'both'])(
        'rejects a stale SDK flag after %s threshold eligibility changes to zero',
        (which) => {
          const candidate = resolve();
          expect(candidate?.current()).toBe(true);
          if (which !== 'selected') {
            content.loopingThresholdMs = 0;
          }
          if (which !== 'creator') {
            state.content.loopingThresholdMs = 0;
          }
          expect(state.playback.shouldLoop).toBe(true);
          expect(candidate.current()).toBe(false);
          expect(candidate.identityCurrent()).toBe(true);
          expect(video.src).toBe(blob);
        }
      );

      it.each(['forceLoop', 'loop'])(
        'revokes an existing %s certificate when only selected eligibility disappears',
        (field) => {
          for (const object of [content, state.content]) {
            delete object.loopingThresholdMs;
            object[field] = true;
          }
          const candidate = resolve();
          expect(candidate?.current()).toBe(true);
          state.content[field] = false;
          expect(candidate.current()).toBe(false);
          expect(candidate.identityCurrent()).toBe(true);
        }
      );

      it.each([undefined, null, 0, -1, NaN, Infinity, '60000'])(
        'does not certify malformed or ineligible threshold %s',
        (value) => {
          content.loopingThresholdMs = value;
          expect(resolve()).toBeNull();
        }
      );

      it.each(['forceLoop', 'loop', 'loopingThresholdMs'])(
        'rejects inherited or accessor %s eligibility without invoking it',
        (field) => {
          delete content.loopingThresholdMs;
          Object.setPrototypeOf(content, {
            [field]: field === 'loopingThresholdMs' ? 60000 : true,
          });
          expect(resolve()).toBeNull();
          Object.setPrototypeOf(content, Object.prototype);
          const getter = vi.fn(() => (field === 'loopingThresholdMs' ? 60000 : true));
          Object.defineProperty(content, field, { configurable: true, get: getter });
          expect(resolve()).toBeNull();
          expect(getter).not.toHaveBeenCalled();
        }
      );

      it('preserves the creator override when threshold eligibility disappears', () => {
        props.loop = true;
        const candidate = resolve();
        content.loopingThresholdMs = 0;
        state.content.loopingThresholdMs = 0;
        expect(candidate?.current()).toBe(true);
      });
    });

    it('preserves the same-video native-HLS route whose SDK still owns finite repeat bookkeeping', () => {
      Object.assign(content, { forceLoop: true, maxLoopCount: 2 });
      props.loop = false;
      video.src = sourceUrl;
      property(video, 'currentSrc', sourceUrl);
      const play = vi.spyOn(video, 'play'),
        pause = vi.spyOn(video, 'pause'),
        load = vi.spyOn(video, 'load');
      const candidate = window.VSC.TwitterPlayer.findNativeHlsCandidate(video);
      expect(candidate?.originalUrl).toBe(sourceUrl);
      expect(candidate?.progressiveUrl).toBe(mp4('1280x720'));
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      expect(video.src).toBe(sourceUrl);
    });

    it.each(['missing', 'false', 'accessor'])(
      'preserves nonlooping candidates when creator loop is %s',
      (kind) => {
        state.playback.shouldLoop = false;
        delete props.loop;
        const getter = vi.fn(() => {
          throw new Error('Loop policy is unnecessary for nonlooping playback');
        });
        if (kind === 'false') {
          props.loop = false;
        }
        if (kind === 'accessor') {
          Object.defineProperty(props, 'loop', { configurable: true, get: getter });
        }
        const candidate = resolve();
        expect(candidate?.loop).toBe(false);
        expect(candidate.current()).toBe(true);
        expect(getter).not.toHaveBeenCalled();
      }
    );
  });

  describe('observed fullscreen registry boundary', () => {
    let element, entry, entries, registry, context, notifyPlay;

    beforeEach(() => {
      element = document.createElement('div');
      element.setAttribute('data-testid', 'videoComponent');
      parent.before(element);
      element.append(parent);
      notifyPlay = vi.fn();
      registry = Object.create({ notifyPlay });
      entry = { instanceId: 'current-player', controller: sdk.controller, element };
      entries = new Map([[entry.instanceId, entry]]);
      registry.entries = entries;
      context = { id: 'current-group', registry, visibilityThreshold: 50 };
      fiber.dependencies = { firstContext: { memoizedValue: context, next: null } };
    });

    const boundary = () => resolve()?.fullscreenBoundary();

    it('certifies the exact registry entry without notifying or changing playback', () => {
      const play = vi.spyOn(video, 'play'),
        pause = vi.spyOn(video, 'pause'),
        load = vi.spyOn(video, 'load');
      const descriptor = boundary();
      expect(descriptor?.element).toBe(element);
      expect(descriptor.current()).toBe(true);
      expect(notifyPlay).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
      expect(descriptor.activate()).toBe(true);
      expect(notifyPlay).toHaveBeenCalledExactlyOnceWith(entry.instanceId);
      expect(notifyPlay.mock.contexts[0]).toBe(registry);
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
      expect(video.parentNode).toBe(parent);
      expect(video.src).toBe(blob);
    });

    it('allows only the already-bound companion among additional media', () => {
      const candidate = resolve();
      const companion = document.createElement('video');
      expect(candidate.current(companion)).toBe(true);
      parent.append(companion);
      const descriptor = candidate.fullscreenBoundary();
      expect(descriptor?.element).toBe(element);
      expect(descriptor.current()).toBe(true);
      const foreign = document.createElement('video');
      element.append(foreign);
      expect(descriptor.current()).toBe(false);
      expect(descriptor.activate()).toBe(false);
      expect(notifyPlay).not.toHaveBeenCalled();
    });

    it.each(['video', 'audio', 'iframe'])('refuses a boundary containing a foreign %s', (tag) => {
      const candidate = resolve();
      element.append(document.createElement(tag));
      expect(candidate.fullscreenBoundary()).toBeNull();
      expect(notifyPlay).not.toHaveBeenCalled();
    });

    it.each(['original', 'body', 'root', 'disconnected', 'foreign document', 'unrelated'])(
      'refuses a %s entry element',
      (kind) => {
        const candidate = resolve();
        if (kind === 'original') {
          entry.element = video;
        }
        if (kind === 'body') {
          entry.element = document.body;
        }
        if (kind === 'root') {
          entry.element = document.documentElement;
        }
        if (kind === 'disconnected') {
          element.remove();
        }
        if (kind === 'foreign document') {
          entry.element = document.implementation.createHTMLDocument().createElement('div');
        }
        if (kind === 'unrelated') {
          entry.element = document.createElement('div');
          document.body.append(entry.element);
        }
        expect(candidate.fullscreenBoundary()).toBeNull();
        expect(notifyPlay).not.toHaveBeenCalled();
      }
    );

    it.each(['registry', 'entries', 'controller', 'element', 'instanceId', 'notifyPlay'])(
      'rejects an accessor for %s without invoking it',
      (field) => {
        const candidate = resolve();
        const target =
          field === 'registry'
            ? context
            : field === 'entries' || field === 'notifyPlay'
              ? registry
              : entry;
        const getter = vi.fn();
        Object.defineProperty(target, field, { configurable: true, get: getter });
        expect(candidate.fullscreenBoundary()).toBeNull();
        expect(getter).not.toHaveBeenCalled();
        expect(notifyPlay).not.toHaveBeenCalled();
      }
    );

    it.each(['registry', 'entries', 'controller', 'element', 'instanceId'])(
      'refuses inherited %s authority',
      (field) => {
        const candidate = resolve();
        const target = field === 'registry' ? context : field === 'entries' ? registry : entry;
        const value = target[field];
        delete target[field];
        Object.setPrototypeOf(target, { ...Object.getPrototypeOf(target), [field]: value });
        expect(candidate.fullscreenBoundary()).toBeNull();
        expect(notifyPlay).not.toHaveBeenCalled();
      }
    );

    it.each(['entry', 'registry', 'key', 'method', 'controller', 'source', 'document', 'parent'])(
      'revokes a captured boundary after its %s changes',
      (change) => {
        const descriptor = boundary();
        expect(descriptor).toBeTruthy();
        if (change === 'entry') {
          entries.set(entry.instanceId, { ...entry });
        }
        if (change === 'registry') {
          context.registry = Object.assign(Object.create({ notifyPlay }), { entries });
        }
        if (change === 'key') {
          entries.delete(entry.instanceId);
        }
        if (change === 'method') {
          Object.getPrototypeOf(registry).notifyPlay = vi.fn();
        }
        if (change === 'controller') {
          entry.controller = { api };
        }
        if (change === 'source') {
          video.src = 'blob:https://x.com/replaced';
        }
        if (change === 'document') {
          vi.spyOn(document, 'URL', 'get').mockReturnValue('https://x.com/other');
        }
        if (change === 'parent') {
          const newerParent = document.createElement('div');
          document.body.append(newerParent);
          newerParent.append(element);
        }
        expect(descriptor.current()).toBe(false);
        expect(descriptor.activate()).toBe(false);
        expect(notifyPlay).not.toHaveBeenCalled();
      }
    );

    it.each(['duplicate entry', 'foreign controller containing original', 'second registry'])(
      'refuses %s ambiguity',
      (kind) => {
        const candidate = resolve();
        if (kind === 'duplicate entry') {
          entries.set('second-player', { ...entry, instanceId: 'second-player' });
        } else if (kind === 'foreign controller containing original') {
          entries.set('foreign-player', {
            instanceId: 'foreign-player',
            controller: { api: { getMediaElement: () => document.createElement('video') } },
            element,
          });
        } else {
          fiber.dependencies.firstContext.next = {
            memoizedValue: {
              registry: Object.assign(Object.create({ notifyPlay }), { entries: new Map(entries) }),
            },
            next: null,
          };
        }
        expect(candidate.fullscreenBoundary()).toBeNull();
        expect(notifyPlay).not.toHaveBeenCalled();
      }
    );

    it.each(['fiber cycle', 'context cycle', 'entry budget'])(
      'rejects a %s without notifications',
      (kind) => {
        const candidate = resolve();
        if (kind === 'fiber cycle') {
          fiber.return.return = fiber;
        }
        if (kind === 'context cycle') {
          fiber.dependencies.firstContext.next = fiber.dependencies.firstContext;
        }
        if (kind === 'entry budget') {
          for (let index = 0; index < 32; index++) {
            entries.set(`other-${index}`, {
              instanceId: `other-${index}`,
              controller: { api: {} },
              element: document.createElement('div'),
            });
          }
        }
        expect(candidate.fullscreenBoundary()).toBeNull();
        expect(notifyPlay).not.toHaveBeenCalled();
      }
    );

    it('keeps a certified nearby group when unrelated React ancestry exceeds the local bound', () => {
      let cursor = fiber.return;
      for (let index = 0; index < 40; index++) {
        cursor.return = { dependencies: { firstContext: { memoizedValue: index, next: null } } };
        cursor = cursor.return;
      }
      const descriptor = boundary();
      expect(descriptor?.current()).toBe(true);
      expect(notifyPlay).not.toHaveBeenCalled();
    });

    it('uses native Map reads without invoking page-supplied Map accessors', () => {
      const getter = vi.fn();
      for (const key of ['entries', 'get', 'size']) {
        Object.defineProperty(entries, key, { configurable: true, get: getter });
      }
      const descriptor = boundary();
      expect(descriptor?.current()).toBe(true);
      expect(getter).not.toHaveBeenCalled();
      expect(notifyPlay).not.toHaveBeenCalled();
    });

    it.each(['throw', 'source change'])(
      'revalidates after notifyPlay %s and never requests native Play',
      (effect) => {
        const play = vi.spyOn(video, 'play');
        const descriptor = boundary();
        notifyPlay.mockImplementation(() => {
          if (effect === 'throw') {
            throw new Error('Site notification failed');
          }
          video.src = 'blob:https://x.com/replaced';
        });
        expect(descriptor.activate()).toBe(false);
        expect(notifyPlay).toHaveBeenCalledOnce();
        expect(play).not.toHaveBeenCalled();
        expect(api.seekTo).not.toHaveBeenCalled();
      }
    );
  });

  function captionFixture() {
    const track = { kind: 'subtitles', language: 'en', label: 'English', mode: 'showing' };
    const node = document.createElement('track');
    node.kind = 'subtitles';
    node.srclang = 'en';
    node.label = 'English';
    node.src = 'data:,WEBVTT';
    property(node, 'track', track);
    video.append(node);
    property(video, 'textTracks', [track]);
    const audio = { enabled: true };
    property(video, 'audioTracks', [audio]);
    const record = { id: 0, kind: 'subtitles', language: 'en', label: 'English' };
    state.textTracks.tracks = [record];
    return { track, node, audio, record };
  }

  function nativePresentationFixture() {
    const caption = captionFixture();
    property(video, 'duration', 373.888);
    content.durationMs = 373840;
    state.source.playlistDurationSec = 373.835;
    state.playback.shouldLoop = false;
    delete props.loop;
    const info = modern.timeRemainingAccessory?.props.media.video_info;
    if (info) {
      info.duration_millis = 373840;
    }
    const element = document.createElement('div');
    parent.before(element);
    element.append(parent);
    const notifyPlay = vi.fn(),
      registry = Object.create({ notifyPlay });
    const entry = { instanceId: 'native-player', controller: sdk.controller, element };
    const entries = new Map([[entry.instanceId, entry]]);
    registry.entries = entries;
    fiber.dependencies = { firstContext: { memoizedValue: { registry }, next: null } };
    return { ...caption, element, notifyPlay, registry, entry, entries };
  }

  describe('current post cached variants', () => {
    let records, variants, environment, cache, media, owner;
    beforeEach(() => {
      delete modern.timeRemainingAccessory;
      modern.downloadUrl = mp4('3840x2160');
      modern.poppedOutSource.playerProps.downloadUrl = modern.downloadUrl;
      variants = [
        { content_type: 'application/x-mpegURL', url: sourceUrl },
        ...[
          ['480x270', 256000],
          ['640x360', 832000],
          ['1280x720', 2176000],
          ['1920x1080', 10368000],
          ['3840x2160', 25128000],
        ].map(([size, bitrate]) => ({ content_type: 'video/mp4', url: mp4(size), bitrate })),
      ];
      media = { id_str: contentId, type: 'video', video_info: { __ref: 'info' } };
      records = new Map([
        ['media', media],
        ['info', { duration_millis: 20400, variants: { __refs: variants.map((_, i) => `v${i}`) } }],
        ...variants.map((item, i) => [`v${i}`, item]),
      ]);
      cache = Object.create({ get: vi.fn((id) => records.get(id)) });
      const relayStore = Object.create({ getSource: () => cache });
      environment = Object.assign(Object.create({ getStore: vi.fn(() => relayStore) }), {
        '@@RelayModernEnvironment': true,
      });
      owner = {
        memoizedProps: { tweet: { rest_id: postId, media_entities2: [{ __id: 'media' }] } },
        dependencies: { firstContext: { memoizedValue: { environment }, next: null } },
        return: null,
      };
      for (let index = 0; index < 8; index++) {
        owner.dependencies.firstContext = {
          memoizedValue: {},
          next: owner.dependencies.firstContext,
        };
      }
      fiber.return.return = owner;
    });

    function opaqueCaptionFixture() {
      const caption = captionFixture();
      modern.downloadUrl = mp4('640x360');
      modern.poppedOutSource.playerProps.downloadUrl = modern.downloadUrl;
      const fragment = {
        original_info: { width: 640, height: 360 },
        __fragments: { CurrentMedia: {} },
        __id: 'media',
        __fragmentOwner: {},
      };
      modern.timeRemainingAccessory = { props: { media: fragment } };
      video.removeAttribute('src');
      const source = document.createElement('source');
      source.src = blob;
      source.type = 'video/mp4';
      video.prepend(source);
      return { ...caption, fragment, source };
    }

    it('joins the exact opaque caption-loop UI fragment to the current post Relay catalog', () => {
      const { fragment, source, track } = opaqueCaptionFixture();
      const play = vi.spyOn(video, 'play'),
        pause = vi.spyOn(video, 'pause'),
        load = vi.spyOn(video, 'load');
      const candidate = window.VSC.TwitterPlayer.resolveCaptionedLoop(video);
      expect(candidate?.sourceNode).toBe(source);
      expect(candidate?.progressiveUrl).toBe(mp4('1280x720'));
      expect(candidate?.loop).toBe(true);
      expect(candidate?.current()).toBe(true);
      expect(candidate?.captionBinding.isCurrent()).toBe(true);
      expect(fragment.__id).toBe(owner.memoizedProps.tweet.media_entities2[0].__id);
      expect(new Set(cache.get.mock.calls.map(([id]) => id))).toEqual(
        new Set(['media', 'info', 'v0', 'v1', 'v2', 'v3', 'v4', 'v5'])
      );
      expect(resolve()).toBeNull();
      expect(track.mode).toBe('showing');
      expect(source.src).toBe(blob);
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
    });

    it.each([
      'wrong fragment',
      'mixed legacy',
      'null info',
      'info getter',
      'inherited info',
      'protected dimensions',
      'finite loop',
    ])('rejects an opaque fragment with %s before accepting any alternate source', (change) => {
      const { fragment } = opaqueCaptionFixture();
      const getter = vi.fn();
      if (change === 'wrong fragment') {
        fragment.__id = 'other-media';
      }
      if (change === 'mixed legacy') {
        fragment.id_str = contentId;
      }
      if (change === 'null info') {
        fragment.video_info = null;
      }
      if (change === 'info getter') {
        Object.defineProperty(fragment, 'video_info', { get: getter });
      }
      if (change === 'inherited info') {
        Object.setPrototypeOf(fragment, { video_info: {} });
      }
      if (change === 'protected dimensions') {
        fragment.original_info.drm = true;
      }
      if (change === 'finite loop') {
        delete props.loop;
        content.maxLoopCount = 2;
      }
      expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
      expect(getter).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
    });

    it.each(['media replacement', 'protection change', 'session change', 'reentrant SDK read'])(
      'rechecks the UI fragment through a Relay cache read after %s',
      (change) => {
        const { fragment } = opaqueCaptionFixture();
        cache.get.mockImplementation((id) => {
          if (change === 'media replacement') {
            modern.timeRemainingAccessory.props.media = { ...fragment };
          }
          if (change === 'protection change') {
            fragment.original_info.live = true;
          }
          if (change === 'session change') {
            state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
          }
          if (change === 'reentrant SDK read') {
            api.getState.mockImplementationOnce(() => {
              modern.timeRemainingAccessory.props.media = { ...fragment };
              return state;
            });
          }
          return records.get(id);
        });
        expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
        expect(cache.get).toHaveBeenCalledOnce();
      }
    );

    it('certifies the finite captioned native presentation through the exact Relay/source-child route', () => {
      const { element, notifyPlay } = nativePresentationFixture();
      records.get('info').duration_millis = 373840;
      video.removeAttribute('src');
      const source = document.createElement('source');
      source.src = blob;
      source.type = 'video/mp4';
      video.prepend(source);
      delete modern.downloadUrl;
      delete modern.poppedOutSource.playerProps.downloadUrl;
      const native = window.VSC.TwitterPlayer.resolveNativePresentation(video);
      expect(native?.element).toBe(element);
      expect(native?.current()).toBe(true);
      expect(native?.activate()).toBe(true);
      expect(notifyPlay).not.toHaveBeenCalled();
      expect(resolve()).toBeNull();
      expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
      source.src = 'blob:https://x.com/replacement';
      expect(native.current()).toBe(false);
    });

    it('uses the exact cached source-child and selected caption metadata without MP4 approval', () => {
      const { track } = captionFixture();
      video.removeAttribute('src');
      const source = document.createElement('source');
      source.src = blob;
      video.prepend(source);
      delete modern.downloadUrl;
      delete modern.poppedOutSource.playerProps.downloadUrl;
      const candidate = window.VSC.TwitterPlayer.resolveCaptionedLoop(video);
      expect(candidate?.sourceNode).toBe(source);
      expect(candidate?.progressiveUrl).toBe(mp4('1280x720'));
      expect(candidate?.captionBinding.isCurrent()).toBe(true);
      expect(resolve()).toBeNull();
      track.mode = 'disabled';
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(true);
      expect(track.mode).toBe('disabled');
    });

    it('rejects a native caption change from a Relay getter without broadening cache authority', () => {
      const { track } = captionFixture();
      cache.get.mockImplementation((id) => {
        track.mode = 'hidden';
        return records.get(id);
      });
      expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
      expect(cache.get).toHaveBeenCalledOnce();
    });

    it('selects the supplied cached 720p instead of the bound 4K download without media commands', () => {
      const load = vi.spyOn(video, 'load');
      const play = vi.spyOn(video, 'play');
      expect(resolve()?.progressiveUrl).toBe(mp4('1280x720'));
      expect(cache.get.mock.calls.map(([id]) => id)).toEqual([
        'media',
        'info',
        'v0',
        'v1',
        'v2',
        'v3',
        'v4',
        'v5',
      ]);
      expect(video.src).toBe(blob);
      expect(load).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
    });

    it.each(['SDK state', 'SDK snapshot', 'SDK element', 'Relay cache'])(
      'rechecks the creator loop certificate after a %s read',
      (where) => {
        content.maxLoopCount = 2;
        if (where === 'Relay cache') {
          cache.get.mockImplementation((id) => {
            props.loop = false;
            return records.get(id);
          });
        } else {
          const key = {
            'SDK state': 'getState',
            'SDK snapshot': 'getSnapshot',
            'SDK element': 'getMediaElement',
          }[where];
          const object = key === 'getSnapshot' ? store : api;
          object[key].mockImplementation(() => {
            if (object[key].mock.calls.length === 2) {
              props.loop = false;
            }
            return key === 'getMediaElement' ? video : state;
          });
        }
        const play = vi.spyOn(video, 'play'),
          load = vi.spyOn(video, 'load');
        expect(resolve()).toBeNull();
        expect(play).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
        expect(video.src).toBe(blob);
      }
    );

    it.each(['creator', 'selected'])(
      'rejects a newly finite %s content limit during a Relay cache read',
      (which) => {
        delete props.loop;
        content.forceLoop = true;
        state.content = { ...content };
        cache.get.mockImplementation((id) => {
          (which === 'creator' ? content : state.content).maxLoopCount = 2;
          return records.get(id);
        });
        expect(resolve()).toBeNull();
        expect(video.src).toBe(blob);
      }
    );

    it.each(['creator', 'selected'])(
      'rechecks no-limit %s eligibility after a Relay cache read',
      (which) => {
        delete props.loop;
        content.loopingThresholdMs = 60000;
        state.content = { ...content };
        cache.get.mockImplementation((id) => {
          (which === 'creator' ? content : state.content).loopingThresholdMs = 0;
          return records.get(id);
        });
        expect(resolve()).toBeNull();
        expect(video.src).toBe(blob);
      }
    );

    const missingDownloads = () => {
      delete modern.downloadUrl;
      delete modern.poppedOutSource.playerProps.downloadUrl;
    };

    it.each([
      ['absent', 'absent'],
      ['absent', 'undefined'],
      ['undefined', 'absent'],
      ['undefined', 'undefined'],
    ])('accepts cached renditions with %s/%s download anchors', (outer, inner) => {
      missingDownloads();
      if (outer === 'undefined') {
        modern.downloadUrl = undefined;
      }
      if (inner === 'undefined') {
        modern.poppedOutSource.playerProps.downloadUrl = undefined;
      }
      const load = vi.spyOn(video, 'load');
      const play = vi.spyOn(video, 'play');
      const pause = vi.spyOn(video, 'pause');
      const candidate = resolve();
      expect(candidate?.progressiveUrl).toBe(mp4('1280x720'));
      expect(candidate.current()).toBe(true);
      expect(candidate.identityCurrent()).toBe(true);
      expect(load).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(video.src).toBe(blob);
    });

    describe.each(['modern', 'playerProps'])('%s missing download certificate', (which) => {
      const target = () => (which === 'modern' ? modern : modern.poppedOutSource.playerProps);

      it.each([
        'inherited undefined',
        'inherited URL',
        'inherited accessor',
        'own accessor',
        'null',
        'empty',
        'invalid URL',
        'mixed valid URL',
      ])('rejects %s without reading getters or loading media', (kind) => {
        missingDownloads();
        const object = target();
        const getter = vi.fn(() => undefined);
        if (kind.startsWith('inherited')) {
          const prototype = {};
          if (kind === 'inherited accessor') {
            Object.defineProperty(prototype, 'downloadUrl', { get: getter });
          } else {
            prototype.downloadUrl = kind === 'inherited URL' ? mp4('3840x2160') : undefined;
          }
          Object.setPrototypeOf(object, prototype);
        } else if (kind === 'own accessor') {
          Object.defineProperty(object, 'downloadUrl', { configurable: true, get: getter });
        } else {
          object.downloadUrl = {
            null: null,
            empty: '',
            'invalid URL': 'https://example.com/video.mp4',
            'mixed valid URL': mp4('3840x2160'),
          }[kind];
        }
        const load = vi.spyOn(video, 'load');
        expect(resolve()).toBeNull();
        expect(getter).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
        expect(video.src).toBe(blob);
      });

      it.each(['SDK state', 'SDK snapshot', 'SDK element', 'Relay cache'])(
        'rechecks strict absence after a %s read',
        (where) => {
          missingDownloads();
          const object = target();
          object.downloadUrl = undefined;
          const mutate = () => {
            delete object.downloadUrl;
            Object.setPrototypeOf(object, { downloadUrl: undefined });
          };
          if (where === 'Relay cache') {
            cache.get.mockImplementation((id) => {
              mutate();
              return records.get(id);
            });
          } else {
            const key = {
              'SDK state': 'getState',
              'SDK snapshot': 'getSnapshot',
              'SDK element': 'getMediaElement',
            }[where];
            const object = key === 'getSnapshot' ? store : api;
            object[key].mockImplementation(() => {
              if (object[key].mock.calls.length === 2) {
                mutate();
              }
              return key === 'getMediaElement' ? video : state;
            });
          }
          expect(resolve()).toBeNull();
          expect(video.src).toBe(blob);
        }
      );

      it('keeps a saved-route candidate strict after a later inherited undefined anchor', () => {
        missingDownloads();
        const candidate = resolve();
        expect(candidate?.current()).toBe(true);
        Object.setPrototypeOf(target(), { downloadUrl: undefined });
        expect(candidate.current()).toBe(false);
        expect(candidate.identityCurrent()).toBe(true);
      });
    });

    it('keeps a candidate current when missing anchors gain a valid matching supplied URL', () => {
      missingDownloads();
      const candidate = resolve();
      modern.downloadUrl = mp4('3840x2160');
      modern.poppedOutSource.playerProps.downloadUrl = modern.downloadUrl;
      expect(candidate.current()).toBe(true);
      expect(resolve()?.current()).toBe(true);
    });

    it('retains the exact direct source child without download anchors', () => {
      missingDownloads();
      video.removeAttribute('src');
      const child = document.createElement('source');
      child.src = blob;
      video.append(child);
      const candidate = resolve();
      expect(candidate?.sourceNode).toBe(child);
      expect(candidate.current()).toBe(true);
      child.type = 'video/mp4';
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(false);
    });

    it.each(['captions', 'DRM', 'live', 'wrong HLS', 'wrong post', 'foreign variant'])(
      'still vetoes %s without download anchors',
      (kind) => {
        missingDownloads();
        const candidate = resolve();
        expect(candidate?.current()).toBe(true);
        if (kind === 'captions') {
          state.textTracks.tracks.push({ kind: 'captions' });
        } else if (kind === 'DRM') {
          sdk.isProtected = true;
        } else if (kind === 'live') {
          content.isLive = true;
        } else if (kind === 'wrong HLS') {
          variants[0].url = `${sourceUrl}&other=1`;
        } else if (kind === 'wrong post') {
          owner.memoizedProps.tweet.rest_id = '999';
        } else {
          variants[3].url = mp4('1280x720').replace(contentId, '999');
        }
        expect(candidate.current()).toBe(false);
        expect(resolve()).toBeNull();
      }
    );

    it('does not relax countdown metadata when download anchors are missing', () => {
      missingDownloads();
      modern.timeRemainingAccessory = {
        props: {
          media: {
            id_str: contentId,
            video_info: { duration_millis: 20400, variants },
          },
        },
      };
      expect(resolve()).toBeNull();
      expect(cache.get).not.toHaveBeenCalled();
    });

    it('accepts the exact child representation only with the current cached source binding', () => {
      video.removeAttribute('src');
      const child = document.createElement('source');
      child.src = blob;
      video.append(child);
      const candidate = resolve();
      expect(candidate?.progressiveUrl).toBe(mp4('1280x720'));
      expect(candidate?.sourceNode).toBe(child);
      expect(candidate?.current()).toBe(true);
      child.src = 'blob:https://x.com/other';
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(false);
    });

    it.each([
      [
        'caption',
        () => {
          state.textTracks.tracks.push({ kind: 'captions' });
        },
      ],
      [
        'DRM',
        () => {
          sdk.isProtected = true;
        },
      ],
      [
        'live',
        () => {
          content.isLive = true;
        },
      ],
      [
        'foreign post',
        () => {
          owner.memoizedProps.tweet.rest_id = '999';
        },
      ],
      [
        'foreign variant',
        () => {
          variants[3].url = mp4('1280x720').replace(contentId, '999');
        },
      ],
      [
        'cached captions',
        () => {
          media.hasCaptions = true;
        },
      ],
      [
        'missing record',
        () => {
          records.delete('v3');
        },
      ],
      [
        'declared invalid accessory',
        () => {
          modern.timeRemainingAccessory = undefined;
        },
      ],
    ])('refuses %s without media commands or an unsafe download fallback', (_reason, change) => {
      const load = vi.spyOn(video, 'load');
      change();
      expect(resolve()).toBeNull();
      expect(video.src).toBe(blob);
      expect(load).not.toHaveBeenCalled();
    });

    it.each(['SDK', 'cache', 'SDK method replacement'])(
      'rejects reentrant %s changes without loading the producer',
      (where) => {
        const load = vi.spyOn(video, 'load');
        const change = () => {
          video.src = 'blob:https://x.com/other';
        };
        if (where === 'SDK method replacement') {
          api.getState.mockImplementationOnce(() => {
            api.getState = () => ({ ...state, hasCaptions: true });
            return state;
          });
        } else if (where === 'SDK') {
          api.getState.mockImplementation(() => {
            change();
            return state;
          });
        } else {
          cache.get.mockImplementation((id) => {
            change();
            return records.get(id);
          });
        }
        expect(resolve()).toBeNull();
        expect(load).not.toHaveBeenCalled();
      }
    );

    it('keeps identity handback valid at seek readiness and after captions become available', () => {
      const candidate = resolve();
      expect(candidate?.current()).toBe(true);
      property(video, 'readyState', 1);
      state.textTracks.tracks.push({ kind: 'captions' });
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(true);
      state.source = { ...state.source, src: `${sourceUrl}&next=1` };
      expect(candidate.identityCurrent()).toBe(false);
    });

    it('rejects stale cached rendition selection for takeover without blocking original identity handback', () => {
      const candidate = resolve();
      expect(candidate?.current()).toBe(true);
      variants[3].url = mp4('1280x720').replace('current.mp4', 'replacement.mp4');
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(true);
    });
  });

  describe('explicit presentation with one direct source child', () => {
    let source;
    const presentation = () =>
      window.VSC.TwitterPlayer.resolve(video, null, { allowSourceChild: true });

    beforeEach(() => {
      video.removeAttribute('src');
      source = document.createElement('source');
      source.src = blob;
      source.type = 'video/mp4';
      source.media = '(min-width: 1px)';
      video.append(source);
    });

    it('accepts only the explicit option without changing the retained producer', () => {
      const load = vi.spyOn(video, 'load');
      const play = vi.spyOn(video, 'play');
      const pause = vi.spyOn(video, 'pause');
      expect(resolve()).toBeNull();
      const candidate = presentation();
      expect(candidate).toMatchObject({ sourceNode: source, originalUrl: blob, sdk, api, store });
      expect(candidate.current()).toBe(true);
      expect(candidate.identityCurrent()).toBe(true);
      expect(video.hasAttribute('src')).toBe(false);
      expect(video.currentSrc).toBe(blob);
      expect(source.src).toBe(blob);
      expect(load).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
    });

    it.each([
      'replacement',
      'duplicate',
      'removed',
      'src',
      'type',
      'media',
      'video-src',
      'document',
    ])('invalidates both startup and handback identity after %s changes', (kind) => {
      const candidate = presentation();
      if (kind === 'replacement') {
        source.replaceWith(source.cloneNode());
      } else if (kind === 'duplicate') {
        video.append(source.cloneNode());
      } else if (kind === 'removed') {
        source.remove();
      } else if (kind === 'src') {
        source.src = 'blob:https://x.com/other';
      } else if (kind === 'type') {
        source.type = 'video/webm';
      } else if (kind === 'media') {
        source.media = '(min-width: 2px)';
      } else if (kind === 'video-src') {
        // Even an overriding attribute with the same URL changes site intent.
        video.src = blob;
      } else {
        document.implementation.createHTMLDocument().body.append(video);
      }
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(false);
    });

    it.each(['captions', 'native-captions', 'drm', 'live', 'ambiguous-media', 'ambiguous-sdk'])(
      'retains the explicit presentation capability veto for %s',
      (kind) => {
        if (kind === 'captions') {
          state.textTracks.tracks.push({ kind: 'captions' });
        } else if (kind === 'native-captions') {
          video.append(document.createElement('track'));
        } else if (kind === 'drm') {
          content.keySystems = {};
        } else if (kind === 'live') {
          state.source.live = true;
        } else if (kind === 'ambiguous-media') {
          parent.append(document.createElement('video'));
        } else {
          hooks[10].memoizedState = { ...sdk };
        }
        expect(presentation()).toBeNull();
      }
    );

    it.each(['session', 'content', 'sdk'])(
      'retains SDK identity rejection after a %s change',
      (kind) => {
        const candidate = presentation();
        if (kind === 'session') {
          state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        } else if (kind === 'content') {
          state.content = { ...content };
        } else {
          hooks[11].memoizedState = { ...sdk };
        }
        expect(candidate.current()).toBe(false);
        expect(candidate.identityCurrent()).toBe(false);
      }
    );

    it('rejects multiple sources before capture even when both URLs match', () => {
      video.append(source.cloneNode());
      expect(presentation()).toBeNull();
    });
  });

  it.each(['', '&variant_version=1'])(
    'uses the same current SDK inspection for native HLS with suffix %j',
    (suffix) => {
      const actual = sourceUrl + suffix;
      video.src = actual;
      property(video, 'currentSrc', actual);
      expect(window.VSC.TwitterPlayer.findNativeHlsCandidate(video)).toEqual({
        originalUrl: actual,
        progressiveUrl: mp4('1280x720'),
        mediaId: contentId,
      });
      expect(api.getState).toHaveBeenCalled();
      // Native-HLS support must not broaden the retained-MSE adapter itself.
      expect(resolve()).toBeNull();
    }
  );

  it('distinguishes absent native SDK metadata from an authoritative capability veto', () => {
    video.src = sourceUrl;
    property(video, 'currentSrc', sourceUrl);
    state.textTracks.tracks.push({ kind: 'captions' });
    expect(window.VSC.TwitterPlayer.findNativeHlsCandidate(video)).toBeNull();
    delete parent.__reactFiber$fixture;
    expect(window.VSC.TwitterPlayer.findNativeHlsCandidate(video)).toBeUndefined();
  });

  describe('retained native HLS SDK proof', () => {
    function retained() {
      video.src = sourceUrl;
      property(video, 'currentSrc', sourceUrl);
      video.vsc = { video };
      const candidate = window.VSC.TwitterPlayer.findNativeHlsCandidate(video);
      expect(candidate).toBeTruthy();
      video.src = candidate.progressiveUrl;
      property(video, 'currentSrc', candidate.progressiveUrl);
      return candidate;
    }

    it.each([NaN, 0])('permits only the expected owned ready0 duration reset %s', (duration) => {
      const candidate = retained();
      expect(candidate.revalidate()).toBe(true);
      property(video, 'readyState', 0);
      property(video, 'currentSrc', '');
      property(video, 'duration', duration);
      expect(candidate.revalidate()).toBe(false);
      expect(candidate.revalidate(true)).toBe(true);
      property(video, 'readyState', 4);
      expect(candidate.revalidate(true)).toBe(false);
      property(video, 'duration', 20.456);
      property(video, 'currentSrc', candidate.progressiveUrl);
      expect(candidate.revalidate()).toBe(true);
    });

    it.each([
      'foreign source',
      'SDK session',
      'content ID',
      'SDK method',
      'captions',
      'unknown captions',
      'DRM',
      'live',
      'controller',
    ])('retains a fresh %s veto during an expected decoder reload', (change) => {
      const candidate = retained();
      property(video, 'readyState', 0);
      property(video, 'currentSrc', '');
      property(video, 'duration', NaN);
      expect(candidate.revalidate(true)).toBe(true);
      if (change === 'foreign source') {
        video.src = mp4('640x360');
      } else if (change === 'SDK session') {
        state.session.id = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      } else if (change === 'content ID') {
        content.contentId = '999';
      } else if (change === 'SDK method') {
        api.getState = vi.fn(() => state);
      } else if (change === 'captions') {
        state.textTracks.tracks.push({ kind: 'captions' });
      } else if (change === 'unknown captions') {
        state.textTracks.tracks = undefined;
      } else if (change === 'DRM') {
        content.keySystems = {};
      } else if (change === 'live') {
        state.source.live = true;
      } else {
        video.vsc = { video };
      }
      expect(candidate.revalidate(true)).toBe(false);
    });

    it('keeps clear, vetoed and absent modern SDK results distinct for legacy caption ownership', () => {
      const candidate = retained();
      const validate = () =>
        window.VSC.TwitterPlayer.validateRetainedHls(video, sourceUrl, candidate.progressiveUrl);
      expect(validate()).toBe(true);
      state.textTracks.tracks.push({ kind: 'captions' });
      expect(validate()).toBe(false);
      delete parent.__reactFiber$fixture;
      expect(validate()).toBeUndefined();
    });
  });

  it.each(['blob', 'native HLS'])(
    'bounds %s variant inspection when a page descriptor grows its own array',
    (kind) => {
      if (kind === 'native HLS') {
        video.src = sourceUrl;
        property(video, 'currentSrc', sourceUrl);
      }
      const variants = modern.timeRemainingAccessory.props.media.video_info.variants;
      const hls = variants[0];
      const mp4Variant = variants[2];
      let inspections = 0;
      const growing = new Proxy(mp4Variant, {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'drm') {
            inspections++;
            // Keep the regression finite even with the former live-length loop.
            if (variants.length < 30) {
              variants.push(growing);
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      variants.splice(0, variants.length, hls, growing);
      const candidate =
        kind === 'blob' ? resolve() : window.VSC.TwitterPlayer.findNativeHlsCandidate(video);
      expect(candidate).toBeNull();
      expect(inspections).toBe(1);
      expect(variants).toHaveLength(3);
    }
  );

  it('subscribes through the bound store and returns an idempotent disposer', () => {
    const callback = vi.fn();
    const dispose = vi.fn();
    store.subscribe.mockImplementation(function (next) {
      expect(this).toBe(store);
      expect(next).toBe(callback);
      return dispose;
    });
    const stop = resolve().subscribe(callback);
    stop();
    stop();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([
    'blob-origin',
    'src-intent',
    'not-ready',
    'foreign-page',
    'forged-element',
    'forged-api',
  ])('rejects a mismatched native binding: %s', (kind) => {
    if (kind === 'blob-origin') {
      video.src = 'blob:https://example.test/opaque';
      property(video, 'currentSrc', video.src);
    }
    if (kind === 'src-intent') {
      video.src = 'blob:https://x.com/replacement';
    }
    if (kind === 'not-ready') {
      property(video, 'readyState', 1);
    }
    if (kind === 'foreign-page') {
      vi.spyOn(document, 'URL', 'get').mockReturnValue('https://example.test/');
    }
    if (kind === 'forged-element') {
      sdk.element = document.createElement('video');
    }
    if (kind === 'forged-api') {
      api.getMediaElement.mockReturnValue(document.createElement('video'));
    }
    expect(resolve()).toBeNull();
  });

  it.each(['session', 'content', 'source', 'sdk', 'root', 'poster-metadata'])(
    'invalidates a captured candidate after %s replacement',
    (kind) => {
      const candidate = resolve();
      if (kind === 'session') {
        state.session = { id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
      }
      if (kind === 'content') {
        state.content = { ...content };
      }
      if (kind === 'source') {
        state.source = { ...state.source, src: `${sourceUrl}&new=1` };
      }
      if (kind === 'sdk') {
        hooks[11].memoizedState = { ...sdk };
      }
      if (kind === 'root') {
        const host = document.createElement('div');
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).append(parent);
      }
      if (kind === 'poster-metadata') {
        modern.poppedOutSource.hostKey = 'other';
      }
      expect(candidate.current()).toBe(false);
    }
  );

  it('allows normal cached-state and source-object recreation for the same session/content', () => {
    const candidate = resolve();
    state = { ...state, source: { ...state.source }, media: { ...state.media, paused: true } };
    expect(candidate.current()).toBe(true);
  });

  it.each(['captions', 'native-captions', 'drm', 'live', 'preroll', 'alternate-audio', 'snapshot'])(
    'vetoes protected or unknown capabilities: %s',
    (kind) => {
      if (kind === 'captions') {
        state.textTracks.tracks.push({ kind: 'captions' });
      }
      if (kind === 'native-captions') {
        video.append(document.createElement('track'));
      }
      if (kind === 'drm') {
        content.keySystems = {};
      }
      if (kind === 'live') {
        state.source.live = true;
      }
      if (kind === 'preroll') {
        props.preroll = { source: 'ad' };
      }
      if (kind === 'alternate-audio') {
        property(video, 'audioTracks', { length: 2 });
      }
      if (kind === 'snapshot') {
        store.getSnapshot.mockReturnValue({ ...state, textTracks: { tracks: [{}] } });
      }
      expect(resolve()).toBeNull();
    }
  );

  it.each(['host', 'download', 'variant', 'hls', 'media-id'])(
    'rejects stale supplied metadata: %s',
    (kind) => {
      const media = modern.timeRemainingAccessory.props.media;
      if (kind === 'host') {
        props.hostKey = `${postId}:999`;
      }
      if (kind === 'download') {
        modern.downloadUrl = mp4('1920x1080').replace(contentId, '999');
      }
      if (kind === 'variant') {
        media.video_info.variants[2].url = mp4('1280x720').replace(contentId, '999');
      }
      if (kind === 'hls') {
        media.video_info.variants[0].url += '&stale=1';
      }
      if (kind === 'media-id') {
        media.id_str = '999';
      }
      expect(resolve()).toBeNull();
    }
  );

  it('never invokes page accessors while resolving capability or React data', () => {
    const getter = vi.fn(() => false);
    Object.defineProperty(content, 'drm', { configurable: true, get: getter });
    expect(resolve()).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    delete content.drm;
    Object.defineProperty(parent, '__reactFiber$fixture', { configurable: true, get: getter });
    expect(resolve()).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['hooks', 'ancestors', 'cycle'])('bounds traversal of %s', (kind) => {
    if (kind === 'hooks') {
      hooks[11].next = {
        memoizedState: null,
        next: {
          memoizedState: null,
          next: {
            memoizedState: null,
            next: { memoizedState: null, next: { memoizedState: null, next: null } },
          },
        },
      };
    }
    if (kind === 'ancestors') {
      let tail = fiber.return;
      for (let i = 0; i < 8; i++) {
        tail.return = { memoizedState: null, memoizedProps: {}, return: null };
        tail = tail.return;
      }
    }
    if (kind === 'cycle') {
      hooks[11].next = hooks[0];
    }
    if (kind === 'cycle') {
      expect(resolve()).toBeNull();
    } else {
      expect(resolve()?.current()).toBe(true);
    }
  });

  it('preserves same-producer identity for caption handback without approving continued MP4', () => {
    const candidate = resolve();
    state.textTracks.tracks.push({ kind: 'captions' });
    expect(candidate.current()).toBe(false);
    expect(candidate.identityCurrent()).toBe(true);
    state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(candidate.identityCurrent()).toBe(false);
  });

  it.each(['textTracks', 'tracks'])(
    'hands back when caption capability %s becomes accessor-backed',
    (key) => {
      const candidate = resolve();
      const getter = vi.fn(() => []);
      Object.defineProperty(key === 'textTracks' ? state : state.textTracks, key, {
        configurable: true,
        get: getter,
      });
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(true);
      expect(getter).not.toHaveBeenCalled();
      state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      expect(candidate.identityCurrent()).toBe(false);
    }
  );

  it('permits handback during a seek without approving a new takeover before decoded data', () => {
    const candidate = resolve();
    property(video, 'readyState', 1);
    expect(candidate.current()).toBe(false);
    expect(candidate.identityCurrent()).toBe(true);
    property(video, 'readyState', 0);
    expect(candidate.identityCurrent()).toBe(false);
  });

  it('bounds a cyclic React metadata chain without a matching source owner', () => {
    fiber.return.memoizedProps = {};
    fiber.return.return = fiber;
    expect(resolve()).toBeNull();
  });

  it('retains a captured portal candidate after the original is restored to its source scope', () => {
    const anchor = document.createComment('origin');
    parent.append(anchor);
    const host = document.createElement('div');
    document.body.append(host);
    host.append(video);
    video.vsc = {
      iosPlayer: {
        active: true,
        video,
        doc: document,
        originParent: parent,
        anchor,
        ui: { host },
        portalNode: video,
      },
    };
    const candidate = resolve(parent);
    expect(candidate?.current()).toBe(true);
    parent.append(video);
    anchor.remove();
    host.remove();
    delete video.vsc;
    expect(candidate.current()).toBe(true);
    expect(candidate.identityCurrent()).toBe(true);
    expect(resolve(parent)).toBeNull();
  });

  it('allows only the candidate-bound detached companion beside the original', () => {
    const candidate = resolve();
    const companion = document.createElement('video');
    expect(candidate.current(companion)).toBe(true);
    parent.append(companion);
    expect(candidate.current()).toBe(true);
    expect(candidate.current(document.createElement('video'))).toBe(false);
    parent.append(document.createElement('video'));
    expect(candidate.current()).toBe(false);
  });

  it('does not adopt an already-connected video as an owned companion', () => {
    const candidate = resolve();
    const other = document.createElement('video');
    document.body.append(other);
    expect(candidate.current(other)).toBe(false);
  });

  it('rejects ambiguous media before calling SDK reads', () => {
    parent.append(document.createElement('audio'));
    expect(resolve()).toBeNull();
    expect(api.getState).not.toHaveBeenCalled();
  });

  it('resolves through a validated owned-player restoration anchor', () => {
    const anchor = document.createComment('origin');
    parent.append(anchor);
    const host = document.createElement('div');
    document.body.append(host);
    host.append(video);
    const player = {
      active: true,
      video,
      doc: document,
      originParent: parent,
      anchor,
      ui: { host },
      portalNode: video,
    };
    video.vsc = { iosPlayer: player };
    const candidate = resolve(parent);
    expect(candidate?.current()).toBe(true);
    anchor.remove();
    expect(candidate.current()).toBe(false);
    expect(resolve(parent)).toBeNull();
    delete video.vsc;
  });

  describe('separate captioned loop metadata authority', () => {
    const captioned = () => window.VSC.TwitterPlayer.resolveCaptionedLoop(video);

    it('returns only separate metadata authority without certifying cues or changing playback', () => {
      const { track, node } = captionFixture();
      const cueRead = vi.fn(() => {
        throw Error('must not inspect cue contents');
      });
      Object.defineProperty(track, 'cues', { get: cueRead });
      const play = vi.spyOn(video, 'play'),
        pause = vi.spyOn(video, 'pause'),
        load = vi.spyOn(video, 'load');
      expect(resolve()).toBeNull();
      const candidate = captioned();
      expect(candidate).toMatchObject({ progressiveUrl: mp4('1280x720'), loop: true });
      expect(Object.keys(candidate.captionBinding).sort()).toEqual(
        [
          'original',
          'track',
          'node',
          'hlsUrl',
          'assetType',
          'assetId',
          'duration',
          'language',
          'label',
          'isCurrent',
        ].sort()
      );
      expect(candidate.captionBinding).toMatchObject({
        original: video,
        track,
        node,
        hlsUrl: sourceUrl,
        assetType: 'amplify_video',
        assetId: contentId,
        duration: 20.456,
        language: 'en',
        label: 'English',
      });
      expect(candidate.captionBinding.isCurrent()).toBe(true);
      const companion = document.createElement('video');
      expect(candidate.captionBinding.isCurrent(companion)).toBe(true);
      expect(candidate.captionBinding.isCurrent(document.createElement('video'))).toBe(false);
      expect(cueRead).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });

    it.each([
      'hidden',
      'disabled',
      'extra-track',
      'other-node-source',
      'native-language',
      'sdk-language',
      'sdk-accessor',
      'unknown-sdk-field',
      'audio-disabled',
      'extra-audio',
      'duration-below',
      'duration-above',
      'not-looping',
      'finite-policy',
      'drm',
      'live',
      'hasCaptions',
      'alternate-captions',
    ])('vetoes %s before returning metadata authority', (change) => {
      const { track, node, audio, record } = captionFixture();
      if (change === 'hidden' || change === 'disabled') {
        track.mode = change;
      }
      if (change === 'extra-track') {
        video.textTracks.push({ ...track });
      }
      if (change === 'other-node-source') {
        node.src = 'data:,WEBVTT%0A';
      }
      if (change === 'native-language') {
        track.language = 'fr';
      }
      if (change === 'sdk-language') {
        record.language = 'fr';
      }
      if (change === 'sdk-accessor') {
        Object.defineProperty(record, 'label', { get: () => 'English' });
      }
      if (change === 'unknown-sdk-field') {
        record.url = sourceUrl;
      }
      if (change === 'audio-disabled') {
        audio.enabled = false;
      }
      if (change === 'extra-audio') {
        video.audioTracks.push({ enabled: false });
      }
      if (change === 'duration-below') {
        property(video, 'duration', 0.9);
      }
      if (change === 'duration-above') {
        property(video, 'duration', 60.001);
      }
      if (change === 'not-looping') {
        state.playback.shouldLoop = false;
      }
      if (change === 'finite-policy') {
        delete props.loop;
        content.forceLoop = true;
        content.maxLoopCount = 2;
      }
      if (change === 'drm') {
        content.drm = true;
      }
      if (change === 'live') {
        state.source.isLive = true;
      }
      if (change === 'hasCaptions') {
        content.hasCaptions = true;
      }
      if (change === 'alternate-captions') {
        content.captionTracks = [{}];
      }
      expect(captioned()).toBeNull();
      expect(resolve()).toBeNull();
    });

    it.each(['mode', 'record', 'array', 'node', 'source', 'session', 'policy', 'audio'])(
      'revokes continuation after %s changes while preserving eligible handback identity',
      (change) => {
        const { track, node, audio } = captionFixture();
        const candidate = captioned();
        expect(candidate.current()).toBe(true);
        if (change === 'mode') {
          track.mode = 'disabled';
        }
        if (change === 'record') {
          state.textTracks.tracks[0] = { ...state.textTracks.tracks[0] };
        }
        if (change === 'array') {
          state.textTracks.tracks = [...state.textTracks.tracks];
        }
        if (change === 'node') {
          node.setAttribute('label', 'changed');
        }
        if (change === 'source') {
          property(video, 'currentSrc', `${blob}changed`);
        }
        if (change === 'session') {
          state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        }
        if (change === 'policy') {
          delete props.loop;
          content.forceLoop = true;
          content.maxLoopCount = 1;
        }
        if (change === 'audio') {
          audio.enabled = false;
        }
        expect(candidate.captionBinding.isCurrent()).toBe(false);
        expect(candidate.identityCurrent()).toBe(!['source', 'session'].includes(change));
        if (change === 'mode') {
          expect(track.mode).toBe('disabled');
        }
      }
    );

    it.each(['initial resolution', 'current continuation'])(
      'rejects a late rendition descriptor changing the SDK session during %s',
      (phase) => {
        captionFixture();
        const candidate = phase === 'current continuation' ? captioned() : null;
        const expected = state.session.id;
        api.getState.mockImplementation(() => {
          state.session.id = expected;
          return state;
        });
        const variants = modern.timeRemainingAccessory.props.media.video_info.variants;
        variants[1] = new Proxy(variants[1], {
          getOwnPropertyDescriptor(target, key) {
            if (key === 'bitrate') {
              state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
        if (candidate) {
          expect(candidate.current()).toBe(false);
        } else {
          expect(captioned()).toBeNull();
        }
        expect(state.session.id).toBe('bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      }
    );

    it.each([
      'caption record',
      'protection',
      'HLS',
      'post',
      'finite policy',
      'method',
      'media protection',
      'variant protection',
      'variant URL',
      'variant entry',
    ])('revokes a late %s change after rendition inspection', (change) => {
      const { record } = captionFixture();
      const candidate = captioned();
      const media = modern.timeRemainingAccessory.props.media;
      const variants = media.video_info.variants;
      variants[2] = new Proxy(variants[2], {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'bitrate') {
            if (change === 'caption record') {
              record.label = 'Other';
            }
            if (change === 'protection') {
              content.drm = true;
            }
            if (change === 'HLS') {
              state.source.src = `${sourceUrl}&changed=1`;
            }
            if (change === 'post') {
              content.sourceId = '2041611432752742402';
            }
            if (change === 'finite policy') {
              delete props.loop;
              content.forceLoop = true;
              content.maxLoopCount = 1;
            }
            if (change === 'method') {
              api.seekTo = vi.fn();
            }
            if (change === 'media protection') {
              media.drm = true;
            }
            if (change === 'variant protection') {
              variants[1].drm = true;
            }
            if (change === 'variant URL') {
              variants[1].url = mp4('1920x1080');
            }
            if (change === 'variant entry') {
              variants[1] = { ...variants[1] };
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      expect(candidate.current()).toBe(false);
    });

    it('retains caption authority through an immutable caption-insets-only SDK update', () => {
      const { record, track } = captionFixture();
      const candidate = captioned();
      const entries = state.textTracks.tracks;
      expect(candidate.current()).toBe(true);
      state = {
        ...state,
        textTracks: { ...state.textTracks, captionInsets: { ownedPlayer: 44 } },
      };
      expect(state.textTracks.tracks).toBe(entries);
      expect(state.textTracks.tracks[0]).toBe(record);
      expect(track.mode).toBe('showing');
      expect(candidate.current()).toBe(true);
    });

    it.each(['add', 'remove', 'replace', 'in-place replace'])(
      'permits only own-data captionInsets %s without changing caption ownership',
      (change) => {
        captionFixture();
        if (change === 'add') {
          delete state.textTracks.captionInsets;
        }
        const candidate = captioned();
        const metadata = { ...state.textTracks };
        if (change === 'remove') {
          delete metadata.captionInsets;
        } else {
          metadata.captionInsets = { panel: 40 };
        }
        if (change === 'in-place replace') {
          state.textTracks.captionInsets = metadata.captionInsets;
        } else {
          state = { ...state, textTracks: metadata };
        }
        expect(candidate.current()).toBe(true);
      }
    );

    it.each([
      'selection',
      'language',
      'unknown field',
      'remove field',
      'descriptor',
      'prototype',
      'accessor inset',
      'inherited inset',
      'tracks',
      'record',
    ])('vetoes %s metadata drift while permitting presentation inset replacement', (change) => {
      captionFixture();
      state.textTracks.activeCaptionTrackId = 0;
      const candidate = captioned();
      const metadata = { ...state.textTracks, captionInsets: { panel: 44 } };
      const getter = vi.fn(() => ({}));
      if (change === 'selection') {
        metadata.activeCaptionTrackId = null;
      }
      if (change === 'language') {
        metadata.preferredLanguage = 'fr';
      }
      if (change === 'unknown field') {
        metadata.unknownCaptionPolicy = true;
      }
      if (change === 'remove field') {
        delete metadata.preferredLanguage;
      }
      if (change === 'descriptor') {
        Object.defineProperty(metadata, 'preferredLanguage', { writable: false });
      }
      if (change === 'prototype') {
        Object.setPrototypeOf(metadata, {});
      }
      if (change === 'accessor inset') {
        Object.defineProperty(metadata, 'captionInsets', { get: getter });
      }
      if (change === 'inherited inset') {
        delete metadata.captionInsets;
        Object.setPrototypeOf(metadata, { captionInsets: {} });
      }
      if (change === 'tracks') {
        metadata.tracks = [...metadata.tracks];
      }
      if (change === 'record') {
        metadata.tracks[0] = { ...metadata.tracks[0] };
      }
      state = { ...state, textTracks: metadata };
      expect(candidate.current()).toBe(false);
      expect(getter).not.toHaveBeenCalled();
    });

    it.each(['selection', 'unknown field', 'descriptor'])(
      'detects in-place %s mutation from the captured initial metadata snapshot',
      (change) => {
        captionFixture();
        state.textTracks.activeCaptionTrackId = 0;
        const candidate = captioned();
        if (change === 'selection') {
          state.textTracks.activeCaptionTrackId = null;
        }
        if (change === 'unknown field') {
          state.textTracks.newPolicy = false;
        }
        if (change === 'descriptor') {
          Object.defineProperty(state.textTracks, 'preferredLanguage', { enumerable: false });
        }
        expect(candidate.current()).toBe(false);
      }
    );

    it('still rejects caption-insets container replacement within a captured SDK read', () => {
      captionFixture();
      const candidate = captioned();
      let reads = 0;
      api.getMediaElement.mockImplementation(() => {
        if (++reads === 2) {
          state.textTracks = { ...state.textTracks, captionInsets: { panel: 8 } };
        }
        return video;
      });
      expect(candidate.current()).toBe(false);
    });

    it('retains full caption authority through an SDK notification at loaded metadata after binding', () => {
      captionFixture();
      property(video, 'readyState', 2);
      property(video, 'seeking', false);
      const candidate = captioned();
      const companion = document.createElement('video');
      expect(candidate.current(companion)).toBe(true);
      let notify;
      store.subscribe.mockImplementation((callback) => {
        notify = callback;
        return () => {};
      });
      const outcomes = [];
      candidate.subscribe(() => outcomes.push(candidate.current(companion)));
      property(video, 'readyState', 1);
      property(video, 'seeking', true);
      notify();
      expect(outcomes).toEqual([true]);
      expect(candidate.captionBinding.isCurrent(companion)).toBe(true);
    });

    it('requires current data for initial caption eligibility and first companion binding', () => {
      captionFixture();
      property(video, 'readyState', 1);
      expect(captioned()).toBeNull();
      property(video, 'readyState', 2);
      const candidate = captioned();
      const companion = document.createElement('video');
      property(video, 'readyState', 1);
      expect(candidate.current()).toBe(false);
      expect(candidate.current(companion)).toBe(false);
      expect(candidate.current(companion)).toBe(false);
      expect(candidate.current()).toBe(false);
      property(video, 'readyState', 2);
      expect(candidate.current(companion)).toBe(true);
      property(video, 'readyState', 1);
      expect(candidate.current()).toBe(true);
      property(video, 'readyState', 0);
      expect(candidate.current()).toBe(false);
      property(video, 'readyState', 2);
      expect(candidate.current()).toBe(true);
    });

    it('does not relax noncaptioned companion eligibility at loaded metadata', () => {
      property(video, 'readyState', 2);
      const candidate = resolve();
      const companion = document.createElement('video');
      expect(candidate.current(companion)).toBe(true);
      property(video, 'readyState', 1);
      expect(candidate.current(companion)).toBe(false);
      expect(resolve()).toBeNull();
    });

    it.each([
      'other companion',
      'adopted companion',
      'source write',
      'session',
      'post',
      'caption mode',
      'caption record',
      'extra captions',
      'DRM',
      'live',
      'finite loop',
      'multiple audio',
      'audio disabled',
      'unknown metadata',
    ])(
      'preserves the full %s guard at metadata readiness for a bound caption companion',
      (change) => {
        const { track, audio } = captionFixture();
        property(video, 'readyState', 2);
        const candidate = captioned();
        const companion = document.createElement('video');
        expect(candidate.current(companion)).toBe(true);
        property(video, 'readyState', 1);
        property(video, 'seeking', true);
        if (change === 'other companion') {
          expect(candidate.current(document.createElement('video'))).toBe(false);
          expect(candidate.current(companion)).toBe(true);
          return;
        }
        if (change === 'adopted companion') {
          document.implementation.createHTMLDocument().adoptNode(companion);
        }
        if (change === 'source write') {
          video.src = `${blob}-changed`;
        }
        if (change === 'session') {
          state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        }
        if (change === 'post') {
          content.sourceId = '2041611432752742402';
        }
        if (change === 'caption mode') {
          track.mode = 'disabled';
        }
        if (change === 'caption record') {
          state.textTracks.tracks[0] = { ...state.textTracks.tracks[0] };
        }
        if (change === 'extra captions') {
          video.textTracks.push({ ...track });
        }
        if (change === 'DRM') {
          content.drm = true;
        }
        if (change === 'live') {
          state.source.live = true;
        }
        if (change === 'finite loop') {
          delete props.loop;
          content.forceLoop = true;
          content.maxLoopCount = 1;
        }
        if (change === 'multiple audio') {
          video.audioTracks.push({ enabled: false });
        }
        if (change === 'audio disabled') {
          audio.enabled = false;
        }
        if (change === 'unknown metadata') {
          state.textTracks.otherPolicy = false;
        }
        expect(candidate.current(companion)).toBe(false);
        expect(candidate.captionBinding.isCurrent(companion)).toBe(false);
      }
    );

    it('does not claim a first companion after an SDK validation throws', () => {
      captionFixture();
      property(video, 'readyState', 2);
      const candidate = captioned();
      api.getState.mockImplementationOnce(() => {
        throw Error('SDK failed');
      });
      expect(candidate.current(document.createElement('video'))).toBe(false);
      expect(candidate.current(document.createElement('video'))).toBe(true);
    });

    it('does not overwrite a different first companion bound by a reentrant SDK callback', () => {
      captionFixture();
      property(video, 'readyState', 2);
      const candidate = captioned();
      const first = document.createElement('video'),
        second = document.createElement('video');
      let nested;
      api.getState.mockImplementationOnce(() => {
        nested = candidate.current(second);
        return state;
      });
      expect(candidate.current(first)).toBe(false);
      expect(nested).toBe(true);
      expect(candidate.current(first)).toBe(false);
      expect(candidate.current(second)).toBe(true);
    });

    it('does not bind a first companion adopted by a page callback during validation', () => {
      captionFixture();
      property(video, 'readyState', 2);
      const candidate = captioned();
      const companion = document.createElement('video');
      api.getMediaElement.mockImplementation(() => {
        document.implementation.createHTMLDocument().adoptNode(companion);
        return video;
      });
      expect(candidate.current(companion)).toBe(false);
      property(video, 'readyState', 1);
      expect(candidate.current()).toBe(false);
    });

    it('checks the exact binding again after a current SDK callback changes native mode', () => {
      const { track } = captionFixture();
      const candidate = captioned();
      api.getMediaElement.mockImplementation(() => {
        track.mode = 'disabled';
        return video;
      });
      expect(candidate.current()).toBe(false);
      expect(track.mode).toBe('disabled');
    });

    it.each(['React root', 'hook link'])('rejects %s detachment inside an SDK getter', (change) => {
      captionFixture();
      api.getState.mockImplementation(() => {
        if (change === 'React root') {
          property(parent, '__reactFiber$fixture', {
            memoizedState: null,
            memoizedProps: {},
            return: null,
          });
        } else {
          hooks[0].next = null;
        }
        return state;
      });
      expect(captioned()).toBeNull();
    });

    it('rejects native caption metadata accessors without invoking them', () => {
      const { track } = captionFixture();
      const getter = vi.fn(() => 'en');
      Object.defineProperty(track, 'language', { get: getter });
      expect(captioned()).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    });

    it('rejects two distinct creator fibers exposing the same SDK', () => {
      captionFixture();
      fiber.return.return = {
        memoizedState: { memoizedState: sdk, next: null },
        memoizedProps: props,
        return: null,
      };
      expect(captioned()).toBeNull();
    });
  });

  describe('finite captioned native presentation certificate', () => {
    const native = () => window.VSC.TwitterPlayer.resolveNativePresentation(video);
    let fixture;
    beforeEach(() => {
      fixture = nativePresentationFixture();
    });

    it.each([true, false])(
      'exposes a frozen narrow certificate and pure activation while paused=%s',
      (paused) => {
        property(video, 'paused', paused);
        const play = vi.spyOn(video, 'play'),
          pause = vi.spyOn(video, 'pause'),
          load = vi.spyOn(video, 'load');
        const originalParent = video.parentNode,
          src = video.src,
          mode = fixture.track.mode;
        const certificate = native();
        expect(Object.isFrozen(certificate)).toBe(true);
        expect(Object.keys(certificate).sort()).toEqual([
          'activate',
          'current',
          'element',
          'subscribe',
        ]);
        expect(certificate.element).toBe(fixture.element);
        expect(certificate.current()).toBe(true);
        expect(certificate.activate()).toBe(true);
        expect(video.parentNode).toBe(originalParent);
        expect(video.src).toBe(src);
        expect(video.paused).toBe(paused);
        expect(fixture.track.mode).toBe(mode);
        expect(video.loop).toBe(false);
        expect(fixture.notifyPlay).not.toHaveBeenCalled();
        expect(api.seekTo).not.toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
        expect(pause).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
        expect(resolve()).toBeNull();
        expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
      }
    );

    function missingCatalog() {
      delete modern.downloadUrl;
      delete modern.poppedOutSource.playerProps.downloadUrl;
      const media = modern.timeRemainingAccessory.props.media;
      delete media.video_info;
      delete media.video_download_url;
      video.removeAttribute('src');
      const source = document.createElement('source');
      source.src = blob;
      source.type = 'video/mp4';
      video.prepend(source);
      return { source, media };
    }

    it('certifies the unchanged captioned child-source renderer without an alternate-rendition catalog', () => {
      const { source } = missingCatalog();
      property(video, 'paused', false);
      const play = vi.spyOn(video, 'play'),
        pause = vi.spyOn(video, 'pause'),
        load = vi.spyOn(video, 'load');
      const certificate = window.VSC.TwitterPlayer.resolveNativePresentation(
        video,
        video.parentNode
      );
      expect(certificate?.element).toBe(fixture.element);
      expect(certificate?.current()).toBe(true);
      expect(certificate?.activate()).toBe(true);
      expect(resolve()).toBeNull();
      expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
      expect(video.getAttribute('src')).toBeNull();
      expect(video.firstElementChild).toBe(source);
      expect(fixture.track.mode).toBe('showing');
      expect(fixture.notifyPlay).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      source.type = 'application/x-mpegURL';
      expect(certificate.current()).toBe(false);
    });

    it('certifies a finite zero-caption native renderer while preserving the transport catalog veto', () => {
      missingCatalog();
      fixture.node.remove();
      property(video, 'textTracks', []);
      state.textTracks.tracks = [];
      property(video, 'duration', 1193.435);
      content.durationMs = 1193400;
      state.source.playlistDurationSec = 1193.4;
      const certificate = native();
      expect(certificate?.element).toBe(fixture.element);
      expect(certificate?.current()).toBe(true);
      expect(certificate?.activate()).toBe(true);
      expect(resolve()).toBeNull();
      expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
      property(video, 'readyState', 1);
      expect(certificate.current()).toBe(true);
      state.textTracks.tracks.push(fixture.record);
      expect(certificate.current()).toBe(false);
      expect(native()).toBeNull();
    });

    it.each([
      'media DRM',
      'accessory live',
      'alternate audio',
      'conflicting content',
      'conflicting source',
      'conflicting duration',
      'foreign download',
      'accessor info',
      'inherited info',
      'multiple SDK tracks',
      'multiple native tracks',
      'foreign variant',
      'late session',
    ])('retains full native authority without a catalog: %s vetoes', (change) => {
      const { media } = missingCatalog();
      const certificate = native();
      expect(certificate?.current()).toBe(true);
      const getter = vi.fn();
      if (change === 'media DRM') {
        media.drm = true;
      }
      if (change === 'accessory live') {
        modern.timeRemainingAccessory.live = true;
      }
      if (change === 'alternate audio') {
        media.alternateAudioTracks = [{}];
      }
      if (change === 'conflicting content') {
        media.id_str = '2041611432752742402';
      }
      if (change === 'conflicting source') {
        modern.poppedOutSource.playerProps.src = `${sourceUrl}&other=1`;
      }
      if (change === 'conflicting duration') {
        media.video_info = { duration_millis: 400000 };
      }
      if (change === 'foreign download') {
        modern.downloadUrl = mp4('1280x720').replace(contentId, '2041611432752742402');
      }
      if (change === 'accessor info') {
        Object.defineProperty(media, 'video_info', { get: getter });
      }
      if (change === 'inherited info') {
        Object.setPrototypeOf(media, { video_info: {} });
      }
      if (change === 'multiple SDK tracks') {
        state.textTracks.tracks.push({ ...fixture.record });
      }
      if (change === 'multiple native tracks') {
        video.textTracks.push({ ...fixture.track });
      }
      if (change === 'foreign variant') {
        media.video_info = {
          variants: [
            {
              content_type: 'video/mp4',
              url: mp4('1280x720').replace(contentId, '2041611432752742402'),
            },
          ],
        };
      }
      if (change === 'late session') {
        const expected = state.session.id;
        api.getState.mockImplementation(() => {
          state.session.id = expected;
          return state;
        });
        media.video_info = new Proxy(
          {},
          {
            getOwnPropertyDescriptor(target, key) {
              if (key === 'variants') {
                state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
              }
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          }
        );
      }
      expect(certificate.current()).toBe(false);
      expect(native()).toBeNull();
      expect(getter).not.toHaveBeenCalled();
      expect(fixture.notifyPlay).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
    });

    it('accepts the real UI call with the exact current parent without requiring a portal owner', () => {
      video.vsc = { iosPlayer: { active: false } };
      expect(video.vsc.iosPlayer?.active).not.toBe(true);
      const certificate = window.VSC.TwitterPlayer.resolveNativePresentation(
        video,
        video.parentNode
      );
      expect(certificate?.element).toBe(fixture.element);
      expect(certificate?.current()).toBe(true);
      video.vsc.iosPlayer = { active: true, video };
      expect(certificate.current()).toBe(true);
      expect(window.VSC.TwitterPlayer.resolveNativePresentation(video, fixture.element)).toBeNull();
    });

    it('retains bound full authority at metadata readiness and accepts only UI descendants', () => {
      const certificate = native();
      const host = document.createElement('div');
      host.append(document.createElement('button'));
      fixture.element.append(host);
      property(video, 'readyState', 1);
      property(video, 'seeking', true);
      expect(certificate.current()).toBe(true);
      expect(certificate.activate()).toBe(true);
      property(video, 'readyState', 0);
      expect(certificate.current()).toBe(false);
      property(video, 'readyState', 2);
      expect(certificate.current()).toBe(true);
      host.append(document.createElement('video'));
      expect(certificate.current()).toBe(false);
    });

    it.each([
      'initial ready1',
      'duration over',
      'duration below',
      'no captions',
      'hidden captions',
      'native loop',
      'SDK loop',
      'DRM',
      'live',
      'audio disabled',
      'multiple audio',
      'ambiguous registry',
      'registry accessor',
      'snapshot mismatch',
    ])('rejects %s without widening existing transport eligibility', (change) => {
      const getter = vi.fn();
      if (change === 'initial ready1') {
        property(video, 'readyState', 1);
      }
      if (change === 'duration over') {
        property(video, 'duration', 3600.001);
      }
      if (change === 'duration below') {
        property(video, 'duration', 0.9);
      }
      if (change === 'no captions') {
        video.textTracks.length = 0;
      }
      if (change === 'hidden captions') {
        fixture.track.mode = 'hidden';
      }
      if (change === 'native loop') {
        video.loop = true;
      }
      if (change === 'SDK loop') {
        state.playback.shouldLoop = true;
      }
      if (change === 'DRM') {
        content.drm = true;
      }
      if (change === 'live') {
        state.source.live = true;
      }
      if (change === 'audio disabled') {
        fixture.audio.enabled = false;
      }
      if (change === 'multiple audio') {
        video.audioTracks.push({ enabled: false });
      }
      if (change === 'ambiguous registry') {
        fixture.entries.set('duplicate', { ...fixture.entry, instanceId: 'duplicate' });
      }
      if (change === 'registry accessor') {
        Object.defineProperty(fixture.entry, 'element', { get: getter });
      }
      if (change === 'snapshot mismatch') {
        store.getSnapshot.mockReturnValue({ ...state });
      }
      expect(native()).toBeNull();
      expect(getter).not.toHaveBeenCalled();
      expect(fixture.notifyPlay).not.toHaveBeenCalled();
      expect(resolve()).toBeNull();
      expect(window.VSC.TwitterPlayer.resolveCaptionedLoop(video)).toBeNull();
    });

    it.each([
      'source',
      'session',
      'post',
      'caption mode',
      'caption record',
      'DRM',
      'live',
      'native loop',
      'SDK loop',
      'registry entry',
      'container parent',
    ])('revokes current presentation for %s drift', (change) => {
      const certificate = native();
      if (change === 'source') {
        video.src = 'blob:https://x.com/other';
      }
      if (change === 'session') {
        state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      }
      if (change === 'post') {
        content.sourceId = content.tweetId = '2041611432752742402';
        props.hostKey = `${content.sourceId}:${contentId}`;
        modern.poppedOutSource.hostKey = props.hostKey;
      }
      if (change === 'caption mode') {
        fixture.track.mode = 'disabled';
      }
      if (change === 'caption record') {
        state.textTracks.tracks[0] = { ...state.textTracks.tracks[0] };
      }
      if (change === 'DRM') {
        content.drm = true;
      }
      if (change === 'live') {
        state.source.live = true;
      }
      if (change === 'native loop') {
        video.loop = true;
      }
      if (change === 'SDK loop') {
        state.playback.shouldLoop = true;
      }
      if (change === 'registry entry') {
        fixture.entries.set(fixture.entry.instanceId, { ...fixture.entry });
      }
      if (change === 'container parent') {
        const other = document.createElement('div');
        document.body.append(other);
        other.append(fixture.element);
      }
      expect(certificate.current()).toBe(false);
      expect(certificate.activate()).toBe(false);
      expect(fixture.notifyPlay).not.toHaveBeenCalled();
    });

    it('preserves presentation through caption-inset-only immutable SDK updates', () => {
      const certificate = native();
      state = { ...state, textTracks: { ...state.textTracks, captionInsets: { owned: 44 } } };
      expect(certificate.current()).toBe(true);
    });

    it('subscribes once, revalidates while paused and disposes without late callbacks', () => {
      let notify;
      const dispose = vi.fn();
      store.subscribe.mockImplementation((callback) => {
        notify = callback;
        return dispose;
      });
      property(video, 'paused', true);
      const certificate = native(),
        callback = vi.fn();
      const release = certificate.subscribe(callback);
      expect(typeof release).toBe('function');
      expect(certificate.subscribe(vi.fn())).toBeNull();
      notify();
      expect(callback).toHaveBeenLastCalledWith(true);
      state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      notify();
      expect(callback).toHaveBeenLastCalledWith(false);
      release();
      release();
      notify();
      expect(dispose).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('cleans a subscription invalidated synchronously during SDK installation', () => {
      const dispose = vi.fn();
      store.subscribe.mockImplementation((callback) => {
        state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        callback();
        return dispose;
      });
      const certificate = native(),
        callback = vi.fn();
      expect(certificate.subscribe(callback)).toBeNull();
      expect(dispose).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenLastCalledWith(false);
    });

    it('rechecks source authority after the last registry descriptor read before publication', () => {
      const original = fixture.entry;
      fixture.entries.set(
        original.instanceId,
        new Proxy(original, {
          getOwnPropertyDescriptor(target, key) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            if (key === 'instanceId') {
              state.source.live = true;
            }
            return descriptor;
          },
        })
      );
      expect(native()).toBeNull();
      expect(fixture.notifyPlay).not.toHaveBeenCalled();
    });
  });
});

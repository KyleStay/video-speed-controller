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
    props = { content, hostKey: `${postId}:${contentId}`, src: sourceUrl, preroll: undefined };
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

  describe('current SDK with no countdown accessory', () => {
    let accessory;

    beforeEach(() => {
      accessory = modern.timeRemainingAccessory;
      delete modern.timeRemainingAccessory;
    });

    it('resolves the observed explicit child-source presentation from the exact bound download', () => {
      video.removeAttribute('src');
      const source = document.createElement('source');
      source.src = blob;
      video.append(source);
      const load = vi.spyOn(video, 'load');
      const play = vi.spyOn(video, 'play');
      const pause = vi.spyOn(video, 'pause');
      expect(resolve()).toBeNull();
      const candidate = window.VSC.TwitterPlayer.resolve(video, null, { allowSourceChild: true });
      expect(candidate).toMatchObject({
        originalUrl: blob,
        sourceNode: source,
        progressiveUrl: modern.downloadUrl,
        sdk,
        api,
        store,
      });
      expect(candidate.current()).toBe(true);
      expect(candidate.identityCurrent()).toBe(true);
      expect(video.hasAttribute('src')).toBe(false);
      expect(source.src).toBe(blob);
      expect(load).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      expect(api.seekTo).not.toHaveBeenCalled();
      expect(store.subscribe).not.toHaveBeenCalled();
    });

    it.each(['undefined', 'null', 'empty', 'missing-variants', 'protected-media', 'stale-hls'])(
      'does not bypass a declared %s accessory',
      (kind) => {
        modern.timeRemainingAccessory = accessory;
        if (kind === 'undefined') {
          modern.timeRemainingAccessory = undefined;
        } else if (kind === 'null') {
          modern.timeRemainingAccessory = null;
        } else if (kind === 'empty') {
          modern.timeRemainingAccessory = {};
        } else if (kind === 'missing-variants') {
          delete accessory.props.media.video_info.variants;
        } else if (kind === 'protected-media') {
          accessory.props.media.hasCaptions = true;
        } else {
          accessory.props.media.video_info.variants[0].url += '&stale=1';
        }
        expect(resolve()).toBeNull();
      }
    );

    it.each(['undefined', 'null', 'valid', 'accessor'])(
      'rejects an inherited %s accessory without invoking it',
      (kind) => {
        const getter = vi.fn(() => accessory);
        const prototype = {};
        if (kind === 'accessor') {
          Object.defineProperty(prototype, 'timeRemainingAccessory', { get: getter });
        } else {
          prototype.timeRemainingAccessory =
            kind === 'valid' ? accessory : kind === 'null' ? null : undefined;
        }
        Object.setPrototypeOf(modern, prototype);
        expect(resolve()).toBeNull();
        expect(getter).not.toHaveBeenCalled();
      }
    );

    it('rejects a declared accessory getter without invoking it', () => {
      const getter = vi.fn(() => accessory);
      Object.defineProperty(modern, 'timeRemainingAccessory', { get: getter, configurable: true });
      expect(resolve()).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    });

    it.each([
      'missing-download',
      'foreign-asset',
      'foreign-host',
      'foreign-type',
      'host-key',
      'source',
      'content',
      'download-pair',
    ])('requires every bound current download field after %s changes', (kind) => {
      const supplied = modern.poppedOutSource.playerProps;
      if (kind === 'missing-download') {
        delete modern.downloadUrl;
        delete supplied.downloadUrl;
      } else if (kind === 'foreign-asset') {
        modern.downloadUrl = mp4('1920x1080').replace(contentId, '999');
        supplied.downloadUrl = modern.downloadUrl;
      } else if (kind === 'foreign-host') {
        modern.downloadUrl = mp4('1920x1080').replace('video.twimg.com', 'example.com');
        supplied.downloadUrl = modern.downloadUrl;
      } else if (kind === 'foreign-type') {
        modern.downloadUrl = mp4('1920x1080').replace('amplify_video', 'ext_tw_video');
        supplied.downloadUrl = modern.downloadUrl;
      } else if (kind === 'host-key') {
        modern.poppedOutSource.hostKey = 'other';
      } else if (kind === 'source') {
        supplied.src = `${sourceUrl}&other=1`;
      } else if (kind === 'content') {
        supplied.content = { ...content };
      } else {
        supplied.downloadUrl = mp4('640x360');
      }
      expect(resolve()).toBeNull();
    });

    it.each(['sdk', 'controller', 'state', 'content', 'source', 'modern', 'popped', 'supplied'])(
      'retains the caption capability veto on %s',
      (role) => {
        const target = {
          sdk,
          controller: sdk.controller,
          state,
          content,
          source: state.source,
          modern,
          popped: modern.poppedOutSource,
          supplied: modern.poppedOutSource.playerProps,
        }[role];
        target.hasCaptions = true;
        expect(resolve()).toBeNull();
      }
    );

    it.each(['alternateAudioTracks', 'alternateVideoTracks', 'captionTracks'])(
      'retains the alternate-track veto for %s',
      (key) => {
        modern.poppedOutSource.playerProps[key] = [{}];
        expect(resolve()).toBeNull();
      }
    );

    it.each(['sdk-captions', 'native-caption', 'drm', 'live', 'ambiguous-sdk'])(
      'retains the original %s safeguard',
      (kind) => {
        if (kind === 'sdk-captions') {
          state.textTracks.tracks.push({ kind: 'captions' });
        } else if (kind === 'native-caption') {
          video.append(document.createElement('track'));
        } else if (kind === 'drm') {
          content.keySystems = {};
        } else if (kind === 'live') {
          state.source.live = true;
        } else {
          hooks[10].memoizedState = { ...sdk };
        }
        expect(resolve()).toBeNull();
      }
    );

    it('keeps native-HLS recovery bound to the same SDK download and capability checks', () => {
      video.src = sourceUrl;
      property(video, 'currentSrc', sourceUrl);
      const candidate = window.VSC.TwitterPlayer.findNativeHlsCandidate(video);
      expect(candidate).toMatchObject({
        originalUrl: sourceUrl,
        progressiveUrl: modern.downloadUrl,
      });
      video.src = modern.downloadUrl;
      property(video, 'currentSrc', modern.downloadUrl);
      expect(candidate.revalidate()).toBe(true);
      state.textTracks.tracks.push({ kind: 'captions' });
      expect(candidate.revalidate()).toBe(false);
    });

    it('invalidates continued ownership when a declared bad accessory arrives', () => {
      const candidate = resolve();
      expect(candidate.current()).toBe(true);
      modern.timeRemainingAccessory = null;
      expect(candidate.current()).toBe(false);
      expect(candidate.identityCurrent()).toBe(true);
    });

    it.each(['session', 'content', 'sdk', 'download'])(
      'revalidates the retained current %s identity',
      (kind) => {
        const candidate = resolve();
        if (kind === 'session') {
          state.session.id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
        } else if (kind === 'content') {
          state.content = { ...content };
        } else if (kind === 'sdk') {
          hooks[11].memoizedState = { ...sdk };
        } else {
          modern.downloadUrl = mp4('640x360');
          modern.poppedOutSource.playerProps.downloadUrl = modern.downloadUrl;
        }
        expect(candidate.current()).toBe(false);
        expect(candidate.identityCurrent()).toBe(kind === 'download');
      }
    );
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
  describe('retained native-HLS recovery capability', () => {
    function retained() {
      video.src = sourceUrl;
      property(video, 'currentSrc', sourceUrl);
      const candidate = window.VSC.TwitterPlayer.findNativeHlsCandidate(video);
      expect(candidate).toBeTruthy();
      video.src = candidate.progressiveUrl;
      property(video, 'currentSrc', candidate.progressiveUrl);
      return candidate;
    }
    it('keeps a nonenumerable validator bound to the supplied MP4 and current SDK', () => {
      const candidate = retained();
      expect(Object.keys(candidate)).not.toContain('revalidate');
      expect(candidate.revalidate()).toBe(true);
      state.hasCaptions = true;
      expect(candidate.revalidate()).toBe(false);
    });
    it('permits only a requested reload readiness reset without dropping capability checks', () => {
      const candidate = retained();
      property(video, 'currentSrc', '');
      property(video, 'readyState', 0);
      property(video, 'duration', NaN);
      expect(candidate.revalidate()).toBe(false);
      expect(candidate.revalidate(true)).toBe(true);
      state.textTracks.tracks.push({ kind: 'captions' });
      expect(candidate.revalidate(true)).toBe(false);
    });
    it('rejects changed SDK session or supplied source ownership', () => {
      const candidate = retained();
      state.session.id = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
      expect(candidate.revalidate()).toBe(false);
      state.session.id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      video.src = mp4('640x360');
      expect(candidate.revalidate()).toBe(false);
    });
  });
});

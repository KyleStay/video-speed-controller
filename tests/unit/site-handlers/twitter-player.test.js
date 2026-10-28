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
});

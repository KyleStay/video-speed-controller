describe('same-item progressive media source resolution', () => {
  const HLS = 'https://stream.example.test/asset/master.m3u8?signature=original';
  const MP4 = 'https://files.example.test/asset/720.mp4?signature=progressive';
  let video, scope, state, originalVideoJS, originalJW;
  const pair = () => [
    { src: HLS, type: 'application/vnd.apple.mpegurl' },
    { src: MP4, type: 'video/mp4', height: 720 },
  ];
  const find = (origin) => window.VSC.ProgressiveMediaSource.findCandidate(video, origin);
  function videoJS(sources = pair()) {
    scope.id = 'video-player';
    scope.className = 'video-js';
    const player = { el: () => scope, currentSources: vi.fn(() => sources) };
    window.videojs = { getPlayer: vi.fn(() => player) };
    return player;
  }
  function jw(sources = pair().map(({ src: file, ...rest }) => ({ file, ...rest }))) {
    scope.id = 'jw-player';
    scope.className = 'jwplayer';
    const item = { sources };
    const player = { getContainer: () => scope, getPlaylistItem: vi.fn(() => item) };
    window.jwplayer = vi.fn(() => player);
    return { player, item };
  }
  function html(sources = pair()) {
    for (const source of sources) {
      const child = document.createElement('source');
      child.src = source.src;
      child.type = source.type;
      video.append(child);
    }
  }
  beforeEach(() => {
    originalVideoJS = window.videojs;
    originalJW = window.jwplayer;
    document.body.replaceChildren();
    scope = document.createElement('div');
    video = document.createElement('video');
    scope.append(video);
    document.body.append(scope);
    video.src = HLS;
    state = { currentSrc: HLS, duration: 120 };
    for (const key of Object.keys(state)) {
      Object.defineProperty(video, key, { configurable: true, get: () => state[key] });
    }
    delete window.videojs;
    delete window.jwplayer;
  });
  afterEach(() => {
    if (originalVideoJS === undefined) {
      delete window.videojs;
    } else {
      window.videojs = originalVideoJS;
    }
    if (originalJW === undefined) {
      delete window.jwplayer;
    } else {
      window.jwplayer = originalJW;
    }
    vi.restoreAllMocks();
  });

  it('resolves declared HTML alternatives without loading, playing or changing media', () => {
    html();
    video.removeAttribute('src');
    const load = vi.spyOn(video, 'load'),
      play = vi.spyOn(video, 'play');
    expect(find()).toEqual({ originalUrl: HLS, progressiveUrl: MP4, provider: 'html' });
    expect(video.currentSrc).toBe(HLS);
    expect(video.hasAttribute('src')).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });
  it('uses explicit alternatives alongside a direct active src', () => {
    html();
    expect(find()?.progressiveUrl).toBe(MP4);
  });
  it('honors a source media condition instead of choosing an ineligible alternative', () => {
    html();
    video.lastChild.media = '(min-width: 9000px)';
    const previous = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: false }));
    try {
      expect(find()).toBeNull();
    } finally {
      window.matchMedia = previous;
    }
  });
  it('matches the active HLS entry in Video.js/Brightcove currentSources', () => {
    const player = videoJS();
    expect(find()).toEqual({ originalUrl: HLS, progressiveUrl: MP4, provider: 'videojs' });
    expect(window.videojs.getPlayer).toHaveBeenCalledExactlyOnceWith('video-player');
    expect(player.currentSources).toHaveBeenCalledOnce();
  });
  it('supports the recorded Brightcove source shape and skips insecure duplicates', () => {
    videoJS([
      ...pair(),
      { src: MP4.replace('https:', 'http:'), type: 'video/mp4', height: 1080 },
      { src: 'https://stream.example.test/asset/manifest.mpd', type: 'application/dash+xml' },
    ]);
    expect(find()?.progressiveUrl).toBe(MP4);
  });
  it('resolves same-item JW Player sources and prefers the best supplied rate up to 720p', () => {
    jw([
      { file: HLS, type: 'hls' },
      { file: 'https://files.example.test/asset/1080.mp4', type: 'video/mp4', label: '1080p' },
      { file: MP4, type: 'mp4', label: '720p' },
      { file: 'https://files.example.test/asset/360.mp4', type: 'video/mp4', label: '360p' },
    ]);
    expect(find()).toEqual({ originalUrl: HLS, progressiveUrl: MP4, provider: 'jwplayer' });
  });
  it('uses the smallest known rendition when every supplied MP4 is above 720p', () => {
    videoJS([
      pair()[0],
      { src: 'https://files.example.test/asset/4k.mp4', type: 'video/mp4', height: 2160 },
      { src: MP4, type: 'video/mp4', height: 1080 },
    ]);
    expect(find()?.progressiveUrl).toBe(MP4);
  });
  it('uses the short axis for portrait resolution limits', () => {
    videoJS([
      pair()[0],
      {
        src: 'https://files.example.test/asset/full.mp4',
        type: 'video/mp4',
        width: 1080,
        height: 1920,
      },
      { src: MP4, type: 'video/mp4', width: 720, height: 1280 },
    ]);
    expect(find()?.progressiveUrl).toBe(MP4);
  });
  it.each(['videojs', 'jwplayer'])(
    'rejects a %s instance belonging to another container',
    (kind) => {
      if (kind === 'videojs') {
        videoJS().el = () => document.body;
      } else {
        jw().player.getContainer = () => document.body;
      }
      expect(find()).toBeNull();
    }
  );
  it.each(['videojs', 'jwplayer'])('does not select a different item from %s', (kind) => {
    const sources = [{ src: `${HLS}&different=1`, type: 'application/x-mpegURL' }, pair()[1]];
    if (kind === 'videojs') {
      videoJS(sources);
    } else {
      jw(sources.map(({ src: file, ...rest }) => ({ file, ...rest })));
    }
    expect(find()).toBeNull();
  });
  it.each(['isInAdMode', 'inAdBreak'])('keeps a Video.js %s session unchanged', (method) => {
    const player = videoJS();
    player.ads = { [method]: () => true };
    expect(find()).toBeNull();
    expect(player.currentSources).not.toHaveBeenCalled();
  });
  it('preserves not-yet-loaded Brightcove caption tracks', () => {
    const player = videoJS();
    player.mediainfo = { text_tracks: [{ kind: 'captions', srclang: 'en' }] };
    expect(find()).toBeNull();
  });
  it.each(['videojs', 'jwplayer'])(
    'retains explicitly external %s metadata without treating it as in-band captions',
    (provider) => {
      const tracks = [
        { kind: 'metadata', label: 'thumbnails', src: 'https://files.example.test/thumbnails.vtt' },
      ];
      if (provider === 'videojs') {
        videoJS().mediainfo = { text_tracks: tracks };
      } else {
        jw().item.tracks = tracks;
      }
      expect(find()?.provider).toBe(provider);
      expect(tracks[0].src).toBe('https://files.example.test/thumbnails.vtt');
    }
  );
  it.each([
    { kind: 'metadata' },
    { kind: 'metadata', src: ['javascript', 'bad'].join(':') },
    { kind: 'captions', src: 'https://files.example.test/captions.vtt' },
  ])('keeps unknown or caption SDK tracks (%j)', (track) => {
    videoJS().mediainfo = { text_tracks: [track] };
    expect(find()).toBeNull();
  });
  it.each(['drm', 'key_systems', 'ssai', 'live'])('keeps %s source metadata unchanged', (key) => {
    const sources = pair();
    sources[0][key] = {};
    videoJS(sources);
    expect(find()).toBeNull();
  });
  it.each([{ tracks: [{}] }, { streamtype: 'live' }, { drm: {} }, { ssai: {} }])(
    'preserves JW item capabilities (%j)',
    (extra) => {
      Object.assign(jw().item, extra);
      expect(find()).toBeNull();
    }
  );
  it('rejects a shared player scope containing another media element', () => {
    videoJS();
    scope.append(document.createElement('video'));
    expect(find()).toBeNull();
  });
  it('handles throwing page APIs and metadata accessors without propagating failures', () => {
    const player = videoJS();
    player.currentSources.mockImplementation(() => {
      throw Error('site API');
    });
    expect(find()).toBeNull();
    const sources = pair(),
      getter = vi.fn(() => {
        throw Error('getter');
      });
    Object.defineProperty(sources[1], 'src', { get: getter });
    player.currentSources.mockReturnValue(sources);
    expect(find()).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
  it('bounds source arrays before visiting entries', () => {
    const sources = Array(33).fill(pair()[1]),
      getter = vi.fn();
    Object.defineProperty(sources, '0', { get: getter });
    videoJS(sources);
    expect(find()).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
  it('never evaluates unrelated player globals or scans registry entries', () => {
    const getter = vi.fn(() => {
      throw Error('unrelated global');
    });
    Object.defineProperty(window, 'playerConfig', { configurable: true, get: getter });
    try {
      expect(find()).toBeNull();
      expect(getter).not.toHaveBeenCalled();
    } finally {
      delete window.playerConfig;
    }
  });
  it.each([
    'blob:https://example.test/media',
    'http://stream.example.test/asset/master.m3u8',
    'data:video/mp4;base64,AAAA',
  ])('does not replace unsupported active source %s', (src) => {
    videoJS();
    state.currentSrc = src;
    video.src = src;
    expect(find()).toBeNull();
    expect(window.videojs.getPlayer).not.toHaveBeenCalled();
  });
  it.each([
    'http://files.example.test/video.mp4',
    ['javascript', 'alert(1)'].join(':'),
    'https://user:password@files.example.test/video.mp4',
    'https://files.example.test/video.mp4#other',
  ])('rejects unsafe explicit alternatives %s', (src) => {
    videoJS([pair()[0], { src, type: 'video/mp4' }]);
    expect(find()).toBeNull();
  });
  it('does not override a newer site source or removed source intent while currentSrc is stale', () => {
    videoJS();
    video.src = 'https://stream.example.test/next.m3u8';
    expect(find()).toBeNull();
    video.removeAttribute('src');
    expect(find()).toBeNull();
  });
  it('resolves an owned-player portal only through its live original anchor', () => {
    videoJS();
    const anchor = document.createComment('origin');
    scope.append(anchor);
    const host = document.createElement('div');
    document.body.append(host);
    host.append(video);
    video.vsc = { iosPlayer: { active: true, video, originParent: scope, anchor } };
    expect(find(scope)?.provider).toBe('videojs');
    anchor.remove();
    expect(find(scope)).toBeNull();
  });
  it('resolves the retained whole Video.js container after owned-player entry', () => {
    videoJS();
    const parent = document.createElement('div');
    document.body.append(parent);
    parent.append(scope);
    const anchor = document.createComment('origin');
    parent.append(anchor);
    const portal = document.createElement('div');
    document.body.append(portal);
    portal.append(scope);
    video.vsc = { iosPlayer: { active: true, video, originParent: parent, anchor } };
    expect(find(parent)?.provider).toBe('videojs');
    anchor.remove();
    expect(find(parent)).toBeNull();
  });
  it.each(['ad', 'captions', 'drm', 'source-drm', 'jw-tracks', 'jw-ssai'])(
    'does not bypass %s publisher restrictions through retained HTML sources',
    (restriction) => {
      html();
      if (restriction.startsWith('jw-')) {
        const { item } = jw();
        Object.assign(item, restriction === 'jw-tracks' ? { tracks: [{}] } : { ssai: {} });
      } else {
        const player = videoJS();
        if (restriction === 'ad') {
          player.ads = { isInAdMode: () => true };
        }
        if (restriction === 'captions') {
          player.mediainfo = { text_tracks: [{}] };
        }
        if (restriction === 'drm') {
          player.mediainfo = { drm: {} };
        }
        if (restriction === 'source-drm') {
          player.currentSources.mockReturnValue([{ ...pair()[0], drm: {} }, pair()[1]]);
        }
      }
      expect(find()).toBeNull();
    }
  );
  it('identifies only the existing same-player programmatic metadata proxy track', () => {
    const player = videoJS();
    const track = { kind: 'metadata', label: 'media-cues', inBandMetadataTrackDispatchType: '' };
    Object.defineProperty(video, 'textTracks', { configurable: true, value: [track] });
    const proxy = { player_: player, type_: 'media', track_: track };
    player.proxyTracks_ = { media: proxy };
    expect(find()?.persistentMetadataTrack).toBe(track);
    proxy.player_ = {};
    expect(find()?.persistentMetadataTrack).toBeUndefined();
    proxy.player_ = player;
    track.inBandMetadataTrackDispatchType = 'com.apple.metadata';
    expect(find()?.persistentMetadataTrack).toBeUndefined();
    track.inBandMetadataTrackDispatchType = '';
    Object.defineProperty(proxy, 'track_', {
      get: () => {
        throw Error('getter');
      },
    });
    expect(find()?.persistentMetadataTrack).toBeUndefined();
  });
  it('uses JW allSources for the current item after sources is normalized to HLS only', () => {
    const { item } = jw([pair()[0]]);
    item.allSources = pair().map(({ src: file, ...rest }) => ({ file, ...rest }));
    expect(find()?.progressiveUrl).toBe(MP4);
    item.allSources[0].file += '&other=1';
    expect(find()).toBeNull();
    item.allSources = Array(33).fill({ file: MP4, type: 'mp4' });
    expect(find()).toBeNull();
  });
});

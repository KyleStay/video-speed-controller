import '../../../src/site-handlers/twitter-media-source.js';

describe('TwitterMediaSource', () => {
  const originalUrl =
    'https://video.twimg.com/amplify_video/2041611432752742400/pl/OJFA7eAdt1CV9YgM.m3u8?tag=21&v=87a';
  const progressiveUrl =
    'https://video.twimg.com/amplify_video/2041611432752742400/vid/avc1/1920x1080/oK7YYmqZfrOjsrWa.mp4?tag=21';
  let video;
  let parent;
  const property = (node, key, value) =>
    Object.defineProperty(node, key, { configurable: true, value });
  const metadata = (value, node = parent) => property(node, '__reactProps$fixture', value);
  const pair = () => ({ src: originalUrl, downloadUrl: progressiveUrl });
  const find = () => window.VSC.TwitterMediaSource.findCandidate(video);
  // Renditions recorded in tweet-public-metadata.json; its HLS query differs
  // from the logged-out React player and must match currentSrc independently.
  const publicHls = originalUrl.replace('?tag=21&v=87a', '?v=87a');
  const publicVariants = () => [
    { content_type: 'application/x-mpegURL', url: publicHls },
    {
      bitrate: 256000,
      content_type: 'video/mp4',
      url: 'https://video.twimg.com/amplify_video/2041611432752742400/vid/avc1/480x270/zYpFI1823e04K0Wr.mp4',
    },
    {
      bitrate: 832000,
      content_type: 'video/mp4',
      url: 'https://video.twimg.com/amplify_video/2041611432752742400/vid/avc1/640x360/JUH4QnAG71LFfVji.mp4',
    },
    {
      bitrate: 2176000,
      content_type: 'video/mp4',
      url: 'https://video.twimg.com/amplify_video/2041611432752742400/vid/avc1/1280x720/aTg4GLUneEKKiMmS.mp4',
    },
    { bitrate: 10368000, content_type: 'video/mp4', url: progressiveUrl.replace('?tag=21', '') },
  ];

  beforeEach(() => {
    document.body.replaceChildren();
    parent = document.createElement('div');
    video = document.createElement('video');
    parent.append(video);
    document.body.append(parent);
    property(video, 'currentSrc', originalUrl);
    video.src = originalUrl;
  });

  it('resolves the recorded children.props pair without altering media or fetching', () => {
    metadata({ children: { props: pair() } });
    const load = vi.spyOn(video, 'load');
    const play = vi.spyOn(video, 'play');
    expect(find()).toEqual({ originalUrl, progressiveUrl, mediaId: '2041611432752742400' });
    expect(video.currentSrc).toBe(originalUrl);
    expect(video.src).toBe(originalUrl);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('resolves the nearest recorded children[3].props.poppedOutSource.playerProps path', () => {
    metadata({
      children: [null, null, null, { props: { poppedOutSource: { playerProps: pair() } } }],
    });
    expect(find()?.progressiveUrl).toBe(progressiveUrl);
  });

  it('resolves public mediaDetails.video_info variants and prefers the best at most 720p', () => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    const variants = publicVariants();
    metadata({ mediaDetails: [{ video_info: { variants } }] });
    expect(find()).toEqual({
      originalUrl: publicHls,
      progressiveUrl: variants[3].url,
      mediaId: '2041611432752742400',
    });
  });

  it('supports the recorded video.variants type/src form and known videoProps/videoInfo', () => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    const variants = publicVariants().map(({ content_type: type, url: src }) => ({ type, src }));
    metadata({ video: { variants } });
    expect(find()?.progressiveUrl).toBe(variants[3].src);
    metadata({ props: { videoProps: { videoInfo: { variants: publicVariants() } } } });
    expect(find()?.progressiveUrl).toBe(variants[3].src);
  });

  it('uses the best explicitly supplied valid rendition when no at-most-720p variant exists', () => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    const variants = publicVariants();
    metadata({ media: { video_info: { variants: [variants[0], variants[4]] } } });
    expect(find()?.progressiveUrl).toBe(variants[4].url);
  });

  it('keeps media arrays separate and never takes a quoted or wrong-asset rendition', () => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    const variants = publicVariants();
    const other = variants.map((entry) => ({
      ...entry,
      url: entry.url.replace('2041611432752742400', '999'),
    }));
    metadata({
      mediaDetails: [
        { video_info: { variants: [variants[0], ...other.slice(1)] } },
        { video_info: { variants: [other[0], ...variants.slice(1)] } },
      ],
      quoted_tweet: { mediaDetails: [{ video_info: { variants } }] },
    });
    expect(find()).toBeNull();
    metadata({ mediaDetails: [{ video_info: { variants: other } }, { video_info: { variants } }] });
    expect(find()?.progressiveUrl).toBe(variants[3].url);
  });

  it.each([
    (variants) => variants.slice(1),
    (variants) => [{ ...variants[0], url: `${publicHls}&other=1` }, ...variants.slice(1)],
    (variants) => [{ ...variants[0], url: originalUrl }, ...variants.slice(1)],
    (variants) => [variants[0], { ...variants[3], url: `"${variants[3].url}"` }],
    (variants) => [
      variants[0],
      {
        ...variants[3],
        url: variants[3].url.replace('video.twimg.com', 'video.twimg.com.evil.test'),
      },
    ],
    (variants) => [variants[0], { ...variants[3], content_type: 'audio/mp4' }],
  ])('requires a safe exact HLS and video rendition in the same variants array (%#)', (change) => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    metadata({ video_info: { variants: change(publicVariants()) } });
    expect(find()).toBeNull();
  });

  it('does not evaluate variants getters or inherited URL fields', () => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    const getter = vi.fn(() => {
      throw new Error('page getter');
    });
    const entry = Object.create(publicVariants()[3]);
    Object.defineProperty(entry, 'url', { get: getter });
    const variants = [publicVariants()[0], entry];
    Object.defineProperty(variants, '2', { get: getter });
    metadata({ video_info: { variants } });
    expect(find()).toBeNull();
    metadata({ video_info: Object.defineProperty({}, 'variants', { get: getter }) });
    expect(find()).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it('keeps variants entries inside the array and depth budgets', () => {
    property(video, 'currentSrc', publicHls);
    video.src = publicHls;
    const variants = publicVariants();
    metadata({ variants: [variants[0], ...Array(7).fill(null), variants[3]] });
    expect(find()).toBeNull();
    let value = { variants };
    for (let depth = 0; depth < 4; depth++) {
      value = { props: value };
    }
    metadata(value);
    expect(find()?.progressiveUrl).toBe(variants[3].url);
    metadata({ props: value });
    expect(find()).toBeNull();
  });

  it('resolves the verified original player scope while the same video is portaled fullscreen', () => {
    metadata({ children: { props: pair() } });
    const anchor = document.createComment('origin');
    parent.append(anchor);
    const host = document.createElement('vsc-ios-player');
    document.body.append(host);
    host.append(video);
    video.vsc = { iosPlayer: { video, active: true, originParent: parent, anchor } };
    expect(window.VSC.TwitterMediaSource.findCandidate(video, parent)?.progressiveUrl).toBe(
      progressiveUrl
    );
    anchor.remove();
    expect(window.VSC.TwitterMediaSource.findCandidate(video, parent)).toBeNull();
  });

  it('retains React metadata inside a portaled player container', () => {
    metadata({ props: pair() });
    const origin = document.createElement('div');
    document.body.append(origin);
    const anchor = document.createComment('origin');
    origin.append(anchor);
    const host = document.createElement('vsc-ios-player');
    document.body.append(host);
    host.append(parent);
    video.vsc = { iosPlayer: { video, active: true, originParent: origin, anchor } };
    expect(window.VSC.TwitterMediaSource.findCandidate(video, origin)?.progressiveUrl).toBe(
      progressiveUrl
    );
  });

  it('does not use a stale or unrelated portal origin as metadata authority', () => {
    metadata({ props: pair() });
    const anchor = document.createComment('origin');
    parent.append(anchor);
    video.vsc = { iosPlayer: { video, active: false, originParent: parent, anchor } };
    expect(window.VSC.TwitterMediaSource.findCandidate(video, parent)).toBeNull();
    video.vsc.iosPlayer.active = true;
    video.vsc.iosPlayer.video = document.createElement('video');
    expect(window.VSC.TwitterMediaSource.findCandidate(video, parent)).toBeNull();
  });

  it('supports official ext_tw_video pu paths and falls back to src before selection', () => {
    const src = 'https://video.twimg.com/ext_tw_video/12345/pu/pl/native.m3u8?tag=12';
    const mp4 = 'https://video.twimg.com/ext_tw_video/12345/pu/vid/avc1/640x360/file.mp4';
    property(video, 'currentSrc', '');
    video.src = src;
    metadata({ props: { src, downloadUrl: mp4 } });
    expect(find()).toEqual({ originalUrl: src, progressiveUrl: mp4, mediaId: '12345' });
  });

  it.each([
    progressiveUrl.replace('2041611432752742400', '2041611432752742401'),
    progressiveUrl.replace('amplify_video', 'ext_tw_video'),
    progressiveUrl.replace('video.twimg.com', 'video.twimg.com.evil.example'),
    progressiveUrl.replace('https:', 'http:'),
    progressiveUrl.replace('https://', 'https://user@'),
    progressiveUrl.replace('.mp4', '.m3u8'),
    progressiveUrl.replace('/vid/', '/pl/'),
    `${progressiveUrl}#fragment`,
    `"${progressiveUrl}"`,
    `${progressiveUrl}'`,
    `${progressiveUrl} `,
    ['javascript', 'alert(1)'].join(':'),
  ])('rejects mismatched or unsafe supplied rendition %s', (downloadUrl) => {
    metadata({ props: { src: originalUrl, downloadUrl } });
    expect(find()).toBeNull();
  });

  it('requires the exact active HLS URL alongside the download URL', () => {
    metadata({
      children: { props: { src: `${originalUrl}&other=1`, downloadUrl: progressiveUrl } },
    });
    expect(find()).toBeNull();
    metadata({ children: { props: { downloadUrl: progressiveUrl } } });
    expect(find()).toBeNull();
  });

  it('rejects an old currentSrc after the site has changed or cleared its explicit source', () => {
    metadata({ props: pair() });
    video.src = originalUrl.replace('2041611432752742400', '9999999999999999999');
    expect(find()).toBeNull();
    video.removeAttribute('src');
    expect(find()).toBeNull();
  });

  it('accepts an original source child only while its current source intent still matches', () => {
    metadata({ props: pair() });
    video.removeAttribute('src');
    const source = document.createElement('source');
    source.src = originalUrl;
    video.append(source);
    expect(find()?.progressiveUrl).toBe(progressiveUrl);
    source.src = originalUrl.replace('2041611432752742400', '9999999999999999999');
    expect(find()).toBeNull();
  });

  it.each([
    'blob:https://x.com/123',
    progressiveUrl,
    originalUrl.replace('video.twimg.com', 'example.com'),
  ])('rejects non-native-HLS currentSrc even with a valid stale src: %s', (currentSrc) => {
    video.src = originalUrl;
    property(video, 'currentSrc', currentSrc);
    metadata(pair());
    expect(find()).toBeNull();
  });

  it.each([
    ['srcObject', {}],
    ['mediaKeys', {}],
    ['duration', Infinity],
    ['audioTracks', { length: 2 }],
  ])('rejects %s media', (key, value) => {
    property(video, key, value);
    metadata(pair());
    expect(find()).toBeNull();
  });

  it('never invokes metadata getters, including React roots and array entries', () => {
    const getter = vi.fn(() => {
      throw new Error('must not execute page code');
    });
    Object.defineProperty(parent, '__reactProps$accessor', { get: getter });
    const children = [];
    Object.defineProperty(children, '0', { get: getter });
    const props = {};
    for (const key of ['src', 'downloadUrl', 'children', 'content']) {
      Object.defineProperty(props, key, { get: getter });
    }
    metadata({ children: [props, children] });
    expect(find()).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not follow inherited metadata, arbitrary keys or React fibers', () => {
    metadata(Object.create(pair()));
    property(parent, '__reactFiber$fixture', { props: pair() });
    expect(find()).toBeNull();
    metadata({ unrelated: pair(), child: pair() });
    expect(find()).toBeNull();
  });

  it('returns the nearest valid candidate and stops after twelve ancestors', () => {
    metadata({ props: pair() });
    metadata({ props: { ...pair(), downloadUrl: `${progressiveUrl}&outer=1` } }, document.body);
    expect(find()?.progressiveUrl).toBe(progressiveUrl);
    delete parent.__reactProps$fixture;
    delete document.body.__reactProps$fixture;
    let node = parent;
    for (let index = 0; index < 12; index++) {
      const outer = document.createElement('div');
      node.replaceWith(outer);
      outer.append(node);
      node = outer;
    }
    metadata(pair(), node);
    expect(find()).toBeNull();
  });

  it('bounds child arrays and depth while accepting the last allowed depth', () => {
    metadata({ children: [...Array(8).fill(null), pair()] });
    expect(find()).toBeNull();
    let value = pair();
    for (let depth = 0; depth < 6; depth++) {
      value = { props: value };
    }
    metadata(value);
    expect(find()?.progressiveUrl).toBe(progressiveUrl);
    metadata({ props: value });
    expect(find()).toBeNull();
  });

  it('bounds object visits and handles cycles without traversing later metadata', () => {
    const branches = (depth) =>
      depth === 0
        ? {}
        : Object.fromEntries(
            ['children', 'props', 'playerProps', 'poppedOutSource', 'content'].map((key) => [
              key,
              branches(depth - 1),
            ])
          );
    metadata({ children: [branches(3), pair()] });
    expect(find()).toBeNull();
    const cycle = {};
    cycle.children = cycle;
    metadata({ children: [cycle, pair()] });
    expect(find()?.progressiveUrl).toBe(progressiveUrl);
  });

  it('skips ancestors with more than sixty-four own keys and guards throwing page APIs', () => {
    metadata(pair());
    for (let index = 0; index < 65; index++) {
      property(parent, `unrelated${index}`, null);
    }
    expect(find()).toBeNull();
    Object.defineProperty(video, 'currentSrc', {
      get: () => {
        throw new Error('page getter');
      },
    });
    expect(find()).toBeNull();
  });
});

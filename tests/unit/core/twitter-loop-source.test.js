import { test } from 'vitest';
import assert from 'node:assert/strict';
import '../../../src/core/twitter-loop-source.js';

const ROOT = 'https://video.twimg.com/amplify_video/123/';
const MASTER = `${ROOT}pl/master.m3u8`;
const MP4 = `${ROOT}vid/avc1/720x1280/supplied.mp4`;
const VIDEO = `${ROOT}pl/avc1/720x1280/video.m3u8`;
const AUDIO = `${ROOT}pl/mp4a/128000/audio.m3u8`;
const VIDEO_INIT = `${ROOT}vid/avc1/0/0/720x1280/init.mp4`;
const AUDIO_INIT = `${ROOT}aud/mp4a/0/0/128000/init.mp4`;
const VIDEO_SEGMENTS = [
  `${ROOT}vid/avc1/0/3000/720x1280/first.m4s`,
  `${ROOT}vid/avc1/3000/4833/720x1280/last.m4s`,
];
const AUDIO_SEGMENTS = [
  `${ROOT}aud/mp4a/0/3000/128000/first.m4s`,
  `${ROOT}aud/mp4a/3000/4880/128000/last.m4s`,
];
// This is the observed finite X master/media structure, with fixture asset URLs.
const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-128000",AUTOSELECT=YES,URI="mp4a/128000/audio.m3u8"',
  '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2253463,BANDWIDTH=2298669,RESOLUTION=720x1280,CODECS="mp4a.40.2,avc1.64001F",AUDIO="audio-128000"',
  'avc1/720x1280/video.m3u8',
  '',
].join('\n');
function media(init, segments, lastDuration) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-TARGETDURATION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-MAP:URI="${init}"`,
    '#EXTINF:3.000,',
    segments[0],
    `#EXTINF:${lastDuration},`,
    segments[1],
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
}
const video = media(VIDEO_INIT, VIDEO_SEGMENTS, '1.833');
const audio = media(AUDIO_INIT, AUDIO_SEGMENTS, '1.880');
// Captured Raven master declarations, with fixture asset URLs and names.
const multiMaster = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  ...[32000, 64000, 128000].map(
    (rate) =>
      `#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-${rate}",AUTOSELECT=YES,URI="mp4a/${rate}/audio.m3u8"`
  ),
  '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=172032,BANDWIDTH=217307,RESOLUTION=480x270,CODECS="mp4a.40.2,avc1.4D401E",AUDIO="audio-32000"',
  'avc1/480x270/video.m3u8',
  '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=460986,BANDWIDTH=581441,RESOLUTION=640x360,CODECS="mp4a.40.2,avc1.4D401F",AUDIO="audio-64000"',
  'avc1/640x360/video.m3u8',
  '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1157927,BANDWIDTH=1486521,RESOLUTION=1280x720,CODECS="mp4a.40.2,avc1.640020",AUDIO="audio-128000"',
  'avc1/1280x720/video.m3u8',
  '',
].join('\n');
const selectedVideo = `${ROOT}pl/avc1/1280x720/video.m3u8`;
const multiDescriptor = { progressiveUrl: MP4.replace('720x1280', '1280x720') };
const encode = (text) => Uint8Array.from(new TextEncoder().encode(text));
const binary = (value) => Uint8Array.from([0, 0, 0, value]);

function fixture(change = {}) {
  const state = {
    calls: [],
    cancels: 0,
    current: true,
    timers: new Map(),
    signal: new AbortController(),
  };
  const contents = {
    [MASTER]: master,
    [VIDEO]: video,
    [AUDIO]: audio,
    [VIDEO_INIT]: binary(1),
    [VIDEO_SEGMENTS[0]]: binary(2),
    [VIDEO_SEGMENTS[1]]: binary(3),
    [AUDIO_INIT]: binary(4),
    [AUDIO_SEGMENTS[0]]: binary(5),
    [AUDIO_SEGMENTS[1]]: binary(6),
    ...change.contents,
  };
  let timer = 0;
  const runtime = {
    URL,
    TextDecoder,
    AbortController,
    setTimeout(fn, delay) {
      state.timers.set(++timer, { fn, delay });
      return timer;
    },
    clearTimeout(id) {
      state.timers.delete(id);
      change.clearTimeout?.(state);
    },
    fetch(url, options) {
      state.calls.push({ url, options });
      if (change.fetch) {
        return change.fetch(url, options, state);
      }
      assert.ok(Object.hasOwn(contents, url), `unexpected fixture request: ${url}`);
      const value = typeof contents[url] === 'string' ? encode(contents[url]) : contents[url];
      const chunks = change.chunks?.[url] || [value];
      let offset = 0;
      return Promise.resolve({
        status: 200,
        ok: true,
        redirected: false,
        type: 'cors',
        url,
        body: {
          getReader() {
            return {
              read() {
                if (change.read) {
                  return change.read(state, url, offset++);
                }
                return Promise.resolve(
                  offset < chunks.length ? { done: false, value: chunks[offset++] } : { done: true }
                );
              },
              cancel() {
                state.cancels++;
                return Promise.resolve();
              },
            };
          },
        },
        ...change.response,
      });
    },
  };
  const descriptor = {
    hlsUrl: MASTER,
    progressiveUrl: MP4,
    assetType: 'amplify_video',
    assetId: '123',
    duration: 4.876190476190477,
    isCurrent() {
      return state.current;
    },
    signal: state.signal.signal,
    ...change.descriptor,
  };
  return {
    state,
    descriptor,
    runtime,
    start: () => window.VSC.TwitterLoopSource.create(descriptor, runtime),
  };
}
async function rejects(change, code) {
  const f = fixture(change);
  await assert.rejects(f.start().promise, code ? { code } : undefined);
  assert.equal(f.state.timers.size, 0);
  assert.ok(f.state.calls.length <= 37);
  for (const call of f.state.calls) {
    assert.equal(call.options.signal.aborted, true);
  }
  return f;
}

test('retains every explicit video/audio fragment and the rounded audio tail', async () => {
  const f = fixture();
  const result = await f.start().promise;
  assert.deepEqual(result, {
    video: {
      mime: 'video/mp4; codecs="avc1.64001F"',
      init: binary(1),
      segments: [binary(2), binary(3)],
    },
    audio: {
      mime: 'audio/mp4; codecs="mp4a.40.2"',
      init: binary(4),
      segments: [binary(5), binary(6)],
    },
    manifestDurations: { video: 4.833, audio: 4.88 },
  });
  assert.deepEqual(
    f.state.calls.map((call) => call.url),
    [MASTER, VIDEO, AUDIO, VIDEO_INIT, ...VIDEO_SEGMENTS, AUDIO_INIT, ...AUDIO_SEGMENTS]
  );
  assert.equal(f.state.cancels, 9);
  assert.equal(f.state.timers.size, 0);
  for (const { options } of f.state.calls) {
    assert.equal(options.mode, 'cors');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    assert.equal(options.signal.aborted, true);
  }
});

test('handles bounded streamed chunks and BOM/CRLF playlists without altering binary data', async () => {
  const first = binary(2);
  const f = fixture({
    contents: { [MASTER]: `\uFEFF${master.replaceAll('\n', '\r\n')}` },
    chunks: { [VIDEO_SEGMENTS[0]]: [first.slice(0, 1), first.slice(1)] },
  });
  const result = await f.start().promise;
  assert.deepEqual(result.video.segments[0], first);
  first[0] = 99;
  assert.equal(result.video.segments[0][0], 0);
});

for (const descriptor of [
  { duration: 0 },
  { duration: 60.01 },
  { duration: Infinity },
  { assetType: 'other' },
  { assetId: '0123' },
  { assetId: 123 },
  { isCurrent: null },
  { hlsUrl: 'https://video.twimg.com/amplify_video/124/pl/master.m3u8' },
  { hlsUrl: 'https://video.twimg.com:443/amplify_video/123/pl/master.m3u8' },
  { hlsUrl: 'https://video.twimg.com/amplify_video/123/pl/master.m3u8#key' },
  { progressiveUrl: undefined },
  { progressiveUrl: MP4.replace('/123/', '/124/') },
  { progressiveUrl: MP4.replace('https:', 'http:') },
  { progressiveUrl: MP4.replace('video.twimg.com', 'other.example') },
  { progressiveUrl: MP4.replace('video.twimg.com', 'video.twimg.com:443') },
  { progressiveUrl: `${MP4}#fragment` },
  { progressiveUrl: MP4.replace('/vid/', '/aud/') },
  { progressiveUrl: MP4.replace('720x1280/', '') },
  { progressiveUrl: MP4.replace('720x1280/', '720x1280/1280x720/') },
  { progressiveUrl: MP4.replace('720x1280', '1920x1080') },
]) {
  test(`rejects invalid descriptor before fetching: ${JSON.stringify(descriptor)}`, async () => {
    const f = await rejects({ descriptor });
    assert.equal(f.state.calls.length, 0);
  });
}

test('never invokes descriptor accessors', async () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.descriptor, 'hlsUrl', {
    get() {
      reads++;
      return MASTER;
    },
  });
  await assert.rejects(f.start().promise, { code: 'descriptor' });
  assert.equal(reads, 0);
  assert.equal(f.state.calls.length, 0);
});

test('requires an exact own progressive URL data field without reading a getter', async () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.descriptor, 'progressiveUrl', {
    get() {
      reads++;
      return MP4;
    },
  });
  await assert.rejects(f.start().promise, { code: 'descriptor' });
  assert.equal(reads, 0);
  assert.equal(f.state.calls.length, 0);
  delete f.descriptor.progressiveUrl;
  await assert.rejects(f.start().promise, { code: 'descriptor' });
});

for (const tag of [
  '#EXT-X-KEY:METHOD=AES-128,URI="key"',
  '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-BYTERANGE:42@0',
  '#EXT-X-PART:DURATION=1,URI="part.m4s"',
  '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part.m4s"',
  '#EXT-X-SKIP:SKIPPED-SEGMENTS=1',
  '#EXT-X-DEFINE:NAME="x",VALUE="y"',
  '#EXT-X-START:TIME-OFFSET=1',
  '#EXT-X-UNKNOWN:YES',
]) {
  test(`rejects unsupported master/child tag: ${tag}`, async () => {
    const badMaster = master.replace('#EXT-X-INDEPENDENT-SEGMENTS', tag);
    const first = await rejects({ contents: { [MASTER]: badMaster } });
    assert.equal(first.state.calls.length, 1);
    const badChild = video.replace('#EXT-X-MAP:', `${tag}\n#EXT-X-MAP:`);
    const child = await rejects({ contents: { [VIDEO]: badChild } });
    assert.equal(child.state.calls.length, 2);
  });
}

for (const changed of [
  master.replace('TYPE=AUDIO', 'TYPE=SUBTITLES'),
  master.replace('TYPE=AUDIO', 'TYPE=VIDEO'),
  master.replace('AUDIO="audio-128000"', 'AUDIO="audio-128000",SUBTITLES="subs"'),
  master.replace('AUDIO="audio-128000"', 'AUDIO="audio-128000",CLOSED-CAPTIONS="cc"'),
  master.replace('AUDIO="audio-128000"', 'AUDIO="other"'),
  master.replace('mp4a.40.2,avc1.64001F', 'mp4a.40.2,hev1.1.6.L93.B0'),
  master.replace('mp4a.40.2,avc1.64001F', 'mp4a.40.2,avc1.64001F,mp4a.40.2'),
  master.replace('#EXT-X-INDEPENDENT-SEGMENTS\n', ''),
  master + master.split('\n').slice(3).join('\n'),
  master.replace('URI="mp4a/128000/audio.m3u8"', 'URI="avc1/720x1280/video.m3u8"'),
]) {
  test('vetoes ambiguous or unsupported tracks before reading media', async () => {
    const f = await rejects({ contents: { [MASTER]: changed } });
    assert.equal(f.state.calls.length, 1);
  });
}

test('permits an explicit CLOSED-CAPTIONS=NONE declaration', async () => {
  const f = fixture({
    contents: {
      [MASTER]: master.replace('AUDIO="audio-128000"', 'AUDIO="audio-128000",CLOSED-CAPTIONS=NONE'),
    },
  });
  assert.equal((await f.start().promise).audio.segments.length, 2);
});

test('accepts the proven 720p envelope in landscape orientation', async () => {
  const f = fixture({
    contents: { [MASTER]: master.replace('RESOLUTION=720x1280', 'RESOLUTION=1280x720') },
    descriptor: { progressiveUrl: MP4.replace('720x1280', '1280x720') },
  });
  assert.equal((await f.start().promise).video.segments.length, 2);
});

test('selects the unique exact supplied MP4 dimensions from all three observed bitrate pairs', async () => {
  const f = fixture({
    descriptor: multiDescriptor,
    contents: { [MASTER]: multiMaster, [selectedVideo]: video },
  });
  const result = await f.start().promise;
  assert.equal(result.video.mime, 'video/mp4; codecs="avc1.640020"');
  assert.deepEqual(result.video.segments, [binary(2), binary(3)]);
  assert.deepEqual(result.audio.segments, [binary(5), binary(6)]);
  assert.deepEqual(
    f.state.calls.slice(0, 3).map(({ url }) => url),
    [MASTER, selectedVideo, AUDIO]
  );
  assert.equal(f.state.calls.length, 9);
});

test('retains equivalent explicit audio semantics across bitrate groups', async () => {
  const f = fixture({
    descriptor: multiDescriptor,
    contents: {
      [MASTER]: multiMaster.replaceAll(
        'TYPE=AUDIO',
        'TYPE=AUDIO,LANGUAGE="en",DEFAULT=YES,CHANNELS="2"'
      ),
      [selectedVideo]: video,
    },
  });
  assert.equal((await f.start().promise).audio.segments.length, 2);
});

test('master entries cannot inherit absent codec or audio declarations from the page prototype', async () => {
  let reads = 0;
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'CODECS');
  Object.defineProperty(Object.prototype, 'CODECS', {
    configurable: true,
    get() {
      reads++;
      return 'mp4a.40.2,avc1.640020';
    },
  });
  try {
    const f = await rejects(
      {
        descriptor: multiDescriptor,
        contents: { [MASTER]: multiMaster.replace('CODECS="mp4a.40.2,avc1.4D401E",', '') },
      },
      'tracks'
    );
    assert.equal(f.state.calls.length, 1);
    assert.equal(reads, 0);
  } finally {
    if (previous) {
      Object.defineProperty(Object.prototype, 'CODECS', previous);
    } else {
      delete Object.prototype.CODECS;
    }
  }
});

for (const [name, changed] of [
  [
    'unknown unselected stream attribute',
    multiMaster.replace('RESOLUTION=480x270', 'UNKNOWN=YES,RESOLUTION=480x270'),
  ],
  ['unsupported unselected codec', multiMaster.replace('avc1.4D401E', 'hev1.1.6.L93.B0')],
  [
    'unselected captions',
    multiMaster.replace('RESOLUTION=480x270', 'CLOSED-CAPTIONS="cc",RESOLUTION=480x270'),
  ],
  [
    'unknown unselected audio attribute',
    multiMaster.replace('audio-32000",AUTOSELECT', 'audio-32000",CHARACTERISTICS="x",AUTOSELECT'),
  ],
  ['different audio name', multiMaster.replace('NAME="Audio"', 'NAME="Description"')],
  ['different audio language', multiMaster.replace('TYPE=AUDIO', 'LANGUAGE="en",TYPE=AUDIO')],
  ['different audio default', multiMaster.replace('TYPE=AUDIO', 'DEFAULT=YES,TYPE=AUDIO')],
  ['different audio channels', multiMaster.replace('TYPE=AUDIO', 'CHANNELS="2",TYPE=AUDIO')],
  ['disabled autoselection', multiMaster.replace('AUTOSELECT=YES', 'AUTOSELECT=NO')],
  ['duplicate dimensions', multiMaster.replace('RESOLUTION=480x270', 'RESOLUTION=1280x720')],
  [
    'duplicate video URI',
    multiMaster.replace('avc1/480x270/video.m3u8', 'avc1/1280x720/video.m3u8'),
  ],
  ['duplicate audio URI', multiMaster.replace('mp4a/32000/audio.m3u8', 'mp4a/128000/audio.m3u8')],
  ['duplicate group', multiMaster.replace('GROUP-ID="audio-32000"', 'GROUP-ID="audio-128000"')],
  [
    'shared group and unused audio',
    multiMaster.replace('AUDIO="audio-32000"', 'AUDIO="audio-64000"'),
  ],
  ['unbound group', multiMaster.replace('AUDIO="audio-32000"', 'AUDIO="missing"')],
  [
    'off-asset unselected URI',
    multiMaster.replace(
      'avc1/480x270/video.m3u8',
      'https://video.twimg.com/amplify_video/124/pl/other.m3u8'
    ),
  ],
  [
    'unselected decoder envelope',
    multiMaster.replace('RESOLUTION=480x270', 'RESOLUTION=3840x2160'),
  ],
  ['orphan stream declaration', `${multiMaster}#EXT-X-STREAM-INF:BANDWIDTH=1\n`],
  ['unselected key declaration', `${multiMaster}#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"\n`],
]) {
  test(`validates the entire master before selection: ${name}`, async () => {
    const f = await rejects({ descriptor: multiDescriptor, contents: { [MASTER]: changed } });
    assert.equal(f.state.calls.length, 1);
  });
}

for (const progressiveUrl of [MP4, MP4.replace('720x1280', '800x450')]) {
  test(`rejects unmatched or transposed supplied dimensions without selecting lower quality: ${progressiveUrl}`, async () => {
    const f = await rejects(
      { descriptor: { progressiveUrl }, contents: { [MASTER]: multiMaster } },
      'ambiguous'
    );
    assert.equal(f.state.calls.length, 1);
  });
}

test('rejects more than eight master audio/video entries before requesting children', async () => {
  const pairs = Array.from({ length: 9 }, (_, i) =>
    [
      `#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-${i}",AUTOSELECT=YES,URI="mp4a/${i}/audio.m3u8"`,
      `#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=${100 + i}x100,CODECS="mp4a.40.2,avc1.640020",AUDIO="audio-${i}"`,
      `avc1/${i}/video.m3u8`,
    ].join('\n')
  );
  const f = await rejects(
    {
      contents: { [MASTER]: `${master.split('\n').slice(0, 3).join('\n')}\n${pairs.join('\n')}\n` },
    },
    'ambiguous'
  );
  assert.equal(f.state.calls.length, 1);
});

for (const example of [
  {
    name: 'observed Raven 15/16 segments and complete 0.835-second audio tail',
    videoDurations: [...Array(14).fill(3), 3.783],
    audioDurations: [...Array(15).fill(3), 0.835],
    duration: 45.836190476190474,
    expected: { video: 45.783, audio: 45.835 },
    requests: 36,
  },
  {
    name: '16 segments per track and 37 requests at the 60-second boundary',
    videoDurations: Array(16).fill(3.75),
    audioDurations: Array(16).fill(3.75),
    duration: 60,
    expected: { video: 60, audio: 60 },
    requests: 37,
  },
]) {
  test(`retains every fragment: ${example.name}`, async () => {
    const contents = { [MASTER]: multiMaster };
    for (const [url, init, kind, durations] of [
      [selectedVideo, VIDEO_INIT, 'vid', example.videoDurations],
      [AUDIO, AUDIO_INIT, 'aud', example.audioDurations],
    ]) {
      const entries = durations.map((duration, i) => {
        const segment = `${ROOT}${kind}/boundary-${i}.m4s`;
        contents[segment] = binary(i);
        return `#EXTINF:${duration.toFixed(3)},\n${segment}`;
      });
      const header = video
        .slice(0, video.indexOf('#EXTINF:'))
        .replace('TARGETDURATION:3', `TARGETDURATION:${Math.ceil(Math.max(...durations))}`)
        .replace(VIDEO_INIT, init);
      contents[url] = `${header}${entries.join('\n')}\n#EXT-X-ENDLIST\n`;
    }
    const f = fixture({ descriptor: { ...multiDescriptor, duration: example.duration }, contents });
    const result = await f.start().promise;
    assert.deepEqual(result.manifestDurations, example.expected);
    assert.deepEqual(
      result.video.segments,
      example.videoDurations.map((_, i) => binary(i))
    );
    assert.deepEqual(
      result.audio.segments,
      example.audioDurations.map((_, i) => binary(i))
    );
    assert.equal(f.state.calls.length, example.requests);
  });
}

for (const resolution of ['1920x1080', '3840x2160', '1281x720', '721x721']) {
  test(`rejects higher decoder dimensions before fetching child playlists: ${resolution}`, async () => {
    const f = await rejects(
      { contents: { [MASTER]: master.replace('RESOLUTION=720x1280', `RESOLUTION=${resolution}`) } },
      'tracks'
    );
    assert.equal(f.state.calls.length, 1);
  });
}

for (const changed of [
  video.replace('PLAYLIST-TYPE:VOD', 'PLAYLIST-TYPE:EVENT'),
  video.replace('#EXT-X-ENDLIST\n', ''),
  video.replace('MEDIA-SEQUENCE:0', 'MEDIA-SEQUENCE:1'),
  video.replace('1.833,', '2.500,'),
  video.replace('3.000,', 'NaN,'),
  video.replace('3.000,', '-3.000,'),
  video.replace('3.000,', '3e0,'),
  video.replace('#EXT-X-MAP:', '#EXT-X-MAP:BYTERANGE="30@0",'),
  video.replace(VIDEO_SEGMENTS[1], VIDEO_SEGMENTS[0]),
  `${video}#EXT-X-ENDLIST\n`,
  video.replace('#EXT-X-VERSION:6', '#EXT-X-VERSION:6\n#EXT-X-VERSION:6'),
  video.replace(VIDEO_SEGMENTS[0], '#EXT-X-ENDLIST'),
]) {
  test('rejects incomplete, duplicate, live or mismatched media playlists', async () => {
    const f = await rejects({ contents: { [VIDEO]: changed } });
    assert.equal(f.state.calls.length, 2);
  });
}

test('bounds the number of media segments before requesting bytes', async () => {
  const entries = Array.from({ length: 17 }, (_, i) => `#EXTINF:0.5,\n${ROOT}vid/${i}.m4s`).join(
    '\n'
  );
  const changed = video.replace(/#EXTINF:[\s\S]+#EXT-X-ENDLIST/, `${entries}\n#EXT-X-ENDLIST`);
  const f = await rejects({ contents: { [VIDEO]: changed } }, 'duration');
  assert.equal(f.state.calls.length, 2);
});

for (const bad of [
  'https://other.example/amplify_video/123/vid/first.m4s',
  `${ROOT.replace('/123/', '/124/')}vid/first.m4s`,
  'https://user@video.twimg.com/amplify_video/123/vid/first.m4s',
  'https://video.twimg.com:443/amplify_video/123/vid/first.m4s',
  `${ROOT}vid/first.m4s#x`,
  `${ROOT}vid/%66irst.m4s`,
  `${ROOT}vid/first.ts`,
]) {
  test(`never follows an off-asset or unsupported media URI: ${bad}`, async () => {
    const f = await rejects(
      { contents: { [VIDEO]: video.replace(VIDEO_SEGMENTS[0], bad) } },
      'uri'
    );
    assert.equal(f.state.calls.length, 2);
  });
}

for (const response of [
  { status: 206 },
  { ok: false },
  { redirected: true },
  { type: 'opaqueredirect' },
  { url: VIDEO },
  { body: null },
]) {
  test('rejects CORS/status/redirect/reader failures without a fallback request', async () => {
    const f = await rejects({ response }, 'response');
    assert.equal(f.state.calls.length, 1);
  });
}

test('does not retry a failed fetch or issue later requests', async () => {
  const f = await rejects({
    fetch() {
      return Promise.reject(new TypeError('CORS'));
    },
  });
  assert.equal(f.state.calls.length, 1);
});

for (const [url, length] of [
  [MASTER, 32769],
  [VIDEO_INIT, 131073],
  [VIDEO_SEGMENTS[0], 8388608],
]) {
  test(`enforces per-resource and aggregate streamed byte limits: ${url}`, async () => {
    const f = await rejects({ chunks: { [url]: [new Uint8Array(length)] } }, 'bytes');
    assert.ok(f.state.cancels > 0);
  });
}

test('bounds zero-byte chunk streams', async () => {
  let reads = 0;
  const f = await rejects(
    {
      read() {
        reads++;
        return Promise.resolve({ done: false, value: new Uint8Array() });
      },
    },
    'chunks'
  );
  assert.equal(reads, 2048);
  assert.equal(f.state.calls.length, 1);
});

test('rejects malformed UTF-8 instead of replacing source characters', async () => {
  await rejects({ chunks: { [MASTER]: [Uint8Array.from([255])] } });
});

test('rejects an empty segment without silently skipping it', async () => {
  const f = await rejects({ chunks: { [VIDEO_SEGMENTS[0]]: [] } }, 'empty');
  assert.equal(f.state.calls.at(-1).url, VIDEO_SEGMENTS[0]);
});

test('source change during a streamed read cancels the reader and stops the chain', async () => {
  const f = await rejects(
    {
      read(state) {
        state.current = false;
        return Promise.resolve({ done: false, value: encode(master) });
      },
    },
    'source-changed'
  );
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.cancels, 1);
});

test('source change inside fetch is checked before awaiting its result', async () => {
  const f = await rejects(
    {
      fetch(_url, _options, state) {
        state.current = false;
        return Promise.reject(new Error('late'));
      },
    },
    'source-changed'
  );
  assert.equal(f.state.calls.length, 1);
});

test('external cancellation settles an unresponsive fetch and prevents later requests', async () => {
  const f = fixture({
    fetch() {
      return new Promise(() => {});
    },
  });
  const task = f.start();
  f.state.signal.abort();
  await assert.rejects(task.promise, { code: 'aborted' });
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.timers.size, 0);
});

test('public cancellation settles an unresponsive reader', async () => {
  const f = fixture({
    read() {
      return new Promise(() => {});
    },
  });
  const task = f.start();
  for (let i = 0; i < 10 && !f.state.cancels; i++) {
    await Promise.resolve();
  }
  task.cancel();
  await assert.rejects(task.promise, { code: 'aborted' });
  assert.equal(f.state.cancels, 1);
  assert.equal(f.state.timers.size, 0);
});

test('whole-chain deadline settles an unresponsive fetch', async () => {
  const f = fixture({
    fetch() {
      return new Promise(() => {});
    },
  });
  const task = f.start();
  const timer = [...f.state.timers.values()][0];
  assert.equal(timer.delay, 12000);
  timer.fn();
  await assert.rejects(task.promise, { code: 'deadline' });
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.timers.size, 0);
});

test('authority remains required through final cleanup', async () => {
  await rejects(
    {
      clearTimeout(state) {
        state.current = false;
      },
    },
    'source-changed'
  );
});

test('external abort during final cleanup cannot publish bytes', async () => {
  await rejects(
    {
      clearTimeout(state) {
        state.signal.abort();
      },
    },
    'aborted'
  );
});

async function captionFixture(kind = 'valid') {
  const line =
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="captions",NAME="English",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=NO,FORCED=NO,URI="captions/en.m3u8"';
  let text = master
    .replace('#EXT-X-INDEPENDENT-SEGMENTS\n', `#EXT-X-INDEPENDENT-SEGMENTS\n${line}\n`)
    .replace('AUDIO="audio-128000"', 'AUDIO="audio-128000",SUBTITLES="captions"');
  if (kind === 'eight pairs') {
    const dimensions = [
      '720x1280',
      '100x100',
      '200x100',
      '300x100',
      '400x100',
      '500x100',
      '600x100',
      '700x100',
    ];
    text = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      ...dimensions.map(
        (_, index) =>
          `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-${index}",NAME="Audio",AUTOSELECT=YES,URI="mp4a/${index ? index : 128000}/audio.m3u8"`
      ),
      line,
      ...dimensions.flatMap((size, index) => [
        `#EXT-X-STREAM-INF:BANDWIDTH=2298669,RESOLUTION=${size},CODECS="mp4a.40.2,avc1.64001F",AUDIO="audio-${index}",SUBTITLES="captions"`,
        `avc1/${size}/video.m3u8`,
      ]),
    ].join('\n');
  }
  if (kind === 'duplicate') {
    text = text.replace(line, `${line}\n${line}`);
  }
  if (kind === 'unreferenced') {
    text = text.replace(',SUBTITLES="captions"', '');
  }
  if (kind === 'unknown') {
    text = text.replace('NAME="English"', 'NAME="English",UNKNOWN=YES');
  }
  let fulfill;
  const proof = new Promise((resolve) => {
    fulfill = resolve;
  });
  const owner = {
    current: true,
    promise: proof,
    isCurrent() {
      return this.current;
    },
    attestsMaster(url, received) {
      assert.equal(url, MASTER);
      assert.equal(received, text);
      return kind === 'wrong attestation' ? null : 'captions';
    },
  };
  const previous = window.VSC.TwitterCaptionPlayback;
  window.VSC.TwitterCaptionPlayback = { isLoopOwner: (value) => value === owner };
  const f = fixture({ contents: { [MASTER]: text }, descriptor: { captionOwner: owner } });
  return {
    ...f,
    owner,
    fulfill,
    restore: () => {
      window.VSC.TwitterCaptionPlayback = previous;
    },
  };
}

test('LoopSource waits for registered source proof and validates the exact single subtitle master without fetching it again', async () => {
  const f = await captionFixture();
  try {
    const load = f.start();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.state.calls.length, 0);
    f.fulfill(f.owner);
    const result = await load.promise;
    assert.ok(result.video.segments.length);
    assert.ok(result.audio.segments.length);
    assert.equal(
      f.state.calls.some(({ url }) => url.includes('/captions/')),
      false
    );
    assert.equal(f.state.calls[0].url, MASTER);
    assert.equal(f.state.timers.size, 0);
  } finally {
    f.restore();
  }
});

test('LoopSource retains the eight-pair AV bound when the attested subtitle row follows all audio groups', async () => {
  const f = await captionFixture('eight pairs');
  try {
    f.fulfill(f.owner);
    const result = await f.start().promise;
    assert.ok(result.video.segments.length);
    assert.ok(result.audio.segments.length);
    assert.equal(f.state.calls.length, 9);
    assert.equal(
      f.state.calls.some(({ url }) => url.includes('/captions/')),
      false
    );
  } finally {
    f.restore();
  }
});

for (const kind of ['duplicate', 'unreferenced', 'unknown', 'wrong attestation']) {
  test(`LoopSource rejects ${kind} subtitles before any AV playlist or segment request`, async () => {
    const f = await captionFixture(kind);
    try {
      f.fulfill(f.owner);
      await assert.rejects(f.start().promise);
      assert.deepEqual(
        f.state.calls.map(({ url }) => url),
        [MASTER]
      );
      assert.equal(f.state.timers.size, 0);
    } finally {
      f.restore();
    }
  });
}

test('LoopSource rejects an unregistered caption object without invoking its promise or APIs', async () => {
  let invoked = false;
  const owner = {
    get promise() {
      invoked = true;
      throw new Error('Not an owner');
    },
  };
  const f = fixture({ descriptor: { captionOwner: owner } });
  await assert.rejects(f.start().promise, { code: 'caption-owner' });
  assert.equal(invoked, false);
  assert.equal(f.state.calls.length, 0);
});

test('LoopSource cancels source-proof waiting and never fetches after a late caption proof', async () => {
  const f = await captionFixture();
  try {
    const load = f.start();
    f.state.signal.abort();
    await assert.rejects(load.promise, { code: 'aborted' });
    f.fulfill(f.owner);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.timers.size, 0);
  } finally {
    f.restore();
  }
});

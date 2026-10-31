/** Production caption-chain contract, ported from the verified bounded helper checks. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import '../../../src/core/twitter-caption-source.js';

const createCaptionSource = (...args) => window.VSC.TwitterCaptionSource.create(...args);

const HLS = 'https://video.twimg.com/amplify_video/123/pl/master.m3u8';
const SUB = 'https://video.twimg.com/amplify_video/123/pl/captions.m3u8';
const LEAF = 'https://video.twimg.com/subtitles/amplify_video/123/en.vtt';
const master =
  '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en-US",NAME="English",URI="captions.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100000,SUBTITLES="subs",CLOSED-CAPTIONS=NONE\nvariant.m3u8\n';
// Observed master structure: three encodings of one audio member, without
// language/default/channel choices, referenced by four video variants.
const singletonAudioMaster = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-low",NAME="Audio",AUTOSELECT=YES,URI="audio-low.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-mid",NAME="Audio",AUTOSELECT=YES,URI="audio-mid.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-high",NAME="Audio",AUTOSELECT=YES,URI="audio-high.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en-US",NAME="English",URI="captions.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=100000,AUDIO="audio-low",SUBTITLES="subs",CLOSED-CAPTIONS=NONE',
  'video-low.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=200000,AUDIO="audio-mid",SUBTITLES="subs",CLOSED-CAPTIONS=NONE',
  'video-mid.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=300000,AUDIO="audio-high",SUBTITLES="subs",CLOSED-CAPTIONS=NONE',
  'video-high.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=400000,AUDIO="audio-high",SUBTITLES="subs",CLOSED-CAPTIONS=NONE',
  'video-highest.m3u8',
  '',
].join('\n');
const playlist = `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:38\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:37.120,\n${
  LEAF
}\n#EXT-X-ENDLIST\n`;
const vtt =
  '\uFEFFWEBVTT\r\n\r\nfirst-id\r\n00:00.280 --> 00:02.602 line:90% align:center\r\n<v Speaker>Hello é world\r\nSecond line\r\n\r\n00:02.622 --> 00:03.922\r\nNext cue\r\n';
// jsdom uses Node's TextEncoder, whose returned typed array has a different
// realm. A browser fetch reader returns the current world's Uint8Array.
const encode = (value) => Uint8Array.from(new TextEncoder().encode(value));

function fixture(change = {}) {
  const state = {
    current: true,
    calls: [],
    cancels: 0,
    timers: new Map(),
    signal: new AbortController(),
  };
  const content = [master, playlist, vtt];
  Object.assign(content, change.content);
  let timerId = 0;
  const runtime = {
    AbortController,
    URL,
    TextDecoder,
    setTimeout(fn, delay) {
      const id = ++timerId;
      state.timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      state.timers.delete(id);
    },
    fetch(url, options) {
      const index = state.calls.length;
      state.calls.push({ url, options });
      if (change.fetch) {
        return change.fetch(url, options, state, index);
      }
      let at = 0;
      const chunks = change.chunks?.[index] || [encode(content[index])];
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
                  return change.read(state, index, at++);
                }
                return Promise.resolve(
                  at < chunks.length ? { done: false, value: chunks[at++] } : { done: true }
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
    hlsUrl: HLS,
    duration: 37.12,
    assetType: 'amplify_video',
    assetId: '123',
    isCurrent() {
      return state.current;
    },
    signal: state.signal.signal,
    ...change.descriptor,
  };
  return {
    state,
    runtime,
    descriptor,
    start: () => createCaptionSource(descriptor, runtime),
  };
}
async function rejected(change, code) {
  const f = fixture(change);
  await assert.rejects(f.start().promise, code ? { code } : undefined);
  assert.equal(f.state.timers.size, 0);
  assert.ok(f.state.calls.length <= 3);
  return f;
}

test('preserves full bytes, BOM/CRLF text, cue IDs, multiline text and raw settings', async () => {
  const f = fixture();
  const result = await f.start().promise;
  assert.deepEqual(result.vttBytes, encode(vtt));
  assert.equal(result.vttText, vtt);
  assert.deepEqual(result.oracle, [
    {
      id: 'first-id',
      start: 0.28,
      end: 2.602,
      text: '<v Speaker>Hello é world\nSecond line',
      settings: 'line:90% align:center',
    },
    { id: '', start: 2.622, end: 3.922, text: 'Next cue', settings: '' },
  ]);
  assert.deepEqual(result.rendition, { language: 'en-US', name: 'English' });
  assert.deepEqual(result.chain, {
    hlsUrl: HLS,
    subtitleUrl: SUB,
    vttUrl: LEAF,
  });
  assert.equal(result.duration, 37.12);
  assert.equal(f.state.calls.length, 3);
  assert.equal(f.state.cancels, 3);
  assert.equal(f.state.timers.size, 0);
  for (const call of f.state.calls) {
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.mode, 'cors');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.signal.aborted, true);
  }
});

test('accepts fifteen complete finite cues without flattening identifiers or settings', async () => {
  const body = `WEBVTT\n\n${Array.from(
    { length: 15 },
    (_, i) =>
      `id-${i}\n00:${String(i * 2).padStart(2, '0')}.000 --> 00:${String(i * 2 + 1).padStart(2, '0')}.000 position:50% size:80%\nCue ${i}\n`
  ).join('\n')}`;
  const result = await fixture({ content: { 2: body } }).start().promise;
  assert.equal(result.oracle.length, 15);
  assert.equal(result.oracle[14].id, 'id-14');
  assert.equal(result.oracle[14].settings, 'position:50% size:80%');
});

test('accepts observed singleton audio encodings while preserving the entire bound caption chain', async () => {
  const f = fixture({ content: { 0: singletonAudioMaster } });
  const result = await f.start().promise;
  assert.deepEqual(
    f.state.calls.map((call) => call.url),
    [HLS, SUB, LEAF]
  );
  assert.deepEqual(result.vttBytes, encode(vtt));
  assert.equal(result.vttText, vtt);
  assert.equal(result.oracle.length, 2);
  assert.equal(result.oracle[0].id, 'first-id');
  assert.equal(result.oracle[0].text, '<v Speaker>Hello é world\nSecond line');
  assert.equal(result.oracle[0].settings, 'line:90% align:center');
  assert.equal(result.oracle[1].text, 'Next cue');
  assert.equal(f.state.timers.size, 0);
});

for (const [name, replacement] of [
  ['missing stream audio reference', singletonAudioMaster.replace('AUDIO="audio-low",', '')],
  [
    'dangling stream audio reference',
    singletonAudioMaster.replace('AUDIO="audio-low"', 'AUDIO="missing"'),
  ],
  [
    'unreferenced declared audio group',
    singletonAudioMaster.replaceAll('AUDIO="audio-high"', 'AUDIO="audio-mid"'),
  ],
  [
    'multiple members in a group',
    singletonAudioMaster.replace(
      '#EXT-X-VERSION:6',
      '#EXT-X-VERSION:6\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-low",NAME="Other",AUTOSELECT=YES,URI="other-audio.m3u8"'
    ),
  ],
  [
    'different member name',
    singletonAudioMaster.replace(
      'GROUP-ID="audio-mid",NAME="Audio"',
      'GROUP-ID="audio-mid",NAME="Other"'
    ),
  ],
  [
    'missing member name',
    singletonAudioMaster.replace('GROUP-ID="audio-mid",NAME="Audio",', 'GROUP-ID="audio-mid",'),
  ],
  [
    'language present in only one encoding',
    singletonAudioMaster.replace('GROUP-ID="audio-mid",', 'GROUP-ID="audio-mid",LANGUAGE="en",'),
  ],
  [
    'different language choices',
    singletonAudioMaster
      .replaceAll('NAME="Audio",', 'NAME="Audio",LANGUAGE="en",')
      .replace(
        'GROUP-ID="audio-mid",NAME="Audio",LANGUAGE="en"',
        'GROUP-ID="audio-mid",NAME="Audio",LANGUAGE="fr"'
      ),
  ],
  [
    'default present in only one encoding',
    singletonAudioMaster.replace('GROUP-ID="audio-mid",', 'GROUP-ID="audio-mid",DEFAULT=YES,'),
  ],
  [
    'different default choices',
    singletonAudioMaster
      .replaceAll('NAME="Audio",', 'NAME="Audio",DEFAULT=NO,')
      .replace(
        'GROUP-ID="audio-mid",NAME="Audio",DEFAULT=NO',
        'GROUP-ID="audio-mid",NAME="Audio",DEFAULT=YES'
      ),
  ],
  [
    'channels present in only one encoding',
    singletonAudioMaster.replace('GROUP-ID="audio-mid",', 'GROUP-ID="audio-mid",CHANNELS="6",'),
  ],
  [
    'nonautomatic selection',
    singletonAudioMaster.replace(
      'GROUP-ID="audio-mid",NAME="Audio",AUTOSELECT=YES',
      'GROUP-ID="audio-mid",NAME="Audio",AUTOSELECT=NO'
    ),
  ],
  [
    'missing automatic selection',
    singletonAudioMaster.replace(
      'GROUP-ID="audio-mid",NAME="Audio",AUTOSELECT=YES,',
      'GROUP-ID="audio-mid",NAME="Audio",'
    ),
  ],
  [
    'different characteristics',
    singletonAudioMaster.replace(
      'GROUP-ID="audio-mid",',
      'GROUP-ID="audio-mid",CHARACTERISTICS="public.accessibility.describes-video",'
    ),
  ],
  [
    'associated language choice',
    singletonAudioMaster.replace(
      'GROUP-ID="audio-mid",',
      'GROUP-ID="audio-mid",ASSOC-LANGUAGE="fr",'
    ),
  ],
  [
    'forced member choice',
    singletonAudioMaster.replace('GROUP-ID="audio-mid",', 'GROUP-ID="audio-mid",FORCED=YES,'),
  ],
  [
    'foreign audio host',
    singletonAudioMaster.replace(
      'URI="audio-mid.m3u8"',
      'URI="https://example.test/amplify_video/123/pl/audio.m3u8"'
    ),
  ],
  [
    'foreign audio asset',
    singletonAudioMaster.replace(
      'URI="audio-mid.m3u8"',
      'URI="https://video.twimg.com/amplify_video/456/pl/audio.m3u8"'
    ),
  ],
  [
    'unknown audio semantics',
    singletonAudioMaster.replace('GROUP-ID="audio-mid",', 'GROUP-ID="audio-mid",X-UNKNOWN=YES,'),
  ],
]) {
  test(`rejects singleton-encoding permission for ${name}`, async () => {
    const f = await rejected({ content: { 0: replacement } });
    assert.equal(f.state.calls.length, 1);
  });
}

test('descriptor accessors and extra fields never authorize a fetch', async () => {
  const f = fixture();
  let reads = 0;
  Object.defineProperty(f.descriptor, 'hlsUrl', {
    get() {
      reads++;
      throw Error('getter');
    },
  });
  await assert.rejects(f.start().promise, { code: 'descriptor' });
  assert.equal(reads, 0);
  assert.equal(f.state.calls.length, 0);
  const g = await rejected({ descriptor: { unrelated: true } }, 'descriptor');
  assert.equal(g.state.calls.length, 0);
});

for (const [label, url] of [
  ['wrong host', HLS.replace('video.twimg.com', 'example.com')],
  ['wrong asset', HLS.replace('/123/', '/124/')],
  ['credentials', HLS.replace('https://', 'https://user@')],
  ['explicit default port', HLS.replace('.com/', '.com:443/')],
  ['fragment', `${HLS}#`],
  ['HTTP', HLS.replace('https:', 'http:')],
  ['encoded path', HLS.replace('/123/', '/%31%32%33/')],
]) {
  test(`rejects unsafe descriptor URI: ${label}`, async () => {
    const f = await rejected({ descriptor: { hlsUrl: url } }, 'uri');
    assert.equal(f.state.calls.length, 0);
  });
}

for (const response of [
  { redirected: true },
  { status: 302 },
  { status: 206 },
  { url: 'https://example.com/other' },
  { type: 'opaqueredirect' },
  { body: null },
]) {
  test(`rejects redirected/partial/unbounded responses ${JSON.stringify(
    Object.keys(response)
  )}`, async () => {
    await rejected({ response });
  });
}

for (const [index, limit] of [
  [0, 32768],
  [1, 16384],
  [2, 65536],
]) {
  test(`cancels an oversized streamed file at stage ${index}`, async () => {
    const f = await rejected(
      { chunks: { [index]: [new Uint8Array(limit), new Uint8Array(1)] } },
      'bytes'
    );
    assert.equal(f.state.calls.length, index + 1);
    assert.ok(f.state.cancels > 0);
    assert.ok(f.state.calls.every((call) => call.options.signal.aborted));
  });
}

test('caps endless zero-byte chunks without starving the deadline task', async () => {
  let reads = 0;
  const f = await rejected(
    {
      read() {
        reads++;
        return Promise.resolve({ done: false, value: new Uint8Array() });
      },
    },
    'chunks'
  );
  assert.equal(reads, 2048);
  assert.equal(f.state.cancels, 1);
});

for (const kind of ['fetch', 'read']) {
  test(`hard deadline settles even when ${kind} ignores abort`, async () => {
    const f = fixture(
      kind === 'fetch'
        ? { fetch: () => new Promise(() => {}) }
        : { read: () => new Promise(() => {}) }
    );
    const task = f.start();
    const outcome = assert.rejects(task.promise, { code: 'deadline' });
    for (let n = 0; n < 10; n++) {
      await Promise.resolve();
    }
    assert.equal(f.state.timers.size, 1);
    const timer = [...f.state.timers.values()][0];
    assert.equal(timer.delay, 6000);
    timer.fn();
    await outcome;
    assert.equal(f.state.timers.size, 0);
    assert.equal(f.state.calls[0].options.signal.aborted, true);
    if (kind === 'read') {
      assert.equal(f.state.cancels, 1);
    }
  });
}

for (const method of ['cancel', 'signal']) {
  test(`cancels pending ignored-abort fetch by ${method}`, async () => {
    const f = fixture({ fetch: () => new Promise(() => {}) });
    const task = f.start();
    const outcome = assert.rejects(task.promise, { code: 'aborted' });
    if (method === 'cancel') {
      task.cancel();
    } else {
      f.state.signal.abort();
    }
    await outcome;
    assert.equal(f.state.timers.size, 0);
  });
}

test('rejects already stale or throwing current authority without requesting data', async () => {
  for (const isCurrent of [
    () => false,
    () => {
      throw Error('SDK');
    },
  ]) {
    const f = await rejected({ descriptor: { isCurrent } }, 'source-changed');
    assert.equal(f.state.calls.length, 0);
  }
});

test('source mutation during fetch callback aborts before the next request', async () => {
  const f = await rejected(
    {
      fetch(_url, _options, state) {
        state.current = false;
        return Promise.resolve({});
      },
    },
    'source-changed'
  );
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.calls[0].options.signal.aborted, true);
});

test('source mutation during reader callback cancels its exact reader', async () => {
  const f = await rejected(
    {
      read(state) {
        state.current = false;
        return Promise.resolve({ done: false, value: encode(master) });
      },
    },
    'source-changed'
  );
  assert.equal(f.state.cancels, 1);
});

for (const [name, replacement] of [
  [
    'alternate audio renditions',
    master
      .replace(
        '#EXT-X-STREAM-INF',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",URI="audio-en.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="fr",NAME="French",URI="audio-fr.m3u8"\n#EXT-X-STREAM-INF'
      )
      .replace('BANDWIDTH=100000,', 'BANDWIDTH=100000,AUDIO="audio",'),
  ],
  [
    'alternate video rendition',
    master
      .replace(
        '#EXT-X-STREAM-INF',
        '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="video",NAME="Alternate",URI="other-video.m3u8"\n#EXT-X-STREAM-INF'
      )
      .replace('BANDWIDTH=100000,', 'BANDWIDTH=100000,VIDEO="video",'),
  ],
  [
    'audio stream reference',
    master.replace('BANDWIDTH=100000,', 'BANDWIDTH=100000,AUDIO="audio",'),
  ],
  [
    'video stream reference',
    master.replace('BANDWIDTH=100000,', 'BANDWIDTH=100000,VIDEO="video",'),
  ],
  [
    'second subtitle',
    master.replace(
      '#EXT-X-STREAM-INF',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="other",LANGUAGE="fr",NAME="French",URI="other.m3u8"\n#EXT-X-STREAM-INF'
    ),
  ],
  ['different group', master.replace('SUBTITLES="subs",CLOSED', 'SUBTITLES="other",CLOSED')],
  ['closed caption group', master.replace('CLOSED-CAPTIONS=NONE', 'CLOSED-CAPTIONS="cc"')],
  ['ambiguous language', master.replace('LANGUAGE="en-US"', 'LANGUAGE="en,fr"')],
  ['duplicate attribute', master.replace('LANGUAGE="en-US"', 'LANGUAGE="en-US",LANGUAGE="fr"')],
  ['key', master.replace('#EXT-X-VERSION:6', '#EXT-X-KEY:METHOD=AES-128,URI="key"')],
  [
    'session key',
    master.replace('#EXT-X-VERSION:6', '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"'),
  ],
  ['map', master.replace('#EXT-X-VERSION:6', '#EXT-X-MAP:URI="init"')],
]) {
  test(`rejects master ambiguity/protection: ${name}`, async () => {
    const f = await rejected({ content: { 0: replacement } });
    assert.equal(f.state.calls.length, 1);
  });
}

for (const [name, replacement] of [
  ['missing ENDLIST', playlist.replace('#EXT-X-ENDLIST\n', '')],
  ['second segment', playlist.replace('#EXT-X-ENDLIST', `#EXTINF:1,\n${LEAF}\n#EXT-X-ENDLIST`)],
  ['duration mismatch', playlist.replace('37.120,', '35.000,')],
  ['byte range', playlist.replace('#EXTINF:', '#EXT-X-BYTERANGE:30@0\n#EXTINF:')],
  ['map', playlist.replace('#EXTINF:', '#EXT-X-MAP:URI="init"\n#EXTINF:')],
  ['other leaf asset', playlist.replace('/123/en.vtt', '/124/en.vtt')],
  ['other leaf host', playlist.replace(LEAF, LEAF.replace('video.twimg.com', 'example.com'))],
  ['unbound leaf folder', playlist.replace('/subtitles/', '/unrelated/subtitles/')],
]) {
  test(`rejects incomplete/unsafe subtitle playlist: ${name}`, async () => {
    const f = await rejected({ content: { 1: replacement } });
    assert.equal(f.state.calls.length, 2);
  });
}

for (const [name, replacement] of [
  [
    'timestamp map',
    vtt.replace('WEBVTT\r\n', 'WEBVTT\r\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\r\n'),
  ],
  ['unknown header', vtt.replace('WEBVTT\r\n', 'WEBVTT\r\nUNKNOWN:1\r\n')],
  ['STYLE', vtt.replace('first-id', 'STYLE')],
  ['REGION', vtt.replace('first-id', 'REGION')],
  ['invalid timestamp', vtt.replace('00:00.280', '00:60.280')],
  ['reversed timestamp', vtt.replace('00:02.602', '00:00.100')],
  ['past duration', vtt.replace('00:02.602', '01:00.000')],
  ['inline timestamp', vtt.replace('Next cue', '<00:03.000>Next cue')],
  ['unknown setting', vtt.replace('align:center', 'unknown:abc')],
  ['region setting', vtt.replace('align:center', 'region:box')],
]) {
  test(`rejects unsupported VTT semantics: ${name}`, async () => {
    const f = await rejected({ content: { 2: replacement } });
    assert.equal(f.state.calls.length, 3);
  });
}

test('rejects malformed UTF8 rather than silently replacing bytes', async () => {
  await rejected({ chunks: { 2: [new Uint8Array([0xc0, 0xaf])] } });
});

test('rejects invalid chunk objects without an uncapped text fallback', async () => {
  const f = await rejected(
    { read: () => Promise.resolve({ done: false, value: 'text' }) },
    'reader'
  );
  assert.equal(f.state.cancels, 1);
});

test('revalidates source after cleanup abort callbacks before handing off bytes', async () => {
  const f = fixture();
  const original = f.runtime.fetch;
  f.runtime.fetch = (url, options) => {
    options.signal.addEventListener('abort', () => {
      f.state.current = false;
    });
    return original(url, options);
  };
  await assert.rejects(f.start().promise, { code: 'source-changed' });
  assert.equal(f.state.calls.length, 3);
  assert.equal(f.state.timers.size, 0);
});

test('revalidates external cancellation after cleanup callbacks before handoff', async () => {
  const f = fixture();
  const original = f.runtime.clearTimeout;
  f.runtime.clearTimeout = (id) => {
    original(id);
    f.state.signal.abort();
  };
  await assert.rejects(f.start().promise, { code: 'aborted' });
  assert.equal(f.state.calls.length, 3);
  assert.equal(f.state.timers.size, 0);
});

test('honors direct cancellation during final cleanup before public settlement', async () => {
  const f = fixture();
  const original = f.runtime.clearTimeout;
  f.runtime.clearTimeout = (id) => {
    original(id);
    task.cancel();
  };
  const task = f.start();
  await assert.rejects(task.promise, { code: 'aborted' });
  assert.equal(f.state.calls.length, 3);
  assert.equal(f.state.timers.size, 0);
});

for (const stage of ['fetch', 'read']) {
  test(`consumes rejected ${stage} promises when the same callback loses source identity`, async () => {
    let reads = 0;
    const f = fixture(
      stage === 'fetch'
        ? {
            fetch(_url, _options, state) {
              state.current = false;
              return Promise.reject(new Error('rejected callback'));
            },
          }
        : {
            read(state) {
              reads++;
              state.current = false;
              return Promise.reject(new Error('rejected callback'));
            },
          }
    );
    await assert.rejects(f.start().promise, { code: 'source-changed' });
    // Vitest reports an unhandled rejection if a detached fetch/read promise
    // survives the source guard, even though the public task already rejected.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.state.calls.length, 1);
    assert.equal(reads, stage === 'read' ? 1 : 0);
    assert.equal(f.state.timers.size, 0);
  });
}

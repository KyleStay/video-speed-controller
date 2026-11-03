import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFixtureServer } from './fixture-server.js';
import { assert, monitorPageErrors } from './e2e-utils.js';

const execute = promisify(execFile);
const ASSET = 'https://video.twimg.com/amplify_video/2041611432752742400/';
const MIME = { video: 'video/mp4', audio: 'audio/mp4', playlist: 'application/vnd.apple.mpegurl' };
const CAPTION_PLAYLIST = `${ASSET}pl/1280x720/subtitles.m3u8`;
const CAPTION_VTT = `${ASSET}subtitles/en.vtt`;
// Independently calculated public HLS generateCueId vectors, not an application helper.
const CAPTION_CUES = [
  [0, 0.5, 'Fixture caption 1', '1775571933555981271461275'],
  [0.5, 1, 'Fixture caption 2', '1933555981775562644046168'],
  [1, 1.5, 'Fixture caption 3', '177556193355599309840281'],
  [1.5, 2, 'Fixture caption 4', '1933555991775593960577118'],
  [2, 2.5, 'Fixture caption 5', '1775591933555961626371231'],
  [2.5, 3, 'Fixture caption 6', '1933555961775582998956124'],
  [3, 3.5, 'Fixture caption 7', '177558193355597664750237'],
  [3.5, 4, 'Fixture caption 8', '1933555971775534149581138'],
  [4, 4.5, 'Fixture caption 9', '1775531933555941815375251'],
];
const CAPTION_SETTINGS = {
  vertical: '',
  snapToLines: false,
  line: 85,
  lineAlign: 'start',
  position: 15,
  positionAlign: 'auto',
  size: 70,
  align: 'start',
  pauseOnExit: false,
  region: null,
};
const captionVTT = () => {
  const stamp = (seconds) => `00:00:${seconds.toFixed(3).padStart(6, '0')}`;
  return `WEBVTT\n\n${CAPTION_CUES.map(
    ([start, end, text]) =>
      `${stamp(start)} --> ${stamp(end)} line:85% position:15% size:70% align:start\n${text}\n`
  ).join('\n')}\n`;
};

const captionOracle = (cue, period = 0) => {
  const template = CAPTION_CUES.find((entry) => entry[3] === cue.id);
  assert.true(!!template, JSON.stringify(cue));
  const [start, end, text] = template;
  const epoch = period ? Math.round((cue.startTime - start) / period) : 0;
  assert.true(
    Number.isSafeInteger(epoch) &&
      epoch >= 0 &&
      Math.abs(cue.startTime - start - epoch * period) < 0.002 &&
      Math.abs(cue.endTime - end - epoch * period) < 0.002 &&
      cue.text === text &&
      Object.entries(CAPTION_SETTINGS).every(([key, value]) => cue[key] === value),
    JSON.stringify(cue)
  );
  return epoch;
};

// Active-cue caches and the native clock need not update atomically with rVFC.
// Require every cue's positive activation, rather than treating a stale cache
// sample as proof of missing or incorrectly scheduled captions.
export function validateCaptionActivationCoverage({ audit, timeline, committed, rolling }) {
  const period = rolling.period;
  assert.true(Number.isFinite(period) && period > 0 && committed.period === period);
  assert.true(!audit.overflow && audit.attachedVideos === 1, JSON.stringify(audit));
  assert.true(rolling.at > committed.at && rolling.nativeTime > committed.nativeTime);
  const firstEpoch = Math.ceil(committed.nativeTime / period);
  const lastEpoch = Math.floor(rolling.nativeTime / period) - 1;
  const fullEpochs = Array.from(
    { length: Math.max(0, lastEpoch - firstEpoch + 1) },
    (_, index) => firstEpoch + index
  );
  assert.true(fullEpochs.length >= 2, 'At least two complete continuous epochs are required');
  assert.false(
    timeline.lifecycle.some(
      (event) =>
        event.type === 'seeking' &&
        event.at + rolling.measurementStartedAt >= committed.at &&
        event.at + rolling.measurementStartedAt <= rolling.at
    ),
    'A recorded seek interrupts caption activation coverage'
  );
  const samples = audit.rows.filter(
    (sample) => sample.at >= committed.at && sample.at <= rolling.at
  );
  assert.true(
    samples.some((sample) => sample.kind === 'frame'),
    'Missing native frame samples'
  );
  const coverage = new Map(fullEpochs.map((epoch) => [epoch, CAPTION_CUES.map(() => [])]));
  let previousTime = committed.nativeTime,
    previousOrdinal = -1;
  for (const sample of samples) {
    assert.true(
      sample.committed &&
        sample.mode === 'showing' &&
        sample.source === committed.source &&
        !sample.paused &&
        !sample.seeking &&
        sample.nativeRate === 4 &&
        sample.nativeTime >= previousTime &&
        sample.nativeTime <= rolling.nativeTime,
      JSON.stringify(sample)
    );
    previousTime = sample.nativeTime;
    const nativeEpoch = Math.floor(sample.nativeTime / period);
    let maximumOrdinal = -1;
    for (const cue of sample.cues) {
      const epoch = captionOracle(cue, period);
      const index = CAPTION_CUES.findIndex((entry) => entry[3] === cue.id);
      const ordinal = epoch * CAPTION_CUES.length + index;
      assert.true(epoch === nativeEpoch, JSON.stringify(sample));
      maximumOrdinal = Math.max(maximumOrdinal, ordinal);
      if (
        coverage.has(epoch) &&
        sample.nativeTime >= cue.startTime &&
        sample.nativeTime < cue.endTime
      ) {
        coverage.get(epoch)[index].push({
          kind: sample.kind,
          at: sample.at,
          nativeTime: sample.nativeTime,
        });
      }
    }
    if (sample.cues.length) {
      assert.true(maximumOrdinal >= previousOrdinal, JSON.stringify(sample));
      previousOrdinal = maximumOrdinal;
    }
  }
  const epochs = [...coverage].map(([epoch, cues]) => ({
    epoch,
    cues: cues.map((observations, index) => {
      assert.true(
        observations.length > 0,
        `No in-window activation for epoch ${epoch}, cue ${index + 1}`
      );
      return { id: CAPTION_CUES[index][3], observations };
    }),
  }));
  return {
    continuousNativeSpan: [committed.nativeTime, rolling.nativeTime],
    continuousWallSpan: [committed.at, rolling.at],
    fullEpochs,
    partialEpochsNotCounted: [
      Math.floor(committed.nativeTime / period),
      Math.floor(rolling.nativeTime / period),
    ].filter((epoch) => !fullEpochs.includes(epoch)),
    sampleCount: samples.length,
    emptySamplesRetained: samples.filter((sample) => sample.cues.length === 0).length,
    epochs,
  };
}

function installCaptionActivationAudit() {
  const fixture = window.__twitterLoopFixture;
  const scope = fixture.original.parentElement;
  const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime').get;
  const nativeRate = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'playbackRate'
  ).get;
  const rows = [],
    removers = [],
    handles = new Map(),
    watched = new Set();
  let overflow = false,
    stopped = false;
  const record = (video, kind, metadata = null) => {
    if (stopped) {
      return;
    }
    if (rows.length >= 4096) {
      overflow = true;
      return;
    }
    const track = video.querySelector('track')?.track;
    rows.push({
      kind,
      at: performance.now(),
      nativeTime: nativeTime.call(video),
      committed: fixture.current() === video,
      source: video.currentSrc,
      nativeRate: nativeRate.call(video),
      paused: video.paused,
      seeking: video.seeking,
      mode: track?.mode,
      metadata,
      cues: Array.from(track?.activeCues || [], (cue) => ({
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cue.text,
        vertical: cue.vertical,
        snapToLines: cue.snapToLines,
        line: cue.line,
        lineAlign: cue.lineAlign,
        position: cue.position,
        positionAlign: cue.positionAlign,
        size: cue.size,
        align: cue.align,
        pauseOnExit: cue.pauseOnExit,
        region: cue.region,
      })),
    });
  };
  const watch = (video) => {
    if (video === fixture.original || watched.has(video)) {
      return;
    }
    watched.add(video);
    const tracks = new Set();
    const watchTrack = (track) => {
      if (tracks.has(track)) {
        return;
      }
      tracks.add(track);
      const changed = () => record(video, 'cuechange');
      track.addEventListener('cuechange', changed);
      removers.push(() => track.removeEventListener('cuechange', changed));
    };
    for (const track of video.textTracks) {
      watchTrack(track);
    }
    const added = (event) => watchTrack(event.track);
    video.textTracks.addEventListener('addtrack', added);
    removers.push(() => video.textTracks.removeEventListener('addtrack', added));
    const sample = (now, metadata) => {
      handles.delete(video);
      if (stopped) {
        return;
      }
      record(video, 'frame', {
        now,
        mediaTime: metadata.mediaTime,
        presentedFrames: metadata.presentedFrames,
        expectedDisplayTime: metadata.expectedDisplayTime,
      });
      if (!overflow) {
        handles.set(video, video.requestVideoFrameCallback(sample));
      }
    };
    handles.set(video, video.requestVideoFrameCallback(sample));
  };
  const scan = () => {
    for (const video of scope.querySelectorAll('video')) {
      watch(video);
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(scope, { childList: true, subtree: true });
  scan();
  const read = () => ({ rows, overflow, attachedVideos: watched.size, stopped });
  window.__captionActivationAudit = {
    read,
    stop() {
      stopped = true;
      observer.disconnect();
      for (const [video, handle] of handles) {
        video.cancelVideoFrameCallback(handle);
      }
      handles.clear();
      for (const remove of removers) {
        remove();
      }
      removers.length = 0;
      return read();
    },
  };
}

function installNativeRateAcceptanceAudit() {
  const video = window.__twitterLoopFixture.original;
  const controller = video.vsc;
  const nativeRate = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'playbackRate'
  ).get;
  const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime').get;
  const own = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.value;
  const inputs = [],
    observations = [];
  let lastInputAt = null,
    firstActual4At = null,
    firstTimeOver1 = null,
    stopped = false;
  const read = (label) => {
    const state = controller.actionHandler.eventManager.mediaRateStates.get(video);
    const hint = state && own(state, 'nativeRelative');
    const row = {
      label,
      at: performance.now(),
      nativeRate: nativeRate.call(video),
      publicRate: video.playbackRate,
      nativeTime: nativeTime.call(video),
      lastInputAt,
      pending: hint
        ? Object.fromEntries(
            ['rate', 'target', 'commandRevision', 'cancelled', 'timer'].map((key) => [
              key,
              own(hint, key),
            ])
          )
        : null,
    };
    if (observations.length >= 512) {
      throw Error('Native rate acceptance audit overflow');
    }
    observations.push(row);
    if (inputs.filter((input) => input.action === 'faster').length === 20) {
      if (row.nativeTime > 1 && firstTimeOver1 === null) {
        firstTimeOver1 = row;
      }
      if (row.nativeRate === 4 && row.publicRate === 4 && firstActual4At === null) {
        firstActual4At = row.at;
      }
    }
    return row;
  };
  const clicked = (event) => {
    if (stopped || !event.isTrusted || !event.composedPath().includes(controller.div)) {
      return;
    }
    const button = event
      .composedPath()
      .find(
        (node) =>
          node instanceof HTMLElement &&
          (node.getAttribute('data-action') === 'faster' ||
            (node.getAttribute('data-action') === 'setSpeed' &&
              node.getAttribute('data-value') === '2'))
      );
    if (!button) {
      return;
    }
    const action = button.getAttribute('data-action');
    const at = performance.now();
    if (action === 'faster') {
      lastInputAt = at;
    }
    inputs.push({
      action,
      at,
      trusted: event.isTrusted,
      eventPhase: event.eventPhase,
      eventTimeStamp: event.timeStamp,
    });
    read('trusted-input');
  };
  window.addEventListener('click', clicked, true);
  const result = () => ({
    inputs,
    observations,
    lastInputAt,
    firstActual4At,
    firstTimeOver1,
    stopped,
  });
  window.__nativeRateAcceptance = {
    read,
    result,
    stop() {
      stopped = true;
      window.removeEventListener('click', clicked, true);
      return result();
    },
  };
  read('installed');
}

// Generated fMP4 only: preserve all complete moof/mdat pairs, excluding the trailing index.
function fragments(bytes) {
  let offset = 0,
    first = -1,
    end = -1;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset),
      type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size < 8 || offset + size > bytes.length) {
      throw Error('Invalid generated MP4 box');
    }
    if (type === 'moof' && first < 0) {
      first = offset;
    }
    if (type === 'mdat') {
      end = offset + size;
    }
    offset += size;
  }
  if (first <= 0 || end <= first) {
    throw Error('Generated media is not fragmented');
  }
  return { init: bytes.subarray(0, first), media: bytes.subarray(first, end) };
}

export default async function runTwitterLoop({ launch }) {
  const directory = resolve('test-results/twitter-loop-browser/caption-bootstrap-prototype');
  let browser,
    page,
    fixture,
    errors,
    passed = 0,
    rejectedAsset = false,
    captionScenario = false,
    captionMismatch = false,
    holdCaptionVTT = false,
    releaseCaptionVTT = null,
    captionAuditProgress = null,
    nativeRateAcceptanceProgress = null;
  const evidence = [],
    requests = [];
  try {
    await mkdir(directory, { recursive: true });
    const media = new Map();
    for (const dimensions of ['1280x720', '720x1280']) {
      const mp4Path = resolve(directory, `${dimensions}-muxed.mp4`);
      await execute(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `testsrc=size=${dimensions}:rate=30`,
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '5',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-profile:v',
          'baseline',
          '-level:v',
          '3.1',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '30',
          '-b:v',
          '700k',
          '-maxrate',
          '700k',
          '-bufsize',
          '1400k',
          '-c:a',
          'aac',
          '-b:a',
          '96k',
          '-movflags',
          'frag_keyframe+empty_moov+default_base_moof',
          mp4Path,
        ],
        { timeout: 60000, maxBuffer: 1024 * 1024 }
      );
      const tracks = {};
      for (const track of ['video', 'audio']) {
        const path = resolve(directory, `${dimensions}-${track}.mp4`);
        await execute(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            mp4Path,
            '-map',
            track === 'video' ? '0:v:0' : '0:a:0',
            '-c',
            'copy',
            '-movflags',
            'frag_keyframe+empty_moov+default_base_moof',
            path,
          ],
          { timeout: 30000, maxBuffer: 1024 * 1024 }
        );
        tracks[track] = fragments(await readFile(path));
      }
      media.set(dimensions, { ...tracks, path: mp4Path, muxed: await readFile(mp4Path) });
    }
    const masterURL = (dimensions) => `${ASSET}pl/${dimensions}/current.m3u8`;
    const progressiveURL = (dimensions) => `${ASSET}vid/avc1/${dimensions}/current.mp4`;
    const selectedURLs = (dimensions) => [
      `${ASSET}pl/${dimensions}/video.m3u8`,
      `${ASSET}pl/${dimensions}/audio-96000.m3u8`,
      `${ASSET}vid/avc1/${dimensions}/init.mp4`,
      `${ASSET}aud/mp4a/${dimensions}/init.mp4`,
      `${ASSET}vid/avc1/${dimensions}/clip.m4s`,
      `${ASSET}aud/mp4a/${dimensions}/clip.m4s`,
    ];
    const master = (dimensions, captions = false) => {
      const resolutions =
        dimensions === '720x1280'
          ? ['180x320', '360x640', dimensions]
          : ['320x180', '640x360', dimensions];
      const pairs = resolutions.map((resolution, index) => ({
        resolution,
        audioRate: [32000, 64000, 96000][index],
        bandwidth: [200000, 400000, 800000][index],
      }));
      return [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        ...(captions
          ? [
              `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="fixture-subs",NAME="en (auto-generated)",LANGUAGE="en",AUTOSELECT=YES,URI="${CAPTION_PLAYLIST}"`,
            ]
          : []),
        ...pairs.flatMap(({ resolution, audioRate, bandwidth }) => [
          `#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-${audioRate}",AUTOSELECT=YES,URI="${ASSET}pl/${resolution}/audio-${audioRate}.m3u8"`,
          `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="mp4a.40.2,avc1.42c01f",AUDIO="audio-${audioRate}"${captions ? ',SUBTITLES="fixture-subs"' : ''}`,
          `${ASSET}pl/${resolution}/video.m3u8`,
        ]),
        '',
      ].join('\n');
    };
    const mediaPlaylist = (track, dimensions) =>
      `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="${ASSET}${track === 'video' ? 'vid/avc1' : 'aud/mp4a'}/${dimensions}/init.mp4"\n#EXTINF:5.000,\n${ASSET}${track === 'video' ? 'vid/avc1' : 'aud/mp4a'}/${dimensions}/clip.m4s\n#EXT-X-ENDLIST\n`;
    const routes = new Map();
    routes.set(CAPTION_PLAYLIST, {
      type: MIME.playlist,
      body: `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:5.000,\n${CAPTION_VTT}\n#EXT-X-ENDLIST\n`,
    });
    routes.set(CAPTION_VTT, { type: 'text/vtt', body: captionVTT() });
    for (const [dimensions, asset] of media) {
      const [videoPlaylist, audioPlaylist, videoInit, audioInit, videoSegment, audioSegment] =
        selectedURLs(dimensions);
      for (const [url, type, body] of [
        [masterURL(dimensions), MIME.playlist, master(dimensions)],
        [videoPlaylist, MIME.playlist, mediaPlaylist('video', dimensions)],
        [audioPlaylist, MIME.playlist, mediaPlaylist('audio', dimensions)],
        [videoInit, MIME.video, asset.video.init],
        [audioInit, MIME.audio, asset.audio.init],
        [videoSegment, MIME.video, asset.video.media],
        [audioSegment, MIME.audio, asset.audio.media],
        [progressiveURL(dimensions), MIME.video, asset.muxed],
      ]) {
        routes.set(url, { type, body });
      }
    }
    fixture = await startFixtureServer({
      mp4Path: media.get('1280x720').path,
      binaryRoutes: { '/portrait.mp4': { type: MIME.video, body: media.get('720x1280').muxed } },
      htmlRoutes: {
        '/twitter-loop.html': await readFile(
          new URL('./twitter-loop.html', import.meta.url),
          'utf8'
        ),
      },
    });
    ({ browser, page } = await launch());
    errors = monitorPageErrors(page);
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('https://video.twimg.com/')) {
        void request.continue();
        return;
      }
      let route = routes.get(url);
      if (captionScenario && url === masterURL('1280x720')) {
        route = { type: MIME.playlist, body: master('1280x720', true) };
      }
      if (captionMismatch && url === CAPTION_VTT) {
        route = {
          type: 'text/vtt',
          body: captionVTT().replace('Fixture caption 5', 'Changed caption 5'),
        };
      }
      requests.push({ url, rejected: rejectedAsset && url.endsWith('/clip.m4s') });
      if (!route) {
        void request.abort('blockedbyclient');
        return;
      }
      if (url === CAPTION_VTT && holdCaptionVTT) {
        releaseCaptionVTT = async (abort = false) => {
          releaseCaptionVTT = null;
          holdCaptionVTT = false;
          if (abort) {
            await request.abort('aborted');
            return;
          }
          await request.respond({
            status: 200,
            contentType: route.type,
            headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
            body: route.body,
          });
        };
        return;
      }
      if (rejectedAsset && url.endsWith('/clip.m4s')) {
        void request.respond({
          status: 503,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: 'fixture rejection',
        });
        return;
      }
      void request.respond({
        status: 200,
        contentType: route.type,
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        body: route.body,
      });
    });
    const state = () => page.evaluate(() => window.__twitterLoopFixture.snapshot());
    let requestStart = 0;
    const load = async (query = '', { eligible = true } = {}) => {
      captionScenario = new URLSearchParams(query).has('caption');
      captionMismatch = new URLSearchParams(query).has('caption-mismatch');
      requestStart = requests.length;
      await page.goto(`${fixture.baseUrl}/twitter-loop.html${query}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () =>
          window.__twitterLoopFixture?.snapshot().ready ||
          window.__twitterLoopFixture?.snapshot().error
      );
      const row = await state();
      assert.false(!!row.error, JSON.stringify(row));
      await page.waitForFunction(
        (eligible, captionScenario) =>
          !!window.__twitterLoopFixture.original.vsc &&
          (!eligible ||
            !!window.VSC.TwitterPlayer[captionScenario ? 'resolveCaptionedLoop' : 'resolve'](
              window.__twitterLoopFixture.original
            )),
        {},
        eligible,
        captionScenario
      );
      if (captionScenario) {
        await page.evaluate(() => window.__twitterLoopFixture.auditSpeedInput());
      }
    };
    const selection = (dimensions, { masterDimensions = dimensions, children = true } = {}) => {
      const observed = requests.slice(requestStart);
      const allowed = new Set([
        masterURL(masterDimensions),
        progressiveURL(dimensions),
        ...(children ? selectedURLs(dimensions) : []),
        ...(captionScenario ? [CAPTION_PLAYLIST, CAPTION_VTT] : []),
      ]);
      assert.true(
        observed.every((request) => allowed.has(request.url)),
        JSON.stringify(observed)
      );
      assert.true(
        observed.some((request) => request.url === masterURL(masterDimensions)),
        'Selected master was not read'
      );
      if (children) {
        assert.true(
          selectedURLs(dimensions)
            .slice(0, 2)
            .every((url) => observed.some((request) => request.url === url)),
          JSON.stringify(observed)
        );
      }
      return observed;
    };
    const product = async (selector) => {
      const handle = await page.evaluateHandle(
        (selector) =>
          window.__twitterLoopFixture.current().vsc.div.shadowRoot.querySelector(selector),
        selector
      );
      try {
        assert.true(!!handle.asElement(), selector);
        await handle.asElement().click();
      } finally {
        await handle.dispose();
      }
    };
    const owned = async (name) => {
      const handle = await page.evaluateHandle(
        (name) => window.__twitterLoopFixture.current().vsc.iosPlayer.ui.refs[name],
        name
      );
      try {
        assert.true(!!handle.asElement(), name);
        await handle.asElement().click();
      } finally {
        await handle.dispose();
      }
    };
    const begin = async () => {
      await page.click('#play');
      await product('.draggable');
      await product('[data-action="setSpeed"][data-value="2"]');
      await product('[data-action="faster"]');
      await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().native);
    };
    const seekOwnedOneSecond = async () => {
      const range = await page.evaluateHandle(
        () => window.__twitterLoopFixture.current().vsc.iosPlayer.ui.refs.seek
      );
      try {
        await range.asElement().focus();
        await range.asElement().press('Home');
        for (let i = 0; i < 10; i++) {
          await range.asElement().press('ArrowRight');
        }
      } finally {
        await range.dispose();
      }
      await page.waitForFunction(() => {
        const row = window.__twitterLoopFixture.snapshot();
        // The product slider steps in seconds: Home + ten 0.1-second arrows = 1 second.
        return Math.abs(row.time - 1) < 0.05 && !window.__twitterLoopFixture.current().seeking;
      });
    };
    const captionFour = async ({ position = false, waitForCompanion = false } = {}) => {
      if (position) {
        await page.click('#caption-start');
        await page.waitForFunction(() => {
          const original = window.__twitterLoopFixture.original;
          return !original.seeking && Math.abs(original.currentTime - 0.8) < 0.02;
        });
      }
      const start = (await state()).originalTime;
      await page.click('#play');
      await page.waitForFunction(
        (start) => {
          const original = window.__twitterLoopFixture.original;
          return !original.paused && original.currentTime > start + 0.01;
        },
        {},
        start
      );
      await product('.draggable');
      await product('[data-action="setSpeed"][data-value="2"]');
      if (waitForCompanion) {
        await product('[data-action="faster"]');
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().native);
        await product('.draggable');
      }
      for (let i = 0; i < (waitForCompanion ? 19 : 20); i++) {
        await product('[data-action="faster"]');
      }
      await product('[data-action="close"]');
      if (waitForCompanion) {
        // Existing relative-input batching commits the requested rate after 100 ms.
        await page.waitForFunction(() => {
          const row = window.__twitterLoopFixture.snapshot();
          return row.native && row.rate === 4 && row.companionNativeRate === 4;
        });
      }
    };
    const originalCaptions = (row) => {
      assert.true(
        row.originalCaptionReady === 2 &&
          row.originalCaptionMode === 'showing' &&
          row.originalCaptionUnchanged &&
          row.originalCaptionCues.length === 9 &&
          row.originalLoop === false &&
          row.sameProducer &&
          row.originalSourceUnchanged &&
          row.originalParentUnchanged &&
          row.originalCalls.load === 0,
        JSON.stringify(row)
      );
      for (const cue of row.originalCaptionCues) {
        captionOracle(cue);
      }
    };
    const ownedCaptions = (row) => {
      assert.true(
        row.captionTrackReady === 2 &&
          row.captionTrackMode === 'showing' &&
          row.captionEpochVerified === true &&
          row.captionCues.length >= 9 &&
          row.captionCues.length % 9 === 0,
        JSON.stringify(row)
      );
      const epochs = new Map();
      for (const cue of row.captionCues) {
        const epoch = captionOracle(cue, row.period);
        const ids = epochs.get(epoch) || new Set();
        assert.false(ids.has(cue.id), 'Duplicate cue in one native epoch');
        ids.add(cue.id);
        epochs.set(epoch, ids);
      }
      assert.true([...epochs.values()].every((ids) => ids.size === 9));
    };
    const noCaptionFallback = () => {
      assert.false(
        requests.slice(requestStart).some((request) => request.url === progressiveURL('1280x720')),
        'Captioned content must not fall back to MP4'
      );
    };
    const captionHandback = (row, { paused = false } = {}) => {
      originalCaptions(row);
      assert.true(
        !row.native &&
          row.originalPaused === paused &&
          row.rate === 4 &&
          row.loopClosed &&
          row.loopURLRevoked &&
          row.loopProperties.length === 0 &&
          row.loopChildren === 0 &&
          row.subscribers === 0 &&
          row.muted &&
          row.volume === 1,
        JSON.stringify(row)
      );
      if (paused) {
        assert.true(Math.abs(row.originalTime - 1) < 0.05, JSON.stringify(row));
      }
      noCaptionFallback();
    };
    const check = async (label, work) => {
      try {
        await work();
        errors.assertNone(label);
        passed++;
        console.log(`PASS: continuous loop fixture ${label}`);
      } finally {
        if (captionAuditProgress) {
          captionAuditProgress.activationAudit = await page.evaluate(() =>
            window.__captionActivationAudit.stop()
          );
          captionAuditProgress = null;
        }
        if (nativeRateAcceptanceProgress) {
          nativeRateAcceptanceProgress.nativeRateAcceptance = await page.evaluate(() =>
            window.__nativeRateAcceptance?.stop()
          );
          nativeRateAcceptanceProgress = null;
        }
      }
    };
    await check(
      'genuine speed input runs real rolling A/V buffers with clip-relative controls',
      async () => {
        await load();
        await begin();
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().sourceCurrent);
        await product('.draggable');
        for (let i = 0; i < 19; i++) {
          await product('[data-action="faster"]');
        }
        await product('[data-action="close"]');
        await page.waitForFunction(
          () => {
            const row = window.__twitterLoopFixture.snapshot();
            return row.rate === 4 && row.nativeTime > 25 && row.removedBefore > 0;
          },
          { timeout: 15000 }
        );
        const row = await state();
        assert.true(
          row.rate === 4 &&
            row.playing &&
            row.time >= 0 &&
            row.time < row.period &&
            row.duration === row.period &&
            row.progressiveURL === row.suppliedMP4 &&
            row.progressiveURL === progressiveURL('1280x720') &&
            row.videoWidth === 1280 &&
            row.videoHeight === 720 &&
            row.mediaSourceState === 'open' &&
            row.tracks.length === 2 &&
            row.decodedFrames >= 100 &&
            row.decodedMediaSpan > 20 &&
            row.originalPaused &&
            row.sameProducer &&
            row.originalSourceUnchanged &&
            row.originalParentUnchanged &&
            row.originalCalls.play === 1 &&
            row.originalCalls.load === 0,
          JSON.stringify(row)
        );
        assert.true(
          row.tracks.every(
            (track) =>
              track.ranges.length === 1 &&
              track.ranges[0][0] > 0 &&
              track.ranges[0][1] - track.ranges[0][0] < row.period * 6
          ),
          JSON.stringify(row.tracks)
        );
        evidence.push({
          scenario: 'rolling',
          ...row,
          selectionRequests: selection('1280x720'),
          timeline: await page.evaluate(() => ({
            frames: window.__twitterLoopFixture.frames,
            lifecycle: window.__twitterLoopFixture.lifecycle,
          })),
        });
      }
    );
    await check(
      'owned entry, paused genuine seek, return and handback retain source authority',
      async () => {
        const source = (await state()).source;
        await page.click('#fullscreen');
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().owned);
        await owned('play');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().playing);
        await seekOwnedOneSecond();
        let row = await state();
        assert.true(
          !row.playing && row.source === source && row.sourceCurrent && row.sameProducer,
          JSON.stringify(row)
        );
        await page.screenshot({ path: resolve(directory, 'owned-paused-seek.png') });
        await owned('play');
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().playing);
        await owned('done');
        await page.waitForFunction(
          () =>
            !window.__twitterLoopFixture.snapshot().owned && document.body.dataset.owned === 'false'
        );
        await page.click('#site');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().native);
        row = await state();
        assert.true(
          row.sameProducer &&
            row.originalSourceUnchanged &&
            row.originalParentUnchanged &&
            row.loopClosed &&
            row.loopURLRevoked &&
            row.loopChildren === 0 &&
            row.loopProperties.length === 0 &&
            !row.originalPaused &&
            row.originalCalls.load === 0,
          JSON.stringify(row)
        );
        evidence.push({ scenario: 'handback', ...row });
      }
    );
    await check(
      'paused handback preserves the genuine one-second seek on the original producer',
      async () => {
        await load();
        await begin();
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().sourceCurrent);
        const source = (await state()).source;
        await page.click('#fullscreen');
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().owned);
        await owned('play');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().playing);
        await seekOwnedOneSecond();
        const paused = await state();
        assert.true(paused.source === source && paused.sourceCurrent && paused.sameProducer);
        await owned('done');
        await page.waitForFunction(
          () =>
            !window.__twitterLoopFixture.snapshot().owned && document.body.dataset.owned === 'false'
        );
        await page.click('#site');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().native);
        const row = await state();
        assert.true(
          row.sameProducer &&
            row.originalSourceUnchanged &&
            row.originalParentUnchanged &&
            row.originalPaused &&
            Math.abs(row.originalTime - 1) < 0.05 &&
            row.originalCalls.play === 1 &&
            row.originalCalls.load === 0 &&
            row.muted === paused.muted &&
            row.volume === paused.volume &&
            row.loopClosed &&
            row.loopURLRevoked &&
            row.loopChildren === 0 &&
            row.loopProperties.length === 0,
          JSON.stringify(row)
        );
        evidence.push({ scenario: 'paused-handback', paused, ...row });
      }
    );
    await check(
      'three-pair selection preserves the exact portrait progressive dimensions',
      async () => {
        await load('?portrait=1');
        await begin();
        await page.waitForFunction(() => {
          const row = window.__twitterLoopFixture.snapshot();
          return row.sourceCurrent && row.nativeTime > row.period;
        });
        const row = await state();
        assert.true(
          row.native &&
            row.progressiveURL === row.suppliedMP4 &&
            row.progressiveURL === progressiveURL('720x1280') &&
            row.videoWidth === 720 &&
            row.videoHeight === 1280 &&
            row.tracks.length === 2 &&
            row.sameProducer &&
            row.originalSourceUnchanged &&
            row.originalCalls.load === 0,
          JSON.stringify(row)
        );
        evidence.push({
          scenario: 'portrait-selection',
          ...row,
          selectionRequests: selection('720x1280'),
        });
      }
    );
    await check('swapped dimensions do not fetch an unselected HLS pair', async () => {
      await load('?mismatch=1');
      await begin();
      await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().loopFallback);
      const row = await state();
      assert.true(
        row.native &&
          row.loopFallback &&
          row.progressiveURL === row.suppliedMP4 &&
          row.source === progressiveURL('1280x720') &&
          row.loopClosed &&
          row.loopURLRevoked &&
          row.loopProperties.length === 0 &&
          row.sameProducer &&
          row.originalSourceUnchanged &&
          row.originalCalls.load === 0,
        JSON.stringify(row)
      );
      evidence.push({
        scenario: 'ordered-dimension-veto',
        ...row,
        selectionRequests: selection('1280x720', { masterDimensions: '720x1280', children: false }),
      });
    });
    await check('unreadable HLS retains the verified MP4 route on the same companion', async () => {
      rejectedAsset = true;
      await load();
      await begin();
      await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().loopFallback);
      const row = await state();
      const sameVideo = await page.evaluate(
        () => window.__twitterLoopFixture.session.video === window.__twitterLoopFixture.loop.video
      );
      assert.true(
        sameVideo &&
          row.native &&
          row.loopFallback &&
          row.source === progressiveURL('1280x720') &&
          row.loopClosed &&
          row.loopURLRevoked &&
          row.loopProperties.length === 0 &&
          row.sameProducer &&
          row.originalSourceUnchanged &&
          row.originalCalls.load === 0,
        JSON.stringify(row)
      );
      evidence.push({ scenario: 'fallback', ...row, selectionRequests: selection('1280x720') });
      rejectedAsset = false;
    });
    for (const action of ['captions', 'replace']) {
      await check(`late ${action} releases the owned decoder and properties`, async () => {
        await load();
        await begin();
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().sourceCurrent);
        const before = await state();
        await page.click(`#${action}`);
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().sessionClosed);
        if (action === 'replace') {
          await page.waitForFunction(
            (before) => window.__twitterLoopFixture.snapshot().originalSource !== before,
            {},
            before.originalSource
          );
        }
        const row = await state();
        assert.true(
          row.loopClosed &&
            row.loopURLRevoked &&
            row.loopChildren === 0 &&
            row.loopProperties.length === 0 &&
            row.originalCalls.load === 0,
          JSON.stringify(row)
        );
        if (action === 'captions') {
          assert.true(row.sameProducer && row.originalSourceUnchanged, JSON.stringify(row));
        }
        evidence.push({ scenario: action, ...row });
      });
    }
    await check(
      'finite creator loop policy vetoes takeover despite current SDK shouldLoop',
      async () => {
        await load('?finite=1', { eligible: false });
        const before = await state();
        assert.true(
          before.creatorOwnLoop &&
            before.creatorLoop === false &&
            before.creatorOwnMaxLoopCount &&
            before.creatorMaxLoopCount === 2 &&
            before.selectedContentSame &&
            before.sdkShouldLoop,
          JSON.stringify(before)
        );
        await page.click('#play');
        await product('.draggable');
        await product('[data-action="setSpeed"][data-value="2"]');
        for (let i = 0; i < 20; i++) {
          await product('[data-action="faster"]');
        }
        await product('[data-action="close"]');
        await page.waitForFunction(() => {
          const row = window.__twitterLoopFixture.snapshot();
          return row.rate === 4 && row.originalTime > 1 && !row.originalPaused;
        });
        const row = await state();
        const candidate = await page.evaluate(() =>
          window.VSC.TwitterPlayer.resolve(window.__twitterLoopFixture.original)
        );
        assert.true(
          !candidate &&
            !row.native &&
            row.source === before.source &&
            row.sameProducer &&
            row.originalSourceUnchanged &&
            row.originalParentUnchanged &&
            row.originalLoop === before.originalLoop &&
            row.creatorLoop === false &&
            row.creatorMaxLoopCount === 2 &&
            row.selectedContentSame &&
            row.sdkShouldLoop === before.sdkShouldLoop &&
            row.muted === before.muted &&
            row.volume === before.volume &&
            row.originalCalls.play === 1 &&
            row.originalCalls.load === 0 &&
            row.videoCount === 1 &&
            row.subscribers === 0 &&
            requests.length === requestStart,
          JSON.stringify(row)
        );
        evidence.push({ scenario: 'finite-loop-veto', before, ...row });
      }
    );
    await check(
      'absent creator loop and nullish content caps permit current unlimited playback',
      async () => {
        await load('?uncapped=1');
        const before = await state();
        assert.true(
          !before.creatorOwnLoop &&
            !before.creatorOwnMaxLoopCount &&
            before.creatorOwnMaxLoopSeconds &&
            before.creatorMaxLoopSeconds === null &&
            before.creatorLoopingThresholdMs === 60000 &&
            before.selectedContentSame &&
            before.sdkShouldLoop,
          JSON.stringify(before)
        );
        await begin();
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().sourceCurrent);
        await product('.draggable');
        for (let i = 0; i < 19; i++) {
          await product('[data-action="faster"]');
        }
        await product('[data-action="close"]');
        await page.waitForFunction(() => {
          const row = window.__twitterLoopFixture.snapshot();
          return row.rate === 4 && row.nativeTime > 1 && row.decodedFrames >= 5;
        });
        const active = await state();
        assert.true(
          active.native &&
            active.playing &&
            active.sourceCurrent &&
            !active.loopFallback &&
            active.tracks.length === 2 &&
            active.mediaSourceState === 'open' &&
            active.decodedMediaSpan > 0 &&
            active.sameProducer &&
            active.originalSourceUnchanged &&
            active.originalParentUnchanged &&
            active.originalPaused &&
            active.originalCalls.play === 1 &&
            active.originalCalls.load === 0 &&
            !active.creatorOwnLoop &&
            !active.creatorOwnMaxLoopCount &&
            active.creatorMaxLoopSeconds === null &&
            active.creatorLoopingThresholdMs === 60000 &&
            active.selectedContentSame,
          JSON.stringify(active)
        );
        const selectionRequests = selection('1280x720');
        await page.click('#site');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().native);
        const row = await state();
        assert.true(
          row.sameProducer &&
            row.originalSourceUnchanged &&
            row.originalParentUnchanged &&
            !row.originalPaused &&
            row.originalLoop === before.originalLoop &&
            row.muted === before.muted &&
            row.volume === before.volume &&
            row.originalCalls.load === 0 &&
            row.loopClosed &&
            row.loopURLRevoked &&
            row.loopChildren === 0 &&
            row.loopProperties.length === 0 &&
            row.subscribers === 0,
          JSON.stringify(row)
        );
        evidence.push({
          scenario: 'uncapped-loop-permitted',
          before,
          active,
          ...row,
          selectionRequests,
        });
      }
    );
    await check(
      'caption proof gates pending playback then survives five native seams and playing handback',
      async () => {
        const progress = { scenario: 'caption-five-seams', stage: 'setup' };
        evidence.push(progress);
        holdCaptionVTT = true;
        await load('?caption=1');
        captionAuditProgress = progress;
        await page.evaluate(installCaptionActivationAudit);
        const before = await state();
        Object.assign(progress, { before });
        originalCaptions(before);
        assert.true(
          await page.evaluate(
            () => window.VSC.TwitterPlayer.resolve(window.__twitterLoopFixture.original) === null
          )
        );
        const vttRequest = page.waitForRequest((request) => request.url() === CAPTION_VTT, {
          timeout: 5000,
        });
        await captionFour({ position: true });
        await vttRequest;
        assert.true(typeof releaseCaptionVTT === 'function', 'VTT proof response must be held');
        const pending = await state();
        Object.assign(progress, { stage: 'pending', pending });
        originalCaptions(pending);
        assert.true(
          pending.sessionPending &&
            !pending.native &&
            !pending.originalPaused &&
            pending.companionNativeRate === 0 &&
            Math.abs(pending.companionNativeTime - pending.sessionTime) < 0.001 &&
            pending.decodedFrames === 0 &&
            pending.companionPlays.length === 1 &&
            pending.companionPlays[0].trusted &&
            pending.companionPlays[0].beforeHandlerReturn &&
            pending.companionPlays[0].eventPhase > 0,
          JSON.stringify(pending)
        );
        await page.waitForFunction(
          (time) => {
            const row = window.__twitterLoopFixture.snapshot();
            return row.originalTime > time + 0.15 && !row.originalPaused;
          },
          {},
          pending.originalTime
        );
        const lastPending = await state();
        Object.assign(progress, { lastPending });
        assert.true(
          lastPending.companionNativeRate === 0 &&
            Math.abs(lastPending.companionNativeTime - pending.companionNativeTime) < 0.001 &&
            lastPending.decodedFrames === 0 &&
            lastPending.originalCaptionUnchanged
        );
        Object.assign(progress, {
          vttResponseReleaseRequestedAt: await page.evaluate(() => performance.now()),
        });
        await releaseCaptionVTT();
        await page.waitForFunction(() => {
          const row = window.__twitterLoopFixture.snapshot();
          return row.sessionClosed || (row.native && row.sourceCurrent && row.captionEpochVerified);
        });
        const committed = await state();
        Object.assign(progress, { stage: 'proof-result', committed });
        assert.true(
          committed.native && committed.sourceCurrent && committed.captionEpochVerified,
          JSON.stringify(committed)
        );
        originalCaptions(committed);
        ownedCaptions(committed);
        assert.true(
          committed.rate === 4 &&
            committed.playing &&
            committed.originalPaused &&
            committed.sessionTime > pending.originalTime + 0.1 &&
            Math.abs(committed.sessionTime - committed.originalTime) < 0.02 &&
            committed.companionPlays.length === 1 &&
            committed.companionPlays[0].trusted &&
            committed.companionPlays[0].beforeHandlerReturn &&
            committed.companionPlays[0].eventPhase > 0,
          JSON.stringify(committed)
        );
        await page.waitForFunction(
          () => {
            const row = window.__twitterLoopFixture.snapshot();
            return row.nativeTime >= row.period * 5 + 0.5 && row.captionEpochVerified;
          },
          { timeout: 18000 }
        );
        const rolling = await state();
        Object.assign(progress, { stage: 'five-seams', rolling });
        originalCaptions(rolling);
        ownedCaptions(rolling);
        assert.true(
          rolling.rate === 4 &&
            rolling.nativeTime > rolling.period * 5 &&
            rolling.time < rolling.period
        );
        const timeline = await page.evaluate(() => ({
          frames: window.__twitterLoopFixture.frames,
          lifecycle: window.__twitterLoopFixture.lifecycle,
          captions: window.__twitterLoopFixture.captionFrames,
        }));
        Object.assign(progress, { timeline });
        const activationAudit = await page.evaluate(() => window.__captionActivationAudit.read());
        const activeEpochs = new Set(),
          clockCacheViolations = [];
        for (const frame of timeline.captions) {
          assert.true(frame.mode === 'showing' && frame.cues.length > 0);
          for (const cue of frame.cues) {
            const epoch = captionOracle(cue, frame.period);
            assert.true(epoch === frame.epoch, JSON.stringify(frame));
            if (frame.nativeTime < cue.startTime - 0.04 || frame.nativeTime > cue.endTime + 0.04) {
              clockCacheViolations.push({ frame, cue });
            }
            activeEpochs.add(epoch);
          }
        }
        assert.true(
          activeEpochs.size >= 2,
          'Native active captions must be proven across two epochs'
        );
        Object.assign(progress, {
          activeCaptionEpochs: [...activeEpochs],
          instantaneousClockCache: {
            toleranceMediaSeconds: 0.04,
            timingPredicatePassed: clockCacheViolations.length === 0,
            violations: clockCacheViolations,
          },
          activationAuditAtRolling: activationAudit,
        });
        progress.activationCoverage = validateCaptionActivationCoverage({
          audit: activationAudit,
          timeline,
          committed,
          rolling,
        });
        const selectionRequests = selection('1280x720');
        Object.assign(progress, { selectionRequests });
        assert.true(
          [CAPTION_PLAYLIST, CAPTION_VTT].every(
            (url) => selectionRequests.filter((request) => request.url === url).length === 1
          )
        );
        await page.click('#fullscreen');
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().owned);
        await owned('play');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().playing);
        const pausedBeforeSeek = await state();
        const epoch = Math.floor(pausedBeforeSeek.nativeTime / rolling.period);
        Object.assign(progress, { pausedBeforeSeek, expectedSeekEpoch: epoch });
        await seekOwnedOneSecond();
        const sought = await state();
        Object.assign(progress, { sought });
        ownedCaptions(sought);
        assert.true(
          Math.abs(sought.nativeTime - epoch * sought.period - 1) < 0.05 &&
            sought.nativeTime > sought.period &&
            sought.activeCaptionCues.length > 0,
          JSON.stringify(sought)
        );
        for (const cue of sought.activeCaptionCues) {
          captionOracle(cue, sought.period);
          // Raw native time may round to either side of the shared cue boundary.
          // Admit only floating-point equality, never a playback-time tolerance.
          const ulps = Number.EPSILON * Math.max(1, Math.abs(sought.nativeTime)) * 4;
          assert.true(
            sought.nativeTime >= cue.startTime - ulps && sought.nativeTime <= cue.endTime + ulps,
            JSON.stringify({ nativeTime: sought.nativeTime, cue })
          );
        }
        await owned('play');
        await owned('done');
        await page.waitForFunction(
          () =>
            !window.__twitterLoopFixture.snapshot().owned && document.body.dataset.owned === 'false'
        );
        await page.click('#site');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().native);
        const handback = await state();
        captionHandback(handback);
        Object.assign(progress, {
          stage: 'complete',
          before,
          pending,
          lastPending,
          committed,
          rolling,
          sought,
          handback,
          timeline,
          selectionRequests,
        });
      }
    );
    await check(
      'captioned paused seek and handback preserve all native cues and modes',
      async () => {
        await load('?caption=1');
        await captionFour({ waitForCompanion: true });
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().native);
        await page.click('#fullscreen');
        await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().owned);
        await owned('play');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().playing);
        await seekOwnedOneSecond();
        const sought = await state();
        ownedCaptions(sought);
        originalCaptions(sought);
        await owned('done');
        await page.waitForFunction(
          () =>
            !window.__twitterLoopFixture.snapshot().owned && document.body.dataset.owned === 'false'
        );
        await page.click('#site');
        await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().native);
        const handback = await state();
        captionHandback(handback, { paused: true });
        assert.true(handback.originalCalls.play === 1, JSON.stringify(handback));
        evidence.push({ scenario: 'caption-paused-handback', sought, handback });
      }
    );
    await check(
      'caption mismatch, unknown SDK track and owned source writes retain original captions without fallback',
      async () => {
        const negatives = [];
        evidence.push({ scenario: 'caption-guard-vetoes', negatives });
        for (const action of ['mismatch', 'unknown', 'owned-source-write']) {
          const progress = { action };
          negatives.push(progress);
          const query = `?caption=1${action === 'mismatch' ? '&caption-mismatch=1' : action === 'unknown' ? '&caption-unknown=1' : ''}`;
          await load(query, { eligible: action !== 'unknown' });
          const before = await state();
          Object.assign(progress, { before });
          originalCaptions(before);
          if (action === 'unknown') {
            nativeRateAcceptanceProgress = progress;
            await page.evaluate(installNativeRateAcceptanceAudit);
          }
          await captionFour({ waitForCompanion: action === 'owned-source-write' });
          if (action === 'owned-source-write') {
            await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().native);
            const active = await state();
            Object.assign(progress, { active });
            ownedCaptions(active);
            assert.true(active.rate === 4 && active.playing, JSON.stringify(active));
            await page.click('#caption-source-write');
            await page.waitForFunction(() => !window.__twitterLoopFixture.snapshot().native);
          } else if (action === 'mismatch') {
            await page.waitForFunction(() => window.__twitterLoopFixture.snapshot().sessionClosed);
          } else {
            progress.earlyNativeAcceptance = await page.evaluate(() =>
              window.__nativeRateAcceptance.read('after-all-inputs')
            );
            const inputs = await page.evaluate(() => window.__nativeRateAcceptance.result().inputs);
            assert.true(
              inputs.filter((input) => input.action === 'faster').length === 20 &&
                inputs.every((input) => input.trusted && input.eventPhase > 0)
            );
            await page.waitForFunction(
              () => {
                const row = window.__nativeRateAcceptance.read('bounded-acceptance-wait');
                return row.nativeTime > 1 && row.nativeRate === 4 && row.publicRate === 4;
              },
              { timeout: 2000 }
            );
            progress.nativeRateAcceptance = await page.evaluate(() =>
              window.__nativeRateAcceptance.stop()
            );
            nativeRateAcceptanceProgress = null;
            assert.true(
              await page.evaluate(
                () =>
                  window.VSC.TwitterPlayer.resolveCaptionedLoop(
                    window.__twitterLoopFixture.original
                  ) === null
              )
            );
            assert.true(requests.length === requestStart);
          }
          const row = await state();
          Object.assign(progress, { ...row, requests: requests.slice(requestStart) });
          originalCaptions(row);
          const foreignWrite = action === 'owned-source-write';
          assert.true(
            !row.native &&
              !row.loopFallback &&
              row.rate === (foreignWrite ? progress.active.originalRate : 4) &&
              row.muted === before.muted &&
              row.volume === before.volume
          );
          if (foreignWrite) {
            // A revoked source lease must not copy foreign companion state into A.
            const retained = progress.active;
            assert.true(
              row.originalPaused === retained.originalPaused &&
                row.originalTime === retained.originalTime &&
                row.originalRate === retained.originalRate &&
                row.originalMuted === retained.originalMuted &&
                row.originalVolume === retained.originalVolume &&
                row.originalCalls.play === retained.originalCalls.play &&
                row.originalCalls.load === retained.originalCalls.load &&
                row.captionTrackSource === 'data:,WEBVTT' &&
                row.loopChildren === retained.loopChildren,
              JSON.stringify({ retained, row })
            );
          }
          if (action !== 'unknown') {
            assert.true(
              row.loopClosed &&
                row.loopURLRevoked &&
                row.loopProperties.length === 0 &&
                row.subscribers === 0,
              JSON.stringify(row)
            );
          }
          if (action !== 'owned-source-write') {
            assert.true(row.originalCalls.play === 1, JSON.stringify(row));
          }
          noCaptionFallback();
        }
      }
    );
    await writeFile(
      resolve(directory, 'report.json'),
      `${JSON.stringify(
        {
          scope:
            'built extension, real Chromium A/V MediaSource, iOS eligibility API emulation; not native Safari acceptance',
          passed,
          evidence,
          requests,
        },
        null,
        2
      )}\n`
    );
    return { passed, failed: 0 };
  } catch (error) {
    await writeFile(
      resolve(directory, 'partial-report.json'),
      `${JSON.stringify({ passed, error: error.stack, evidence, requests }, null, 2)}\n`
    );
    if (page) {
      try {
        await writeFile(
          resolve(directory, 'failure.json'),
          JSON.stringify(
            await page.evaluate(() => window.__twitterLoopFixture?.snapshot()),
            null,
            2
          )
        );
        await page.screenshot({ path: resolve(directory, 'failure.png') });
      } catch {
        /* Preserve assertion. */
      }
    }
    throw error;
  } finally {
    await releaseCaptionVTT?.(true).catch(() => {});
    await page?.evaluate(() => window.__captionActivationAudit?.stop()).catch(() => {});
    await page?.evaluate(() => window.__nativeRateAcceptance?.stop()).catch(() => {});
    errors?.dispose();
    await Promise.all([browser?.close(), fixture?.stop()]);
  }
}

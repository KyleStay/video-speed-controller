import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gifFixture } from '../helpers/gif-fixture.js';
const fixtureHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>StayFast browser fixture</title></head>
  <body><main id="fixture-root"></main></body>
</html>`;

const frameHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>StayFast frame fixture</title></head>
  <body>
    <main id="fixture-root">
      <video id="frame-video" muted preload="auto" src="/sample.webm"></video>
    </main>
  </body>
</html>`;

const emptyFrameHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>StayFast empty frame fixture</title></head>
  <body><main id="fixture-root"></main></body>
</html>`;

const mobileHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Touch controls fixture</title><style>
body { margin:0; font:16px system-ui; background:#f3f7fa; color:#123; }
h1,p { margin:16px; } .player { position:relative; width:100%; }
video { display:block; width:100%; aspect-ratio:16/9; }
button { min-height:44px; margin:16px; } .scroll-space { height:1400px; }
</style></head><body><h1>Touch controls</h1>
<div class="player"><video id="mobile-video" muted loop playsinline controls preload="auto" src="/sample.webm"></video></div>
<button id="play">Play test video</button><button id="pause">Pause test video</button>
<p id="media-status" role="status" aria-live="polite">Loading test media</p>
<p>Touch the speed pill to open controls. Drag the page to scroll.</p><div class="scroll-space"></div>
<script>
const video = document.querySelector('video');
const report = () => { document.querySelector('#media-status').textContent = 'Playback rate: ' + video.playbackRate + '; paused: ' + video.paused; };
for (const type of ['loadeddata','play','pause','ratechange','timeupdate']) video.addEventListener(type, report);
document.querySelector('#play').onclick = () => video.play();
document.querySelector('#pause').onclick = () => video.pause();
</script></body></html>`;

export function parseByteRange(value, length) {
  if (!value) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) {
    return false;
  }
  const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
  const start = suffixLength === null ? Number(match[1]) : Math.max(0, length - suffixLength);
  const requestedEnd = suffixLength === null && match[2] ? Number(match[2]) : length - 1;
  const end = Math.min(requestedEnd, length - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    return false;
  }
  return { start, end };
}

function respondWithMedia(request, response, media, contentType = 'video/webm') {
  const range = parseByteRange(request.headers.range, media.length);
  if (range === null) {
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': media.length,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    response.end(media);
    return;
  }

  if (range === false) {
    response.writeHead(416, { 'Content-Range': `bytes */${media.length}` });
    response.end();
    return;
  }

  const { start, end } = range;

  response.writeHead(206, {
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${media.length}`,
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  response.end(media.subarray(start, end + 1));
}

export async function startFixtureServer({
  mp4Path = resolve('tests/e2e/sample.mp4'),
  htmlRoutes = {},
  binaryRoutes = {},
  port = 0,
} = {}) {
  // VP8/WebM has native Chrome/Firefox decoding without OS H.264 libraries.
  // Synthetic 60s black clip; regenerate with the command in the manual guide.
  const mediaPath = resolve('tests/e2e/sample.webm');
  const media = await readFile(mediaPath);
  const mp4 = await readFile(mp4Path);
  const customFeed = await readFile(resolve('tests/e2e/custom-feed.html'), 'utf8');
  const localHtmlRoutes = {
    '/media-patterns.html': await readFile(resolve('tests/e2e/media-patterns.html'), 'utf8'),
    '/media-mocks.html': await readFile(resolve('tests/e2e/media-mocks.html'), 'utf8'),
    ...htmlRoutes,
  };
  const localBinaryRoutes = {
    '/media-mock-entry.js': {
      type: 'application/javascript; charset=utf-8',
      body: await readFile(resolve('tests/e2e/media-mock-entry.js')),
    },
    '/media-mock-fixture.js': {
      type: 'application/javascript; charset=utf-8',
      body: await readFile(resolve('tests/e2e/media-mock-fixture.js')),
    },
    '/media-profile-fixture.js': {
      type: 'application/javascript; charset=utf-8',
      body: await readFile(resolve('tests/e2e/media-profile-fixture.js')),
    },
    '/mock-animated.gif': { type: 'image/gif', body: Buffer.from(gifFixture()) },
    '/mock-still.gif': {
      type: 'image/gif',
      body: Buffer.from(gifFixture({ frames: [{ color: 1, delay: 20 }] })),
    },
    '/mock-captions.vtt': {
      type: 'text/vtt; charset=utf-8',
      body: 'WEBVTT\n\n00:00.000 --> 00:10.000\nExample caption\n',
    },
    ...binaryRoutes,
  };
  for (const [file, type] of [
    ['playlist.m3u8', 'application/vnd.apple.mpegurl'],
    ['init.mp4', 'video/mp4'],
    ['fallback.mp4', 'video/mp4'],
    ['clip.webm', 'video/webm'],
    ['segment-00.m4s', 'video/mp4'],
    ['segment-01.m4s', 'video/mp4'],
    ['segment-02.m4s', 'video/mp4'],
  ]) {
    localBinaryRoutes[`/mock-media/${file}`] = {
      type,
      body: await readFile(resolve('tests/e2e/mock-media', file)),
    };
  }
  for (const file of [
    'init.mp4',
    ...Array.from({ length: 12 }, (_, i) => `segment-${String(i).padStart(2, '0')}.m4s`),
  ]) {
    localBinaryRoutes[`/mock-live/${file}`] = {
      type: 'video/mp4',
      body: await readFile(resolve('tests/e2e/mock-media/live', file)),
    };
  }
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (Object.hasOwn(localBinaryRoutes, url.pathname)) {
      const route = localBinaryRoutes[url.pathname];
      if (route.type.startsWith('video/')) {
        respondWithMedia(request, response, route.body, route.type);
        return;
      }
      response.writeHead(200, { 'Content-Type': route.type, 'Cache-Control': 'no-store' });
      response.end(route.body);
      return;
    }
    if (url.pathname === '/sample.webm') {
      respondWithMedia(request, response, media);
      return;
    }
    if (url.pathname === '/sample.mp4') {
      respondWithMedia(request, response, mp4, 'video/mp4');
      return;
    }

    if (url.pathname === '/frame.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(url.searchParams.has('empty') ? emptyFrameHtml : frameHtml);
      return;
    }

    if (url.pathname === '/custom-feed.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline' chrome-extension: moz-extension:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      });
      response.end(customFeed);
      return;
    }

    if (url.pathname === '/mobile.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(
        url.searchParams.has('mp4')
          ? mobileHtml.replaceAll('/sample.webm', '/sample.mp4')
          : mobileHtml
      );
      return;
    }

    if (url.pathname === '/' || url.pathname === '/fixture.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(fixtureHtml);
      return;
    }

    if (
      Object.hasOwn(localHtmlRoutes, url.pathname) &&
      typeof localHtmlRoutes[url.pathname] === 'string'
    ) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(localHtmlRoutes[url.pathname]);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let stopped = false;

  return {
    baseUrl,
    mediaUrl: `${baseUrl}/sample.webm`,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}

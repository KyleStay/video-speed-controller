import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

function respondWithMedia(request, response, media) {
  const range = parseByteRange(request.headers.range, media.length);
  if (range === null) {
    response.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': media.length,
      'Content-Type': 'video/webm',
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
    'Content-Type': 'video/webm',
    'Cache-Control': 'no-store',
  });
  response.end(media.subarray(start, end + 1));
}

export async function startFixtureServer() {
  // VP8/WebM has native Chrome/Firefox decoding without OS H.264 libraries.
  // Synthetic 60s black clip; regenerate with the command in the manual guide.
  const mediaPath = resolve('tests/e2e/sample.webm');
  const media = await readFile(mediaPath);
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/sample.webm') {
      respondWithMedia(request, response, media);
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

    if (url.pathname === '/' || url.pathname === '/fixture.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(fixtureHtml);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
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

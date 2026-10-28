#!/usr/bin/env node

/** Native Safari fixture with a moving H.264 Baseline/AAC clip, independent of the shared 60s samples. */
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { startFixtureServer } from '../e2e/fixture-server.js';
import { gifFixture } from '../helpers/gif-fixture.js';

const portFlag = process.argv.indexOf('--port');
const port = portFlag < 0 ? 62938 : Number(process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('Use --port followed by an available TCP port (0 selects a free port)');
}

// The shared HTTP helper also serves its repository-owned WebM and iframe fixtures.
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const fixture = await startFixtureServer({
  mp4Path: fileURLToPath(new URL('./sample.mp4', import.meta.url)),
  probeMp4Path: process.env.STAYFAST_RATE_PROBE_MP4,
  binaryRoutes: {
    '/animated.gif': { type: 'image/gif', body: Buffer.from(gifFixture()) },
    '/still.gif': {
      type: 'image/gif',
      body: Buffer.from(gifFixture({ frames: [{ color: 1, delay: 20 }] })),
    },
  },
  htmlRoutes: {
    '/custom-webm.html': await readFile(
      new URL('../e2e/custom-webm.html', import.meta.url),
      'utf8'
    ),
    '/gif-images.html': await readFile(new URL('./gif-images.html', import.meta.url), 'utf8'),
    '/feed-position.html': (
      await readFile(new URL('../e2e/twitter-feed-position.html', import.meta.url), 'utf8')
    ).replace('/__feed.webm', '/sample.mp4'),
    '/hls-players.html': await readFile(new URL('./hls-players.html', import.meta.url), 'utf8'),
    '/twitter-playback.html': await readFile(
      new URL('./twitter-playback.html', import.meta.url),
      'utf8'
    ),
    '/touch-delivery.html': await readFile(
      new URL('./touch-delivery.html', import.meta.url),
      'utf8'
    ),
    '/diagnostic-feed.html': await readFile(
      new URL('./diagnostic-feed.html', import.meta.url),
      'utf8'
    ),
    '/responsive-inline.html': await readFile(
      new URL('./responsive-inline.html', import.meta.url),
      'utf8'
    ),
    '/layout-feed.html': await readFile(new URL('./layout-feed.html', import.meta.url), 'utf8'),
    '/feed-playback.html': await readFile(new URL('./feed-playback.html', import.meta.url), 'utf8'),
    '/scroll-frame.html': await readFile(new URL('./scroll-frame.html', import.meta.url), 'utf8'),
  },
  port,
});
console.log(JSON.stringify({ pid: process.pid, url: `${fixture.baseUrl}/mobile.html?mp4` }));

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    try {
      await fixture.stop();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
}

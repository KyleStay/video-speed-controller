import { mkdir } from 'node:fs/promises';
import { assert, controlVideo, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

/** Silent GIF-style loops must work without any site-provided transport. */
export default async function runLoopingMedia({ launch }) {
  let browser;
  let fixture;
  let errors;
  try {
    fixture = await startFixtureServer({
      htmlRoutes: {
        '/loops.html': `<!doctype html><html><head><title>Looping media</title></head>
          <body><div style="position:relative;width:640px">
          <video width="640" height="360" src="/sample.webm" autoplay muted loop playsinline></video>
          </div></body></html>`,
      },
    });
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    await page.goto(`${fixture.baseUrl}/loops.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.readyState >= 2 && video.vsc?.div && !video.paused;
    });
    assert.true(
      await page.$eval('video', (video) => video.loop && video.muted && !video.controls),
      'Fixture must be a silent loop without native controls'
    );
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('video').playbackRate > 1);
    assert.true(await controlVideo(page, 'faster'), 'WebM loop must have working speed buttons');
    const first = await page.$eval('video', (video) => {
      window.__originalLoop = video;
      return { rate: video.playbackRate, time: video.currentTime };
    });
    assert.true(first.rate > 1.1, 'Both the shortcut and button must increase the WebM rate');
    await page.waitForFunction(
      (time) => window.__originalLoop.currentTime > time + 0.2,
      {},
      first.time
    );

    // Discover a new loop while an older controlled video already exists.
    await page.evaluate(() => {
      const root = document.createElement('div');
      root.style.cssText = 'position:relative;width:640px';
      root.innerHTML =
        '<video id="late-loop" width="640" height="360" src="/sample.mp4" autoplay muted loop playsinline></video>';
      document.body.append(root);
    });
    await page.waitForFunction(() => {
      const video = document.querySelector('#late-loop');
      return video?.readyState >= 2 && video.vsc?.div && !video.paused;
    });
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('#late-loop').playbackRate > 1);
    assert.equal(await page.$$eval('vsc-controller', (nodes) => nodes.length), 2);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/looping-media.png', fullPage: true });
    await page.evaluate(() => document.querySelector('#late-loop').remove());
    await page.waitForFunction(() => document.querySelectorAll('vsc-controller').length === 1);
    errors.assertNone('WebM and MP4 GIF-style loops');
    console.log(
      'PASS: initial WebM and dynamic MP4 loops, decoded progress, buttons, keys and removal'
    );
    return { passed: 1, failed: 0 };
  } finally {
    errors?.dispose();
    await Promise.all([browser?.close(), fixture?.stop()]);
  }
}

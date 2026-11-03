/** Synthetic compatibility patterns; no service names, remote pages or remote media. */
import { mkdir, writeFile } from 'node:fs/promises';
import { startFixtureServer } from './fixture-server.js';
import { assert, controlVideo, monitorPageErrors } from './e2e-utils.js';

export default async function runMediaPatterns({ launch }) {
  let browser, fixture, embedded, errors;
  const rows = [];
  const externalRequests = [];
  const cleanupErrors = [];
  let failure;
  let completed = false;
  try {
    fixture = await startFixtureServer();
    embedded = await startFixtureServer();
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    const origins = new Set([fixture.baseUrl, embedded.baseUrl]);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && !origins.has(url.origin)) {
        externalRequests.push('Blocked external request');
        void request.abort('blockedbyclient');
      } else {
        void request.continue();
      }
    });
    const check = async (name, run) => {
      const row = { name, status: 'failed' };
      rows.push(row);
      await run();
      errors.assertNone(name);
      assert.equal(externalRequests.length, 0, 'Fixtures must make no external requests');
      row.status = 'passed';
      console.log(`PASS: local media ${name}`);
    };
    const ready = (context, selector) =>
      context.waitForFunction(
        (selector) => {
          const video = document.querySelector(selector);
          return video?.readyState >= 2 && video.vsc?.div?.isConnected;
        },
        {},
        selector
      );

    await page.goto(`${fixture.baseUrl}/media-patterns.html?layout=board`, { waitUntil: 'load' });
    await check('collapsed board attachments do not create controllers', async () => {
      assert.equal(await page.$$eval('video, .vsc-controller', (nodes) => nodes.length), 0);
      const downloads = await page.$$eval('a[download]', (nodes) => nodes.map((node) => node.href));
      await page.click('#expand-1');
      await ready(page, '#clip-1');
      await page.click('#expand-2');
      await ready(page, '#clip-2');
      assert.equal(await page.$$eval('.vsc-controller', (nodes) => nodes.length), 2);
      assert.equal(await page.$$eval('a[download]', (nodes) => nodes.length), 2);
      assert.equal(
        JSON.stringify(await page.$$eval('a[download]', (nodes) => nodes.map((node) => node.href))),
        JSON.stringify(downloads)
      );
    });
    await check('reply typing leaves attached media rates unchanged', async () => {
      const before = await page.$$eval('video', (nodes) =>
        nodes.map((video) => video.playbackRate)
      );
      await page.type('#reply', 'sdd picture notes');
      assert.equal(await page.$eval('#reply', (input) => input.value), 'sdd picture notes');
      assert.equal(
        JSON.stringify(
          await page.$$eval('video', (nodes) => nodes.map((video) => video.playbackRate))
        ),
        JSON.stringify(before)
      );
    });
    await check('collapse releases a controller and reopening discovers fresh media', async () => {
      await page.evaluate(() => {
        window.__removedMedia = document.querySelector('#clip-2');
      });
      await page.click('#collapse-2');
      await page.waitForFunction(() => !window.__removedMedia.vsc);
      assert.equal(await page.$$eval('.vsc-controller', (nodes) => nodes.length), 1);
      await page.click('#expand-2');
      await ready(page, '#clip-2');
      assert.true(await page.$eval('#clip-2', (video) => video !== window.__removedMedia));
    });

    for (const [layout, format] of [
      ['watch', 'webm'],
      ['watch', 'mp4'],
      ['portal', 'webm'],
      ['portal', 'mp4'],
    ]) {
      const variant = `${layout}/${format}`;
      await page.goto(
        `${fixture.baseUrl}/media-patterns.html?layout=${layout}${format === 'mp4' ? '&mp4' : ''}`,
        {
          waitUntil: 'load',
        }
      );
      await ready(page, '#watch-video');
      await check(
        `${variant}: preview replacement and SPA navigation release old media`,
        async () => {
          await page.evaluate(() => {
            window.__removedMedia = document.querySelector('video');
          });
          await page.click('#skip-preview');
          await ready(page, '#watch-video');
          await page.waitForFunction(() => !window.__removedMedia.vsc);
          assert.equal(await page.$$eval('.vsc-controller', (nodes) => nodes.length), 1);
          assert.true(await page.$eval('video', (video) => video.currentSrc.includes('asset=1')));
        }
      );
      await check(`${variant}: genuine buttons and shortcuts retain decoded playback`, async () => {
        assert.true(await controlVideo(page, 'faster'));
        const rate = await page.$eval('video', (video) => video.playbackRate);
        await page.click('h1');
        await page.keyboard.press('d');
        await page.waitForFunction(
          (rate) => document.querySelector('video').playbackRate > rate,
          {},
          rate
        );
        await page.click('#site-play');
        const start = await page.$eval('video', (video) => ({
          time: video.currentTime,
          frames: video.getVideoPlaybackQuality().totalVideoFrames,
        }));
        await page.waitForFunction(
          (start) => {
            const video = document.querySelector('video');
            return (
              !video.paused &&
              video.currentTime > start.time + 0.2 &&
              video.getVideoPlaybackQuality().totalVideoFrames > start.frames
            );
          },
          {},
          start
        );
      });
      await check(
        `${variant}: child-source quality changes preserve video and captions`,
        async () => {
          await page.evaluate(() => {
            window.__qualityMedia = document.querySelector('video');
            window.__captionTrack = document.querySelector('track');
            window.__captionTrack.track.mode = 'showing';
          });
          await page.waitForFunction(
            () =>
              window.__captionTrack.readyState === 2 && window.__captionTrack.track.cues.length > 0
          );
          const before = await page.$eval('video', (video) => video.currentSrc);
          await page.click('#quality');
          await ready(page, '#watch-video');
          await page.waitForFunction(
            (before) => document.querySelector('video').currentSrc !== before,
            {},
            before
          );
          await page.waitForFunction(() => {
            const video = document.querySelector('video');
            const track = window.__captionTrack;
            return (
              video === window.__qualityMedia &&
              video.querySelector('track') === track &&
              track.readyState === 2 &&
              track.track.cues?.[0]?.text === 'Example caption'
            );
          });
          assert.true(await controlVideo(page, 'faster'));
          await page.click('#next');
          await ready(page, '#watch-video');
          await page.waitForFunction(() => !window.__qualityMedia.vsc);
          assert.equal(await page.$$eval('.vsc-controller', (nodes) => nodes.length), 1);
        }
      );
    }

    await page.goto(
      `${fixture.baseUrl}/media-patterns.html?layout=embed&framePort=${new URL(embedded.baseUrl).port}`,
      { waitUntil: 'load' }
    );
    await page.click('#open-embed');
    const frameElement = await page.waitForSelector('iframe');
    const frame = await frameElement.contentFrame();
    await ready(frame, '#watch-video');
    await check(
      'embedded player has one frame-local controller and no parent ownership',
      async () => {
        assert.equal(await page.$$eval('video, .vsc-controller', (nodes) => nodes.length), 0);
        assert.equal(await page.evaluate(() => window.VSC?.stateManager?.controllers.size), 0);
        assert.equal(await frame.$$eval('.vsc-controller', (nodes) => nodes.length), 1);
        assert.true(
          await page.evaluate(() => document.querySelector('iframe').contentDocument === null)
        );
        const video = await frame.$('video');
        await video.click();
        const before = await frame.$eval('video', (video) => video.playbackRate);
        await page.keyboard.press('d');
        await frame.waitForFunction(
          (before) => document.querySelector('video').playbackRate > before,
          {},
          before
        );
        await video.dispose();
        await page.click('#close-embed');
        await page.waitForFunction(() => !document.querySelector('iframe'));
        assert.true(frame.isDetached());
        await frameElement.dispose();
      }
    );
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${fixture.baseUrl}/media-patterns.html?attachment-link`, {
      waitUntil: 'load',
    });
    await page.touchscreen.tap(
      ...(await page.$eval('#expand-1', (node) => {
        const r = node.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      }))
    );
    await ready(page, '#clip-1');
    await check(
      'thumbnail-expanded WebM seeks through its file link and preserves taps',
      async () => {
        const geometry = await page.$eval('#clip-1', (video) => {
          const r = video.getBoundingClientRect();
          return {
            x: r.x + r.width * 0.25,
            y: r.y + r.height * 0.5,
            width: r.width,
            duration: video.duration,
          };
        });
        await page.touchscreen.tap(geometry.x, geometry.y);
        assert.equal(await page.evaluate(() => window.__attachmentScrubState().taps), 1);
        const before = await page.$eval('#clip-1', (video) => video.currentTime);
        const session = await page.createCDPSession();
        try {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: geometry.x, y: geometry.y, id: 1 }],
          });
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: geometry.x + 50, y: geometry.y, id: 1 }],
          });
          await page.waitForFunction(() => window.__attachmentScrubState().scrubbing, {
            timeout: 3000,
          });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          const state = await page.evaluate(() => window.__attachmentScrubState());
          assert.true(state.paused && !state.scrubbing, JSON.stringify(state));
          assert.true(
            Math.abs(state.time - before - (50 / geometry.width) * geometry.duration) < 0.2,
            JSON.stringify(state)
          );
          assert.equal(state.taps, 1, 'A committed scrub must not activate the attachment link');
        } finally {
          await session
            .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
            .catch(() => {});
          await session.detach();
        }
      }
    );
    completed = true;
  } catch (error) {
    failure = error;
    const row = rows.at(-1);
    if (row?.status === 'failed') {
      row.error = error.stack || error.message;
    }
  } finally {
    errors?.dispose();
    try {
      await browser?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const result of await Promise.allSettled([fixture?.stop(), embedded?.stop()])) {
      if (result.status === 'rejected') {
        cleanupErrors.push(result.reason);
      }
    }
    await mkdir('test-results/media-patterns', { recursive: true });
    await writeFile(
      'test-results/media-patterns/results.json',
      JSON.stringify(
        {
          status: failure || cleanupErrors.length ? 'failed' : completed ? 'passed' : 'incomplete',
          error: failure?.stack || null,
          rows,
          externalRequests,
          cleanupErrors: cleanupErrors.map((error) => error.message),
        },
        null,
        2
      )
    );
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      'Local media fixture cleanup incomplete'
    );
  }
  if (failure) {
    throw failure;
  }
  return { passed: rows.length, failed: 0 };
}

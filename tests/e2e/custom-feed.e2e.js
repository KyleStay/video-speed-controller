/** Native clip-feed lifecycle checks with synthetic local media. */
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { startFixtureServer } from './fixture-server.js';
import { launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';

export default async function runCustomFeed({ launch = launchChromeWithExtension } = {}) {
  let browser, fixture, errors, page;
  const rows = [];
  const externalRequests = [];
  const cleanupErrors = [];
  let failure;
  const ready = () =>
    page.waitForFunction(() => {
      const video = document.querySelector('#clip');
      return video?.readyState >= 2 && !video.error && video.vsc?.div?.isConnected;
    });
  try {
    fixture = await startFixtureServer();
    ({ browser, page } = await launch());
    errors = monitorPageErrors(page);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== fixture.baseUrl) {
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
      assert.equal(externalRequests.length, 0);
      row.status = 'passed';
      console.log(`PASS: native feed ${name}`);
    };
    for (const mode of ['replacement', 'recycle', 'late-controls']) {
      await page.goto(`${fixture.baseUrl}/custom-feed.html?${mode}&captions`, {
        waitUntil: 'load',
      });
      await ready();
      await check(`${mode}: paused discovery, speed and decoded playback`, async () => {
        await page.evaluate(() => {
          window.__keptFeed = document.querySelector('#clip');
        });
        const before = await page.$eval('#clip', (video) => ({
          paused: video.paused,
          source: video.currentSrc,
          rate: video.playbackRate,
          frames: video.getVideoPlaybackQuality().totalVideoFrames,
        }));
        assert.equal(before.paused, true);
        await page.hover('#clip');
        await page.keyboard.press('d');
        await page.waitForFunction(
          (rate) => document.querySelector('#clip').playbackRate > rate,
          {},
          before.rate
        );
        await page.click('#site-play-overlay');
        await page.waitForFunction(
          (before) => {
            const video = document.querySelector('#clip');
            return (
              !video.paused &&
              video.currentTime > 0.15 &&
              video.getVideoPlaybackQuality().totalVideoFrames > before.frames &&
              video.currentSrc === before.source &&
              video === window.__keptFeed
            );
          },
          {},
          before
        );
      });
      await check(`${mode}: site viewer preserves media, captions and controller`, async () => {
        if (mode === 'late-controls') {
          await page.click('#show-transport');
        }
        await page.evaluate(() => {
          const video = document.querySelector('#clip');
          window.__keptFeedController = video.vsc;
          window.__keptFeedTrack = video.textTracks[0];
          window.__keptFeedSource = video.currentSrc;
        });
        await page.click('#open-site-viewer');
        await page.waitForFunction(() => !document.querySelector('#site-viewer').hidden);
        await ready();
        await page.click('#close-site-viewer');
        await ready();
        assert.equal(
          await page.evaluate(() => {
            const video = document.querySelector('#clip');
            return (
              video === window.__keptFeed &&
              video.vsc === window.__keptFeedController &&
              video.currentSrc === window.__keptFeedSource &&
              video.textTracks[0] === window.__keptFeedTrack &&
              !video.paused &&
              document.querySelectorAll('vsc-controller').length === 1
            );
          }),
          true
        );
      });
      await check(`${mode}: next item uses the declared native source`, async () => {
        await page.click('#next-clip');
        await ready();
        await page.waitForFunction(() =>
          document.querySelector('#clip').currentSrc.includes('clip=2')
        );
        assert.equal(
          await page.evaluate(() => document.querySelector('#clip') === window.__keptFeed),
          mode === 'recycle'
        );
        assert.equal(await page.$$eval('vsc-controller', (nodes) => nodes.length), 1);
        if (mode !== 'recycle') {
          await page.waitForFunction(() => !window.__keptFeed.vsc?.div?.isConnected);
        }
        const rate = await page.$eval('#clip', (video) => video.playbackRate);
        await page.hover('#clip');
        await page.keyboard.press('d');
        await page.waitForFunction(
          (rate) => document.querySelector('#clip').playbackRate > rate,
          {},
          rate
        );
      });
      await check(`${mode}: removing media releases its controller`, async () => {
        await page.evaluate(() => document.querySelector('#clip').remove());
        await page.waitForFunction(() => document.querySelectorAll('vsc-controller').length === 0);
      });
    }
  } catch (error) {
    failure = error;
    if (page && !page.isClosed()) {
      await mkdir('test-results/custom-feed', { recursive: true });
      await page.screenshot({ path: 'test-results/custom-feed/failure.png' }).catch(() => {});
    }
  } finally {
    errors?.dispose();
    for (const cleanup of [() => browser?.close(), () => fixture?.stop()]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    await mkdir('test-results/custom-feed', { recursive: true });
    await writeFile(
      'test-results/custom-feed/results.json',
      JSON.stringify(
        {
          status: failure || cleanupErrors.length ? 'failed' : 'passed',
          rows,
          externalRequests,
          error: failure?.stack || null,
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
      'Native feed cleanup incomplete'
    );
  }
  if (failure) {
    throw failure;
  }
  return { passed: rows.length, failed: 0 };
}

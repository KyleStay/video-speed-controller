/** Neutral local behavior profiles with synthetic assets. */
import { mkdir, writeFile } from 'node:fs/promises';
import { startFixtureServer } from './fixture-server.js';
import { MEDIA_MOCK_CASES } from './media-mock-fixture.js';
import { MEDIA_PROFILE_CASES } from './media-profile-fixture.js';
import { runMediaProfile } from './media-profiles.e2e.js';
import { assert, monitorPageErrors } from './e2e-utils.js';

const ready = (context, selector = '#mock-video') =>
  context.waitForFunction(
    (selector) => {
      const node = document.querySelector(selector);
      return (
        node?.vsc?.div?.isConnected &&
        (node.tagName === 'IMG' || (node.readyState >= 2 && !node.error))
      );
    },
    {},
    selector
  );
async function action(context, selector, name) {
  const handles = [];
  try {
    const media = await context.$(selector);
    handles.push(media);
    await media.hover();
    const controller = await context.evaluateHandle(
      (selector) =>
        document.querySelector(selector).vsc.div.shadowRoot.querySelector('#controller'),
      selector
    );
    handles.push(controller);
    await controller.asElement().hover();
    await context.waitForFunction(
      ({ selector, name }) => {
        const button = document
          .querySelector(selector)
          .vsc.div.shadowRoot.querySelector(`button[data-action="${name}"]`);
        if (!button) {
          return false;
        }
        const bounds = button.getBoundingClientRect(),
          style = getComputedStyle(button);
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0
        );
      },
      {},
      { selector, name }
    );
    const button = await context.evaluateHandle(
      ({ selector, name }) =>
        document
          .querySelector(selector)
          .vsc.div.shadowRoot.querySelector(`button[data-action="${name}"]`),
      { selector, name }
    );
    handles.push(button);
    await button.asElement().click();
  } finally {
    await Promise.all(handles.filter(Boolean).map((handle) => handle.dispose()));
  }
}
async function faster(context, selector = '#mock-video') {
  const before = await context.$eval(selector, (node) => node.playbackRate);
  await action(context, selector, 'faster');
  await context.waitForFunction(
    ({ selector, before }) => document.querySelector(selector).playbackRate > before,
    {},
    { selector, before }
  );
  return context.$eval(selector, (node) => node.playbackRate);
}
async function quality(page, expected) {
  await page.click(`#quality-${expected}`);
  await page.waitForFunction(
    (expected) =>
      document.querySelector('#quality').value === expected &&
      document.querySelector('video').currentSrc.includes(`quality=${expected}`),
    {},
    expected
  );
  await ready(page);
}
async function decoded(context, selector = '#mock-video') {
  const before = await context.$eval(selector, (node) => ({
    time: node.currentTime,
    frames: node.getVideoPlaybackQuality().totalVideoFrames,
  }));
  await context.waitForFunction(
    ({ selector, before }) => {
      const node = document.querySelector(selector);
      return (
        !node.paused &&
        node.currentTime > before.time + 0.15 &&
        node.getVideoPlaybackQuality().totalVideoFrames > before.frames
      );
    },
    {},
    { selector, before }
  );
}
async function keepMedia(context, selector = '#mock-video') {
  await context.evaluate((selector) => {
    window.__keptMockMedia = document.querySelector(selector);
    window.__keptMockTrack = window.__keptMockMedia.querySelector('track');
    window.__keptMockTrack.track.mode = 'showing';
  }, selector);
  await context.waitForFunction(
    () => window.__keptMockTrack.readyState === 2 && window.__keptMockTrack.track.cues?.length > 0
  );
}
const kept = (context) =>
  context.waitForFunction(() => {
    const media = window.__keptMockMedia,
      track = window.__keptMockTrack;
    return (
      media.isConnected &&
      media.querySelector('track') === track &&
      track.readyState === 2 &&
      track.track.cues?.[0]?.text === 'Example caption'
    );
  });

export default async function runSiteMocks({ launch }) {
  let browser, primary, secondary, errors, setupError;
  const cleanupErrors = [],
    blockedRequests = [];
  const cases = MEDIA_MOCK_CASES.map(({ id, contract }) => ({
    id,
    contract,
    status: 'unrun',
    checks: [],
  }));
  try {
    primary = await startFixtureServer();
    secondary = await startFixtureServer();
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    page.setDefaultTimeout(10000);
    errors = monitorPageErrors(page);
    const allowed = new Set([primary.baseUrl, secondary.baseUrl]);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && !allowed.has(url.origin)) {
        blockedRequests.push('External request blocked');
        void request.abort('blockedbyclient');
      } else {
        void request.continue();
      }
    });
    const framePort = new URL(secondary.baseUrl).port;
    const check = async (row, name, run) => {
      const step = { name, status: 'failed' };
      row.checks.push(step);
      await run();
      errors.assertNone(`${row.id}: ${name}`);
      assert.equal(blockedRequests.length, 0, 'No external requests are allowed');
      step.status = 'passed';
      console.log(`PASS: ${row.id}: ${name}`);
    };
    const parentEmpty = async () => {
      assert.equal(await page.$$eval('video, img, .vsc-controller', (nodes) => nodes.length), 0);
      assert.equal(await page.evaluate(() => window.VSC?.stateManager?.controllers.size), 0);
    };
    const childFrame = async () => {
      const element = await page.waitForSelector('iframe');
      try {
        return await element.contentFrame();
      } finally {
        await element.dispose();
      }
    };
    for (const row of cases) {
      errors.clear();
      try {
        await page.goto(
          `${primary.baseUrl}/media-mocks.html?case=${row.id}&framePort=${framePort}`,
          { waitUntil: 'load' }
        );
        if (MEDIA_PROFILE_CASES.some(({ id }) => id === row.id)) {
          await runMediaProfile(row, {
            page,
            check,
            ready,
            action,
            faster,
            quality,
            decoded,
            keepMedia,
            kept,
            childFrame,
            parentEmpty,
          });
        } else if (row.id === 'loop-feed') {
          await ready(page);
          const chosen = await faster(page);
          row.requestedRate = chosen;
          await check(
            row,
            'renditions and audio intent survive five subsequent clips',
            async () => {
              await keepMedia(page);
              await page.click('#mute');
              await page.click('#play');
              await decoded(page);
              await quality(page, 'sd');
              await quality(page, 'hd');
              for (let index = 2; index <= 6; index++) {
                await page.click('#next');
                await ready(page);
                await page.waitForFunction(
                  ({ chosen, index }) => {
                    const video = document.querySelector('video');
                    return (
                      video.currentSrc.includes(`asset=${index}`) &&
                      !video.paused &&
                      Math.abs(video.playbackRate - chosen) < 0.001
                    );
                  },
                  {},
                  { chosen, index }
                );
                assert.true(
                  await page.$eval(
                    'video',
                    (node) => node === window.__keptMockMedia && !node.muted
                  )
                );
                await decoded(page);
              }
              await kept(page);
              await page.click('#mute');
            }
          );
        } else if (row.id === 'adaptive-watch') {
          await ready(page);
          await keepMedia(page);
          await check(row, 'adaptive capability and file fallback retain captions', async () => {
            const nativeHls = await page.$eval(
              'video',
              (node) => !!node.canPlayType('application/vnd.apple.mpegurl')
            );
            row.nativeHlsSupported = nativeHls;
            await page.click('#adaptive');
            if (nativeHls) {
              await ready(page);
              await page.click('#play');
              await decoded(page);
            } else {
              await page.waitForFunction(() => window.__mediaMockState().errors.length > 0);
            }
            await page.click('#file');
            await ready(page);
            await kept(page);
            await quality(page, 'low');
            await faster(page);
            if (await page.$eval('video', (node) => node.paused)) {
              await page.click('#play');
            }
            await decoded(page);
          });
        } else if (row.id === 'rendition-watch') {
          await ready(page);
          const chosen = await faster(page);
          await check(row, 'a delayed site reset cannot replace the chosen rate', async () => {
            await page.click('#queue-reset');
            await page.waitForFunction(() => window.__mediaMockState().resets === 1);
            await page.waitForFunction(
              (chosen) => Math.abs(document.querySelector('video').playbackRate - chosen) < 0.001,
              {},
              chosen
            );
            await page.click('#queue-reset');
            await quality(page, 'low');
            assert.false(await page.evaluate(() => window.__mediaMockState().pendingReset));
          });
        } else if (row.id === 'playlist-watch') {
          await ready(page);
          await keepMedia(page);
          const chosen = await faster(page);
          row.requestedRate = chosen;
          await check(
            row,
            'unavailable media recovers and playlist sources keep one controller',
            async () => {
              await page.click('#unavailable');
              await page.waitForFunction(() => window.__mediaMockState().errors.length > 0);
              await page.click('#recover');
              await ready(page);
              await kept(page);
              await page.click('#play');
              await decoded(page);
              for (const index of [2, 3]) {
                await page.click('#next');
                await ready(page);
                await page.waitForFunction(
                  ({ index, chosen }) =>
                    document.querySelector('video').currentSrc.includes(`asset=${index}`) &&
                    !document.querySelector('video').paused &&
                    Math.abs(document.querySelector('video').playbackRate - chosen) < 0.001,
                  {},
                  { index, chosen }
                );
                assert.equal(await page.$$eval('.vsc-controller', (nodes) => nodes.length), 1);
                await decoded(page);
              }
            }
          );
        } else if (row.id === 'mixed-gallery') {
          await page.waitForSelector('#gallery-item');
          await check(row, 'still/GIF/MP4/WebM navigation releases old owners', async () => {
            assert.false(await page.$eval('#gallery-item', (node) => !!node.vsc));
            for (const kind of ['IMG', 'VIDEO', 'VIDEO', 'IMG']) {
              await page.evaluate(() => {
                window.__removedGallery = document.querySelector('#gallery-item');
              });
              await page.click('#gallery-next');
              await page.waitForFunction(() => !window.__removedGallery.vsc);
              assert.equal(await page.$eval('#gallery-item', (node) => node.tagName), kind);
              if (
                kind === 'IMG' &&
                (await page.$eval('#gallery-item', (node) => node.src.includes('still')))
              ) {
                assert.false(await page.$eval('#gallery-item', (node) => !!node.vsc));
              } else {
                await ready(page, '#gallery-item');
                await faster(page, '#gallery-item');
                if (kind === 'VIDEO') {
                  await page.click('#play');
                  await decoded(page, '#gallery-item');
                }
              }
              const controlled = await page.$eval('#gallery-item', (node) => !!node.vsc);
              assert.equal(
                await page.$$eval('.vsc-controller', (nodes) => nodes.length),
                controlled ? 1 : 0
              );
            }
            await page.click('#gallery-previous');
            await ready(page, '#gallery-item');
          });
        } else if (row.id === 'discussion-feed' || row.id === 'post-viewer') {
          await ready(page, '#original-video');
          await check(
            row,
            'duplicate posts and comments retain independent local owners',
            async () => {
              await page.click('#duplicate');
              await ready(page, '#duplicate-video');
              const before = await page.$$eval('video', (nodes) =>
                nodes.map((node) => node.playbackRate)
              );
              await page.type('#reply', 'sdd comment');
              assert.equal(await page.$eval('#reply', (node) => node.value), 'sdd comment');
              assert.equal(
                JSON.stringify(
                  await page.$$eval('video', (nodes) => nodes.map((node) => node.playbackRate))
                ),
                JSON.stringify(before)
              );
              await page.click('#embed');
              const frame = await childFrame();
              await ready(frame);
              assert.true(
                await page.evaluate(() => document.querySelector('iframe').contentDocument === null)
              );
              await faster(frame);
              assert.equal(
                JSON.stringify(
                  await page.$$eval('video', (nodes) => nodes.map((node) => node.playbackRate))
                ),
                JSON.stringify(before)
              );
              await page.evaluate(() => {
                window.__removedPost = document.querySelector('#duplicate-video');
              });
              await page.click('#remove-duplicate');
              await page.waitForFunction(() => !window.__removedPost.vsc);
              assert.false(frame.isDetached());
            }
          );
          if (row.id === 'post-viewer') {
            await check(row, 'mixed-media viewer returns the same media and captions', async () => {
              await ready(page, '#post-animation');
              await keepMedia(page, '#original-video');
              await page.click('#open-viewer');
              await kept(page);
              await page.click('#close-viewer');
              await kept(page);
              assert.true(
                await page.$eval('#original-post', (node) => node.parentElement.tagName === 'MAIN')
              );
            });
          }
        } else {
          await page.click('#open-embed');
          let frame = await childFrame();
          await ready(frame);
          await check(row, 'cross-origin embed controls preserve parent isolation', async () => {
            await parentEmpty();
            await faster(frame);
            if (row.id === 'source-embed') {
              await quality(frame, 'low');
              await page.click('#theater');
              await ready(frame);
              await page.click('#theater');
              const oldFrame = frame;
              await page.click('#recreate');
              frame = await childFrame();
              await ready(frame);
              assert.true(oldFrame.isDetached());
              assert.true(
                await frame.$eval('video', (node) => node.currentSrc.includes('asset=2'))
              );
            } else {
              const width = await page.$eval(
                'iframe',
                (node) => node.getBoundingClientRect().width
              );
              await page.click('#resize');
              assert.true(
                await page.$eval(
                  'iframe',
                  (node, width) => node.getBoundingClientRect().width > width,
                  width
                )
              );
              assert.false(frame.isDetached());
            }
            await page.click('#close-embed');
            await page.waitForFunction(() => !document.querySelector('iframe'));
            assert.true(frame.isDetached());
            await page.click('#open-embed');
            frame = await childFrame();
            await ready(frame);
            await parentEmpty();
            await faster(frame);
          });
        }
        assert.true(row.checks.length > 0, 'Every behavior profile needs executed checks');
        errors.assertNone(row.id);
        row.status = 'passed';
      } catch (error) {
        row.status = 'failed';
        row.error = error.stack || error.message;
        row.observed = await page
          .evaluate(() => ({
            mock: window.__mediaMockState?.(),
            selectedQuality: document.querySelector('#quality')?.value,
            lastSpeed: window.VSC_controller?.config?.settings?.lastSpeed,
          }))
          .catch(() => null);
        console.error(`FAIL: ${row.id}: ${error.message}`);
        await mkdir('test-results/site-mocks', { recursive: true });
        await page
          .screenshot({ path: `test-results/site-mocks/${row.id}-failure.png` })
          .catch(() => {});
      }
    }
  } catch (error) {
    setupError = error;
    for (const row of cases) {
      if (row.status === 'unrun') {
        row.reason = error.message;
      }
    }
  } finally {
    errors?.dispose();
    try {
      await browser?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const result of await Promise.allSettled([primary?.stop(), secondary?.stop()])) {
      if (result.status === 'rejected') {
        cleanupErrors.push(result.reason);
      }
    }
    await mkdir('test-results/site-mocks', { recursive: true });
    await writeFile(
      'test-results/site-mocks/results.json',
      JSON.stringify(
        {
          status: cleanupErrors.length
            ? 'failed'
            : setupError
              ? 'incomplete'
              : cases.every((row) => row.status === 'passed') && !cleanupErrors.length
                ? 'passed'
                : 'failed',
          setupError: setupError?.stack || null,
          cases,
          blockedRequests,
          cleanupErrors: cleanupErrors.map((error) => error.message),
          scope:
            'Synthetic local behavior contracts; no live-site, physical-device or acoustic acceptance claim',
        },
        null,
        2
      )
    );
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      [...(setupError ? [setupError] : []), ...cleanupErrors],
      'Mock matrix cleanup incomplete'
    );
  }
  if (setupError) {
    throw setupError;
  }
  return {
    passed: cases.filter((row) => row.status === 'passed').length,
    failed: cases.filter((row) => row.status !== 'passed').length,
  };
}

/** Reusable local custom-player checks, with synthetic media and no remote requests. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFixtureServer } from './fixture-server.js';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';

async function touch(page, resolveTarget, argument) {
  const handle = await page.evaluateHandle(resolveTarget, argument);
  try {
    const bounds = await handle.asElement()?.boundingBox();
    assert.true(
      bounds && bounds.width >= 44 && bounds.height >= 44,
      'A visible 44px target is required'
    );
    const hit = await handle.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const root = node.getRootNode();
      const x = r.x + r.width / 2,
        y = r.y + r.height / 2;
      const outer = node.ownerDocument.elementFromPoint(x, y);
      return (
        root.elementFromPoint(x, y) === node &&
        (root === node.ownerDocument ? outer === node : outer === root.host)
      );
    });
    assert.true(hit, 'The target must receive input rather than a covering element');
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  } finally {
    await handle.dispose();
  }
}
const inline = (page, selector) =>
  touch(
    page,
    (selector) => document.querySelector('video').vsc.div.shadowRoot.querySelector(selector),
    selector
  );
const owned = (page, name) =>
  touch(page, (name) => document.querySelector('video').vsc.iosPlayer.ui.refs[name], name);
const state = (page) => page.evaluate(() => window.__customFeedState());
async function drag(page, from, to) {
  const session = await page.createCDPSession();
  try {
    const point = (x, y) => [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }];
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: point(from.x, from.y),
    });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point(
          from.x + ((to.x - from.x) * step) / 8,
          from.y + ((to.y - from.y) * step) / 8
        ),
      });
      await new Promise((done) => setTimeout(done, 30));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

export default async function runCustomFeed({ launch = launchChromeWithExtension } = {}) {
  let browser, fixture, errors;
  const rows = [];
  const remote = [];
  let cleanupFailures;
  let matrixCompleted = false;
  try {
    fixture = await startFixtureServer();
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== fixture.baseUrl) {
        remote.push('Off-origin request');
        void request.abort('blockedbyclient');
      } else {
        void request.continue();
      }
    });
    const check = async (variant, name, work) => {
      const row = { variant, name };
      rows.push(row);
      try {
        await work();
        errors.assertNone(name);
        row.status = 'passed';
        console.log(`   ✅ Custom feed ${variant}: ${name}`);
      } catch (error) {
        row.status = 'failed';
        row.error = error.stack || error.message;
        row.observed = await page
          .evaluate(() => ({
            state: window.__customFeedState(),
            body: document.querySelector('#fixture-status').textContent,
            mirror: document
              .querySelector('video')
              ?.vsc?.iosPlayer?.ui?.dialog.querySelector('#owned-fixture-status')?.textContent,
          }))
          .catch(() => null);
        console.error(`Local fixture failure state: ${JSON.stringify(row.observed)}`);
        console.error(`   ❌ Custom feed ${variant}: ${name}: ${row.error}`);
        throw error;
      }
    };
    for (const [variant, query] of [
      ['replacement', ''],
      ['late transport', '&late-controls'],
      ['recycled captions', '&recycle&captions'],
    ]) {
      await page.bringToFront();
      await page.goto(`${fixture.baseUrl}/custom-feed.html?fixture${query}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
      await check(variant, 'discovery preserves the local source and paused state', async () => {
        if (query.includes('late-controls')) {
          assert.false(
            await page.evaluate(() => !!document.querySelector('video').vsc),
            'Without transport the muted loop stays decorative'
          );
          await page.click('#show-transport');
        }
        await page.waitForFunction(() => document.querySelector('video').vsc?.iosPlayer?.attached);
        const s = await state(page);
        assert.true(
          s.sameSource && s.sameVideo && s.connected && s.paused && !s.owned && s.controllers === 1,
          JSON.stringify(s)
        );
      });
      await check(variant, 'play, pause, mute, presets and shortcuts stay inline', async () => {
        await inline(page, '.inline-play');
        await page.waitForFunction(() => !document.querySelector('video').paused);
        await inline(page, '.inline-play');
        await page.waitForFunction(() => document.querySelector('video').paused);
        await inline(page, '.inline-mute');
        assert.false((await state(page)).muted);
        await inline(page, '.inline-mute');
        assert.true((await state(page)).muted);
        await inline(page, '.draggable');
        await inline(page, '[data-action="setSpeed"][data-value="2"]');
        assert.equal((await state(page)).rate, 2);
        await inline(page, '[data-action="setSpeed"][data-value="1"]');
        await inline(page, '[data-action="close"]');
        await page.keyboard.press('d');
        assert.true((await state(page)).rate > 1);
        await page.keyboard.press('s');
        assert.true(Math.abs((await state(page)).rate - 1) < 0.01);
      });
      await check(
        variant,
        'picture seeking isolates the trailing tap and retains vertical scrolling',
        async () => {
          await page.evaluate(() => {
            document.querySelector('video').currentTime = 20;
          });
          await drag(page, { x: 90, y: 310 }, { x: 220, y: 310 });
          const after = await state(page);
          assert.true(
            after.time > 20.5 && after.paused && !after.owned && after.trace.pictureTouches === 0,
            JSON.stringify(after)
          );
          await drag(page, { x: 110, y: 450 }, { x: 110, y: 280 });
          await page.waitForFunction(() => document.querySelector('#feed').scrollTop > 30);
          assert.true((await state(page)).paused, 'A vertical gesture cannot trigger site Play');
          await page.evaluate(() => {
            document.querySelector('#feed').scrollTop = 0;
          });
          await page.waitForFunction(
            () => document.querySelector('video').getBoundingClientRect().top > 0
          );
        }
      );
      await check(
        variant,
        'timeline clears metadata while its independent link remains clickable',
        async () => {
          await page.waitForFunction(() => {
            const v = document.querySelector('video');
            return (
              v.vsc.controlsManager.inlinePlayer.refs.timeline.getBoundingClientRect().bottom <
              document.querySelector('#creator-link').getBoundingClientRect().top
            );
          });
          await touch(
            page,
            () => document.querySelector('video').vsc.controlsManager.inlinePlayer.refs.timeline
          );
          await page.waitForFunction(
            () => Math.abs(document.querySelector('video').currentTime - 30) < 0.5
          );
          await page.click('#creator-link');
          assert.equal((await state(page)).trace.linkClicks, 1);
          assert.true((await state(page)).paused && !(await state(page)).owned);
        }
      );
      await check(
        variant,
        'site viewer retains the original media and supports owned fullscreen',
        async () => {
          const before = await state(page);
          await page.click('#open-site-viewer');
          await page.waitForFunction(() => !document.querySelector('#site-viewer').hidden);
          await page.waitForFunction(
            () =>
              document.querySelector('video').vsc.controlsManager.inlinePlayer.surfaceContainer
                ?.node === document.querySelector('#clip-card')
          );
          assert.true(
            (await state(page)).sameVideo &&
              (await state(page)).sameSource &&
              (await state(page)).connected
          );
          await page.click('#open-site-viewer');
          assert.true(
            await page.evaluate(
              () =>
                document.querySelectorAll('.clip-slot').length === 1 &&
                document.querySelector('.clip-slot').parentElement ===
                  document.querySelector('#feed')
            ),
            'Repeated site-viewer entry keeps the original restoration slot'
          );
          for (let repeat = 0; repeat < 2; repeat++) {
            const entry = await state(page);
            await inline(page, '.inline-fullscreen');
            await page.waitForFunction(() => document.querySelector('video').vsc.iosPlayer.active);
            if (repeat === 0) {
              const select = await page.evaluateHandle(
                () => document.querySelector('video').vsc.iosPlayer.ui.refs.speed
              );
              try {
                await select.asElement().select('4');
              } finally {
                await select.dispose();
              }
              assert.equal((await state(page)).rate, 4);
              await page.waitForFunction(
                () =>
                  document
                    .querySelector('video')
                    .vsc.iosPlayer.ui.dialog.querySelector('#owned-fixture-status')
                    ?.textContent.includes('rate 4; paused true'),
                { timeout: 2500 }
              );
              await owned(page, 'more');
              const oldTime = (await state(page)).time;
              await owned(page, 'frameForward');
              assert.true((await state(page)).time > oldTime);
              await owned(page, 'frameBack');
              if (query.includes('captions')) {
                const captions = await page.evaluateHandle(
                  () => document.querySelector('video').vsc.iosPlayer.ui.refs.captions
                );
                try {
                  await captions.asElement().select('0');
                } finally {
                  await captions.dispose();
                }
                assert.equal(
                  await page.evaluate(() => document.querySelector('video').textTracks[0].mode),
                  'showing'
                );
              }
              assert.true(
                await page.evaluate(
                  () => document.querySelector('video').vsc.iosPlayer.ui.refs.pip.hidden
                ),
                'Media PiP restriction stays enforced'
              );
              await owned(page, 'more');
              await owned(page, 'fit');
              await owned(page, 'fit');
              await owned(page, 'lock');
              await owned(page, 'unlock');
            }
            await owned(page, 'done');
            await page.waitForFunction(
              () =>
                !document.querySelector('video').vsc.iosPlayer.active && !document.fullscreenElement
            );
            const exit = await state(page);
            assert.true(
              exit.sameVideo &&
                exit.sameSource &&
                exit.connected &&
                Math.abs(exit.feedY - entry.feedY) < 2 &&
                Math.abs(exit.mediaTop - entry.mediaTop) < 2,
              JSON.stringify({ entry, exit })
            );
          }
          await page.click('#close-site-viewer');
          const after = await state(page);
          assert.true(
            Math.abs(before.feedY - after.feedY) < 2 &&
              Math.abs(before.mediaTop - after.mediaTop) < 2
          );
        }
      );
      await check(
        variant,
        'next clip replacement or recycling receives one working controller',
        async () => {
          await page.evaluate(() => {
            window.__previousMockVideo = document.querySelector('video');
          });
          await page.click('#next-clip');
          await page.waitForFunction(
            () =>
              window.__customFeedState().clip === 2 &&
              document.querySelector('video').readyState >= 2 &&
              document.querySelector('video').vsc?.iosPlayer?.attached &&
              document.querySelectorAll('vsc-controller').length === 1
          );
          assert.equal(
            await page.evaluate(
              () => window.__previousMockVideo === document.querySelector('video')
            ),
            query.includes('recycle')
          );
          const before = (await state(page)).rate;
          await page.keyboard.press('d');
          assert.true((await state(page)).rate > before);
          assert.true(
            (await state(page)).paused &&
              (await state(page)).sameSource &&
              (await state(page)).connected
          );
          if (query.includes('captions')) {
            assert.true(
              await page.evaluate(() => {
                const tracks = document.querySelector('video').textTracks;
                return tracks.length === 1 && tracks[0].mode === 'disabled';
              }),
              'Recycling resets one fixture caption track'
            );
            await inline(page, '.inline-fullscreen');
            await page.waitForFunction(() => document.querySelector('video').vsc.iosPlayer.active);
            await owned(page, 'more');
            const captions = await page.evaluateHandle(
              () => document.querySelector('video').vsc.iosPlayer.ui.refs.captions
            );
            try {
              await captions.asElement().select('0');
            } finally {
              await captions.dispose();
            }
            assert.true(
              await page.evaluate(() => {
                const track = document.querySelector('video').textTracks[0];
                return (
                  track.mode === 'showing' &&
                  track.cues.length === 1 &&
                  track.cues[0].text === 'Synthetic caption 2'
                );
              }),
              'Next clip exposes only its own synthetic caption'
            );
            await owned(page, 'done');
            await page.waitForFunction(() => !document.querySelector('video').vsc.iosPlayer.active);
          }
        }
      );
      await check(
        variant,
        'identity telemetry detects a disconnected or replaced media node',
        async () => {
          const proof = await page.evaluate(() => {
            const video = document.querySelector('video');
            video.replaceWith(video.cloneNode(false));
            return window.__customFeedState();
          });
          assert.false(proof.sameVideo);
          assert.false(proof.connected);
        }
      );
      errors.assertNone(variant);
    }
    assert.equal(remote.length, 0, 'Mocks cannot require any off-origin request');
    matrixCompleted = true;
  } finally {
    errors?.dispose();
    const cleanup = await Promise.allSettled([browser?.close(), fixture?.stop()]);
    cleanupFailures = cleanup
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    await mkdir(resolve('test-results/custom-feed'), { recursive: true });
    await writeFile(
      resolve('test-results/custom-feed/results.json'),
      JSON.stringify(
        {
          complete: matrixCompleted,
          rows,
          offOriginRequests: remote.length,
          cleanupFailures: cleanupFailures.map((error) => String(error)),
        },
        null,
        2
      )
    );
  }
  if (cleanupFailures.length) {
    throw new AggregateError(cleanupFailures, 'Local custom-feed cleanup failed');
  }
  const passed = rows.filter((row) => row.status === 'passed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  console.log(
    `Local custom feed: ${passed} passed, ${failed} failed; ${remote.length} off-origin requests`
  );
  return { passed, failed };
}

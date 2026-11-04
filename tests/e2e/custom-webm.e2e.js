import { readFile } from 'node:fs/promises';
import { startFixtureServer } from './fixture-server.js';
import { assert, monitorPageErrors } from './e2e-utils.js';

export default async function runCustomWebM({ launch }) {
  let browser, fixture;
  try {
    fixture = await startFixtureServer({
      htmlRoutes: {
        '/custom-webm.html': await readFile(new URL('./custom-webm.html', import.meta.url), 'utf8'),
      },
    });
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = monitorPageErrors(page);
    await page.goto(`${fixture.baseUrl}/custom-webm.html`, { waitUntil: 'load' });
    await page.click('#open');
    await page.waitForFunction(
      () => window.__customWebMState().controlled && window.__customWebMState().frames > 2
    );
    let state = await page.evaluate(() => window.__customWebMState());
    assert.true(
      state.sameSource &&
        state.originalPaused &&
        !state.originalVisible &&
        !state.chromeVisible &&
        !state.paused
    );
    const before = state.time;
    await page.waitForFunction(
      (before) => window.__customWebMState().time > before + 0.2,
      {},
      before
    );
    const touch = await page.createCDPSession();
    try {
      for (const paused of [false, true]) {
        await page.$eval(
          'video',
          (video, paused) => {
            if (paused) {
              video.pause();
            }
          },
          paused
        );
        const start = await page.$eval('video', (video) => {
          const rect = video.getBoundingClientRect();
          return {
            x: rect.x + rect.width * 0.3,
            y: rect.y + rect.height * 0.55,
            time: video.currentTime,
          };
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: start.x, y: start.y, id: 1 }],
        });
        for (let step = 1; step <= 6; step++) {
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: start.x + step * 10, y: start.y, id: 1 }],
          });
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(
          (start, paused) => {
            const video = document.querySelector('video');
            return (
              video.currentTime > start + 5 &&
              video.paused === paused &&
              !video.seeking &&
              !video.vsc.controlsManager.inlinePlayer.scrubber.active
            );
          },
          {},
          start.time,
          paused
        );
      }
    } finally {
      await touch
        .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        .catch(() => {});
      await touch.detach();
    }
    await page.$eval('video', (video) => video.play());
    await page.waitForFunction(() => !window.__customWebMState().paused);
    const tap = async (selector) => {
      const bounds = await page.evaluate((selector) => {
        const target = document.querySelector('video').vsc.div.shadowRoot.querySelector(selector);
        const r = target.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, selector);
      assert.true(bounds.width >= 44 && bounds.height >= 44);
      await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    };
    await tap('.draggable');
    await tap('[data-action="faster"]');
    assert.equal(await page.$eval('video', (video) => video.playbackRate), 1.1);
    await page.evaluate(() => document.querySelector('video').vsc.iosPlayer.restoreSitePlayer());
    await page.waitForFunction(() => !window.__customWebMState().native);
    state = await page.evaluate(() => window.__customWebMState());
    assert.true(state.originalVisible && state.chromeVisible && !state.originalPaused);
    assert.equal(state.controllers, 0);
    await page.click('#close');
    await page.click('#open');
    await page.waitForFunction(() => window.__customWebMState().controlled);
    await page.click('#close');
    await page.waitForFunction(() => window.__customWebMState().controllers === 0);
    state = await page.evaluate(() => window.__customWebMState());
    assert.true(state.closedPaused);
    errors.assertNone('native custom WebM ownership');
    console.log(
      'PASS: custom WebM takeover, decoded playback, playing/paused picture scrubs, speed, handback and close cleanup'
    );
    return { passed: 1, failed: 0 };
  } finally {
    await browser?.close();
    await fixture?.stop();
  }
}

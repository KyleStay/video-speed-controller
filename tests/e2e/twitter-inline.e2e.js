/** Controlled local feed at the real x.com hostname; never requests the live site. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';

const iphoneUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const settle = async (page) => {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
};

async function tapFeedControl(page, selector, owned = false) {
  const bounds = await page.evaluate(
    (query, active) => {
      const root = active
        ? document.querySelector('vsc-ios-player')?.shadowRoot
        : window.__feedOriginal?.vsc?.div?.shadowRoot;
      const target = root?.querySelector(query);
      if (!target || !target.getClientRects().length) {
        return null;
      }
      const { x, y, width, height } = target.getBoundingClientRect();
      return { x, y, width, height };
    },
    selector,
    owned
  );
  assert.exists(bounds, `Visible feed control ${selector}`);
  assert.true(
    bounds.width >= 44 && bounds.height >= 44,
    `${selector} must retain44px touch target`
  );
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

async function openFeedCustom(page) {
  if (
    !(await page.evaluate(() => window.__feedOriginal.vsc.div.classList.contains('vsc-touch-open')))
  ) {
    await tapFeedControl(page, '.draggable');
  }
  await page.waitForFunction(() =>
    window.__feedOriginal.vsc.div.classList.contains('vsc-touch-open')
  );
  await tapFeedControl(page, '[aria-label="Open StayFast player"]');
  await page.waitForFunction(() => window.__feedOriginal.vsc.iosPlayer.active);
}

export default async function runTwitterInline({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let errors;
  let passed = 0;
  let failed = 0;
  try {
    const html = await readFile(resolve('tests/e2e/twitter-feed.html'), 'utf8');
    const media = await readFile(resolve('tests/e2e/sample.webm'));
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    await page.setUserAgent(iphoneUA);
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
      if (url.origin === 'https://x.com' && url.pathname === '/__stayfast_feed') {
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      } else if (url.origin === 'https://x.com' && url.pathname === '/__stayfast_sample.webm') {
        const range = request.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
        void request.respond({
          status: range ? 206 : 200,
          contentType: 'video/webm',
          headers: {
            'Accept-Ranges': 'bytes',
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
          },
          body: media.subarray(start, end + 1),
        });
      } else {
        void request.abort('blockedbyclient');
      }
    });
    await page.goto('https://x.com/__stayfast_feed', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        document.querySelector('#older-video')?.vsc &&
        document.querySelector('#older-video').readyState >= 2
    );
    assert.true(
      await page.evaluate(() => window.VSC.EventManager.isTwitterHost(location.hostname)),
      'Fixture must exercise the actual Twitter-scoped event path'
    );
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('#older-video').playbackRate > 1);
    await page.evaluate(() => {
      window.__olderController = document.querySelector('#older-video').vsc;
      window.__olderRate = document.querySelector('#older-video').playbackRate;
    });
    await page.mouse.move(375, 740);
    await page.mouse.wheel({ deltaY: 900 });
    await page.waitForFunction(() => scrollY > 700);
    await settle(page);
    const baseline = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const check = async (name, work) => {
      try {
        errors.assertNone(`before ${name}`);
        const expected = (await work()) || {};
        await settle(page);
        const state = await page.evaluate(() => {
          const old = document.querySelector('#older-video');
          const video = document.querySelector('#new-video');
          return {
            x: scrollX,
            y: scrollY,
            calls: window.__feedNativeCalls,
            fullscreen: !!document.fullscreenElement,
            owned: document.querySelectorAll('vsc-ios-player').length,
            oldIdentity: old.vsc === window.__olderController,
            oldRate: old.playbackRate,
            expectedRate: window.__olderRate,
            newIdentity: video === window.__feedOriginal,
            newController: !!video.vsc,
            controllerIdentity: !window.__newController || video.vsc === window.__newController,
            newRate: video.playbackRate,
            inline: video.hasAttribute('playsinline') && video.hasAttribute('webkit-playsinline'),
          };
        });
        console.log(`   X feed ${name}: ${JSON.stringify(state)}`);
        assert.true(
          Math.abs(state.x - (expected.scroll || baseline).x) <= 1 &&
            Math.abs(state.y - (expected.scroll || baseline).y) <= 1,
          `Scroll changed: baseline ${JSON.stringify(expected.scroll || baseline)}, actual ${JSON.stringify(state)}`
        );
        assert.true(
          !state.fullscreen &&
            state.calls.length === (expected.nativeCalls || 0) &&
            state.owned === 0,
          JSON.stringify(state)
        );
        assert.true(
          state.oldIdentity &&
            state.oldRate === state.expectedRate &&
            state.newIdentity &&
            state.newController &&
            state.controllerIdentity &&
            state.inline,
          JSON.stringify(state)
        );
        assert.equal(
          state.newRate,
          state.expectedRate,
          'Feed media rate must remain the accepted rate'
        );
        errors.assertNone(name);
        passed++;
        console.log(`   ✅ X feed: ${name}`);
      } catch (error) {
        failed++;
        console.error(`   ❌ X feed ${name}: ${error.stack || error.message}`);
      }
    };
    await check(
      'new omitted-inline video loads and autoplays with older media controlled',
      async () => {
        await page.evaluate(() => window.__feed.append());
        await page.waitForFunction(
          () =>
            window.__feedOriginal?.vsc &&
            window.__feedOriginal.readyState >= 2 &&
            !window.__feedOriginal.paused
        );
        await page.evaluate(() => {
          window.__newController = window.__feedOriginal.vsc;
        });
      }
    );
    await check(
      'same video recycles its source and missing attributes then autoplays',
      async () => {
        await page.evaluate(() => window.__feed.recycle());
        await page.waitForFunction(
          () =>
            window.__feedOriginal.readyState >= 2 &&
            !window.__feedOriginal.paused &&
            window.__feedOriginal.currentSrc.includes('recycled')
        );
      }
    );
    await check('repeated natural playing events do not choose fullscreen', async () => {
      await page.evaluate(async () => {
        for (let count = 0; count < 3; count++) {
          window.__feedOriginal.pause();
          await window.__feedOriginal.play();
        }
      });
    });
    await check(
      'site rerender retaining the video repairs its controller without moving the page',
      async () => {
        await page.evaluate(() => window.__feed.rerender());
        await page.waitForFunction(() => window.__feedOriginal.vsc?.div?.isConnected);
      }
    );
    await check(
      'actual tab visibility return and persisted-pageshow recovery stay inline',
      async () => {
        const other = await browser.newPage();
        try {
          await other.bringToFront();
          await page.waitForFunction(() => document.visibilityState === 'hidden');
          await page.bringToFront();
          await page.waitForFunction(() => document.visibilityState === 'visible');
          // A test-only history-restoration signal complements the genuine tab restoration.
          await page.evaluate(() =>
            dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
          );
        } finally {
          await other.close();
        }
      }
    );
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    const lifecycleState = async (name, { y = baseline.y, nativeCalls = 0 } = {}) => {
      await settle(page);
      const state = await page.evaluate(() => ({
        x: scrollX,
        y: scrollY,
        owned: document.querySelectorAll('vsc-ios-player').length,
        calls: window.__feedNativeCalls.length,
        source: window.__feedOriginal.currentSrc,
        sameVideo: document.querySelector('#new-video') === window.__feedOriginal,
        sameController: window.__feedOriginal.vsc === window.__newController,
      }));
      console.log(`   Synthetic native lifecycle ${name}: ${JSON.stringify(state)}`);
      await page.screenshot({ path: resolve(`tests/e2e/screenshots/twitter-stale-${name}.png`) });
      assert.true(
        state.x === baseline.x &&
          Math.abs(state.y - y) <= 1 &&
          state.owned === 0 &&
          state.calls === nativeCalls &&
          state.sameVideo &&
          state.sameController,
        `Stale lifecycle ${name}: expected scroll${baseline.x},${y}/owned0/calls${nativeCalls}, got ${JSON.stringify(state)}`
      );
    };
    const cleanupCustom = () =>
      page.evaluate(() => {
        // Exception cleanup only; entry and expected automatic closure remain genuine/strict.
        window.__feedOriginal.vsc?.iosPlayer?.close();
      });
    await check(
      'synthetic PiP return after source recycling never reopens stale custom ownership',
      async () => {
        await openFeedCustom(page);
        try {
          await page.evaluate(() => {
            const video = window.__feedOriginal;
            Object.defineProperty(video, 'webkitPresentationMode', {
              configurable: true,
              writable: true,
              value: 'picture-in-picture',
            });
            video.dispatchEvent(new Event('webkitpresentationmodechanged'));
          });
          await page.waitForFunction(() => !document.querySelector('vsc-ios-player'));
          await page.evaluate(() => window.__feed.recycle());
          await page.waitForFunction(
            () => window.__feedOriginal.readyState >= 2 && !window.__feedOriginal.paused
          );
          await page.evaluate(() => {
            const video = window.__feedOriginal;
            video.webkitPresentationMode = 'inline';
            video.dispatchEvent(new Event('webkitpresentationmodechanged'));
          });
          await lifecycleState('pip-source-return');
        } finally {
          await cleanupCustom();
        }
      }
    );
    await check(
      'source recycling while custom playback is active closes ownership without scrolling',
      async () => {
        await openFeedCustom(page);
        try {
          await page.evaluate(() => window.__feed.recycle());
          await page.waitForFunction(
            () => window.__feedOriginal.readyState >= 2 && !window.__feedOriginal.paused
          );
          await lifecycleState('active-source-reset');
        } finally {
          await cleanupCustom();
        }
      }
    );
    await check(
      'late synthetic native end after source recycling preserves the newer site scroll',
      async () => {
        await page.evaluate(() => {
          window.__feedNativeCalls.length = 0;
        });
        await tapFeedControl(page, '.inline-fullscreen');
        await page.evaluate(() =>
          window.__feedOriginal.dispatchEvent(new Event('webkitbeginfullscreen'))
        );
        await page.evaluate(() => window.__feed.recycle());
        await page.waitForFunction(
          () => window.__feedOriginal.readyState >= 2 && !window.__feedOriginal.paused
        );
        await page.evaluate(() => {
          scrollTo({ top: 1100, behavior: 'instant' });
          window.__feedOriginal.dispatchEvent(new Event('webkitendfullscreen'));
        });
        await lifecycleState('native-source-late-end', { y: 1100, nativeCalls: 1 });
        return { scroll: { x: baseline.x, y: 1100 }, nativeCalls: 1 };
      }
    );
    await check(
      'unsolicited synthetic native begin at zero cannot rewind a later site restoration',
      async () => {
        await page.evaluate((y) => {
          window.__feedNativeCalls.length = 0;
          scrollTo({ top: 0, behavior: 'instant' });
          window.__feedOriginal.dispatchEvent(new Event('webkitbeginfullscreen'));
          scrollTo({ top: y, behavior: 'instant' });
          window.__feedOriginal.dispatchEvent(new Event('webkitendfullscreen'));
        }, baseline.y);
        await lifecycleState('unsolicited-begin');
      }
    );
    await page.screenshot({ path: resolve('tests/e2e/screenshots/twitter-inline-feed.png') });
  } catch (error) {
    failed++;
    console.error(`X feed setup failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    await browser?.close();
  }
  console.log(
    `X feed local Chrome fixture: ${passed} passed, ${failed} failed (not live X or Safari verification)`
  );
  return { passed, failed };
}

/** Local modern-X DOM at x.com; every page/media request is intercepted locally. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';

const iphoneUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function settle(page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  );
  await new Promise((done) => setTimeout(done, 150));
}

async function tap(page, resolveTarget, argument) {
  const handle = await page.evaluateHandle(resolveTarget, argument);
  try {
    const element = handle.asElement();
    const bounds = await element?.boundingBox();
    assert.exists(
      bounds,
      `A genuine touch needs a visible target (${argument || 'owned control'})`
    );
    assert.true(
      bounds.width >= 44 && bounds.height >= 44,
      `Touch target must retain44px: ${JSON.stringify(bounds)}`
    );
    const hit = await element.evaluate((target) => {
      const rect = target.getBoundingClientRect();
      const actual = target
        .getRootNode()
        .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        intended: target.id || target.getAttribute('aria-label') || target.localName,
        actual: actual?.id || actual?.getAttribute?.('aria-label') || actual?.localName,
        matches: actual === target || target.contains(actual),
      };
    });
    assert.true(
      hit.matches,
      `Genuine touch must hit the intended control: ${JSON.stringify({ bounds, hit })}`
    );
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  } finally {
    await handle.dispose();
  }
}

const tapSelector = (page, selector) =>
  tap(page, (query) => document.querySelector(query), selector);
const tapInline = (page, ref) =>
  tap(page, (name) => window.__modernX.video.vsc.controlsManager.inlinePlayer.refs[name], ref);
const tapOwned = (page, ref) =>
  tap(page, (name) => window.__modernX.video.vsc.iosPlayer.ui.refs[name], ref);

async function picturePoint(page) {
  const point = await page.evaluate(() => {
    const { video, player } = window.__modernX;
    const trigger = player.querySelector('[data-slot="xds-context-menu-trigger"]');
    const bounds = video.getBoundingClientRect();
    for (const [dx, dy] of [
      [0.5, 0.65],
      [0.6, 0.8],
      [0.4, 0.8],
      [0.8, 0.4],
    ]) {
      const x = bounds.left + bounds.width * dx;
      const y = bounds.top + bounds.height * dy;
      const hit = document.elementFromPoint(x, y);
      if (hit === video || hit === player || hit === trigger) {
        return { x, y, hit: hit.localName };
      }
    }
    return null;
  });
  assert.exists(point, 'The picture needs an actual unoccluded media/surface hit target');
  return point;
}

async function tapBlankPage(page) {
  const point = await page.evaluate(() => {
    const tail = document.querySelector('.tail');
    const bounds = tail.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(innerHeight, bounds.bottom);
    if (bottom - top < 44) {
      return null;
    }
    const x = innerWidth / 2;
    const y = (top + bottom) / 2;
    return document.elementFromPoint(x, y) === tail ? { x, y } : null;
  });
  assert.exists(point, 'A genuine blur tap needs an uncovered blank-page target');
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => {
    const inline = window.__modernX.video.vsc.controlsManager.inlinePlayer;
    return !inline.root.contains(inline.shadow.activeElement);
  });
}

async function state(page) {
  return page.evaluate(() => {
    const trace = window.__modernX;
    const video = trace.video;
    const visible = (node) =>
      !!node?.getClientRects().length && getComputedStyle(node).display !== 'none';
    return {
      x: scrollX,
      y: scrollY,
      identity: document.getElementById('modern-video') === video,
      controller: video.vsc === window.__modernController,
      source: video.currentSrc === trace.source,
      paused: video.paused,
      time: video.currentTime,
      rate: video.playbackRate,
      controls: video.controls,
      owned: document.querySelectorAll('vsc-ios-player').length,
      active: !!video.vsc?.iosPlayer?.active,
      fullscreen: !!document.fullscreenElement,
      nativeVideoFullscreen: document.fullscreenElement === video,
      idle: video.vsc?.div.hasAttribute('data-vsc-inline-idle'),
      coverVisible: visible(document.querySelector('#picture-cover')),
      groupVisible: visible(trace.player.querySelector('[class~="group/controls"]')),
      entryVisible: visible(document.querySelector('#x-fullscreen')),
      captionVisible: visible(document.querySelector('#caption')),
      surfaceClicks: trace.surfaceClicks,
      transportClicks: trace.transportClicks,
      theaters: trace.theaters,
      swipes: trace.swipes,
      overlayClicks: trace.overlayClicks,
      linkClicks: trace.linkClicks,
      nativeCalls: trace.nativeCalls,
      events: trace.events,
    };
  });
}

function assertOriginal(current) {
  assert.true(
    current.identity && current.controller && current.source && current.captionVisible,
    `Original media/controller/source/captions must survive: ${JSON.stringify(current)}`
  );
  assert.true(
    !current.nativeVideoFullscreen &&
      current.nativeCalls.every((call) => call.name === 'requestFullscreen' && call.owned),
    `Only the owned wrapper may request browser fullscreen: ${JSON.stringify(current)}`
  );
}

async function assertScroll(page, before, label) {
  await settle(page);
  const current = await state(page);
  assert.true(
    Math.abs(current.x - before.x) <= 1 && Math.abs(current.y - before.y) <= 1,
    `${label} changed page scroll: ${JSON.stringify({ before, current })}`
  );
}

export default async function runTwitterModernPlayer({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let errors;
  let passed = 0;
  let failed = 0;
  try {
    const html = await readFile(resolve('tests/e2e/twitter-modern-player.html'), 'utf8');
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
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === 'https://x.com' && url.pathname === '/__stayfast_modern') {
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      } else if (url.origin === 'https://x.com' && url.pathname === '/__stayfast_modern.webm') {
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
    const navigate = async (retained = false) => {
      await page.goto(`https://x.com/__stayfast_modern${retained ? '?retained=1' : ''}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () =>
          window.__modernX?.video.vsc?.iosPlayer?.attached && window.__modernX.video.readyState >= 2
      );
      await page.mouse.move(375, 700);
      await page.mouse.wheel({ deltaY: 650 });
      await page.waitForFunction(
        () => scrollY > 500 && window.__modernX.video.vsc.div.hasAttribute('data-vsc-inline-owned')
      );
      await settle(page);
      await page.evaluate(() => {
        window.__modernController = window.__modernX.video.vsc;
      });
    };
    const check = async (name, work) => {
      try {
        errors.assertNone(`before ${name}`);
        await work();
        errors.assertNone(name);
        passed++;
        console.log(`   ✅ Modern X local fixture: ${name}`);
      } catch (error) {
        failed++;
        console.error(`   ❌ Modern X local fixture ${name}: ${error.stack || error.message}`);
      }
    };
    await check(
      'observed modern structure suppresses site chrome and stays inline without autoplay',
      async () => {
        await navigate();
        const current = await state(page);
        assertOriginal(current);
        assert.true(
          current.paused &&
            !current.controls &&
            !current.coverVisible &&
            !current.groupVisible &&
            !current.entryVisible &&
            !current.active &&
            current.owned === 0 &&
            !current.fullscreen &&
            current.theaters === 0,
          JSON.stringify(current)
        );
        await page.screenshot({ path: resolve('tests/e2e/screenshots/twitter-modern-inline.png') });
      }
    );
    await check(
      'genuine picture taps reveal controls and preserve pause/play; dedicated Play/Pause retains playback',
      async () => {
        await navigate();
        const before = await state(page);
        const pausedPoint = await picturePoint(page);
        await page.touchscreen.tap(pausedPoint.x, pausedPoint.y);
        let current = await state(page);
        assertOriginal(current);
        assert.true(
          current.paused &&
            current.time === before.time &&
            current.surfaceClicks === 0 &&
            !current.active &&
            current.owned === 0,
          JSON.stringify(current)
        );
        await tapInline(page, 'play');
        await page.waitForFunction(
          () =>
            !window.__modernX.video.paused &&
            window.__modernX.video.currentTime > 0.1 &&
            window.__modernX.video.getVideoPlaybackQuality().totalVideoFrames > 0
        );
        // Focused transport intentionally stays available. Release Play's focus
        // with an actual blank-page tap before exercising playback idle/reveal.
        await tapBlankPage(page);
        await page.waitForFunction(
          () => window.__modernX.video.vsc.div.hasAttribute('data-vsc-inline-idle'),
          { timeout: 7000 }
        );
        const playingPoint = await picturePoint(page);
        await page.touchscreen.tap(playingPoint.x, playingPoint.y);
        current = await state(page);
        assertOriginal(current);
        assert.true(
          !current.paused &&
            !current.idle &&
            current.surfaceClicks === 0 &&
            current.owned === 0 &&
            !current.fullscreen,
          JSON.stringify(current)
        );
        await tapInline(page, 'play');
        await page.waitForFunction(() => window.__modernX.video.paused);
        await assertScroll(page, before, 'picture and dedicated transport taps');
      }
    );
    await check(
      'genuine page swipes and interactive picture buttons/links keep their site behavior',
      async () => {
        await navigate();
        await tapSelector(page, '#overlay-action');
        await tapSelector(page, '#post-link');
        const before = await state(page);
        const point = await picturePoint(page);
        const session = await page.createCDPSession();
        try {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: point.x, y: point.y, id: 1 }],
          });
          for (let step = 1; step <= 5; step++) {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: point.x, y: point.y - step * 20, id: 1 }],
            });
            await new Promise((done) => setTimeout(done, 20));
          }
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
          await session.detach();
        }
        await page.waitForFunction((y) => scrollY > y + 20, {}, before.y);
        const current = await state(page);
        assertOriginal(current);
        assert.true(
          current.overlayClicks === 1 &&
            current.linkClicks === 1 &&
            current.swipes > 0 &&
            current.surfaceClicks === 0 &&
            current.paused &&
            !current.active &&
            current.owned === 0 &&
            !current.fullscreen,
          JSON.stringify(current)
        );
      }
    );
    await check(
      'programmatic modern fullscreen links keep site CSS theater behavior without owned takeover',
      async () => {
        await navigate();
        const session = await page.createCDPSession();
        try {
          const result = await session.send('Runtime.evaluate', {
            expression: "document.querySelector('#x-fullscreen').click()",
            userGesture: false,
          });
          assert.true(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
        } finally {
          await session.detach();
        }
        await page.waitForFunction(() => window.__modernX.theaters === 1);
        const current = await state(page);
        assertOriginal(current);
        assert.true(
          current.owned === 0 &&
            !current.active &&
            !current.fullscreen &&
            current.events.some((event) => event.kind === 'theater' && !event.trusted),
          JSON.stringify(current)
        );
        await tapSelector(page, '#close-site-theater');
      }
    );
    await check(
      'the visible StayFast Full screen entry works while X transports remain suppressed',
      async () => {
        await navigate();
        const before = await state(page);
        await tap(page, () =>
          window.__modernX.video.vsc.div.shadowRoot.querySelector('.inline-fullscreen')
        );
        await page.waitForFunction(() => window.__modernX.video.vsc.iosPlayer.active);
        const current = await state(page);
        assertOriginal(current);
        assert.true(
          current.owned === 1 && current.theaters === 0 && current.paused && !current.controls,
          JSON.stringify(current)
        );
        await page.screenshot({ path: resolve('tests/e2e/screenshots/twitter-modern-owned.png') });
        await tapOwned(page, 'done');
        await page.waitForFunction(
          () => !document.querySelector('vsc-ios-player') && !document.fullscreenElement
        );
        await assertScroll(page, before, 'owned fullscreen return');
      }
    );
    await check(
      'controlled retained-entry variant genuinely routes the modern X anchor to owned fullscreen',
      async () => {
        await navigate(true);
        const before = await state(page);
        assert.true(
          before.entryVisible && !before.groupVisible,
          'This is the documented visible-entry variant, not the observed live transport layout'
        );
        await tapSelector(page, '#x-fullscreen');
        await page.waitForFunction(() => window.__modernX.video.vsc.iosPlayer.active);
        const current = await state(page);
        assertOriginal(current);
        assert.true(
          current.owned === 1 &&
            current.theaters === 0 &&
            current.surfaceClicks === 0 &&
            current.paused,
          JSON.stringify(current)
        );
        await page.screenshot({
          path: resolve('tests/e2e/screenshots/twitter-modern-retained-entry.png'),
        });
        await tapOwned(page, 'done');
        await page.waitForFunction(
          () => !document.querySelector('vsc-ios-player') && !document.fullscreenElement
        );
        await assertScroll(page, before, 'retained modern entry return');
      }
    );
    await check(
      'other-post and ambiguous retained entries remain site navigation rather than owned takeover',
      async () => {
        for (const guard of ['other-post', 'multiple-media']) {
          await navigate(true);
          const guardSetup = await page.evaluate((kind) => {
            if (kind === 'other-post') {
              // 999 is already the fixture's unrelated post link. Use an ID
              // absent from the article's permalinks for this negative route.
              document.querySelector('#x-fullscreen').href = '/other/status/456/video/1';
              return !Array.from(document.querySelectorAll('article a[href]')).some((link) =>
                /^\/[^/]+\/status\/456\/?$/.test(new URL(link.href).pathname)
              );
            } else {
              const extra = document.createElement('video');
              extra.muted = true;
              extra.preload = 'auto';
              extra.src = '/__stayfast_modern.webm?second';
              window.__modernX.player.append(extra);
              return window.__modernX.player.querySelectorAll('video').length === 2;
            }
          }, guard);
          assert.true(guardSetup, `${guard}: the fixture must establish a rejected route`);
          if (guard === 'multiple-media') {
            await page.waitForFunction(
              () => !window.__modernX.player.hasAttribute('data-vsc-ios-site-controls')
            );
          }
          await tapSelector(page, '#x-fullscreen');
          try {
            await page.waitForFunction(() => window.__modernX.theaters === 1);
          } catch (error) {
            await page.screenshot({
              path: resolve(`tests/e2e/screenshots/twitter-modern-${guard}-failure.png`),
            });
            throw new Error(`${guard}: ${JSON.stringify(await state(page))}`, { cause: error });
          }
          const current = await state(page);
          assertOriginal(current);
          assert.true(
            !current.active &&
              current.owned === 0 &&
              !current.fullscreen &&
              current.events.some((event) => event.kind === 'theater' && event.trusted),
            `${guard}: ${JSON.stringify(current)}`
          );
          await tapSelector(page, '#close-site-theater');
        }
      }
    );
    await check(
      'Use site player restores real site transport and CSS theater reparenting without losing media',
      async () => {
        await navigate();
        const before = await state(page);
        await tap(page, () =>
          window.__modernX.video.vsc.div.shadowRoot.querySelector('.inline-fullscreen')
        );
        await page.waitForFunction(() => window.__modernX.video.vsc.iosPlayer.active);
        await tapOwned(page, 'more');
        await tapOwned(page, 'site');
        await page.waitForFunction(
          () =>
            !document.querySelector('vsc-ios-player') &&
            window.__modernX.video.controls &&
            getComputedStyle(document.querySelector('#picture-cover')).display !== 'none'
        );
        await tapSelector(page, '#site-play');
        await page.waitForFunction(
          () => window.__modernX.transportClicks === 1 && !window.__modernX.video.paused
        );
        await tapSelector(page, '#site-play');
        await page.waitForFunction(
          () => window.__modernX.transportClicks === 2 && window.__modernX.video.paused
        );
        await tapSelector(page, '#x-fullscreen');
        await page.waitForFunction(
          () =>
            window.__modernX.theaters === 1 &&
            window.__modernX.player.parentElement.id === 'site-theater'
        );
        let current = await state(page);
        assertOriginal(current);
        assert.true(
          current.owned === 0 &&
            !current.active &&
            !current.fullscreen &&
            current.controls &&
            current.groupVisible,
          JSON.stringify(current)
        );
        await page.screenshot({
          path: resolve('tests/e2e/screenshots/twitter-modern-site-handback.png'),
        });
        await tapSelector(page, '#close-site-theater');
        await settle(page);
        current = await state(page);
        assertOriginal(current);
        assert.true(
          current.owned === 0 && !current.active && current.controls && current.paused,
          JSON.stringify(current)
        );
        await assertScroll(page, before, 'site CSS theater reparent return');
      }
    );
  } catch (error) {
    failed++;
    console.error(`Modern X local fixture setup failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    await browser?.close();
  }
  console.log(
    `Modern X local Chrome fixture: ${passed} passed, ${failed} failed (not live X or Safari verification; visible-link variant is controlled)`
  );
  return { passed, failed };
}

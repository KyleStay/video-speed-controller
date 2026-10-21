/** Paired layout diagnosis on intercepted local X content plus a bounded public read. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
const ua =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
export default async function runTwitterLayout({ launch = launchChromeWithExtension } = {}) {
  let browser, errors;
  let passed = 0,
    failed = 0;
  try {
    const html = await readFile(resolve('tests/e2e/twitter-layout.html'), 'utf8');
    const media = await readFile(resolve('tests/e2e/sample.webm'));
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    await page.setUserAgent(ua);
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
      if (url.pathname === '/__layout_feed') {
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      } else if (url.pathname === '/__layout_sample.webm') {
        const range = request.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
        void request.respond({
          status: range ? 206 : 200,
          contentType: 'video/webm',
          headers: range
            ? { 'Content-Range': `bytes ${start}-${end}/${media.length}`, 'Accept-Ranges': 'bytes' }
            : {},
          body: media.subarray(start, end + 1),
        });
      } else {
        void request.abort('blockedbyclient');
      }
    });
    const results = {};
    for (const enabled of [false, true]) {
      await page.goto(`https://x.com/__layout_feed?enabled=${enabled}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => window.VSC_controller?.initialized);
      if (!enabled) {
        await page.evaluate(() => window.VSC_controller.teardown());
      }
      await page.mouse.move(300, 500);
      await page.mouse.wheel({ deltaY: 1600 });
      await page.waitForFunction(() => document.querySelector('#scroller').scrollTop > 1000);
      await settle();
      const before = await page.evaluate(() => window.__layout.choose());
      const rows = [{ phase: 'before', state: before }];
      for (const phase of [
        'far',
        'fresh',
        'recycle',
        'above',
        'virtualize',
        'rerender',
        'reparent',
      ]) {
        await page.evaluate((name) => window.__layout[name](), phase);
        await settle();
        if (enabled && ['far', 'fresh', 'recycle', 'above'].includes(phase)) {
          await page.waitForFunction(
            () => window.__layoutVideo?.vsc && window.__layoutVideo.readyState >= 2
          );
        }
        if (enabled && phase === 'reparent') {
          await page.waitForFunction(
            () => window.__layoutVideo.vsc?.div?.parentNode === window.__layoutVideo.parentNode
          );
        }
        const state = await page.evaluate(() => window.__layout.snapshot());
        rows.push({ phase, state });
        console.log(`Layout enabled=${enabled} ${phase}: ${JSON.stringify(state)}`);
        errors.assertNone(`layout ${enabled}/${phase}`);
      }
      results[enabled ? 'enabled' : 'disabled'] = rows;
      await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
      await page.screenshot({
        path: resolve(`tests/e2e/screenshots/twitter-layout-${enabled}.png`),
      });
    }
    for (let index = 1; index < results.enabled.length; index++) {
      const active = results.enabled[index],
        disabled = results.disabled[index];
      try {
        assert.true(
          Math.abs(active.state.scrollTop - disabled.state.scrollTop) <= 1,
          `${active.phase} extension-dependent scroll: ${JSON.stringify({ active: active.state, disabled: disabled.state })}`
        );
        assert.true(
          Math.abs(active.state.anchorTop - disabled.state.anchorTop) <= 1,
          `${active.phase} extension-dependent anchor displacement`
        );
        assert.true(
          active.state.scrollTop > 1000 && active.state.pageY === 0 && active.state.owned === 0,
          `${active.phase} unexpected top/owned transition`
        );
        assert.equal(
          active.state.calls.length,
          0,
          `${active.phase} programmatic focus/scroll/fullscreen APIs`
        );
        if (active.phase === 'reparent') {
          const current = active.state.current;
          assert.true(
            current.sameController && Math.abs(current.deltaY) <= 8,
            `Same-size reparent keeps stale controller geometry: ${JSON.stringify(current)}`
          );
          assert.true(
            Math.abs(current.width - current.original.width) <= 1 &&
              Math.abs(current.height - current.original.height) <= 1,
            'Reparent fixture must preserve media size, so ResizeObserver cannot be relied upon'
          );
        }
        passed++;
        console.log(`   ✅ Natural feed: ${active.phase} matches disabled baseline`);
      } catch (error) {
        failed++;
        console.error(`   ❌ Natural feed: ${error.stack || error.message}`);
      }
    }
    try {
      const geometry = results.enabled.find((row) => row.phase === 'far').state.geometry;
      const target = geometry.find((row) => row.phase === 'target-loadeddata');
      const corrected = geometry.find((row) => row.phase === 'first-site-RO');
      assert.true(
        Math.abs(target.deltaY) <= 8,
        `Target loadeddata sees displaced controller: ${JSON.stringify({ target, corrected })}`
      );
      assert.true(
        Math.abs(target.scrollHeight - corrected.scrollHeight) <= 1,
        `Target loadeddata sees transient scroll overflow: ${JSON.stringify({ target, corrected })}`
      );
      passed++;
      console.log(
        '   ✅ Natural feed: target loadeddata sees final controller geometry before ResizeObserver'
      );
    } catch (error) {
      failed++;
      console.error(`   ❌ Natural feed synchronous geometry: ${error.stack || error.message}`);
    }
    // This read is independent of the local interception, without a user profile/login.
    const live = await browser.newPage();
    const liveErrors = monitorPageErrors(live);
    try {
      await live.evaluateOnNewDocument(() => {
        window.__liveFeedProbe = { loaded: [], calls: [] };
        const probe = window.__liveFeedProbe;
        for (const [object, key] of [
          [window, 'scrollTo'],
          [window, 'scrollBy'],
          [Element.prototype, 'scrollIntoView'],
          [HTMLElement.prototype, 'focus'],
        ]) {
          const original = object[key];
          object[key] = function (...args) {
            probe.calls.push({
              key,
              target: this.id || this.tagName || 'window',
              stack: new Error().stack.split('\n').slice(1, 4).join('\n'),
            });
            return original.apply(this, args);
          };
        }
        document.addEventListener(
          'loadeddata',
          (event) => {
            const video = event.target;
            if (video.tagName !== 'VIDEO') {
              return;
            }
            video.addEventListener(
              'loadeddata',
              () => {
                const measure = (phase) => {
                  const media = video.getBoundingClientRect(),
                    control = video.vsc?.div?.shadowRoot
                      ?.querySelector('#controller')
                      ?.getBoundingClientRect();
                  const parents = [];
                  for (
                    let node = video.parentElement, count = 0;
                    node && count < 6;
                    node = node.parentElement, count++
                  ) {
                    parents.push({
                      tag: node.tagName,
                      overflow: getComputedStyle(node).overflow,
                      height: node.getBoundingClientRect().height,
                      scrollHeight: node.scrollHeight,
                      scrollTop: node.scrollTop,
                    });
                  }
                  probe.loaded.push({
                    phase,
                    scrollY,
                    mediaTop: media.top,
                    controllerTop: control?.top,
                    delta: control ? control.top - media.top : null,
                    height: document.scrollingElement.scrollHeight,
                    parents,
                  });
                };
                measure('target-loadeddata');
                const observer = new ResizeObserver(() => {
                  observer.disconnect();
                  measure('first-RO');
                });
                observer.observe(video);
              },
              { once: true }
            );
          },
          true
        );
      });
      await live.setUserAgent(ua);
      await live.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      const response = await live.goto('https://x.com/NASA', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      await settle();
      const state = await live.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: document.body?.innerText.slice(0, 1200),
        tweets: document.querySelectorAll('[data-testid="tweet"]').length,
        videos: document.querySelectorAll('video').length,
        media: Array.from(document.querySelectorAll('video')).map((video) => ({
          ready: video.readyState,
          paused: video.paused,
          controlled: !!video.vsc,
          parents: Array.from(
            (function* (node) {
              for (let count = 0; node && count < 6; count++, node = node.parentElement) {
                yield node;
              }
            })(video)
          ).map((node) => ({
            tag: node.tagName,
            id: node.id,
            classes: String(node.className).slice(0, 100),
            overflow: getComputedStyle(node).overflow,
            transform: getComputedStyle(node).transform,
          })),
        })),
      }));
      console.log(`Public X read status=${response?.status()}: ${JSON.stringify(state)}`);
      await live.screenshot({ path: resolve('tests/e2e/screenshots/twitter-public.png') });
      const readable = state.tweets > 0 || (state.videos > 0 && state.text?.includes('Posts'));
      if (readable) {
        if (
          await live.evaluate(() => document.body.innerText.includes('Get the full app experience'))
        ) {
          // The prior public screenshot observed X's ordinary dismiss control here.
          await live.touchscreen.tap(358, 30);
          await live.waitForFunction(
            () => !document.body.innerText.includes('Get the full app experience'),
            { timeout: 3000 }
          );
          await settle();
          console.log('Public X ordinary app-promotion dismiss tapped at observed close control.');
        }
        const samples = [];
        for (let step = 0; step < 4; step++) {
          await live.mouse.move(340, 650);
          await live.mouse.wheel({ deltaY: 900 });
          await settle();
          samples.push(
            await live.evaluate(() => ({
              x: scrollX,
              y: scrollY,
              height: document.scrollingElement.scrollHeight,
              active: document.activeElement?.tagName,
              owned: document.querySelectorAll('vsc-ios-player').length,
              videos: document.querySelectorAll('video').length,
              probe: window.__liveFeedProbe,
            }))
          );
        }
        console.log(`Public X genuine scroll samples: ${JSON.stringify(samples)}`);
        await live.screenshot({
          path: resolve('tests/e2e/screenshots/twitter-public-scrolled.png'),
        });
        liveErrors.assertNone('bounded public X read');
        console.log(
          samples.some((row) => row.y > 0)
            ? 'Public X readable; bounded genuine unsigned scroll sampling completed, no user-specific reproduction claimed.'
            : 'Public X scroll reproduction BLOCKED: site prevents scrolling after ordinary dismissal; DOM evidence available, not counted as a pass.'
        );
      } else {
        console.log('Public X live reproduction BLOCKED: no readable feed; not counted as a pass.');
      }
    } catch (error) {
      console.log(`Public X live reproduction BLOCKED: ${error.message}; not counted as a pass.`);
    } finally {
      liveErrors.dispose();
      await live.close();
    }
  } catch (error) {
    failed++;
    console.error(`Twitter layout setup failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    await browser?.close();
  }
  console.log(
    `Natural-height X fixture: ${passed} passed, ${failed} failed; public live availability reported separately`
  );
  return { passed, failed };
}

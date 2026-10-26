/** Controlled natural-flow feed mechanics; no physical device or live account required. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function position(page) {
  await settle(page);
  return page.evaluate(() => window.__feedPosition());
}

async function touch(page, resolver) {
  const target = await page.evaluateHandle(resolver);
  try {
    const box = await target.asElement()?.boundingBox();
    assert.true(
      box && box.width >= 44 && box.height >= 44,
      'Genuine touch needs a visible44px control'
    );
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } finally {
    await target.dispose();
  }
}

function unchanged(before, after, label) {
  assert.true(
    before.post === after.post && after.sameVideo,
    `${label}: same post and original video required`
  );
  for (const key of ['page', 'nested', 'top', 'height', 'nextTop']) {
    assert.true(
      Math.abs(before[key] - after[key]) <= 1,
      `${label}: ${key} changed: ${JSON.stringify({ before, after })}`
    );
  }
}

export default async function runFeedPosition({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let errors;
  let passed = 0;
  let failed = 0;
  const evidence = [];
  try {
    const html = await readFile(resolve('tests/e2e/twitter-feed-position.html'), 'utf8');
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
      if (url.origin === 'https://x.com' && url.pathname === '/__feed-position') {
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      } else if (url.origin === 'https://x.com' && url.pathname === '/__feed.webm') {
        void request.respond({ status: 200, contentType: 'video/webm', body: media });
      } else {
        void request.abort('blockedbyclient');
      }
    });
    for (const nested of [false, true]) {
      for (const margin of [false, true]) {
        const label = `${nested ? 'nested' : 'page'} near-end feed, ${margin ? '30px' : 'zero'} media margins`;
        const record = { label, transitions: [] };
        evidence.push(record);
        try {
          await page.goto(
            `https://x.com/__feed-position?${nested ? 'nested&' : ''}${margin ? 'margin' : ''}`,
            { waitUntil: 'domcontentloaded' }
          );
          await page.waitForFunction(
            () => window.__feedVideo?.readyState >= 2 && window.__feedVideo.vsc?.iosPlayer?.attached
          );
          await page.evaluate((inNested) => {
            const feed = document.querySelector('#feed');
            if (inNested) {
              feed.scrollTop = feed.scrollHeight;
            }
            window.scrollTo(0, inNested ? 650 : document.scrollingElement.scrollHeight);
          }, nested);
          const before = await position(page);
          assert.true(
            nested ? before.nested === before.maxNested : before.page === before.maxPage,
            `Fixture must start at the scroll-range end: ${JSON.stringify(before)}`
          );
          for (let repeat = 0; repeat < 2; repeat++) {
            await touch(page, () =>
              window.__feedVideo.vsc.div.shadowRoot.querySelector('.inline-fullscreen')
            );
            await page.waitForFunction(() => window.__feedVideo.vsc.iosPlayer.active);
            const open = await position(page);
            record.transitions.push({ before, open });
            // A temporary viewport change must not turn presentation layout
            // clamping into a new intentional feed position.
            await page.setViewport({
              width: 844,
              height: 390,
              deviceScaleFactor: 2,
              isMobile: true,
              hasTouch: true,
            });
            await position(page);
            await page.setViewport({
              width: 390,
              height: 844,
              deviceScaleFactor: 2,
              isMobile: true,
              hasTouch: true,
            });
            record.transitions.at(-1).rotatedBack = await position(page);
            await touch(page, () => window.__feedVideo.vsc.iosPlayer.ui.refs.done);
            await page.waitForFunction(
              () => !window.__feedVideo.vsc.iosPlayer.active && !document.fullscreenElement
            );
            const closed = await position(page);
            record.transitions.at(-1).closed = closed;
            unchanged(before, open, `${label} entry ${repeat}`);
            unchanged(before, record.transitions.at(-1).rotatedBack, `${label} rotation ${repeat}`);
            unchanged(before, closed, `${label} return ${repeat}`);
          }
          errors.assertNone(label);
          passed++;
          console.log(`   ✅ Feed position: ${label}`);
        } catch (error) {
          failed++;
          record.error = error.stack || error.message;
          console.error(`   ❌ Feed position: ${label}: ${record.error}`);
        }
      }
    }
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    await writeFile(
      resolve('tests/e2e/screenshots/twitter-feed-position.json'),
      JSON.stringify(evidence, null, 2)
    );
    errors.assertNone('feed position suite');
  } catch (error) {
    failed++;
    console.error(`Feed position setup failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    await browser?.close();
  }
  console.log(
    `Controlled feed position: ${passed} passed, ${failed} failed (not live X/device acceptance)`
  );
  return { passed, failed };
}

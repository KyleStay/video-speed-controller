/** Fresh documents with no trusted browser input; local content at the X hostname only. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';

export default async function runTwitterPristine({ launch = launchChromeWithExtension } = {}) {
  const html = await readFile(resolve('tests/e2e/twitter-pristine.html'), 'utf8');
  const media = await readFile(resolve('tests/e2e/sample.webm'));
  let browser;
  let passed = 0;
  let failed = 0;
  try {
    const launched = await launch();
    browser = launched.browser;
    for (const scenario of ['first', 'older', 'reuse', 'rerender']) {
      const page = await browser.newPage();
      const errors = monitorPageErrors(page);
      const session = await page.createCDPSession();
      try {
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
          if (url.origin === 'https://x.com' && url.pathname === '/__pristine') {
            void request.respond({ status: 200, contentType: 'text/html', body: html });
          } else if (url.origin === 'https://x.com' && url.pathname === '/__pristine.webm') {
            const range = request.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
            const start = range ? Number(range[1]) : 0;
            const end = range?.[2]
              ? Math.min(Number(range[2]), media.length - 1)
              : media.length - 1;
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
        await page.goto(`https://x.com/__pristine?case=${scenario}`, {
          waitUntil: 'domcontentloaded',
        });
        // Puppeteer evaluate/waitForFunction grants userGesture:true, so use CDP explicitly.
        const result = await session.send('Runtime.evaluate', {
          expression: `new Promise((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error('Pristine fixture exceeded15s')), 15000);
            Promise.resolve(window.__pristineResult).then(
              (value) => { clearTimeout(deadline); resolve(value); },
              (error) => { clearTimeout(deadline); reject(error); }
            );
          })`,
          awaitPromise: true,
          returnByValue: true,
          userGesture: false,
        });
        const trace = result.result.value;
        assert.exists(trace, JSON.stringify(result.exceptionDetails));
        await mkdir(resolve('test-results/pristine-feed'), { recursive: true });
        await writeFile(
          resolve(`test-results/pristine-feed/${scenario}.json`),
          JSON.stringify(trace, null, 2)
        );
        await page.screenshot({ path: resolve(`test-results/pristine-feed/${scenario}.png`) });
        const baseline = trace.rows[0];
        assert.true(trace.rows.length > 20 && baseline.event === 'baseline');
        assert.equal(trace.dropped, 0, 'A saturated observer buffer cannot prove a quiet interval');
        assert.equal(trace.rows.at(-1).event, 'final');
        assert.true(
          baseline.pageY === 720 && baseline.nestedX === 70 && baseline.nestedY === 220,
          'Structural setup must settle before observation'
        );
        assert.true(
          trace.rows.every((row) => !row.activation && !row.transientActivation),
          'No prior/current user activation is permitted'
        );
        assert.true(
          trace.rows.every(
            (row) =>
              Math.abs(row.pageX - baseline.pageX) <= 1 &&
              Math.abs(row.pageY - baseline.pageY) <= 1 &&
              Math.abs(row.nestedX - baseline.nestedX) <= 1 &&
              Math.abs(row.nestedY - baseline.nestedY) <= 1
          ),
          'A transient page/nested scroll change must fail'
        );
        assert.equal(trace.ownedAdded, 0, 'Even a transient owned-player insertion must fail');
        assert.true(trace.rows.every((row) => !row.owned && !row.native));
        assert.equal(
          trace.calls.length,
          0,
          `Unchosen focus/scroll/fullscreen API calls: ${JSON.stringify(trace.calls)}`
        );
        assert.equal(trace.presentations.length, 0);
        assert.equal(trace.errors.length, 0, JSON.stringify(trace.errors));
        assert.true(trace.rows.every((row) => row.mediaError === 0));
        assert.true(
          trace.played &&
            trace.rows.some(
              (row) =>
                row.time > 0.25 &&
                row.ready >= 2 &&
                !row.paused &&
                row.decodedFrames > trace.initialDecodedFrames + 1
            ),
          'Muted autoplay must actually advance; blocked playback is not a pass'
        );
        assert.true(
          trace.sameVideo && trace.connected && trace.inSlot && trace.rows.at(-1).controlled
        );
        if (scenario === 'rerender') {
          assert.true(
            trace.rerendered && trace.replayed && trace.playingEvents >= 2,
            'Replacement and actual replay must execute within the bounded observation'
          );
        }
        if (scenario !== 'first') {
          assert.true(baseline.olderControlled, 'Older media must already be controlled');
        }
        errors.assertNone(`pristine ${scenario}`);
        passed++;
        console.log(
          `   ✅ Pristine ${scenario}: ${trace.rows.length} pre-load/event/frame samples, activation false, page720/nested70,220 stable, decoded playback, no owned/native transition`
        );
      } catch (error) {
        failed++;
        console.error(`   ❌ Pristine ${scenario}: ${error.stack || error.message}`);
      } finally {
        await session
          .send('Runtime.evaluate', {
            expression: 'window.__pristineCleanup?.()',
            userGesture: false,
          })
          .catch(() => {});
        await session.detach();
        errors.dispose();
        await page.close();
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  console.log(
    `Pristine X-host Chrome fixture: ${passed} passed, ${failed} failed (no input; not Safari native-policy proof)`
  );
  return { passed, failed };
}

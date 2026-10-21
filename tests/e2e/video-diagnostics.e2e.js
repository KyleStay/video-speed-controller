/** Opt-in capture in the built extension. Artificial jumps are fixture stimuli, not live-X repros. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const privateMarker = 'PRIVATE_TWEET_AND_SOURCE_TOKEN_739201';
const iphoneUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const fixtureHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font:16px system-ui;background:#edf3f7}.lead,.tail{height:900px}.actions{position:fixed;top:8px;right:8px;z-index:2147483647;display:grid;gap:4px}button,input{min-height:44px;font:inherit}.nested{height:380px;overflow:auto;margin:12px;width:360px}.content{padding-top:250px;min-height:1400px;width:500px}video{display:block;width:340px;height:192px}p{padding:12px}
</style></head><body><div class="lead"></div><p>${privateMarker}</p><div class="nested"><div class="content"><video id="feed-video" muted loop playsinline controls src="/sample.webm?private=${privateMarker}"></video></div></div><div class="tail"></div><div class="actions"><button id="prepare">Prepare scrolled feed</button><button id="play">Play test video</button><button id="reuse">Reuse feed video</button><button id="load">Load next feed video</button><button id="jump">Simulate fixture jump</button><button id="fullscreen">Fullscreen test video</button><input aria-label="Private fixture input" value="${privateMarker}"></div><script>
window.__fixtureOriginal=document.querySelector('video');window.__fixtureSequence=0;
const on=(id,fn)=>document.getElementById(id).addEventListener('click',event=>{if(event.isTrusted)fn()});
on('prepare',()=>{scrollTo(0,720);document.querySelector('.nested').scrollTo(70,220)});
on('play',()=>document.querySelector('video').play().catch(()=>{}));
on('reuse',()=>{const video=window.__fixtureOriginal;video.src='/sample.webm?private=${privateMarker}&reuse='+(++window.__fixtureSequence);video.load()});
on('load',()=>{const video=document.createElement('video');video.id='next-video';video.muted=true;video.loop=true;video.playsInline=true;video.controls=true;video.src='/sample.webm?private=${privateMarker}&new='+(++window.__fixtureSequence);document.querySelector('.content').append(video)});
on('jump',()=>{window.__fixtureJumpBefore={pageY:scrollY,nestedY:document.querySelector('.nested').scrollTop};scrollTo(0,0);document.querySelector('.nested').scrollTop=0});
on('fullscreen',()=>window.__fixtureOriginal.requestFullscreen().catch(()=>{}));
</script></body></html>`;

const parentHtml =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Media-less diagnostic parent</h1><iframe title="Diagnostic media frame" src="/diagnostic-feed.html" style="width:390px;height:750px;border:0"></iframe></body></html>';

async function waitForMedia(context, selector = '#feed-video') {
  await context.waitForFunction(
    (query) => {
      const video = document.querySelector(query);
      return video?.vsc && video.readyState >= 2;
    },
    {},
    selector
  );
}

async function popupReport(popup) {
  await popup.waitForFunction(() => {
    const output = document.querySelector('#video-diagnostics textarea');
    const start = document.querySelector('[data-diagnostic="start"]');
    return output?.value && !start?.disabled;
  });
  return popup.$eval('#video-diagnostics textarea', (node) => JSON.parse(node.value));
}

const allEvents = (report) => report.frames.flatMap(({ report: frame }) => frame.events);

/** Open the actual action popup; its active tab remains the fixture rather than an extension tab. */
async function openPopup(browser, fixture, bootstrap, extensionId) {
  await fixture.bringToFront();
  const targetPromise = browser.waitForTarget(
    (target) =>
      target.url() === `chrome-extension://${extensionId}/ui/popup/popup.html` &&
      target !== bootstrap.target(),
    { timeout: 10000 }
  );
  await bootstrap.evaluate(() => chrome.action.openPopup());
  const target = await targetPromise;
  // Chrome exposes action popups as type "other"; Puppeteer's explicit adapter retains CDP input.
  const popup = (await target.page()) || (await target.asPage());
  assert.exists(popup, 'Chrome action popup must expose its extension document');
  await popup.waitForSelector('#video-diagnostics');
  return popup;
}

export default async function runVideoDiagnostics({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let fixtures;
  let passed = 0;
  let failed = 0;
  const monitors = [];
  const check = async (name, work) => {
    try {
      monitors.forEach((monitor) => monitor.assertNone(`before ${name}`));
      await work();
      monitors.forEach((monitor) => monitor.assertNone(name));
      passed++;
      console.log(`   ✅ Diagnostics: ${name}`);
    } catch (error) {
      failed++;
      console.error(`   ❌ Diagnostics: ${name}: ${error.stack || error.message}`);
    }
  };
  try {
    fixtures = await startFixtureServer({
      htmlRoutes: {
        '/diagnostic-feed.html': fixtureHtml,
        '/diagnostic-parent.html': parentHtml,
      },
    });
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    monitors.push(monitorPageErrors(page));
    await page.setUserAgent(iphoneUA);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true });
    await page.goto(`${fixtures.baseUrl}/diagnostic-feed.html`, { waitUntil: 'load' });
    await waitForMedia(page);
    const bootstrap = await browser.newPage();
    await bootstrap.goto(`chrome-extension://${launched.extensionId}/ui/popup/popup.html`);
    monitors.push(monitorPageErrors(bootstrap));
    let popup;
    let captured;

    await check(
      'diagnostic build captures the controlled X document before manual Start',
      async () => {
        const xPage = await browser.newPage();
        monitors.push(monitorPageErrors(xPage));
        await xPage.setUserAgent(iphoneUA);
        await xPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true });
        const media = await readFile(resolve('tests/e2e/sample.webm'));
        await xPage.setRequestInterception(true);
        xPage.on('request', (request) => {
          const url = new URL(request.url());
          if (url.origin === 'https://x.com' && url.pathname === '/__stayfast_diagnostic') {
            void request.respond({ status: 200, contentType: 'text/html', body: fixtureHtml });
          } else if (url.origin === 'https://x.com' && url.pathname === '/sample.webm') {
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
        try {
          await xPage.goto('https://x.com/__stayfast_diagnostic', { waitUntil: 'load' });
          await waitForMedia(xPage);
          popup = await openPopup(browser, xPage, bootstrap, launched.extensionId);
          monitors.push(monitorPageErrors(popup));
          const automatic = await popupReport(popup);
          assert.true(
            automatic.frames.some(
              ({ report }) => report.active && report.reason === 'diagnostic-build'
            )
          );
          assert.true(allEvents(automatic).some((event) => event.event === 'before-controller'));
          assert.true(allEvents(automatic).some((event) => event.event === 'after-controller'));
          assert.false(JSON.stringify(automatic).includes(privateMarker));
          await popup.click('[data-diagnostic="stop"]');
          await popupReport(popup);
          await popup.close();
        } finally {
          await xPage.close();
        }
      }
    );

    await check('capture is opt-in and starts through a genuine popup button', async () => {
      popup = await openPopup(browser, page, bootstrap, launched.extensionId);
      monitors.push(monitorPageErrors(popup));
      const idle = await popupReport(popup);
      assert.true(idle.frames.length > 0);
      assert.true(idle.frames.every(({ report }) => !report.active && report.events.length === 0));
      await popup.click('[data-diagnostic="start"]');
      const started = await popupReport(popup);
      assert.true(started.frames.some(({ report }) => report.active));
      await page.bringToFront();
    });

    await check('genuine input, source reuse and an artificial jump can be exported', async () => {
      await page.click('#fullscreen');
      await page.waitForFunction(() => document.fullscreenElement === window.__fixtureOriginal);
      await page.keyboard.press('Escape');
      if (await page.evaluate(() => !!document.fullscreenElement)) {
        // Actual browser fullscreen entry above is genuine; this only cleans up OS-dependent exit.
        await page.evaluate(() => document.exitFullscreen());
      }
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.click('#prepare');
      await page.waitForFunction(() => scrollY === 720);
      await new Promise((resolve) => setTimeout(resolve, 160));
      await page.mouse.move(380, 650);
      await page.mouse.wheel({ deltaY: 80 });
      await page.click('#play');
      await new Promise((resolve) => setTimeout(resolve, 160));
      await page.keyboard.press('d');
      console.log(
        `   Diagnostics rate before reuse: ${JSON.stringify(await page.evaluate(() => ({ rate: window.__fixtureOriginal.playbackRate, activeTag: document.activeElement.tagName })))}`
      );
      await page.click('#reuse');
      await waitForMedia(page);
      console.log(
        `   Diagnostics rate after source load: ${await page.evaluate(() => window.__fixtureOriginal.playbackRate)}`
      );
      await page.click('#load');
      await waitForMedia(page, '#next-video');
      const beforeRate = await page.evaluate(() => window.__fixtureOriginal.playbackRate);
      await page.mouse.click(8, 700);
      await new Promise((resolve) => setTimeout(resolve, 160));
      await page.keyboard.press('d');
      await page.waitForFunction(
        (rate) => window.__fixtureOriginal.playbackRate > rate,
        {},
        beforeRate
      );
      // Two media can enter with different rates after load(); select an absolute user choice.
      popup = await openPopup(browser, page, bootstrap, launched.extensionId);
      monitors.push(monitorPageErrors(popup));
      await popupReport(popup);
      await popup.waitForFunction(
        () => !document.querySelector('.preset-btn[data-speed="1.5"]').disabled
      );
      await popup.click('.preset-btn[data-speed="1.5"]');
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('video')).every(
          (video) => Math.abs(video.playbackRate - 1.5) < 0.001
        )
      );
      await page.bringToFront();
      await page.evaluate(() => {
        window.__fixtureChosenRate = window.__fixtureOriginal.playbackRate;
      });
      await page.click('input');
      await page.keyboard.type('private input must never appear in export');
      await page.click('#jump');
      await page.waitForFunction(
        () => scrollY === 0 && document.querySelector('.nested').scrollTop === 0
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      popup = await openPopup(browser, page, bootstrap, launched.extensionId);
      monitors.push(monitorPageErrors(popup));
      const incident = await popupReport(popup);
      assert.true(
        incident.frames.some(
          ({ report }) => !report.active && report.reason === 'suspected-top-jump'
        ),
        'Artificial jump freezes capture automatically'
      );
      await popup.click('[data-diagnostic="stop"]');
      captured = await popupReport(popup);
      await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
      await writeFile(
        resolve('tests/e2e/screenshots/video-diagnostics-report.json'),
        JSON.stringify(captured, null, 2)
      );
      assert.true(captured.frames.every(({ report }) => !report.active));
      assert.true(captured.frames.some(({ report }) => report.events.length > 0));
      const events = allEvents(captured);
      for (const expected of [
        'capture-start',
        'capture-stop',
        'loadstart',
        'loadedmetadata',
        'before-controller',
        'after-controller',
        'focusin',
        'pointerdown',
        'keydown',
        'wheel',
        'fullscreenchange',
        'scroll-before-jump',
        'suspected-top-jump',
      ]) {
        assert.true(
          events.some((event) => event.event === expected),
          `Export must retain ${expected}`
        );
      }
      assert.true(
        events.some(
          (event) => event.page?.y >= 720 && event.scrollers?.some((scroll) => scroll.y === 220)
        ),
        'Export must retain pre-jump page and nested offsets'
      );
      assert.true(
        events.some(
          (event) =>
            event.event === 'suspected-top-jump' &&
            event.page?.y === 0 &&
            event.scrollers?.some((scroll) => scroll.y === 0)
        ),
        'Export must retain artificial jump to page/nested zero'
      );
      const nestedBefore = events
        .flatMap((event) => event.scrollers || [])
        .find((scroll) => scroll.x === 70 && scroll.y === 220);
      const jump = events.find((event) => event.event === 'suspected-top-jump');
      assert.exists(nestedBefore, 'Pre-jump nested scroller has a stable anonymous ID');
      assert.true(
        events.some(
          (event) =>
            event.seq >= jump.seq &&
            event.scrollers?.some((scroll) => scroll.id === nestedBefore.id && scroll.y === 0)
        ),
        'Post-jump evidence must contain the same nested scroller at zero, not merely root/input zero'
      );
      for (const phase of [1, 2]) {
        assert.true(
          events.some(
            (event) =>
              event.event === 'frame' &&
              event.trigger === 'suspected-top-jump' &&
              event.phase === phase &&
              event.scrollers?.some((scroll) => scroll.id === nestedBefore.id && scroll.y === 0)
          ),
          `Incident phase${phase} retains the same nested scroller's post-jump position`
        );
      }
      assert.true(
        events.some(
          (event) => event.media?.controllerRect?.width > 0 && event.media.rect?.width > 0
        ),
        'Export must retain numeric media/controller geometry'
      );
      assert.true(
        events.some((event) => event.activeTag === 'INPUT'),
        'Export retains focus role, not input text'
      );
      const finalMedia = await page.evaluate(() => ({
        same: window.__fixtureOriginal === document.querySelector('#feed-video'),
        rate: window.__fixtureOriginal.playbackRate,
        chosenRate: window.__fixtureChosenRate,
      }));
      assert.true(
        finalMedia.same &&
          finalMedia.chosenRate === 1.5 &&
          Math.abs(finalMedia.rate - finalMedia.chosenRate) < 0.001,
        `Capture/export preserves original media and accepted absolute choice: ${JSON.stringify(finalMedia)}`
      );
      const json = JSON.stringify(captured);
      assert.false(
        json.includes(privateMarker),
        'Export must omit tweet text, source query and input value'
      );
      assert.false(json.includes(fixtures.baseUrl), 'Export must omit source and page URLs');
      await popup.screenshot({
        path: resolve('tests/e2e/screenshots/video-diagnostics-popup.png'),
      });
    });

    await check('stopped capture ignores later input and scrolling', async () => {
      const stopped = JSON.stringify(captured.frames);
      await page.bringToFront();
      await page.click('#prepare');
      await page.click('input');
      await page.keyboard.press('ArrowRight');
      popup = await openPopup(browser, page, bootstrap, launched.extensionId);
      monitors.push(monitorPageErrors(popup));
      assert.equal(JSON.stringify((await popupReport(popup)).frames), stopped);
    });

    await check(
      'clear and a fresh capture reset evidence and the event ring remains bounded',
      async () => {
        await popup.click('[data-diagnostic="clear"]');
        await popup.waitForFunction(
          () =>
            document
              .querySelector('#video-diagnostics [role="status"]')
              .textContent.startsWith('Capture cleared.') &&
            !document.querySelector('[data-diagnostic="start"]').disabled
        );
        assert.true(
          await popup.$eval('#diagnostic-report', (node) => node.hidden && node.value === ''),
          'Clear immediately removes prepared evidence'
        );
        assert.true(await popup.$eval('[data-diagnostic="copy"]', (node) => node.disabled));
        await page.bringToFront();
        popup = await openPopup(browser, page, bootstrap, launched.extensionId);
        monitors.push(monitorPageErrors(popup));
        const cleared = await popupReport(popup);
        assert.true(
          cleared.frames.every(({ report }) => report.events.length === 0 && !report.active)
        );
        await popup.click('[data-diagnostic="start"]');
        const fresh = await popupReport(popup);
        assert.equal(allEvents(fresh)[0].seq, 1, 'New capture starts a new sequence');
        await page.bringToFront();
        await page.evaluate(() => {
          // Synthetic media-event burst tests the ring; it is not decoder or user-input evidence.
          const video = document.querySelector('video');
          for (let index = 0; index < 350; index++) {
            video.dispatchEvent(new Event('loadedmetadata'));
          }
        });
        popup = await openPopup(browser, page, bootstrap, launched.extensionId);
        monitors.push(monitorPageErrors(popup));
        await popupReport(popup);
        await popup.click('[data-diagnostic="stop"]');
        const bounded = await popupReport(popup);
        assert.true(bounded.frames.every(({ report }) => report.events.length <= 240));
        assert.true(allEvents(bounded)[0].seq > 1, 'Oldest events roll off the bounded ring');
      }
    );

    await check(
      'media-less parent exports the child-frame capture through the real popup',
      async () => {
        await page.bringToFront();
        await page.goto(`${fixtures.baseUrl}/diagnostic-parent.html`, { waitUntil: 'load' });
        assert.equal(await page.$$eval('video', (nodes) => nodes.length), 0);
        const child = page.frames().find((frame) => frame.url().endsWith('/diagnostic-feed.html'));
        assert.exists(child);
        await waitForMedia(child);
        popup = await openPopup(browser, page, bootstrap, launched.extensionId);
        monitors.push(monitorPageErrors(popup));
        await popupReport(popup);
        await popup.click('[data-diagnostic="start"]');
        const started = await popupReport(popup);
        assert.true(started.frames.length >= 2 && started.frames.length <= 8);
        assert.true(started.frames.every(({ report }) => report.active));
        await page.bringToFront();
        await child.click('#reuse');
        await waitForMedia(child);
        popup = await openPopup(browser, page, bootstrap, launched.extensionId);
        monitors.push(monitorPageErrors(popup));
        await popupReport(popup);
        await popup.click('[data-diagnostic="stop"]');
        const result = await popupReport(popup);
        assert.true(
          result.frames.some(
            ({ frameId, report }) => frameId === 0 && !report.events.some((event) => event.mediaId)
          )
        );
        assert.true(
          result.frames.some(
            ({ frameId, report }) =>
              frameId > 0 &&
              report.events.some((event) => event.event === 'loadedmetadata' && event.mediaId)
          )
        );
        assert.false(JSON.stringify(result).includes(privateMarker));
        assert.true(result.frames.every(({ report }) => !report.active));
      }
    );
  } finally {
    monitors.forEach((monitor) => monitor.dispose());
    if (browser) {
      await browser.close();
    }
    if (fixtures) {
      await fixtures.stop();
    }
  }
  console.log(
    `Video diagnostics Chrome fixture: ${passed} passed, ${failed} failed (artificial jump, not live X or Safari)`
  );
  return { passed, failed };
}

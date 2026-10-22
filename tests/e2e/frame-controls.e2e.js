/** Real built Chrome/Firefox controls. Action-popup input is exercised in Chrome. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchFixtureBrowser } from './browser-runtime.js';
import { startFixtureServer } from './fixture-server.js';
import { assert, monitorPageErrors } from './e2e-utils.js';

function audioFixture() {
  const wav = Buffer.alloc(44 + 8000, 128);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(8000, 40);
  return `data:audio/wav;base64,${wav.toString('base64')}`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Frame controls fixture</title>
<style>body{margin:24px;font:16px system-ui}.media{position:relative;width:720px;margin-bottom:24px}video{display:block;width:720px;height:405px}button{min-height:44px}audio{width:500px}</style>
</head><body>
<div class="media"><video id="video" muted playsinline preload="auto" src="/sample.webm"></video></div>
<button id="play">Play video</button><button id="pause">Pause video</button>
<div class="media"><audio id="audio" controls preload="auto" src="${audioFixture()}"></audio></div>
<script>
const video = document.querySelector('video');
document.querySelector('#play').addEventListener('click', () => video.play());
document.querySelector('#pause').addEventListener('click', () => video.pause());
</script></body></html>`;

async function controlPoint(page, mediaId, selector) {
  const point = await page.evaluate(
    (id, query) => {
      const node = document.getElementById(id)?.vsc?.div?.shadowRoot?.querySelector(query);
      if (!node || !node.getClientRects().length) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    mediaId,
    selector
  );
  assert.exists(point, `${mediaId} ${selector} must be visible`);
  return point;
}

async function reveal(page, mediaId) {
  const point = await controlPoint(page, mediaId, '.draggable');
  await page.mouse.move(point.x, point.y);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (coarse) {
    await page.mouse.click(point.x, point.y);
  }
  await page.waitForFunction(
    (id) => {
      const panel = document.getElementById(id).vsc.div.shadowRoot.querySelector('#controls');
      return getComputedStyle(panel).display !== 'none';
    },
    {},
    mediaId
  );
}

async function clickFrame(page, action) {
  await reveal(page, 'video');
  const point = await controlPoint(page, 'video', `[data-action="${action}"]`);
  await page.mouse.click(point.x, point.y);
}

async function seedPaused(page) {
  await page.click('#play');
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await page.click('#pause');
  await page.waitForFunction(() => document.querySelector('video').paused);
  await page.evaluate(() => {
    document.querySelector('video').currentTime = 10;
    document.querySelector('audio').currentTime = 0.5;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
}

async function state(page, action) {
  return page.evaluate((name) => {
    const video = document.querySelector('video');
    const fallback = window.VSC_controller.config.getKeyBinding(name);
    const candidate = video.vsc.detectedFps || fallback || 30;
    return {
      time: video.currentTime,
      rate: video.playbackRate,
      paused: video.paused,
      fps: Number.isFinite(candidate) && candidate > 0 ? candidate : 30,
      audioTime: document.querySelector('audio').currentTime,
      audioRate: document.querySelector('audio').playbackRate,
    };
  }, action);
}

async function verifyStep(page, action, click) {
  const before = await state(page, action);
  await click();
  const expected = before.time + (action === 'advanceFrame' ? 1 : -1) / before.fps;
  await page.waitForFunction(
    (target) => Math.abs(document.querySelector('video').currentTime - target) < 0.0001,
    { timeout: 3000 },
    expected
  );
  const after = await state(page, action);
  assert.true(after.paused, 'Frame steps must leave the video paused');
  assert.equal(after.rate, before.rate, 'Frame steps must retain playback speed');
  assert.equal(after.audioTime, before.audioTime, 'Frame steps must not seek audio');
  assert.equal(after.audioRate, before.audioRate, 'Frame steps must not change audio speed');
  console.log(`   ${action}: ${before.time} → ${after.time} at ${before.fps} fps`);
}

/** Root runners may inject an existing owned launch function; this suite closes its browser. */
export default async function runFrameControls({
  browserName = 'chrome',
  launch = () => launchFixtureBrowser(browserName),
} = {}) {
  let browser;
  let fixture;
  let page;
  let errors;
  let passed = 0;
  let failed = 0;
  const check = async (name, work) => {
    try {
      errors.assertNone(`before ${name}`);
      await work();
      errors.assertNone(name);
      passed++;
      console.log(`   ✅ ${browserName} frame controls: ${name}`);
    } catch (error) {
      failed++;
      console.error(
        `   ❌ ${browserName} frame controls: ${name}: ${error.stack || error.message}`
      );
      await page
        .screenshot({
          path: resolve(`tests/e2e/screenshots/frame-controls-${browserName}-failure.png`),
        })
        .catch(() => {});
    }
  };
  try {
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    fixture = await startFixtureServer({ htmlRoutes: { '/frame-controls.html': html } });
    const launched = await launch();
    browser = launched.browser;
    page = launched.page;
    errors = monitorPageErrors(page);
    await page.goto(`${fixture.baseUrl}/frame-controls.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      ['video', 'audio'].every((id) => {
        const media = document.getElementById(id);
        return media.readyState >= 2 && media.vsc?.div?.shadowRoot;
      })
    );

    await check('genuine controller buttons step paused video forward and back', async () => {
      await seedPaused(page);
      await verifyStep(page, 'advanceFrame', () => clickFrame(page, 'advanceFrame'));
      await verifyStep(page, 'rewindFrame', () => clickFrame(page, 'rewindFrame'));
      await page.screenshot({
        path: resolve(`tests/e2e/screenshots/frame-controls-${browserName}.png`),
      });
    });

    await check('playing video and audio expose disabled frame buttons', async () => {
      await page.click('#play');
      await page.waitForFunction(() => !document.querySelector('video').paused);
      await page.waitForFunction(() =>
        ['video', 'audio'].every((id) => {
          const buttons = document
            .getElementById(id)
            .vsc.div.shadowRoot.querySelectorAll('.frame-step');
          return buttons.length === 2 && [...buttons].every((button) => button.disabled);
        })
      );
      await clickFrame(page, 'advanceFrame');
      assert.equal(
        await page.$eval('video', (video) => video.paused),
        false,
        'A disabled frame button must not auto-pause playing video'
      );
      await page.click('#pause');
      await page.waitForFunction(() => document.querySelector('video').paused);
    });

    if (browserName === 'chrome') {
      await check('genuine Chrome action popup steps the active fixture video', async () => {
        await seedPaused(page);
        const origin = `chrome-extension://${launched.extensionId}`;
        const bootstrap = await browser.newPage();
        let popup;
        let popupErrors;
        try {
          await bootstrap.goto(`${origin}/ui/popup/popup.html`, { waitUntil: 'load' });
          await page.bringToFront();
          const opened = browser.waitForTarget(
            (target) =>
              target.url() === `${origin}/ui/popup/popup.html` && target !== bootstrap.target(),
            { timeout: 10000 }
          );
          await bootstrap.evaluate(() => chrome.action.openPopup());
          const target = await opened;
          popup = (await target.page()) || (await target.asPage());
          assert.exists(popup, 'Action popup must expose its document');
          popupErrors = monitorPageErrors(popup);
          await popup.waitForFunction(
            () =>
              [...document.querySelectorAll('[data-frame-direction]')].length === 2 &&
              [...document.querySelectorAll('[data-frame-direction]')].every(
                (button) => !button.disabled
              )
          );
          await verifyStep(page, 'advanceFrame', () => popup.click('[data-frame-direction="1"]'));
          await verifyStep(page, 'rewindFrame', () => popup.click('[data-frame-direction="-1"]'));
          // The site can resume while the popup retains its last paused status.
          // Arrange that race, then use genuine popup input for both commands.
          const beforeResume = await state(page, 'advanceFrame');
          await page.evaluate(() => document.querySelector('video').play());
          await page.waitForFunction(() => !document.querySelector('video').paused);
          await popup.click('[data-frame-direction="1"]');
          await popup.waitForFunction(() => {
            const frames = [...document.querySelectorAll('[data-frame-direction]')];
            return (
              frames.every((button) => button.disabled) &&
              !document.querySelector('#speed-increase').disabled &&
              document.querySelector('#status').textContent.startsWith('Current ')
            );
          });
          assert.equal(
            await page.$eval('video', (video) => video.paused),
            false,
            'Rejected stale frame input must leave playback running'
          );
          await popup.click('#speed-increase');
          await page.waitForFunction(
            (rate) => Math.abs(document.querySelector('video').playbackRate - rate) < 0.001,
            {},
            beforeResume.rate + 0.1
          );
          popupErrors.assertNone('Chrome frame popup');
          await popup.screenshot({
            path: resolve('tests/e2e/screenshots/frame-controls-chrome-popup.png'),
          });
        } finally {
          popupErrors?.dispose();
          await popup?.close();
          await bootstrap.close();
        }
      });
    }
  } catch (error) {
    failed++;
    console.error(`${browserName} frame control setup failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    try {
      await browser?.close();
    } finally {
      await fixture?.stop();
    }
  }
  return { passed, failed };
}

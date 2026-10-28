import { mkdir, writeFile } from 'node:fs/promises';
import { assert, monitorPageErrors } from './e2e-utils.js';

/** Actual public X SDK and CDN; Chromium touch emulation, not native Safari. */
export default async function runTwitterLiveMP4({ launch }) {
  let browser, page, errors;
  const output = 'test-results/twitter-mse-fix';
  await mkdir(output, { recursive: true });
  try {
    const launched = await launch();
    browser = launched.browser;
    page = launched.page;
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    errors = monitorPageErrors(page);
    await page.goto('https://x.com/niccruzpatane/status/1968641302011990286', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => {
        const v = document.querySelector('article video');
        return v?.vsc && v.readyState >= 2 && window.VSC.TwitterPlayer.resolve(v);
      },
      { timeout: 45000 }
    );
    await page.evaluate(() => {
      const original = document.querySelector('article video');
      window.__stayfastLiveProbe = {
        original,
        source: original.currentSrc,
        parent: original.parentElement,
      };
    });
    if (await page.$('[data-interaction="app-store-obstruction"][data-state="open"]')) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-interaction="app-store-obstruction"][data-state="open"]')
      );
    }
    // Enter at 1x BEFORE changing speed: the original MSE must never be portaled.
    const videoHandle = await page.evaluateHandle(
      () => window.VSC.stateManager.getControlledElements()[0]
    );
    const rect = await videoHandle.asElement().boundingBox();
    if (
      await page.evaluate(
        (video) => video.vsc.div.hasAttribute('data-vsc-inline-idle'),
        videoHandle
      )
    ) {
      await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    await page.waitForFunction(() => {
      const video = window.VSC.stateManager.getControlledElements()[0];
      return !video.vsc.div.hasAttribute('data-vsc-inline-idle');
    });
    const openHandle = await page.evaluateHandle(
      (video) => video.vsc.div.shadowRoot.querySelector('[aria-label="Open video fullscreen"]'),
      videoHandle
    );
    await openHandle.asElement().tap();
    await openHandle.dispose();
    await videoHandle.dispose();
    await page.waitForFunction(
      () => window.VSC.stateManager.getControlledElements()[0]?.vsc.iosPlayer.active
    );
    await page.waitForFunction(() => {
      const { original, source, parent } = window.__stayfastLiveProbe;
      const native = window.VSC.stateManager.getControlledElements()[0];
      return (
        window.VSC.TwitterMP4Playback.isRetained(original) &&
        original.parentElement === parent &&
        original.currentSrc === source &&
        native !== original &&
        native.playbackRate === 1 &&
        !native.paused &&
        native.vsc.iosPlayer.active
      );
    });
    await writeFile(
      `${output}/live-x-1x-entry.json`,
      JSON.stringify(
        await page.evaluate(() => {
          const { original, source, parent } = window.__stayfastLiveProbe;
          const native = window.VSC.stateManager.getControlledElements()[0];
          return {
            originalParentUnchanged: original.parentElement === parent,
            originalSourceUnchanged: original.currentSrc === source,
            nativeRate: native.playbackRate,
            ownedFullscreen: native.vsc.iosPlayer.active,
          };
        }),
        null,
        2
      )
    );
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('d');
    }
    await page.waitForFunction(() => {
      const original = window.__stayfastLiveProbe.original;
      const controlled = window.VSC.stateManager.getControlledElements();
      return (
        window.VSC.TwitterMP4Playback.isRetained(original) &&
        controlled.length === 1 &&
        controlled[0] !== original &&
        controlled[0].playbackRate === 4
      );
    });
    // Separate decoding from this external CDN's variable initial throughput.
    await page.waitForFunction(
      () => {
        const video = window.VSC.stateManager.getControlledElements()[0];
        return (
          video?.buffered.length &&
          video.buffered.end(video.buffered.length - 1) >= video.duration - 0.1
        );
      },
      { timeout: 45000 }
    );
    const report = await page.evaluate(async () => {
      const { original, source, parent } = window.__stayfastLiveProbe;
      const video = window.VSC.stateManager.getControlledElements()[0];
      const start = performance.now();
      let lastTime = video.currentTime,
        elapsed = 0,
        frames = 0,
        lastFrame = start,
        maxGapMs = 0;
      await new Promise((resolve, reject) => {
        let handle;
        const deadline = setTimeout(() => {
          video.cancelVideoFrameCallback(handle);
          reject(new Error('Live MP4 stopped producing frames'));
        }, 10000);
        const frame = (now) => {
          frames++;
          maxGapMs = Math.max(maxGapMs, now - lastFrame);
          lastFrame = now;
          const delta = video.currentTime - lastTime;
          elapsed += delta < -0.5 && video.loop ? video.duration + delta : delta;
          lastTime = video.currentTime;
          if (now - start >= 4000) {
            clearTimeout(deadline);
            resolve();
          } else {
            handle = video.requestVideoFrameCallback(frame);
          }
        };
        handle = video.requestVideoFrameCallback(frame);
      });
      return {
        originalConnected: original.isConnected,
        originalParentUnchanged: original.parentElement === parent,
        ownedFullscreen: video.vsc.iosPlayer.active,
        originalSourceUnchanged: original.src === source && original.currentSrc === source,
        originalPaused: original.paused,
        mp4: /^https:\/\/video\.twimg\.com\/.+\.mp4(?:\?|$)/.test(video.currentSrc),
        rate: video.playbackRate,
        paused: video.paused,
        frames,
        maxGapMs,
        ratio: elapsed / ((performance.now() - start) / 1000),
      };
    });
    assert.true(
      report.originalConnected &&
        report.originalParentUnchanged &&
        report.originalSourceUnchanged &&
        report.originalPaused &&
        report.ownedFullscreen
    );
    assert.true(report.mp4 && !report.paused && report.rate === 4);
    assert.true(
      report.frames >= 60 && report.ratio > 3.5 && report.ratio < 4.5,
      JSON.stringify(report)
    );
    await writeFile(`${output}/live-x-4x.json`, JSON.stringify(report, null, 2));
    await page.screenshot({ path: `${output}/live-x-4x.png` });
    const stage = await page.evaluateHandle(
      () => window.VSC.stateManager.getControlledElements()[0].vsc.iosPlayer.ui.stage
    );
    if (
      await page.evaluate(() =>
        window.VSC.stateManager
          .getControlledElements()[0]
          .vsc.iosPlayer.ui.host.hasAttribute('data-controls-hidden')
      )
    ) {
      await stage.asElement().tap();
    }
    await stage.dispose();
    await page.waitForFunction(
      () =>
        !window.VSC.stateManager
          .getControlledElements()[0]
          .vsc.iosPlayer.ui.host.hasAttribute('data-controls-hidden')
    );
    for (const name of ['more', 'site']) {
      const button = await page.evaluateHandle(
        (name) => window.VSC.stateManager.getControlledElements()[0].vsc.iosPlayer.ui.refs[name],
        name
      );
      await button.asElement().tap();
      await button.dispose();
    }
    await page.waitForFunction(() => {
      const { original, source } = window.__stayfastLiveProbe;
      return (
        !window.VSC.TwitterMP4Playback.isRetained(original) &&
        original.vsc &&
        !original.paused &&
        original.currentSrc === source
      );
    });
    errors.assertNone('current X retained-source MP4 playback');
    console.log('PASS: actual X SDK supplied MP4 decodes at 4× and returns to intact MSE');
    return { passed: 1, failed: 0 };
  } catch (error) {
    if (page) {
      try {
        await page.screenshot({ path: `${output}/live-x-failure.png` });
        await writeFile(
          `${output}/live-x-failure.json`,
          JSON.stringify(
            await page.evaluate(() => ({
              url: location.href,
              initialized: !!window.VSC_controller?.initialized,
              videos: [...document.querySelectorAll('video')].map((v) => ({
                src: v.currentSrc,
                ready: v.readyState,
                paused: v.paused,
                controlled: !!v.vsc,
              })),
            })),
            null,
            2
          )
        );
      } catch {
        /* Preserve the original failure. */
      }
    }
    throw error;
  } finally {
    errors?.dispose();
    await browser?.close();
  }
}

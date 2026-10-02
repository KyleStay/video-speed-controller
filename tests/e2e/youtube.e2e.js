/**
 * YouTube E2E tests for the StayFast Video extension
 */

import {
  launchChromeWithExtension,
  waitForExtension,
  waitForVideo,
  waitForController,
  getVideoSpeed,
  controlVideo,
  testKeyboardShortcut,
  getControllerSpeedDisplay,
  takeScreenshot,
  assert,
  sleep,
  monitorPageErrors,
} from './e2e-utils.js';

const YOUTUBE_TEST_URL = 'https://www.youtube.com/watch?v=gGCJOTvECVQ';

function isUnrelatedYouTubePageError(error) {
  const detail = `${error.name || ''}: ${error.message || ''}\n${error.stack || ''}`;
  return (
    /doubleclick\.net|googleadservices\.com|googlesyndication\.com/i.test(detail) ||
    /AbortError|NetworkError|Failed to fetch|Load failed/i.test(detail)
  );
}

export default async function runYouTubeE2ETests({ launch = launchChromeWithExtension } = {}) {
  console.log('🎭 Running YouTube E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;
  let pageErrors;

  const runTest = async (testName, testFn) => {
    try {
      console.log(`   🧪 ${testName}`);
      pageErrors?.clear();
      await testFn();
      pageErrors?.assertNone(testName);
      console.log(`   ✅ ${testName}`);
      passed++;
    } catch (error) {
      console.log(`   ❌ ${testName}: ${error.message}`);
      failed++;
    }
  };

  try {
    // Launch Chrome with extension
    const { browser: chromeBrowser, page } = await launch();
    browser = chromeBrowser;
    pageErrors = monitorPageErrors(page, { ignore: isUnrelatedYouTubePageError });

    await runTest('Extension should load on YouTube', async () => {
      console.log(`   🌐 Navigating to: ${YOUTUBE_TEST_URL}`);
      await page.goto(YOUTUBE_TEST_URL, { waitUntil: 'networkidle2' });

      const extensionLoaded = await waitForExtension(page, 5000);
      assert.true(extensionLoaded, 'Extension should be loaded on YouTube');
    });

    await runTest('YouTube video should be detected', async () => {
      // YouTube uses a specific video selector
      const videoReady = await waitForVideo(page, 'video.html5-main-video', 15000);
      assert.true(videoReady, 'YouTube video should be ready');
    });

    await runTest('Speed controller should appear on YouTube video', async () => {
      const controllerFound = await waitForController(page, 15000);
      assert.true(controllerFound, 'Speed controller should appear on YouTube');
    });

    await runTest('YouTube video should start at normal speed', async () => {
      const speed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(speed, 1, 'YouTube video should start at 1.0x speed');
    });

    await runTest('Extension controller should work on YouTube', async () => {
      // Test faster button
      const initialSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      const success = await controlVideo(page, 'faster');
      assert.true(success, 'Faster button should work on YouTube');

      const newSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(newSpeed > initialSpeed, 'Speed should increase on YouTube');

      console.log(`   📊 Speed changed from ${initialSpeed} to ${newSpeed}`);
    });

    await runTest('YouTube native speed controls should be overridden', async () => {
      // Set speed using our extension
      await controlVideo(page, 'faster');
      await controlVideo(page, 'faster');
      const extensionSpeed = await getVideoSpeed(page, 'video.html5-main-video');

      // Our extension should control the video speed
      assert.true(extensionSpeed > 1.0, 'Extension should control YouTube video speed');

      // Check that speed display reflects the change
      const speedDisplay = await getControllerSpeedDisplay(page);
      assert.exists(speedDisplay, 'Speed display should show current speed');
    });

    await runTest('Keyboard shortcuts should work on YouTube', async () => {
      // Reset first using keyboard (R key)
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(1000);

      // Test keyboard shortcuts
      const initialSpeed = await getVideoSpeed(page, 'video.html5-main-video');

      // Test 'D' key for faster
      await testKeyboardShortcut(page, 'KeyD');
      const fasterSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(fasterSpeed > initialSpeed, 'D key should work on YouTube');

      // Test 'S' key for slower
      await testKeyboardShortcut(page, 'KeyS');
      const slowerSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(slowerSpeed < fasterSpeed, 'S key should work on YouTube');

      console.log(
        `   ⌨️  Keyboard shortcuts working: ${initialSpeed} → ${fasterSpeed} → ${slowerSpeed}`
      );
    });

    await runTest('Extension should handle YouTube player interactions', async () => {
      // Drive the media element directly. Clicking YouTube's video surface can
      // enter site-owned handlers or overlays and stall Puppeteer's click call.
      const paused = await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        if (!video) {
          throw new Error('YouTube video element is missing');
        }
        video.pause();
        return video.paused;
      });
      assert.true(paused, 'Video should be paused before the playback check');
      await sleep(1000);

      // Speed should be maintained across play/pause
      const speedBeforePause = await getVideoSpeed(page, 'video.html5-main-video');

      const playing = await page.evaluate(async () => {
        const video = document.querySelector('video.html5-main-video');
        if (!video) {
          throw new Error('YouTube video element is missing');
        }
        video.muted = true;
        await video.play();
        return !video.paused;
      });
      assert.true(playing, 'Video should be playing after play() resolves');
      await sleep(1000);

      const speedAfterPlay = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(
        speedBeforePause,
        speedAfterPlay,
        'Speed should be maintained across play/pause'
      );
    });

    await runTest('Extension should maintain speed after seeking', async () => {
      // Get current speed
      const currentSpeed = await getVideoSpeed(page, 'video.html5-main-video');

      // Seek in the video (which might trigger YouTube player events)
      await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        if (video && video.duration > 30) {
          video.currentTime = 30;
        }
      });

      await sleep(2000);

      // Speed should be maintained after seeking
      const speedAfterSeek = await getVideoSpeed(page, 'video.html5-main-video');
      assert.equal(currentSpeed, speedAfterSeek, 'Speed should be maintained after seeking');
    });

    await runTest('Multiple speed changes should work correctly', async () => {
      // Establish a new user speed rather than racing the ratechange guard by
      // assigning playbackRate behind the controller's back.
      await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        if (video) {
          window.VSC_controller.actionHandler.adjustSpeed(video, 1);
        }
      });
      await sleep(200);

      const baseSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Speed after baseline reset: ${baseSpeed}`);

      // Make multiple speed changes
      await controlVideo(page, 'faster'); // Should be ~1.1
      const speed1 = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Speed after 1st faster: ${speed1}`);

      await controlVideo(page, 'faster'); // Should be ~1.2
      const speed2 = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Speed after 2nd faster: ${speed2}`);

      await controlVideo(page, 'faster'); // Should be ~1.3
      const finalSpeed = await getVideoSpeed(page, 'video.html5-main-video');
      console.log(`   🔍 Final speed after 3rd faster: ${finalSpeed}`);

      assert.true(
        finalSpeed > 1.25,
        `Multiple speed increases should accumulate (expected > 1.25, got ${finalSpeed})`
      );
      assert.true(
        finalSpeed < 1.35,
        `Speed should not increase too much (expected < 1.35, got ${finalSpeed})`
      );

      console.log(`   🔄 Final speed after multiple changes: ${finalSpeed}`);
    });

    // Take screenshots for verification
    await takeScreenshot(page, 'youtube-test-controller.png');

    // Test rewind/advance if available
    await runTest('Rewind and advance controls should work', async () => {
      const currentTime = await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        return video ? video.currentTime : null;
      });

      if (currentTime !== null && currentTime > 15) {
        // Test rewind
        await controlVideo(page, 'rewind');
        await sleep(1000);

        const newTime = await page.evaluate(() => {
          const video = document.querySelector('video.html5-main-video');
          return video ? video.currentTime : null;
        });

        assert.true(newTime < currentTime, 'Rewind should move video backward');

        // Test advance
        await controlVideo(page, 'advance');
        await sleep(1000);

        const advancedTime = await page.evaluate(() => {
          const video = document.querySelector('video.html5-main-video');
          return video ? video.currentTime : null;
        });

        assert.true(advancedTime > newTime, 'Advance should move video forward');
      }
    });

    await takeScreenshot(page, 'youtube-test-final.png');

    await runTest('Shortcuts and buttons survive real YouTube SPA navigation', async () => {
      const beforeUrl = page.url();
      const token = await page.evaluate(() => {
        window.__stayfastQaDocument = crypto.randomUUID();
        return window.__stayfastQaDocument;
      });
      const nextHandle = await page.evaluateHandle(() =>
        [...document.querySelectorAll('#secondary a[href*="/watch?v="]')].find(
          (link) =>
            link.textContent.trim() &&
            new URL(link.href).searchParams.get('v') !==
              new URL(location.href).searchParams.get('v')
        )
      );
      try {
        const next = nextHandle.asElement();
        assert.exists(next, 'A recommendation link is required for the SPA check');
        await next.click();
      } finally {
        await nextHandle.dispose();
      }
      await page.waitForFunction((previous) => location.href !== previous, {}, beforeUrl);
      assert.equal(
        await page.evaluate(() => window.__stayfastQaDocument),
        token,
        'Recommendation navigation must reuse the document'
      );
      assert.true(
        await waitForVideo(page, 'video.html5-main-video', 20000),
        'The next YouTube video must load'
      );
      await page.waitForFunction(
        () => document.querySelector('video.html5-main-video')?.vsc?.div.isConnected
      );
      const initial = await getVideoSpeed(page, 'video.html5-main-video');
      await page.keyboard.press('d');
      await page.waitForFunction(
        (previous) => document.querySelector('video.html5-main-video').playbackRate > previous,
        {},
        initial
      );
      const faster = await getVideoSpeed(page, 'video.html5-main-video');
      assert.true(
        await controlVideo(page, 'slower'),
        'The next video needs a clickable slower button'
      );
      assert.true(
        (await getVideoSpeed(page, 'video.html5-main-video')) < faster,
        'A pointer click must change the next video speed'
      );
      await takeScreenshot(page, 'youtube-spa-next-video.png');
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    pageErrors?.dispose();
    if (browser) {
      await browser.close();
    }
  }

  console.log(`\n   📊 YouTube E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

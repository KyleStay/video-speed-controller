/**
 * Basic E2E tests for the StayFast Video extension
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
import { runReliabilityChecks } from './reliability-checks.js';
import { startFixtureServer } from './fixture-server.js';

export default async function runBasicE2ETests({ launch = launchChromeWithExtension } = {}) {
  console.log('🎭 Running Basic E2E Tests...\n');

  let browser;
  let passed = 0;
  let failed = 0;
  let pageErrors;
  let fixtures;

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
    pageErrors = monitorPageErrors(page);

    await runTest('Extension should load in Chrome', async () => {
      // Navigate to our test HTML file with video
      const testPagePath = `file://${process.cwd()}/tests/e2e/test-video.html`;
      await page.goto(testPagePath, { waitUntil: 'domcontentloaded' });
      await sleep(3000); // Give extension time to inject

      const extensionLoaded = await waitForExtension(page, 8000);
      assert.true(extensionLoaded, 'Extension should be loaded');
    });

    await runTest('Video element should be detected', async () => {
      const videoReady = await waitForVideo(page, 'video', 10000);
      assert.true(videoReady, 'Video should be ready');
    });

    await runTest('Speed controller should appear on video', async () => {
      const controllerFound = await waitForController(page, 10000);
      assert.true(controllerFound, 'Speed controller should appear');
    });

    await runTest('Initial video speed should be 1.0x', async () => {
      const speed = await getVideoSpeed(page);
      assert.equal(speed, 1, 'Initial speed should be 1.0x');
    });

    await runTest('Controller should display initial speed', async () => {
      const speedDisplay = await getControllerSpeedDisplay(page);
      assert.exists(speedDisplay, 'Speed display should exist');
      // Speed display should show something like "1.00"
      assert.true(speedDisplay.includes('1.'), 'Speed display should show 1.x');
    });

    await runTest('Faster button should increase speed', async () => {
      const initialSpeed = await getVideoSpeed(page);
      const success = await controlVideo(page, 'faster');
      assert.true(success, 'Faster button should work');

      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed > initialSpeed, 'Speed should increase');
    });

    await runTest('Slower button should decrease speed', async () => {
      const initialSpeed = await getVideoSpeed(page);
      const success = await controlVideo(page, 'slower');
      assert.true(success, 'Slower button should work');

      const newSpeed = await getVideoSpeed(page);
      assert.true(newSpeed < initialSpeed, 'Speed should decrease');
    });

    await runTest('Overlay buttons set normal and preferred speeds without toggling', async () => {
      const previous = await page.evaluate(() => {
        const config = window.VSC_controller.config;
        const value = config.getKeyBinding('fast');
        config.setKeyBinding('fast', 2.25);
        return value;
      });
      try {
        for (const [action, expected] of [
          ['preferredSpeed', 2.25],
          ['preferredSpeed', 2.25],
          ['setSpeed', 1],
          ['setSpeed', 1],
        ]) {
          assert.true(await controlVideo(page, action), `${action} should be clickable`);
          assert.equal(await getVideoSpeed(page), expected);
          assert.equal(Number(await getControllerSpeedDisplay(page)), expected);
        }
        await takeScreenshot(page, 'overlay-speed-buttons.png');
      } finally {
        await page.evaluate((value) => {
          window.VSC_controller.config.setKeyBinding('fast', value);
        }, previous);
      }
    });

    await runTest('Reset key should restore normal speed', async () => {
      // First change speed
      await controlVideo(page, 'faster');
      await controlVideo(page, 'faster');

      // Then reset using R key
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(500);

      const speed = await getVideoSpeed(page);
      assert.approximately(speed, 1.0, 0.1, 'Speed should be approximately 1.0 after reset');
    });

    await runTest('Keyboard shortcuts should work', async () => {
      // Reset extension state to clear any stored preferences
      await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
          video.playbackRate = 1.0;
        }

        // Reset the extension's stored reset key binding to default
        if (window.VSC_controller && window.VSC_controller.config) {
          window.VSC_controller.config.setKeyBinding('reset', 1.0);
        }
      });
      await sleep(200);

      // Test 'D' key for faster
      const initialSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Initial speed: ${initialSpeed}`);
      await testKeyboardShortcut(page, 'KeyD');

      const newSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed after D key: ${newSpeed}`);
      assert.true(newSpeed > initialSpeed, 'D key should increase speed');

      // Test 'S' key for slower
      await testKeyboardShortcut(page, 'KeyS');
      const slowerSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed after S key: ${slowerSpeed}`);
      assert.true(slowerSpeed < newSpeed, 'S key should decrease speed');

      // Test 'R' key for reset (should change speed from current)
      const speedBeforeReset = await getVideoSpeed(page);
      await testKeyboardShortcut(page, 'KeyR');
      await sleep(200); // Give time for reset to process
      const resetSpeed = await getVideoSpeed(page);
      console.log(`   🔍 Speed before R key: ${speedBeforeReset}, after R key: ${resetSpeed}`);
      assert.true(
        resetSpeed !== speedBeforeReset,
        `R key should change speed from ${speedBeforeReset}, got ${resetSpeed}`
      );
    });

    // Take a screenshot for verification
    await takeScreenshot(page, 'basic-test-final.png');
    const reliabilityPage = await browser.newPage();
    try {
      await runReliabilityChecks(reliabilityPage, runTest);
    } finally {
      await reliabilityPage.close();
    }
    await runTest('Controller and shortcuts attach under enforced Trusted Types', async () => {
      fixtures = await startFixtureServer({
        htmlRoutes: {
          '/trusted-types.html': '<!doctype html><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'; trusted-types \'none\'"><title>Trusted Types media</title><video muted preload="auto" src="/sample.webm"></video>',
        },
      });
      await page.goto(`${fixtures.baseUrl}/trusted-types.html`, { waitUntil: 'domcontentloaded' });
      const enforced = await page.evaluate(() => {
        try {
          document.createElement('div').innerHTML = '<b>probe</b>';
          return false;
        } catch (error) {
          return error.name === 'TypeError';
        }
      });
      assert.true(enforced, 'The fixture must enforce Trusted Types');
      assert.true(await waitForVideo(page, 'video', 10000), 'Media must become ready');
      assert.true(await waitForController(page, 10000), 'Controller must attach');
      const before = await getVideoSpeed(page);
      await testKeyboardShortcut(page, 'KeyD');
      assert.true((await getVideoSpeed(page)) > before, 'Speed shortcut must reach the media');
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    pageErrors?.dispose();
    try {
      if (browser) {
        await browser.close();
      }
    } finally {
      await fixtures?.stop();
    }
  }

  console.log(`\n   📊 Basic E2E Results: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/** Real built-extension checks with Chrome touch input; not a Safari/iOS runtime test. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const pill = '.draggable';
const control = (action) => `[data-action="${action}"]`;

/** Coordinates are read from the page; interaction goes through native browser input. */
export async function tapShadowControl(page, selector, mediaId = 'mobile-video') {
  const bounds = await page.evaluate(
    (id, query) => {
      const target = document.getElementById(id)?.vsc?.div?.shadowRoot?.querySelector(query);
      if (!target || getComputedStyle(target).display === 'none') {
        return null;
      }
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    mediaId,
    selector
  );
  assert.exists(bounds, `Visible shadow control ${selector} should exist`);
  assert.true(bounds.width >= 44 && bounds.height >= 44, `${selector} needs a 44px touch target`);
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

export default async function runMobileE2ETests({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let fixtures;
  let pageErrors;
  let passed = 0;
  let failed = 0;
  const runTest = async (name, fn) => {
    try {
      pageErrors.assertNone(`before ${name}`);
      await fn();
      pageErrors.assertNone(name);
      console.log(`   ✅ Mobile: ${name}`);
      passed++;
    } catch (error) {
      console.error(`   ❌ Mobile: ${name}: ${error.stack || error.message}`);
      failed++;
    }
  };

  try {
    fixtures = await startFixtureServer();
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    pageErrors = monitorPageErrors(page);
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(`${fixtures.baseUrl}/mobile.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('video')?.vsc?.div?.shadowRoot);
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);

    await runTest('touch pill starts collapsed and opens with a genuine tap', async () => {
      const initial = await page.evaluate(() => {
        const host = document.querySelector('video').vsc.div;
        const shadow = host.shadowRoot;
        return {
          coarse: matchMedia('(pointer: coarse)').matches,
          touch: host.hasAttribute('data-vsc-touch'),
          expanded: shadow.querySelector('.draggable').getAttribute('aria-expanded'),
          controlsDisplay: getComputedStyle(shadow.querySelector('#controls')).display,
        };
      });
      assert.true(initial.coarse && initial.touch, 'Coarse-pointer mode must be active');
      assert.equal(initial.expanded, 'false', 'Pill should expose collapsed state');
      assert.equal(
        initial.controlsDisplay,
        'none',
        'No hover should be required to keep controls closed'
      );
      await tapShadowControl(page, pill);
      await page.waitForFunction(() =>
        document.querySelector('video').vsc.div.classList.contains('vsc-touch-open')
      );
      assert.equal(
        await page.evaluate(() =>
          document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('.draggable')
            .getAttribute('aria-expanded')
        ),
        'true'
      );
    });

    await runTest('presets and speed buttons change real media once per tap', async () => {
      for (const speed of [1, 1.25, 1.5, 2]) {
        await tapShadowControl(page, `${control('setSpeed')}[data-value="${speed}"]`);
        await page.waitForFunction(
          (expected) => document.querySelector('video').playbackRate === expected,
          {},
          speed
        );
        await page.waitForFunction(
          (expected) => {
            const presets = [
              ...document
                .querySelector('video')
                .vsc.div.shadowRoot.querySelectorAll('[data-action="setSpeed"]'),
            ];
            return presets.every(
              (button) =>
                button.getAttribute('aria-pressed') ===
                String(Number(button.dataset.value) === expected)
            );
          },
          {},
          speed
        );
      }
      await tapShadowControl(page, control('faster'));
      await page.waitForFunction(
        () => Math.abs(document.querySelector('video').playbackRate - 2.1) < 0.001
      );
      await tapShadowControl(page, control('slower'));
      await page.waitForFunction(() => document.querySelector('video').playbackRate === 2);
    });

    await runTest(
      'normal and preferred buttons set absolute speeds with genuine taps',
      async () => {
        for (const [selector, expected] of [
          [control('preferredSpeed'), 1.8],
          [control('preferredSpeed'), 1.8],
          [`${control('setSpeed')}[data-value="1"]`, 1],
          [`${control('setSpeed')}[data-value="1"]`, 1],
        ]) {
          await tapShadowControl(page, selector);
          await page.waitForFunction(
            (speed) => document.querySelector('video').playbackRate === speed,
            {},
            expected
          );
        }
        await tapShadowControl(page, `${control('setSpeed')}[data-value="2"]`);
        await page.waitForFunction(() => document.querySelector('video').playbackRate === 2);
      }
    );

    await runTest('expanded controls fit a small phone and retain usable targets', async () => {
      await page.setViewport({
        width: 320,
        height: 700,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const geometry = await page.evaluate(() => {
        const shadow = document.querySelector('video').vsc.div.shadowRoot;
        return [...shadow.querySelectorAll('.draggable, button')]
          .filter(
            (target) =>
              target.getClientRects().length && getComputedStyle(target).display !== 'none'
          )
          .map((target) => {
            const { left, right, width, height } = target.getBoundingClientRect();
            return { action: target.dataset.action, left, right, width, height };
          });
      });
      assert.true(
        geometry.length >= 10,
        'Expanded controls should include actions, presets, and close'
      );
      for (const rect of geometry) {
        assert.true(rect.width >= 44 && rect.height >= 44, `${rect.action} target is too small`);
        assert.true(
          rect.left >= 0 && rect.right <= 320,
          `${rect.action} extends outside the phone viewport`
        );
      }
    });

    await runTest('close collapses even while the last button retains focus', async () => {
      await tapShadowControl(page, control('close'));
      await page.waitForFunction(() => {
        const host = document.querySelector('video').vsc.div;
        return (
          !host.classList.contains('vsc-touch-open') &&
          getComputedStyle(host.shadowRoot.querySelector('#controls')).display === 'none'
        );
      });
      const dragging = await page.evaluate(() =>
        document
          .querySelector('video')
          .vsc.div.shadowRoot.querySelector('#controller')
          .classList.contains('dragging')
      );
      assert.equal(dragging, false, 'Tapping must not start a drag');
      await tapShadowControl(page, pill);
      await page.waitForFunction(() =>
        document.querySelector('video').vsc.div.classList.contains('vsc-touch-open')
      );
    });

    await runTest('touch seek and playback remain functional', async () => {
      await page.evaluate(() => {
        document.querySelector('video').currentTime = 20;
      });
      await tapShadowControl(page, control('advance'));
      await page.waitForFunction(() => document.querySelector('video').currentTime >= 29);
      await tapShadowControl(page, control('rewind'));
      await page.waitForFunction(
        () => Math.abs(document.querySelector('video').currentTime - 20) < 1
      );
      await tapShadowControl(page, control('close'));
      await page.tap('#play');
      await page.waitForFunction(
        () =>
          !document.querySelector('video').paused &&
          document.querySelector('video').currentTime > 20.1
      );
      assert.equal(
        await page.evaluate(() => document.querySelector('video').playbackRate),
        2,
        'Playback should retain selected speed'
      );
    });

    await runTest('rotation preserves controller and selected speed', async () => {
      await page.setViewport({
        width: 844,
        height: 390,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        isLandscape: true,
      });
      await page.waitForFunction(() => document.querySelector('video').vsc?.div?.isConnected);
      await tapShadowControl(page, pill);
      await tapShadowControl(page, `${control('setSpeed')}[data-value="1.5"]`);
      await page.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
      await page.setViewport({
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await page.waitForFunction(() =>
        document.querySelector('#media-status').textContent.startsWith('Playback rate: 1.5;')
      );
      const visualState = await page.evaluate(async () => {
        const shadow = document.querySelector('video').vsc.div.shadowRoot;
        const animations = [...shadow.querySelectorAll('*')].flatMap((element) =>
          element.getAnimations()
        );
        await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return {
          opacity: getComputedStyle(shadow.querySelector('#controller')).opacity,
          panelBackground: getComputedStyle(shadow.querySelector('#controls')).backgroundColor,
          presets: [...shadow.querySelectorAll('[data-action="setSpeed"]')].map((button) => ({
            speed: button.dataset.value,
            pressed: button.getAttribute('aria-pressed'),
          })),
        };
      });
      console.log(`   Settled touch panel: ${JSON.stringify(visualState)}`);
      const outputDirectory = resolve('tests/e2e/screenshots');
      await mkdir(outputDirectory, { recursive: true });
      await page.screenshot({ path: resolve(outputDirectory, 'mobile-controls-expanded.png') });
      console.log(`   Screenshot: ${resolve(outputDirectory, 'mobile-controls-expanded.png')}`);
    });

    await runTest('expanded panel stays inside the visual viewport when zoomed', async () => {
      const session = await page.createCDPSession();
      try {
        // Chrome page-scale emulation exercises visualViewport geometry. This
        // is a layout regression check, not a claim of native iOS pinch input.
        await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
        await page.waitForFunction(() => visualViewport.width < innerWidth / 1.5);
        await page.waitForFunction(() => {
          const panel = document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('#controls');
          const rect = panel.getBoundingClientRect();
          return (
            rect.left >= visualViewport.offsetLeft &&
            rect.right <= visualViewport.offsetLeft + visualViewport.width &&
            rect.top >= visualViewport.offsetTop &&
            rect.bottom <= visualViewport.offsetTop + visualViewport.height
          );
        });
        const geometry = await page.evaluate(() => {
          const panel = document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('#controls');
          return {
            columns: getComputedStyle(panel).gridTemplateColumns.split(' ').length,
            width: panel.getBoundingClientRect().width,
            viewport: visualViewport.width,
          };
        });
        assert.equal(geometry.columns, 2, 'A zoomed narrow viewport should use two columns');
        console.log(`   Zoomed layout: ${JSON.stringify(geometry)}`);
      } finally {
        await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
        await session.detach();
      }
    });

    await runTest(
      'a genuine touch swipe scrolls the page without dragging the controller',
      async () => {
        await tapShadowControl(page, control('close'));
        await page.touchscreen.touchStart(300, 650);
        for (let y = 620; y >= 320; y -= 30) {
          await page.touchscreen.touchMove(300, y);
        }
        await page.touchscreen.touchEnd();
        await page.waitForFunction(() => scrollY > 50);
        const controllerState = await page.evaluate(() => {
          const host = document.querySelector('video').vsc.div;
          return {
            open: host.classList.contains('vsc-touch-open'),
            dragging: host.shadowRoot.querySelector('#controller').classList.contains('dragging'),
          };
        });
        assert.equal(controllerState.open, false, 'Page swipe must not reopen the controller');
        assert.equal(
          controllerState.dragging,
          false,
          'Page swipe must not start a controller drag'
        );
        // Stop touch-scroll momentum before resetting the fixture for the next check.
        await page.touchscreen.tap(300, 650);
        await page.evaluate(() => scrollTo({ left: 0, top: 0, behavior: 'instant' }));
        await page.waitForFunction(() => scrollY === 0);
      }
    );

    await runTest('new feed media attaches while existing media remains controlled', async () => {
      await page.evaluate(() => {
        const container = document.createElement('div');
        container.className = 'player';
        const video = document.createElement('video');
        video.id = 'new-mobile-video';
        video.src = '/sample.webm';
        video.muted = true;
        video.playsInline = true;
        container.append(video);
        document.querySelector('.player').after(container);
      });
      await page.waitForFunction(
        () => document.querySelector('#new-mobile-video')?.vsc?.div?.isConnected
      );
      await tapShadowControl(page, pill, 'new-mobile-video');
      await page.waitForFunction(() =>
        document.querySelector('#new-mobile-video').vsc.div.classList.contains('vsc-touch-open')
      );
      await tapShadowControl(page, `${control('setSpeed')}[data-value="1.25"]`, 'new-mobile-video');
      await page.waitForFunction(
        () => document.querySelector('#new-mobile-video').playbackRate === 1.25
      );
      assert.true(
        await page.evaluate(() => document.querySelector('#mobile-video').vsc.div.isConnected),
        'Original media should remain controlled'
      );
    });

    await runTest('popup and every options tab fit a 320px touch viewport', async () => {
      const target = browser
        .targets()
        .find(
          (entry) =>
            entry.url().startsWith('chrome-extension://') && entry.url().endsWith('/background.js')
        );
      const extensionId = launched.extensionId || (target && new URL(target.url()).hostname);
      assert.exists(extensionId, 'Built extension identity should exist even if its worker sleeps');
      const origin = `chrome-extension://${extensionId}`;
      const extensionPage = await browser.newPage();
      const extensionErrors = monitorPageErrors(extensionPage);
      try {
        await extensionPage.setViewport({
          width: 320,
          height: 700,
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        });
        const defects = new Set();
        const summaries = [];
        const outputDirectory = resolve('tests/e2e/screenshots');
        const assertLayout = async (context) => {
          const layout = await extensionPage.evaluate(() => {
            const targets = [
              ...document.querySelectorAll('button, input:not([type="hidden"]), select, textarea'),
            ]
              .filter(
                (node) =>
                  node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
              )
              .map((node) => {
                const { left, right, width, height } = node.getBoundingClientRect();
                return {
                  id: node.id || node.className,
                  left,
                  right,
                  width,
                  height,
                  font: parseFloat(getComputedStyle(node).fontSize),
                  tag: node.tagName,
                };
              });
            return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, targets };
          });
          if (layout.scroll > layout.viewport) {
            defects.add(`${context}: horizontal overflow ${layout.scroll}/${layout.viewport}`);
          }
          for (const target of layout.targets) {
            if (target.width < 44 || target.height < 44) {
              defects.add(`${context}: ${target.id} target ${target.width}×${target.height}`);
            }
            if (target.left < 0 || target.right > layout.viewport) {
              defects.add(`${context}: ${target.id} bounds ${target.left}..${target.right}`);
            }
            if (target.tag !== 'BUTTON' && target.font < 16) {
              defects.add(`${context}: ${target.id} field font ${target.font}px`);
            }
          }
          summaries.push({
            context,
            targets: layout.targets.length,
            viewport: layout.viewport,
            scroll: layout.scroll,
            minHeight: Math.min(...layout.targets.map((target) => target.height)),
            minFieldFont: Math.min(
              ...layout.targets
                .filter((target) => target.tag !== 'BUTTON')
                .map((target) => target.font)
            ),
          });
          extensionErrors.assertNone(context);
        };
        await extensionPage.goto(`${origin}/ui/popup/popup.html`, { waitUntil: 'load' });
        await assertLayout('popup');
        await extensionPage.screenshot({ path: resolve(outputDirectory, 'mobile-popup.png') });
        await extensionPage.goto(`${origin}/ui/options/options.html`, { waitUntil: 'load' });
        await extensionPage.waitForSelector('#shortcuts-container .row');
        await extensionPage.locator('#add').click();
        await assertLayout('options settings with generated shortcut');
        await extensionPage.screenshot({
          path: resolve(outputDirectory, 'mobile-options-settings.png'),
        });
        await extensionPage.locator('#tab-advanced').click();
        await extensionPage.locator('#add-site-rule').click();
        await extensionPage.evaluate(() => {
          const inputs = document.querySelectorAll('.rulePattern');
          inputs[inputs.length - 1].value =
            'very-long-subdomain.video.example.com/really/long/path';
        });
        await assertLayout('options advanced with generated long site rule');
        await extensionPage.screenshot({ path: resolve(outputDirectory, 'mobile-options.png') });
        for (const name of ['faq', 'about']) {
          await extensionPage.locator(`#tab-${name}`).click();
          await assertLayout(`options ${name}`);
        }
        console.log(`   All mobile extension layouts: ${JSON.stringify(summaries)}`);
        if (defects.size) {
          console.error(`   Aggregated mobile layout defects: ${JSON.stringify([...defects])}`);
        }
        assert.equal(defects.size, 0, `Mobile layout defects: ${[...defects].join('; ')}`);
      } finally {
        extensionErrors.dispose();
        await extensionPage.close();
      }
    });
  } catch (error) {
    failed++;
    console.error(`Mobile test setup failed: ${error.stack || error.message}`);
  } finally {
    pageErrors?.dispose();
    try {
      await browser?.close();
    } finally {
      await fixtures?.stop();
    }
  }
  console.log(
    `Mobile Chrome emulation: ${passed} passed, ${failed} failed (not Safari verification)`
  );
  return { passed, failed };
}

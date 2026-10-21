/** Built Chrome extension with iPhone UA/touch input; actual iOS runs separately. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const iphoneUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function tapPlayer(page, ref, context = page) {
  if (
    await context.evaluate(() =>
      document.querySelector('vsc-ios-player')?.hasAttribute('data-controls-hidden')
    )
  ) {
    await page.touchscreen.tap(20, 260);
  }
  if (
    ref !== 'more' &&
    (await context.evaluate((name) => {
      const shadow = document.querySelector('vsc-ios-player')?.shadowRoot;
      const target = shadow?.querySelector(`[data-ref="${name}"]`);
      return (
        !!target &&
        target.getClientRects().length === 0 &&
        !!shadow.querySelector('[data-ref="extra"]')?.hidden
      );
    }, ref))
  ) {
    await tapPlayer(page, 'more', context);
  }
  await context.waitForFunction(() => {
    const host = document.querySelector('vsc-ios-player');
    const play = host?.shadowRoot?.querySelector('[data-ref="play"]');
    return (
      host &&
      !host.hasAttribute('data-controls-hidden') &&
      play &&
      getComputedStyle(play).visibility !== 'hidden'
    );
  });
  const bounds = await context.evaluate((name) => {
    const target = document
      .querySelector('vsc-ios-player')
      ?.shadowRoot?.querySelector(`[data-ref="${name}"]`);
    if (!target || getComputedStyle(target).visibility === 'hidden') {
      return null;
    }
    const { x, y, width, height } = target.getBoundingClientRect();
    return { x, y, width, height };
  }, ref);
  assert.exists(bounds, `Visible owned control ${ref}`);
  assert.true(bounds.width >= 44 && bounds.height >= 44, `${ref} must have a 44px target`);
  // Child coordinates equal top coordinates once its owned frame is expanded.
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

async function tapInline(page, selector, mediaId = 'mobile-video', context = page) {
  await context.evaluate(
    (id, query) =>
      document
        .getElementById(id)
        ?.vsc?.div?.shadowRoot?.querySelector(query)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    mediaId,
    selector
  );
  await context.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  const bounds = await context.evaluate(
    (id, query) => {
      const target = document.getElementById(id)?.vsc?.div?.shadowRoot?.querySelector(query);
      if (!target || !target.getClientRects().length) {
        return null;
      }
      const { x, y, width, height } = target.getBoundingClientRect();
      return { x, y, width, height };
    },
    mediaId,
    selector
  );
  assert.exists(bounds, `Inline control ${selector}`);
  assert.true(bounds.width >= 44 && bounds.height >= 44, `${selector} must retain a 44px target`);
  const offset =
    context === page ? { x: 0, y: 0 } : await (await context.frameElement()).boundingBox();
  if (context !== page) {
    console.log(
      `   Child inline tap ${selector}: ${JSON.stringify({
        bounds,
        offset,
        childHit: await context.evaluate(({ x, y, width, height }) => {
          const node = document.elementFromPoint(x + width / 2, y + height / 2);
          return { tag: node?.tagName, classes: node?.className };
        }, bounds),
        parentHit: await page.evaluate(
          ({ x, y }) => {
            const node = document.elementFromPoint(x, y);
            return { tag: node?.tagName, id: node?.id };
          },
          { x: offset.x + bounds.x + bounds.width / 2, y: offset.y + bounds.y + bounds.height / 2 }
        ),
      })}`
    );
  }
  await page.touchscreen.tap(
    offset.x + bounds.x + bounds.width / 2,
    offset.y + bounds.y + bounds.height / 2
  );
}

async function openCustom(page, mediaId = 'mobile-video', context = page) {
  if (
    !(await context.evaluate(
      (id) => document.getElementById(id).vsc.div.classList.contains('vsc-touch-open'),
      mediaId
    ))
  ) {
    await tapInline(page, '.draggable', mediaId, context);
  }
  await context.waitForFunction(
    (id) => {
      const host = document.getElementById(id)?.vsc?.div;
      return (
        host?.classList.contains('vsc-touch-open') &&
        host.shadowRoot.querySelector('[aria-label="Open StayFast player"]')?.getClientRects()
          .length
      );
    },
    {},
    mediaId
  );
  await tapInline(page, '[aria-label="Open StayFast player"]', mediaId, context);
  await context.waitForFunction(
    (id) => document.getElementById(id)?.vsc?.iosPlayer?.active,
    {},
    mediaId
  );
}

async function setSpeed(page, value, context = page) {
  await tapPlayer(page, 'speed', context);
  await page.keyboard.press('Home');
  const index = await context.evaluate(
    (speed) =>
      Array.from(
        document.querySelector('vsc-ios-player').shadowRoot.querySelector('[data-ref="speed"]')
          .options
      ).findIndex((option) => Number(option.value) === speed),
    value
  );
  assert.true(index >= 0, `Speed option ${value} must exist`);
  for (let position = 0; position < index; position++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await context.waitForFunction(
    (expected) => document.querySelector('vsc-ios-player video')?.playbackRate === expected,
    {},
    value
  );
}

async function painted(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

async function scrollPosition(page) {
  return page.evaluate(() => {
    const container = document.querySelector('#scroll-container, #parent-scroll');
    return {
      pageX: scrollX,
      pageY: scrollY,
      nestedX: container?.scrollLeft || 0,
      nestedY: container?.scrollTop || 0,
    };
  });
}

async function assertScrollPosition(page, expected, label) {
  await painted(page);
  for (const phase of ['after layout', 'after bounded settling']) {
    if (phase === 'after bounded settling') {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const actual = await scrollPosition(page);
    for (const key of Object.keys(expected)) {
      assert.true(
        Math.abs(actual[key] - expected[key]) <= 1,
        `${label} ${phase}: ${key} expected ${expected[key]}, got ${JSON.stringify(actual)}`
      );
    }
  }
}

async function exitBrowserFullscreen(page) {
  await page.touchscreen.tap(318, 796);
  try {
    await page.waitForFunction(() => !document.fullscreenElement, { timeout: 1500 });
  } catch {
    console.log(
      '   Genuine browser fullscreen entry verified; using exitFullscreen for cleanup after the native exit tap was unavailable.'
    );
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
  }
}

export default async function runIOSPlayer({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let fixtures;
  let errors;
  let passed = 0;
  let failed = 0;
  const check = async (name, work) => {
    try {
      errors.assertNone(`before ${name}`);
      await work();
      errors.assertNone(name);
      passed++;
      console.log(`   ✅ Owned player: ${name}`);
    } catch (error) {
      failed++;
      console.error(`   ❌ Owned player: ${name}: ${error.stack || error.message}`);
    }
  };
  try {
    fixtures = await startFixtureServer({
      htmlRoutes: {
        '/scroll-frame.html': (
          await readFile(resolve('tests/safari-ios/scroll-frame.html'), 'utf8')
        )
          .replace('/mobile.html?mp4&amp;', '/mobile.html?standard-fullscreen&amp;')
          .replace('<iframe', '<iframe allowfullscreen'),
      },
    });
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
    const navigate = async (query = '') => {
      await page.goto(`${fixtures.baseUrl}/mobile.html?owned${query}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () =>
          document.querySelector('video')?.vsc?.iosPlayer?.attached &&
          document.querySelector('video').readyState >= 2
      );
      await page.evaluate(() => {
        window.__ownedOriginal = document.querySelector('video');
        window.__ownedController = window.__ownedOriginal.vsc;
      });
    };
    await navigate();
    await check(
      'normal Play stays inline with compact reachable speed and fullscreen controls',
      async () => {
        await page.tap('#play');
        await page.waitForFunction(
          () => !window.__ownedOriginal.paused && window.__ownedOriginal.currentTime > 0
        );
        const state = await page.evaluate(() => {
          const video = window.__ownedOriginal,
            host = video.vsc.div,
            shadow = host.shadowRoot;
          const media = video.getBoundingClientRect();
          return {
            nativeControls: video.controls,
            owned: document.querySelectorAll('vsc-ios-player').length,
            expanded: host.classList.contains('vsc-touch-open'),
            targets: ['.draggable', '.inline-fullscreen'].map((query) => {
              const { left, top, right, bottom, width, height } = shadow
                .querySelector(query)
                .getBoundingClientRect();
              return {
                left,
                top,
                right,
                bottom,
                width,
                height,
                inside:
                  left >= media.left &&
                  right <= media.right &&
                  top >= media.top &&
                  bottom <= media.bottom,
              };
            }),
          };
        });
        assert.true(state.nativeControls && !state.owned && !state.expanded, JSON.stringify(state));
        for (const target of state.targets) {
          assert.true(
            target.width >= 44 && target.height >= 44 && target.inside,
            JSON.stringify(target)
          );
        }
        await page.screenshot({ path: resolve('tests/e2e/screenshots/ios-inline-compact.png') });
      }
    );
    await check(
      'touch speed controls collapse while playing and stay open while paused',
      async () => {
        await tapInline(page, '.draggable');
        await page.waitForFunction(() =>
          window.__ownedOriginal.vsc.div.classList.contains('vsc-touch-open')
        );
        await page.waitForFunction(
          () => !window.__ownedOriginal.vsc.div.classList.contains('vsc-touch-open'),
          { timeout: 5000 }
        );
        await page.tap('#play');
        await page.evaluate(() => window.__ownedOriginal.pause());
        await tapInline(page, '.draggable');
        await new Promise((resolve) => setTimeout(resolve, 2800));
        assert.true(
          await page.evaluate(() =>
            window.__ownedOriginal.vsc.div.classList.contains('vsc-touch-open')
          )
        );
        await tapInline(page, '[data-action="close"]');
      }
    );
    await check(
      'adopting a playing video with an open panel disposes its original-window timer safely',
      async () => {
        await page.tap('#play');
        await page.waitForFunction(() => !window.__ownedOriginal.paused);
        await tapInline(page, '.draggable');
        await page.waitForFunction(
          () => window.__ownedOriginal.vsc.controlsManager.inlineHideTimer !== null
        );
        await page.evaluate(() => {
          window.__adoptedController = window.__ownedOriginal.vsc;
          window.__adoptedManager = window.__adoptedController.controlsManager;
          window.__adoptedDocument = document.implementation.createHTMLDocument('site replacement');
          window.__adoptedDocument.adoptNode(window.__ownedOriginal);
        });
        await page.waitForFunction(
          () =>
            window.__adoptedController.disposed &&
            window.__adoptedManager.inlineHideTimer === null &&
            window.__adoptedManager.closeTouchControls === null &&
            !window.__ownedOriginal.vsc
        );
        const state = await page.evaluate(() => ({
          inert: window.__ownedOriginal.ownerDocument.defaultView === null,
          timer: window.__adoptedManager.inlineHideTimer,
          listeners: window.__adoptedManager.cleanupHandlers.length,
          disposed: window.__adoptedController.disposed,
        }));
        assert.true(
          state.inert && state.timer === null && state.listeners === 0 && state.disposed,
          JSON.stringify(state)
        );
        await navigate();
      }
    );
    await check(
      'inline controls adapt to clipped and undersize media while the panel escapes clipping',
      async () => {
        const previous = await page.evaluate(() => {
          const parent = document.querySelector('.player');
          const previous = parent.style.cssText;
          parent.style.cssText =
            'position:relative;width:180px;height:102px;overflow:hidden;transform:translateX(12px)';
          return previous;
        });
        try {
          await page.waitForFunction(() => {
            const media = window.__ownedOriginal.getBoundingClientRect();
            const control = window.__ownedOriginal.vsc.div.shadowRoot
              .querySelector('#controller')
              .getBoundingClientRect();
            return (
              control.left >= media.left &&
              control.right <= media.right &&
              control.top >= media.top &&
              control.bottom <= media.bottom
            );
          });
          await page.screenshot({ path: resolve('tests/e2e/screenshots/ios-inline-small.png') });
          await tapInline(page, '.draggable');
          console.log(
            `   Small inline panel: ${JSON.stringify(
              await page.evaluate(() => {
                const media = window.__ownedOriginal.getBoundingClientRect();
                const clip = document.querySelector('.player').getBoundingClientRect();
                const panel = window.__ownedOriginal.vsc.div.shadowRoot
                  .querySelector('#controls')
                  .getBoundingClientRect();
                return { media: media.toJSON(), clip: clip.toJSON(), panel: panel.toJSON() };
              })
            )}`
          );
          await page.waitForFunction(() => {
            const panel = window.__ownedOriginal.vsc.div.shadowRoot.querySelector('#controls');
            const primary = window.__ownedOriginal.vsc.div.shadowRoot
              .querySelector('#controller')
              .getBoundingClientRect();
            const rect = panel.getBoundingClientRect();
            return (
              panel.matches(':popover-open') &&
              Math.abs(rect.top - primary.bottom - 6) < 1 &&
              rect.bottom > document.querySelector('.player').getBoundingClientRect().bottom &&
              rect.left >= 8 &&
              rect.right <= innerWidth - 8 &&
              rect.top >= 8 &&
              rect.bottom <= innerHeight - 8
            );
          });
          const panelGeometry = await page.evaluate(() => {
            const panel = window.__ownedOriginal.vsc.div.shadowRoot.querySelector('#controls');
            return {
              height: panel.getBoundingClientRect().height,
              rows: getComputedStyle(panel).gridTemplateRows,
              buttons: Array.from(panel.querySelectorAll('button'))
                .filter((button) => button.getClientRects().length)
                .map((button) => button.getBoundingClientRect().height),
            };
          });
          assert.true(
            panelGeometry.height < 450 && Math.max(...panelGeometry.buttons) < 70,
            `Compact content-sized panel: ${JSON.stringify(panelGeometry)}`
          );
          const overflow = await page.evaluate(() =>
            Array.from(
              window.__ownedOriginal.vsc.div.shadowRoot.querySelectorAll('#controls button')
            )
              .filter(
                (button) =>
                  button.getClientRects().length && button.scrollWidth > button.clientWidth
              )
              .map((button) => ({
                label: button.getAttribute('aria-label'),
                scroll: button.scrollWidth,
                width: button.clientWidth,
              }))
          );
          assert.equal(overflow.length, 0, `Tiny panel text must fit: ${JSON.stringify(overflow)}`);
          await page.screenshot({
            path: resolve('tests/e2e/screenshots/ios-inline-small-panel.png'),
          });
          await tapInline(page, '[data-action="close"]');
          await page.evaluate(() => {
            document.querySelector('.player').style.width = '80px';
            document.querySelector('.player').style.height = '60px';
            window.__ownedOriginal.style.height = '60px';
          });
          await page.waitForFunction(() =>
            window.__ownedOriginal.vsc.div.hasAttribute('data-vsc-inline-tiny')
          );
          const narrow = await page.evaluate(() => {
            const shadow = window.__ownedOriginal.vsc.div.shadowRoot;
            const rect = shadow.querySelector('.inline-fullscreen').getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              pill: shadow.querySelector('.draggable').getClientRects().length,
            };
          });
          assert.true(
            narrow.width >= 44 && narrow.height >= 44 && !narrow.pill,
            JSON.stringify(narrow)
          );
          await page.evaluate(() => {
            document.querySelector('.player').style.height = '45px';
            window.__ownedOriginal.style.height = '45px';
          });
          await page.waitForFunction(() =>
            window.__ownedOriginal.vsc.div.hasAttribute('data-vsc-inline-unavailable')
          );
          assert.equal(
            await page.evaluate(
              () =>
                window.__ownedOriginal.vsc.div.shadowRoot
                  .querySelector('#controller')
                  .getClientRects().length
            ),
            0,
            'A media box too small for44px targets must hide instead of clipping controls'
          );
          await page.evaluate(() => {
            document.querySelector('.player').style.marginTop = '2000px';
            document.querySelector('.player').style.width = '181px';
            document.querySelector('.player').style.height = '102px';
            window.__ownedOriginal.style.height = '102px';
          });
          await page.waitForFunction(() => {
            const media = window.__ownedOriginal.getBoundingClientRect();
            const control = window.__ownedOriginal.vsc.div.shadowRoot
              .querySelector('#controller')
              .getBoundingClientRect();
            return (
              !window.__ownedOriginal.vsc.div.shadowRoot
                .querySelector('#controller')
                .getClientRects().length ||
              (control.top >= media.top && control.top > innerHeight)
            );
          });
        } finally {
          await page.evaluate((style) => {
            document.querySelector('.player').style.cssText = style;
            window.__ownedOriginal.style.height = '';
          }, previous);
        }
        await page.waitForFunction(
          () => !window.__ownedOriginal.vsc.div.hasAttribute('data-vsc-inline-tiny')
        );
      }
    );
    await check(
      'explicit Custom player opens the same original video in the owned dialog',
      async () => {
        await openCustom(page);
        await page.waitForFunction(
          () =>
            window.__ownedOriginal.vsc.iosPlayer.active &&
            !window.__ownedOriginal.paused &&
            window.__ownedOriginal.currentTime > 0
        );
        const state = await page.evaluate(() => ({
          identity: document.querySelector('vsc-ios-player video') === window.__ownedOriginal,
          controller: window.__ownedOriginal.vsc === window.__ownedController,
          source: window.__ownedOriginal.currentSrc === window.__stayfastOwnedFixture.source,
          native: !!window.__ownedOriginal.webkitDisplayingFullscreen,
          dialog: document.querySelector('vsc-ios-player').shadowRoot.querySelector('dialog').open,
        }));
        assert.true(
          state.identity && state.controller && state.source && state.dialog,
          JSON.stringify(state)
        );
        assert.equal(state.native, false);
      }
    );
    await check(
      'owned speed selection requests16x on the original media and real playback advances',
      async () => {
        await tapPlayer(page, 'play');
        await page.waitForFunction(() => window.__ownedOriginal.paused);
        await setSpeed(page, 16);
        const frames = await page.evaluate(() => {
          window.__ownedOriginal.currentTime = 2;
          return window.__ownedOriginal.getVideoPlaybackQuality().totalVideoFrames;
        });
        await tapPlayer(page, 'play');
        await page.waitForFunction(
          (previous) =>
            window.__ownedOriginal.currentTime > 3 &&
            window.__ownedOriginal.getVideoPlaybackQuality().totalVideoFrames > previous,
          {},
          frames
        );
        await tapPlayer(page, 'play');
        await setSpeed(page, 1);
        await tapPlayer(page, 'play');
      }
    );
    await check(
      'Normal and Preferred speed buttons set absolute rates on repeated genuine taps',
      async () => {
        for (const [ref, expected] of [
          ['preferred', 1.8],
          ['preferred', 1.8],
          ['normal', 1],
          ['normal', 1],
        ]) {
          await tapPlayer(page, ref);
          await page.waitForFunction(
            (speed) => window.__ownedOriginal.playbackRate === speed,
            {},
            expected
          );
          await page.waitForFunction(
            (name) =>
              document
                .querySelector('vsc-ios-player')
                .shadowRoot.querySelector(`[data-ref="${name}"]`)
                .getAttribute('aria-pressed') === 'true',
            {},
            ref
          );
        }
      }
    );
    await check('speed, pause, precise seek, skip and mute use genuine controls', async () => {
      await setSpeed(page, 1.5);
      await tapPlayer(page, 'play');
      await page.waitForFunction(() => window.__ownedOriginal.paused);
      const range = await page.evaluate(() => {
        const { x, y, width, height } = document
          .querySelector('vsc-ios-player')
          .shadowRoot.querySelector('[data-ref="seek"]')
          .getBoundingClientRect();
        return { x, y, width, height };
      });
      await page.touchscreen.tap(range.x + range.width * 0.5, range.y + range.height / 2);
      await page.waitForFunction(
        () => window.__ownedOriginal.currentTime > 25 && window.__ownedOriginal.currentTime < 35
      );
      const start = await page.evaluate(() => window.__ownedOriginal.currentTime);
      await tapPlayer(page, 'back');
      await page.waitForFunction(
        (time) => Math.abs(window.__ownedOriginal.currentTime - (time - 10)) < 1,
        {},
        start
      );
      await tapPlayer(page, 'forward');
      await page.waitForFunction(
        (time) => Math.abs(window.__ownedOriginal.currentTime - time) < 1,
        {},
        start
      );
      const muted = await page.evaluate(() => window.__ownedOriginal.muted);
      await tapPlayer(page, 'mute');
      await page.waitForFunction((before) => window.__ownedOriginal.muted !== before, {}, muted);
    });
    await check(
      'genuine distance-based scrubbing has four precise levels without vertical jumps',
      async () => {
        const session = await page.createCDPSession();
        const send = (type, x, y) =>
          session.send('Input.dispatchTouchEvent', {
            type,
            touchPoints:
              type === 'touchEnd' || type === 'touchCancel'
                ? []
                : [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
          });
        const measured = [];
        try {
          for (const [distance, precision, hint] of [
            [0, 1, 'Scrubbing'],
            [60, 0.5, 'Fine scrubbing · Half speed'],
            [100, 0.25, 'Fine scrubbing · Quarter speed'],
            [150, 0.1, 'Fine scrubbing · Tenth speed'],
          ]) {
            await page.evaluate(() => {
              window.__ownedOriginal.currentTime = 30;
            });
            await page.waitForFunction(
              () =>
                Math.abs(Number(window.__ownedOriginal.vsc.iosPlayer.ui.refs.seek.value) - 30) < 0.1
            );
            const bar = await page.evaluate(() => {
              const range = window.__ownedOriginal.vsc.iosPlayer.ui.refs.seek;
              const { x, y, width, height } = range.getBoundingClientRect();
              return {
                x: x + (width * (30 - Number(range.min))) / (Number(range.max) - Number(range.min)),
                y: y + height / 2,
                width,
                duration: Number(range.max) - Number(range.min),
              };
            });
            await send('touchStart', bar.x, bar.y);
            await send('touchMove', bar.x, bar.y - distance);
            await page.waitForFunction(
              (expected) =>
                window.__ownedOriginal.vsc.iosPlayer.ui.refs.scrubHint.textContent === expected,
              {},
              hint
            );
            assert.true(
              Math.abs((await page.evaluate(() => window.__ownedOriginal.currentTime)) - 30) < 0.15,
              'Changing only distance must not jump the timeline'
            );
            await send('touchMove', bar.x + 35, bar.y - distance);
            const expected = 30 + ((35 * bar.duration) / bar.width) * precision;
            await page.waitForFunction(
              (target) => Math.abs(window.__ownedOriginal.currentTime - target) < 0.3,
              {},
              expected
            );
            const current = await page.evaluate(() => window.__ownedOriginal.currentTime);
            measured.push({
              distance,
              precision,
              expectedDelta: expected - 30,
              actualDelta: current - 30,
            });
            await send('touchEnd');
            assert.equal(
              await page.evaluate(() => window.__ownedOriginal.paused),
              true,
              'A paused gesture must stay paused'
            );
          }
        } finally {
          await send('touchCancel').catch(() => {});
          await session.detach();
        }
        console.log(`   Scrub precision measurements: ${JSON.stringify(measured)}`);
      }
    );
    await check('genuine touch cancellation restores scrub position and paused state', async () => {
      await page.evaluate(() => {
        window.__ownedOriginal.currentTime = 30;
      });
      await page.waitForFunction(
        () => Math.abs(Number(window.__ownedOriginal.vsc.iosPlayer.ui.refs.seek.value) - 30) < 0.1
      );
      const bar = await page.evaluate(() => {
        const range = window.__ownedOriginal.vsc.iosPlayer.ui.refs.seek;
        const { x, y, width, height } = range.getBoundingClientRect();
        return {
          x: x + (width * (30 - Number(range.min))) / (Number(range.max) - Number(range.min)),
          y: y + height / 2,
        };
      });
      const session = await page.createCDPSession();
      try {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: bar.x, y: bar.y, id: 1 }],
        });
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: bar.x + 35, y: bar.y, id: 1 }],
        });
        await page.waitForFunction(() => window.__ownedOriginal.currentTime > 31);
        await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.waitForFunction(
          () =>
            Math.abs(window.__ownedOriginal.currentTime - 30) < 0.15 &&
            window.__ownedOriginal.paused
        );
      } finally {
        await session
          .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
          .catch(() => {});
        await session.detach();
      }
    });
    await check('More options, fit/fill and remaining time work with genuine taps', async () => {
      await tapPlayer(page, 'more');
      await page.waitForFunction(
        () =>
          window.__ownedOriginal.vsc.iosPlayer.ui.refs.more.getAttribute('aria-expanded') ===
            'true' && !window.__ownedOriginal.vsc.iosPlayer.ui.refs.extra.hidden
      );
      await page.screenshot({ path: resolve('tests/e2e/screenshots/ios-owned-more-portrait.png') });
      await tapPlayer(page, 'more');
      await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.ui.refs.extra.hidden);
      await tapPlayer(page, 'duration');
      await page.waitForFunction(
        () =>
          window.__ownedOriginal.vsc.iosPlayer.remaining &&
          window.__ownedOriginal.vsc.iosPlayer.ui.refs.duration.textContent.startsWith('−') &&
          window.__ownedOriginal.vsc.iosPlayer.ui.refs.duration.getAttribute('aria-label') ===
            'Show total duration'
      );
      await tapPlayer(page, 'duration');
      await page.waitForFunction(() => !window.__ownedOriginal.vsc.iosPlayer.remaining);
      for (const fit of ['cover', 'contain']) {
        await tapPlayer(page, 'fit');
        await page.waitForFunction(
          (expected) =>
            window.__ownedOriginal.vsc.iosPlayer.fit === expected &&
            getComputedStyle(window.__ownedOriginal).objectFit === expected,
          {},
          fit
        );
      }
      await page.setViewport({
        width: 844,
        height: 390,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await page.waitForFunction(
        () =>
          Math.abs(
            window.__ownedOriginal.vsc.iosPlayer.ui.dialog.getBoundingClientRect().height - 390
          ) < 1
      );
      await tapPlayer(page, 'more');
      await page.screenshot({
        path: resolve('tests/e2e/screenshots/ios-owned-more-landscape.png'),
      });
      const geometry = await page.evaluate(() =>
        Array.from(
          document
            .querySelector('vsc-ios-player')
            .shadowRoot.querySelectorAll('button, select, input')
        )
          .filter(
            (target) =>
              target.getClientRects().length && getComputedStyle(target).visibility !== 'hidden'
          )
          .map((target) => {
            const { left, top, right, bottom, width, height } = target.getBoundingClientRect();
            return { ref: target.dataset.ref, left, top, right, bottom, width, height };
          })
      );
      for (const rect of geometry) {
        assert.true(
          rect.width >= 44 && rect.height >= 44,
          `${rect.ref} must retain a 44px landscape target`
        );
        assert.true(
          rect.left >= 0 && rect.right <= 844 && rect.top >= 0 && rect.bottom <= 390,
          `${rect.ref} must fit the landscape viewport: ${JSON.stringify(rect)}`
        );
      }
      await tapPlayer(page, 'more');
      await page.setViewport({
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
    });
    await check(
      'genuine two-finger pinches switch fit/fill without playback or HUD side effects',
      async () => {
        await page.evaluate(() => window.__ownedOriginal.vsc.iosPlayer.setFit('contain'));
        const before = await page.evaluate(() => ({
          time: window.__ownedOriginal.currentTime,
          paused: window.__ownedOriginal.paused,
        }));
        const session = await page.createCDPSession();
        const points = (left, right) => [
          { x: left, y: 300, id: 1 },
          { x: right, y: 300, id: 2 },
        ];
        try {
          for (const [startLeft, startRight, endLeft, endRight, expected] of [
            [145, 245, 125, 265, 'cover'],
            [125, 265, 145, 245, 'contain'],
          ]) {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [points(startLeft, startRight)[0]],
            });
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: points(startLeft, startRight),
            });
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: points(endLeft, endRight),
            });
            await page.waitForFunction(
              (fit) =>
                window.__ownedOriginal.vsc.iosPlayer.fit === fit &&
                getComputedStyle(window.__ownedOriginal).objectFit === fit,
              {},
              expected
            );
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          }
        } finally {
          await session
            .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
            .catch(() => {});
          await session.detach();
        }
        const after = await page.evaluate(() => ({
          time: window.__ownedOriginal.currentTime,
          paused: window.__ownedOriginal.paused,
          hidden: document.querySelector('vsc-ios-player').hasAttribute('data-controls-hidden'),
        }));
        assert.equal(after.paused, before.paused, 'Pinching must preserve playback state');
        assert.true(Math.abs(after.time - before.time) < 0.15, 'Pinching must never seek');
        assert.equal(
          after.hidden,
          false,
          'A compatibility click after pinch must not hide controls'
        );
      }
    );
    await check('owned stage touch does not reach site media touchend handlers', async () => {
      await page.evaluate(() => {
        window.__siteTouchCount = 0;
        window.__siteTouchHandler = () => {
          window.__siteTouchCount++;
          window.__ownedOriginal.play().catch(() => {});
        };
        window.__ownedOriginal.addEventListener('touchend', window.__siteTouchHandler);
      });
      try {
        const point = await page.evaluate(() => {
          const { left, top, width, height } = window.__ownedOriginal.getBoundingClientRect();
          return { x: left + width * 0.1, y: top + height * 0.3 };
        });
        await page.touchscreen.tap(point.x, point.y);
        const state = await page.evaluate(() => ({
          siteTouchEnd: window.__siteTouchCount,
          paused: window.__ownedOriginal.paused,
          hidden: document.querySelector('vsc-ios-player').hasAttribute('data-controls-hidden'),
        }));
        console.log(`   Controlled site touch probe: ${JSON.stringify(state)}`);
        assert.equal(
          state.siteTouchEnd,
          0,
          'Owned stage touch must not invoke the site video touchend handler'
        );
        assert.equal(
          state.paused,
          true,
          'Stage tap must not change playback through site handlers'
        );
        assert.equal(state.hidden, true, 'Genuine stage tap must still toggle the owned HUD');
      } finally {
        await page.evaluate(() => {
          window.__ownedOriginal.removeEventListener('touchend', window.__siteTouchHandler);
          window.__ownedOriginal.pause();
        });
      }
    });
    await check('playing HUD hides and a genuine stage tap reveals it', async () => {
      await tapPlayer(page, 'play');
      await page.touchscreen.tap(20, 260);
      await page.waitForFunction(
        () => document.querySelector('vsc-ios-player').hasAttribute('data-controls-hidden'),
        { timeout: 7000 }
      );
      await page.touchscreen.tap(20, 260);
      await page.waitForFunction(
        () => !document.querySelector('vsc-ios-player').hasAttribute('data-controls-hidden')
      );
      await tapPlayer(page, 'play');
      await page.waitForFunction(() => window.__ownedOriginal.paused);
      await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
      await page.screenshot({ path: resolve('tests/e2e/screenshots/ios-owned-player.png') });
    });
    await check(
      'Done restores original identity, location and controller; tapping reopens',
      async () => {
        await tapPlayer(page, 'done');
        await page.waitForFunction(() => !document.querySelector('vsc-ios-player'));
        assert.true(
          await page.evaluate(
            () =>
              window.__ownedOriginal.parentNode === window.__stayfastOwnedFixture.parent &&
              window.__ownedOriginal.vsc === window.__ownedController
          )
        );
        await openCustom(page);
        await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.active);
      }
    );
    await check(
      'direct fullscreen invokes the saved native API without opening custom playback',
      async () => {
        await tapPlayer(page, 'done');
        const before = await page.evaluate(
          () => window.__stayfastOwnedFixture.nativeFullscreenCalls
        );
        await tapInline(page, '.inline-fullscreen');
        await page.waitForFunction(
          (count) => window.__stayfastOwnedFixture.nativeFullscreenCalls === count + 1,
          {},
          before
        );
        assert.equal(
          await page.evaluate(() => document.querySelectorAll('vsc-ios-player').length),
          0
        );
        await openCustom(page);
      }
    );
    await check('second video controls are scoped and removal restores ownership', async () => {
      await tapPlayer(page, 'done');
      await page.evaluate(() => {
        window.__ownedOriginal.pause();
        const container = document.createElement('div');
        container.id = 'second-player';
        const video = document.createElement('video');
        video.id = 'second-video';
        video.src = '/sample.webm';
        video.muted = true;
        video.controls = true;
        video.playsInline = true;
        video.style.cssText = 'width:320px;height:180px';
        container.append(video);
        document.body.prepend(container);
      });
      await page.waitForFunction(
        () =>
          document.querySelector('#second-video')?.vsc?.iosPlayer?.attached &&
          document.querySelector('#second-video').readyState >= 2
      );
      const firstRate = await page.evaluate(() => window.__ownedOriginal.playbackRate);
      await openCustom(page, 'second-video');
      await page.waitForFunction(
        () => document.querySelector('#second-video').vsc.iosPlayer.active
      );
      await setSpeed(page, 2);
      assert.equal(await page.evaluate(() => window.__ownedOriginal.playbackRate), firstRate);
      await page.evaluate(() => {
        window.__removedVideo = document.querySelector('#second-video');
        document.querySelector('#second-player').remove();
      });
      await page.waitForFunction(
        () =>
          !document.querySelector('vsc-ios-player') &&
          !window.__removedVideo.isConnected &&
          !window.__removedVideo.vsc
      );
    });
    await check(
      'Use site player and teardown restore native controls without replacing media',
      async () => {
        await openCustom(page);
        await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.active);
        await tapPlayer(page, 'site');
        await page.waitForFunction(
          () => !document.querySelector('vsc-ios-player') && window.__ownedOriginal.controls
        );
        await navigate();
        await openCustom(page);
        await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.active);
        await page.evaluate(() => window.VSC_controller.teardown());
        await page.waitForFunction(
          () =>
            !document.querySelector('vsc-ios-player') &&
            window.__ownedOriginal.isConnected &&
            window.__ownedOriginal.controls &&
            !window.__ownedOriginal.vsc
        );
      }
    );
    await check(
      'site removal of the active original video never resurrects detached media',
      async () => {
        await navigate();
        await openCustom(page);
        await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.active);
        await page.evaluate(() => window.__ownedOriginal.remove());
        await page.waitForFunction(
          () =>
            !document.querySelector('vsc-ios-player') &&
            !window.__ownedOriginal.isConnected &&
            !window.__ownedOriginal.vsc
        );
        await page.evaluate(() => window.VSC_controller.rescanForMediaSync());
        const state = await page.evaluate(() => ({
          connected: window.__ownedOriginal.isConnected,
          registered: !!window.__ownedOriginal.vsc,
          hosts: document.querySelectorAll('vsc-ios-player').length,
          videos: document.querySelectorAll('video').length,
          disposed: window.__ownedController.disposed,
        }));
        assert.true(
          !state.connected &&
            !state.registered &&
            state.hosts === 0 &&
            state.videos === 0 &&
            state.disposed,
          JSON.stringify(state)
        );
      }
    );
    await check(
      'connected site reparenting preserves the new parent and prevents automatic takeover',
      async () => {
        await navigate();
        await openCustom(page);
        await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.active);
        await page.evaluate(() => {
          const target = document.createElement('section');
          target.id = 'site-new-player';
          document.body.prepend(target);
          target.append(window.__ownedOriginal);
        });
        await page.waitForFunction(
          () =>
            !document.querySelector('vsc-ios-player') &&
            window.__ownedOriginal.parentNode === document.querySelector('#site-new-player') &&
            window.__ownedOriginal.controls
        );
        await page.evaluate(() => {
          window.VSC_controller.rescanForMediaSync();
          window.__ownedOriginal.pause();
        });
        const resumedAt = await page.evaluate(() => window.__ownedOriginal.currentTime);
        await page.tap('#play');
        await page.waitForFunction(
          (time) =>
            !window.__ownedOriginal.paused && window.__ownedOriginal.currentTime > time + 0.05,
          {},
          resumedAt
        );
        const state = await page.evaluate(() => ({
          parent: window.__ownedOriginal.parentNode.id,
          hosts: document.querySelectorAll('vsc-ios-player').length,
          native: window.__ownedOriginal.controls,
          source: window.__ownedOriginal.currentSrc === window.__stayfastOwnedFixture.source,
          active: !!window.__ownedOriginal.vsc?.iosPlayer?.active,
          controller: window.__ownedOriginal.vsc === window.__ownedController,
        }));
        assert.true(
          state.parent === 'site-new-player' &&
            state.hosts === 0 &&
            state.native &&
            state.source &&
            !state.active &&
            state.controller,
          JSON.stringify(state)
        );
      }
    );
    await check(
      'same-origin child expands without reloading or adopting its video and restores CSS',
      async () => {
        await navigate();
        await page.evaluate(() => {
          const container = document.createElement('div');
          container.id = 'embed-parent';
          container.style.cssText =
            'transform:translateX(1px);overflow:hidden;width:320px;height:220px';
          const frame = document.createElement('iframe');
          frame.id = 'owned-frame';
          frame.src = '/mobile.html?owned&child';
          frame.style.cssText =
            'width:320px;height:220px;margin:3px;border:2px solid red;border-radius:4px';
          container.append(frame);
          document.body.prepend(container);
          window.__frameIdentity = frame;
          window.__frameStyle = JSON.stringify(
            Array.from(frame.style)
              .sort()
              .map((name) => [
                name,
                frame.style.getPropertyValue(name),
                frame.style.getPropertyPriority(name),
              ])
          );
          window.__parentStyle = container.style.cssText;
        });
        await page.waitForFunction(
          () =>
            document.querySelector('#owned-frame').contentDocument?.querySelector('video')?.vsc
              ?.iosPlayer?.attached
        );
        const frame = page.frames().find((candidate) => candidate.url().includes('&child'));
        assert.exists(frame);
        await frame.evaluate(() => {
          window.__originalVideo = document.querySelector('video');
          window.__documentIdentity = document;
        });
        await openCustom(page, 'mobile-video', frame);
        await page.waitForFunction(
          () => document.querySelector('#owned-frame').style.position === 'fixed'
        );
        assert.true(
          await page.evaluate(() => {
            const frame = document.querySelector('#owned-frame');
            return (
              frame === window.__frameIdentity &&
              frame.contentDocument === frame.contentWindow.__documentIdentity &&
              frame.contentDocument.querySelector('video') ===
                frame.contentWindow.__originalVideo &&
              frame.contentWindow.__originalVideo.ownerDocument === frame.contentDocument
            );
          })
        );
        await tapPlayer(page, 'done', frame);
        await page.waitForFunction(
          () => document.querySelector('#owned-frame').style.position !== 'fixed'
        );
        const restored = await page.evaluate(() => ({
          frame: JSON.stringify(
            Array.from(document.querySelector('#owned-frame').style)
              .sort()
              .map((name) => [
                name,
                document.querySelector('#owned-frame').style.getPropertyValue(name),
                document.querySelector('#owned-frame').style.getPropertyPriority(name),
              ])
          ),
          before: window.__frameStyle,
          parent: document.querySelector('#embed-parent').style.cssText,
          parentBefore: window.__parentStyle,
        }));
        assert.equal(
          restored.frame,
          restored.before,
          `All iframe styles must restore exactly: ${JSON.stringify(restored)}`
        );
        assert.equal(
          restored.parent,
          restored.parentBefore,
          'Ancestor styles must restore exactly'
        );
      }
    );
    await check(
      'direct entry uses actual browser video fullscreen without an owned intermediate',
      async () => {
        await navigate('&standard-fullscreen');
        await tapInline(page, '.inline-fullscreen');
        await page.waitForFunction(() => document.fullscreenElement === window.__ownedOriginal);
        assert.equal(
          await page.evaluate(() => document.querySelectorAll('vsc-ios-player').length),
          0
        );
        await page.screenshot({ path: resolve('tests/e2e/screenshots/ios-direct-fullscreen.png') });
        // Observed native Chrome fullscreen-exit control in the390x844 viewport.
        await page.touchscreen.tap(318, 796);
        try {
          await page.waitForFunction(() => !document.fullscreenElement, { timeout: 1500 });
        } catch {
          console.log(
            '   Chrome native fullscreen entry verified; using exitFullscreen solely for cleanup after the native exit tap was unavailable.'
          );
          await page.evaluate(() => document.exitFullscreen());
          await page.waitForFunction(() => !document.fullscreenElement);
        }
        assert.true(
          await page.evaluate(
            () =>
              window.__ownedOriginal.controls &&
              window.__ownedOriginal.parentNode === window.__stayfastOwnedFixture.parent &&
              !window.__ownedOriginal.vsc.iosPlayer.active
          )
        );
      }
    );
    const prepareScrolledFixture = async (mode, extra = '') => {
      await navigate(`&scroll=${mode}${extra}`);
      // Browser input creates the scroll; DOM evaluation only reads fixture state.
      await page.mouse.move(375, 740);
      await page.mouse.wheel({ deltaY: 720 });
      await page.waitForFunction(() => scrollY > 600);
      await painted(page);
      if (mode === 'nested') {
        const bounds = await page.$eval('#scroll-container', (node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        });
        await page.mouse.move(bounds.x + bounds.width - 15, bounds.y + bounds.height / 2);
        await page.mouse.wheel({ deltaY: 220, deltaX: 70 });
        await page.waitForFunction(() => {
          const node = document.querySelector('#scroll-container');
          return node.scrollTop > 150 && node.scrollLeft > 30;
        });
        await painted(page);
      }
    };
    for (const mode of ['page', 'nested']) {
      await check(
        `${mode} scroll remains fixed across genuine Custom player entry and Done`,
        async () => {
          await prepareScrolledFixture(mode);
          await tapInline(page, '.draggable');
          const before = await scrollPosition(page);
          assert.true(before.pageY > 300, JSON.stringify(before));
          if (mode === 'nested') {
            assert.true(before.nestedX > 30 && before.nestedY > 100, JSON.stringify(before));
          }
          await tapInline(page, '[aria-label="Open StayFast player"]');
          await page.waitForFunction(() => window.__ownedOriginal.vsc.iosPlayer.active);
          await assertScrollPosition(page, before, `${mode} custom entry`);
          if (!(await page.evaluate(() => window.__ownedOriginal.paused))) {
            await tapPlayer(page, 'play');
            await page.waitForFunction(() => window.__ownedOriginal.paused);
          }
          await tapPlayer(page, 'done');
          await page.waitForFunction(() => !document.querySelector('vsc-ios-player'));
          await assertScrollPosition(page, before, `${mode} Done`);
          assert.true(
            await page.evaluate(
              () => window.__ownedOriginal.parentNode === window.__stayfastOwnedFixture.parent
            ),
            'Scroll preservation must retain the original media location'
          );
        }
      );
      await check(
        `${mode} scroll survives genuine direct browser fullscreen and return`,
        async () => {
          await prepareScrolledFixture(mode, '&standard-fullscreen');
          // Let controller geometry settle before capturing the transaction's baseline.
          await painted(page);
          const before = await scrollPosition(page);
          await tapInline(page, '.inline-fullscreen');
          await page.waitForFunction(() => document.fullscreenElement === window.__ownedOriginal);
          assert.equal(
            await page.evaluate(() => document.querySelectorAll('vsc-ios-player').length),
            0
          );
          await exitBrowserFullscreen(page);
          await assertScrollPosition(page, before, `${mode} direct fullscreen return`);
        }
      );
    }
    await check(
      'same-origin frame Done and Custom-to-native return preserve both documents and nested scroll positions',
      async () => {
        await page.goto(`${fixtures.baseUrl}/scroll-frame.html`, { waitUntil: 'domcontentloaded' });
        const frame = page.frames().find((candidate) => candidate.url().includes('scroll=nested'));
        assert.exists(frame, 'The nested video frame must load');
        await frame.waitForFunction(
          () =>
            document.querySelector('video')?.vsc?.iosPlayer?.attached &&
            document.querySelector('video').readyState >= 2
        );
        await page.tap('#prepare-parent');
        const frameBounds = await (await frame.frameElement()).boundingBox();
        const prepare = await frame.evaluate(() => {
          const button = Array.from(document.querySelectorAll('button')).find(
            (node) => node.textContent === 'Prepare scroll baseline'
          );
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x, y, width, height };
        });
        await page.touchscreen.tap(
          frameBounds.x + prepare.x + prepare.width / 2,
          frameBounds.y + prepare.y + prepare.height / 2
        );
        await frame.waitForFunction(() => window.__stayfastScrollBaseline?.nestedY > 100);
        await tapInline(page, '.draggable', 'mobile-video', frame);
        const customRect = await frame.evaluate(() =>
          document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('[aria-label="Open StayFast player"]')
            .getBoundingClientRect()
            .toJSON()
        );
        const iframeRect = await (await frame.frameElement()).boundingBox();
        console.log(
          `   Frame setup parent clipping: ${JSON.stringify(
            await page.evaluate(
              ({ x, y }) => {
                const node = document.elementFromPoint(x, y);
                const scroll = document.querySelector('#parent-scroll');
                const style = getComputedStyle(node);
                return {
                  hit: {
                    tag: node.tagName,
                    id: node.id,
                    classes: node.className,
                    rect: node.getBoundingClientRect().toJSON(),
                    overflow: style.overflow,
                    position: style.position,
                  },
                  scrollport: scroll.getBoundingClientRect().toJSON(),
                  overflow: getComputedStyle(scroll).overflow,
                  scrollTop: scroll.scrollTop,
                };
              },
              {
                x: iframeRect.x + customRect.x + customRect.width / 2,
                y: iframeRect.y + customRect.y + customRect.height / 2,
              }
            )
          )}`
        );
        await page.screenshot({
          path: resolve('tests/e2e/screenshots/ios-frame-inline-clipped-setup.png'),
        });
        // The 650px child viewport extends beyond this fixture's 500px parent scrollport.
        // Expose the secondary button before checkpointing; child popovers stay frame-local.
        await page.$eval('#parent-scroll', (node) => {
          node.scrollTop += 180;
        });
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        );
        const parentBefore = await scrollPosition(page);
        const childBefore = await scrollPosition(frame);
        await frame.evaluate(() => {
          window.__scrollOriginal = document.querySelector('video');
        });
        await tapInline(page, '[aria-label="Open StayFast player"]', 'mobile-video', frame);
        await frame.waitForFunction(() => document.querySelector('video').vsc.iosPlayer.active);
        await page.waitForFunction(
          () => document.querySelector('iframe').style.position === 'fixed'
        );
        if (!(await frame.evaluate(() => document.querySelector('video').paused))) {
          await tapPlayer(page, 'play', frame);
          await frame.waitForFunction(() => document.querySelector('video').paused);
        }
        await tapPlayer(page, 'done', frame);
        await page.waitForFunction(
          () => document.querySelector('iframe').style.position !== 'fixed'
        );
        await assertScrollPosition(page, parentBefore, 'parent frame release');
        await assertScrollPosition(frame, childBefore, 'child frame release');
        assert.true(
          await frame.evaluate(() => document.querySelector('video') === window.__scrollOriginal),
          'Frame release must preserve original video identity'
        );
        await openCustom(page, 'mobile-video', frame);
        await page.waitForFunction(
          () => document.querySelector('iframe').style.position === 'fixed'
        );
        if (!(await frame.evaluate(() => document.querySelector('video').paused))) {
          await tapPlayer(page, 'play', frame);
          await frame.waitForFunction(() => document.querySelector('video').paused);
        }
        try {
          console.log(
            `   Active frame before native: ${JSON.stringify({ parent: await scrollPosition(page), child: await scrollPosition(frame), parentOverflow: await page.$eval('#parent-scroll', (node) => getComputedStyle(node).overflow) })}`
          );
          await tapPlayer(page, 'fullscreen', frame);
          await frame.waitForFunction(() => document.fullscreenElement === window.__scrollOriginal);
          await page.waitForFunction(
            () => document.querySelector('iframe').style.position !== 'fixed'
          );
          assert.equal(
            await frame.evaluate(() => document.querySelectorAll('vsc-ios-player').length),
            0
          );
          await exitBrowserFullscreen(page);
          const after = { parent: await scrollPosition(page), child: await scrollPosition(frame) };
          console.log(
            `   Frame Custom-to-native scroll: ${JSON.stringify({ parentBefore, childBefore, after })}`
          );
          await assertScrollPosition(
            page,
            parentBefore,
            'parent Custom-to-native fullscreen return'
          );
          await assertScrollPosition(
            frame,
            childBefore,
            'child Custom-to-native fullscreen return'
          );
          await page.screenshot({
            path: resolve('tests/e2e/screenshots/ios-frame-native-scroll-return.png'),
          });
        } catch (error) {
          await page.screenshot({
            path: resolve('tests/e2e/screenshots/ios-frame-native-scroll-failed.png'),
          });
          throw error;
        }
      }
    );
    await check(
      'Done preserves a newer explicit page scroll and never replays a stale entry offset',
      async () => {
        await prepareScrolledFixture('page');
        await openCustom(page);
        if (!(await page.evaluate(() => window.__ownedOriginal.paused))) {
          await tapPlayer(page, 'play');
          await page.waitForFunction(() => window.__ownedOriginal.paused);
        }
        const before = await scrollPosition(page);
        // A site's explicit navigation/scroll while its background is locked is intentional.
        await page.evaluate(() => scrollTo({ top: scrollY + 123, behavior: 'instant' }));
        await page.waitForFunction((previous) => scrollY > previous + 100, {}, before.pageY);
        const newer = await scrollPosition(page);
        await tapPlayer(page, 'done');
        await page.waitForFunction(() => !document.querySelector('vsc-ios-player'));
        await assertScrollPosition(page, newer, 'newer site scroll on Done');
        await page.mouse.move(375, 740);
        await page.mouse.wheel({ deltaY: 180 });
        await page.waitForFunction((previous) => scrollY > previous + 50, {}, newer.pageY);
        await painted(page);
        const userScroll = await scrollPosition(page);
        await assertScrollPosition(page, userScroll, 'user scroll after Done');
      }
    );
    const inlineState = () =>
      page.evaluate(() => {
        const video = window.__ownedOriginal;
        return {
          standard: video.getAttribute('playsinline'),
          prefixed: video.getAttribute('webkit-playsinline'),
          property: video.playsInline,
          controls: video.controls,
          native:
            !!document.fullscreenElement ||
            video.webkitDisplayingFullscreen === true ||
            video.webkitPresentationMode === 'fullscreen',
          owned: !!video.vsc?.iosPlayer?.active || !!document.querySelector('vsc-ios-player'),
        };
      });
    const assertPlayingInline = async (label) => {
      await page.waitForFunction(
        () => !window.__ownedOriginal.paused && window.__ownedOriginal.currentTime > 0
      );
      const state = await inlineState();
      assert.true(
        state.standard !== null && state.prefixed !== null && state.property,
        `${label}: ${JSON.stringify(state)}`
      );
      assert.true(
        state.controls && !state.native && !state.owned,
        `${label}: ${JSON.stringify(state)}`
      );
    };
    await check(
      'normal Play on media authored without inline flags stays inline with both flags ensured',
      async () => {
        await navigate('&no-playsinline');
        assert.equal(
          await page.evaluate(() => JSON.stringify(window.__stayfastInlineOriginal)),
          '[null,null]',
          'Fixture must omit both flags before media creation'
        );
        await page.tap('#play');
        await assertPlayingInline('normal missing-attribute playback');
        await page.screenshot({
          path: resolve('tests/e2e/screenshots/ios-missing-inline-play.png'),
        });
      }
    );
    await check(
      'missing-inline media enters explicit fullscreen and returns inline after native and custom exits',
      async () => {
        await navigate('&no-playsinline&standard-fullscreen');
        await tapInline(page, '.inline-fullscreen');
        await page.waitForFunction(() => document.fullscreenElement === window.__ownedOriginal);
        assert.equal(
          await page.evaluate(() => document.querySelectorAll('vsc-ios-player').length),
          0
        );
        await exitBrowserFullscreen(page);
        await page.tap('#play');
        await assertPlayingInline('native fullscreen return');
        await openCustom(page);
        if (!(await page.evaluate(() => window.__ownedOriginal.paused))) {
          await tapPlayer(page, 'play');
          await page.waitForFunction(() => window.__ownedOriginal.paused);
        }
        await tapPlayer(page, 'done');
        await page.waitForFunction(() => !document.querySelector('vsc-ios-player'));
        await page.tap('#play');
        await assertPlayingInline('Custom player Done return');
      }
    );
    await check(
      'teardown restores both originally missing inline flags without changing native controls or API',
      async () => {
        await navigate('&no-playsinline');
        await page.evaluate(() => {
          window.__inlineNativeMethod = window.__ownedOriginal.webkitEnterFullscreen;
        });
        await page.tap('#play');
        await assertPlayingInline('before teardown');
        await page.evaluate(() => window.VSC_controller.teardown());
        await page.waitForFunction(() => !window.__ownedOriginal.vsc);
        const state = await inlineState();
        assert.equal(state.standard, null, JSON.stringify(state));
        assert.equal(state.prefixed, null, JSON.stringify(state));
        assert.true(state.controls && !state.owned, JSON.stringify(state));
        assert.true(
          await page.evaluate(
            () => window.__ownedOriginal.webkitEnterFullscreen === window.__inlineNativeMethod
          ),
          'Native fullscreen API must retain its original identity'
        );
      }
    );
    await check(
      'site-authored and later-changed inline attribute values survive custom return and teardown',
      async () => {
        await navigate('&site-inline');
        let state = await inlineState();
        assert.equal(state.standard, 'site-standard');
        assert.equal(state.prefixed, 'site-webkit');
        await openCustom(page);
        if (!(await page.evaluate(() => window.__ownedOriginal.paused))) {
          await tapPlayer(page, 'play');
          await page.waitForFunction(() => window.__ownedOriginal.paused);
        }
        await tapPlayer(page, 'done');
        await page.waitForFunction(() => !document.querySelector('vsc-ios-player'));
        state = await inlineState();
        assert.equal(state.standard, 'site-standard', JSON.stringify(state));
        assert.equal(state.prefixed, 'site-webkit', JSON.stringify(state));
        await page.evaluate(() => {
          window.__ownedOriginal.setAttribute('playsinline', 'site-new-standard');
          window.__ownedOriginal.setAttribute('webkit-playsinline', 'site-new-webkit');
        });
        await painted(page);
        await page.evaluate(() => window.VSC_controller.teardown());
        await page.waitForFunction(() => !window.__ownedOriginal.vsc);
        state = await inlineState();
        assert.equal(state.standard, 'site-new-standard', JSON.stringify(state));
        assert.equal(state.prefixed, 'site-new-webkit', JSON.stringify(state));
      }
    );
  } catch (error) {
    failed++;
    console.error(`Owned player setup failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    try {
      await browser?.close();
    } finally {
      await fixtures?.stop();
    }
  }
  console.log(
    `Owned player Chrome emulation: ${passed} passed, ${failed} failed (not Safari verification)`
  );
  return { passed, failed };
}

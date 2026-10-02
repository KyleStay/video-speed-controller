import { assert, monitorPageErrors, sleep } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const hostFixtureHtml =
  '<!doctype html><html><head><title>StayFast site fixture</title></head><body><main></main></body></html>';

async function installHostFixtureInterception(page, browserName) {
  if (browserName === 'chrome') {
    const session = await page.target().createCDPSession();
    const onPaused = async ({ requestId, request, resourceType }) => {
      try {
        const host = new URL(request.url).hostname;
        if (host !== 'x.com' && host !== 'www.youtube.com') {
          await session.send('Fetch.continueRequest', { requestId });
          return;
        }
        await session.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: resourceType === 'Document' ? 200 : 204,
          responseHeaders:
            resourceType === 'Document'
              ? [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }]
              : [],
          body: resourceType === 'Document' ? Buffer.from(hostFixtureHtml).toString('base64') : '',
        });
      } catch (error) {
        console.error(`Fixture interception failed: ${error.message}`);
      }
    };
    session.on('Fetch.requestPaused', onPaused);
    await session.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    });
    return async () => {
      session.off('Fetch.requestPaused', onPaused);
      await session.send('Fetch.disable').catch(() => {});
      await session.detach().catch(() => {});
    };
  }

  const onRequest = async (request) => {
    try {
      const host = new URL(request.url()).hostname;
      if (host === 'x.com' || host === 'www.youtube.com') {
        if (request.isNavigationRequest()) {
          await request.respond({
            status: 200,
            contentType: 'text/html',
            body: hostFixtureHtml,
          });
        } else {
          await request.abort();
        }
        return;
      }
      await request.continue();
    } catch (error) {
      if (!request.isInterceptResolutionHandled()) {
        await request.abort().catch(() => {});
      }
      throw error;
    }
  };

  await page.setRequestInterception(true);
  page.on('request', onRequest);
  return async () => {
    page.off('request', onRequest);
    await page.setRequestInterception(false);
  };
}

/** Local fixtures using the real extension worlds and native media events. */
export async function runReliabilityChecks(page, runTest, options = {}) {
  const fixture = options.fixtureBaseUrl ? null : await startFixtureServer();
  const fixtureBaseUrl = options.fixtureBaseUrl || fixture.baseUrl;
  const mediaUrl = options.mediaUrl || fixture.mediaUrl;
  const pageErrors = monitorPageErrors(page);
  const stopInterception = await installHostFixtureInterception(
    page,
    options.browserName || 'chrome'
  );
  const checkedRunTest = async (testName, testFunction) => {
    await runTest(testName, async () => {
      pageErrors.clear();
      await testFunction();
      pageErrors.assertNone(testName);
    });
  };

  try {
    await runReliabilityCheckSet(page, checkedRunTest, { fixtureBaseUrl, mediaUrl });
  } finally {
    pageErrors.dispose();
    await stopInterception();
    await fixture?.stop();
  }
}

async function runReliabilityCheckSet(page, runTest, { fixtureBaseUrl, mediaUrl }) {
  const loadFixture = async (url = `${fixtureBaseUrl}/fixture.html`) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.VSC_controller?.mutationObserver?.observer);
  };

  await runTest('Scrolling an X feed attaches ready videos before idle work', async () => {
    // All requests are intercepted above; this fixture never contacts X.
    await loadFixture('https://x.com/home');
    await page.evaluate(() => {
      const first = document.createElement('video');
      first.id = 'first';
      Object.defineProperty(first, 'readyState', { value: 2 });
      document.querySelector('main').append(first);
    });
    await page.waitForFunction(() => document.querySelector('#first').vsc);
    await page.evaluate(() => {
      window.VSC_controller.actionHandler.adjustSpeed(document.querySelector('#first'), 1);
      // Model a busy feed with no idle slot. Only readiness events can attach
      // the new video in this fixture; the old controller prevents key recovery.
      window.requestIdleCallback = () => 123;
      document.querySelector('main').style.height = '4000px';
      window.addEventListener(
        'scroll',
        () => {
          const post = document.createElement('article');
          const video = document.createElement('video');
          video.id = 'later';
          Object.defineProperty(video, 'readyState', { value: 2 });
          post.append(video);
          document.querySelector('main').append(post);
          video.dispatchEvent(new Event('loadeddata'));
        },
        { once: true }
      );
      window.scrollTo(0, 1000);
    });
    await page.waitForFunction(() => document.querySelector('#later')?.vsc?.div.isConnected);
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('#later').playbackRate > 1);
    const result = await page.evaluate(() => ({
      count: window.VSC.stateManager.getControlledElements().length,
      sameSpeed:
        document.querySelector('#first').playbackRate ===
        document.querySelector('#later').playbackRate,
    }));
    assert.equal(result.count, 2, 'Both feed videos should have controllers');
    assert.true(result.sameSpeed, 'The shortcut should reach the later feed video');
  });

  await runTest('YouTube readiness handlers finish before controller insertion', async () => {
    await loadFixture('https://www.youtube.com/watch?v=stayfast-fixture');
    const earlyInsertion = await page.evaluate(() => {
      const player = document.createElement('div');
      player.className = 'html5-video-player';
      const container = document.createElement('div');
      container.className = 'html5-video-container';
      const video = document.createElement('video');
      Object.defineProperty(video, 'readyState', { value: 2 });
      container.append(video);
      player.append(container);
      document.querySelector('main').append(player);
      let earlyInsertion = false;
      video.addEventListener('loadeddata', () => {
        earlyInsertion = Boolean(video.vsc || player.querySelector('vsc-controller'));
      });
      video.dispatchEvent(new Event('loadeddata'));
      return earlyInsertion;
    });
    assert.true(!earlyInsertion, 'VSC must not mutate the player ahead of its readiness handler');
    await page.waitForFunction(() => document.querySelector('video').vsc?.div.isConnected);
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('video').playbackRate > 1);

    await page.evaluate(() => {
      const old = document.querySelector('video');
      const next = document.createElement('video');
      Object.defineProperty(next, 'readyState', { value: 2 });
      old.replaceWith(next);
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    });
    await page.waitForFunction(() => document.querySelector('video').vsc?.div.isConnected);
    const before = await page.evaluate(() => document.querySelector('video').playbackRate);
    await page.keyboard.press('d');
    await page.waitForFunction(
      (previous) => document.querySelector('video').playbackRate > previous,
      {},
      before
    );
    assert.equal(
      await page.evaluate(() => window.VSC.stateManager.getControlledElements().length),
      1,
      'SPA replacement should leave exactly one working controller'
    );
  });

  await runTest('Removed unloaded media releases pending attachment after fallback', async () => {
    await loadFixture();
    await page.evaluate(() =>
      document.querySelector('main').append(document.createElement('video'))
    );
    await page.waitForFunction(() => window.VSC_controller.pendingVideoElements.size === 1);
    await sleep(1700);
    await page.evaluate(() => document.querySelector('video').remove());
    await page.waitForFunction(() => window.VSC_controller.pendingVideoElements.size === 0);
  });

  await runTest('Repeated SPA media replacement leaves one working controller', async () => {
    await loadFixture();
    for (let generation = 0; generation < 12; generation++) {
      await page.evaluate(
        ({ generation, mediaUrl }) =>
          new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.id = 'spa-video';
            video.muted = true;
            video.preload = 'auto';
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener(
              'error',
              () => reject(new Error(`Native fixture media failed at generation ${generation}`)),
              { once: true }
            );
            const previous = document.querySelector('#spa-video');
            if (previous) {
              previous.replaceWith(video);
            } else {
              document.querySelector('main').append(video);
            }
            video.src = `${mediaUrl}?spa=${generation}`;
            history.pushState({}, '', `?generation=${generation}`);
            dispatchEvent(new PopStateEvent('popstate'));
          }),
        { generation, mediaUrl }
      );
      await page.waitForFunction(() => document.querySelector('#spa-video')?.vsc?.div.isConnected);
      const state = await page.evaluate(() => ({
        controlled: window.VSC.stateManager.getControlledElements().length,
        wrappers: document.querySelectorAll('.vsc-controller').length,
        playable: document.querySelector('#spa-video').readyState >= 2,
      }));
      assert.equal(state.controlled, 1, `Generation ${generation} should own one controller`);
      assert.equal(state.wrappers, 1, `Generation ${generation} should render one controller UI`);
      assert.true(state.playable, `Generation ${generation} should use native playable media`);
    }
  });

  await runTest('Repeated enable and disable cycles release and restore controllers', async () => {
    await loadFixture();
    await page.evaluate(
      (mediaUrl) =>
        new Promise((resolve, reject) => {
          const video = document.createElement('video');
          video.id = 'toggle-video';
          video.muted = true;
          video.preload = 'auto';
          video.addEventListener('loadeddata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('Toggle media failed')), {
            once: true,
          });
          document.querySelector('main').append(video);
          video.src = mediaUrl;
        }),
      mediaUrl
    );
    await page.waitForFunction(() => document.querySelector('#toggle-video')?.vsc?.div.isConnected);

    for (let cycle = 0; cycle < 6; cycle++) {
      await page.evaluate(() =>
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } })
        )
      );
      await page.waitForFunction(
        () =>
          !window.VSC_controller.initialized &&
          !document.querySelector('#toggle-video').vsc &&
          document.querySelectorAll('.vsc-controller').length === 0
      );
      await page.evaluate(() =>
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_REINIT' } })
        )
      );
      await page.waitForFunction(
        () =>
          window.VSC_controller.initialized &&
          document.querySelector('#toggle-video')?.vsc?.div.isConnected &&
          document.querySelectorAll('.vsc-controller').length === 1
      );
    }
  });

  await runTest('Repeated native source changes keep one attached controller', async () => {
    await loadFixture();
    await page.evaluate(() => {
      const video = document.createElement('video');
      video.id = 'source-video';
      video.muted = true;
      video.preload = 'auto';
      document.querySelector('main').append(video);
    });

    for (let revision = 0; revision < 8; revision++) {
      await page.evaluate(
        ({ mediaUrl, revision }) =>
          new Promise((resolve, reject) => {
            const video = document.querySelector('#source-video');
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener(
              'error',
              () => reject(new Error(`Source revision ${revision} failed`)),
              { once: true }
            );
            video.src = `${mediaUrl}?source=${revision}`;
            video.load();
          }),
        { mediaUrl, revision }
      );
      await page.waitForFunction(
        () => document.querySelector('#source-video')?.vsc?.div.isConnected
      );
      const state = await page.evaluate(() => ({
        controlled: window.VSC.stateManager.getControlledElements().length,
        wrappers: document.querySelectorAll('.vsc-controller').length,
        readyState: document.querySelector('#source-video').readyState,
      }));
      assert.equal(state.controlled, 1, `Source revision ${revision} should stay registered`);
      assert.equal(state.wrappers, 1, `Source revision ${revision} should keep one UI`);
      assert.true(state.readyState >= 2, `Source revision ${revision} should be playable`);
    }
  });

  await runTest('Removed controller UI is repaired without duplicating state', async () => {
    await loadFixture();
    await page.evaluate(
      (mediaUrl) =>
        new Promise((resolve, reject) => {
          const video = document.createElement('video');
          video.id = 'repair-video';
          video.muted = true;
          video.addEventListener('loadeddata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('Repair media failed')), {
            once: true,
          });
          document.querySelector('main').append(video);
          video.src = mediaUrl;
        }),
      mediaUrl
    );
    await page.waitForFunction(() => document.querySelector('#repair-video')?.vsc?.div.isConnected);
    await page.evaluate(() => document.querySelector('#repair-video').vsc.div.remove());
    await page.waitForFunction(
      () =>
        document.querySelector('#repair-video')?.vsc?.div.isConnected &&
        document.querySelectorAll('.vsc-controller').length === 1
    );
    assert.equal(
      await page.evaluate(() => window.VSC.stateManager.getControlledElements().length),
      1,
      'UI repair must preserve exactly one controlled media element'
    );
  });

  await runTest('Shadow-root reparenting moves the controller with its media', async () => {
    await loadFixture();
    await page.evaluate(
      (mediaUrl) =>
        new Promise((resolve, reject) => {
          const first = document.createElement('section');
          first.id = 'shadow-first';
          const second = document.createElement('section');
          second.id = 'shadow-second';
          document.querySelector('main').append(first, second);
          const firstRoot = first.attachShadow({ mode: 'open' });
          second.attachShadow({ mode: 'open' });
          const video = document.createElement('video');
          video.id = 'shadow-reparent-video';
          video.muted = true;
          video.addEventListener('loadeddata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('Shadow media failed')), {
            once: true,
          });
          firstRoot.append(video);
          video.src = mediaUrl;
        }),
      mediaUrl
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#shadow-first').shadowRoot.querySelector('video')?.vsc?.div
          .isConnected
    );
    await page.evaluate(() => {
      const video = document.querySelector('#shadow-first').shadowRoot.querySelector('video');
      document.querySelector('#shadow-second').shadowRoot.append(video);
    });
    await page.waitForFunction(() => {
      const destination = document.querySelector('#shadow-second').shadowRoot;
      const video = destination.querySelector('video');
      return video?.vsc?.div.getRootNode() === destination;
    });
    const shadowState = await page.evaluate(() => ({
      controlled: window.VSC.stateManager.getControlledElements().length,
      firstControllers: document
        .querySelector('#shadow-first')
        .shadowRoot.querySelectorAll('.vsc-controller').length,
      secondControllers: document
        .querySelector('#shadow-second')
        .shadowRoot.querySelectorAll('.vsc-controller').length,
    }));
    assert.equal(shadowState.controlled, 1, 'Reparenting must preserve one registry entry');
    assert.equal(shadowState.firstControllers, 0, 'The old shadow root must release the UI');
    assert.equal(shadowState.secondControllers, 1, 'The destination shadow root must own the UI');
  });

  await runTest('Same-origin iframe media is owned only by its frame instance', async () => {
    await loadFixture();
    await page.evaluate((fixtureBaseUrl) => {
      const frame = document.createElement('iframe');
      frame.id = 'media-frame';
      frame.src = `${fixtureBaseUrl}/frame.html`;
      document.querySelector('main').append(frame);
    }, fixtureBaseUrl);
    const mediaFrame = await page.waitForFrame(
      (frame) => frame.url().startsWith(`${fixtureBaseUrl}/frame.html`),
      { timeout: 15000 }
    );
    await mediaFrame.waitForFunction(
      () =>
        window.VSC_controller?.initialized &&
        document.querySelector('#frame-video')?.readyState >= 2 &&
        document.querySelector('#frame-video')?.vsc?.div.isConnected
    );
    const [parentCount, childState] = await Promise.all([
      page.evaluate(() => window.VSC.stateManager.getControlledElements().length),
      mediaFrame.evaluate(() => ({
        controlled: window.VSC.stateManager.getControlledElements().length,
        ownerMatches: document.querySelector('#frame-video').vsc.div.ownerDocument === document,
        wrappers: document.querySelectorAll('.vsc-controller').length,
      })),
    ]);
    assert.equal(parentCount, 0, 'The parent frame must not claim child media');
    assert.equal(childState.controlled, 1, 'The child frame must register its own media');
    assert.true(childState.ownerMatches, 'The controller DOM must belong to the child document');
    assert.equal(childState.wrappers, 1, 'The child frame should render one controller');
  });

  await runTest(
    'Shadow media tracks native rate changes and restores automatic resets',
    async () => {
      await loadFixture();
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'player';
        document.body.append(host);
        const root = host.attachShadow({ mode: 'open' });
        const video = document.createElement('video');
        // No external media download needed to test native playbackRate events.
        Object.defineProperty(video, 'readyState', { value: 2 });
        root.append(video);
        const button = document.createElement('button');
        button.id = 'native-speed';
        button.textContent = 'Native player speed';
        button.onclick = () => {
          video.playbackRate = 1;
        };
        document.body.append(button);
      });
      await page.waitForFunction(
        () => document.querySelector('#player').shadowRoot.querySelector('video').vsc
      );
      await page.evaluate(() => {
        const video = document.querySelector('#player').shadowRoot.querySelector('video');
        window.VSC_controller.actionHandler.adjustSpeed(video, 2);
      });
      await page.waitForFunction(() => {
        const video = document.querySelector('#player').shadowRoot.querySelector('video');
        return !window.VSC_controller.eventManager.getMediaRateState(video)?.coolDown;
      });
      await page.evaluate(() => {
        document.querySelector('#player').shadowRoot.querySelector('video').playbackRate = 1;
      });
      await page.waitForFunction(
        () => document.querySelector('#player').shadowRoot.querySelector('video').playbackRate === 2
      );
      for (const type of ['click', 'keydown']) {
        await page.waitForFunction(() => {
          const video = document.querySelector('#player').shadowRoot.querySelector('video');
          return !window.VSC_controller.eventManager.getMediaRateState(video)?.coolDown;
        });
        await page.evaluate((eventType) => {
          if (eventType === 'click') {
            document.querySelector('#native-speed').click();
          } else {
            document.body.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true })
            );
            document.querySelector('#player').shadowRoot.querySelector('video').playbackRate = 1;
          }
        }, type);
        await page.waitForFunction(() => {
          const video = document.querySelector('#player').shadowRoot.querySelector('video');
          return video.playbackRate === 2 && window.VSC_controller.config.settings.lastSpeed === 2;
        });
      }
      await page.waitForFunction(() => {
        const video = document.querySelector('#player').shadowRoot.querySelector('video');
        return !window.VSC_controller.eventManager.getMediaRateState(video)?.coolDown;
      });
      await page.click('#native-speed');
      await page.waitForFunction(() => {
        const video = document.querySelector('#player').shadowRoot.querySelector('video');
        return (
          video.playbackRate === 1 &&
          video.vsc.speedIndicator.textContent === '1.00' &&
          window.VSC_controller.config.settings.lastSpeed === 1
        );
      });
    }
  );

  for (const replacement of ['replaceChild', 'document.write']) {
    await runTest(`Settings and lifecycle messages recover after ${replacement}`, async () => {
      await loadFixture();
      const generation = await page.evaluate((kind) => {
        const generation = window.VSC_controller.lifecycleGeneration;
        const html = '<head><title>Replaced fixture</title></head><body><video></video></body>';
        if (kind === 'document.write') {
          document.open();
          document.write(`<!doctype html><html>${html}</html>`);
          document.close();
        } else {
          const root = document.createElement('html');
          root.innerHTML = html;
          document.replaceChild(root, document.documentElement);
        }
        Object.defineProperty(document.querySelector('video'), 'readyState', { value: 2 });
        return generation;
      }, replacement);
      await page.waitForFunction(
        (previous) => {
          const extension = window.VSC_controller;
          return (
            extension.lifecycleGeneration > previous &&
            extension.initialized &&
            !extension.config.settings._abort &&
            !!document.querySelector('video').vsc
          );
        },
        {},
        generation
      );
      const status = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const root = document.documentElement;
            const handler = (event) => {
              if (event.detail?.requestId !== 'recovery-check') {
                return;
              }
              clearTimeout(timer);
              root.removeEventListener('VSC_MESSAGE_RESULT', handler);
              resolve(event.detail);
            };
            const timer = setTimeout(() => {
              root.removeEventListener('VSC_MESSAGE_RESULT', handler);
              resolve(null);
            }, 1000);
            root.addEventListener('VSC_MESSAGE_RESULT', handler);
            root.dispatchEvent(
              new CustomEvent('VSC_MESSAGE', {
                detail: { type: 'VSC_GET_STATUS', requestId: 'recovery-check' },
              })
            );
          })
      );
      assert.true(
        status?.ok === true && status.mediaCount === 1,
        'Recovered controller must answer status messages'
      );
      await page.evaluate(() => {
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } })
        );
      });
      await page.waitForFunction(
        () => !window.VSC_controller.initialized && !document.querySelector('video').vsc
      );
      await page.evaluate(() => {
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_REINIT' } })
        );
      });
      await page.waitForFunction(
        () => window.VSC_controller.initialized && !!document.querySelector('video').vsc
      );
    });
  }
}

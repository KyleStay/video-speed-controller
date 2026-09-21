import { assert, sleep } from './e2e-utils.js';

/** Local fixtures using the real extension worlds and native media events. */
export async function runReliabilityChecks(page, runTest) {
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.respond({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>StayFast fixture</title></head><body><main></main></body></html>',
    })
  );

  const loadFixture = async () => {
    await page.goto('http://stayfast-fixture.test/');
    await page.waitForFunction(() => window.VSC_controller?.mutationObserver?.observer);
  };

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
      await page.waitForFunction(() => !window.VSC_controller.eventManager.coolDown);
      await page.evaluate(() => {
        document.querySelector('#player').shadowRoot.querySelector('video').playbackRate = 1;
      });
      await page.waitForFunction(
        () => document.querySelector('#player').shadowRoot.querySelector('video').playbackRate === 2
      );
      await page.waitForFunction(() => !window.VSC_controller.eventManager.coolDown);
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

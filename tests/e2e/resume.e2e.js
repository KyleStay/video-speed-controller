import { assert, monitorPageErrors, sleep } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

/** Real built worlds with controlled missed notifications and delayed reads. */
export default async function runResumeTests({ launch }) {
  const fixture = await startFixtureServer();
  let browser;
  let session;
  let errors;
  let passed = 0;
  let failed = 0;
  try {
    const launched = await launch({ bridgeHooks: true });
    browser = launched.browser;
    const page = launched.page;
    page.setDefaultTimeout(6000);
    errors = monitorPageErrors(page);
    const target = await browser.waitForTarget(
      (item) =>
        item.type() === 'service_worker' &&
        item.url().startsWith(`chrome-extension://${launched.extensionId}/`)
    );
    const worker = await target.worker();
    session = await page.createCDPSession();
    const contexts = new Map();
    session.on('Runtime.executionContextCreated', ({ context }) =>
      contexts.set(context.id, context)
    );
    session.on('Runtime.executionContextDestroyed', ({ executionContextId }) =>
      contexts.delete(executionContextId)
    );
    session.on('Runtime.executionContextsCleared', () => contexts.clear());
    await session.send('Runtime.enable');
    let bridgeContext;

    const bridge = async (expression) => {
      const result = await session.send('Runtime.evaluate', {
        contextId: bridgeContext,
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    };
    const load = async () => {
      await page.goto('about:blank');
      await worker.evaluate(async () => {
        await chrome.storage.sync.clear();
        await chrome.storage.sync.set({ enabled: true, lastSpeed: 1, rememberSpeed: true });
      });
      await page.goto(`${fixture.baseUrl}/frame.html`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => window.VSC_controller?.initialized && document.querySelector('video')?.vsc?.div,
        { timeout: 8000 }
      );
      bridgeContext = null;
      for (const context of contexts.values()) {
        if (context.auxData?.isDefault) {
          continue;
        }
        const result = await session.send('Runtime.evaluate', {
          contextId: context.id,
          expression: 'Boolean(globalThis.__stayfastBridgeTest)',
          returnByValue: true,
        });
        if (result.result.value) {
          bridgeContext = context.id;
          break;
        }
      }
      assert.exists(bridgeContext, 'The disposable bridge must expose its test hooks');
    };
    const restore = () =>
      page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
    const writePendingSpeed = () =>
      page.evaluate(() => {
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 3 } })
        );
      });
    const waitForHeldRead = async () => {
      for (let count = 0; count < 40; count++) {
        if (await bridge('Boolean(__stayfastBridgeTest.pendingRead)')) {
          return;
        }
        await sleep(25);
      }
      throw new Error('The bridge did not begin the expected settings read');
    };
    const run = async (name, action) => {
      try {
        errors.clear();
        await load();
        await action();
        errors.assertNone(name);
        passed++;
        console.log(`PASS: ${name}`);
      } catch (error) {
        failed++;
        console.error(`FAIL: ${name}: ${error.stack || error.message}`);
      }
    };

    await run('Restoration reconciles missed disable and re-enable notifications', async () => {
      await bridge(
        '__stayfastBridgeTest.dropChanges = true; chrome.storage.sync.set({enabled:false})'
      );
      await restore();
      await page.waitForFunction(() => !window.VSC_controller.initialized);
      assert.equal(await page.$('vsc-controller'), null, 'Disable must remove the indicator');
      await bridge('chrome.storage.sync.set({enabled:true})');
      await restore();
      await page.waitForFunction(
        () => window.VSC_controller.initialized && document.querySelector('vsc-controller')
      );
      await page.keyboard.press('d');
      await page.waitForFunction(() => document.querySelector('video').playbackRate > 1);
    });

    await run('A missed reset cancels queued speed persistence on restoration', async () => {
      await writePendingSpeed();
      await bridge(
        '__stayfastBridgeTest.dropChanges = true; chrome.storage.sync.remove("lastSpeed")'
      );
      await restore();
      await sleep(1400); // Beyond the bridge's one-second persistence debounce.
      assert.equal(
        await bridge(
          'chrome.storage.sync.get("lastSpeed").then(value => Object.hasOwn(value,"lastSpeed"))'
        ),
        false,
        'Restoration must not undo a reset by writing the queued speed'
      );
    });

    await run(
      'Unchanged storage preserves a recent speed while the resume read is delayed',
      async () => {
        await bridge('__stayfastBridgeTest.holdNextRead = true');
        await writePendingSpeed();
        await restore();
        await waitForHeldRead();
        await sleep(1200);
        assert.equal(
          await worker.evaluate(async () => (await chrome.storage.sync.get('lastSpeed')).lastSpeed),
          1,
          'Persistence must pause until reconciliation finishes'
        );
        await bridge('__stayfastBridgeTest.releaseRead()');
        await sleep(1200);
        assert.equal(
          await worker.evaluate(async () => (await chrome.storage.sync.get('lastSpeed')).lastSpeed),
          3,
          'An unchanged snapshot must preserve the pending user speed'
        );
      }
    );

    await run(
      'A delayed handshake cannot return enabled settings after a concurrent disable',
      async () => {
        await bridge('__stayfastBridgeTest.holdNextRead = true');
        await page.evaluate(() => {
          window.__stayfastSettingsReplies = [];
          document.documentElement.addEventListener('VSC_SETTINGS_READY', (event) =>
            window.__stayfastSettingsReplies.push(event.detail)
          );
          document.documentElement.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
        });
        await waitForHeldRead();
        await worker.evaluate(() => chrome.storage.sync.set({ enabled: false }));
        await page.waitForFunction(() => !window.VSC_controller.initialized);
        await bridge('__stayfastBridgeTest.releaseRead()');
        await page.waitForFunction(() => window.__stayfastSettingsReplies.length === 1);
        assert.true(
          await page.evaluate(() => window.__stayfastSettingsReplies[0].abort === true),
          'A newer disable must supersede the old allowed snapshot'
        );
      }
    );

    await run('Visible-tab recovery repairs a controller after missed DOM mutations', async () => {
      await page.waitForFunction(() => window.VSC_controller.scheduledWork.size === 0);
      await page.evaluate(() => {
        window.VSC_controller.mutationObserver.stop();
        window.__stayfastOriginalController = document.querySelector('video').vsc;
        window.__stayfastOriginalController.div.remove();
      });
      assert.equal(await page.$('vsc-controller'), null, 'The fixture must remove the indicator');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => document.querySelector('video').vsc.div.isConnected);
      assert.true(
        await page.evaluate(
          () => document.querySelector('video').vsc === window.__stayfastOriginalController
        ),
        'Repair must preserve the existing controller'
      );
      await page.keyboard.press('d');
      await page.waitForFunction(() => document.querySelector('video').playbackRate > 1);
    });
    return { passed, failed };
  } finally {
    errors?.dispose();
    try {
      await session?.detach();
    } finally {
      try {
        await browser?.close();
      } finally {
        await fixture.stop();
      }
    }
  }
}

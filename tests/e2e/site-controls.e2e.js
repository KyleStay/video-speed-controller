/** Built extension, real storage bridge and genuine popup/options interaction on a local fixture. */
import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const controls = ['site-play', 'site-settings', 'site-seek', 'site-fullscreen'];
const iphoneUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1';

async function snapshot(page) {
  return page.evaluate(() => {
    const trace = window.__siteControlsFixture;
    const video = trace.video;
    const visible = (node) =>
      Boolean(node?.getClientRects().length) && getComputedStyle(node).display !== 'none';
    return {
      calls: [...trace.calls],
      sourceWrites: [...trace.sourceWrites],
      original: document.getElementById('primary-video') === video,
      source: video.currentSrc,
      sourceAttribute: video.getAttribute('src'),
      sourceObject: video.srcObject === null,
      parent: video.parentElement.id,
      controller: video.vsc === trace.controller,
      paused: video.paused,
      rate: video.playbackRate,
      time: video.currentTime,
      visible: Object.fromEntries(
        [...document.querySelectorAll('[id]')].map((node) => [node.id, visible(node)])
      ),
      ownVisible: visible(video.vsc?.div),
      ownHidden: video.vsc?.div.hasAttribute('data-vsc-site-hidden-control'),
      settingsStyle: document.getElementById('site-settings').getAttribute('style'),
    };
  });
}

function assertUnchanged(before, after) {
  for (const key of [
    'calls',
    'sourceWrites',
    'source',
    'sourceAttribute',
    'sourceObject',
    'parent',
    'paused',
    'rate',
    'settingsStyle',
  ]) {
    assert.deepEqual(
      after[key],
      before[key],
      `Site-control setting changed media or site state: ${key}`
    );
  }
  assert.ok(after.original && after.controller, 'Original media and controller identities survive');
  assert.ok(after.ownVisible && !after.ownHidden, 'StayFast controls remain available');
  for (const id of [
    'caption',
    'caption-action',
    'page-play',
    'page-action',
    'page-link',
    'adjacent-control',
  ]) {
    assert.equal(after.visible[id], true, `${id} must remain visible`);
  }
}

async function waitHidden(page, hidden, ids = controls) {
  await page.waitForFunction(
    (ids, hidden) =>
      ids.every((id) => {
        const node = document.getElementById(id);
        return node && (getComputedStyle(node).display === 'none') === hidden;
      }),
    {},
    ids,
    hidden
  );
}

async function openPopup(browser, page, bootstrap, extensionId) {
  await page.bringToFront();
  const opened = browser.waitForTarget(
    (target) =>
      target.url() === `chrome-extension://${extensionId}/ui/popup/popup.html` &&
      target !== bootstrap.target(),
    { timeout: 10000 }
  );
  const [target] = await Promise.all([
    opened,
    bootstrap.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.action.openPopup({ windowId: tab.windowId });
    }),
  ]);
  const popup = (await target.page()) || (await target.asPage());
  assert.ok(popup, 'Actual browser action popup exposes its extension document');
  await popup.waitForFunction(() => {
    const input = document.querySelector('#hide-site-controls');
    return input && !input.disabled;
  });
  return popup;
}

export default async function runSiteControls({
  launch = launchChromeWithExtension,
  popup: includePopup = true,
  ios = false,
} = {}) {
  let browser;
  let fixture;
  const monitors = [];
  const screenshotPrefix = ios ? 'site-controls-ios' : 'site-controls';
  let page;
  try {
    const html = await readFile(resolve('tests/e2e/site-controls.html'), 'utf8');
    fixture = await startFixtureServer({ htmlRoutes: { '/site-controls.html': html } });
    const fixtureURL = new URL('/site-controls.html', fixture.baseUrl);
    const hostname = fixtureURL.hostname;
    const launched = await launch();
    browser = launched.browser;
    page = launched.page;
    if (ios) {
      await page.setUserAgent(iphoneUA);
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    }
    const worker = browser.targets().find((target) => target.url().endsWith('/background.js'));
    const extensionId = launched.extensionId || new URL(worker.url()).hostname;
    const bootstrap = await browser.newPage();
    monitors.push(monitorPageErrors(page), monitorPageErrors(bootstrap));
    await bootstrap.goto(`chrome-extension://${extensionId}/ui/options/options.html`);
    await bootstrap.waitForSelector('#faster .customKey');
    await bootstrap.evaluate(async () => chrome.storage.sync.set({ enabled: true, siteRules: [] }));
    await page.bringToFront();
    await page.goto(fixtureURL.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const video = document.getElementById('primary-video');
      return video?.vsc && video.readyState >= 2;
    });
    if (ios) {
      assert.equal(
        await page.$eval('#primary-video', (video) =>
          Boolean(video.vsc?.controlsManager?.inlinePlayer?.owned)
        ),
        true,
        'Chromium iPhone emulation must exercise owned iOS inline controls'
      );
    }
    await page.evaluate(() => {
      window.__siteControlsFixture.controller = window.__siteControlsFixture.video.vsc;
    });
    await waitHidden(page, false);
    const rule = (value) => ({
      pattern: hostname,
      enabled: true,
      speed: null,
      ...(value === undefined ? {} : { hideSiteControls: value }),
      futureOption: { preserved: true },
    });
    const setRules = (rules) =>
      bootstrap.evaluate(async (siteRules) => chrome.storage.sync.set({ siteRules }), rules);
    const change = async (value, hidden) => {
      const before = await snapshot(page);
      await setRules([rule(value)]);
      await page.waitForFunction(
        (value) => {
          const matched = window.VSC.matchSiteRule(
            window.__siteControlsFixture.video.vsc.config.settings.siteRules,
            location.href
          );
          return matched && matched.hideSiteControls === value;
        },
        {},
        value
      );
      await waitHidden(page, hidden);
      assertUnchanged(before, await snapshot(page));
    };

    // Default, absent and invalid truthy data must not turn an opt-in on.
    await change(undefined, false);
    await change('true', false);
    await change(true, true);
    assert.equal((await snapshot(page)).paused, true, 'Opting in must not start paused media');
    const beforeLate = await snapshot(page);
    await page.evaluate(() => window.__siteControlsFixture.addLateControl());
    await waitHidden(page, true, ['late-control']);
    assertUnchanged(beforeLate, await snapshot(page));
    await change(false, false);
    await waitHidden(page, false, ['late-control']);
    for (const monitor of monitors) {
      monitor.assertNone('Paused, late and strict opt-in site controls');
    }
    console.log(
      'PASS: strict opt-in, paused and late controls, protected UI and original media preservation'
    );

    // Playing media retains its exact source/rate and never receives transport calls from a toggle.
    await page.click('#page-play');
    await page.waitForFunction(
      () =>
        !window.__siteControlsFixture.video.paused &&
        window.__siteControlsFixture.video.currentTime > 0.1
    );
    await change(true, true);
    const playing = await snapshot(page);
    await page.waitForFunction(
      (time) => window.__siteControlsFixture.video.currentTime > time + 0.2,
      {},
      playing.time
    );
    await change(false, false);
    await page.click('#page-play');
    await page.waitForFunction(() => window.__siteControlsFixture.video.paused);
    for (const monitor of monitors) {
      monitor.assertNone('Playing site-control toggles');
    }
    console.log(
      'PASS: live playing hide/restore, continued playback and no transport/source writes'
    );

    if (includePopup) {
      // Use the real action popup while the website remains the active tab.
      const popup = await openPopup(browser, page, bootstrap, extensionId);
      const popupErrors = monitorPageErrors(popup);
      assert.equal(await popup.$eval('#hide-site-controls', (input) => input.checked), false);
      const beforePopup = await snapshot(page);
      await popup.click('#hide-site-controls');
      await popup.waitForFunction(
        (hostname) =>
          document.querySelector('#site-controls-status').textContent === `Saved for ${hostname}.`,
        {},
        hostname
      );
      popupErrors.assertNone('Site controls popup opt-in');
      await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
      await popup.screenshot({
        path: resolve('tests/e2e/screenshots/site-controls-action-popup.png'),
      });
      popupErrors.dispose();
      await popup.close();
      await waitHidden(page, true);
      assertUnchanged(beforePopup, await snapshot(page));
      const saved = await bootstrap.evaluate(
        async () => (await chrome.storage.sync.get('siteRules')).siteRules
      );
      assert.equal(saved[0].hideSiteControls, true);
      assert.deepEqual(saved[0].futureOption, { preserved: true }, 'Popup keeps other rule fields');
    } else {
      // The independent core suite seeds storage explicitly before exercising
      // the options editor; it makes no claim about action-popup interaction.
      await change(true, true);
    }

    // The options editor must read the saved rule and save a live opt-out.
    await bootstrap.bringToFront();
    await bootstrap.reload();
    await bootstrap.waitForSelector('#faster .customKey');
    await bootstrap.click('#tab-advanced');
    assert.equal(
      await bootstrap.$eval('.site-rule .ruleHideSiteControls', (input) => input.checked),
      true
    );
    const beforeOptions = await snapshot(page);
    await bootstrap.click('.site-rule .ruleHideSiteControls');
    await bootstrap.waitForFunction(
      async () =>
        (await chrome.storage.sync.get('siteRules')).siteRules[0].hideSiteControls === false
    );
    await waitHidden(page, false, [...controls, 'late-control']);
    assertUnchanged(beforeOptions, await snapshot(page));
    await bootstrap.reload();
    await bootstrap.waitForSelector('#faster .customKey');
    await bootstrap.click('#tab-advanced');
    assert.equal(
      await bootstrap.$eval('.site-rule .ruleHideSiteControls', (input) => input.checked),
      false
    );
    const optionsViewport = bootstrap.viewport();
    await bootstrap.setViewport({ width: 320, height: 900 });
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    await bootstrap.screenshot({
      path: resolve(`tests/e2e/screenshots/${screenshotPrefix}-options-320.png`),
      fullPage: true,
    });
    if (optionsViewport) {
      await bootstrap.setViewport(optionsViewport);
    }
    if (includePopup) {
      const popup = await openPopup(browser, page, bootstrap, extensionId);
      const popupErrors = monitorPageErrors(popup);
      assert.equal(
        await popup.$eval('#hide-site-controls', (input) => input.checked),
        false,
        'Popup reads options opt-out'
      );
      popupErrors.assertNone('Site controls popup roundtrip');
      popupErrors.dispose();
      await popup.close();
    }
    for (const monitor of monitors) {
      monitor.assertNone('Per-site site-control built-extension regression');
    }
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    await page.screenshot({
      path: resolve(`tests/e2e/screenshots/${screenshotPrefix}-restored.png`),
    });
    console.log(
      includePopup
        ? 'PASS: site-controls: live storage, strict opt-in, late controls, media preservation, actual action popup and options roundtrip'
        : `PASS: ${ios ? 'site-controls-ios (Chromium iPhone emulation)' : 'site-controls-core'}: live storage, strict opt-in, paused/playing/late controls, media preservation and options roundtrip`
    );
    return { passed: 1, failed: 0 };
  } catch (error) {
    if (page && !page.isClosed()) {
      await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
      try {
        const mediaState = await page.evaluate(() => {
          const video = document.getElementById('primary-video');
          const ranges = (value) =>
            Array.from({ length: value.length }, (_, index) => [
              value.start(index),
              value.end(index),
            ]);
          return {
            url: location.href,
            initialized: !!window.VSC_controller?.initialized,
            video: video && {
              readyState: video.readyState,
              networkState: video.networkState,
              error: video.error && { code: video.error.code, message: video.error.message },
              src: video.src,
              srcAttribute: video.getAttribute('src'),
              currentSrc: video.currentSrc,
              srcObject: !!video.srcObject,
              duration: Number.isFinite(video.duration) ? video.duration : null,
              currentTime: video.currentTime,
              paused: video.paused,
              ended: video.ended,
              playbackRate: video.playbackRate,
              videoWidth: video.videoWidth,
              videoHeight: video.videoHeight,
              buffered: ranges(video.buffered),
              seekable: ranges(video.seekable),
              controlled: !!video.vsc,
            },
            calls: window.__siteControlsFixture?.calls,
            sourceWrites: window.__siteControlsFixture?.sourceWrites,
          };
        });
        await writeFile(
          resolve(`tests/e2e/screenshots/${screenshotPrefix}-failure.json`),
          JSON.stringify(mediaState, null, 2)
        );
        console.error('Site controls media failure:', mediaState);
      } catch {
        // Preserve the original failure if navigation invalidated the page context.
      }
      await page
        .screenshot({ path: resolve(`tests/e2e/screenshots/${screenshotPrefix}-failure.png`) })
        .catch(() => {});
    }
    throw error;
  } finally {
    for (const monitor of monitors) {
      monitor.dispose();
    }
    await Promise.all([browser?.close(), fixture?.stop()]);
  }
}

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';

export default async function runOptionsTests({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let errors;
  try {
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    const worker = browser.targets().find((target) => target.url().endsWith('/background.js'));
    const extensionId = launched.extensionId || new URL(worker.url()).hostname;
    await page.goto(`chrome-extension://${extensionId}/ui/options/options.html`);
    await page.waitForSelector('#faster .customKey');
    const stored = (key) =>
      page.evaluate(async (name) => {
        const settings = await chrome.storage.sync.get(name);
        return settings[name];
      }, key);
    const waitForStored = (key, expected) =>
      page.waitForFunction(
        async (name, value) => {
          const settings = await chrome.storage.sync.get(name);
          return settings[name] === value;
        },
        {},
        key,
        expected
      );
    const status = (text) =>
      page.waitForFunction(
        (value) => document.getElementById('status').textContent === value,
        {},
        text
      );
    const edit = async (selector, value) => {
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.type(value);
    };

    assert.equal(await page.$('#save'), null);
    assert.equal(await page.$eval('#revert', (button) => button.disabled), true);
    await page.click('#rememberSpeed');
    await waitForStored('rememberSpeed', true);
    await page.click('#startHidden');
    await waitForStored('startHidden', true);
    await page.click('#revert');
    await status('Changes reverted');
    assert.equal(await stored('startHidden'), false);
    assert.equal(await stored('rememberSpeed'), true);
    await page.reload();
    await page.waitForSelector('#faster .customKey');
    assert.equal(await page.$eval('#rememberSpeed', (input) => input.checked), true);

    await page.click('#faster .customKey');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyP');
    await page.keyboard.up('Control');
    await status('Changes saved automatically');
    assert.equal(
      (await stored('keyBindings')).find((binding) => binding.action === 'faster').code,
      'KeyP'
    );
    await page.click('#revert');
    await status('Changes reverted');
    assert.equal(
      (await stored('keyBindings')).find((binding) => binding.action === 'faster').code,
      'KeyD'
    );

    await page.click('#tab-advanced');
    await edit('#controllerButtonSize', '64');
    await status('Error: Controller button size must be between 10 and 32.');
    assert.equal(
      await page.$eval('#controllerButtonSize', (input) => input === document.activeElement),
      true
    );
    await page.click('#revert');
    await status('Changes reverted');
    assert.equal(await page.$eval('#controllerButtonSize', (input) => input.value), '14');
    await edit('#controllerCSS', 'vsc-controller { opacity: 0.8; }');
    await waitForStored('customCSS', 'vsc-controller { opacity: 0.8; }');
    await page.click('#revert');
    await status('Changes reverted');
    assert.equal(await page.$eval('#controllerCSS', (input) => input.value), '');

    const ruleCount = await page.$$eval('.site-rule', (rows) => rows.length);
    await page.click('#add-site-rule');
    await page.type('.site-rule:last-child .rulePattern', 'example.com');
    await page.type('.site-rule:last-child .ruleSpeed', '1.5');
    await page.waitForFunction(
      async () => (await chrome.storage.sync.get('siteRules')).siteRules?.at(-1)?.speed === 1.5
    );
    assert.deepEqual((await stored('siteRules')).at(-1), {
      pattern: 'example.com',
      enabled: true,
      speed: 1.5,
    });
    await page.click('.site-rule:last-child .removeParent');
    await page.waitForFunction(
      async (count) => (await chrome.storage.sync.get('siteRules')).siteRules.length === count,
      {},
      ruleCount
    );

    await page.click('#split-toggle');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#restore');
    await status('Default options restored');
    assert.equal(await stored('rememberSpeed'), false);
    await page.click('#revert');
    await status('Changes reverted');
    assert.equal(await stored('rememberSpeed'), true);

    const output = resolve('tests/e2e/screenshots');
    await mkdir(output, { recursive: true });
    await page.click('#tab-settings');
    await page.screenshot({ path: resolve(output, 'options-autosave-desktop.png') });
    await page.setViewport({
      width: 320,
      height: 700,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    for (const tab of ['settings', 'advanced', 'faq', 'about']) {
      await page.click(`#tab-${tab}`);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `${tab} should fit a narrow viewport`
      );
    }
    await page.click('#tab-settings');
    assert.equal(
      await page.evaluate(() => {
        const brand = document.querySelector('.header-brand').getBoundingClientRect();
        const actions = document.querySelector('.split-button').getBoundingClientRect();
        return brand.right <= actions.left;
      }),
      true,
      'Header branding and actions should not overlap'
    );
    await page.screenshot({ path: resolve(output, 'options-autosave-mobile.png') });
    errors.assertNone('Options autosave, revert, and reset');
    console.log(
      'Options UI passed: autosave, reload, undo, shortcuts, validation, CSS, site rules, reset, and narrow layout'
    );
    return { passed: 1, failed: 0 };
  } catch (error) {
    console.error(error);
    return { passed: 0, failed: 1 };
  } finally {
    errors?.dispose();
    await browser?.close();
    // Connected Chrome closes before all helpers exit; allow them to settle
    // before the isolated runner's strict native-identity cleanup inventory.
    if (browser) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

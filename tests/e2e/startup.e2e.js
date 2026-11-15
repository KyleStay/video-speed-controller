import { assert, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

/** Exercise the built scripts, including a bridge delayed by the test launcher. */
export default async function runStartupTests({ launch }) {
  const fixture = await startFixtureServer();
  let browser;
  let errors;
  try {
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    await page.goto(process.env.STAYFAST_STARTUP_URL || `${fixture.baseUrl}/frame.html`, {
      waitUntil: 'load',
    });
    await page.waitForFunction(
      () => window.VSC_controller?.initialized && document.querySelector('vsc-controller'),
      { timeout: 8000 }
    );
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('video').playbackRate > 1);
    assert.true(
      await page.evaluate(() => document.querySelectorAll('vsc-controller').length === 1),
      'Startup must attach exactly one working controller'
    );
    errors.assertNone('built extension startup');
    console.log('Startup passed: settings loaded, one controller, real keyboard speed change');
    return { passed: 1, failed: 0 };
  } finally {
    errors?.dispose();
    await browser?.close();
    await fixture.stop();
  }
}

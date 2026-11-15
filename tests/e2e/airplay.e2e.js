/** Built controls with a simulated Apple picker API; not receiver acceptance. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AirPlay controls fixture</title>
<style>body{margin:16px;font:16px system-ui}section{position:relative;width:min(720px,100%)}video{display:block;width:100%;aspect-ratio:16/9}</style>
<script>
window.pickerCalls = [];
if (location.search.includes('supported')) {
  HTMLMediaElement.prototype.webkitShowPlaybackTargetPicker = function() {
    pickerCalls.push({id:this.id, activated:navigator.userActivation.isActive});
  };
}
</script></head><body><h1>AirPlay controls</h1><section>
<video id="media" muted playsinline preload="auto" src="/sample.webm"></video>
</section></body></html>`;

async function point(page, selector, owned = false) {
  const position = await page.evaluate(
    (query, player) => {
      const media = document.querySelector('video');
      const shadow = player ? media.vsc.iosPlayer.ui.shadow : media.vsc.div.shadowRoot;
      const node = shadow.querySelector(query);
      const rect = node.getBoundingClientRect();
      return !node.hidden && rect.width && rect.height
        ? {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
          }
        : null;
    },
    selector,
    owned
  );
  assert.exists(position, `Visible ${selector}`);
  return position;
}

export default async function runAirPlay({ launch = launchChromeWithExtension } = {}) {
  let browser;
  let server;
  let errors;
  try {
    server = await startFixtureServer({ htmlRoutes: { '/airplay.html': html } });
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    for (const mobile of [false, true]) {
      await page.setViewport({
        width: mobile ? 390 : 1280,
        height: 844,
        isMobile: mobile,
        hasTouch: mobile,
      });
      await page.setUserAgent(
        mobile
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_4) AppleWebKit/605.1.15 Version/18.4 Safari/605.1.15'
      );
      const click = async (selector, owned = false) => {
        const p = await point(page, selector, owned);
        if (mobile) {
          assert.true(p.width >= 44 && p.height >= 44, `${selector} has a 44px touch target`);
          await page.touchscreen.tap(p.x, p.y);
        } else {
          await page.mouse.click(p.x, p.y);
        }
      };
      await page.goto(`${server.baseUrl}/airplay.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!document.querySelector('video').vsc);
      assert.true(
        await page.evaluate(() => {
          const button = document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('[data-action="airplay"]');
          return button.hidden && getComputedStyle(button).display === 'none';
        }),
        'Unsupported AirPlay stays hidden'
      );

      await page.goto(`${server.baseUrl}/airplay.html?supported`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () =>
          !!document
            .querySelector('video')
            .vsc?.div?.shadowRoot.querySelector('[data-action="airplay"]')
      );
      const pill = await point(page, '.draggable');
      if (mobile) {
        await page.touchscreen.tap(pill.x, pill.y);
      } else {
        await page.mouse.move(pill.x, pill.y);
      }
      await click('[data-action="airplay"]');
      assert.true(
        await page.evaluate(
          () =>
            window.pickerCalls.length === 1 &&
            window.pickerCalls[0].id === 'media' &&
            window.pickerCalls[0].activated
        ),
        'Picker request retains trusted input activation on its own media'
      );
      await page.evaluate(() =>
        document.querySelector('video').setAttribute('disableremoteplayback', '')
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('[data-action="airplay"]').hidden
      );
      assert.true(
        await page.evaluate(
          () =>
            getComputedStyle(
              document
                .querySelector('video')
                .vsc.div.shadowRoot.querySelector('[data-action="airplay"]')
            ).display === 'none'
        ),
        'Restricted control is hidden by the built styles'
      );
      await page.evaluate(() => {
        const media = document.querySelector('video');
        media.removeAttribute('disableremoteplayback');
        media.webkitCurrentPlaybackTargetIsWireless = true;
        media.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
      });
      await page.waitForFunction(
        () =>
          document
            .querySelector('video')
            .vsc.div.shadowRoot.querySelector('[data-action="airplay"]')
            .getAttribute('aria-pressed') === 'true'
      );
      if (mobile) {
        await click('.inline-fullscreen');
        await page.waitForFunction(() => document.querySelector('video').vsc.iosPlayer.active);
        await click('[data-ref="more"]', true);
        await click('[data-ref="airplay"]', true);
        assert.true(
          await page.evaluate(
            () => window.pickerCalls.length === 2 && window.pickerCalls[1].activated
          ),
          'More uses the same native picker with active input'
        );
      }
      const directory = resolve('tests/e2e/screenshots');
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(directory, `airplay-${mobile ? 'mobile' : 'desktop'}.png`),
      });
      errors.assertNone(`AirPlay ${mobile ? 'mobile' : 'desktop'} fixture`);
      console.log(`AirPlay ${mobile ? 'mobile' : 'desktop'} controls passed (simulated picker)`);
    }
    return { passed: 2, failed: 0 };
  } finally {
    errors?.dispose();
    try {
      await browser?.close();
    } finally {
      await server?.stop();
    }
  }
}

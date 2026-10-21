/** Read-only geometry evidence for real X and small project-owned inline media. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, launchChromeWithExtension, monitorPageErrors } from './e2e-utils.js';
import { startFixtureServer } from './fixture-server.js';
const ua =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const pause = () => new Promise((r) => setTimeout(r, 600));
function measure() {
  const rect = (n) => {
    const r = n?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  };
  return Array.from(document.querySelectorAll('video')).map((video) => {
    const root = video.vsc?.div?.shadowRoot,
      media = rect(video),
      controller = root?.querySelector('#controller');
    const clip = {
      left: media.x,
      top: media.y,
      right: media.x + media.width,
      bottom: media.y + media.height,
    };
    for (let node = video.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node),
        r = node.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, r.left);
        clip.right = Math.min(clip.right, r.right);
      }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, r.top);
        clip.bottom = Math.min(clip.bottom, r.bottom);
      }
    }
    return {
      available: clip,
      revealed: video.vsc?.div.classList.contains('vsc-show'),
      display: controller && getComputedStyle(controller).display,
      media,
      ready: video.readyState,
      controlled: !!video.vsc,
      controller: rect(controller),
      opacity: controller && getComputedStyle(controller).opacity,
      targets: ['.draggable', '.inline-fullscreen'].map((selector) => {
        const node = root?.querySelector(selector),
          bounds = rect(node);
        return {
          selector,
          bounds,
          display: node && getComputedStyle(node).display,
          fontSize: node && getComputedStyle(node).fontSize,
          text: node?.textContent,
          ownHit: (() => {
            if (!bounds?.width || !bounds?.height) {
              return false;
            }
            const hit = document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2
            );
            return hit === video.vsc?.div || hit?.getRootNode()?.host === video.vsc?.div;
          })(),
          withinViewport:
            bounds &&
            bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= innerWidth &&
            bounds.y + bounds.height <= innerHeight,
          withinClip:
            bounds &&
            bounds.x >= clip.left - 1 &&
            bounds.y >= clip.top - 1 &&
            bounds.x + bounds.width <= clip.right + 1 &&
            bounds.y + bounds.height <= clip.bottom + 1,
          withinMedia:
            bounds &&
            bounds.x >= media.x - 1 &&
            bounds.y >= media.y - 1 &&
            bounds.x + bounds.width <= media.x + media.width + 1 &&
            bounds.y + bounds.height <= media.y + media.height + 1,
        };
      }),
    };
  });
}
export default async function runTwitterVisual({ launch = launchChromeWithExtension } = {}) {
  let browser, fixtures, errors;
  let passed = 0,
    failed = 0;
  try {
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    await page.setUserAgent(ua);
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await mkdir(resolve('tests/e2e/screenshots'), { recursive: true });
    try {
      await page.goto('https://x.com/NASA', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await pause();
      if (
        await page.evaluate(() => document.body.innerText.includes('Get the full app experience'))
      ) {
        await page.touchscreen.tap(358, 30);
        await pause();
      }
      await page.mouse.move(340, 650);
      await page.mouse.wheel({ deltaY: 900 });
      await pause();
      if (
        await page.evaluate(() => document.body.innerText.includes('Get the full app experience'))
      ) {
        await page.touchscreen.tap(358, 30);
        await pause();
      }
      const publicGeometry = await page.evaluate(measure);
      console.log(`Visual actual public X390: ${JSON.stringify(publicGeometry)}`);
      if (
        !(await page.evaluate(() =>
          document.body.innerText.includes('Get the full app experience')
        ))
      ) {
        const visible = publicGeometry
          .flatMap((video) => video.targets)
          .filter((target) => target.bounds?.width > 0 && target.withinViewport);
        if (visible.length) {
          assert.true(
            visible.every((target) => target.ownHit),
            `Public X targets must not sit behind site header: ${JSON.stringify(publicGeometry)}`
          );
        } else {
          console.log('Public X hit-test unavailable: no on-screen controlled media target.');
        }
      } else {
        console.log(
          'Public X hit-test blocked by returning site promotion; not counted as a pass.'
        );
      }
      await page.screenshot({
        path: resolve('tests/e2e/screenshots/twitter-inline-actual-390.png'),
      });
    } catch (error) {
      console.log(`Public X visual BLOCKED: ${error.message}`);
    }
    fixtures = await startFixtureServer();
    await page.goto(`${fixtures.baseUrl}/mobile.html?owned`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        document.querySelector('video')?.vsc?.iosPlayer?.attached &&
        document.querySelector('video').readyState >= 2
    );
    await page.tap('#play');
    for (const [width, height] of [
      [360, 203],
      [180, 101],
      [120, 68],
      [80, 60],
      [80, 45],
    ]) {
      await page.evaluate(
        (w, h) => {
          const v = document.querySelector('video');
          v.style.cssText = `width:${w}px;height:${h}px`;
          v.parentElement.style.cssText = `width:${w}px;margin:12px;overflow:hidden;`;
        },
        width,
        height
      );
      await pause();
      const geometry = (await page.evaluate(measure))[0];
      console.log(`Visual controlled ${width}x${height}: ${JSON.stringify(geometry)}`);
      await page.screenshot({
        path: resolve(`tests/e2e/screenshots/twitter-inline-small-${width}x${height}.png`),
      });
      const visible = geometry.targets.filter(
        (target) => target.bounds?.width > 0 && target.bounds?.height > 0
      );
      if (width < 52 || height < 52) {
        assert.equal(
          visible.length,
          0,
          `Undersize media must not clip targets: ${JSON.stringify(geometry)}`
        );
      } else {
        const tiny = width < 180 || height < 96;
        assert.equal(
          visible.length,
          tiny ? 1 : 2,
          `Adaptive target count: ${JSON.stringify(geometry)}`
        );
        assert.true(
          visible.every(
            (target) =>
              target.bounds.width >= 44 && target.bounds.height >= 44 && target.withinMedia
          ),
          `Every visible target must fit media: ${JSON.stringify(geometry)}`
        );
        assert.true(
          geometry.controller.height <= 46,
          `Primary row must stay compact: ${JSON.stringify(geometry)}`
        );
        if (!tiny) {
          assert.true(
            geometry.controller.width <= 96,
            `Default primary cluster should be92px wide: ${JSON.stringify(geometry)}`
          );
          assert.true(
            Math.abs(visible[0].bounds.y - visible[1].bounds.y) <= 1,
            'Speed and fullscreen targets must align'
          );
          assert.equal(
            visible[0].text.trim(),
            '1',
            'Inline rate label should omit redundant zeroes'
          );
        }
      }
      errors.assertNone(`inline visual${width}`);
      passed++;
    }
    for (const [width, height] of [
      [180, 102],
      [120, 68],
    ]) {
      await page.evaluate(
        (w, h) => {
          const v = document.querySelector('video');
          v.style.cssText = 'width:360px;height:203px';
          v.parentElement.style.cssText = `position:relative;width:${w}px;height:${h}px;margin:12px;overflow:hidden;`;
        },
        width,
        height
      );
      await pause();
      const geometry = (await page.evaluate(measure))[0];
      console.log(`Visual crop ${width}x${height}: ${JSON.stringify(geometry)}`);
      await page.screenshot({
        path: resolve(`tests/e2e/screenshots/twitter-inline-crop-${width}x${height}.png`),
      });
      const visible = geometry.targets.filter(
        (target) => target.bounds?.width > 0 && target.bounds?.height > 0
      );
      assert.equal(
        visible.length,
        width < 180 || height < 96 ? 1 : 2,
        'Crop intersection must select the adaptive target count'
      );
      assert.true(
        visible.every(
          (target) => target.bounds.width >= 44 && target.bounds.height >= 44 && target.withinClip
        ),
        `Cropped wrapper clips inline target: ${JSON.stringify(geometry)}`
      );
      errors.assertNone(`crop${width}`);
      passed++;
    }
    await page.evaluate(() => {
      const v = document.querySelector('video');
      v.style.cssText = 'width:360px;height:203px';
      v.parentElement.style.cssText =
        'position:relative;width:360px;height:203px;margin:12px;overflow:hidden';
    });
    await pause();
    await page.keyboard.press('d');
    await page.waitForFunction(() =>
      document.querySelector('video').vsc.div.classList.contains('vsc-show')
    );
    const flash = (await page.evaluate(measure))[0];
    console.log(`Visual genuine speed flash: ${JSON.stringify(flash)}`);
    await page.screenshot({
      path: resolve('tests/e2e/screenshots/twitter-inline-speed-flash.png'),
    });
    assert.true(
      flash.revealed &&
        ['flex', 'inline-flex'].includes(flash.display) &&
        Math.abs(flash.targets[0].bounds.y - flash.targets[1].bounds.y) <= 1,
      `Speed flash must retain inline alignment: ${JSON.stringify(flash)}`
    );
    errors.assertNone('speedflash');
    passed++;
    await page.evaluate(() => {
      const header = document.createElement('header');
      header.id = 'fixture-sticky-header';
      header.textContent = 'Sticky site header';
      header.style.cssText =
        'position:fixed;top:0;left:0;right:0;height:56px;z-index:2147483647;background:#176180;color:white;font:16px system-ui;';
      document.body.append(header);
      const v = document.querySelector('video');
      v.style.cssText = 'width:360px;height:204px';
      v.parentElement.style.cssText =
        'position:absolute;left:12px;top:0;width:360px;height:204px;overflow:hidden;';
    });
    await pause();
    const sticky = (await page.evaluate(measure))[0];
    console.log(`Visual controlled sticky header: ${JSON.stringify(sticky)}`);
    await page.screenshot({
      path: resolve('tests/e2e/screenshots/twitter-inline-sticky-header.png'),
    });
    assert.true(
      sticky.targets.every((target) => target.bounds.y >= 56 && target.ownHit && target.withinClip),
      `Sticky site header obscures inline controls: ${JSON.stringify(sticky)}`
    );
    const speedTarget = sticky.targets[0].bounds;
    await page.touchscreen.tap(
      speedTarget.x + speedTarget.width / 2,
      speedTarget.y + speedTarget.height / 2
    );
    await page.waitForFunction(() =>
      document.querySelector('video').vsc.div.classList.contains('vsc-touch-open')
    );
    const close = await page.evaluate(() => {
      const r = document
        .querySelector('video')
        .vsc.div.shadowRoot.querySelector('[data-action=close]')
        .getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.touchscreen.tap(close.x + close.width / 2, close.y + close.height / 2);
    const nativeBefore = await page.evaluate(
      () => window.__stayfastOwnedFixture.nativeFullscreenCalls
    );
    const full = sticky.targets[1].bounds;
    await page.touchscreen.tap(full.x + full.width / 2, full.y + full.height / 2);
    await page.waitForFunction(
      (before) => window.__stayfastOwnedFixture.nativeFullscreenCalls === before + 1,
      {},
      nativeBefore
    );
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('vsc-ios-player').length),
      0,
      'Header avoidance must keep the direct fullscreen action accessible'
    );
    console.log('Sticky header genuine speed-open/close and direct fullscreen taps succeeded.');
    errors.assertNone('stickyheader');
    passed++;
    await page.evaluate(() => {
      const video = document.querySelector('video'),
        player = video.parentElement,
        header = document.querySelector('#fixture-sticky-header');
      for (const node of document.body.children) {
        if (node !== player && node !== header) {
          node.style.visibility = 'hidden';
        }
      }
      video.style.cssText = 'width:360px;height:205px';
      player.style.cssText =
        'position:absolute;left:12px;top:100px;width:360px;height:205px;overflow:hidden;';
      window.__visualRatios = [];
      window.__visualRatioObserver = new IntersectionObserver(
        (entries) => window.__visualRatios.push(...entries.map((entry) => entry.intersectionRatio)),
        { threshold: [0, 1] }
      );
      window.__visualRatioObserver.observe(video);
    });
    await pause();
    const scrollBefore = (await page.evaluate(measure))[0];
    assert.true(
      Math.abs(scrollBefore.media.y - 100) <= 1 &&
        scrollBefore.targets.every((target) => target.ownHit),
      'Wheel fixture must start fully visible below the header'
    );
    await page.mouse.move(375, 650);
    await page.mouse.wheel({ deltaY: 80 });
    await page.waitForFunction(() => scrollY >= 70);
    await pause();
    const wheel = (await page.evaluate(measure))[0];
    const wheelState = await page.evaluate(() => ({
      pageY: scrollY,
      ratios: window.__visualRatios.slice(),
    }));
    console.log(
      `Visual sticky genuine wheel: ${JSON.stringify({ geometry: wheel, ...wheelState })}`
    );
    await page.screenshot({
      path: resolve('tests/e2e/screenshots/twitter-inline-sticky-wheel.png'),
    });
    assert.true(
      wheel.media.y >= 0 &&
        wheel.media.y + wheel.media.height < 844 &&
        wheelState.ratios.length > 0 &&
        wheelState.ratios.every((ratio) => ratio >= 0.999),
      'Intersection ratio must stay1 through genuine scrolling'
    );
    assert.true(
      wheel.targets.every((target) => target.bounds.y >= 56 && target.ownHit && target.withinClip),
      `Window scroll left controls behind header without an IO threshold: ${JSON.stringify(wheel)}`
    );
    const documentY = wheelState.pageY;
    await page.evaluate(() => {
      const video = document.querySelector('video'),
        player = video.parentElement,
        viewport = document.createElement('div'),
        content = document.createElement('div');
      viewport.id = 'visual-nested-scroll';
      viewport.style.cssText = `position:absolute;top:${scrollY}px;left:12px;width:360px;height:500px;overflow:auto;`;
      content.style.cssText = 'padding-top:100px;min-height:1200px;';
      document.body.append(viewport);
      viewport.append(content);
      content.append(player);
      player.style.cssText =
        'position:relative;left:0;top:0;margin:0;width:360px;height:206px;overflow:hidden';
      video.style.cssText = 'width:360px;height:206px';
      window.__visualRatios.length = 0;
    });
    await pause();
    await page.evaluate(() => (document.querySelector('#visual-nested-scroll').scrollTop = 80));
    await pause();
    const nested = (await page.evaluate(measure))[0],
      nestedState = await page.evaluate(() => ({
        pageY: scrollY,
        nestedY: document.querySelector('#visual-nested-scroll').scrollTop,
        ratios: window.__visualRatios.slice(),
      }));
    console.log(
      `Visual sticky programmatic nested scroll: ${JSON.stringify({ geometry: nested, ...nestedState })}`
    );
    await page.screenshot({
      path: resolve('tests/e2e/screenshots/twitter-inline-sticky-nested.png'),
    });
    assert.equal(nestedState.pageY, documentY, 'Nested layout refresh must not move the document');
    assert.equal(nestedState.nestedY, 80, 'Programmatic nested scroll must remain intentional');
    assert.true(
      nested.targets.every((target) => target.bounds.y >= 56 && target.ownHit && target.withinClip),
      `Nested scroll left controls behind the header: ${JSON.stringify(nested)}`
    );
    assert.equal(
      nested.targets[0].text,
      wheel.targets[0].text,
      'Scroll refresh must preserve the accepted compact speed label'
    );
    await page.evaluate(() => window.__visualRatioObserver.disconnect());
    errors.assertNone('scrollpositionrefresh');
    passed++;
  } catch (error) {
    failed++;
    console.error(`Inline visual failed: ${error.stack || error.message}`);
  } finally {
    errors?.dispose();
    await browser?.close();
    await fixtures?.stop();
  }
  console.log(
    `Inline visual checks: ${passed} passed, ${failed} failed; public X availability separate`
  );
  return { passed, failed };
}

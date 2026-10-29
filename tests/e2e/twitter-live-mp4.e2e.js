import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { assert, monitorPageErrors } from './e2e-utils.js';

/** Actual public X SDK and CDN; Chromium touch emulation, not native Safari. */
export default async function runTwitterLiveMP4({ launch }) {
  let browser, page, errors;
  let flow;
  const network = [];
  let networkStart = Date.now();
  const output = 'test-results/twitter-mse-fix';
  await mkdir(output, { recursive: true });
  try {
    const directory = process.env.STAYFAST_EXTENSION_DIR || 'dist';
    const expected = process.env.STAYFAST_EXPECTED_INJECT_SHA256;
    const injectHash = createHash('sha256')
      .update(await readFile(resolve(directory, 'inject.js')))
      .digest('hex');
    await writeFile(
      `${output}/live-x-extension-identity.json`,
      JSON.stringify(
        { directory: resolve(directory), injectSha256: injectHash, expectedInjectSha256: expected },
        null,
        2
      )
    );
    if (expected) {
      assert.equal(
        injectHash,
        expected,
        'Selected extension does not match the reviewed injection bundle'
      );
    }
    const launched = await launch();
    browser = launched.browser;
    page = launched.page;
    networkStart = Date.now();
    const safeURL = (raw) => {
      try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
      } catch {
        return '';
      }
    };
    page.on('response', (response) => {
      if (network.length >= 150 || new URL(response.url()).hostname !== 'video.twimg.com') {
        return;
      }
      const headers = response.headers();
      network.push({
        ms: Date.now() - networkStart,
        url: safeURL(response.url()),
        status: response.status(),
        range: headers['content-range'] || null,
        type: headers['content-type'] || null,
      });
    });
    page.on('requestfailed', (request) => {
      if (network.length >= 150 || new URL(request.url()).hostname !== 'video.twimg.com') {
        return;
      }
      network.push({
        ms: Date.now() - networkStart,
        url: safeURL(request.url()),
        error: request.failure()?.errorText || 'unknown',
      });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    errors = monitorPageErrors(page);
    const target =
      process.env.STAYFAST_TWITTER_URL || 'https://x.com/davis7/status/2115566875904237717';
    for (flow of ['inline', 'fullscreen']) {
      network.length = 0;
      networkStart = Date.now();
      await page.goto(target, {
        waitUntil: 'domcontentloaded',
      });
      await page.evaluate((target) => {
        const expected = new URL(target);
        const status = expected.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/i);
        if (!/^(?:www\.)?(?:x|twitter)\.com$/.test(expected.hostname) || !status) {
          throw new Error('Live target must be an exact X post permalink');
        }
        // Feed timestamps identify their article. The post-detail layout omits
        // that link, so also accept the production-validated SDK's exact source ID.
        // Neither route may silently select an unrelated recommendation.
        window.__stayfastLiveTarget = () => {
          const articles = [...document.querySelectorAll('article')].filter(
            (article) =>
              [...article.querySelectorAll('a[href]')].some((anchor) => {
                if (anchor.closest('article') !== article || !anchor.querySelector('time')) {
                  return false;
                }
                try {
                  const url = new URL(anchor.href);
                  const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/i);
                  return (
                    /^(?:www\.)?(?:x|twitter)\.com$/.test(url.hostname) &&
                    match &&
                    match[1].toLowerCase() === status[1].toLowerCase() &&
                    match[2] === status[2]
                  );
                } catch {
                  return false;
                }
              }) ||
              [...article.querySelectorAll('video')].some((video) => {
                if (video.closest('article') !== article) {
                  return false;
                }
                try {
                  const candidate = window.VSC?.TwitterPlayer?.resolve(video);
                  return candidate?.api.getState().content.sourceId === status[2];
                } catch {
                  return false;
                }
              })
          );
          const videos =
            articles.length === 1
              ? [...articles[0].querySelectorAll('video')].filter(
                  (video) => video.closest('article') === articles[0]
                )
              : [];
          return { articles: articles.length, videos, status: status[2] };
        };
      }, target);
      await page.waitForFunction(
        () => {
          const found = window.__stayfastLiveTarget();
          return (
            found.articles === 1 &&
            found.videos.length === 1 &&
            found.videos[0].vsc &&
            found.videos[0].readyState >= 2
          );
        },
        { timeout: 45000 }
      );
      await page.evaluate(() => {
        const found = window.__stayfastLiveTarget();
        if (found.articles !== 1 || found.videos.length !== 1) {
          throw new Error('Requested post has absent or ambiguous media');
        }
        const original = found.videos[0];
        window.__stayfastLiveProbe = {
          original,
          source: original.currentSrc,
          parent: original.parentElement,
          samples: [],
          trustedEvents: [],
          controls: [],
        };
        const started = performance.now();
        const cleanURL = (raw) => {
          try {
            const url = new URL(raw);
            return url.protocol === 'blob:' ? url.href : `${url.origin}${url.pathname}`;
          } catch {
            return '';
          }
        };
        const describe = (node) =>
          node?.nodeType === 1
            ? {
                tag: node.localName,
                label: node.getAttribute('aria-label')?.slice(0, 100),
                action: node.getAttribute('data-action'),
                testid: node.getAttribute('data-testid')?.slice(0, 100),
              }
            : null;
        const record = (event) => {
          const probe = window.__stayfastLiveProbe;
          if (probe.trustedEvents.length >= 40) {
            return;
          }
          const point = event.touches?.[0] || event;
          probe.trustedEvents.push({
            type: event.type,
            trusted: event.isTrusted,
            x: point.clientX,
            y: point.clientY,
            target: describe(event.target),
            path: event.composedPath().slice(0, 8).map(describe).filter(Boolean),
          });
        };
        for (const type of ['pointerdown', 'click']) {
          window.addEventListener(type, record, { capture: true, passive: true });
        }
        setTimeout(() => {
          for (const type of ['pointerdown', 'click']) {
            window.removeEventListener(type, record, true);
          }
        }, 20000);
        const sample = () => {
          const read = (callback) => {
            try {
              return callback();
            } catch (error) {
              return `error:${error.name}`;
            }
          };
          const probe = window.__stayfastLiveProbe;
          const controlled = window.VSC.stateManager
            .getControlledElements()
            .find((video) => video !== original);
          const session =
            window.VSC.TwitterMP4Playback.getPending(original) ||
            (controlled && window.VSC.TwitterMP4Playback.get(controlled));
          const native = session?.video || controlled;
          probe.samples.push({
            ms: performance.now() - started,
            original: {
              src: cleanURL(original.currentSrc || original.src),
              paused: original.paused,
              time: original.currentTime,
              ready: original.readyState,
              controlled: !!original.vsc,
              parentUnchanged: original.parentElement === probe.parent,
            },
            pending: !!window.VSC.TwitterMP4Playback.getPending(original),
            session: session
              ? {
                  closed: session.closed,
                  committed: session.committed,
                  finished: session.finished,
                  playing: session.playing,
                  ready: session.ready,
                  candidateURL: cleanURL(session.candidate?.progressiveUrl),
                  current: read(() => session.current()),
                  identityCurrent: read(() => session.identityCurrent()),
                }
              : null,
            native: native
              ? {
                  src: cleanURL(native.src),
                  currentSrc: cleanURL(native.currentSrc),
                  ready: native.readyState,
                  network: native.networkState,
                  error: native.error
                    ? { code: native.error.code, message: native.error.message }
                    : null,
                  time: native.currentTime,
                  paused: native.paused,
                  rate: native.playbackRate,
                  controlled: !!native.vsc,
                  owned: !!native.vsc?.iosPlayer?.active,
                }
              : null,
          });
        };
        sample();
        const interval = setInterval(sample, 100);
        setTimeout(() => clearInterval(interval), 12000);
      });
      if (await page.$('[data-interaction="app-store-obstruction"][data-state="open"]')) {
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () =>
            !document.querySelector('[data-interaction="app-store-obstruction"][data-state="open"]')
        );
      }
      // Enter at 1x BEFORE changing speed: the original MSE must never be portaled.
      const videoHandle = await page.evaluateHandle(() => window.__stayfastLiveProbe.original);
      const rect = await videoHandle.asElement().boundingBox();
      if (
        await page.evaluate(
          (video) => video.vsc.div.hasAttribute('data-vsc-inline-idle'),
          videoHandle
        )
      ) {
        await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
      }
      await page.waitForFunction(() => {
        const video = window.__stayfastLiveProbe.original;
        return !video.vsc.div.hasAttribute('data-vsc-inline-idle');
      });
      const inspectControl = async (selector, phase) =>
        page.evaluate(
          ({ selector, phase }) => {
            const probe = window.__stayfastLiveProbe;
            const video =
              window.VSC.stateManager
                .getControlledElements()
                .find(
                  (video) => window.VSC.TwitterMP4Playback.get(video)?.original === probe.original
                ) || probe.original;
            const host = video.vsc?.div;
            const button = host?.shadowRoot?.querySelector(selector);
            const rect = button?.getBoundingClientRect();
            const x = rect ? rect.x + rect.width / 2 : 0;
            const y = rect ? rect.y + rect.height / 2 : 0;
            const hit = document.elementFromPoint(x, y);
            const shadowHit = hit?.shadowRoot?.elementFromPoint(x, y);
            const describe = (node) =>
              node?.nodeType === 1
                ? {
                    tag: node.localName,
                    label: node.getAttribute('aria-label')?.slice(0, 100),
                    action: node.getAttribute('data-action'),
                    testid: node.getAttribute('data-testid')?.slice(0, 100),
                  }
                : null;
            const layout = (node) => {
              if (!node || node.nodeType !== 1) {
                return null;
              }
              const css = getComputedStyle(node);
              return {
                ...describe(node),
                rect: node.getBoundingClientRect().toJSON(),
                display: css.display,
                visibility: css.visibility,
                opacity: css.opacity,
                pointerEvents: css.pointerEvents,
                zIndex: css.zIndex,
                position: css.position,
                overflow: css.overflow,
                transform: css.transform,
                attrs: [...node.attributes]
                  .filter(
                    ({ name }) =>
                      name.startsWith('data-vsc') || ['class', 'hidden', 'inert'].includes(name)
                  )
                  .slice(0, 12)
                  .map(({ name, value }) => [name, value.slice(0, 200)]),
              };
            };
            const ancestors = (node) => {
              const result = [];
              for (let i = 0; node && i < 8; i++) {
                result.push(layout(node));
                node = node.parentElement || node.getRootNode()?.host;
              }
              return result.filter(Boolean);
            };
            let canBegin;
            try {
              canBegin = window.VSC.TwitterMP4Playback.canBegin(
                probe.original.vsc,
                1,
                'presentation'
              );
            } catch (error) {
              canBegin = error.name;
            }
            const site = video.vsc?.iosPlayer?.siteControls;
            const hittable =
              !!button &&
              (shadowHit === button ||
                button.contains(shadowHit) ||
                hit === button ||
                button.contains(hit));
            probe.controls.push({
              phase,
              selector,
              button: layout(button),
              disabled: button?.disabled,
              connected: button?.isConnected,
              hittable,
              hit: layout(hit),
              shadowHit: layout(shadowHit),
              stack: document.elementsFromPoint(x, y).slice(0, 8).map(layout),
              buttonAncestors: ancestors(button),
              hitAncestors: ancestors(hit),
              host: layout(host),
              controller: layout(host?.shadowRoot?.querySelector('#controller')),
              inlineOwned: video.vsc?.controlsManager?.inlinePlayer?.owned,
              siteContainer: layout(site?.container),
              siteProfile: site?.profile?.controls?.slice(0, 12),
              iosSupported: window.VSC.IOSPlayer.isSupported(video),
              twitterHost: window.VSC.EventManager.isTwitterHost(location.hostname),
              canBegin,
              pending: !!window.VSC.TwitterMP4Playback.getPending(probe.original),
              presentationAPI: typeof window.VSC.TwitterMP4Playback.open,
            });
            return hittable;
          },
          { selector, phase }
        );
      const tapControl = async (selector, phase) => {
        await page
          .waitForFunction(
            (selector) => {
              const original = window.__stayfastLiveProbe.original;
              const video =
                window.VSC.stateManager
                  .getControlledElements()
                  .find(
                    (video) => window.VSC.TwitterMP4Playback.get(video)?.original === original
                  ) || original;
              const button = video.vsc?.div?.shadowRoot?.querySelector(selector);
              if (!button) {
                return false;
              }
              const rect = button.getBoundingClientRect();
              if (!rect.width || !rect.height) {
                return false;
              }
              const x = rect.x + rect.width / 2,
                y = rect.y + rect.height / 2;
              let hit = document.elementFromPoint(x, y);
              for (let depth = 0; hit?.shadowRoot && depth < 8; depth++) {
                const inner = hit.shadowRoot.elementFromPoint(x, y);
                if (!inner || inner === hit) {
                  break;
                }
                hit = inner;
              }
              return hit === button || button.contains(hit);
            },
            { timeout: 5000 },
            selector
          )
          .catch(async () => {
            await inspectControl(selector, `${phase}-readiness-timeout`);
          });
        const hittable = await inspectControl(selector, `${phase}-before`);
        const handle = await page.evaluateHandle((selector) => {
          const probe = window.__stayfastLiveProbe;
          const video =
            window.VSC.stateManager
              .getControlledElements()
              .find(
                (video) => window.VSC.TwitterMP4Playback.get(video)?.original === probe.original
              ) || probe.original;
          return video.vsc.div.shadowRoot.querySelector(selector);
        }, selector);
        await handle.asElement().tap();
        await handle.dispose();
        await inspectControl(selector, `${phase}-after`);
        if (!hittable) {
          // Diagnose stale placement after retaining the failed trusted tap.
          // This refresh cannot turn the failed acceptance assertion into a pass.
          await page.evaluate(() => {
            const controller = window.__stayfastLiveProbe.original.vsc;
            controller?.positionControls(controller.div);
          });
          await inspectControl(selector, `${phase}-diagnostic-layout-refresh`);
        }
        assert.true(
          hittable,
          `${phase}: the actual UI target is obstructed (see controls/input trace)`
        );
      };
      if (flow === 'inline') {
        const current = () =>
          page.evaluate(() => {
            const probe = window.__stayfastLiveProbe;
            const video =
              window.VSC.stateManager
                .getControlledElements()
                .find(
                  (video) => window.VSC.TwitterMP4Playback.get(video)?.original === probe.original
                ) || probe.original;
            return {
              open: video.vsc?.div.classList.contains('vsc-touch-open'),
              idle: video.vsc?.div.hasAttribute('data-vsc-inline-idle'),
              rect: video.getBoundingClientRect().toJSON(),
              rate: video.playbackRate,
            };
          });
        const openSpeeds = async () => {
          const state = await current();
          if (state.idle) {
            await page.touchscreen.tap(
              state.rect.x + state.rect.width / 2,
              state.rect.y + state.rect.height / 2
            );
            await page.waitForFunction(() => {
              const original = window.__stayfastLiveProbe.original;
              const video =
                window.VSC.stateManager
                  .getControlledElements()
                  .find(
                    (video) => window.VSC.TwitterMP4Playback.get(video)?.original === original
                  ) || original;
              return !video.vsc?.div.hasAttribute('data-vsc-inline-idle');
            });
          }
          if (!(await current()).open) {
            await tapControl('.draggable', 'inline-open-speeds');
            await page.waitForFunction(() =>
              window.VSC.stateManager
                .getControlledElements()
                .some((video) => video.vsc.div.classList.contains('vsc-touch-open'))
            );
          }
        };
        const measureInline = async (rate) => {
          await page.waitForFunction(
            (rate) => {
              const original = window.__stayfastLiveProbe.original;
              const native = window.VSC.stateManager
                .getControlledElements()
                .find((video) => window.VSC.TwitterMP4Playback.get(video)?.original === original);
              return (
                native &&
                native.playbackRate === rate &&
                !native.paused &&
                !native.vsc.iosPlayer.active &&
                native.readyState >= 2
              );
            },
            { timeout: 15000 },
            rate
          );
          const report = await page.evaluate(async (rate) => {
            const { original, parent, source } = window.__stayfastLiveProbe;
            const native = window.VSC.stateManager
              .getControlledElements()
              .find((video) => window.VSC.TwitterMP4Playback.get(video)?.original === original);
            const start = performance.now(),
              time = native.currentTime;
            let frames = 0,
              lastFrame = start,
              maxGapMs = 0;
            await new Promise((resolve, reject) => {
              let handle;
              const deadline = setTimeout(() => {
                native.cancelVideoFrameCallback(handle);
                reject(new Error('Inline MP4 stopped producing frames'));
              }, 10000);
              const frame = (now) => {
                frames++;
                maxGapMs = Math.max(maxGapMs, now - lastFrame);
                lastFrame = now;
                if (now - start >= 4000) {
                  clearTimeout(deadline);
                  resolve();
                } else {
                  handle = native.requestVideoFrameCallback(frame);
                }
              };
              handle = native.requestVideoFrameCallback(frame);
            });
            return {
              requestedRate: rate,
              rate: native.playbackRate,
              paused: native.paused,
              frames,
              maxGapMs,
              ratio: (native.currentTime - time) / ((performance.now() - start) / 1000),
              ownedFullscreen: native.vsc.iosPlayer.active,
              originalSourceUnchanged: original.currentSrc === source,
              originalParentUnchanged: original.parentElement === parent,
              originalPaused: original.paused,
              originalConnected: original.isConnected,
            };
          }, rate);
          await writeFile(`${output}/live-x-inline-${rate}x.json`, JSON.stringify(report, null, 2));
          assert.true(
            report.originalConnected &&
              report.originalParentUnchanged &&
              report.originalSourceUnchanged &&
              report.originalPaused &&
              !report.ownedFullscreen
          );
          assert.true(
            !report.paused &&
              report.rate === rate &&
              report.frames >= 60 &&
              report.maxGapMs < 1000 &&
              report.ratio > rate * 0.85 &&
              report.ratio < rate * 1.15,
            JSON.stringify(report)
          );
        };
        await openSpeeds();
        await tapControl('[data-action="setSpeed"][data-value="2"]', 'inline-2x-preset');
        await tapControl('[data-action="faster"]', 'inline-2.1x');
        await measureInline(2.1);
        await openSpeeds();
        for (let i = 0; i < 19; i++) {
          await tapControl('[data-action="faster"]', `inline-speed-increase-${i + 1}`);
        }
        await measureInline(4);
        // Reset through the real inline UI, then exercise owned presentation/handback.
        await tapControl('[data-action="setSpeed"][data-value="1"]', 'inline-reset-1x');
      }
      await tapControl('[aria-label="Open video fullscreen"]', `${flow}-fullscreen`);
      await videoHandle.dispose();
      await page.waitForFunction(
        () => window.VSC.stateManager.getControlledElements()[0]?.vsc.iosPlayer.active
      );
      await page.waitForFunction(() => {
        const { original, source, parent } = window.__stayfastLiveProbe;
        const native = window.VSC.stateManager.getControlledElements()[0];
        return (
          window.VSC.TwitterMP4Playback.isRetained(original) &&
          original.parentElement === parent &&
          original.currentSrc === source &&
          native !== original &&
          native.playbackRate === 1 &&
          !native.paused &&
          native.vsc.iosPlayer.active
        );
      });
      await writeFile(
        `${output}/live-x-${flow}-1x-entry.json`,
        JSON.stringify(
          await page.evaluate(() => {
            const { original, source, parent } = window.__stayfastLiveProbe;
            const native = window.VSC.stateManager.getControlledElements()[0];
            return {
              originalParentUnchanged: original.parentElement === parent,
              originalSourceUnchanged: original.currentSrc === source,
              nativeRate: native.playbackRate,
              ownedFullscreen: native.vsc.iosPlayer.active,
            };
          }),
          null,
          2
        )
      );
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('d');
      }
      await page.waitForFunction(() => {
        const original = window.__stayfastLiveProbe.original;
        const controlled = window.VSC.stateManager.getControlledElements();
        return (
          window.VSC.TwitterMP4Playback.isRetained(original) &&
          controlled.length === 1 &&
          controlled[0] !== original &&
          controlled[0].playbackRate === 4
        );
      });
      // Measure startup playback; downloading the entire clip would hide buffering failures.
      const report = await page.evaluate(async () => {
        const { original, source, parent } = window.__stayfastLiveProbe;
        const video = window.VSC.stateManager.getControlledElements()[0];
        const start = performance.now();
        let lastTime = video.currentTime,
          elapsed = 0,
          frames = 0,
          lastFrame = start,
          maxGapMs = 0;
        await new Promise((resolve, reject) => {
          let handle;
          const deadline = setTimeout(() => {
            video.cancelVideoFrameCallback(handle);
            reject(new Error('Live MP4 stopped producing frames'));
          }, 10000);
          const frame = (now) => {
            frames++;
            maxGapMs = Math.max(maxGapMs, now - lastFrame);
            lastFrame = now;
            const delta = video.currentTime - lastTime;
            elapsed += delta < -0.5 && video.loop ? video.duration + delta : delta;
            lastTime = video.currentTime;
            if (now - start >= 4000) {
              clearTimeout(deadline);
              resolve();
            } else {
              handle = video.requestVideoFrameCallback(frame);
            }
          };
          handle = video.requestVideoFrameCallback(frame);
        });
        return {
          originalConnected: original.isConnected,
          originalParentUnchanged: original.parentElement === parent,
          ownedFullscreen: video.vsc.iosPlayer.active,
          originalSourceUnchanged: original.src === source && original.currentSrc === source,
          originalPaused: original.paused,
          mp4: /^https:\/\/video\.twimg\.com\/.+\.mp4(?:\?|$)/.test(video.currentSrc),
          rate: video.playbackRate,
          paused: video.paused,
          frames,
          maxGapMs,
          ratio: elapsed / ((performance.now() - start) / 1000),
        };
      });
      assert.true(
        report.originalConnected &&
          report.originalParentUnchanged &&
          report.originalSourceUnchanged &&
          report.originalPaused &&
          report.ownedFullscreen
      );
      assert.true(report.mp4 && !report.paused && report.rate === 4);
      assert.true(
        report.frames >= 60 && report.maxGapMs < 1000 && report.ratio > 3.5 && report.ratio < 4.5,
        JSON.stringify(report)
      );
      await writeFile(`${output}/live-x-${flow}-4x.json`, JSON.stringify(report, null, 2));
      await page.screenshot({ path: `${output}/live-x-${flow}-4x.png` });
      const stage = await page.evaluateHandle(
        () => window.VSC.stateManager.getControlledElements()[0].vsc.iosPlayer.ui.stage
      );
      if (
        await page.evaluate(() =>
          window.VSC.stateManager
            .getControlledElements()[0]
            .vsc.iosPlayer.ui.host.hasAttribute('data-controls-hidden')
        )
      ) {
        await stage.asElement().tap();
      }
      await stage.dispose();
      await page.waitForFunction(
        () =>
          !window.VSC.stateManager
            .getControlledElements()[0]
            .vsc.iosPlayer.ui.host.hasAttribute('data-controls-hidden')
      );
      // Leave the persisted user preference at 1x for the next independent navigation.
      const normal = await page.evaluateHandle(
        () => window.VSC.stateManager.getControlledElements()[0].vsc.iosPlayer.ui.refs.normal
      );
      await normal.asElement().tap();
      await normal.dispose();
      await page.waitForFunction(() => {
        const video = window.VSC.stateManager.getControlledElements()[0];
        return video.playbackRate === 1 && !video.vsc.config.saveTimer;
      });
      for (const name of ['more', 'site']) {
        const button = await page.evaluateHandle(
          (name) => window.VSC.stateManager.getControlledElements()[0].vsc.iosPlayer.ui.refs[name],
          name
        );
        await button.asElement().tap();
        await button.dispose();
      }
      await page.waitForFunction(() => {
        const { original, source } = window.__stayfastLiveProbe;
        return (
          !window.VSC.TwitterMP4Playback.isRetained(original) &&
          original.vsc &&
          !original.paused &&
          original.currentSrc === source
        );
      });
    }
    errors.assertNone('current X retained-source MP4 playback');
    console.log(
      'PASS: actual X inline 2.1×/4× and independent 1×→4× owned presentation return to intact MSE'
    );
    return { passed: 2, failed: 0 };
  } catch (error) {
    if (page) {
      try {
        await page.screenshot({ path: `${output}/live-x-failure.png` });
        await writeFile(
          `${output}/live-x-failure.json`,
          JSON.stringify(
            await page.evaluate(
              (flow) => ({
                flow,
                url: location.href,
                samples: window.__stayfastLiveProbe?.samples || [],
                trustedEvents: window.__stayfastLiveProbe?.trustedEvents || [],
                controls: window.__stayfastLiveProbe?.controls || [],
                target: (() => {
                  const found = window.__stayfastLiveTarget?.();
                  return found
                    ? {
                        status: found.status,
                        articles: found.articles,
                        videos: found.videos.length,
                      }
                    : null;
                })(),
                initialized: !!window.VSC_controller?.initialized,
                playerDOM: (() => {
                  const original = window.__stayfastLiveProbe?.original;
                  const copy = original?.parentElement?.cloneNode(true);
                  if (!copy) {
                    return null;
                  }
                  for (const node of copy.querySelectorAll('script,style,svg')) {
                    node.remove();
                  }
                  for (const node of [copy, ...copy.querySelectorAll('*')]) {
                    for (const attribute of [...node.attributes]) {
                      if (
                        !/^(class|role|aria-label|data-slot|data-testid|type|hidden)$/.test(
                          attribute.name
                        )
                      ) {
                        node.removeAttribute(attribute.name);
                      }
                    }
                    for (const child of [...node.childNodes]) {
                      if (child.nodeType === 3) {
                        child.remove();
                      }
                    }
                  }
                  return copy.outerHTML.slice(0, 20000);
                })(),
                videos: [...document.querySelectorAll('video')].map((v) => ({
                  src: v.currentSrc,
                  srcAttribute: v.getAttribute('src'),
                  sourceType: v.srcObject
                    ? 'srcObject'
                    : v.currentSrc?.startsWith('blob:')
                      ? 'blob'
                      : /\.m3u8(?:\?|$)/.test(v.currentSrc || v.src)
                        ? 'hls'
                        : 'url',
                  ready: v.readyState,
                  paused: v.paused,
                  controlled: !!v.vsc,
                  resolved: !!window.VSC?.TwitterPlayer?.resolve(v),
                })),
              }),
              flow
            ),
            null,
            2
          )
        );
        await writeFile(`${output}/live-x-network.json`, JSON.stringify(network, null, 2));
      } catch {
        /* Preserve the original failure. */
      }
    }
    throw error;
  } finally {
    errors?.dispose();
    await browser?.close();
  }
}

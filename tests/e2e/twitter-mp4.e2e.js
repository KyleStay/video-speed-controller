import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFixtureServer } from './fixture-server.js';
import { assert, monitorPageErrors } from './e2e-utils.js';

const execFileAsync = promisify(execFile);

/** Local host/transport emulation; SDK, source identity and resolver stay production-shaped. */
export default async function runTwitterMP4({ launch }) {
  let browser, fixture, errors, page;
  let passed = 0;
  const measurements = [];
  try {
    const directory = resolve('test-results/twitter-mse-fix');
    await mkdir(directory, { recursive: true });
    const mp4Path = resolve(directory, 'fixture.mp4');
    // One safe clip supplies BOTH the MSE producer and progressive replacement.
    // Fragmentation is required for appendBuffer; the asset remains generated evidence.
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '32',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-profile:v',
        'baseline',
        '-level:v',
        '3.0',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        mp4Path,
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 }
    );
    fixture = await startFixtureServer({
      mp4Path,
      htmlRoutes: {
        '/twitter-mp4.html': await readFile(new URL('./twitter-mp4.html', import.meta.url), 'utf8'),
      },
    });
    const launched = await launch();
    browser = launched.browser;
    page = launched.page;
    errors = monitorPageErrors(page);
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile/15E148 Safari/604.1'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const state = () => page.evaluate(() => window.__twitterMP4State());
    const load = async () => {
      await page.goto(`${fixture.baseUrl}/twitter-mp4.html`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => window.__twitterMP4State?.().ready || window.__twitterMP4State?.().error
      );
      const initial = await state();
      assert.false(!!initial.error, JSON.stringify(initial));
      await page.waitForFunction(
        () => window.__twitterMP4State().canResolve && !!window.__twitterMP4Fixture.original.vsc
      );
    };
    const retained = async () => {
      const row = await state();
      assert.true(
        row.originalConnected &&
          row.originalParentUnchanged &&
          row.originalSourceUnchanged &&
          row.sameMediaSource &&
          row.sameSourceBuffer,
        JSON.stringify(row)
      );
      assert.true(row.buffered >= 25 && row.controllers === 1, JSON.stringify(row));
      return row;
    };
    const check = async (label, work) => {
      await work();
      errors.assertNone(label);
      passed++;
      console.log(`PASS: retained MSE fixture ${label}`);
    };
    await check(
      'playing 4× has sustained decoded progress and retains the original producer',
      async () => {
        await load();
        await page.click('#play');
        await page.waitForFunction(() => !window.__twitterMP4State().originalPaused);
        await page.click('#speed4');
        await page.waitForFunction(
          () =>
            window.__twitterMP4State().nativeReady && window.__twitterMP4State().controllers === 1
        );
        await page.click('#measure');
        await page.waitForFunction(() => window.__twitterMP4State().measurement?.done);
        const row = await retained();
        assert.true(row.originalPaused && !row.paused && row.rate === 4, JSON.stringify(row));
        assert.true(
          row.measurement.frames >= 60 &&
            row.measurement.maxGapMs < 500 &&
            row.measurement.mediaSeconds >= 3 &&
            row.measurement.ratio > 3.6 &&
            row.measurement.ratio < 4.4,
          JSON.stringify(row.measurement)
        );
        measurements.push(row.measurement);
        await page.screenshot({ path: resolve(directory, 'retained-mse-4x.png') });
      }
    );
    await check(
      'playing handback and fullscreen return resume the intact MSE producer',
      async () => {
        await page.click('#fullscreen');
        await page.waitForFunction(() => window.__twitterMP4State().fullscreen);
        const clickRef = async (name) => {
          const handle = await page.evaluateHandle(
            (name) => window.__twitterMP4Fixture.current().vsc.iosPlayer.ui.refs[name],
            name
          );
          try {
            await handle.asElement().click();
          } finally {
            await handle.dispose();
          }
        };
        await clickRef('more');
        assert.false((await state()).paused, 'Fullscreen entry must preserve playing intent');
        await clickRef('site');
        await page.waitForFunction(
          () => !window.__twitterMP4State().native && !window.__twitterMP4State().originalPaused
        );
        const row = await retained();
        assert.true(
          row.hosts === 0 && row.videos === 1 && row.subscribers === 0,
          JSON.stringify(row)
        );
        const before = row.originalTime;
        await page.waitForFunction(
          (before) => window.__twitterMP4State().originalTime > before + 0.2,
          {},
          before
        );
      }
    );
    await check('paused 2.1× handoff and handback preserve pause intent', async () => {
      await load();
      await page.click('#speed21');
      await page.waitForFunction(() => window.__twitterMP4State().nativeReady);
      let row = await retained();
      assert.true(row.paused && row.originalPaused && row.rate === 2.1, JSON.stringify(row));
      await page.click('#handback');
      await page.waitForFunction(
        () => !window.__twitterMP4State().native && window.__twitterMP4State().controllers === 1
      );
      row = await retained();
      assert.true(
        row.paused && row.originalPaused && row.hosts === 0 && row.subscribers === 0,
        JSON.stringify(row)
      );
    });
    await check('playing 2.1× has sustained decoded progress', async () => {
      await load();
      await page.click('#play');
      await page.click('#speed21');
      await page.waitForFunction(() => window.__twitterMP4State().nativeReady);
      await page.click('#measure');
      await page.waitForFunction(() => window.__twitterMP4State().measurement?.done);
      const row = await retained();
      assert.true(
        !row.paused &&
          row.rate === 2.1 &&
          row.measurement.frames >= 60 &&
          row.measurement.maxGapMs < 500 &&
          row.measurement.mediaSeconds > 1.8 &&
          row.measurement.ratio > 1.89 &&
          row.measurement.ratio < 2.31,
        JSON.stringify(row)
      );
      measurements.push(row.measurement);
    });
    await check('caption veto leaves the original source and controller', async () => {
      await load();
      await page.click('#captions');
      await page.click('#speed4');
      const row = await retained();
      assert.true(
        !row.native && row.hosts === 0 && row.videos === 1 && row.subscribers === 0,
        JSON.stringify(row)
      );
    });
    await check(
      'rapid cancellation cannot attach a stale MP4 and reset changes the active rate',
      async () => {
        await load();
        await page.click('#play');
        await page.click('#cancel');
        await new Promise((done) => setTimeout(done, 350));
        let row = await retained();
        assert.true(!row.native && row.hosts === 0 && row.subscribers === 0, JSON.stringify(row));
        await page.click('#speed4');
        await page.waitForFunction(() => window.__twitterMP4State().nativeReady);
        await page.click('#reset');
        row = await retained();
        assert.equal(row.rate, 1);
      }
    );
    await check(
      'a new source session releases the old replacement without stale resume',
      async () => {
        await page.click('#replace');
        await page.waitForFunction(
          () =>
            !window.__twitterMP4State().native &&
            !window.__twitterMP4State().originalSourceUnchanged &&
            window.__twitterMP4State().buffered >= 25
        );
        const row = await state();
        assert.true(
          row.originalPaused &&
            row.hosts === 0 &&
            row.videos === 1 &&
            row.subscribers === 0 &&
            row.controllers <= 1,
          JSON.stringify(row)
        );
      }
    );
    await writeFile(
      resolve(directory, 'acceptance.json'),
      `${JSON.stringify(
        {
          fixture: 'neutral localhost host-helper and progressive-transport emulation',
          realMediaSource: true,
          sameContentForBothProducers: true,
          passed,
          measurements,
        },
        null,
        2
      )}\n`
    );
    return { passed, failed: 0 };
  } catch (error) {
    if (page) {
      try {
        const state = await page.evaluate(() => {
          return { state: window.__twitterMP4State?.() };
        });
        await writeFile(
          'test-results/twitter-mse-fix/failure-state.json',
          JSON.stringify(state, null, 2)
        );
        await page.screenshot({ path: 'test-results/twitter-mse-fix/failure.png' });
      } catch {
        /* Preserve original assertion failure. */
      }
    }
    throw error;
  } finally {
    errors?.dispose();
    await Promise.all([browser?.close(), fixture?.stop()]);
  }
}

import { assert } from './e2e-utils.js';

async function frameAt(page, selector) {
  const handle = await page.waitForSelector(selector);
  try {
    return await handle.contentFrame();
  } finally {
    await handle.dispose();
  }
}
async function remember(page, selector = '#mock-video') {
  await page.evaluate((selector) => {
    window.__profilePrevious = document.querySelector(selector);
  }, selector);
}
const removed = (page) =>
  page.waitForFunction(
    () => !window.__profilePrevious.isConnected && !window.__profilePrevious.vsc
  );
const oneOwner = (page, selector = '#mock-video') =>
  page.$eval(selector, (clip) => {
    const owner = clip.vsc?.div;
    return (
      owner?.isConnected &&
      [...document.querySelectorAll('.vsc-controller')].filter((node) => node === owner).length ===
        1
    );
  });

export async function runMediaProfile(
  row,
  { page, check, ready, action, faster, quality, decoded, keepMedia, kept, parentEmpty }
) {
  if (row.id === 'watch-navigation') {
    await ready(page);
    await check(
      row,
      'rapid navigation cancels stale replacement and preserves short-layout playback',
      async () => {
        const chosen = await faster(page);
        await page.click('#short-layout');
        assert.true(
          await page.$eval(
            'video',
            (v) => v.getBoundingClientRect().height > v.getBoundingClientRect().width
          )
        );
        await page.click('#play');
        await decoded(page);
        await remember(page);
        await page.click('#next-entry');
        await page.click('#next-entry');
        await page.waitForFunction(() =>
          document.querySelector('video').currentSrc.includes('asset=3')
        );
        await ready(page);
        await removed(page);
        await page.click('#play');
        await decoded(page);
        assert.equal(await page.$eval('video', (v) => v.playbackRate), chosen);
        await keepMedia(page);
        await page.click('#short-layout');
        await kept(page);
        assert.true(await oneOwner(page));
      }
    );
    return;
  }
  if (row.id === 'carousel-viewer') {
    const first = '#carousel-video-0',
      last = '#carousel-video-3';
    await ready(page, first);
    await check(
      row,
      'carousel selection pauses hidden clips and restores original viewer media',
      async () => {
        await keepMedia(page, first);
        await faster(page, first);
        await page.click('#mute-active');
        await page.click('#play');
        await decoded(page, first);
        await page.click('#carousel-next');
        assert.true(await page.$$eval('video', (nodes) => nodes.every((v) => v.paused)));
        await page.click('#carousel-next');
        await ready(page, '#card-2 img');
        await page.click('#carousel-next');
        await ready(page, last);
        assert.false(await page.$eval(last, (v) => v.muted));
        await page.click('#play');
        await decoded(page, last);
        await page.click('#viewer-open');
        await decoded(page, last);
        await page.click('#viewer-close');
        await kept(page);
        await page.click('#carousel-next');
        await ready(page, first);
        assert.true(await page.$eval(last, (v) => v.paused));
        await page.click('#play');
        await decoded(page, first);
        await kept(page);
        assert.true(await oneOwner(page, first));
      }
    );
    return;
  }
  if (row.id === 'command-feed') {
    const frame = await frameAt(page, '#command-frame-0');
    await ready(frame);
    await check(
      row,
      'validated frame commands retain mute and chosen rate through rapid recycled clips',
      async () => {
        await parentEmpty();
        const chosen = await faster(frame);
        await keepMedia(frame);
        await page.click('#play-first');
        await decoded(frame);
        await page.click('#mute-first');
        await frame.waitForFunction(() => !document.querySelector('video').muted);
        for (let i = 0; i < 3; i++) {
          await page.click('#next-entry');
        }
        await frame.waitForFunction(() =>
          document.querySelector('video').currentSrc.includes('asset=4')
        );
        await ready(frame);
        await page.click('#play-first');
        await decoded(frame);
        await kept(frame);
        assert.equal(await frame.$eval('video', (v) => v.playbackRate), chosen);
        assert.false(await frame.$eval('video', (v) => v.muted));
        await page.click('#pause-first');
        await frame.waitForFunction(() => document.querySelector('video').paused);
        await page.click('#mute-first');
        await frame.waitForFunction(() => document.querySelector('video').muted);
        assert.false(frame.isDetached());
        await parentEmpty();
      }
    );
    return;
  }
  if (row.id === 'floating-feed') {
    await ready(page);
    await check(
      row,
      'generic reparenting retains playback and visibility pauses remain paused',
      async () => {
        await keepMedia(page);
        const chosen = await faster(page);
        await page.click('#play');
        await decoded(page);
        for (const id of ['#expand-player', '#float-player', '#return-player']) {
          await page.click(id);
          await kept(page);
          await decoded(page);
          assert.true(await oneOwner(page));
        }
        await page.click('#hide-player');
        await page.waitForFunction(() => document.querySelector('video').paused);
        await page.click('#show-player');
        await ready(page);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
        assert.true(await page.$eval('video', (v) => v.paused));
        await page.click('#play');
        await decoded(page);
        assert.equal(await page.$eval('video', (v) => v.playbackRate), chosen);
      }
    );
    return;
  }
  if (row.id === 'coordinated-embeds') {
    const first = await frameAt(page, '#command-frame-0'),
      second = await frameAt(page, '#command-frame-1');
    await ready(first);
    await ready(second);
    await check(
      row,
      'frame coordination preserves independent controls, captions and concurrent intent',
      async () => {
        await parentEmpty();
        await page.click('#play-first');
        await decoded(first);
        await page.click('#play-second');
        await decoded(second);
        await first.waitForFunction(() => document.querySelector('video').paused);
        await page.click('#allow-concurrent');
        await page.click('#play-first');
        await decoded(first);
        assert.false(await second.$eval('video', (v) => v.paused));
        const untouched = await second.$eval('video', (v) => v.playbackRate);
        await faster(first);
        assert.equal(await second.$eval('video', (v) => v.playbackRate), untouched);
        await keepMedia(first);
        await quality(first, 'low');
        await kept(first);
        await page.click('#play-first');
        await decoded(first);
        assert.false(await second.$eval('video', (v) => v.paused));
        await parentEmpty();
      }
    );
    return;
  }
  if (row.id === 'attachment-thread') {
    await ready(page);
    await check(
      row,
      'attachment renewal, typing and message removal preserve media ownership',
      async () => {
        await keepMedia(page);
        const chosen = await faster(page);
        await page.click('#play');
        await decoded(page);
        await page.type('#thread-reply', 'sdd message');
        assert.equal(await page.$eval('video', (v) => v.playbackRate), chosen);
        await page.click('#open-attachment');
        await kept(page);
        await decoded(page);
        await page.click('#close-attachment');
        await kept(page);
        await page.click('#expire-attachment');
        await page.waitForFunction(() => window.__mediaMockState().errors.length > 0);
        await page.click('#renew-attachment');
        await ready(page);
        await kept(page);
        if (await page.$eval('video', (v) => v.paused)) {
          await page.click('#play');
        }
        await decoded(page);
        await remember(page);
        await page.click('#open-attachment');
        await page.click('#remove-message');
        await removed(page);
        await page.waitForFunction(() => document.querySelectorAll('.vsc-controller').length === 0);
        await page.click('#new-message');
        await ready(page);
        await page.click('#play');
        await decoded(page);
        assert.true(await oneOwner(page));
      }
    );
    return;
  }
  if (row.id === 'staged-player') {
    await check(
      row,
      'visibility startup and stage changes preserve captions, controls and decoded content',
      async () => {
        assert.equal(await page.$$eval('video, .vsc-controller', (nodes) => nodes.length), 0);
        await page.click('#load-player');
        await ready(page);
        await decoded(page);
        await remember(page);
        await page.click('#skip-stage');
        await ready(page);
        await removed(page);
        await keepMedia(page);
        await faster(page);
        await page.click('#play');
        await decoded(page);
        await quality(page, 'low');
        await kept(page);
        await page.click('#float-stage');
        await ready(page);
        assert.true(await page.$eval('video', (v) => v.getBoundingClientRect().width <= 330));
        await page.click('#float-stage');
        await kept(page);
        await page.click('#next-entry');
        await ready(page);
        await page.waitForFunction(() =>
          document.querySelector('video').currentSrc.includes('asset=2')
        );
        if (await page.$eval('video', (v) => v.paused)) {
          await page.click('#play');
        }
        await decoded(page);
        await kept(page);
        assert.true(await oneOwner(page));
      }
    );
    return;
  }
  if (row.id !== 'live-window') {
    throw new Error('Unknown media profile');
  }
  await check(
    row,
    'decoded live playback follows a moving seek window and recording handoff',
    async () => {
      assert.true(
        await page.evaluate(
          () => !!window.MediaSource?.isTypeSupported('video/mp4; codecs="avc1.42c00a, mp4a.40.2"')
        ),
        'Native MediaSource is required for live-window acceptance'
      );
      await page.waitForFunction(() => window.__mediaProfileState?.().phase === 'live-ready');
      await ready(page);
      await keepMedia(page);
      await page.click('#play');
      await decoded(page);
      const before = await page.$eval('video', (v) => ({
        start: v.seekable.start(0),
        end: v.seekable.end(v.seekable.length - 1),
      }));
      await page.click('#advance-window');
      await page.waitForFunction(
        (before) => {
          const v = document.querySelector('video');
          return (
            v.seekable.length &&
            v.seekable.start(0) > before.start + 1 &&
            v.seekable.end(v.seekable.length - 1) > before.end + 1
          );
        },
        { timeout: 15000 },
        before
      );
      row.seekWindow = await page.$eval('video', (v) => ({
        start: v.seekable.start(0),
        end: v.seekable.end(v.seekable.length - 1),
        duration: String(v.duration),
      }));
      await action(page, '#mock-video', 'rewind');
      await page.waitForFunction(() => {
        const v = document.querySelector('video');
        return !v.seeking && v.currentTime >= v.seekable.start(0) - 0.05;
      });
      await page.click('#recording');
      await ready(page);
      await kept(page);
      if (await page.$eval('video', (v) => v.paused)) {
        await page.click('#play');
      }
      await decoded(page);
      assert.true(await page.$eval('video', (v) => Number.isFinite(v.duration)));
    }
  );
}

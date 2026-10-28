import { startFixtureServer } from './fixture-server.js';
import { gifFixture } from '../helpers/gif-fixture.js';
import { mkdir } from 'node:fs/promises';
import { assert, monitorPageErrors } from './e2e-utils.js';

async function gifButton(page, action) {
  const handle = await page.evaluateHandle(
    (action) =>
      document
        .querySelector('#animated')
        .vsc.div.shadowRoot.querySelector(`button[data-action="${action}"]`),
    action
  );
  try {
    await page.hover('#animated');
    const controller = await page.evaluateHandle(() =>
      document.querySelector('#animated').vsc.div.shadowRoot.querySelector('#controller')
    );
    try {
      await controller.asElement().hover();
    } finally {
      await controller.dispose();
    }
    await page.waitForFunction(
      (action) => {
        const button = document
          .querySelector('#animated')
          .vsc.div.shadowRoot.querySelector(`button[data-action="${action}"]`);
        return button.getBoundingClientRect().width > 0;
      },
      {},
      action
    );
    await handle.asElement().hover();
    await handle.asElement().click();
  } finally {
    await handle.dispose();
  }
}

export default async function runGifImages({ launch, browserName = 'chrome' }) {
  let browser, fixture, external, errors;
  let passed = 0;
  try {
    const animated = gifFixture();
    const still = gifFixture({ frames: [{ color: 1, delay: 20 }] });
    const data = Buffer.from(animated).toString('base64');
    const binaryRoutes = {
      '/animated.gif': { type: 'image/gif', body: Buffer.from(animated) },
      '/still.gif': { type: 'image/gif', body: Buffer.from(still) },
    };
    external = await startFixtureServer({ binaryRoutes });
    fixture = await startFixtureServer({
      binaryRoutes,
      htmlRoutes: {
        '/gifs.html': `<!doctype html><title>Animated GIF</title><style>.picture{position:relative;width:320px}img{display:block}</style>
        <div class="picture"><a id="picture-link" href="#picture"><img id="animated" width="320" height="180" alt="Animated test picture" src="/animated.gif"></a></div>
        <div class="picture"><img id="still" width="100" height="60" src="/still.gif" alt="Still GIF"></div>
        <img id="blocked" width="100" height="60" src="${external.baseUrl}/animated.gif" alt="GIF without CORS">
        <script>window.__originalImage=document.querySelector('#animated');window.__originalSource=window.__originalImage.src;window.__originalRect=window.__originalImage.getBoundingClientRect().toJSON();</script>`,
        '/csp.html':
          '<!doctype html><meta http-equiv="Content-Security-Policy" content="img-src \'self\'"><title>CSP GIF</title><img id="csp-gif" src="/animated.gif" width="320" height="180">',
        '/empty.html': '<!doctype html><title>GIF lifecycle</title>',
      },
    });
    const launched = await launch();
    browser = launched.browser;
    const page = launched.page;
    errors = monitorPageErrors(page);
    const check = async (label, work) => {
      await work();
      errors.assertNone(label);
      console.log(`PASS: ${browserName} GIF ${label}`);
      passed++;
    };
    await page.goto(`${fixture.baseUrl}/gifs.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#animated')?.vsc?.div?.isConnected);
    await check(
      'automatic multi-frame discovery preserves still images, original node, source, geometry and link',
      async () => {
        const state = await page.evaluate(() => {
          const image = document.querySelector('#animated'),
            rect = image.getBoundingClientRect();
          return {
            same: image === window.__originalImage,
            source: image.src === window.__originalSource,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            original: window.__originalRect,
            still: !!document.querySelector('#still').vsc,
            blocked: !!document.querySelector('#blocked').vsc,
            link: image.closest('a')?.id,
          };
        });
        assert.true(state.same && state.source);
        assert.equal(state.width, state.original.width);
        assert.equal(state.height, state.original.height);
        assert.equal(state.top, state.original.top);
        assert.false(state.still);
        assert.false(state.blocked);
        assert.equal(state.link, 'picture-link');
      }
    );
    await check(
      'decoded frame colors and variable timing are displayed on the same image',
      async () => {
        await gifButton(page, 'pause');
        assert.true(await page.$eval('#animated', (image) => image.paused));
        await page.$eval('#animated', (image) => {
          image.currentTime = 0;
        });
        await mkdir('test-results/gif-images', { recursive: true });
        await page.screenshot({ path: `test-results/gif-images/${browserName}-frame-red.png` });
        const red = await page.$eval('#animated', (image) => getComputedStyle(image).content);
        await page.$eval('#animated', (image) => {
          image.currentTime = 0.21;
        });
        await page.screenshot({ path: `test-results/gif-images/${browserName}-frame-blue.png` });
        const blue = await page.$eval('#animated', (image) => getComputedStyle(image).content);
        assert.true(red !== blue && red.includes('blob:') && blue.includes('blob:'));
      }
    );
    await check(
      'patch disposal, transparency and interlaced rows retain their pixels',
      async () => {
        const cases = [1, 2, 3].map((disposal) => [
          ...gifFixture({
            frames: [
              { color: 1, delay: 20 },
              { color: 2, delay: 20, left: 2, width: 2, disposal, transparent: disposal === 2 },
              { color: 3, delay: 20, width: 1 },
            ],
          }),
        ]);
        cases.push([
          ...gifFixture({
            frames: [
              {
                color: 1,
                delay: 20,
                interlaced: true,
                pixels: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 1, 1, 1, 1],
              },
            ],
          }),
        ]);
        const pixels = await page.evaluate(async (cases) => {
          const samples = [];
          for (const bytes of cases) {
            const gif = window.VSC.GifDecoder.parse(new Uint8Array(bytes));
            const frames = await window.VSC.GifDecoder.decode(
              gif,
              document,
              new AbortController().signal
            );
            try {
              const bitmap = await createImageBitmap(await (await fetch(frames.at(-1).url)).blob());
              try {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 4;
                const context = canvas.getContext('2d');
                context.drawImage(bitmap, 0, 0);
                samples.push(
                  [
                    [0, 0],
                    [1, 0],
                    [3, 0],
                    [0, 1],
                    [0, 2],
                  ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
                );
              } finally {
                bitmap.close();
              }
            } finally {
              frames.forEach((frame) => URL.revokeObjectURL(frame.url));
            }
          }
          return samples;
        }, cases);
        const red = [255, 0, 0, 255],
          blue = [0, 0, 255, 255],
          green = [0, 255, 0, 255];
        assert.equal(JSON.stringify(pixels[0].slice(0, 3)), JSON.stringify([green, red, blue]));
        assert.equal(
          JSON.stringify(pixels[1].slice(0, 3)),
          JSON.stringify([green, red, [0, 0, 0, 0]])
        );
        assert.equal(JSON.stringify(pixels[2].slice(0, 3)), JSON.stringify([green, red, red]));
        assert.equal(
          JSON.stringify([pixels[3][0], pixels[3][3], pixels[3][4]]),
          JSON.stringify([red, green, blue])
        );
      }
    );
    await check(
      'real speed buttons and keys change playback cadence and frame-step uses GIF frames',
      async () => {
        const before = await page.$eval('#animated', (image) => image.playbackRate);
        await page.keyboard.press('d');
        assert.true(
          await page.$eval('#animated', (image, rate) => image.playbackRate > rate, before)
        );
        await gifButton(page, 'faster');
        assert.true(
          await page.$eval('#animated', (image, rate) => image.playbackRate > rate + 0.1, before)
        );
        await page.$eval('#animated', (image) => {
          image.currentTime = 0;
        });
        await page.keyboard.press('.');
        assert.equal(await page.$eval('#animated', (image) => image.currentTime), 0.2);
        await page.keyboard.press(',');
        assert.equal(await page.$eval('#animated', (image) => image.currentTime), 0);
        const cadence = await page.evaluate(async () => {
          const image = document.querySelector('#animated');
          const measure = async (rate) => {
            image.pause();
            image.currentTime = 0;
            window.VSC_controller.actionHandler.adjustSpeed(image, rate);
            await image.play();
            const start = performance.now();
            await new Promise((done) => setTimeout(done, 120));
            image.pause();
            return { time: image.currentTime, seconds: (performance.now() - start) / 1000 };
          };
          return [await measure(0.5), await measure(2)];
        });
        assert.true(
          cadence[0].time > 0 &&
            cadence[1].time / cadence[1].seconds > (2.5 * cadence[0].time) / cadence[0].seconds,
          JSON.stringify(cadence)
        );
      }
    );
    await check(
      'original picture link remains clickable and source replacement disposes playback',
      async () => {
        await page.click('#animated', { offset: { x: 250, y: 120 } });
        await page.waitForFunction(() => location.hash === '#picture');
        await page.$eval('#animated', (image) => {
          window.__oldGifPlayback = window.VSC.GifPlayback.get(image);
          image.src = '/still.gif?replacement';
        });
        await page.waitForFunction(
          () => !document.querySelector('#animated').vsc && window.__oldGifPlayback.disposed
        );
        assert.equal(
          await page.$eval('#animated', (image) => getComputedStyle(image).content),
          'normal'
        );
        assert.false(await page.$eval('#animated', (image) => 'playbackRate' in image));
      }
    );
    await check('finite GIF loops finish once and explicit Play can restart them', async () => {
      await page.evaluate(
        (src) => {
          const image = document.createElement('img');
          image.id = 'finite-gif';
          image.width = 100;
          image.height = 60;
          image.src = src;
          document.body.append(image);
        },
        `data:image/gif;base64,${Buffer.from(gifFixture({ loop: null })).toString('base64')}`
      );
      await page.waitForFunction(
        () =>
          document.querySelector('#finite-gif').vsc && document.querySelector('#finite-gif').ended
      );
      assert.equal(await page.$eval('#finite-gif', (image) => image.currentTime), 0.5);
      await page.$eval('#finite-gif', async (image) => {
        await image.play();
      });
      assert.false(await page.$eval('#finite-gif', (image) => image.ended));
      await page.$eval('#finite-gif', (image) => {
        window.__finiteGif = image;
        image.remove();
      });
      await page.waitForFunction(() => !window.__finiteGif.vsc);
    });
    await check(
      'late shadow-root and srcset GIFs are discovered and removed without leaked controllers',
      async () => {
        await page.evaluate((src) => {
          const host = document.createElement('div');
          host.id = 'shadow-gif';
          document.body.append(host);
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML = `<div style="position:relative;width:100px"><img id="late" width="100" height="60" src="${src}"></div>`;
          const picture = document.createElement('picture');
          picture.id = 'srcset-gif';
          picture.innerHTML = `<source srcset="${src}"><img width="100" height="60" src="/still.gif">`;
          document.body.append(picture);
        }, `data:image/gif;base64,${data}`);
        await page.waitForFunction(
          () =>
            document.querySelector('#shadow-gif').shadowRoot.querySelector('img').vsc &&
            document.querySelector('#srcset-gif img').vsc
        );
        await page.evaluate(() => {
          window.__removedGif = document
            .querySelector('#shadow-gif')
            .shadowRoot.querySelector('img');
          document.querySelector('#shadow-gif').remove();
        });
        await page.waitForFunction(
          () => !window.__removedGif.vsc && !window.VSC.GifPlayback.get(window.__removedGif)
        );
      }
    );
    await check(
      'disable/re-enable restores native rendering and recreates one controller',
      async () => {
        await page.evaluate(() => window.VSC_controller.teardown());
        assert.equal(await page.$$eval('vsc-controller', (nodes) => nodes.length), 0);
        assert.equal(
          await page.$eval('#srcset-gif img', (image) => getComputedStyle(image).content),
          'normal'
        );
        await page.evaluate(() => window.VSC_controller.initialize());
        await page.waitForFunction(() => document.querySelector('#srcset-gif img').vsc);
        assert.equal(await page.$$eval('vsc-controller', (nodes) => nodes.length), 1);
      }
    );
    await check(
      'CSP-blocked frame rendering retains the native GIF and releases its budget',
      async () => {
        await page.goto(`${fixture.baseUrl}/csp.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => {
          const observer = window.VSC_controller?.gifObserver,
            image = document.querySelector('img');
          return observer?.attempts.get(image) && observer.entries.size === 0;
        });
        assert.false(await page.$eval('img', (image) => !!image.vsc));
        assert.equal(await page.$eval('img', (image) => getComputedStyle(image).content), 'normal');
        assert.equal(await page.evaluate(() => window.VSC_controller.gifObserver.framePixels), 0);
      }
    );
    return { passed, failed: 0 };
  } finally {
    errors?.dispose();
    await Promise.all([browser?.close(), fixture?.stop(), external?.stop()]);
  }
}

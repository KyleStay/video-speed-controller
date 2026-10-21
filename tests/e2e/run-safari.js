/** Safari 26+ real-extension automation. Never enables automation or changes Safari preferences. */
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { startFixtureServer } from './fixture-server.js';

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const extensionPath = resolve(process.env.STAYFAST_SAFARI_DIST || 'dist/safari');
let driver;
let fixture;
let endpoint;
let sessionId;
let extensionId;
let cleanupPromise;
let driverOutput = '';

async function request(method, path, data) {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    ...(data !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
      : {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(`${method} ${path}: ${result.value?.message || JSON.stringify(result)}`);
  }
  return result.value;
}

const command = (method, path, data) => request(method, `/session/${sessionId}${path}`, data);
const evaluate = (script, ...args) => command('POST', '/execute/sync', { script, args });

async function diagnoseInjection() {
  const directory = await mkdtemp(resolve(tmpdir(), 'stayfast-safari-diagnostic-'));
  let diagnosticId;
  try {
    await writeFile(
      resolve(directory, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'StayFast automation injection diagnostic',
        version: '1.0',
        host_permissions: ['<all_urls>'],
        content_scripts: [
          { matches: ['<all_urls>'], js: ['isolated.js'], run_at: 'document_end' },
          { matches: ['<all_urls>'], js: ['main.js'], run_at: 'document_end', world: 'MAIN' },
        ],
      })
    );
    await writeFile(
      resolve(directory, 'isolated.js'),
      "document.documentElement.dataset.stayfastQaIsolated = 'yes';"
    );
    await writeFile(
      resolve(directory, 'main.js'),
      "document.documentElement.dataset.stayfastQaMain = 'yes'; window.__stayfastQaMain = true;"
    );
    const result = await command('POST', '/webextension', { type: 'path', path: directory });
    diagnosticId = typeof result === 'string' ? result : result.extension;
    await command('POST', '/url', { url: `${fixture.baseUrl}/mobile.html?mp4&diagnostic` });
    await pause(1500);
    console.error(
      `Safari minimal injection diagnostic: ${JSON.stringify(await evaluate('return { isolated:document.documentElement.dataset.stayfastQaIsolated, main:document.documentElement.dataset.stayfastQaMain, mainGlobal:window.__stayfastQaMain, vsc:!!window.VSC }'))}`
    );
  } finally {
    if (diagnosticId) {
      await command('DELETE', `/webextension/${diagnosticId}`).catch((error) =>
        console.error(`Diagnostic unload: ${error.message}`)
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function until(script, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(script)) {
      return;
    }
    await pause(100);
  }
  throw new Error(`Timed out: ${message}`);
}

async function clickControl(selector) {
  const point = await evaluate(
    `
    const target = document.querySelector('video')?.vsc?.div?.shadowRoot?.querySelector(arguments[0]);
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  `,
    selector
  );
  if (!point) {
    throw new Error(`Missing controller control: ${selector}`);
  }
  await command('POST', '/actions', {
    actions: [
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', duration: 0, origin: 'viewport', x: point.x, y: point.y },
          { type: 'pause', duration: 150 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await command('DELETE', '/actions');
}

async function cleanup() {
  if (cleanupPromise) {
    return cleanupPromise;
  }
  cleanupPromise = (async () => {
    if (sessionId) {
      if (extensionId) {
        await command('DELETE', `/webextension/${extensionId}`).catch((error) =>
          console.error(`Safari extension unload: ${error.message}`)
        );
      }
      await request('DELETE', `/session/${sessionId}`).catch((error) =>
        console.error(`Safari session close: ${error.message}`)
      );
      sessionId = null;
    }
    if (driver && driver.exitCode === null && driver.signalCode === null) {
      const exited = new Promise((done) => driver.once('exit', done));
      driver.kill('SIGTERM');
      await Promise.race([exited, pause(5000)]);
      if (driver.exitCode === null && driver.signalCode === null) {
        throw new Error(`Owned safaridriver PID ${driver.pid} did not exit`);
      }
    }
    await fixture?.stop();
    console.log(
      'Safari cleanup: automation session released, owned safaridriver exited, fixture server stopped'
    );
  })();
  return cleanupPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => cleanup().finally(() => process.exit(1)));
}

try {
  await access(resolve(extensionPath, 'manifest.json'));
  const portServer = createServer();
  await new Promise((done, reject) => {
    portServer.once('error', reject);
    portServer.listen(0, '127.0.0.1', done);
  });
  const port = portServer.address().port;
  await new Promise((done, reject) =>
    portServer.close((error) => (error ? reject(error) : done()))
  );
  endpoint = `http://127.0.0.1:${port}`;
  driver = spawn('/usr/bin/safaridriver', ['--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [driver.stdout, driver.stderr]) {
    stream.on('data', (data) => {
      driverOutput = `${driverOutput}${data}`.slice(-6000);
    });
  }
  let spawnError;
  driver.once('error', (error) => {
    spawnError = error;
  });
  const readyDeadline = Date.now() + 10000;
  for (;;) {
    if (spawnError) {
      throw spawnError;
    }
    try {
      await request('GET', '/status');
      break;
    } catch (error) {
      if (Date.now() > readyDeadline || driver.exitCode !== null) {
        throw new Error(`SafariDriver unavailable: ${error.message}. ${driverOutput}`, {
          cause: error,
        });
      }
      await pause(100);
    }
  }

  const session = await request('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari' } },
  });
  sessionId = session.sessionId;
  console.log(
    `Safari ${session.capabilities.browserVersion}, disposable automation session ${sessionId}`
  );
  const installation = await command('POST', '/webextension', {
    type: 'path',
    path: extensionPath,
  });
  console.log(`Actual extension loaded: ${JSON.stringify(installation)} from ${extensionPath}`);
  extensionId =
    typeof installation === 'string'
      ? installation
      : installation.identifier ||
        installation.extensionId ||
        installation.extension ||
        installation.id;
  if (!extensionId) {
    throw new Error(
      `Safari did not return an extension identifier: ${JSON.stringify(installation)}`
    );
  }
  fixture = await startFixtureServer();
  await command('POST', '/window/rect', { width: 1100, height: 800 });
  await command('POST', '/url', { url: `${fixture.baseUrl}/mobile.html?mp4` });
  try {
    await until(
      "return !!document.querySelector('video')?.vsc?.div?.shadowRoot",
      'Safari extension controller attachment'
    );
  } catch (error) {
    const diagnostics = await evaluate(
      "return { title:document.title, url:location.href, VSC:!!window.VSC, keys:Object.keys(window.VSC||{}), controller:!!window.VSC_controller, media:document.querySelector('video')?.readyState, text:document.querySelector('#media-status')?.textContent, scripts:[...document.scripts].map(script=>script.src) };"
    );
    console.error(`Safari attachment diagnostics: ${JSON.stringify(diagnostics)}`);
    if (process.env.STAYFAST_SAFARI_DIAGNOSE === '1') {
      await diagnoseInjection();
    }
    throw error;
  }
  await evaluate(`
    window.__stayfastQaErrors = [];
    addEventListener('error', (event) => window.__stayfastQaErrors.push(event.message));
    addEventListener('unhandledrejection', (event) => window.__stayfastQaErrors.push(String(event.reason)));
  `);
  await until(
    "return document.querySelector('video').readyState >= 2",
    'Safari media decoder readiness'
  );

  // Hover genuinely first, so desktop-only buttons receive actual pointer input.
  await clickControl('.draggable');
  await clickControl('[data-action="faster"]');
  await until(
    "return Math.abs(document.querySelector('video').playbackRate - 1.1) < 0.001",
    'Safari speed increase'
  );
  await clickControl('[data-action="slower"]');
  await until("return document.querySelector('video').playbackRate === 1", 'Safari speed decrease');

  const playElement = await command('POST', '/element', { using: 'css selector', value: '#play' });
  const elementId = playElement['element-6066-11e4-a52e-4f735466cecf'];
  await command('POST', `/element/${elementId}/click`, {});
  await until(
    "return !document.querySelector('video').paused && document.querySelector('video').currentTime > 0.1",
    'Safari real playback'
  );
  await command('POST', '/actions', {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: 'd' },
          { type: 'keyUp', value: 'd' },
        ],
      },
    ],
  });
  await command('DELETE', '/actions');
  await until(
    "return Math.abs(document.querySelector('video').playbackRate - 1.1) < 0.001",
    'Safari genuine keyboard shortcut'
  );

  await evaluate(`
    const frame = document.createElement('iframe');
    frame.id = 'qa-media-frame'; frame.src = '/frame.html'; document.body.append(frame);
  `);
  await until(
    "return !!document.querySelector('#qa-media-frame')?.contentDocument?.querySelector('video')?.vsc?.div?.isConnected",
    'Safari all_frames media control'
  );
  const state = await evaluate(`
    const video = document.querySelector('video');
    return { rate: video.playbackRate, paused: video.paused, currentTime: video.currentTime,
      controllerConnected: video.vsc.div.isConnected, errors: window.__stayfastQaErrors };
  `);
  if (state.errors.length) {
    throw new Error(`Safari uncaught page errors: ${state.errors.join('; ')}`);
  }
  const screenshotDirectory = resolve('tests/e2e/screenshots');
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshot = await command('GET', '/screenshot');
  await writeFile(
    resolve(screenshotDirectory, 'safari-extension.png'),
    Buffer.from(screenshot, 'base64')
  );
  console.log(`Safari real-extension checks passed: ${JSON.stringify(state)}`);
  console.log(`Safari screenshot: ${resolve(screenshotDirectory, 'safari-extension.png')}`);
  console.log(
    'This is desktop Safari verification. iPhone native fullscreen and iOS extension enablement require simulator/device checks.'
  );
} catch (error) {
  console.error(`Safari verification incomplete: ${error.stack || error.message}`);
  console.error('This runner does not enable Remote Automation or change Safari preferences.');
  process.exitCode = 1;
} finally {
  await cleanup();
}

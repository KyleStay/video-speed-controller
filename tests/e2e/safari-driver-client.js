/** Bounded SafariDriver client shared by desktop and physical-device experiments. */
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { collectPlaybackObservations } from './rate-probe-validation.js';

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const execute = promisify(execFile);

export class SafariHarnessError extends Error {
  constructor(message, code = 'harness-failure') {
    super(message);
    this.name = 'SafariHarnessError';
    this.code = code;
  }
}

export async function activateDeviceSafari(deviceId, outputPath, run = execute) {
  if (!deviceId || !outputPath) {
    throw new SafariHarnessError('Exact device and activation artifact required');
  }
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await run(
    'xcrun',
    [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      deviceId,
      'com.apple.mobilesafari',
      '--json-output',
      outputPath,
    ],
    { timeout: 20000, maxBuffer: 1024 * 1024 }
  );
  const record = JSON.parse(await readFile(outputPath, 'utf8'));
  if (
    record.info?.outcome !== 'success' ||
    record.result?.launchOptions?.activatedWhenStarted !== true
  ) {
    throw new SafariHarnessError('CoreDevice did not confirm Safari activation');
  }
  return record;
}

const targetScript = `
  const spec = arguments[0];
  const matches = [...document.querySelectorAll(spec.selector)];
  const video = matches.length === 1 ? matches[0] : null;
  const control = spec.controlSelector ? video?.vsc?.div?.shadowRoot?.querySelector(spec.controlSelector) :
    spec.focusSelector ? document.querySelector(spec.focusSelector) : video;
`;

export class SafariDriverClient {
  constructor({
    endpoint,
    fetchImpl = fetch,
    recordPath,
    callerTimeoutMs = 20000,
    pageLoadTimeoutMs = 15000,
    scriptTimeoutMs = 5000,
  }) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) {
      throw new SafariHarnessError('SafariDriver endpoint must be an explicit local port');
    }
    if (!(
      pageLoadTimeoutMs > 0 &&
      scriptTimeoutMs > 0 &&
      callerTimeoutMs > pageLoadTimeoutMs &&
      callerTimeoutMs > scriptTimeoutMs
    )) {
      throw new SafariHarnessError(
        'Server deadlines must be positive and shorter than caller timeout'
      );
    }
    Object.assign(this, {
      endpoint,
      fetchImpl,
      recordPath,
      callerTimeoutMs,
      pageLoadTimeoutMs,
      scriptTimeoutMs,
    });
    this.record = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      commands: [],
      outcome: 'incomplete',
    };
    this.ownedWindows = new Set();
    this.sessionId = null;
  }

  async save() {
    if (this.recordPath) {
      await mkdir(resolve(this.recordPath, '..'), { recursive: true });
      await writeFile(this.recordPath, `${JSON.stringify(this.record, null, 2)}\n`);
    }
  }

  async request(method, path, data) {
    const entry = { method, path, request: data, startedAt: new Date().toISOString() };
    this.record.commands.push(entry);
    try {
      const response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method,
        signal: AbortSignal.timeout(this.callerTimeoutMs),
        ...(data === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
      });
      entry.httpStatus = response.status;
      const result = await response.json();
      entry.response = result;
      if (!response.ok || result.value?.error) {
        throw new SafariHarnessError(
          `${method} ${path}: ${result.value?.message || result.value?.error || response.status}`,
          result.value?.error
        );
      }
      return result.value;
    } catch (error) {
      entry.error = { code: error.code || error.name, message: error.message };
      throw error;
    } finally {
      entry.finishedAt = new Date().toISOString();
      await this.save();
    }
  }

  command(method, path, data) {
    if (!this.sessionId) {
      throw new SafariHarnessError('No owned SafariDriver session');
    }
    return this.request(method, `/session/${encodeURIComponent(this.sessionId)}${path}`, data);
  }

  evaluate(script, ...args) {
    return this.command('POST', '/execute/sync', { script, args });
  }

  async start(capabilities) {
    if (this.sessionId) {
      throw new SafariHarnessError('Session already owned');
    }
    const session = await this.request('POST', '/session', { capabilities });
    if (!session?.sessionId) {
      throw new SafariHarnessError('SafariDriver returned no session ID');
    }
    this.sessionId = session.sessionId;
    this.record.sessionId = this.sessionId;
    // The client owns this new session, but only explicitly created tabs.
    await this.command('POST', '/timeouts', {
      pageLoad: this.pageLoadTimeoutMs,
      script: this.scriptTimeoutMs,
      implicit: 0,
    });
    return session;
  }

  async createWindow() {
    const result = await this.command('POST', '/window/new', { type: 'tab' });
    if (!result?.handle) {
      throw new SafariHarnessError('SafariDriver returned no window handle');
    }
    this.ownedWindows.add(result.handle);
    this.record.ownedWindows = [...this.ownedWindows];
    await this.bind(result.handle);
    return result.handle;
  }

  async bind(handle) {
    if (!this.ownedWindows.has(handle)) {
      throw new SafariHarnessError('Refusing to select an unowned window');
    }
    const handles = await this.command('GET', '/window/handles');
    if (!handles.includes(handle)) {
      throw new SafariHarnessError('Exact owned window is missing');
    }
    await this.command('POST', '/window', { handle });
    if ((await this.command('GET', '/window')) !== handle) {
      throw new SafariHarnessError('Owned-window rebind failed');
    }
  }

  async activateAndBind(handle, activate) {
    if (!this.ownedWindows.has(handle)) {
      throw new SafariHarnessError('Activation requires an owned window');
    }
    const activation = await activate();
    if (
      activation?.info?.outcome !== 'success' ||
      activation.result?.launchOptions?.activatedWhenStarted !== true
    ) {
      throw new SafariHarnessError('Safari activation was not verified');
    }
    this.record.activation = activation;
    await this.bind(handle);
    const focus = await this.evaluate(
      'return { focused:document.hasFocus(), visibility:document.visibilityState };'
    );
    if (!focus.focused || focus.visibility !== 'visible') {
      throw new SafariHarnessError('Owned document lacks focus after Safari activation/rebind');
    }
    return focus;
  }

  async navigate(handle, url) {
    await this.bind(handle);
    // A server page-load timeout is an incomplete navigation; never turn a caller timeout into success.
    await this.command('POST', '/url', { url });
    await this.bind(handle);
    return this.evaluate(
      'return { url:location.href, focused:document.hasFocus(), visibility:document.visibilityState };'
    );
  }

  async until(check, message, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const result = await check();
      if (result) {
        return result;
      }
      await pause(50);
    } while (Date.now() < deadline);
    throw new SafariHarnessError(message);
  }

  async ready(handle, target, timeoutMs = 15000) {
    if (!target?.url || !target.selector || !target.source) {
      throw new SafariHarnessError('Exact URL, selector and media source required');
    }
    await this.bind(handle);
    return this.until(
      async () => {
        const state = await this.evaluate(
          `${targetScript}
        return { url:location.href, focused:document.hasFocus(), visibility:document.visibilityState,
          count:matches.length, source:video?.currentSrc, ready:video?.readyState,
          controller:!!video?.vsc?.div?.isConnected, control:!!control?.isConnected };
      `,
          target
        );
        if (
          state.count > 1 ||
          (state.source && state.source !== target.source) ||
          state.url !== target.url
        ) {
          throw new SafariHarnessError(`Target identity mismatch: ${JSON.stringify(state)}`);
        }
        return (
          state.focused &&
          state.visibility === 'visible' &&
          state.ready >= 2 &&
          state.controller &&
          state.control &&
          state
        );
      },
      'Media/controller readiness or document focus unavailable',
      timeoutMs
    );
  }

  async trustedInput(handle, target, { actions, type = 'keydown', key, receiptTimeoutMs = 1500 }) {
    await this.ready(handle, target);
    const armed = await this.evaluate(
      `${targetScript}
      window.__stayfastHarnessInput?.cleanup();
      if (!control) return false;
      if (arguments[1] === 'keydown' || arguments[1] === 'keyup') control.focus({preventScroll:true});
      if (!document.hasFocus() || ((arguments[1] === 'keydown' || arguments[1] === 'keyup') &&
          control.getRootNode().activeElement !== control)) return false;
      const root = document.documentElement, receipts = [], type = arguments[1], key = arguments[2];
      const record = (event, delivery) => {
        if (!receipts.length && event.type === type && event.isTrusted &&
            event.composedPath().includes(control) && (key === null || event.key === key)) {
          receipts.push({type:event.type,key:event.key,trusted:event.isTrusted,at:performance.now(),delivery});
        }
      };
      const listener = event => record(event, 'capture-listener');
      // A document_start shortcut handler can stop before this late capture listener.
      const nativeStop = Event.prototype.stopImmediatePropagation;
      function ownedStop() { record(this, 'before-stop'); return nativeStop.call(this); }
      Event.prototype.stopImmediatePropagation = ownedStop;
      window.addEventListener(type, listener, true);
      window.__stayfastHarnessInput = {receipts,root,
        cleanup:() => {
          window.removeEventListener(type, listener, true);
          if (Event.prototype.stopImmediatePropagation === ownedStop) Event.prototype.stopImmediatePropagation = nativeStop;
        }};
      return true;
    `,
      target,
      type,
      key ?? null
    );
    if (!armed) {
      throw new SafariHarnessError('Input target could not receive focus');
    }
    const input = { expected: { type, key }, observed: false, startedAt: new Date().toISOString() };
    (this.record.inputs ||= []).push(input);
    let receipt;
    let inputError;
    try {
      await this.command('POST', '/actions', { actions });
      receipt = await this.until(
        () =>
          this.evaluate(`
          const probe = window.__stayfastHarnessInput;
          return probe?.root === document.documentElement && probe.receipts[0] || null;
        `),
        'Expected trusted input never arrived',
        receiptTimeoutMs
      );
      this.record.lastInput = receipt;
      Object.assign(input, { observed: true, receipt });
    } catch (error) {
      input.failure = { classification: 'harness-failure', message: error.message };
      inputError = error;
    }
    const cleanupErrors = [];
    for (const cleanup of [
      () => this.save(),
      () => this.command('DELETE', '/actions'),
      () =>
        this.evaluate(
          'window.__stayfastHarnessInput?.cleanup(); delete window.__stayfastHarnessInput;'
        ),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length) {
      input.cleanupErrors = cleanupErrors.map((error) => error.message);
      throw new AggregateError(
        [...(inputError ? [inputError] : []), ...cleanupErrors],
        'Harness input cleanup incomplete'
      );
    }
    if (inputError) {
      throw inputError;
    }
    return receipt;
  }

  async startMeasurement(handle, target, options = {}) {
    await this.ready(handle, target);
    const armed = await this.evaluate(
      `${targetScript}
      if (window.__stayfastHarnessProbe && !window.__stayfastHarnessProbe.record.finished) {
        throw Error('A measurement is already active');
      }
      window.__stayfastHarnessProbe = (${collectPlaybackObservations.toString()})(video, arguments[1]);
      return { armed:true, elapsedMs:window.__stayfastHarnessProbe.record.elapsedMs };
    `,
      target,
      options
    );
    this.record.measurement = { target, options, armed };
    await this.save();
    return armed;
  }

  async attachMeasurement(handle, target) {
    await this.ready(handle, target);
    const attached = await this.evaluate(
      `${targetScript}
      const probe = window.__stayfastHarnessProbe;
      if (!probe || probe.record.finished) throw Error('No active measurement');
      probe.attach(video);
      return {attached:true, source:video.currentSrc};
    `,
      target
    );
    (this.record.measurement.handoffs ||= []).push({ target, attached });
    await this.save();
    return attached;
  }

  async finishMeasurement(handle) {
    await this.bind(handle);
    const result = await this.evaluate(`
      const probe = window.__stayfastHarnessProbe;
      if (!probe?.record.finished) throw Error('Complete measurement window has not elapsed');
      delete window.__stayfastHarnessProbe;
      return probe.record;
    `);
    this.record.measurement.observations = result;
    await this.save();
    return result;
  }

  async withSettings(optionsUrl, values, experiment) {
    const keys = Object.keys(values);
    if (
      !/^safari-web-extension:\/\//.test(optionsUrl) ||
      !keys.length ||
      keys.length > 16 ||
      keys.some(
        (key) =>
          !['lastSpeed', 'rememberSpeed', 'siteRules', 'enabled', 'keyBindings'].includes(key)
      )
    ) {
      throw new SafariHarnessError(
        'Settings require an exact extension options URL and bounded supported keys'
      );
    }
    const handle = await this.createWindow();
    await this.navigate(handle, optionsUrl);
    const storage = async (operation, payload) => {
      await this.bind(handle);
      const result = await this.command('POST', '/execute/async', {
        script: `
          const [expected, operation, payload, done] = arguments;
          (async () => {
            if (location.href !== expected || !globalThis.chrome?.runtime?.id ||
                chrome.runtime.getURL('ui/options/options.html') !== expected) throw Error('Wrong extension options context');
            const call = (method, value) => new Promise((resolve, reject) => {
              chrome.storage.sync[method](value, (result) => {
                const error = chrome.runtime.lastError;
                if (error) reject(Error(error.message)); else resolve(result);
              });
            });
            if (operation === 'get') return await call('get', payload);
            if (operation === 'set') await call('set', payload);
            if (operation === 'restore') {
              const current = await call('get', payload.keys);
              const same = (left, right, key) => Object.hasOwn(left, key) === Object.hasOwn(right, key) &&
                JSON.stringify(left[key]) === JSON.stringify(right[key]);
              const conflicts = payload.keys.filter(key => !same(current, payload.owned, key) && !same(current, payload.before, key));
              const owned = payload.keys.filter(key => !conflicts.includes(key));
              const original = Object.fromEntries(owned.filter(key => Object.hasOwn(payload.before, key)).map(key => [key, payload.before[key]]));
              if (Object.keys(original).length) await call('set', original);
              await call('remove', owned.filter(key => !Object.hasOwn(payload.before, key)));
              return {settings:await call('get', payload.keys), conflicts};
            }
            return await call('get', ${JSON.stringify(keys)});
          })().then(value => done({value}), error => done({error:error.message}));
        `,
        args: [optionsUrl, operation, payload],
      });
      if (result.error) {
        throw new SafariHarnessError(result.error);
      }
      return result.value;
    };
    const before = await storage('get', keys);
    this.record.settings = { optionsUrl, keys, before, restored: false };
    await this.save();
    let outcome;
    let experimentError;
    try {
      const applied = await storage('set', values);
      if (!keys.every((key) => JSON.stringify(applied[key]) === JSON.stringify(values[key]))) {
        throw new SafariHarnessError('Settings readback differs from requested values');
      }
      outcome = await experiment();
    } catch (error) {
      experimentError = error;
    }
    let restorationError;
    try {
      const restoration = await storage('restore', { keys, before, owned: values });
      const restored = restoration.settings;
      this.record.settings.conflicts = restoration.conflicts;
      this.record.settings.restored = keys.every(
        (key) =>
          Object.hasOwn(before, key) === Object.hasOwn(restored, key) &&
          JSON.stringify(before[key]) === JSON.stringify(restored[key])
      );
      if (!this.record.settings.restored) {
        throw new SafariHarnessError('Original settings restoration unverified');
      }
    } catch (error) {
      restorationError = error;
    }
    for (const cleanup of [() => this.save(), () => this.closeWindow(handle)]) {
      try {
        await cleanup();
      } catch (error) {
        restorationError ||= error;
      }
    }
    if (restorationError && experimentError) {
      throw new AggregateError(
        [experimentError, restorationError],
        'Experiment and settings restoration failed'
      );
    }
    if (restorationError) {
      throw restorationError;
    }
    if (experimentError) {
      throw experimentError;
    }
    return outcome;
  }

  async closeWindow(handle) {
    await this.bind(handle);
    const remaining = await this.command('DELETE', '/window');
    this.ownedWindows.delete(handle);
    if (Array.isArray(remaining) && !remaining.length) {
      this.lastWindowClosed = true;
    }
  }

  async cleanup() {
    if (!this.sessionId) {
      return;
    }
    const errors = [];
    for (const handle of [...this.ownedWindows]) {
      try {
        await this.closeWindow(handle);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.request('DELETE', `/session/${encodeURIComponent(this.sessionId)}`);
    } catch (error) {
      if (this.lastWindowClosed && error.code === 'invalid session id') {
        this.record.sessionAutomaticallyClosed = true;
      } else {
        errors.push(error);
      }
    }
    this.sessionId = null;
    this.record.outcome = errors.length ? 'cleanup-incomplete' : 'cleaned-up';
    this.record.finishedAt = new Date().toISOString();
    await this.save();
    if (errors.length) {
      throw errors[0];
    }
  }
}

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { SafariDriverClient, activateDeviceSafari } from '../../e2e/safari-driver-client.js';

const target = {
  url: 'https://x.com/example/status/1',
  selector: 'video',
  source: 'https://video.example/1.mp4',
};
const focused = { focused: true, visibility: 'visible' };
const ready = {
  ...focused,
  url: target.url,
  count: 1,
  source: target.source,
  ready: 4,
  controller: true,
  control: true,
};
const activated = {
  info: { outcome: 'success' },
  result: { launchOptions: { activatedWhenStarted: true } },
};

function harness(replies = []) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ path: new URL(url).pathname, ...init, body: init.body && JSON.parse(init.body) });
    if (!replies.length) {
      throw Error(`Unexpected request: ${init.method} ${url}`);
    }
    const response = replies.shift();
    return {
      ok: !response?.error,
      status: response?.error ? 404 : 200,
      json: async () => ({ value: response }),
    };
  });
  const client = new SafariDriverClient({ endpoint: 'http://127.0.0.1:62374', fetchImpl });
  client.sessionId = 'owned-session';
  client.ownedWindows.add('owned-window');
  return { client, calls, fetchImpl };
}
const bindReplies = () => [['foreign-window', 'owned-window'], null, 'owned-window'];

describe('shared SafariDriver client', () => {
  it('sets server navigation and script deadlines below bounded caller timeout', async () => {
    const { client, calls } = harness([{ sessionId: 'new-session' }, null]);
    client.sessionId = null;
    await client.start({ alwaysMatch: { browserName: 'safari' } });
    expect(calls[1].body).toEqual({ pageLoad: 15000, script: 5000, implicit: 0 });
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(
      () => new SafariDriverClient({ endpoint: 'http://127.0.0.1:1', callerTimeoutMs: 100 })
    ).toThrow(/deadlines/);
  });

  it('creates and verifies the exact owned window without selecting the first handle', async () => {
    const { client, calls } = harness([
      { handle: 'new-owned' },
      ['foreign-window', 'new-owned'],
      null,
      'new-owned',
    ]);
    expect(await client.createWindow()).toBe('new-owned');
    expect(calls[2].body).toEqual({ handle: 'new-owned' });
    await expect(client.bind('foreign-window')).rejects.toThrow(/unowned/);
    expect(calls).toHaveLength(4);
  });

  it('activates Safari before exact-window rebind and document focus verification', async () => {
    const { client, calls } = harness([...bindReplies(), focused]);
    const activate = vi.fn(async () => {
      expect(calls).toHaveLength(0);
      return activated;
    });
    await client.activateAndBind('owned-window', activate);
    expect(activate).toHaveBeenCalledOnce();
    expect(calls[1].body).toEqual({ handle: 'owned-window' });
    const bad = harness();
    await expect(
      bad.client.activateAndBind('owned-window', async () => ({ info: { outcome: 'success' } }))
    ).rejects.toThrow(/not verified/);
    expect(bad.calls).toHaveLength(0);
  });

  it('rejects ambiguous or wrong-source targets before input', async () => {
    for (const state of [
      { ...ready, count: 2 },
      { ...ready, source: 'https://video.example/other.mp4' },
    ]) {
      const { client } = harness([...bindReplies(), state]);
      await expect(client.ready('owned-window', target)).rejects.toThrow(/identity mismatch/);
    }
  });

  it('does not accept a navigation caller/server timeout as loaded', async () => {
    const { client, calls } = harness([
      ...bindReplies(),
      { error: 'timeout', message: 'server navigation deadline' },
    ]);
    await expect(client.navigate('owned-window', target.url)).rejects.toThrow(
      /navigation deadline/
    );
    expect(calls.at(-1).path).toMatch(/\/url$/);
  });

  it('records a genuine input receipt and removes actions and listeners', async () => {
    const receipt = { type: 'keydown', key: 'd', trusted: true, at: 12 };
    const { client, calls } = harness([...bindReplies(), ready, true, null, receipt, null, null]);
    expect(await client.trustedInput('owned-window', target, { actions: [], key: 'd' })).toEqual(
      receipt
    );
    expect(client.record.lastInput).toEqual(receipt);
    expect(calls.at(-2)).toMatchObject({
      method: 'DELETE',
      path: '/session/owned-session/actions',
    });
    expect(calls.at(-1).body.script).toContain('delete window.__stayfastHarnessInput');
    expect(calls[4].body.script).toContain('event.isTrusted');
  });

  it('classifies missing trusted input as harness failure promptly', async () => {
    const { client, calls } = harness([...bindReplies(), ready, true, null, null, null, null]);
    await expect(
      client.trustedInput('owned-window', target, { actions: [], receiptTimeoutMs: 1 })
    ).rejects.toMatchObject({
      name: 'SafariHarnessError',
      message: 'Expected trusted input never arrived',
    });
    expect(calls.at(-2).method).toBe('DELETE');
  });

  it('treats last-window automatic session closure as successful cleanup', async () => {
    const { client, calls } = harness([
      ...bindReplies(),
      [],
      { error: 'invalid session id', message: '' },
    ]);
    await client.cleanup();
    expect(client.sessionId).toBeNull();
    expect(client.record.sessionAutomaticallyClosed).toBe(true);
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/session/owned-session/window',
      '/session/owned-session',
    ]);
  });

  it('does not suppress session errors while foreign windows remain', async () => {
    const { client } = harness([
      ...bindReplies(),
      ['foreign-window'],
      { error: 'invalid session id', message: '' },
    ]);
    await expect(client.cleanup()).rejects.toMatchObject({ code: 'invalid session id' });
  });

  it('preserves original absent keys and restores settings even when the experiment fails', async () => {
    const { client } = harness();
    client.createWindow = vi.fn(async () => 'settings-window');
    client.navigate = vi.fn();
    client.bind = vi.fn();
    client.closeWindow = vi.fn();
    const responses = [
      { value: { rememberSpeed: false } },
      { value: { lastSpeed: 4, rememberSpeed: true } },
      { value: { settings: { rememberSpeed: false }, conflicts: [] } },
    ];
    client.command = vi.fn(async () => responses.shift());
    await expect(
      client.withSettings(
        'safari-web-extension://identity/ui/options/options.html',
        { lastSpeed: 4, rememberSpeed: true },
        async () => {
          throw Error('playback incomplete');
        }
      )
    ).rejects.toThrow('playback incomplete');
    const setup = client.command.mock.calls[1][2];
    expect(setup.script).toContain("chrome.runtime.getURL('ui/options/options.html') !== expected");
    expect(setup.script).toContain('owned.filter(key => !Object.hasOwn(payload.before, key))');
    expect(client.command.mock.calls[2][2].args).toEqual([
      'safari-web-extension://identity/ui/options/options.html',
      'restore',
      {
        keys: ['lastSpeed', 'rememberSpeed'],
        before: { rememberSpeed: false },
        owned: { lastSpeed: 4, rememberSpeed: true },
      },
    ]);
    expect(client.record.settings.restored).toBe(true);
    expect(client.closeWindow).toHaveBeenCalledWith('settings-window');
  });

  it('refuses webpage settings and unsupported keys before creating a tab', async () => {
    const { client } = harness();
    client.createWindow = vi.fn();
    await expect(
      client.withSettings('https://x.com/options', { lastSpeed: 4 }, vi.fn())
    ).rejects.toThrow(/extension options/);
    await expect(
      client.withSettings(
        'safari-web-extension://identity/ui/options/options.html',
        { secrets: true },
        vi.fn()
      )
    ).rejects.toThrow(/supported keys/);
    expect(client.createWindow).not.toHaveBeenCalled();
  });

  it('arms the existing raw collector before input and refuses premature completion', async () => {
    const { client } = harness();
    client.ready = vi.fn(async () => ready);
    client.evaluate = vi.fn(async () => ({ armed: true }));
    await client.startMeasurement('owned-window', target, { durationMs: 20000 });
    expect(client.evaluate.mock.calls[0][0]).toContain('collectPlaybackObservations');
    expect(client.evaluate.mock.calls[0][1]).toEqual(target);
    expect(client.record.measurement.options).toEqual({ durationMs: 20000 });
  });

  it('captures an earlier shortcut stop and restores only its own temporary event hook', async () => {
    document.body.innerHTML = '<video></video><button id="play">Play</button>';
    const button = document.querySelector('#play');
    const originalStop = Event.prototype.stopImmediatePropagation;
    const unwrapped = new WeakMap();
    // Keep jsdom's Event brand check on the real event behind the simulated trust proxy.
    function browserStop() {
      return originalStop.call(unwrapped.get(this) || this);
    }
    Event.prototype.stopImmediatePropagation = browserStop;
    let simulateTrusted = false;
    let failActionsCleanup = false;
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    let lateListenerReached = false;
    const earlierHandler = (event) => {
      if (!simulateTrusted) {
        event.stopImmediatePropagation();
        return;
      }
      // jsdom dispatch cannot mint trusted input; proxy only its browser-owned trust bit.
      const trusted = new Proxy(event, {
        get(object, key) {
          if (key === 'isTrusted') {
            return true;
          }
          if (key === 'composedPath') {
            return () => event.composedPath();
          }
          return Reflect.get(object, key, object);
        },
      });
      unwrapped.set(trusted, event);
      trusted.stopImmediatePropagation();
    };
    const lateHandler = () => {
      lateListenerReached = true;
    };
    window.addEventListener('keydown', earlierHandler, true);
    const { client } = harness();
    client.ready = vi.fn(async () => ready);
    client.evaluate = vi.fn(async (script, ...args) =>
      runInNewContext(`(function(){${script}})`, { window, document, Event, performance }).apply(
        window,
        args
      )
    );
    client.command = vi.fn(async (method, path) => {
      if (method === 'DELETE' && failActionsCleanup) {
        throw Error('actions cleanup timeout');
      }
      if (method === 'POST' && path === '/actions') {
        window.addEventListener('keydown', lateHandler, true);
        button.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'd', bubbles: true, composed: true })
        );
        expect(window.__stayfastHarnessInput.receipts).toEqual([]);
        simulateTrusted = true;
        button.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'd', bubbles: true, composed: true })
        );
      }
    });
    try {
      const receipt = await client.trustedInput(
        'owned-window',
        { ...target, focusSelector: '#play' },
        { actions: [], key: 'd' }
      );
      expect(receipt).toMatchObject({ trusted: true, key: 'd', delivery: 'before-stop' });
      expect(lateListenerReached).toBe(false);
      expect(Event.prototype.stopImmediatePropagation).toBe(browserStop);
      expect(window.__stayfastHarnessInput).toBeUndefined();
      simulateTrusted = false;
      failActionsCleanup = true;
      await expect(
        client.trustedInput(
          'owned-window',
          { ...target, focusSelector: '#play' },
          { actions: [], key: 'd' }
        )
      ).rejects.toThrow(/cleanup incomplete/);
      expect(Event.prototype.stopImmediatePropagation).toBe(browserStop);
      expect(window.__stayfastHarnessInput).toBeUndefined();
    } finally {
      window.removeEventListener('keydown', earlierHandler, true);
      window.removeEventListener('keydown', lateHandler, true);
      Event.prototype.stopImmediatePropagation = originalStop;
      hasFocus.mockRestore();
      document.body.innerHTML = '';
    }
  });

  it('runs the guarded storage script, preserves concurrent values, and restores existing keys before removal', async () => {
    const { client } = harness();
    client.createWindow = vi.fn(async () => 'settings-window');
    client.navigate = vi.fn();
    client.bind = vi.fn();
    client.closeWindow = vi.fn();
    const optionsUrl = 'safari-web-extension://identity/ui/options/options.html';
    const stored = { rememberSpeed: false };
    const operations = [];
    const context = {
      location: { href: optionsUrl },
      chrome: {
        runtime: { id: 'identity', getURL: () => optionsUrl },
        storage: {
          sync: {
            get: (keys, done) =>
              done(
                Object.fromEntries(
                  keys.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]])
                )
              ),
            set: (values, done) => {
              operations.push(['set', values]);
              Object.assign(stored, values);
              done();
            },
            remove: (keys, done) => {
              operations.push(['remove', keys]);
              for (const key of keys) {
                delete stored[key];
              }
              done();
            },
          },
        },
      },
    };
    client.command = vi.fn(
      async (method, path, { script, args }) =>
        new Promise((done) => {
          runInNewContext(`(function(){${script}})`, context)(...args, done);
        })
    );
    await client.withSettings(optionsUrl, { rememberSpeed: true, lastSpeed: 4 }, async () => {});
    expect(stored).toEqual({ rememberSpeed: false });
    expect(operations.slice(-2)).toEqual([
      ['set', { rememberSpeed: false }],
      ['remove', ['lastSpeed']],
    ]);
    await expect(
      client.withSettings(optionsUrl, { rememberSpeed: true, lastSpeed: 4 }, async () => {
        stored.lastSpeed = 2.1;
      })
    ).rejects.toThrow(/restoration unverified/);
    expect(stored).toEqual({ rememberSpeed: false, lastSpeed: 2.1 });
    expect(client.record.settings.conflicts).toEqual(['lastSpeed']);
    context.location.href = 'https://x.com/';
    const writes = operations.length;
    await expect(client.withSettings(optionsUrl, { lastSpeed: 4 }, async () => {})).rejects.toThrow(
      /Wrong extension options context/
    );
    expect(operations).toHaveLength(writes);
  });

  it('persists raw command responses and timestamps in a run artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stayfast-safari-client-'));
    try {
      const { client } = harness([{ focused: false }]);
      client.recordPath = join(directory, 'run.json');
      await client.evaluate('return document.hasFocus()');
      const record = JSON.parse(await readFile(client.recordPath, 'utf8'));
      expect(record.commands[0]).toMatchObject({ response: { value: { focused: false } } });
      expect(record.commands[0].startedAt).toBeTruthy();
      expect(record.commands[0].finishedAt).toBeTruthy();
      expect(record.outcome).toBe('incomplete');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('verifies CoreDevice activation and retains its JSON artifact without reinstalling anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stayfast-coredevice-'));
    const output = join(directory, 'activation.json');
    try {
      const run = vi.fn(async () => writeFile(output, JSON.stringify(activated)));
      expect(await activateDeviceSafari('exact-device', output, run)).toEqual(activated);
      expect(run.mock.calls[0][1]).toEqual([
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        'exact-device',
        'com.apple.mobilesafari',
        '--json-output',
        output,
      ]);
      expect(run.mock.calls[0][2].timeout).toBe(20000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

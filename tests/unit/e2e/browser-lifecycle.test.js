import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), rm: vi.fn(), rows: '', native: {} }));
vi.mock('puppeteer', () => ({
  default: { launch: mocks.launch, executablePath: async () => '/owned/Chrome' },
}));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async (command) => ({
      stdout: command === 'python3' ? JSON.stringify(mocks.native) : mocks.rows,
      stderr: '',
    }),
  });
  return { execFile };
});
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(async () => '/tmp/stayfast-lifecycle-test-profile'),
  rm: mocks.rm,
}));
import { launchFixtureBrowser, cleanupFixtureBrowsers } from '../../e2e/browser-runtime.js';
import { profileRoots } from '../../e2e/browser-process-ownership.js';

describe('owned browser lifecycle', () => {
  let browser, events, signal;
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.rows = '';
    mocks.native = {};
    mocks.rm.mockReset();
    events = [];
    browser = {
      close: vi.fn(async () => events.push('Browser.close')),
      process: () => ({ pid: 123, spawnfile: '/owned/Chrome' }),
      installExtension: vi.fn(async () => 'test-extension'),
      pages: async () => [{ setViewport: vi.fn() }],
    };
    mocks.launch.mockReset().mockImplementation(async (options) => {
      signal = options.signal;
      signal.addEventListener('abort', () => events.push('abort'));
      return browser;
    });
  });
  afterEach(async () => {
    const cleanup = cleanupFixtureBrowsers();
    await vi.runAllTimersAsync();
    await cleanup;
    vi.useRealTimers();
  });

  it('lets Puppeteer resolve Firefox rather than preselecting a Chrome-version cache path', async () => {
    const active = await launchFixtureBrowser('firefox');
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ browser: 'firefox' }));
    expect(mocks.launch.mock.calls[0][0].executablePath).toBeUndefined();
    const closed = active.browser.close();
    await vi.runAllTimersAsync();
    await closed;
  });

  it('uses Browser.close before profile removal without aborting an established runtime', async () => {
    const active = await launchFixtureBrowser('chrome');
    const close = active.browser.close();
    await vi.runAllTimersAsync();
    await close;
    expect(events).toEqual(['Browser.close']);
    expect(signal.aborted).toBe(false);
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it.each([
    'Chrome --user-data-dir=/tmp/stayfast-lifecycle-test-profile-other',
    'node audit --message=--user-data-dir=/tmp/stayfast-lifecycle-test-profile',
    'node audit --message=reviewing --user-data-dir=/tmp/stayfast-lifecycle-test-profile --headless',
    'node audit --message="reviewing --user-data-dir=/tmp/stayfast-lifecycle-test-profile --headless"',
    'node audit --message="reviewing -profile /tmp/stayfast-lifecycle-test-profile --headless"',
  ])('never signals an unrelated command during cleanup: %s', async (command) => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mocks.rows = `456 1 Thu Oct 22 13:00:00 2026 ${command}`;
    mocks.native = { 456: { status: 'verified', argv: ['/owned/Chrome', command] } };
    try {
      const active = await launchFixtureBrowser('chrome');
      const close = active.browser.close();
      await vi.runAllTimersAsync();
      await close;
      expect(kill).not.toHaveBeenCalled();
      expect(mocks.rm).toHaveBeenCalledOnce();
    } finally {
      mocks.rows = '';
      kill.mockRestore();
    }
  });

  it('closes its known browser but retains the profile when native inspection fails', async () => {
    const active = await launchFixtureBrowser('chrome');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mocks.rows =
      '456 1 Thu Oct 22 13:00:00 2026 Chrome --user-data-dir=/tmp/stayfast-lifecycle-test-profile';
    mocks.native = { 456: { status: 'unavailable' } };
    try {
      const closed = expect(active.browser.close()).rejects.toThrow(/retained/);
      await vi.runAllTimersAsync();
      await closed;
      expect(events).toEqual(['Browser.close']);
      expect(mocks.rm).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      mocks.rows = '';
      kill.mockRestore();
    }
  });

  it('rechecks an uncertain helper after Browser.close proves it exited', async () => {
    const active = await launchFixtureBrowser('chrome');
    mocks.rows =
      '456 1 Thu Oct 22 13:00:00 2026 Chrome --user-data-dir=/tmp/stayfast-lifecycle-test-profile';
    mocks.native = { 456: { status: 'unavailable' } };
    browser.close = active.browser.close;
    // The runtime retained the original close handle from launch.
    // Complete normal browser shutdown while its native inventory is uncertain.
    const original = events.push.bind(events);
    vi.spyOn(events, 'push').mockImplementation((value) => {
      mocks.rows = '';
      return original(value);
    });
    const closed = active.browser.close();
    await vi.runAllTimersAsync();
    await closed;
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it.each([
    ['chrome', ['-profile', '/tmp/stayfast-lifecycle-test-profile']],
    ['firefox', ['--user-data-dir=/tmp/stayfast-lifecycle-test-profile']],
  ])('never owns a %s process based on the other browser profile switch', async (name, args) => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mocks.rows = `456 1 Thu Oct 22 13:00:00 2026 Browser ${args.join(' ')}`;
    mocks.native = { 456: { status: 'verified', argv: ['/owned/Chrome', ...args] } };
    try {
      const active = await launchFixtureBrowser(name);
      const closed = active.browser.close();
      await vi.runAllTimersAsync();
      await closed;
      expect(kill).not.toHaveBeenCalled();
      expect(mocks.rm).toHaveBeenCalledOnce();
    } finally {
      mocks.rows = '';
      kill.mockRestore();
    }
  });

  it('gracefully closes a returned handle after extension installation fails', async () => {
    browser.installExtension.mockRejectedValue(new Error('installation failed'));
    const launch = expect(launchFixtureBrowser('chrome')).rejects.toThrow('installation failed');
    await vi.runAllTimersAsync();
    await launch;
    expect(events).toEqual(['Browser.close']);
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it('aborts only a launch that has not returned a browser handle', async () => {
    mocks.launch.mockImplementation((options) => {
      signal = options.signal;
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('launch aborted')))
      );
    });
    const launch = expect(launchFixtureBrowser('chrome')).rejects.toThrow('launch aborted');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.launch).toHaveBeenCalledOnce();
    const cleanup = cleanupFixtureBrowsers();
    await vi.runAllTimersAsync();
    await Promise.all([launch, cleanup]);
    expect(signal.aborted).toBe(true);
    expect(browser.close).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledOnce();
  });
});

describe('isolated browser process ownership', () => {
  const profile = '/tmp/stayfast-isolated-QA';
  async function tree(pid, rows) {
    const source = readFileSync(resolve('tests/e2e/run-isolated.js'), 'utf8');
    const start = source.indexOf('async function processTree(');
    const end = source.indexOf('\nasync function liveOwned(', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    mocks.native = Object.fromEntries(
      rows.map((row) => [
        row.pid,
        { status: 'verified', argv: ['/owned/Chrome', ...row.command.split(' ').slice(1)] },
      ])
    );
    const context = { processRows: async () => rows, profileRoots };
    vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.tree = processTree;`, context);
    return context.tree(pid, profile, '/owned/Chrome');
  }

  it('retains only the exact root and its children among similar profiles', async () => {
    const result = await tree(10, [
      { pid: 10, parent: 1, command: `Chrome --user-data-dir=${profile}` },
      { pid: 11, parent: 10, command: 'Chrome Helper' },
      { pid: 20, parent: 1, command: `Chrome --user-data-dir=${profile}-other` },
      { pid: 21, parent: 20, command: 'Unrelated helper' },
      { pid: 30, parent: 1, command: `node audit --message=--user-data-dir=${profile}` },
    ]);
    expect([...result.keys()]).toEqual([10, 11]);
  });

  it('refuses a root PID whose profile flag is only a prefix match', async () => {
    const result = await tree(20, [
      { pid: 20, parent: 1, command: `Chrome --user-data-dir=${profile}-other` },
    ]);
    expect(result.size).toBe(0);
  });
});

describe('isolated external-suite interruption', () => {
  it('forwards one interruption and waits for child cleanup', async () => {
    vi.useFakeTimers();
    try {
      const source = readFileSync(resolve('tests/e2e/run-isolated.js'), 'utf8');
      // Run the real registrations/dispatcher with mocked process boundaries.
      const start = source.indexOf("for (const signal of ['SIGINT', 'SIGTERM'])");
      const end = source.indexOf('\nlet failed = 0;', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const parent = new EventEmitter(),
        child = new EventEmitter(),
        events = [];
      parent.execPath = 'node';
      parent.exit = vi.fn((code) => events.push(`parent-exit:${code}`));
      child.kill = vi.fn((signal) => {
        events.push(`child-signal:${signal}`);
        if (child.kill.mock.calls.length > 1) {
          child.emit('exit', 130, signal);
        } else {
          setTimeout(() => {
            events.push('child-cleanup-done');
            child.emit('exit', 130, signal);
          }, 250);
        }
      });
      const context = {
        process: parent,
        spawn: () => child,
        console,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        cleanup: async () => events.push('parent-cleanup'),
      };
      vm.runInNewContext(
        `let interrupted = false, activeLauncher = null, activeExternal = null;\n${source.slice(
          start,
          end
        )}\nglobalThis.dispatch = runExternal;`,
        context
      );
      const external = context.dispatch('fixture.js', []).catch(() => {});
      parent.emit('SIGINT');
      await vi.advanceTimersByTimeAsync(1);
      expect(events).toEqual(['child-signal:SIGINT']);
      parent.emit('SIGTERM');
      await vi.runAllTimersAsync();
      await external;
      expect(events).toEqual([
        'child-signal:SIGINT',
        'child-cleanup-done',
        'parent-cleanup',
        'parent-exit:130',
      ]);
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isolated native inventory failure', () => {
  it('attempts owned CDP close, retains the profile and never signals uncertain PIDs', async () => {
    const source = readFileSync(resolve('tests/e2e/run-isolated.js'), 'utf8');
    const start = source.indexOf('async function cleanup()');
    const end = source.indexOf("for (const signal of ['SIGINT', 'SIGTERM'])", start);
    const send = vi.fn(async () => {}),
      remove = vi.fn(),
      terminate = vi.fn();
    const context = {
      fixtureOwned: {
        profile: '/tmp/owned-fixture',
        executable: '/owned/Chrome',
        browser: { target: () => ({ createCDPSession: async () => ({ send }) }) },
      },
      processRows: async () => [],
      profileRoots: async () => {
        throw new Error('native inspection denied; retained profile');
      },
      processTree: vi.fn(),
      terminateExact: terminate,
      rm: remove,
      console,
    };
    vm.runInNewContext(
      `let owned=fixtureOwned,cleaning=null;${source.slice(start, end)};globalThis.clean=cleanup;`,
      context
    );
    await expect(context.clean()).rejects.toThrow(/native inspection denied/);
    expect(send).toHaveBeenCalledWith('Browser.close');
    expect(remove).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  });

  it('still invokes the saved browser close when its pre-close inventory fails', async () => {
    const source = readFileSync(resolve('tests/e2e/run-isolated.js'), 'utf8');
    const start = source.indexOf('        browser.close = async () => {');
    const end = source.indexOf('        const page = ', start);
    const browser = {},
      close = vi.fn(async () => {});
    const context = {
      browser,
      close,
      info: { pid: 123 },
      profile: '/tmp/owned-fixture',
      owned: { executable: '/owned/Chrome', identities: new Map() },
      processTree: async () => {
        throw new Error('native inspection denied; retained profile');
      },
    };
    vm.runInNewContext(source.slice(start, end), context);
    await expect(browser.close()).rejects.toThrow(/native inspection denied/);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('standalone recovery executable identity', () => {
  const source = readFileSync(resolve('tests/e2e/run-isolated.js'), 'utf8');
  function prepare(stdout) {
    const start = source.indexOf('async function resolveChromeExecutable()');
    const end = source.indexOf('\nasync function processRows()', start);
    const execFileAsync = vi.fn(async () => ({ stdout }));
    const context = {
      execFileAsync,
      runner: '/trusted/runner.py',
      extensionDirectory: '/owned/extension',
      isAbsolute: (value) => value.startsWith('/'),
    };
    vm.runInNewContext(
      `${source.slice(start, end)}\nglobalThis.resolve = resolveChromeExecutable;`,
      context
    );
    return { context, execFileAsync };
  }
  it('resolves the trusted runner before standalone cleanup discovers any processes', async () => {
    const { context, execFileAsync } = prepare(JSON.stringify({ command: ['/owned/Chrome'] }));
    expect(await context.resolve()).toBe('/owned/Chrome');
    expect(execFileAsync).toHaveBeenCalledWith(
      'python3',
      ['/trusted/runner.py', '--extension', '/owned/extension', '--dry-run'],
      { timeout: 10000 }
    );
    const start = source.indexOf("if (name === 'cleanup')");
    const end = source.indexOf('    if (externalSuites[name])', start);
    const cleanup = vi.fn();
    const recovery = {
      ...context,
      process: { env: { STAYFAST_CLEANUP_PROFILE: '/tmp/stayfast-browser-qa-ABC' } },
      resolve: (value) => value,
      dirname: () => '/tmp',
      basename: () => 'stayfast-browser-qa-ABC',
      tmpdir: () => '/tmp',
      name: 'cleanup',
      cleanup,
      owned: null,
      resolveChromeExecutable: context.resolve,
    };
    await vm.runInNewContext(
      `(async () => { for (let once = true; once; once = false) { ${source.slice(start, end)} } })()`,
      recovery
    );
    expect(recovery.owned).toEqual({
      profile: '/tmp/stayfast-browser-qa-ABC',
      executable: '/owned/Chrome',
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it.each(['{}', '{"command":[]}', '{"command":["relative/Chrome"]}', 'null'])(
    'never admits missing or relative runner identity: %s',
    async (stdout) => {
      await expect(prepare(stdout).context.resolve()).rejects.toThrow();
    }
  );
});

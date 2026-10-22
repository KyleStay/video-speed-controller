import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), rm: vi.fn(), rows: '' }));
vi.mock('puppeteer', () => ({ default: { launch: mocks.launch } }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async () => ({ stdout: mocks.rows, stderr: '' }),
  });
  return { execFile };
});
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(async () => '/tmp/stayfast-lifecycle-test-profile'),
  rm: mocks.rm,
}));
import { launchFixtureBrowser, cleanupFixtureBrowsers } from '../../e2e/browser-runtime.js';

describe('owned browser lifecycle', () => {
  let browser, events, signal;
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.rows = '';
    mocks.rm.mockReset();
    events = [];
    browser = {
      close: vi.fn(async () => events.push('Browser.close')),
      process: () => ({ pid: 123 }),
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

  it('uses Browser.close before profile removal without aborting an established runtime', async () => {
    const active = await launchFixtureBrowser('chrome');
    const close = active.browser.close();
    await vi.runAllTimersAsync();
    await close;
    expect(events).toEqual(['Browser.close']);
    expect(signal.aborted).toBe(false);
    expect(mocks.rm).toHaveBeenCalledOnce();
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

import { describe, expect, it, vi } from 'vitest';
import { getChromeLaunchArgs, monitorPageErrors } from '../../e2e/e2e-utils.js';

describe('E2E Chrome launch arguments', () => {
  it('enables the no-sandbox fallback only on Linux CI', () => {
    expect(getChromeLaunchArgs({ ci: 'true', platform: 'linux' })).toEqual(
      expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox'])
    );
    expect(getChromeLaunchArgs({ ci: 'false', platform: 'linux' })).not.toContain('--no-sandbox');
    expect(getChromeLaunchArgs({ ci: 'true', platform: 'darwin' })).not.toContain('--no-sandbox');
  });

  it('turns uncaught page exceptions into assertion failures', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listeners = new Map();
    const page = {
      on: (event, listener) => listeners.set(event, listener),
      off: (event, listener) => {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      },
    };
    const monitor = monitorPageErrors(page);
    listeners.get('pageerror')(new Error('fixture exploded'));
    expect(() => monitor.assertNone('fixture')).toThrow(/fixture exploded/);
    monitor.clear();
    expect(() => monitor.assertNone('fixture')).not.toThrow();
    monitor.dispose();
    expect(listeners.has('pageerror')).toBe(false);
    consoleError.mockRestore();
  });

  it('can exclude explicitly classified third-party page failures', () => {
    const listeners = new Map();
    const page = {
      on: (event, listener) => listeners.set(event, listener),
      off: () => {},
    };
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const monitor = monitorPageErrors(page, {
      ignore: (error) => error.message === 'ad request failed',
    });
    listeners.get('pageerror')(new Error('ad request failed'));
    expect(() => monitor.assertNone('fixture')).not.toThrow();
    monitor.dispose();
    consoleWarning.mockRestore();
  });
});

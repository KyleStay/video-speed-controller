/**
 * Unit tests for settings management
 * Using global variables to match browser extension architecture
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
  simulateExternalStorageWrite,
} from '../../helpers/chrome-mock.js';
import { vi } from 'vitest';

// These tests run with chrome.storage mock (extension context).
// StorageManager detects chrome.storage and uses it directly.

describe('Settings', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupChromeMock();
  });

  it('VideoSpeedConfig should initialize with default settings', () => {
    // Access VideoSpeedConfig from global scope
    const config = window.VSC.videoSpeedConfig;
    expect(config.settings).toBeDefined();
    expect(config.settings.enabled).toBe(true);
    expect(config.settings.lastSpeed).toBe(1.0);
    expect(config.settings.logLevel).toBe(3);
  });

  it('VideoSpeedConfig should load settings from storage', async () => {
    const config = window.VSC.videoSpeedConfig;
    const settings = await config.load();

    expect(settings).toBeDefined();
    expect(settings.enabled).toBe(true);
    expect(settings.lastSpeed).toBeNull(); // no user choice yet
  });

  it('preserves default load fallback while strict callers receive the storage failure', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    const settings = config.settings;
    const failure = new Error('Storage read unavailable');
    const get = vi.spyOn(window.VSC.StorageManager, 'get').mockRejectedValue(failure);
    const set = vi.spyOn(window.VSC.StorageManager, 'set');
    try {
      expect(await config.load()).toBe(window.VSC.Constants.DEFAULT_SETTINGS);
      expect(config.settings).toBe(settings);
      await expect(config.load({ throwOnError: true })).rejects.toBe(failure);
      expect(config.settings).toBe(settings);
      expect(set).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('reloads persisted settings after a strict read failure and an unpersisted session edit', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    const previous = getMockStorage().rememberSpeed;
    const set = vi
      .spyOn(window.VSC.StorageManager, 'set')
      .mockRejectedValue(new Error('Storage write unavailable'));
    const get = vi
      .spyOn(window.VSC.StorageManager, 'get')
      .mockRejectedValue(new Error('Storage read unavailable'));
    try {
      expect(await config.save({ rememberSpeed: !previous })).toBe(false);
      expect(config.settings.rememberSpeed).toBe(!previous);
      await expect(config.load({ throwOnError: true })).rejects.toThrow('Storage read unavailable');
      get.mockRestore();
      await config.load({ throwOnError: true });
      expect(config.settings.rememberSpeed).toBe(previous);
      expect(getMockStorage().rememberSpeed).toBe(previous);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('VideoSpeedConfig should save settings to storage', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    await config.save({ lastSpeed: 2.0, enabled: false });

    expect(config.settings.lastSpeed).toBe(2.0);
    expect(config.settings.enabled).toBe(false);
  });

  it('VideoSpeedConfig should handle key bindings', async () => {
    // Create fresh config instance
    const config = new window.VSC.VideoSpeedConfig();

    // Load settings with defaults
    await config.load();

    const fasterValue = config.getKeyBinding('faster');
    expect(fasterValue).toBe(0.1);

    config.setKeyBinding('faster', 0.2);
    const updatedValue = config.getKeyBinding('faster');
    expect(updatedValue).toBe(0.2);
  });

  it('preserves explicit no-modifier chords while loading frame-step bindings', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    for (const action of ['rewindFrame', 'advanceFrame']) {
      expect(
        config.settings.keyBindings.find((binding) => binding.action === action)?.modifiers
      ).toEqual({ shift: false, ctrl: false, alt: false, meta: false });
    }
  });

  it('VideoSpeedConfig should have state manager available', () => {
    // Verify state manager is available (media tracking moved there)
    expect(window.VSC.stateManager).toBeDefined();
    expect(typeof window.VSC.stateManager.getAllMediaElements).toBe('function');
    expect(typeof window.VSC.stateManager.registerController).toBe('function');
    expect(typeof window.VSC.stateManager.removeController).toBe('function');
  });

  it('VideoSpeedConfig should handle invalid key binding requests gracefully', () => {
    const config = window.VSC.videoSpeedConfig;

    const result = config.getKeyBinding('nonexistent');
    expect(result).toBe(false);

    // Should not throw
    config.setKeyBinding('nonexistent', 123);
  });

  it('VideoSpeedConfig should debounce lastSpeed saves', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // Multiple rapid speed updates
    await config.save({ lastSpeed: 1.5 });
    await config.save({ lastSpeed: 1.8 });
    await config.save({ lastSpeed: 2.0 });

    // Should not have saved yet
    expect(mockSet).not.toHaveBeenCalled();
    expect(config.settings.lastSpeed).toBe(2.0); // In-memory should update immediately

    // Wait for debounce delay
    await vi.advanceTimersByTimeAsync(1100);

    // Should have saved only once
    expect(mockSet).toHaveBeenCalledOnce();

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should save non-speed settings immediately', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    await config.save({ enabled: false });

    // Should save immediately
    expect(mockSet).toHaveBeenCalledOnce();

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should reset debounce timer on new speed updates', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // First speed update
    await config.save({ lastSpeed: 1.5 });

    // Wait 500ms, then another update (should reset timer)
    await vi.advanceTimersByTimeAsync(500);
    await config.save({ lastSpeed: 2.0 });

    // Wait another 500ms (total 1000ms from first, but only 500ms from second)
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSet).not.toHaveBeenCalled(); // Should not have saved yet

    // Wait remaining 600ms (total 1100ms from second update)
    await vi.advanceTimersByTimeAsync(600);
    expect(mockSet).toHaveBeenCalledOnce(); // Should have saved now
    expect(config.settings.lastSpeed).toBe(2.0); // Final value

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should persist only final speed value', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // Multiple rapid speed updates
    await config.save({ lastSpeed: 1.2 });
    await config.save({ lastSpeed: 1.7 });
    await config.save({ lastSpeed: 2.3 });

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(1100);

    // Should have saved only the final value
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockSet.mock.calls[0][0].lastSpeed).toBe(2.3);

    window.VSC.StorageManager.set = originalSet;
  });

  it('VideoSpeedConfig should update in-memory settings immediately during debounce', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    await config.load();

    const mockSet = vi.fn();
    const originalSet = window.VSC.StorageManager.set;

    window.VSC.StorageManager.set = mockSet;

    // Speed update
    await config.save({ lastSpeed: 1.75 });

    // In-memory should update immediately, before storage save
    expect(config.settings.lastSpeed).toBe(1.75);
    expect(mockSet).not.toHaveBeenCalled(); // Storage not saved yet

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockSet).toHaveBeenCalledOnce(); // Now saved to storage

    window.VSC.StorageManager.set = originalSet;
  });

  // --- Site rules + speed initialization ---

  it('siteDefaultSpeed is set when siteRule matches with speed', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    // Mock matchSiteRule to return a rule with speed
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => ({ pattern: 'test.com', enabled: true, speed: 2.3 });

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBe(2.3);

    window.VSC.matchSiteRule = original;
  });

  it('siteDefaultSpeed is not set when siteRule matches with speed=null', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => ({ pattern: 'test.com', enabled: false, speed: null });

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBeUndefined();

    window.VSC.matchSiteRule = original;
  });

  it('siteDefaultSpeed is not set when no rule matches', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => null;

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBeUndefined();

    window.VSC.matchSiteRule = original;
  });

  it('clears a previously derived siteDefaultSpeed when a later load has no match', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    let match = { pattern: 'test.com', enabled: true, speed: 2.3 };
    window.VSC.matchSiteRule = () => match;

    await config.load();
    expect(config.settings.siteDefaultSpeed).toBe(2.3);

    match = null;
    await config.load();
    expect(config.settings.siteDefaultSpeed).toBeUndefined();

    window.VSC.matchSiteRule = original;
  });

  it('lastSpeed reset to null when rememberSpeed is false', async () => {
    // Inject lastSpeed=1.5 into mock storage
    globalThis.chrome.storage.sync.get = (keys, callback) => {
      setTimeout(() => {
        const defaults = typeof keys === 'object' ? keys : {};
        callback({ ...defaults, lastSpeed: 1.5, rememberSpeed: false });
      }, 10);
    };

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBeNull();
  });

  it('lastSpeed preserved when rememberSpeed is true', async () => {
    globalThis.chrome.storage.sync.get = (keys, callback) => {
      setTimeout(() => {
        const defaults = typeof keys === 'object' ? keys : {};
        callback({ ...defaults, lastSpeed: 1.5, rememberSpeed: true });
      }, 10);
    };

    const config = new window.VSC.VideoSpeedConfig();
    await config.load();
    expect(config.settings.lastSpeed).toBe(1.5);
  });

  it('site rule speed wins over stored lastSpeed when rememberSpeed is off', async () => {
    // Storage has lastSpeed=1.5 from a previous session, rememberSpeed=false
    globalThis.chrome.storage.sync.get = (keys, callback) => {
      setTimeout(() => {
        const defaults = typeof keys === 'object' ? keys : {};
        callback({ ...defaults, lastSpeed: 1.5, rememberSpeed: false });
      }, 10);
    };

    const config = new window.VSC.VideoSpeedConfig();
    const original = window.VSC.matchSiteRule;
    window.VSC.matchSiteRule = () => ({ pattern: 'test.com', enabled: true, speed: 2.3 });

    await config.load();

    // lastSpeed null (site rule wins), siteDefaultSpeed should be 2.3
    expect(config.settings.lastSpeed).toBeNull();
    expect(config.settings.siteDefaultSpeed).toBe(2.3);

    window.VSC.matchSiteRule = original;
  });
  it('revises speed authority only for external speed preferences after the self-echo guard', async () => {
    const config = new window.VSC.VideoSpeedConfig();
    expect(config.speedPreferenceRevision).toBe(0);
    await config.load();
    const revision = config.speedPreferenceRevision;
    simulateExternalStorageWrite({
      controllerOpacity: 0.5,
      keyBindings: config.settings.keyBindings,
    });
    expect(config.speedPreferenceRevision).toBe(revision);
    config.settings.lastSpeed = 1.5;
    config._lastWrittenSpeed = 8;
    simulateExternalStorageWrite({ lastSpeed: 8 });
    expect(config.settings.lastSpeed).toBe(1.5);
    expect(config.speedPreferenceRevision).toBe(revision);
    simulateExternalStorageWrite({ lastSpeed: 8 });
    expect(config.speedPreferenceRevision).toBe(revision + 1);
    simulateExternalStorageWrite({ lastSpeed: undefined });
    expect(config.speedPreferenceRevision).toBe(revision + 2);
    simulateExternalStorageWrite({ siteRules: config.settings.siteRules });
    expect(config.speedPreferenceRevision).toBe(revision + 3);
    config.settings.siteDefaultSpeed = 2;
    simulateExternalStorageWrite({ siteDefaultSpeed: undefined });
    expect(config.speedPreferenceRevision).toBe(revision + 4);
  });

  describe('legacy absolute speed normalization', () => {
    const legacy = () => ({
      rememberSpeed: true,
      lastSpeed: 64,
      keyBindings: [
        { action: 'fast', key: 71, value: 64 },
        { action: 'reset', key: 82, value: 32 },
        { action: 'faster', key: 68, value: 32 },
        { action: 'slower', key: 83, value: 64 },
        { action: 'rewind', key: 90, value: 90 },
        { action: 'advance', key: 88, value: 120 },
        { action: 'rewindFrame', key: 188, value: 60 },
        { action: 'advanceFrame', key: 190, value: 120 },
      ],
      siteRules: [
        { pattern: 'unrelated.invalid', enabled: true, speed: 128 },
        { pattern: 'another.invalid', enabled: true, speed: null },
      ],
    });

    it.each(['load', 'change', 'save'])(
      'bounds only absolute speed units during %s',
      async (mode) => {
        const data = legacy();
        const original = structuredClone(data);
        const storageRead =
          mode === 'load'
            ? vi.spyOn(window.VSC.StorageManager, 'get').mockResolvedValue({
                ...window.VSC.Constants.DEFAULT_SETTINGS,
                ...data,
                controllerCSS: null,
              })
            : null;
        const config = new window.VSC.VideoSpeedConfig();
        await config.load();
        storageRead?.mockRestore();
        if (mode === 'change') {
          simulateExternalStorageWrite(data);
        }
        if (mode === 'save') {
          await config.save(data);
        }
        expect(config.settings.lastSpeed).toBe(16);
        expect(config.settings.keyBindings.map(({ value }) => value)).toEqual([
          16, 16, 32, 64, 90, 120, 60, 120,
        ]);
        expect(config.settings.siteRules.map(({ speed }) => speed)).toEqual([16, null]);
        expect(data).toEqual(original);
        if (mode === 'save') {
          expect(getMockStorage().lastSpeed).toBe(16);
          expect(getMockStorage().keyBindings.map(({ value }) => value)).toEqual([
            16, 16, 32, 64, 90, 120, 60, 120,
          ]);
        }
      }
    );

    it('normalizes speed-only saves before the debounce writes storage', async () => {
      const config = new window.VSC.VideoSpeedConfig();
      await config.load();
      await config.save({ lastSpeed: 64 });
      expect(config.settings.lastSpeed).toBe(16);
      expect(config.pendingSave).toBe(16);
      await vi.advanceTimersByTimeAsync(config.SAVE_DELAY + 50);
      expect(getMockStorage().lastSpeed).toBe(16);
    });
  });
});

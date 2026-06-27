/**
 * Reliability contract test for the bridge's bounded storage fetch (P2).
 *
 * content-bridge.js fetches only SYNCED_SETTING_KEYS instead of get(null). If
 * that list ever drops a key that lives in DEFAULT_SETTINGS, that setting would
 * silently never reach the MAIN world. This test fails loudly when the two
 * drift apart.
 */

import { SYNCED_SETTING_KEYS } from '../../../src/utils/setting-keys.js';

describe('SYNCED_SETTING_KEYS', () => {
  it('covers every key in DEFAULT_SETTINGS', () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;
    const missing = Object.keys(defaults).filter((key) => !SYNCED_SETTING_KEYS.includes(key));
    expect(missing).toEqual([]);
  });

  it('includes the legacy controllerCSS migration key', () => {
    expect(SYNCED_SETTING_KEYS).toContain('controllerCSS');
  });

  it('has no duplicate entries', () => {
    expect(SYNCED_SETTING_KEYS.length).toBe(new Set(SYNCED_SETTING_KEYS).size);
  });
});

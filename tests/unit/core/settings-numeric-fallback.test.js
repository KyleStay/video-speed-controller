/**
 * R6: numeric settings must fall back to defaults when storage holds corrupt /
 * non-numeric values, so NaN never propagates into the controller's styles.
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
} from '../../helpers/chrome-mock.js';

describe('Settings numeric fallback', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  it('falls back to default opacity/button size when storage is non-numeric', async () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;
    getMockStorage().controllerOpacity = 'not-a-number';
    getMockStorage().controllerButtonSize = undefined;

    const config = window.VSC.videoSpeedConfig;
    await config.load();

    expect(config.settings.controllerOpacity).toBe(defaults.controllerOpacity);
    expect(config.settings.controllerButtonSize).toBe(defaults.controllerButtonSize);
    expect(Number.isNaN(config.settings.controllerOpacity)).toBe(false);
    expect(Number.isNaN(config.settings.controllerButtonSize)).toBe(false);
  });

  it('rejects a non-positive button size', async () => {
    const defaults = window.VSC.Constants.DEFAULT_SETTINGS;
    getMockStorage().controllerButtonSize = 0;

    const config = window.VSC.videoSpeedConfig;
    await config.load();

    expect(config.settings.controllerButtonSize).toBe(defaults.controllerButtonSize);
  });

  it('preserves valid numeric values', async () => {
    getMockStorage().controllerOpacity = 0.55;
    getMockStorage().controllerButtonSize = 20;

    const config = window.VSC.videoSpeedConfig;
    await config.load();

    expect(config.settings.controllerOpacity).toBe(0.55);
    expect(config.settings.controllerButtonSize).toBe(20);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BROWSERS,
  createBrowserManifest,
  getBuildTarget,
} from '../../../scripts/browser-config.mjs';

const baseManifest = {
  name: 'StayFast Video',
  version: '0.0.0',
  manifest_version: 3,
  minimum_chrome_version: '111',
  background: {
    service_worker: 'background.js',
  },
  content_scripts: [
    {
      all_frames: true,
      run_at: 'document_start',
      world: 'ISOLATED',
      js: ['content-bridge.js'],
    },
    {
      all_frames: true,
      run_at: 'document_start',
      world: 'MAIN',
      js: ['inject.js'],
    },
  ],
};

describe('browser manifest generation', () => {
  it('keeps Chrome MV3 behavior unchanged while injecting the package version', () => {
    const manifest = createBrowserManifest(baseManifest, 'chrome', '1.2.3');

    expect(manifest).toEqual({
      ...baseManifest,
      version: '1.2.3',
    });
    expect(getBuildTarget('chrome')).toBe('chrome114');
  });

  it('uses a Firefox event page and valid AMO metadata', () => {
    const manifest = createBrowserManifest(baseManifest, 'firefox', '1.2.3');

    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.background).toEqual({ scripts: ['background.js'] });
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id: 'stayfast-video@staytech.co',
      strict_min_version: '128.0',
      data_collection_permissions: {
        required: ['none'],
      },
    });
    expect(getBuildTarget('firefox')).toBe('firefox128');
  });

  it('generates Safari web-extension input without Firefox or Chrome metadata', () => {
    const manifest = createBrowserManifest(baseManifest, 'safari', '1.2.3');

    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(manifest.background).toEqual({ service_worker: 'background.js' });
    expect(getBuildTarget('safari')).toBe('safari18');
  });

  it.each(BROWSERS)('preserves the bridge and MAIN-world content scripts for %s', (browser) => {
    const manifest = createBrowserManifest(baseManifest, browser, '1.2.3');

    expect(manifest.content_scripts).toEqual(baseManifest.content_scripts);
    expect(manifest.content_scripts[0]).toMatchObject({
      all_frames: true,
      run_at: 'document_start',
      world: 'ISOLATED',
    });
    expect(manifest.content_scripts[1]).toMatchObject({
      all_frames: true,
      run_at: 'document_start',
      world: 'MAIN',
    });
  });

  it('does not mutate the shared manifest', () => {
    const original = structuredClone(baseManifest);

    createBrowserManifest(baseManifest, 'firefox', '1.2.3');

    expect(baseManifest).toEqual(original);
  });

  it('rejects unknown browser profiles', () => {
    expect(() => createBrowserManifest(baseManifest, 'opera', '1.2.3')).toThrow(
      'Unsupported browser "opera"'
    );
  });
});

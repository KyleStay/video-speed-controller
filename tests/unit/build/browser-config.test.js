import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BROWSERS,
  RELEASE_READY_BROWSERS,
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
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none'],
      },
    });
    expect(getBuildTarget('firefox')).toBe('firefox140');
  });

  it('generates Safari web-extension input without Firefox or Chrome metadata', () => {
    const manifest = createBrowserManifest(baseManifest, 'safari', '1.2.3');

    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(manifest.background).toEqual({ service_worker: 'background.js' });
    expect(getBuildTarget('safari')).toBe('safari18');
  });

  it('keeps experimental Safari out of release-ready aggregate builds', () => {
    expect(BROWSERS).toContain('safari');
    expect(RELEASE_READY_BROWSERS).toEqual(['chrome', 'firefox']);
    expect(RELEASE_READY_BROWSERS).not.toContain('safari');

    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const buildSource = readFileSync(resolve(process.cwd(), 'scripts/build.mjs'), 'utf8');
    const packageSource = readFileSync(
      resolve(process.cwd(), 'scripts/package-release.js'),
      'utf8'
    );

    expect(packageJson.scripts['package:safari']).toBeUndefined();
    expect(buildSource).toMatch(
      /requestedBrowsers\s*=\s*isAllBrowsers\s*\?\s*RELEASE_READY_BROWSERS/
    );
    expect(packageSource).toContain('for (const targetBrowser of RELEASE_READY_BROWSERS)');
    expect(packageSource).toContain('is experimental and not release-package ready');
  });

  it('uses StayFast names for new artifacts while preserving the legacy Chrome archive', () => {
    const packageSource = readFileSync(
      resolve(process.cwd(), 'scripts/package-release.js'),
      'utf8'
    );
    const githubReleaseSource = readFileSync(
      resolve(process.cwd(), 'scripts/github-release.js'),
      'utf8'
    );

    expect(packageSource).toContain('releaseZipName(targetBrowser, pkg.version)');
    expect(packageSource).toContain('`videospeed-${pkg.version}.zip`');
    expect(githubReleaseSource).toContain('releaseZipNames(RELEASE_READY_BROWSERS, version)');
    expect(githubReleaseSource).toContain('execFileSync(command, args');
    expect(githubReleaseSource).toContain('`StayFast Video ${tag}`');
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

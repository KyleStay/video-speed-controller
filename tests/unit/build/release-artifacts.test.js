import { describe, expect, it } from 'vitest';
import { RELEASE_READY_BROWSERS } from '../../../scripts/browser-config.mjs';
import { releaseZipName, releaseZipNames } from '../../../scripts/release-artifacts.mjs';

describe('release artifact names', () => {
  it('uses the same versioned name for package and GitHub release consumers', () => {
    expect(releaseZipName('chrome', '1.2.3')).toBe('stayfast-video-chrome-1.2.3.zip');
    expect(releaseZipNames(RELEASE_READY_BROWSERS, '1.2.3')).toEqual([
      'stayfast-video-chrome-1.2.3.zip',
      'stayfast-video-firefox-1.2.3.zip',
    ]);
  });
});

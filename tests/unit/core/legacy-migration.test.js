import { describe, expect, it } from 'vitest';
import { legacyBlacklistToSiteRules } from '../../../src/utils/legacy-migration.js';

describe('legacy blacklist migration', () => {
  it('preserves every non-empty pattern as a disabled structured rule', () => {
    expect(legacyBlacklistToSiteRules(' youtube.com\n\n/stream\\d+/i \n')).toEqual([
      { pattern: 'youtube.com', enabled: false, speed: null },
      { pattern: '/stream\\d+/i', enabled: false, speed: null },
    ]);
  });

  it('returns no rules for absent legacy data', () => {
    expect(legacyBlacklistToSiteRules(undefined)).toEqual([]);
  });
});

/**
 * Unit tests for blacklist regex parsing
 * Tests regex patterns with and without flags
 */

import { isBlacklisted } from '../../../src/utils/blacklist.js';

describe('Blacklist Regex', () => {
  describe('should parse regex patterns WITHOUT flags', () => {
    const blacklist = '/(.+)youtube\\.com(\\/*)$/';

    it.each([
      ['https://www.youtube.com/', true],
      ['https://music.youtube.com/', true],
      ['https://m.youtube.com/', true],
      ['https://example.com/', false],
    ])('%s → %s', (url, shouldMatch) => {
      expect(isBlacklisted(blacklist, url)).toBe(shouldMatch);
    });
  });

  describe('should parse regex patterns WITH flags', () => {
    const blacklist = '/(.+)youtube\\.com(\\/*)$/gi';

    it.each([
      ['https://www.youtube.com/', true],
      ['https://YOUTUBE.COM/', true],
      ['https://music.youtube.com/', true],
      ['https://example.com/', false],
    ])('%s → %s', (url, shouldMatch) => {
      expect(isBlacklisted(blacklist, url)).toBe(shouldMatch);
    });
  });

  it('should handle simple string patterns', () => {
    const blacklist = 'youtube.com';
    expect(isBlacklisted(blacklist, 'https://www.youtube.com/watch?v=123')).toBe(true);
  });

  describe('should handle multiple blacklist entries with mixed formats', () => {
    const blacklist = `youtube.com
/(.+)instagram\\.com/
/twitter\\.com/gi`;

    it.each([
      ['https://www.youtube.com/', true],
      ['https://www.instagram.com/', true],
      ['https://twitter.com/', true],
      ['https://TWITTER.COM/', true],
      ['https://example.com/', false],
    ])('%s → %s', (url, shouldMatch) => {
      expect(isBlacklisted(blacklist, url)).toBe(shouldMatch);
    });
  });

  it('should handle malformed regex patterns gracefully', () => {
    const blacklist = `//
/[unclosed
/valid\\.com/`;

    expect(() => isBlacklisted(blacklist, 'https://valid.com/')).not.toThrow();
    expect(isBlacklisted(blacklist, 'https://valid.com/')).toBe(true);
  });

  it('should handle empty patterns', () => {
    const blacklist = `

youtube.com

`;
    expect(isBlacklisted(blacklist, 'https://www.youtube.com/')).toBe(true);
  });

  describe('should not match partial domain names (x.com should not match netflix.com)', () => {
    const blacklist = 'x.com';

    it.each([
      ['https://x.com/', true],
      ['https://www.x.com/', true],
      ['https://x.com/status/123', true],
      ['https://netflix.com/', false],
      ['https://max.com/', false],
      ['https://fox.com/', false],
    ])('%s → %s', (url, shouldMatch) => {
      expect(isBlacklisted(blacklist, url)).toBe(shouldMatch);
    });
  });

  describe('should handle real user blacklist correctly (netflix.com should NOT be blocked)', () => {
    const blacklist = `www.instagram.com
x.com
imgur.com
teams.microsoft.com
meet.google.com`;

    it.each([
      ['https://www.instagram.com/', true],
      ['https://instagram.com/', false],
      ['https://x.com/', true],
      ['https://www.x.com/', true],
      ['https://imgur.com/', true],
      ['https://teams.microsoft.com/', true],
      ['https://meet.google.com/', true],
      ['https://netflix.com/', false],
      ['https://www.netflix.com/', false],
      ['https://max.com/', false],
      ['https://fox.com/', false],
      ['https://google.com/', false],
      ['https://microsoft.com/', false],
    ])('%s → %s', (url, shouldMatch) => {
      expect(isBlacklisted(blacklist, url)).toBe(shouldMatch);
    });
  });
});

describe('domain patterns use only the URL hostname', () => {
  it.each([
    ['https://youtube.com?watch=1', true],
    ['https://youtube.com#player', true],
    ['https://YOUTUBE.COM/watch', true],
    ['https://music.youtube.com:8443/watch', true],
    ['https://example.com/?next=https://youtube.com/watch', false],
    ['https://example.com/a.youtube.com/', false],
    ['https://youtube.com@example.com/', false],
    ['https://youtube.com.example.com/', false],
    ['not a URL', false],
  ])('%s → %s', (href, expected) => {
    expect(isBlacklisted('youtube.com', href)).toBe(expected);
  });
});

describe('full-URL and explicit-port patterns remain supported', () => {
  it.each([
    ['watch?v=', 'https://example.com/watch?v=123'],
    ['/youtube\\.com/', 'https://example.com/?next=https://youtube.com/watch'],
    ['youtube.com:8443', 'https://music.youtube.com:8443/watch'],
  ])('%s matches %s', (pattern, href) => {
    expect(isBlacklisted(pattern, href)).toBe(true);
  });
});

describe('port patterns match the effective HTTP(S) port', () => {
  it.each([
    ['youtube.com:443', 'https://youtube.com:443/watch', true],
    ['youtube.com:443', 'https://youtube.com/watch', true],
    ['youtube.com:80', 'http://youtube.com:80/watch', true],
    ['youtube.com:80', 'http://youtube.com/watch', true],
    ['youtube.com:443', 'https://youtube.com:8443/watch', false],
    ['youtube.com:80', 'https://youtube.com/watch', false],
    ['youtube.com:443', 'http://youtube.com/watch', false],
    ['youtube.com:8443', 'https://youtube.com:9443/watch', false],
    ['youtube.com:443', 'https://example.com/?next=https://youtube.com:443/watch', false],
  ])('%s against %s → %s', (pattern, href, expected) => {
    expect(isBlacklisted(pattern, href)).toBe(expected);
  });
});

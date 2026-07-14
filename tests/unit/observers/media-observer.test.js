/**
 * Unit tests for MediaElementObserver:
 *   - hasMediaIndicators() gate for the comprehensive scan (P4)
 *   - depth-capped shadow DOM media discovery (P4)
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';

/** Minimal site handler stub for the observer. */
function makeSiteHandler(containerSelectors = []) {
  return {
    getVideoContainerSelectors: () => containerSelectors,
    detectSpecialVideos: () => [],
    shouldIgnoreVideo: () => false,
  };
}

function makeObserver({ audioBoolean = false, containerSelectors = [] } = {}) {
  const config = { settings: { audioBoolean } };
  return new window.VSC.MediaElementObserver(config, makeSiteHandler(containerSelectors));
}

/** Isolated document so other tests' DOM can't leak into the scan. */
function freshDoc() {
  return document.implementation.createHTMLDocument('test');
}

describe('MediaElementObserver', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  describe('hasMediaIndicators (comprehensive scan gate)', () => {
    it('returns false for a frame with no media, iframe, shadow host, or site rules', () => {
      const observer = makeObserver();
      const doc = freshDoc();
      doc.body.innerHTML = '<div><p>just text</p></div>';
      expect(observer.hasMediaIndicators(doc)).toBe(false);
    });

    it('returns true when a <video> is present', () => {
      const observer = makeObserver();
      const doc = freshDoc();
      doc.body.innerHTML = '<div><video></video></div>';
      expect(observer.hasMediaIndicators(doc)).toBe(true);
    });

    it('returns true when an <iframe> is present (may host media)', () => {
      const observer = makeObserver();
      const doc = freshDoc();
      doc.body.innerHTML = '<iframe></iframe>';
      expect(observer.hasMediaIndicators(doc)).toBe(true);
    });

    it('ignores <audio> when audioBoolean is disabled', () => {
      const observer = makeObserver({ audioBoolean: false });
      const doc = freshDoc();
      doc.body.innerHTML = '<audio></audio>';
      expect(observer.hasMediaIndicators(doc)).toBe(false);
    });

    it('detects <audio> when audioBoolean is enabled', () => {
      const observer = makeObserver({ audioBoolean: true });
      const doc = freshDoc();
      doc.body.innerHTML = '<audio></audio>';
      expect(observer.hasMediaIndicators(doc)).toBe(true);
    });

    it('returns true when a shadow host exists even with no light-DOM media', () => {
      const observer = makeObserver();
      const doc = freshDoc();
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      host.attachShadow({ mode: 'open' });
      expect(observer.hasMediaIndicators(doc)).toBe(true);
    });

    it('returns true on a known site with container selectors', () => {
      const observer = makeObserver({ containerSelectors: ['.html5-video-player'] });
      const doc = freshDoc();
      doc.body.innerHTML = '<div></div>';
      expect(observer.hasMediaIndicators(doc)).toBe(true);
    });
  });

  describe('depth-capped shadow media discovery', () => {
    it('exposes a finite MAX_SHADOW_DEPTH', () => {
      expect(Number.isFinite(window.VSC.MediaElementObserver.MAX_SHADOW_DEPTH)).toBe(true);
      expect(window.VSC.MediaElementObserver.MAX_SHADOW_DEPTH).toBeGreaterThan(0);
    });

    it('finds media nested within shallow shadow roots', () => {
      const observer = makeObserver();
      const doc = freshDoc();
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const inner = doc.createElement('div');
      root.appendChild(inner);
      const innerRoot = inner.attachShadow({ mode: 'open' });
      innerRoot.appendChild(doc.createElement('video'));

      const found = observer.scanForMedia(doc);
      expect(found.length).toBe(1);
      expect(found[0].tagName).toBe('VIDEO');
    });

    it('does not recurse past MAX_SHADOW_DEPTH', () => {
      const observer = makeObserver();
      const doc = freshDoc();
      const cap = window.VSC.MediaElementObserver.MAX_SHADOW_DEPTH;

      // Build a shadow chain deeper than the cap with a <video> at the bottom.
      let current = doc.body;
      for (let i = 0; i <= cap + 2; i++) {
        const host = doc.createElement('div');
        current.appendChild(host);
        current = host.attachShadow({ mode: 'open' });
      }
      current.appendChild(doc.createElement('video'));

      // The deep video is beyond the cap and must not be discovered (the cap
      // protects the main thread); the call must not throw.
      const found = observer.scanForMedia(doc);
      expect(found.length).toBe(0);
    });
  });
});

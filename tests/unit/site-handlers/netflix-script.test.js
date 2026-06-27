/**
 * Tests for the MAIN-world Netflix seek listener (src/site-handlers/scripts/netflix.js).
 *
 * This listener is bundled into every page, so it must be robust against
 * arbitrary same-origin postMessage payloads and a missing/changed Netflix API.
 */

import { vi, describe, it, expect, beforeAll, afterEach } from 'vitest';

function postMessageEvent(data, origin) {
  // jsdom honors `origin` in the MessageEvent init dict; define it explicitly
  // as a fallback so the listener's origin check sees the intended value.
  const event = new MessageEvent('message', { data, origin });
  if (event.origin !== origin) {
    Object.defineProperty(event, 'origin', { value: origin, configurable: true });
  }
  return event;
}

describe('netflix.js seek listener', () => {
  beforeAll(async () => {
    await import('../../../src/site-handlers/scripts/netflix.js');
  });

  afterEach(() => {
    delete window.netflix;
  });

  const NETFLIX = 'https://www.netflix.com';

  it('ignores messages from other origins without touching the API', () => {
    window.netflix = {
      appContext: {
        state: {
          playerApp: {
            getAPI: () => {
              throw new Error('should not be called');
            },
          },
        },
      },
    };
    expect(() =>
      window.dispatchEvent(
        postMessageEvent({ action: 'videospeed-seek', seekMs: 1000 }, 'https://evil.example')
      )
    ).not.toThrow();
  });

  it('does not throw on a null payload from the Netflix origin', () => {
    expect(() => window.dispatchEvent(postMessageEvent(null, NETFLIX))).not.toThrow();
  });

  it('does not throw on a primitive payload from the Netflix origin', () => {
    expect(() => window.dispatchEvent(postMessageEvent('hello', NETFLIX))).not.toThrow();
    expect(() => window.dispatchEvent(postMessageEvent(42, NETFLIX))).not.toThrow();
  });

  it('does not throw when the Netflix player API is unavailable', () => {
    // window.netflix intentionally undefined
    expect(() =>
      window.dispatchEvent(postMessageEvent({ action: 'videospeed-seek', seekMs: 1000 }, NETFLIX))
    ).not.toThrow();
  });

  it('seeks via the Netflix API for a well-formed seek message', () => {
    const seek = vi.fn();
    const videoPlayer = {
      getAllPlayerSessionIds: () => ['s1'],
      getCurrentTimeBySessionId: () => 5000,
      getVideoPlayerBySessionId: () => ({ seek }),
    };
    window.netflix = {
      appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer }) } } },
    };

    window.dispatchEvent(postMessageEvent({ action: 'videospeed-seek', seekMs: 1000 }, NETFLIX));

    expect(seek).toHaveBeenCalledWith(6000);
  });

  it('ignores non-seek actions from the Netflix origin', () => {
    const getAPI = vi.fn();
    window.netflix = { appContext: { state: { playerApp: { getAPI } } } };
    window.dispatchEvent(postMessageEvent({ action: 'something-else' }, NETFLIX));
    expect(getAPI).not.toHaveBeenCalled();
  });
});

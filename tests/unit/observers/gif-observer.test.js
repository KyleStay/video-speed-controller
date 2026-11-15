import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gifFixture } from '../../helpers/gif-fixture.js';

let observer;
const image = (src = 'https://example.test/animation.gif') => {
  const node = document.createElement('img');
  node.src = src;
  Object.defineProperties(node, { complete: { get: () => true }, naturalWidth: { get: () => 4 } });
  document.body.append(node);
  return node;
};

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(gifFixture()))
  );
});
afterEach(() => {
  observer?.cleanup();
  observer = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded GIF discovery', () => {
  it('does not fetch ordinary still images or videos', async () => {
    observer = new window.VSC.GifObserver(document, vi.fn());
    observer.consider(image('https://example.test/image.png'));
    observer.consider(document.createElement('video'));
    await observer.pump();
    expect(fetch).not.toHaveBeenCalled();
    expect(observer.entries.size).toBe(0);
  });
  it.each([
    'animation.GIF?cache=1',
    'image?format=gif',
    'data:image/gif;base64,R0lGODlh',
    'blob:https://example.test/id',
  ])('recognizes potential GIF resources without treating their URL as proof: %s', (src) => {
    expect(
      window.VSC.GifObserver.candidate(image(new URL(src, 'https://example.test/').href))
    ).toBe(true);
  });
  it('waits for intersection before fetching and does not retry failed resources on rediscovery', async () => {
    let callback;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(fn) {
          callback = fn;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const node = image();
    observer = new window.VSC.GifObserver(document, vi.fn());
    fetch.mockRejectedValue(new Error('Blocked by CORS'));
    await observer.pump();
    expect(fetch).not.toHaveBeenCalled();
    callback([{ target: node, isIntersecting: true }]);
    await observer.pump();
    observer.consider(node);
    await observer.pump();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(node.vsc).toBeUndefined();
  });
  it('leaves single-frame GIFs unchanged without decoding or adding controllers', async () => {
    image();
    fetch.mockResolvedValue(new Response(gifFixture({ frames: [{ color: 1, delay: 20 }] })));
    const decode = vi.spyOn(window.VSC.GifDecoder, 'decode');
    const attach = vi.fn();
    observer = new window.VSC.GifObserver(document, attach);
    await observer.pump();
    expect(decode).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(observer.framePixels).toBe(0);
    expect(observer.entries.size).toBe(0);
  });
  it('does not let offscreen candidates consume the visible decoding queue', () => {
    let callback;
    const observed = new Set();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(fn) {
          callback = fn;
        }
        observe(node) {
          observed.add(node);
        }
        unobserve(node) {
          observed.delete(node);
        }
        disconnect() {
          observed.clear();
        }
      }
    );
    observer = new window.VSC.GifObserver(document, vi.fn());
    for (let index = 0; index < 40; index++) {
      observer.consider(image(`https://example.test/offscreen-${index}.gif`));
    }
    const visible = image('https://example.test/visible.gif');
    observer.consider(visible);
    expect(observer.entries.size).toBe(0);
    expect(observed.has(visible)).toBe(true);
    callback([{ target: visible, isIntersecting: true }]);
    expect(observer.entries.get(visible).visible).toBe(true);
  });
  it('reconsiders detached nodes without retrying failed connected resources', () => {
    const node = image();
    observer = new window.VSC.GifObserver(document, vi.fn());
    const first = observer.entries.get(node);
    node.remove();
    observer.remove(node);
    document.body.append(node);
    observer.consider(node);
    expect(observer.entries.get(node)).toBeDefined();
    expect(observer.entries.get(node)).not.toBe(first);
    expect(first.abort.signal.aborted).toBe(true);
  });
  it('reclaims queued slots when visible images scroll away before decoding', () => {
    let callback;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(fn) {
          callback = fn;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    observer = new window.VSC.GifObserver(document, vi.fn());
    const first = Array.from({ length: 32 }, (_, index) =>
      image(`https://example.test/${index}.gif`)
    );
    for (const node of first) {
      observer.consider(node);
    }
    callback(first.map((target) => ({ target, isIntersecting: true })));
    expect(observer.entries.size).toBe(32);
    callback(first.map((target) => ({ target, isIntersecting: false })));
    expect(observer.entries.size).toBe(0);
    expect(first.every((node) => !observer.attempts.has(node))).toBe(true);
    const next = image('https://example.test/next.gif');
    observer.consider(next);
    callback([{ target: next, isIntersecting: true }]);
    expect(observer.entries.has(next)).toBe(true);
    callback([{ target: first[0], isIntersecting: true }]);
    expect(observer.entries.has(first[0])).toBe(true);
  });
  it('admits visible overflow when a decoding slot is released', async () => {
    vi.useFakeTimers();
    try {
      observer = new window.VSC.GifObserver(document, vi.fn());
      for (let index = 0; index < 32; index++) {
        observer.consider(image(`https://example.test/${index}.gif`));
      }
      const extra = image('https://example.test/extra.gif');
      observer.consider(extra);
      expect(observer.waiting.has(extra)).toBe(true);
      const first = observer.entries.keys().next().value;
      first.remove();
      observer.remove(first);
      const pump = vi.spyOn(observer, 'pump').mockResolvedValue();
      await vi.advanceTimersByTimeAsync(0);
      expect(observer.entries.has(extra)).toBe(true);
      expect(observer.entries.size).toBe(32);
      expect(pump).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('aborts pending work when a source changes and never attaches an older result', async () => {
    let resolve;
    fetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const node = image();
    const attach = vi.fn();
    observer = new window.VSC.GifObserver(document, attach);
    const pending = observer.pump();
    const signal = fetch.mock.calls[0][1].signal;
    node.src = 'https://example.test/replacement.gif';
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    resolve(new Response(gifFixture()));
    await pending;
    expect(attach).not.toHaveBeenCalled();
    expect(observer.entries.get(node).source).toBe('https://example.test/replacement.gif');
  });
  it('bounds pending candidates and releases root listeners and work on cleanup', () => {
    observer = new window.VSC.GifObserver(document, vi.fn());
    for (let index = 0; index < 50; index++) {
      observer.consider(image(`https://example.test/${index}.gif`));
    }
    expect(observer.entries.size).toBe(32);
    const rows = [...observer.entries.values()];
    observer.cleanup();
    expect(rows.every((row) => row.abort.signal.aborted)).toBe(true);
    expect(observer.entries.size).toBe(0);
    expect(observer.roots.size).toBe(0);
  });
});

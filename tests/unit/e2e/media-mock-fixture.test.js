import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMediaMock, MEDIA_MOCK_CASES } from '../../e2e/media-mock-fixture.js';

const html = readFileSync(resolve('tests/e2e/media-mocks.html'), 'utf8');
const instances = [];
function fixture(profile, extra = '', setup = () => {}) {
  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:62001/media-mocks.html?case=${profile}${extra}`,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const { document } = window;
  for (const method of ['pause', 'load']) {
    window.HTMLMediaElement.prototype[method] = vi.fn();
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const observers = [];
  window.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      observers.push(this);
    }
  };
  setup(window);
  const api = installMediaMock(document);
  instances.push({ dom, api });
  return {
    window,
    document,
    api,
    observers,
    clip: () => document.querySelector('video'),
    click: (selector) => document.querySelector(selector).click(),
    quality: (value) => {
      const select = document.querySelector('#quality');
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    state: () => window.__mediaMockState(),
  };
}
afterEach(() => {
  instances.splice(0).forEach(({ dom, api }) => {
    api.dispose();
    dom.window.close();
  });
  vi.useRealTimers();
});

describe('complete neutral media mock contracts', () => {
  it('identifies all seventeen profiles using only stable IDs and readable behavior contracts', () => {
    expect(new Set(MEDIA_MOCK_CASES.map((row) => row.id)).size).toBe(17);
    for (const row of MEDIA_MOCK_CASES) {
      expect(Object.keys(row).sort()).toEqual(['contract', 'id']);
      expect(row.id).toMatch(/^[a-z]+(?:-[a-z]+)+$/);
      expect(row.contract).toEqual(expect.any(String));
      expect(row.contract.trim().length).toBeGreaterThan(20);
      expect(row.contract).not.toMatch(/https?:\/\/|www\./i);
    }
  });

  it('keeps loop-feed media, audio intent and selected rendition through subsequent clips', () => {
    const f = fixture('loop-feed');
    const clip = f.clip();
    expect(clip.muted && clip.loop).toBe(true);
    expect([...f.document.querySelector('#quality').options].map((option) => option.value)).toEqual(
      ['gif', 'sd', 'hd']
    );
    f.quality('hd');
    f.click('#mute');
    const track = clip.querySelector('track');
    for (let index = 2; index <= 6; index++) {
      f.click('#next');
      expect(f.clip()).toBe(clip);
      expect(clip.querySelector('source').src).toContain(`asset=${index}&quality=hd`);
      expect(clip.querySelector('track')).toBe(track);
      expect(clip.muted).toBe(false);
    }
  });

  it.each(['adaptive-watch', 'rendition-watch'])(
    '%s retains the element and track across genuine local transport alternatives',
    (profile) => {
      const f = fixture(profile);
      const clip = f.clip(),
        track = clip.querySelector('track');
      f.click('#adaptive');
      expect(clip.querySelector('source').src).toBe(
        'http://127.0.0.1:62001/mock-media/playlist.m3u8'
      );
      expect(clip.querySelector('source').type).toBe('application/vnd.apple.mpegurl');
      f.click('#file');
      f.click('#quality-low');
      expect(f.clip()).toBe(clip);
      expect(clip.querySelector('track')).toBe(track);
      expect(clip.querySelector('source').src).toContain(
        '/mock-media/fallback.mp4?asset=1&quality=low'
      );
      expect(clip.querySelector('source').type).toBe('video/mp4');
      expect(clip.load).toHaveBeenCalledTimes(3);
    }
  );

  it('models a delayed site rate write and cancels stale writes on source replacement', () => {
    vi.useFakeTimers();
    const f = fixture('rendition-watch');
    f.clip().playbackRate = 2.1;
    f.click('#queue-reset');
    expect(f.state().pendingReset).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(f.clip().playbackRate).toBe(1);
    expect(f.state().resets).toBe(1);
    f.clip().playbackRate = 4;
    f.click('#queue-reset');
    f.click('#file');
    expect(f.state().pendingReset).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(f.clip().playbackRate).toBe(4);
    expect(f.state().resets).toBe(1);
  });

  it('models unavailable playlist media, explicit recovery and next-clip source reuse', () => {
    const f = fixture('playlist-watch');
    const clip = f.clip();
    f.click('#unavailable');
    expect(clip.querySelector('source').src).toContain('/mock-media/unavailable.mp4');
    clip.dispatchEvent(new f.window.Event('error'));
    expect(f.state().errors).toEqual(['Local media unavailable']);
    f.click('#recover');
    f.click('#next');
    expect(f.clip()).toBe(clip);
    expect(clip.querySelector('source').src).toContain('asset=2');
    expect(clip.querySelector('source').src).not.toContain('unavailable');
  });

  it('cycles a mixed gallery without accidentally removing unrelated controller-like nodes', () => {
    const f = fixture('mixed-gallery');
    const stage = f.document.querySelector('.player');
    const chrome = f.document.createElement('div');
    chrome.className = 'vsc-controller';
    stage.prepend(chrome);
    const still = f.document.querySelector('#gallery-item');
    expect(still.src).toContain('/mock-still.gif');
    f.click('#gallery-next');
    expect(still.isConnected).toBe(false);
    expect(f.document.querySelector('#gallery-item').src).toContain('/mock-animated.gif');
    f.click('#gallery-next');
    expect(f.clip().querySelector('source').src).toContain('/mock-media/fallback.mp4');
    f.click('#gallery-next');
    expect(f.clip().querySelector('source').src).toContain('/mock-media/clip.webm');
    f.click('#gallery-next');
    f.click('#gallery-previous');
    expect(f.clip().querySelector('source').src).toContain('/mock-media/clip.webm');
    expect(chrome.isConnected).toBe(true);
    expect(stage.querySelectorAll('video, img')).toHaveLength(1);
  });

  it.each(['discussion-feed', 'post-viewer'])(
    '%s duplicates media without copying its object state or disturbing a separate embed',
    (profile) => {
      const f = fixture(profile, '&framePort=62002');
      const original = f.clip();
      original.playbackRate = 2;
      f.click('#duplicate');
      f.click('#duplicate');
      const duplicate = f.document.querySelector('#duplicate-video');
      expect(f.document.querySelectorAll('video')).toHaveLength(2);
      expect(duplicate).not.toBe(original);
      expect(duplicate.querySelector('source').src).toBe(original.querySelector('source').src);
      duplicate.playbackRate = 4;
      expect(original.playbackRate).toBe(2);
      expect(f.document.querySelector('#reply').getAttribute('aria-label')).toBe('Comment');
      f.click('#embed');
      const frame = f.document.querySelector('iframe');
      expect(frame.src).toContain('http://127.0.0.1:62002/media-mocks.html?case=frame-player');
      f.click('#remove-duplicate');
      expect(duplicate.isConnected).toBe(false);
      expect(frame.isConnected).toBe(true);
    }
  );

  it('restores the same post, media and caption node after site-viewer reparenting', () => {
    const f = fixture('post-viewer');
    const original = f.document.querySelector('#original-post'),
      clip = f.clip(),
      track = clip.querySelector('track');
    f.click('#open-viewer');
    expect(original.parentElement.id).toBe('site-viewer');
    expect(f.document.querySelector('#post-slot')).not.toBeNull();
    f.click('#close-viewer');
    expect(original.parentElement).toBe(f.document.querySelector('main'));
    expect(f.document.querySelector('#post-slot')).toBeNull();
    expect(f.clip()).toBe(clip);
    expect(clip.querySelector('track')).toBe(track);
    expect(f.document.querySelector('#post-animation').src).toContain('/mock-animated.gif');
  });

  it('recreates source embeds with a new identity and toggles viewer presentation', () => {
    const f = fixture('source-embed', '&framePort=62002&mp4');
    f.click('#open-embed');
    const before = f.document.querySelector('iframe');
    f.click('#theater');
    expect(before.classList.contains('expanded')).toBe(true);
    f.click('#theater');
    expect(before.classList.contains('expanded')).toBe(false);
    f.click('#recreate');
    const after = f.document.querySelector('iframe');
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
    expect(after.src).toContain('asset=2&mp4');
  });

  it('resizes a compact embed without replacing it, then removes and reinserts a fresh frame', () => {
    const f = fixture('compact-embed');
    f.click('#open-embed');
    const before = f.document.querySelector('iframe');
    f.click('#resize');
    expect(f.document.querySelector('iframe')).toBe(before);
    expect(before.classList.contains('wide')).toBe(true);
    f.click('#close-embed');
    expect(before.isConnected).toBe(false);
    f.click('#open-embed');
    expect(f.document.querySelector('iframe')).not.toBe(before);
  });

  it.each(['https://example.invalid', '0', '65536'])(
    'refuses an invalid frame target %s',
    (port) => {
      const f = fixture('source-embed', `&framePort=${encodeURIComponent(port)}`);
      f.click('#open-embed');
      expect(f.document.querySelector('iframe')).toBeNull();
    }
  );

  it('binds child media to the requested numeric asset and leaves unknown cases inert', () => {
    const f = fixture('frame-player', '&asset=7');
    expect(f.clip().querySelector('source').src).toContain('asset=7');
    const unknown = fixture('unknown');
    expect(unknown.document.querySelector('video, img, iframe')).toBeNull();
    expect(unknown.document.querySelector('#status').textContent).toBe('Unknown local case');
  });

  it('disposes idempotently, cancels timers and releases control handlers', () => {
    vi.useFakeTimers();
    const f = fixture('rendition-watch');
    f.clip().playbackRate = 4;
    f.click('#queue-reset');
    f.api.dispose();
    f.api.dispose();
    vi.advanceTimersByTime(3000);
    expect(f.state()).toMatchObject({ resets: 0, pendingReset: false, disposed: true });
    f.click('#queue-reset');
    expect(f.state().pendingReset).toBe(false);
    expect(f.clip().pause).toHaveBeenCalledOnce();
  });

  it('cancels stale navigation replacements and preserves the same media across layout changes', () => {
    vi.useFakeTimers();
    const f = fixture('watch-navigation');
    const first = f.clip();
    f.click('#short-layout');
    expect(first.parentElement.classList.contains('short-layout')).toBe(true);
    f.click('#next-entry');
    f.click('#next-entry');
    vi.advanceTimersByTime(199);
    expect(f.clip()).toBe(first);
    vi.advanceTimersByTime(1);
    expect(first.isConnected).toBe(false);
    const latest = f.clip();
    expect(latest.querySelector('source').src).toContain('asset=3');
    f.click('#next-entry');
    f.api.dispose();
    vi.advanceTimersByTime(500);
    expect(f.clip()).toBe(latest);
  });

  it('retains carousel nodes, mute intent and viewer restoration across every media type', () => {
    const f = fixture('carousel-viewer');
    const first = f.document.querySelector('#carousel-video-0');
    f.click('#mute-active');
    f.click('#carousel-next');
    f.click('#carousel-next');
    f.click('#carousel-next');
    const last = f.document.querySelector('#carousel-video-3');
    expect(last.muted).toBe(false);
    const stage = last.closest('.player'),
      slot = stage.parentElement;
    f.click('#viewer-open');
    expect(stage.parentElement.classList.contains('profile-viewer')).toBe(true);
    f.click('#viewer-close');
    expect(stage.parentElement).toBe(slot);
    f.click('#carousel-next');
    expect(f.document.querySelector('#carousel-video-0')).toBe(first);
    expect(first.parentElement.hidden).toBe(false);
    expect(last.parentElement.hidden).toBe(true);
    expect(f.document.querySelectorAll('video')).toHaveLength(2);
  });

  it('accepts frame commands only from the exact parent origin and keeps rendition source identity', () => {
    const f = fixture('command-player', '&parentPort=62002');
    const send = (origin, source, command, asset) =>
      f.window.dispatchEvent(
        new f.window.MessageEvent('message', {
          origin,
          source,
          data: { type: 'local-media-command', command, asset },
        })
      );
    send('http://127.0.0.1:62003', f.window, 'next', 7);
    send('http://127.0.0.1:62002', null, 'next', 7);
    send('http://127.0.0.1:62002', f.window, 'next', -1);
    expect(f.state().detail.messages).toBe(0);
    send('http://127.0.0.1:62002', f.window, 'next', 7);
    f.click('#quality-low');
    expect(f.clip().querySelector('source').src).toContain('asset=7&quality=low');
    expect(f.state().detail.messages).toBe(1);
    f.api.dispose();
    send('http://127.0.0.1:62002', f.window, 'next', 8);
    expect(f.state().detail.asset).toBe(7);
  });

  it.each(['command-feed', 'coordinated-embeds'])(
    '%s creates only local command frames and scopes messages to their windows',
    (profile) => {
      const f = fixture(profile, '&framePort=62002');
      const frames = [...f.document.querySelectorAll('iframe')];
      const send = frames.map((frame) =>
        vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {})
      );
      f.click('#play-first');
      expect(send[0]).toHaveBeenCalledWith(
        { type: 'local-media-command', command: 'play' },
        'http://127.0.0.1:62002'
      );
      expect(frames[0].src).toContain('parentPort=62001');
      if (profile === 'coordinated-embeds') {
        const status = (source, origin) =>
          f.window.dispatchEvent(
            new f.window.MessageEvent('message', {
              origin,
              source,
              data: { type: 'local-media-status', command: 'playing' },
            })
          );
        status(frames[0].contentWindow, 'http://127.0.0.1:62003');
        expect(send[1]).not.toHaveBeenCalled();
        status(frames[0].contentWindow, 'http://127.0.0.1:62002');
        expect(send[1]).toHaveBeenCalledOnce();
        f.click('#allow-concurrent');
        status(frames[0].contentWindow, 'http://127.0.0.1:62002');
        expect(send[1]).toHaveBeenCalledOnce();
      } else {
        f.click('#next-entry');
        expect(send[0]).toHaveBeenLastCalledWith(
          { type: 'local-media-command', command: 'next', asset: 2 },
          'http://127.0.0.1:62002'
        );
      }
    }
  );

  it('keeps the same floating-feed media and captions across all presentation containers', () => {
    const f = fixture('floating-feed');
    const clip = f.clip(),
      track = clip.querySelector('track'),
      original = clip.parentElement.parentElement;
    for (const id of ['#expand-player', '#float-player', '#return-player']) {
      f.click(id);
      expect(f.clip()).toBe(clip);
      expect(clip.querySelector('track')).toBe(track);
    }
    expect(clip.parentElement.parentElement).toBe(original);
    f.click('#hide-player');
    expect(clip.parentElement.hidden).toBe(true);
    f.click('#show-player');
    expect(clip.parentElement.hidden).toBe(false);
  });

  it('renews attachment sources in place and removes media even while it is outside its message', () => {
    const f = fixture('attachment-thread');
    const clip = f.clip(),
      track = clip.querySelector('track');
    f.click('#open-attachment');
    f.click('#expire-attachment');
    expect(clip.querySelector('source').src).toContain('unavailable');
    f.click('#renew-attachment');
    expect(clip.querySelector('source').src).toContain('asset=2');
    expect(clip.querySelector('track')).toBe(track);
    f.click('#remove-message');
    expect(clip.isConnected).toBe(false);
    expect(f.document.querySelectorAll('video, img')).toHaveLength(0);
    f.click('#new-message');
    expect(f.clip()).not.toBe(clip);
    expect(f.clip().querySelector('source').src).toContain('asset=3');
  });

  it('arms staged startup only on input, disconnects visibility observation and replaces the preview once', () => {
    const f = fixture('staged-player');
    const observer = f.observers[0];
    expect(f.clip()).toBeNull();
    expect(observer.observe).not.toHaveBeenCalled();
    f.click('#load-player');
    observer.callback([{ isIntersecting: true }]);
    const preview = f.clip();
    expect(preview).not.toBeNull();
    expect(observer.disconnect).toHaveBeenCalled();
    f.click('#skip-stage');
    const content = f.clip();
    expect(content).not.toBe(preview);
    expect(preview.isConnected).toBe(false);
    f.click('#next-entry');
    expect(f.clip()).toBe(content);
    expect(content.querySelector('source').src).toContain('asset=2');
    const late = fixture('staged-player');
    late.click('#load-player');
    late.api.dispose();
    late.observers[0].callback([{ isIntersecting: true }]);
    expect(late.clip()).toBeNull();
  });

  it.each(['MediaSource', 'ManagedMediaSource'])(
    'aborts in-flight %s segments and revokes the owned URL on disposal',
    async (sourceType) => {
      let mediaSource;
      const f = fixture('live-window', '', (window) => {
        window[sourceType] = class extends window.EventTarget {
          static isTypeSupported() {
            return true;
          }
          constructor() {
            super();
            this.readyState = 'open';
            mediaSource = this;
          }
          addSourceBuffer() {
            return { updating: false };
          }
        };
        window.URL.createObjectURL = vi.fn(() => 'blob:http://127.0.0.1:62001/local-stream');
        window.URL.revokeObjectURL = vi.fn();
        window.fetch = vi.fn(
          (_url, { signal }) =>
            new Promise((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            )
        );
      });
      expect(f.clip().disableRemotePlayback === true).toBe(sourceType === 'ManagedMediaSource');
      mediaSource.dispatchEvent(new f.window.Event('sourceopen'));
      expect(f.window.fetch).toHaveBeenCalledOnce();
      const signal = f.window.fetch.mock.calls[0][1].signal;
      f.api.dispose();
      await Promise.resolve();
      expect(signal.aborted).toBe(true);
      expect(f.window.URL.revokeObjectURL).toHaveBeenCalledWith(
        'blob:http://127.0.0.1:62001/local-stream'
      );
      expect(f.state().detail.disposed).toBe(true);
    }
  );

  it('keeps native QA affordances bound to the current media after replacement', () => {
    vi.useFakeTimers();
    const f = fixture('watch-navigation', '&native-qa');
    const first = f.clip();
    expect(first.querySelector('track').default).toBe(true);
    f.click('#next-entry');
    vi.advanceTimersByTime(200);
    const current = f.clip();
    expect(current).not.toBe(first);
    expect(f.document.querySelectorAll('[data-native-focus]')).toHaveLength(1);
    f.click('[data-native-focus]');
    expect(current.scrollIntoView.mock.contexts.at(-1)).toBe(current);
    f.api.dispose();
    current.scrollIntoView.mockClear();
    f.click('[data-native-focus]');
    expect(current.scrollIntoView).not.toHaveBeenCalled();
  });

  it('constructs only local media and frame URLs in every case', () => {
    for (const { id } of MEDIA_MOCK_CASES) {
      const f = fixture(id, '&framePort=62002');
      f.document.querySelector('#open-embed, #embed')?.click();
      for (const node of f.document.querySelectorAll('[src]')) {
        const url = new URL(node.src);
        expect(url.hostname).toBe('127.0.0.1');
        expect(['62001', '62002']).toContain(url.port);
      }
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('tests/e2e/media-patterns.html'), 'utf8');
const instances = [];
function fixture(query = '') {
  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:62938/media-patterns.html${query}`,
    runScripts: 'outside-only',
  });
  instances.push(dom);
  for (const method of ['pause', 'load']) {
    dom.window.HTMLMediaElement.prototype[method] = vi.fn();
  }
  dom.window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
  dom.window.eval(dom.window.document.querySelector('script').textContent);
  const document = dom.window.document;
  return {
    window: dom.window,
    document,
    click: (selector) => document.querySelector(selector).click(),
  };
}
afterEach(() => {
  instances.splice(0).forEach((dom) => dom.window.close());
});

describe('neutral local media fixtures', () => {
  it('starts a collapsed board without media, then independently expands and collapses attachments', () => {
    const f = fixture();
    expect(f.document.querySelector('video')).toBeNull();
    f.click('#expand-1');
    f.click('#expand-2');
    const old = f.document.querySelector('#clip-2');
    expect(f.document.querySelectorAll('video')).toHaveLength(2);
    expect(old.querySelector('source').src).toContain('/sample.webm?asset=2');
    f.click('#collapse-2');
    expect(old.isConnected).toBe(false);
    expect(old.pause).toHaveBeenCalled();
    expect(f.document.querySelector('#clip-1')).not.toBeNull();
    f.click('#expand-2');
    expect(f.document.querySelector('#clip-2')).not.toBe(old);
    expect(f.document.querySelector('a[download]').getAttribute('href')).toBe(
      '/sample.webm?asset=1&rendition=base'
    );
    expect(f.document.querySelector('#reply').getAttribute('aria-label')).toBe('Reply');
  });

  it.each(['watch', 'portal'])(
    '%s replaces preview/next nodes but retains video and captions through quality changes',
    (layout) => {
      const f = fixture(`?layout=${layout}&mp4`);
      const preview = f.document.querySelector('video');
      f.click('#skip-preview');
      const content = f.document.querySelector('video');
      const track = content.querySelector('track');
      expect(preview.isConnected).toBe(false);
      expect(content).not.toBe(preview);
      expect(content.querySelector('source').src).toContain('/sample.mp4?asset=1');
      Object.defineProperty(content, 'paused', { configurable: true, value: false });
      f.click('#quality');
      expect(f.document.querySelector('video')).toBe(content);
      expect(content.querySelector('source').src).toContain('rendition=1');
      expect(content.querySelector('track')).toBe(track);
      expect(track.src).toBe('http://127.0.0.1:62938/mock-captions.vtt');
      expect(content.load).toHaveBeenCalledOnce();
      expect(content.play).toHaveBeenCalledOnce();
      f.click('#next');
      expect(content.isConnected).toBe(false);
      expect(f.document.querySelectorAll('video')).toHaveLength(1);
      expect(f.window.location.search).toContain(`layout=${layout}&clip=2&mp4`);
    }
  );

  it('keeps an exact file link over a thumbnail-expanded attachment and removes it on collapse', () => {
    const f = fixture('?attachment-link');
    f.click('#expand-1');
    const video = f.document.querySelector('#clip-1');
    const cover = f.document.querySelector('.attachment-cover');
    expect(cover.hasAttribute('download')).toBe(true);
    expect(cover.href).toBe(video.querySelector('source').src);
    cover.click();
    expect(f.window.__attachmentScrubState().taps).toBe(1);
    f.click('#collapse-1');
    expect(video.isConnected).toBe(false);
    expect(cover.isConnected).toBe(false);
    f.click('#expand-1');
    expect(f.document.querySelector('#clip-1')).not.toBe(video);
  });

  it('refreshes paused attachment telemetry after deferred controller insertion and removal', async () => {
    const f = fixture('?attachment-link');
    f.click('#expand-1');
    const video = f.document.querySelector('#clip-1');
    await Promise.resolve();
    const host = f.document.createElement('vsc-controller');
    video.vsc = {};
    video.after(host);
    await Promise.resolve();
    const status = f.document.querySelector('#attachment-status');
    expect(status.textContent).toContain('"controlled":true');
    expect(status.textContent).toContain('"controllers":1');
    delete video.vsc;
    host.remove();
    await Promise.resolve();
    expect(status.textContent).toContain('"controlled":false');
    expect(status.textContent).toContain('"controllers":0');
  });

  it('creates only an explicitly numbered loopback embed and can remove/reopen it', () => {
    const f = fixture('?layout=embed&framePort=62939');
    f.click('#open-embed');
    expect(f.document.querySelector('iframe').src).toBe(
      'http://127.0.0.1:62939/media-patterns.html?layout=watch'
    );
    f.click('#open-embed');
    expect(f.document.querySelectorAll('iframe')).toHaveLength(1);
    f.click('#close-embed');
    expect(f.document.querySelector('iframe')).toBeNull();
    f.click('#open-embed');
    expect(f.document.querySelectorAll('iframe')).toHaveLength(1);
  });

  it.each(['https://example.invalid', '0', '65536'])(
    'refuses a non-loopback or invalid embed target %s',
    (port) => {
      const f = fixture(`?layout=embed&framePort=${encodeURIComponent(port)}`);
      f.click('#open-embed');
      expect(f.document.querySelector('iframe')).toBeNull();
    }
  );

  it('restricts fixture network access and leaves unknown layouts empty', () => {
    const f = fixture('?layout=unknown');
    const policy = f.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain('frame-src http://127.0.0.1:*');
    expect(policy).toContain("object-src 'none'");
    expect(f.document.querySelector('main').textContent).toBe('Unknown local layout');
    expect(f.document.querySelector('video, iframe')).toBeNull();
  });
});

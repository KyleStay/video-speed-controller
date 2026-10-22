import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-site-controls.js';

const marker = 'data-vsc-ios-site-controls';
const owners = [];
function fixture(className = 'html5-video-player') {
  const container = document.createElement('section');
  container.className = className;
  const video = document.createElement('video');
  video.src = 'https://example.test/original.mp4';
  video.controls = true;
  const caption = document.createElement('div');
  caption.className = 'ytp-caption-window-container plyr__captions jw-captions';
  caption.textContent = 'Visible caption';
  const button = document.createElement('button');
  button.textContent = 'Unrelated action';
  container.append(video, caption, button);
  document.body.append(container);
  const owner = new window.VSC.IOSSiteControls(video);
  owners.push(owner);
  return { container, video, caption, button, owner };
}

afterEach(() => {
  for (const owner of owners.splice(0)) {
    owner.cleanup();
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('scoped iOS site controls', () => {
  it.each([
    ['html5-video-player', 'ytp-chrome-bottom'],
    ['video-js', 'vjs-control-bar'],
    ['plyr', 'plyr__controls'],
    ['jwplayer', 'jw-controlbar'],
  ])(
    'hides only recognized %s chrome and restores it without changing media',
    (player, control) => {
      const { container, video, caption, button, owner } = fixture(player);
      const chrome = document.createElement('div');
      chrome.className = control;
      container.append(chrome);
      const outside = chrome.cloneNode();
      document.body.append(outside);
      const source = video.src;
      const parent = video.parentNode;
      const track = document.createElement('track');
      video.append(track);
      expect(owner.acquire()).toBe(true);
      expect(getComputedStyle(chrome).display).toBe('none');
      expect(getComputedStyle(outside).display).not.toBe('none');
      expect(getComputedStyle(caption).display).not.toBe('none');
      expect(getComputedStyle(button).display).not.toBe('none');
      expect(video.parentNode).toBe(parent);
      expect(video.src).toBe(source);
      expect(video.controls).toBe(true);
      expect(video.firstChild).toBe(track);
      owner.release();
      expect(getComputedStyle(chrome).display).not.toBe('none');
      expect(container.hasAttribute(marker)).toBe(false);
    }
  );

  it('limits X suppression to exact recognized controls, preserving captions and other buttons', () => {
    const { container, owner, button, caption } = fixture('');
    container.dataset.testid = 'videoPlayer';
    const play = document.createElement('button');
    play.dataset.testid = 'videoControlPlayButton';
    container.append(play);
    expect(owner.acquire()).toBe(true);
    expect(getComputedStyle(play).display).toBe('none');
    expect(getComputedStyle(button).display).not.toBe('none');
    expect(getComputedStyle(caption).display).not.toBe('none');
  });

  it('is idempotent and preserves an original marker value', () => {
    const { container, owner } = fixture();
    container.setAttribute(marker, 'site-value');
    expect(owner.acquire()).toBe(true);
    const style = owner.style;
    expect(owner.acquire()).toBe(true);
    expect(owner.style).toBe(style);
    owner.cleanup();
    owner.cleanup();
    expect(container.getAttribute(marker)).toBe('site-value');
    expect(style.isConnected).toBe(false);
  });

  it('does not steal a live helper marker or restore a disposed helper token', () => {
    const { container, video, owner } = fixture();
    const second = new window.VSC.IOSSiteControls(video);
    owners.push(second);
    expect(owner.acquire()).toBe(true);
    expect(second.acquire()).toBe(false);
    expect(container.getAttribute(marker)).toBe(owner.token);
    second.release();
    owner.release();
    expect(second.acquire()).toBe(true);
    second.cleanup();
    expect(container.hasAttribute(marker)).toBe(false);
  });

  it('does not overwrite a later site marker edit or reacquire it while held', () => {
    const { container, owner } = fixture();
    owner.acquire();
    const style = owner.style;
    container.setAttribute(marker, 'new-site-value');
    expect(owner.acquire()).toBe(false);
    expect(container.getAttribute(marker)).toBe('new-site-value');
    owner.release();
    expect(container.getAttribute(marker)).toBe('new-site-value');
    expect(style.isConnected).toBe(false);
  });

  it.each(['second-video', 'iframe'])('rejects an ambiguous nearest container with %s', (kind) => {
    const { container, owner } = fixture();
    const outer = document.createElement('div');
    outer.className = 'plyr';
    container.replaceWith(outer);
    outer.append(container);
    container.append(document.createElement(kind === 'iframe' ? 'iframe' : 'video'));
    expect(owner.acquire()).toBe(false);
    expect(container.hasAttribute(marker)).toBe(false);
    expect(outer.hasAttribute(marker)).toBe(false);
    expect(owner.style).toBeNull();
  });

  it.each(['video', 'iframe'])(
    'releases acquired chrome when a later %s makes the player ambiguous and reacquires after removal',
    (tag) => {
      const { container, owner, video, caption } = fixture('video-js');
      const firstChrome = document.createElement('div');
      firstChrome.className = 'vjs-control-bar';
      container.append(firstChrome);
      container.setAttribute(marker, 'site-original');
      expect(owner.acquire()).toBe(true);
      const firstStyle = owner.style;
      const other = document.createElement(tag);
      const secondChrome = document.createElement('div');
      secondChrome.className = 'vjs-control-bar';
      container.append(other, secondChrome);
      expect(owner.acquire()).toBe(false);
      expect(container.getAttribute(marker)).toBe('site-original');
      expect(firstStyle.isConnected).toBe(false);
      expect(owner.style).toBeNull();
      expect(getComputedStyle(firstChrome).display).not.toBe('none');
      expect(getComputedStyle(secondChrome).display).not.toBe('none');
      expect(getComputedStyle(caption).display).not.toBe('none');
      expect(video.parentNode).toBe(container);
      other.remove();
      secondChrome.remove();
      container.setAttribute(marker, 'site-after-ambiguity');
      expect(owner.acquire()).toBe(true);
      expect(owner.style).not.toBe(firstStyle);
      expect(getComputedStyle(firstChrome).display).toBe('none');
      owner.release();
      expect(container.getAttribute(marker)).toBe('site-after-ambiguity');
    }
  );

  it('does not reacquire chrome when ambiguity resolves by removing the original media', () => {
    const { container, owner, video } = fixture('video-js');
    expect(owner.acquire()).toBe(true);
    const replacement = document.createElement('video');
    const replacementChrome = document.createElement('div');
    replacementChrome.className = 'vjs-control-bar';
    container.append(replacement, replacementChrome);
    expect(owner.acquire()).toBe(false);
    video.remove();
    expect(owner.acquire()).toBe(false);
    expect(container.hasAttribute(marker)).toBe(false);
    expect(getComputedStyle(replacementChrome).display).not.toBe('none');
    expect(replacement.parentNode).toBe(container);
  });

  it('acquires a newly recognized same-placement container on a later recheck', () => {
    const { container, owner } = fixture('generic-player');
    const chrome = document.createElement('div');
    chrome.className = 'vjs-control-bar';
    container.append(chrome);
    expect(owner.acquire()).toBe(false);
    expect(getComputedStyle(chrome).display).not.toBe('none');
    container.classList.add('video-js');
    expect(owner.acquire()).toBe(true);
    expect(getComputedStyle(chrome).display).toBe('none');
    container.classList.remove('video-js');
    expect(owner.acquire()).toBe(false);
    expect(container.hasAttribute(marker)).toBe(false);
    expect(getComputedStyle(chrome).display).not.toBe('none');
  });

  it('does not hide chrome for unknown containers, detached videos, audio, or shadow trees', () => {
    const unknown = fixture('generic-player');
    expect(unknown.owner.acquire()).toBe(false);
    const detached = fixture();
    detached.video.remove();
    expect(detached.owner.acquire()).toBe(false);
    const audio = document.createElement('audio');
    unknown.container.append(audio);
    expect(new window.VSC.IOSSiteControls(audio).acquire()).toBe(false);
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowFixture = fixture();
    shadow.append(shadowFixture.container);
    expect(shadowFixture.owner.acquire()).toBe(false);
  });

  it('releases stale ownership when media moves, is removed, or is replaced', () => {
    const { container, video, owner } = fixture();
    const next = fixture('plyr');
    next.video.remove();
    owner.acquire();
    const oldStyle = owner.style;
    next.container.append(video);
    expect(owner.acquire()).toBe(true);
    expect(container.hasAttribute(marker)).toBe(false);
    expect(oldStyle.isConnected).toBe(false);
    expect(next.container.getAttribute(marker)).toBe(owner.token);
    const replacement = document.createElement('video');
    video.replaceWith(replacement);
    expect(owner.acquire()).toBe(false);
    expect(next.container.hasAttribute(marker)).toBe(false);
    expect(replacement.parentNode).toBe(next.container);
    expect(video.isConnected).toBe(false);
  });

  it('releases after adoption without touching the new document or source', () => {
    const { container, video, owner } = fixture();
    owner.acquire();
    const style = owner.style;
    const inert = document.implementation.createHTMLDocument();
    inert.body.append(video);
    expect(owner.acquire()).toBe(false);
    expect(container.hasAttribute(marker)).toBe(false);
    expect(style.isConnected).toBe(false);
    expect(video.ownerDocument).toBe(inert);
  });

  it('moves its stylesheet when the whole player is adopted and updates a changed player profile', () => {
    const { container, owner } = fixture();
    owner.acquire();
    const firstStyle = owner.style;
    const nextDocument = document.implementation.createHTMLDocument();
    nextDocument.body.append(container);
    expect(owner.acquire()).toBe(true);
    expect(firstStyle.isConnected).toBe(false);
    expect(owner.style.ownerDocument).toBe(nextDocument);
    const secondStyle = owner.style;
    container.className = 'plyr';
    expect(owner.acquire()).toBe(true);
    expect(secondStyle.isConnected).toBe(false);
    expect(owner.style.textContent).toContain('.plyr__controls');
    expect(owner.style.textContent).not.toContain('.ytp-chrome-bottom');
    owner.release();
    expect(container.hasAttribute(marker)).toBe(false);
  });

  it('rolls back an interrupted acquire and independently removes styles after attribute failure', () => {
    const { container, owner } = fixture();
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation(() => {
      throw new Error('site append failure');
    });
    expect(() => owner.acquire()).not.toThrow();
    expect(owner.container).toBeNull();
    expect(container.hasAttribute(marker)).toBe(false);
    append.mockRestore();
    owner.acquire();
    const style = owner.style;
    vi.spyOn(container, 'getAttribute').mockImplementation(() => {
      throw new Error('site attribute failure');
    });
    expect(() => owner.cleanup()).not.toThrow();
    expect(style.isConnected).toBe(false);
  });

  it('guards discovery and removes owned styles when remove() has been replaced', () => {
    const { container, owner } = fixture();
    const matches = vi.spyOn(container, 'matches').mockImplementation(() => {
      throw new Error('site match failure');
    });
    expect(owner.acquire()).toBe(false);
    matches.mockRestore();
    owner.acquire();
    const style = owner.style;
    style.remove = () => {
      throw new Error('site remove failure');
    };
    owner.cleanup();
    expect(style.isConnected).toBe(false);
    expect(container.hasAttribute(marker)).toBe(false);
  });

  it('does not use layout reads or observers to acquire, recheck, and release', () => {
    const { container, video, owner } = fixture();
    const bounds = vi.spyOn(container, 'getBoundingClientRect');
    const videoBounds = vi.spyOn(video, 'getBoundingClientRect');
    const computed = vi.spyOn(window, 'getComputedStyle');
    const observer = vi.spyOn(window, 'MutationObserver');
    owner.acquire();
    owner.acquire();
    owner.release();
    expect(bounds).not.toHaveBeenCalled();
    expect(videoBounds).not.toHaveBeenCalled();
    expect(computed).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
  });
});

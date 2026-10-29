import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-site-controls.js';

const marker = 'data-vsc-ios-site-controls';
const hidden = 'data-vsc-site-hidden-control';
const owners = [];
const rect = { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 260, width: 400, height: 240 };
const bounds = (node, value = rect) => {
  node.getBoundingClientRect = () => value;
};
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function fixture(className = 'video-js') {
  const container = document.createElement('div');
  container.className = className;
  container.innerHTML =
    '<video src="https://example.test/clip.mp4" controls></video><button>Site Play</button>';
  document.body.append(container);
  const video = container.firstChild;
  bounds(container);
  bounds(video);
  const owner = new window.VSC.IOSSiteControls(video);
  owner.setHideAllButtons(true);
  owners.push(owner);
  return { container, video, button: container.lastChild, owner };
}

afterEach(() => {
  for (const owner of owners.splice(0)) {
    owner.cleanup();
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('opt-in site button suppression', () => {
  it.each([true, false])(
    'hides late controls while paused=%s without media writes',
    async (paused) => {
      const { container, video, button, owner } = fixture();
      Object.defineProperty(video, 'paused', { configurable: true, value: paused });
      const play = vi.spyOn(video, 'play');
      const load = vi.spyOn(video, 'load');
      const source = video.src;
      expect(owner.acquire()).toBe(true);
      expect(getComputedStyle(button).display).toBe('none');
      const late = document.createElement('div');
      late.innerHTML =
        '<span role="button">Pause</span><input type="range"><a href="#" aria-label="Full screen">Expand</a><a href="/author">Author</a>';
      container.append(late);
      await settle();
      for (const control of [...late.children].slice(0, 3)) {
        expect(getComputedStyle(control).display).toBe('none');
      }
      expect(getComputedStyle(late.lastChild).display).not.toBe('none');
      expect(video.src).toBe(source);
      expect(video.controls).toBe(true);
      expect(video.parentNode).toBe(container);
      expect(play).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    }
  );

  it('retains caption trees, renderers, StayFast controls, and their parents', () => {
    const { container, owner } = fixture();
    container.insertAdjacentHTML(
      'beforeend',
      '<div class="vjs-control-bar"><div class="vjs-text-track-display"><button>Caption</button></div><button>Site settings</button></div><button><canvas></canvas></button><vsc-controller><button>StayFast</button></vsc-controller><vsc-ios-player><button>Owned</button></vsc-ios-player>'
    );
    expect(owner.acquire()).toBe(true);
    const group = container.querySelector('.vjs-control-bar');
    const captions = group.firstChild;
    for (const node of [
      group,
      captions,
      captions.firstChild,
      container.querySelector('canvas').parentNode,
      ...container.querySelectorAll('vsc-controller,vsc-ios-player'),
    ]) {
      expect(node.hasAttribute(hidden)).toBe(false);
      expect(getComputedStyle(node).display).not.toBe('none');
    }
    expect(getComputedStyle(group.lastChild).display).toBe('none');
    expect(container.querySelector('vsc-controller button').hasAttribute(hidden)).toBe(false);
    expect(container.querySelector('vsc-ios-player button').hasAttribute(hidden)).toBe(false);
  });

  it('unhides a suppressed chrome branch when captions arrive inside it', async () => {
    const { container, owner } = fixture();
    const group = document.createElement('div');
    group.className = 'vjs-control-bar';
    group.innerHTML = '<button>Settings</button>';
    container.append(group);
    expect(owner.acquire()).toBe(true);
    expect(getComputedStyle(group).display).toBe('none');
    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = 'Current caption';
    group.append(caption);
    await settle();
    expect(getComputedStyle(group).display).not.toBe('none');
    expect(getComputedStyle(caption).display).not.toBe('none');
    expect(getComputedStyle(group.firstChild).display).toBe('none');
  });

  it('policy changes release without acquisition and restore only owned markers', async () => {
    const { container, button, owner } = fixture();
    container.setAttribute(marker, 'site');
    button.setAttribute(hidden, 'site-button');
    expect(owner.acquire()).toBe(true);
    const style = owner.style;
    owner.setHideAllButtons(false);
    expect(container.getAttribute(marker)).toBe('site');
    expect(button.getAttribute(hidden)).toBe('site-button');
    expect(style.isConnected).toBe(false);
    expect(owner.container).toBeNull();
    const late = document.createElement('button');
    container.append(late);
    await settle();
    expect(late.hasAttribute(hidden)).toBe(false);
    expect(owner.acquire()).toBe(true);
    expect(getComputedStyle(button).display).not.toBe('none');
    owner.setHideAllButtons(true);
    expect(owner.container).toBeNull();
    expect(owner.acquire()).toBe(true);
    button.setAttribute(hidden, 'later-site-write');
    owner.cleanup();
    expect(button.getAttribute(hidden)).toBe('later-site-write');
  });

  it('accepts only the bounded picture scope and retains adjacent page controls', () => {
    const { container, owner, button } = fixture('unknown-player');
    const outer = document.createElement('section');
    bounds(outer, { ...rect, bottom: 460, height: 440 });
    container.replaceWith(outer);
    outer.append(container);
    const outside = document.createElement('button');
    outside.textContent = 'Page action';
    outer.append(outside);
    expect(owner.acquire()).toBe(true);
    expect(owner.container).toBe(container);
    expect(getComputedStyle(button).display).toBe('none');
    expect(getComputedStyle(outside).display).not.toBe('none');
    owner.release();
    bounds(container, { ...rect, right: 600, width: 590 });
    expect(owner.acquire()).toBe(false);
  });

  it.each(['video', 'audio', 'iframe'])(
    'yields when a late %s makes the scope ambiguous',
    async (tag) => {
      const { container, button, owner } = fixture('unknown-player');
      expect(owner.acquire()).toBe(true);
      const style = owner.style;
      container.append(document.createElement(tag));
      await settle();
      expect(owner.container).toBeNull();
      expect(style.isConnected).toBe(false);
      expect(getComputedStyle(button).display).not.toBe('none');
      expect(container.hasAttribute(marker)).toBe(false);
    }
  );

  it('yields on scope removal or video reparenting and stops observing', async () => {
    const { container, button, video, owner } = fixture();
    expect(owner.acquire()).toBe(true);
    container.remove();
    await settle();
    expect(owner.container).toBeNull();
    expect(button.hasAttribute(hidden)).toBe(false);
    document.body.append(container);
    expect(owner.acquire()).toBe(true);
    document.body.append(video);
    await settle();
    expect(owner.container).toBeNull();
    expect(button.hasAttribute(hidden)).toBe(false);
    const late = document.createElement('button');
    container.append(late);
    await settle();
    expect(late.hasAttribute(hidden)).toBe(false);
  });

  it('places its scoped stylesheet in the actual open shadow root', () => {
    const { container, button, owner } = fixture();
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(container);
    expect(owner.acquire()).toBe(true);
    expect(owner.style.getRootNode()).toBe(shadow);
    expect(button.getAttribute(hidden)).toBe(owner.token);
    owner.release();
    expect(shadow.querySelector('style')).toBeNull();
    expect(button.hasAttribute(hidden)).toBe(false);
  });

  function companionFixture() {
    const result = fixture('unknown-player');
    const original = result.video;
    const host = document.createElement('div');
    host.setAttribute('data-vsc-twitter-mp4', '');
    const video = document.createElement('video');
    video.src = 'https://example.test/clip.mp4';
    host.append(video);
    result.container.append(host);
    const session = {
      original,
      video,
      host,
      parent: result.container,
      candidate: { scope: result.container },
      committed: true,
      closed: false,
      current: vi.fn(() => true),
    };
    vi.spyOn(window.VSC.TwitterMP4Playback, 'get').mockImplementation((target) =>
      target === video ? session : undefined
    );
    const owner = new window.VSC.IOSSiteControls(video);
    owner.setHideAllButtons(true);
    owners.push(owner);
    return { ...result, owner, original, video, host, session };
  }

  it('admits only the verified current original/companion pair and protects its host', async () => {
    const { container, owner, button, host, original, session } = companionFixture();
    host.append(document.createElement('button'));
    expect(owner.acquire()).toBe(true);
    expect(owner.container).toBe(container);
    expect(getComputedStyle(button).display).toBe('none');
    expect(host.hasAttribute(hidden)).toBe(false);
    expect(host.lastChild.hasAttribute(hidden)).toBe(false);
    expect(original.hasAttribute(hidden)).toBe(false);
    session.current.mockReturnValue(false);
    container.append(document.createElement('span'));
    await settle();
    expect(owner.container).toBeNull();
    expect(button.hasAttribute(hidden)).toBe(false);
  });

  it('rejects an unverified pair, a third video, and a relocated companion', () => {
    const { container, owner, video, session } = companionFixture();
    session.closed = true;
    expect(owner.acquire()).toBe(false);
    session.closed = false;
    const extra = document.createElement('video');
    container.append(extra);
    expect(owner.acquire()).toBe(false);
    extra.remove();
    document.body.append(video);
    expect(owner.acquire()).toBe(false);
  });

  it('uses a validated retained origin for owned video-only presentation', () => {
    const { container, owner, video, button } = fixture();
    const ui = document.createElement('vsc-ios-player');
    document.body.append(ui);
    const ownedButton = document.createElement('button');
    ui.append(ownedButton);
    const anchor = document.createComment('origin');
    const placeholder = document.createElement('span');
    container.insertBefore(anchor, video);
    container.insertBefore(placeholder, video);
    ui.append(video);
    video.vsc = {
      iosPlayer: {
        active: true,
        video,
        doc: document,
        originParent: container,
        anchor,
        placeholder,
        portalNode: video,
        ui: { host: ui },
      },
    };
    expect(owner.acquire()).toBe(true);
    expect(owner.container).toBe(container);
    expect(getComputedStyle(button).display).toBe('none');
    expect(ownedButton.hasAttribute(hidden)).toBe(false);
    expect(ui.hasAttribute(marker)).toBe(false);
    owner.release();
    anchor.remove();
    expect(owner.acquire()).toBe(false);
  });

  it('retains the exact companion exception in its validated owned view', () => {
    const { container, owner, video, host, button } = companionFixture();
    const ui = document.createElement('vsc-ios-player');
    document.body.append(ui);
    const anchor = document.createComment('origin');
    host.insertBefore(anchor, video);
    ui.append(video);
    video.vsc = {
      iosPlayer: {
        active: true,
        video,
        doc: document,
        originParent: host,
        anchor,
        portalNode: video,
        ui: { host: ui },
      },
    };
    expect(owner.acquire()).toBe(true);
    expect(owner.container).toBe(container);
    expect(getComputedStyle(button).display).toBe('none');
    owner.release();
    anchor.remove();
    expect(owner.acquire()).toBe(false);
  });

  it('follows a retained whole-player portal without suppressing the owned dialog', async () => {
    const { container, owner, video } = fixture();
    expect(owner.acquire()).toBe(true);
    const anchor = document.createComment('origin');
    document.body.insertBefore(anchor, container);
    const ui = document.createElement('vsc-ios-player');
    document.documentElement.append(ui);
    ui.append(container);
    video.vsc = {
      iosPlayer: {
        active: true,
        video,
        doc: document,
        originParent: document.body,
        anchor,
        portalNode: container,
        ui: { host: ui },
      },
    };
    await settle();
    expect(owner.container).toBe(container);
    expect(ui.hasAttribute(marker)).toBe(false);
    container.remove();
    await settle();
    expect(owner.container).toBeNull();
    ui.remove();
  });

  it('cleans styles and markers when optional interaction cleanup throws', () => {
    const { video, button, owner } = fixture();
    video.vsc = {
      controlsManager: {
        inlinePlayer: {
          observeSurface: () => () => {
            throw new Error('patched remove');
          },
        },
      },
    };
    expect(owner.acquire()).toBe(true);
    const style = owner.style;
    expect(() => owner.cleanup()).not.toThrow();
    expect(style.isConnected).toBe(false);
    expect(button.hasAttribute(hidden)).toBe(false);
  });

  it('retains the inline ancestor touch policy without changing desktop touch handling', () => {
    const { video, owner } = fixture();
    expect(owner.acquire()).toBe(true);
    expect(owner.style.textContent).not.toContain('touch-action');
    owner.release();
    video.vsc = { controlsManager: { inlinePlayer: {} } };
    expect(owner.acquire()).toBe(true);
    expect(owner.style.textContent).toContain('touch-action: pan-y pinch-zoom !important');
  });

  it('restores owned styles and markers when observer disconnect is replaced', () => {
    const { button, owner } = fixture();
    expect(owner.acquire()).toBe(true);
    const style = owner.style;
    const observer = owner.strongObserver;
    const disconnect = observer.disconnect.bind(observer);
    observer.disconnect = () => {
      throw new Error('patched disconnect');
    };
    expect(() => owner.cleanup()).not.toThrow();
    expect(style.isConnected).toBe(false);
    expect(button.hasAttribute(hidden)).toBe(false);
    disconnect();
  });

  it('bounds structural work and keeps normal mode observer-free', () => {
    const { container, owner } = fixture();
    container.append(...Array.from({ length: 513 }, () => document.createElement('span')));
    expect(owner.acquire()).toBe(false);
    owner.setHideAllButtons(false);
    const observer = vi.spyOn(window, 'MutationObserver');
    expect(owner.acquire()).toBe(true);
    owner.release();
    expect(observer).not.toHaveBeenCalled();
  });
});

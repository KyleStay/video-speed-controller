import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let manager;
beforeEach(() => {
  manager = window.VSC.siteHandlerManager;
});

function player(controls = '') {
  const root = document.createElement('section');
  root.innerHTML = `<div><video loop muted></video></div>${controls}`;
  document.body.append(root);
  const video = root.querySelector('video');
  video.muted = true;
  return { root, video };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('muted looping media with custom transport', () => {
  it.each([
    '<button aria-label="Sound Off"></button>',
    '<button title="Unmute"></button>',
    '<button>Pause</button>',
    '<div role="button" aria-label="Full screen"></div>',
    '<input type="range" aria-label="Seek video">',
    '<div role="slider" aria-label="Timeline"></div>',
  ])('retains the video when its single-media scope has transport: %s', (controls) => {
    const { video } = player(controls);
    expect(manager.shouldIgnoreVideo(video)).toBe(false);
  });

  it('does not mistake unrelated sliders or unbounded button text for transport', () => {
    const { root, video } = player('<input type="range" aria-label="Rate this animation">');
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
    root.insertAdjacentHTML('beforeend', '<button><span>Pause</span></button>');
    const button = root.querySelector('button');
    Object.defineProperty(button, 'textContent', {
      get() {
        throw new Error('Unbounded read');
      },
    });
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });

  it('recovers a previously ignored loop when semantic transport arrives later', () => {
    const { root, video } = player();
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
    const found = vi.fn();
    const config = { settings: {} };
    const mediaObserver = new window.VSC.MediaElementObserver(config, manager);
    expect(mediaObserver.scanForMediaLight(document)).toEqual([]);
    const observer = new window.VSC.VideoMutationObserver(config, found, vi.fn(), mediaObserver);
    expect(observer.attributeObservationEnabled).toBe(false);
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Unmute');
    root.append(button);
    observer.checkForVideoAndShadowRoot(button, root, true);
    expect(found).toHaveBeenCalledWith(video, video.parentNode);
    observer.stop();
  });

  it('does no custom-player recovery scans before media has been found', () => {
    const { root } = player('<button aria-label="Pause"></button>');
    const observer = new window.VSC.VideoMutationObserver({ settings: {} }, vi.fn(), vi.fn());
    const scan = vi.spyOn(manager, 'findCustomPlayer');
    observer.checkForVideoAndShadowRoot(root.querySelector('button'), root, true);
    expect(scan).not.toHaveBeenCalled();
    observer.stop();
  });

  it('continues to ignore a decorative silent loop without transport', () => {
    const { video } = player('<button aria-label="Like"></button><a href="#">Open profile</a>');
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });

  it.each(['video', 'audio', 'iframe'])(
    'does not borrow a playback control from an ambiguous scope with another %s',
    (tag) => {
      const { root, video } = player(`<button aria-label="Play"></button><${tag}></${tag}>`);
      expect(root.contains(video)).toBe(true);
      expect(manager.shouldIgnoreVideo(video)).toBe(true);
    }
  );

  it('does not borrow transport elsewhere in the document or beyond four ancestors', () => {
    const { root, video } = player();
    const control = document.createElement('button');
    control.setAttribute('aria-label', 'Pause');
    document.body.append(control);
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
    let ancestor = root;
    for (let index = 0; index < 4; index++) {
      const parent = document.createElement('div');
      ancestor.replaceWith(parent);
      parent.append(ancestor);
      ancestor = parent;
    }
    ancestor.append(control);
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });

  it('bounds the total nearby DOM work even for a single large player', () => {
    const { root, video } = player();
    for (let index = 0; index < 140; index++) {
      root.append(document.createElement('span'));
    }
    root.insertAdjacentHTML('beforeend', '<button aria-label="Play"></button>');
    const matches = vi.spyOn(Element.prototype, 'matches');
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
    expect(matches.mock.calls.length).toBeLessThanOrEqual(256);
  });

  it('contains a failing page DOM API', () => {
    const { video } = player('<button aria-label="Pause"></button>');
    vi.spyOn(document, 'createTreeWalker').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });

  it('retains native controls and the site-specific veto', () => {
    const { video } = player('<button aria-label="Pause"></button>');
    video.controls = true;
    expect(manager.shouldIgnoreVideo(video)).toBe(false);
    vi.spyOn(manager.getCurrentHandler(), 'shouldIgnoreVideo').mockReturnValue(true);
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('GIF-style looping videos', () => {
  it.each(['clip.webm', 'clip.mp4', 'https://media.example/animation'])(
    'discovers a silent loop without native or custom transport: %s',
    (src) => {
      const root = document.createElement('section');
      root.innerHTML = `<video src="${src}" loop muted autoplay playsinline></video>`;
      document.body.append(root);
      const video = root.querySelector('video');
      video.muted = true;
      const manager = window.VSC.siteHandlerManager;
      const observer = new window.VSC.MediaElementObserver({ settings: {} }, manager);
      expect(manager.shouldIgnoreVideo(video)).toBe(false);
      expect(observer.hasMediaIndicators(document)).toBe(true);
      expect(observer.scanForMediaLight(document)).toContain(video);
      expect(observer.scanAll(document)).toContain(video);
      expect(observer.isValidMediaElement(video)).toBe(true);
    }
  );

  it('discovers newly inserted loops without waiting for site controls', () => {
    const found = vi.fn();
    const observer = new window.VSC.VideoMutationObserver({ settings: {} }, found, vi.fn());
    const video = document.createElement('video');
    video.loop = video.muted = true;
    document.body.append(video);
    observer.checkForVideoAndShadowRoot(video, document.body, true);
    expect(found).toHaveBeenCalledWith(video, document.body);
    observer.stop();
  });

  it('retains the site-specific veto for looping videos', () => {
    const video = document.createElement('video');
    video.loop = video.muted = true;
    const manager = window.VSC.siteHandlerManager;
    vi.spyOn(manager.getCurrentHandler(), 'shouldIgnoreVideo').mockReturnValue(true);
    expect(manager.shouldIgnoreVideo(video)).toBe(true);
  });
});

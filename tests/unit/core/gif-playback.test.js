import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gifFixture } from '../../helpers/gif-fixture.js';

let image, playback, animation, revokeDescriptor;
beforeEach(() => {
  image = document.createElement('img');
  image.src = '/animation.gif';
  document.body.append(image);
  animation = {
    currentTime: 0,
    playbackRate: 1,
    playState: 'running',
    play: vi.fn(function () {
      this.playState = 'running';
    }),
    pause: vi.fn(function () {
      this.playState = 'paused';
    }),
    cancel: vi.fn(function () {
      this.playState = 'idle';
    }),
  };
  image.animate = vi.fn((keyframes) => {
    animation.effect = { getKeyframes: () => keyframes };
    return animation;
  });
  revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  playback?.cleanup();
  playback = null;
  image.remove();
  if (revokeDescriptor) {
    Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
  } else {
    delete URL.revokeObjectURL;
  }
  vi.restoreAllMocks();
});

function attach(loop = 0) {
  const gif = window.VSC.GifDecoder.parse(gifFixture({ loop }));
  const frames = gif.frames.map(({ start, end }, index) => ({
    start,
    end,
    url: `blob:frame-${index}`,
  }));
  playback = new window.VSC.GifPlayback(image, gif, frames);
  return playback;
}

describe('original-image GIF playback', () => {
  it('uses original frame timing and preserves the image, attributes, layout styles and site animations', () => {
    image.style.width = '320px';
    const attributes = image.outerHTML;
    attach();
    const [frames, options] = image.animate.mock.calls[0];
    expect(frames.map((frame) => frame.offset)).toEqual([0, 0.4, 1]);
    expect(options).toMatchObject({ duration: 500, iterations: Infinity });
    expect(image.outerHTML).toBe(attributes);
    expect(image.style.content).toBe('');
  });
  it('changes the actual animation rate and time without installing a frame timer', () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    attach();
    image.playbackRate = 2.5;
    expect(animation.playbackRate).toBe(2.5);
    expect(image.playbackRate).toBe(2.5);
    image.currentTime = 0.2;
    expect(animation.currentTime).toBe(200);
    expect(image.currentTime).toBe(0.2);
    expect(timeout).not.toHaveBeenCalled();
  });
  it('pauses, seeks with bounds and steps the actual variable-duration GIF frames', () => {
    attach();
    const handler = new window.VSC.ActionHandler({}, null);
    handler.stepFrame(image, 1, 30);
    expect(image.currentTime).toBe(0);
    image.pause();
    expect(window.VSC.ControlsManager.canStepFrame(image)).toBe(true);
    handler.stepFrame(image, 1, 30);
    expect(image.currentTime).toBe(0.2);
    handler.stepFrame(image, -1, 30);
    expect(image.currentTime).toBe(0);
    handler.seek(image, 100);
    expect(image.currentTime).toBe(0.5);
    handler.seek(image, -100);
    expect(image.currentTime).toBe(0);
  });
  it('suspends offscreen playback while preserving an intentional pause', async () => {
    attach();
    await image.play();
    playback.suspend(true);
    expect(animation.playState).toBe('paused');
    playback.suspend(false);
    expect(animation.playState).toBe('running');
    image.pause();
    playback.suspend(true);
    playback.suspend(false);
    expect(animation.playState).toBe('paused');
    expect(image.paused).toBe(true);
  });
  it.each([null, 2])(
    'preserves finite loop completion through hide/show and explicit replay: %s',
    async (loop) => {
      attach(loop);
      expect(image.animate.mock.calls[0][1].iterations).toBe(loop === null ? 1 : 3);
      animation.playState = 'finished';
      animation.onfinish();
      playback.suspend(true);
      playback.suspend(false);
      expect(image.ended).toBe(true);
      expect(image.currentTime).toBe(0.5);
      await image.play();
      expect(image.ended).toBe(false);
      expect(image.currentTime).toBe(0);
    }
  );
  it('cancels its animation, releases all frame URLs and removes only owned properties', () => {
    attach();
    const siteGetter = () => 7;
    Object.defineProperty(image, 'playbackRate', { configurable: true, get: siteGetter });
    playback.cleanup();
    playback.cleanup();
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect('pause' in image).toBe(false);
    expect(image.playbackRate).toBe(7);
    expect(window.VSC.GifPlayback.get(image)).toBeUndefined();
  });
  it('keeps a completed finite animation paused when stepping back into its frames', () => {
    attach(null);
    animation.playState = 'finished';
    animation.onfinish();
    playback.stepFrame(-1);
    expect(image.paused).toBe(true);
    expect(image.ended).toBe(false);
    expect(image.currentTime).toBe(0);
    expect(animation.playState).toBe('paused');
  });
  it('rolls back if a page already owns a media-shaped image property', () => {
    Object.defineProperty(image, 'duration', { configurable: true, value: 7 });
    expect(() => attach()).toThrow('already has duration');
    expect(image.duration).toBe(7);
    expect('playbackRate' in image).toBe(false);
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  });
  it('releases URLs and properties even when a page patch makes animation cancellation throw', () => {
    attach();
    animation.cancel.mockImplementation(() => {
      throw new Error('Patched');
    });
    expect(() => playback.cleanup()).not.toThrow();
    expect('playbackRate' in image).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('retains native rendering when the engine drops the animated content property', () => {
    image.animate.mockImplementation(() => {
      animation.effect = { getKeyframes: () => [{ offset: 0 }, { offset: 1 }] };
      return animation;
    });
    expect(() => attach()).toThrow('Animated image content is unavailable');
    expect('playbackRate' in image).toBe(false);
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  });
});

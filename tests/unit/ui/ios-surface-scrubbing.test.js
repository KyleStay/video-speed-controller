import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-scrubber.js';
import '../../../src/ui/ios-player-gestures.js';

describe('video-surface precision scrubbing', () => {
  let owner, scrubber, gestures, host, stage, video, range, paused;
  const event = (type, x, y, id = 7, target = video) => {
    const input = new Event(type, { bubbles: true, composed: true, cancelable: true });
    Object.assign(input, {
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      button: type === 'pointermove' ? -1 : 0,
    });
    target.dispatchEvent(input);
    return input;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    host = document.createElement('div');
    stage = document.createElement('div');
    video = document.createElement('video');
    range = document.createElement('input');
    range.type = 'range';
    range.step = '0.001';
    const hint = document.createElement('p');
    stage.append(video);
    host.append(stage, range, hint);
    document.body.append(host);
    stage.getBoundingClientRect = () => ({ left: 10, top: 180, width: 400, height: 300 });
    range.getBoundingClientRect = () => ({ left: 10, top: 500, width: 300, height: 44 });
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    video.currentTime = 50;
    video.src = 'https://example.test/video.mp4';
    paused = false;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    video.pause = vi.fn(() => {
      paused = true;
    });
    owner = {
      active: true,
      session: 1,
      view: window,
      video,
      ui: { host, stage, refs: { seek: range, scrubHint: hint } },
      seekBounds: () => [0, 100],
      seekTo: vi.fn((time) => {
        video.currentTime = time;
      }),
      seekBy: vi.fn(),
      showControls: vi.fn(),
      update: vi.fn(),
      play: vi.fn(() => {
        paused = false;
      }),
      fit: 'contain',
      setFit: vi.fn(),
    };
    scrubber = owner.scrubber = new window.VSC.IOSPlayerScrubber(owner);
    scrubber.attach();
    gestures = owner.gestures = new window.VSC.IOSPlayerGestures(owner);
    gestures.attach();
  });
  afterEach(() => {
    scrubber.cleanup();
    gestures.cleanup();
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not let a trailing site touchend toggle playback after a committed picture scrub', () => {
    paused = true;
    const siteTap = vi.fn(() => {
      paused = false;
    });
    host.addEventListener('touchend', siteTap);
    event('pointerdown', 110, 320);
    event('pointermove', 140, 320);
    event('pointerup', 180, 320);
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(end, { touches: [], changedTouches: [{ clientX: 180, clientY: 320 }] });
    video.dispatchEvent(end);
    expect(end.defaultPrevented).toBe(true);
    expect(siteTap).not.toHaveBeenCalled();
    expect(paused).toBe(true);
    expect(gestures.surfaceTouchCommitted).toBe(false);
    video.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(siteTap).toHaveBeenCalledOnce();
  });

  it('leaves vertical intent touchend available to the site and releases the guard on cleanup', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 112, 360);
    event('pointerup', 112, 360);
    const vertical = new Event('touchend', { bubbles: true, cancelable: true });
    video.dispatchEvent(vertical);
    expect(vertical.defaultPrevented).toBe(false);
    event('pointerdown', 110, 320);
    event('pointermove', 145, 320);
    expect(gestures.surfaceTouchCommitted).toBe(true);
    gestures.cleanup();
    const cancelled = new Event('touchend', { bubbles: true, cancelable: true });
    video.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(false);
  });

  it('retains trailing-touch protection until both fingers lift after scrub cancellation', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 145, 320);
    event('pointerdown', 200, 320, 8);
    const partial = new Event('touchcancel', { bubbles: true, cancelable: true });
    Object.assign(partial, { touches: [{ identifier: 8 }] });
    video.dispatchEvent(partial);
    expect(partial.defaultPrevented).toBe(true);
    expect(gestures.surfaceTouchCommitted).toBe(true);
    const last = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(last, { touches: [] });
    video.dispatchEvent(last);
    expect(last.defaultPrevented).toBe(true);
    expect(gestures.surfaceTouchCommitted).toBe(false);
  });

  it('does not carry a trailing guard into a new pointer sequence after an outside finger ends', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 145, 320);
    event('pointerup', 145, 320);
    const partial = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(partial, { touches: [{ identifier: 8 }] });
    video.dispatchEvent(partial);
    expect(partial.defaultPrevented).toBe(true);
    event('pointerdown', 110, 320, 9);
    event('pointerup', 110, 320, 9);
    const next = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(next, { touches: [] });
    video.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });

  it('observes the final outside finger lift without consuming an independent control tap', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 145, 320);
    event('pointerup', 145, 320);
    const partial = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(partial, { touches: [{ identifier: 8 }] });
    video.dispatchEvent(partial);
    const outside = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(outside, { touches: [] });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(gestures.surfaceTouchCommitted).toBe(false);
    const link = document.createElement('a');
    link.href = '#profile';
    stage.append(link);
    const clicked = vi.fn();
    host.addEventListener('touchend', clicked);
    const next = new Event('touchend', { bubbles: true, cancelable: true });
    Object.assign(next, { touches: [] });
    link.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('waits for horizontal intent, then seeks relative to the starting time and consumes release', () => {
    expect(event('pointerdown', 110, 320).defaultPrevented).toBe(false);
    event('pointermove', 117, 321);
    expect(video.pause).not.toHaveBeenCalled();
    expect(event('pointermove', 150, 320).defaultPrevented).toBe(true);
    expect(scrubber.active).toBe(true);
    expect(Number(range.value)).toBe(60);
    expect(video.currentTime).toBe(50);
    expect(stage.setPointerCapture).toHaveBeenCalledWith(7);
    event('pointerup', 170, 320, 7, window);
    expect(video.currentTime).toBe(65);
    expect(owner.play).toHaveBeenCalledOnce();
    expect(gestures.points.size).toBe(0);
    expect(gestures.suppressClick).toBe(true);
    expect(scrubber.gestureListeners).toHaveLength(0);
  });

  it('leaves vertical intent and subsequent sideways movement to page scrolling', () => {
    event('pointerdown', 110, 320);
    expect(event('pointermove', 112, 345).defaultPrevented).toBe(false);
    expect(event('pointermove', 210, 345).defaultPrevented).toBe(false);
    event('pointerup', 210, 345);
    expect(video.pause).not.toHaveBeenCalled();
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.seekBy).not.toHaveBeenCalled();
    expect(gestures.suppressClick).toBe(true);
  });

  it.each([-1, 1])(
    'uses vertical distance from any starting point, direction %s, without jumps',
    (direction) => {
      event('pointerdown', 110, 320);
      event('pointermove', 150, 320);
      let x = 150,
        expected = 60;
      for (const [distance, gain, label] of [
        [44, 0.5, '×1/2'],
        [88, 0.25, '×1/4'],
        [132, 0.1, '×1/10'],
      ]) {
        event('pointermove', x, 320 + direction * distance);
        expect(Number(range.value)).toBeCloseTo(expected);
        expect(owner.ui.refs.scrubHint.textContent).toBe(label);
        x += 40;
        expected += 10 * gain;
        event('pointermove', x, 320 + direction * distance);
        expect(Number(range.value)).toBeCloseTo(expected);
      }
      event('pointermove', x, 320);
      expect(Number(range.value)).toBeCloseTo(expected);
      expect(owner.ui.refs.scrubHint.textContent).toBe('');
      event('pointerup', x, 320, 7, window);
      expect(video.currentTime).toBeCloseTo(expected);
    }
  );

  it.each([210, 430])('has the same precision when starting at y=%s', (y) => {
    event('pointerdown', 110, y);
    event('pointermove', 150, y);
    event('pointermove', 150, y - 88);
    event('pointerup', 190, y - 88, 7, window);
    expect(video.currentTime).toBeCloseTo(62.5);
  });

  it('averages diagonal movement consistently across grouped and subdivided events', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 410, 188);
    event('pointerup', 410, 188, 7, window);
    const grouped = video.currentTime;
    video.currentTime = 50;
    event('pointerdown', 110, 320);
    for (const [x, y] of [
      [210, 276],
      [310, 232],
      [410, 188],
    ]) {
      event('pointermove', x, y);
    }
    event('pointerup', 410, 188, 7, window);
    expect(video.currentTime).toBeCloseTo(grouped, 8);
  });

  it('can begin with a hidden or narrow timeline and preserves an originally paused video', () => {
    paused = true;
    range.hidden = true;
    range.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    event('pointerup', 150, 320, 7, window);
    expect(video.currentTime).toBe(60);
    expect(owner.play).not.toHaveBeenCalled();
  });

  it('cancels back to the original time and clears a queued decoder write', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    vi.advanceTimersByTime(50);
    expect(video.currentTime).toBe(60);
    event('pointermove', 190, 320);
    event('pointercancel', 190, 320, 7, window);
    vi.advanceTimersByTime(100);
    expect(video.currentTime).toBe(50);
    expect(owner.play).toHaveBeenCalledOnce();
    expect(gestures.points.size).toBe(0);
  });

  it.each(['source', 'session'])('rejects a %s change before horizontal intent', (kind) => {
    event('pointerdown', 110, 320);
    if (kind === 'source') {
      video.src = 'https://example.test/other.mp4';
    } else {
      owner.session++;
    }
    event('pointermove', 150, 320);
    expect(video.pause).not.toHaveBeenCalled();
    expect(owner.seekTo).not.toHaveBeenCalled();
  });

  it('rejects reentrant session replacement while checking the pending source', () => {
    event('pointerdown', 110, 320);
    const matches = scrubber.matchesSource.bind(scrubber);
    vi.spyOn(scrubber, 'matchesSource').mockImplementation((source) => {
      owner.session++;
      return matches(source);
    });
    event('pointermove', 150, 320);
    expect(video.pause).not.toHaveBeenCalled();
    expect(owner.seekTo).not.toHaveBeenCalled();
  });

  it('never writes or resumes a replacement source after commitment', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    video.src = 'https://example.test/other.mp4';
    video.currentTime = 8;
    event('pointerup', 190, 320, 7, window);
    vi.advanceTimersByTime(100);
    expect(video.currentTime).toBe(8);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.play).not.toHaveBeenCalled();
    expect(scrubber.active).toBe(false);
  });

  it('lets a two-finger pinch win before horizontal commitment', () => {
    event('pointerdown', 100, 320, 1);
    event('pointerdown', 200, 320, 2);
    event('pointermove', 260, 320, 2);
    expect(owner.setFit).toHaveBeenCalledWith('cover');
    expect(scrubber.active).toBe(false);
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('leaves inline two-finger gestures unclaimed and accepts a fresh single swipe', () => {
    delete owner.setFit;
    event('pointerdown', 100, 320, 1);
    expect(event('pointerdown', 200, 320, 2).defaultPrevented).toBe(false);
    expect(event('pointermove', 260, 320, 2).defaultPrevented).toBe(false);
    event('pointerup', 100, 320, 1);
    event('pointerup', 260, 320, 2);
    expect(video.pause).not.toHaveBeenCalled();
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    expect(scrubber.active).toBe(true);
  });

  it('cancels a committed scrub when another finger joins and blocks until both lift', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    event('pointerdown', 250, 320, 8);
    expect(video.currentTime).toBe(50);
    expect(scrubber.active).toBe(false);
    event('pointermove', 300, 320, 8);
    expect(owner.setFit).not.toHaveBeenCalled();
    event('pointerup', 150, 320);
    event('pointerup', 300, 320, 8);
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    expect(scrubber.active).toBe(true);
  });

  it('ignores descendant lost capture while transferring capture to the stage', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    event('lostpointercapture', 150, 320);
    expect(scrubber.active).toBe(true);
    event('lostpointercapture', 150, 320, 7, stage);
    expect(scrubber.active).toBe(false);
    expect(video.currentTime).toBe(50);
  });

  it('cancels active decoder work and capture on teardown without resuming', () => {
    event('pointerdown', 110, 320);
    event('pointermove', 150, 320);
    scrubber.cleanup();
    gestures.cleanup();
    vi.advanceTimersByTime(100);
    expect(owner.play).not.toHaveBeenCalled();
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(gestures.points.size).toBe(0);
    expect(scrubber.gestureListeners).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-scrubber.js';

describe('owned-player pointer precision scrubbing', () => {
  let owner;
  let scrubber;
  let range;
  let host;
  let paused;
  let bounds;
  let captured;
  let visibilityDescriptor;

  function pointer(type, x = 160, y = 122, id = 7, extra = {}) {
    const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: id,
      clientX: x,
      clientY: y,
      button: 0,
      isPrimary: true,
      ...extra,
    })) {
      Object.defineProperty(event, key, { value });
    }
    (type === 'pointerdown' || type === 'lostpointercapture' ? range : window).dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    host = document.createElement('div');
    range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.step = '0.001';
    range.value = '50';
    const hint = document.createElement('p');
    const current = document.createElement('span');
    const video = document.createElement('video');
    video.currentTime = 50;
    paused = false;
    bounds = [0, 100];
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 });
    video.pause = vi.fn(() => {
      paused = true;
    });
    host.append(video, range, hint, current);
    document.body.append(host);
    range.getBoundingClientRect = () => ({ left: 10, top: 100, width: 300, height: 44 });
    captured = new Set();
    range.setPointerCapture = vi.fn((id) => captured.add(id));
    range.releasePointerCapture = vi.fn((id) => {
      captured.delete(id);
      pointer('lostpointercapture', 160, 122, id);
    });
    owner = {
      active: true,
      session: 1,
      video,
      ui: { host, refs: { seek: range, scrubHint: hint, current } },
      seekBounds: vi.fn(() => bounds),
      seekTo: vi.fn((time) => {
        video.currentTime = time;
      }),
      showControls: vi.fn(),
      play: vi.fn(() => {
        paused = false;
      }),
      update: vi.fn(() => {
        if (!scrubber?.active) {
          range.value = String(video.currentTime);
        }
      }),
    };
    scrubber = new window.VSC.IOSPlayerScrubber(owner);
    scrubber.attach();
  });

  afterEach(() => {
    scrubber.cleanup();
    host.remove();
    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    } else {
      delete document.visibilityState;
    }
    vi.useRealTimers();
  });

  it('preserves a thumb grab position and previews subsequent horizontal movement', () => {
    const event = pointer('pointerdown', 170);
    expect(event.defaultPrevented).toBe(true);
    expect(owner.video.pause).toHaveBeenCalledOnce();
    expect(range.setPointerCapture).toHaveBeenCalledWith(7);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(scrubber.active).toBe(true);

    pointer('pointermove', 200);
    expect(owner.video.currentTime).toBe(50);
    expect(Number(range.value)).toBe(60);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(60);
    expect(Number(range.value)).toBe(60);
    expect(owner.ui.refs.current.textContent).toBe('1:00.00');
    expect(range.getAttribute('aria-valuetext')).toBe('1:00.00 of 1:40');
    expect(owner.ui.refs.scrubHint.textContent).toBe('');
  });

  it('uses the owner time formatter for long-duration preview and accessibility text', () => {
    bounds = [0, 7200];
    owner.video.currentTime = 3600;
    range.max = '7200';
    range.value = '3600';
    owner.formatTime = vi.fn((time) => `formatted ${time}`);
    pointer('pointerdown');
    pointer('pointermove', 190);
    expect(owner.formatTime).toHaveBeenCalledWith(4320);
    expect(owner.formatTime).toHaveBeenCalledWith(7200);
    expect(owner.ui.refs.current.textContent).toBe('formatted 4320.00');
    expect(range.getAttribute('aria-valuetext')).toBe('formatted 4320.00 of formatted 7200');
  });

  it('maps a bar tap to time and resumes a previously playing presentation once', () => {
    pointer('pointerdown', 85);
    expect(owner.video.currentTime).toBe(25);
    expect(paused).toBe(true);
    pointer('pointerup', 85);
    expect(scrubber.active).toBe(false);
    expect(paused).toBe(false);
    expect(owner.play).toHaveBeenCalledOnce();
    expect(captured.size).toBe(0);
    expect(owner.ui.refs.scrubHint.textContent).toBe('');
  });

  it('leaves a previously paused video paused after seeking', () => {
    paused = true;
    pointer('pointerdown');
    pointer('pointermove', 190);
    pointer('pointerup', 190);
    expect(owner.video.currentTime).toBe(60);
    expect(owner.play).not.toHaveBeenCalled();
    expect(paused).toBe(true);
  });

  it.each([
    [0, 1, ''],
    [43, 1, ''],
    [44, 0.5, '×1/2'],
    [88, 0.25, '×1/4'],
    [132, 0.1, '×1/10'],
    [200, 0.1, '×1/10'],
  ])(
    'scales the same horizontal motion at distance %s above and below the bar',
    (distance, rate, label) => {
      for (const direction of [-1, 1]) {
        owner.video.currentTime = 50;
        pointer('pointerdown');
        pointer('pointermove', 160, 122 + distance * direction);
        pointer('pointermove', 190, 122 + distance * direction);
        expect(Number(range.value)).toBeCloseTo(50 + 10 * rate);
        vi.advanceTimersByTime(50);
        expect(owner.video.currentTime).toBeCloseTo(50 + 10 * rate);
        expect(owner.ui.refs.scrubHint.textContent).toBe(label);
        pointer('pointerup', 190, 122 + distance * direction);
      }
    }
  );

  it('changes precision continuously without jumping or seeking for vertical-only movement', () => {
    pointer('pointerdown');
    pointer('pointermove', 190);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(60);
    const writes = owner.seekTo.mock.calls.length;
    pointer('pointermove', 190, 254);
    expect(owner.video.currentTime).toBe(60);
    expect(owner.seekTo).toHaveBeenCalledTimes(writes);
    pointer('pointermove', 220, 254);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(61);
    pointer('pointermove', 220, 122);
    expect(owner.video.currentTime).toBe(61);
    pointer('pointermove', 250, 122);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(71);
  });

  it.each([-1, 1])(
    'keeps diagonal seeking consistent across event delivery above/below (%s)',
    (direction) => {
      for (const samples of [1, 2, 5, 10, 100]) {
        paused = true;
        owner.video.currentTime = 50;
        pointer('pointerdown');
        for (let index = 1; index <= samples; index++) {
          pointer(
            'pointermove',
            160 + (90 * index) / samples,
            122 + (150 * direction * index) / samples
          );
        }
        // The path spends 44px in each inner band, then 18px at tenth speed.
        const expected = 50 + (30 * (44 + 44 * 0.5 + 44 * 0.25 + 18 * 0.1)) / 150;
        expect(scrubber.value).toBeCloseTo(expected, 8);
        pointer('pointerup', 250, 122 + 150 * direction);
        expect(owner.video.currentTime).toBeCloseTo(expected, 8);
        expect(vi.getTimerCount()).toBe(0);
      }
    }
  );

  it('returns along a diagonal path without changing the result when event density changes', () => {
    paused = true;
    pointer('pointerdown');
    pointer('pointermove', 250, -28);
    expect(scrubber.value).toBeCloseTo(65.76, 8);
    for (let index = 1; index <= 10; index++) {
      pointer('pointermove', 250 - 9 * index, -28 + 15 * index);
    }
    pointer('pointerup');
    expect(owner.video.currentTime).toBeCloseTo(50, 8);
    expect(owner.play).not.toHaveBeenCalled();
  });

  it('keeps the selected time when layout moves underneath the captured finger', () => {
    paused = true;
    pointer('pointerdown');
    range.getBoundingClientRect = () => ({ left: 20, top: 0, width: 600, height: 44 });
    pointer('pointermove', 160, 122);
    expect(scrubber.value).toBe(50);
    pointer('pointermove', 220, 122);
    pointer('pointerup', 220, 122);
    expect(owner.video.currentTime).toBeCloseTo(52.5);
  });

  it.each([false, true])(
    'commits the final release coordinate after moves (paused=%s)',
    (wasPaused) => {
      paused = wasPaused;
      pointer('pointerdown');
      pointer('pointermove', 190);
      pointer('pointerup', 220);
      expect(owner.video.currentTime).toBeCloseTo(70);
      expect(Number(range.value)).toBeCloseTo(70);
      expect(owner.play).toHaveBeenCalledTimes(wasPaused ? 0 : 1);
      expect(paused).toBe(wasPaused);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('includes an undelivered diagonal move in the release position at fine precision', () => {
    paused = true;
    pointer('pointerdown');
    pointer('pointermove', 160, -28);
    pointer('pointerup', 190, -28);
    expect(owner.video.currentTime).toBeCloseTo(51);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a short drag delivered only as down and up', () => {
    pointer('pointerdown');
    pointer('pointerup', 190);
    expect(owner.video.currentTime).toBeCloseTo(60);
    expect(owner.play).toHaveBeenCalledOnce();
  });

  it.each(['pointercancel', 'lostpointercapture'])(
    '%s restores starting time and playback state',
    (type) => {
      pointer('pointerdown', 85);
      pointer('pointermove', 115);
      vi.advanceTimersByTime(50);
      expect(owner.video.currentTime).toBe(35);
      pointer(type, 115);
      expect(owner.video.currentTime).toBe(50);
      expect(owner.play).toHaveBeenCalledOnce();
      expect(paused).toBe(false);
      expect(scrubber.active).toBe(false);
    }
  );

  it('cancellation keeps a previously paused presentation paused', () => {
    paused = true;
    pointer('pointerdown', 85);
    pointer('pointercancel', 85);
    expect(owner.video.currentTime).toBe(50);
    expect(owner.play).not.toHaveBeenCalled();
    expect(paused).toBe(true);
  });

  it('teardown removes active gesture listeners without restoring or resuming media', () => {
    pointer('pointerdown', 85);
    pointer('pointermove', 115);
    expect(Number(range.value)).toBe(35);
    scrubber.cleanup();
    vi.advanceTimersByTime(100);
    const writes = owner.seekTo.mock.calls.length;
    pointer('pointermove', 200);
    pointer('pointerup', 200);
    expect(pointer('pointerdown', 200).defaultPrevented).toBe(false);
    expect(owner.video.currentTime).toBe(25);
    expect(owner.seekTo).toHaveBeenCalledTimes(writes);
    expect(owner.play).not.toHaveBeenCalled();
    expect(scrubber.active).toBe(false);
    expect(captured.size).toBe(0);
  });

  it.each(['video', 'host', 'inactive', 'session', 'replacement'])(
    'does not restore or resume an abandoned %s presentation',
    (change) => {
      pointer('pointerdown', 85);
      pointer('pointermove', 115);
      if (change === 'video') {
        owner.video.remove();
      }
      if (change === 'host') {
        host.remove();
      }
      if (change === 'inactive') {
        owner.active = false;
      }
      if (change === 'session') {
        owner.session++;
      }
      if (change === 'replacement') {
        owner.ui = { ...owner.ui };
      }
      pointer('pointercancel', 85);
      vi.advanceTimersByTime(100);
      expect(owner.video.currentTime).toBe(25);
      expect(owner.play).not.toHaveBeenCalled();
      expect(scrubber.active).toBe(false);
    }
  );

  it('clamps finite live seek windows as they move during a drag', () => {
    Object.defineProperty(owner.video, 'duration', { value: Infinity });
    bounds = [1000, 1060];
    owner.video.currentTime = 1030;
    range.min = '1000';
    range.max = '1060';
    range.value = '1030';
    pointer('pointerdown');
    pointer('pointermove', 460);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(1060);
    bounds = [1010, 1070];
    pointer('pointermove', 160);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(1010);
    pointer('pointercancel');
    expect(owner.video.currentTime).toBe(1030);
    expect(owner.seekTo.mock.calls.every(([time]) => Number.isFinite(time))).toBe(true);
  });

  it.each([null, [0, Infinity], [NaN, 100], [10, 5], [10, 10]])(
    'ignores unavailable or invalid seek bounds %j',
    (value) => {
      bounds = value;
      expect(pointer('pointerdown').defaultPrevented).toBe(false);
      expect(scrubber.active).toBe(false);
      expect(owner.video.pause).not.toHaveBeenCalled();
      expect(owner.seekTo).not.toHaveBeenCalled();
    }
  );

  it('never seeks NaN when media time or pointer coordinates are invalid', () => {
    Object.defineProperty(owner.video, 'currentTime', {
      configurable: true,
      writable: true,
      value: NaN,
    });
    pointer('pointerdown', 160);
    pointer('pointermove', NaN, 122);
    pointer('pointermove', 190, NaN);
    pointer('pointermove', 190);
    vi.advanceTimersByTime(50);
    expect(owner.seekTo.mock.calls.every(([time]) => Number.isFinite(time))).toBe(true);
    expect(owner.video.currentTime).toBe(60);
  });

  it('coalesces a burst of moves to one decoder seek and synchronously flushes the final target', () => {
    pointer('pointerdown');
    for (const x of [170, 180, 190]) {
      pointer('pointermove', x);
    }
    expect(Number(range.value)).toBeCloseTo(60);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(49);
    expect(owner.seekTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(owner.seekTo).toHaveBeenCalledOnce();
    expect(owner.seekTo.mock.calls[0][0]).toBeCloseTo(60);
    expect(vi.getTimerCount()).toBe(0);
    pointer('pointermove', 220);
    expect(Number(range.value)).toBeCloseTo(70);
    expect(owner.video.currentTime).toBeCloseTo(60);
    pointer('pointerup', 220);
    expect(owner.seekTo.mock.calls.map(([time]) => Math.round(time))).toEqual([60, 70]);
    vi.advanceTimersByTime(500);
    expect(owner.seekTo).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pointercancel', 'lostpointercapture'])(
    'cancels pending decoder writes before %s restores the start time',
    (type) => {
      pointer('pointerdown', 85);
      pointer('pointermove', 115);
      expect(Number(range.value)).toBe(35);
      pointer(type, 115);
      expect(owner.seekTo.mock.calls.map(([time]) => time)).toEqual([25, 50]);
      vi.advanceTimersByTime(500);
      expect(owner.seekTo.mock.calls.map(([time]) => time)).toEqual([25, 50]);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('does not resume hidden playback when an app switch cancels the gesture', () => {
    pointer('pointerdown', 85);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    pointer('pointercancel', 85);
    expect(owner.video.currentTime).toBe(50);
    expect(owner.play).not.toHaveBeenCalled();
    expect(paused).toBe(true);
    expect(scrubber.active).toBe(false);
  });

  it('keeps asynchronous site seek feedback from replacing the immediate preview', () => {
    owner.seekTo.mockImplementation(() => {});
    owner.update.mockImplementation(() => {
      range.value = '50';
      owner.ui.refs.current.textContent = '0:50';
    });
    pointer('pointerdown');
    pointer('pointermove', 220);
    expect(Number(range.value)).toBe(70);
    expect(owner.ui.refs.current.textContent).toBe('1:10.00');
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBe(50);
    expect(Number(range.value)).toBe(70);
    expect(owner.ui.refs.current.textContent).toBe('1:10.00');
  });

  it('keeps keyboard input/change working while preventing duplicate native pointer writes', () => {
    const input = vi.fn(() => owner.seekTo(Number(range.value)));
    range.addEventListener('input', input);
    range.addEventListener('change', input);
    pointer('pointerdown');
    range.value = '88';
    range.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    range.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    expect(input).not.toHaveBeenCalled();
    expect(Number(range.value)).toBe(50);
    pointer('pointerup');
    const key = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    range.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    range.value = '75';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input).toHaveBeenCalledOnce();
    expect(owner.video.currentTime).toBe(75);
  });

  it('uses temporary window delivery when pointer capture is unavailable', () => {
    range.setPointerCapture.mockImplementation(() => {
      throw new Error('Capture unavailable');
    });
    pointer('pointerdown');
    pointer('pointermove', 190);
    pointer('pointerup', 190);
    expect(owner.video.currentTime).toBe(60);
    expect(scrubber.active).toBe(false);
    expect(owner.play).toHaveBeenCalledOnce();
  });

  it('ignores a second pointer without losing the current gesture', () => {
    pointer('pointerdown');
    pointer('pointerdown', 250, 122, 8, { isPrimary: false });
    pointer('pointermove', 250, 122, 8);
    pointer('pointerup', 250, 122, 8);
    expect(scrubber.active).toBe(true);
    expect(owner.seekTo).not.toHaveBeenCalled();
    pointer('pointermove', 190);
    pointer('pointerup', 190);
    expect(owner.video.currentTime).toBe(60);
    expect(owner.play).toHaveBeenCalledOnce();
  });

  it.each(['seekTo', 'update', 'showControls'])(
    'does not resume after the final %s callback replaces the presentation',
    (callback) => {
      pointer('pointerdown');
      pointer('pointermove', 190);
      owner.onScrubFinish = vi.fn();
      owner[callback].mockImplementation(() => {
        owner.session++;
        scrubber.cleanup();
      });
      scrubber.finish(null);
      expect(owner.play).not.toHaveBeenCalled();
      expect(owner.onScrubFinish).toHaveBeenCalledOnce();
      expect(scrubber.active).toBe(false);
      expect(scrubber.gestureListeners).toHaveLength(0);
      expect(scrubber.timer).toBeNull();
      expect(captured.size).toBe(0);
    }
  );

  it('finishes once when a site seek handler reenters finish', () => {
    pointer('pointerdown');
    pointer('pointermove', 190);
    owner.onScrubFinish = vi.fn();
    owner.seekTo.mockImplementation((time) => {
      owner.video.currentTime = time;
      scrubber.finish(null);
    });
    scrubber.finish(null);
    expect(owner.seekTo).toHaveBeenCalledOnce();
    expect(owner.video.currentTime).toBe(60);
    expect(owner.onScrubFinish).toHaveBeenCalledOnce();
    expect(owner.play).toHaveBeenCalledOnce();
    expect(scrubber.active).toBe(false);
    expect(scrubber.gestureListeners).toHaveLength(0);
    expect(captured.size).toBe(0);
  });

  it('cleans an active scrub idempotently and cannot restart through retained events', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    pointer('pointerdown');
    pointer('pointermove', 190);
    expect(vi.getTimerCount()).toBe(1);
    const callbacks = add.mock.calls.filter(([type]) =>
      ['pointermove', 'pointerup', 'pointercancel'].includes(type)
    );
    expect(callbacks).toHaveLength(3);
    scrubber.cleanup();
    scrubber.cleanup();
    expect(vi.getTimerCount()).toBe(0);
    expect(captured.size).toBe(0);
    for (const [type, callback, options] of callbacks) {
      expect(remove).toHaveBeenCalledWith(type, callback, options);
    }
    pointer('pointerdown');
    pointer('pointermove', 250);
    pointer('pointerup', 250);
    vi.advanceTimersByTime(500);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.play).not.toHaveBeenCalled();
    add.mockRestore();
    remove.mockRestore();
  });

  it('cancels the original window timer after the range is adopted into an inert document', () => {
    const clear = vi.spyOn(window, 'clearTimeout');
    pointer('pointerdown');
    pointer('pointermove', 190);
    const timer = scrubber.timer;
    expect(timer).not.toBeNull();
    const inert = document.implementation.createHTMLDocument('adopted');
    inert.adoptNode(host);
    inert.body.append(host);
    expect(range.ownerDocument.defaultView).toBeNull();
    scrubber.cleanup();
    expect(clear).toHaveBeenCalledWith(timer);
    expect(vi.getTimerCount()).toBe(0);
    expect(captured.size).toBe(0);
    vi.advanceTimersByTime(500);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.play).not.toHaveBeenCalled();
    clear.mockRestore();
  });

  it('ignores another pointer cancellation while the owner has a pending seek', () => {
    pointer('pointerdown');
    pointer('pointermove', 190);
    expect(scrubber.pending).toBeCloseTo(60);
    pointer('pointercancel', 250, 122, 8);
    expect(scrubber.active).toBe(true);
    expect(scrubber.pending).toBeCloseTo(60);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(50);
    expect(owner.video.currentTime).toBeCloseTo(60);
    pointer('pointerup', 220);
    expect(owner.video.currentTime).toBeCloseTo(70);
    expect(owner.play).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('integrates a diagonal crossing both sides of the timeline consistently', () => {
    paused = true;
    // A 400px vertical path spans 136px tenth, 88px quarter,
    // 88px half and 88px normal sensitivity, independently of event density.
    const expectedDelta = ((60 / 300) * 100 * (136 * 0.1 + 88 * 0.25 + 88 * 0.5 + 88)) / 400;
    for (const samples of [1, 3, 17, 101]) {
      owner.video.currentTime = 50;
      pointer('pointerdown');
      pointer('pointermove', 160, -78);
      for (let index = 1; index <= samples; index++) {
        pointer('pointermove', 160 + (60 * index) / samples, -78 + (400 * index) / samples);
      }
      pointer('pointerup', 220, 322);
      expect(owner.video.currentTime).toBeCloseTo(50 + expectedDelta, 8);
      expect(owner.play).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each([
    'cancel',
    'cancel-before-capture',
    'cleanup',
    'cleanup-before-capture',
    'cleanup-throws',
    'src',
    'srcObject',
    'closed',
    'session',
  ])('does not continue startup after %s inside pointer capture', (transition) => {
    let controlsAfterCapture;
    owner.onScrubFinish = vi.fn();
    range.setPointerCapture.mockImplementation((id) => {
      const lateCapture = transition.endsWith('before-capture');
      if (!lateCapture) {
        captured.add(id);
      }
      if (transition.startsWith('cancel')) {
        pointer('lostpointercapture', 160, 122, id);
      } else if (transition.startsWith('cleanup')) {
        owner.active = false;
        scrubber.cleanup();
      } else if (transition === 'src') {
        owner.video.src = 'https://example.test/replacement.mp4';
      } else if (transition === 'srcObject') {
        owner.video.srcObject = {};
      } else if (transition === 'closed') {
        owner.active = false;
        host.remove();
      } else {
        owner.session++;
      }
      if (lateCapture) {
        captured.add(id);
      }
      controlsAfterCapture = owner.showControls.mock.calls.length;
      if (transition === 'cleanup-throws') {
        throw new Error('capture wrapper closed controls');
      }
    });
    pointer('pointerdown');
    expect(scrubber.active).toBe(false);
    expect(scrubber.gestureListeners).toHaveLength(0);
    expect(captured.size).toBe(0);
    expect(scrubber.timer).toBeNull();
    expect(owner.onScrubFinish).toHaveBeenCalledOnce();
    expect(owner.showControls).toHaveBeenCalledTimes(controlsAfterCapture);
    expect(owner.play).toHaveBeenCalledTimes(transition.startsWith('cancel') ? 1 : 0);
    expect(owner.seekTo).toHaveBeenCalledTimes(transition.startsWith('cancel') ? 1 : 0);
    expect(owner.video.currentTime).toBe(50);
    if (transition.startsWith('cleanup')) {
      expect(scrubber.listeners).toHaveLength(0);
    }
    pointer('pointermove', 220);
    pointer('pointerup', 220);
    vi.advanceTimersByTime(500);
    expect(scrubber.gestureListeners).toHaveLength(0);
    expect(scrubber.pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(owner.seekTo).toHaveBeenCalledTimes(transition.startsWith('cancel') ? 1 : 0);
    if (transition.startsWith('cancel')) {
      // An ordinary cancellation does not disable later user gestures.
      range.setPointerCapture.mockImplementation((id) => captured.add(id));
      owner.play.mockClear();
      pointer('pointerdown');
      pointer('pointermove', 190);
      pointer('pointerup', 190);
      expect(owner.video.currentTime).toBe(60);
      expect(owner.play).toHaveBeenCalledOnce();
    }
  });

  it.each([7, 8])(
    'leaves replacement pointer %s intact when capture reenters startup',
    (nextId) => {
      range.setPointerCapture.mockImplementation((id) => {
        captured.add(id);
        pointer('lostpointercapture', 160, 122, id);
        range.setPointerCapture.mockImplementation((nextId) => captured.add(nextId));
        pointer('pointerdown', 160, 122, nextId);
      });
      pointer('pointerdown');
      expect(scrubber.active).toBe(true);
      expect(scrubber.pointerId).toBe(nextId);
      expect(scrubber.gestureListeners).toHaveLength(3);
      expect(captured).toEqual(new Set([nextId]));
      pointer('pointermove', 190, 122, nextId);
      pointer('pointerup', 190, 122, nextId);
      expect(owner.video.currentTime).toBe(60);
      expect(owner.play).toHaveBeenCalledTimes(2);
      expect(scrubber.gestureListeners).toHaveLength(0);
      expect(captured.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([null, 7, 8])(
    'does not attach stale listeners when post-capture inspection starts pointer %s',
    (nextId) => {
      range.setPointerCapture.mockImplementation((id) => {
        captured.add(id);
        const currentSrc = owner.video.currentSrc;
        Object.defineProperty(owner.video, 'currentSrc', {
          configurable: true,
          get() {
            Object.defineProperty(owner.video, 'currentSrc', {
              configurable: true,
              value: currentSrc,
            });
            pointer('lostpointercapture', 160, 122, id);
            if (nextId !== null) {
              range.setPointerCapture.mockImplementation((newId) => captured.add(newId));
              pointer('pointerdown', 160, 122, nextId);
            }
            return currentSrc;
          },
        });
      });
      pointer('pointerdown');
      expect(scrubber.active).toBe(nextId !== null);
      expect(scrubber.gestureListeners).toHaveLength(nextId === null ? 0 : 3);
      expect(captured).toEqual(new Set(nextId === null ? [] : [nextId]));
      if (nextId !== null) {
        pointer('pointermove', 190, 122, nextId);
        pointer('pointerup', 190, 122, nextId);
        expect(owner.video.currentTime).toBe(60);
        expect(owner.play).toHaveBeenCalledTimes(2);
      } else {
        expect(owner.video.currentTime).toBe(50);
        expect(owner.play).toHaveBeenCalledOnce();
      }
      expect(scrubber.gestureListeners).toHaveLength(0);
      expect(captured.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('ends capture when source inspection replaces the presentation session', () => {
    range.setPointerCapture.mockImplementation((id) => {
      captured.add(id);
      const currentSrc = owner.video.currentSrc;
      Object.defineProperty(owner.video, 'currentSrc', {
        configurable: true,
        get() {
          Object.defineProperty(owner.video, 'currentSrc', {
            configurable: true,
            value: currentSrc,
          });
          owner.session++;
          return currentSrc;
        },
      });
    });
    pointer('pointerdown');
    expect(scrubber.active).toBe(false);
    expect(scrubber.gestureListeners).toHaveLength(0);
    expect(captured.size).toBe(0);
    expect(owner.play).not.toHaveBeenCalled();
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reinstall gesture listeners after a pause wrapper cleans up the scrubber', () => {
    let controlsAfterCleanup;
    owner.video.pause.mockImplementation(() => {
      paused = true;
      scrubber.cleanup();
      owner.active = false;
      host.remove();
      controlsAfterCleanup = owner.showControls.mock.calls.length;
    });
    pointer('pointerdown');
    expect(scrubber.active).toBe(false);
    expect(scrubber.listeners).toHaveLength(0);
    expect(scrubber.gestureListeners).toHaveLength(0);
    expect(range.setPointerCapture).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);
    expect(owner.showControls).toHaveBeenCalledTimes(controlsAfterCleanup);
    pointer('pointermove', 220);
    pointer('pointerup', 220);
    vi.advanceTimersByTime(500);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abandons startup when a pause wrapper changes the presentation session', () => {
    owner.video.pause.mockImplementation(() => {
      paused = true;
      owner.session++;
    });
    pointer('pointerdown');
    expect(scrubber.active).toBe(false);
    expect(scrubber.gestureListeners).toHaveLength(0);
    expect(range.setPointerCapture).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.play).not.toHaveBeenCalled();
    expect(owner.showControls).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

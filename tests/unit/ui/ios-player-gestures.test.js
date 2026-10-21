import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-gestures.js';

describe('IOSPlayerGestures', () => {
  let owner;
  let stage;
  let gestures;
  let clock;
  let nextPointer;
  function pointer(type, pointerId, clientX, clientY = 100, pointerType = 'touch') {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId, clientX, clientY, pointerType });
    stage.dispatchEvent(event);
    return event;
  }
  function tap(x, y = 100, duration = 40) {
    const id = nextPointer++;
    const down = pointer('pointerdown', id, x, y);
    clock += duration;
    const up = pointer('pointerup', id, x, y);
    return { down, up };
  }
  function pinch() {
    pointer('pointerdown', 1, 100);
    pointer('pointerdown', 2, 200);
  }
  beforeEach(() => {
    clock = 0;
    nextPointer = 10;
    stage = document.createElement('div');
    document.body.append(stage);
    stage.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 300 }));
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    owner = {
      active: true,
      view: { performance: { now: () => clock } },
      ui: { stage },
      fit: 'contain',
      showControls: vi.fn(),
      setFit: vi.fn((mode) => {
        owner.fit = mode;
      }),
      video: { play: vi.fn(), pause: vi.fn() },
      seekTo: vi.fn(),
      seekBy: vi.fn(),
    };
    gestures = new window.VSC.IOSPlayerGestures(owner);
    gestures.attach();
  });
  afterEach(() => {
    gestures.cleanup();
    stage.remove();
    vi.restoreAllMocks();
  });

  it('leaves single touch, mouse and trackpad pointer input unclaimed', () => {
    expect(pointer('pointerdown', 1, 100).defaultPrevented).toBe(false);
    expect(pointer('pointermove', 1, 140).defaultPrevented).toBe(false);
    expect(pointer('pointerup', 1, 140).defaultPrevented).toBe(false);
    pointer('pointerdown', 2, 100, 100, 'mouse');
    pointer('pointerdown', 3, 200, 100, 'mouse');
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(gestures.active).toBe(false);
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    expect(owner.setFit).not.toHaveBeenCalled();
  });

  it('keeps a first edge tap unclaimed for the ordinary HUD click', () => {
    const { down, up } = tap(50);
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(gestures.suppressClick).toBe(false);
    expect(owner.seekBy).not.toHaveBeenCalled();
    expect(owner.showControls).not.toHaveBeenCalled();
  });

  it.each([
    [50, -10],
    [350, 10],
  ])('seeks by %s-side touch double taps and extends a rapid third-tap chain', (x, delta) => {
    tap(x);
    clock += 100;
    const second = tap(x);
    expect(second.up.defaultPrevented).toBe(true);
    expect(gestures.suppressClick).toBe(true);
    expect(owner.seekBy).toHaveBeenCalledExactlyOnceWith(delta);
    expect(owner.showControls).toHaveBeenCalledOnce();
    clock += 100;
    tap(x);
    expect(owner.seekBy.mock.calls).toEqual([[delta], [delta]]);
    expect(owner.seekTo).not.toHaveBeenCalled();
    expect(owner.video.play).not.toHaveBeenCalled();
    expect(owner.video.pause).not.toHaveBeenCalled();
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
  });

  it.each([140, 200, 260])(
    'does not seek in the center zone at x=%s or bridge its tap chain',
    (x) => {
      tap(50);
      tap(x);
      tap(50);
      expect(owner.seekBy).not.toHaveBeenCalled();
      tap(x);
      tap(x);
      expect(owner.seekBy).not.toHaveBeenCalled();
    }
  );

  it('requires two taps on the same side', () => {
    tap(50);
    tap(350);
    expect(owner.seekBy).not.toHaveBeenCalled();
    tap(350);
    expect(owner.seekBy).toHaveBeenCalledExactlyOnceWith(10);
  });

  it.each([
    [280, true],
    [281, false],
  ])('accepts only short taps (duration %sms)', (duration, seeks) => {
    tap(50, 100, duration);
    tap(50, 100, duration);
    expect(owner.seekBy).toHaveBeenCalledTimes(seeks ? 1 : 0);
  });

  it.each([
    [320, true],
    [321, false],
  ])('bounds the inter-tap interval at %sms', (interval, seeks) => {
    tap(50);
    clock += interval - 40;
    tap(50);
    expect(owner.seekBy).toHaveBeenCalledTimes(seeks ? 1 : 0);
  });

  it.each([
    [40, 0, true],
    [41, 0, false],
    [0, 41, false],
  ])('requires neighboring taps (dx=%s, dy=%s)', (dx, dy, seeks) => {
    tap(50);
    tap(50 + dx, 100 + dy);
    expect(owner.seekBy).toHaveBeenCalledTimes(seeks ? 1 : 0);
  });

  it('invalidates a dragged tap permanently even when the finger returns to its start', () => {
    tap(50);
    pointer('pointerdown', 1, 50);
    pointer('pointermove', 1, 65);
    pointer('pointermove', 1, 50);
    pointer('pointerup', 1, 50);
    tap(50);
    expect(owner.seekBy).not.toHaveBeenCalled();
    tap(50);
    expect(owner.seekBy).toHaveBeenCalledExactlyOnceWith(-10);
  });

  it('allows at most 14px of touch movement and checks the final release position', () => {
    tap(50);
    pointer('pointerdown', 1, 50);
    pointer('pointermove', 1, 64);
    pointer('pointerup', 1, 64);
    expect(owner.seekBy).toHaveBeenCalledExactlyOnceWith(-10);
    gestures.cleanup();
    gestures.attach();
    owner.seekBy.mockClear();
    tap(50);
    pointer('pointerdown', 2, 50);
    pointer('pointerup', 2, 65);
    tap(50);
    expect(owner.seekBy).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture'])('clears a pending tap chain on %s', (type) => {
    tap(50);
    pointer('pointerdown', 1, 50);
    pointer(type, 1, 50);
    tap(50);
    expect(owner.seekBy).not.toHaveBeenCalled();
  });

  it('clears tap intent through a pinch without making either finger a seek tap', () => {
    tap(100);
    pinch();
    pointer('pointermove', 2, 230);
    pointer('pointerup', 1, 100);
    pointer('pointerup', 2, 230);
    tap(100);
    expect(owner.seekBy).not.toHaveBeenCalled();
    expect(owner.setFit).toHaveBeenCalledExactlyOnceWith('cover');
  });

  it.each(['active', 'controlsLocked'])('does not finish a tap after owner %s changes', (key) => {
    tap(50);
    pointer('pointerdown', 1, 50);
    owner[key] = key === 'controlsLocked';
    pointer('pointerup', 1, 50);
    owner.active = true;
    owner.controlsLocked = false;
    tap(50);
    expect(owner.seekBy).not.toHaveBeenCalled();
  });

  it('clears intent when a locked owner receives a new touch', () => {
    tap(50);
    owner.controlsLocked = true;
    pointer('pointerdown', 1, 50);
    pointer('pointerup', 1, 50);
    owner.controlsLocked = false;
    tap(50);
    expect(owner.seekBy).not.toHaveBeenCalled();
  });

  it.each(['mouse', 'pen'])('never treats %s pointer pairs as touch seeks', (type) => {
    for (const id of [1, 2]) {
      pointer('pointerdown', id, 50, 100, type);
      pointer('pointerup', id, 50, 100, type);
    }
    expect(owner.seekBy).not.toHaveBeenCalled();
  });

  it('delegates both seek-end clamps to the owner without writing media time itself', () => {
    owner.video.currentTime = 2;
    owner.seekBy.mockImplementation((delta) => {
      owner.video.currentTime = Math.max(0, Math.min(100, owner.video.currentTime + delta));
    });
    tap(50);
    tap(50);
    expect(owner.video.currentTime).toBe(0);
    tap(350);
    owner.video.currentTime = 98;
    tap(350);
    expect(owner.video.currentTime).toBe(100);
    expect(owner.seekBy.mock.calls).toEqual([[-10], [10]]);
    expect(owner.seekTo).not.toHaveBeenCalled();
  });

  it('consumes native dblclick only through 500ms after the latest touch', () => {
    const none = new MouseEvent('dblclick', { cancelable: true });
    expect(gestures.consumeDoubleClick(none)).toBe(false);
    tap(350);
    tap(350);
    clock += 500;
    const duplicate = new MouseEvent('dblclick', { cancelable: true });
    expect(gestures.consumeDoubleClick(duplicate)).toBe(true);
    expect(duplicate.defaultPrevented).toBe(true);
    expect(owner.seekBy).toHaveBeenCalledOnce();
    clock += 1;
    const later = new MouseEvent('dblclick', { cancelable: true });
    expect(gestures.consumeDoubleClick(later)).toBe(false);
    expect(later.defaultPrevented).toBe(false);
  });

  it.each(['center', 'drag', 'long-press', 'cancel', 'pinch'])(
    'suppresses browser dblclick after rejected touch seeking (%s)',
    (gesture) => {
      if (gesture === 'center') {
        tap(200);
        tap(200);
      } else if (gesture === 'long-press') {
        tap(50, 100, 400);
      } else if (gesture === 'pinch') {
        pinch();
        pointer('pointerup', 1, 100);
        pointer('pointerup', 2, 200);
      } else {
        pointer('pointerdown', 1, 50);
        clock += 40;
        if (gesture === 'drag') {
          pointer('pointermove', 1, 100);
          pointer('pointerup', 1, 100);
        } else {
          pointer('pointercancel', 1, 50);
        }
      }
      expect(owner.seekBy).not.toHaveBeenCalled();
      const duplicate = new MouseEvent('dblclick', { cancelable: true });
      expect(gestures.consumeDoubleClick(duplicate)).toBe(true);
      expect(duplicate.defaultPrevented).toBe(true);
      clock += 501;
      expect(gestures.consumeDoubleClick(new MouseEvent('dblclick'))).toBe(false);
    }
  );

  it('clears tap and duplicate-click state across cleanup/reattach', () => {
    tap(50);
    gestures.cleanup();
    gestures.attach();
    tap(50);
    expect(owner.seekBy).not.toHaveBeenCalled();
    tap(50);
    expect(owner.seekBy).toHaveBeenCalledOnce();
    gestures.cleanup();
    gestures.attach();
    expect(gestures.consumeDoubleClick(new MouseEvent('dblclick'))).toBe(false);
    tap(50);
    expect(owner.seekBy).toHaveBeenCalledOnce();
  });

  it.each(['zero-width', 'geometry-throws', 'clock-throws', 'seek-throws'])(
    'guards unavailable page geometry and methods (%s)',
    (failure) => {
      if (failure === 'zero-width') {
        stage.getBoundingClientRect.mockReturnValue({ left: 0, width: 0 });
      } else if (failure === 'geometry-throws') {
        stage.getBoundingClientRect.mockImplementation(() => {
          throw new Error('gone');
        });
      } else if (failure === 'clock-throws') {
        owner.view.performance.now = () => {
          throw new Error('gone');
        };
      } else {
        owner.seekBy.mockImplementation(() => {
          throw new Error('gone');
        });
      }
      expect(() => {
        tap(50);
        tap(50);
      }).not.toThrow();
      expect(gestures.suppressClick).toBe(false);
      expect(gestures.consumeDoubleClick(new MouseEvent('dblclick'))).toBe(
        failure !== 'clock-throws'
      );
    }
  );

  it('keeps seeking safe when the HUD method throws', () => {
    owner.showControls.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(() => {
      tap(50);
      tap(50);
    }).not.toThrow();
    expect(owner.seekBy).toHaveBeenCalledExactlyOnceWith(-10);
    expect(gestures.suppressClick).toBe(true);
  });

  it('captures two fingers and expands once without seeking or changing playback', () => {
    pinch();
    expect(gestures.active).toBe(true);
    expect(gestures.suppressClick).toBe(true);
    expect(stage.setPointerCapture.mock.calls).toEqual([[1], [2]]);
    expect(pointer('pointermove', 2, 213).defaultPrevented).toBe(true);
    pointer('pointermove', 2, 160);
    expect(owner.setFit).toHaveBeenCalledExactlyOnceWith('cover');
    expect(owner.showControls).toHaveBeenCalledOnce();
    expect(owner.video.play).not.toHaveBeenCalled();
    expect(owner.video.pause).not.toHaveBeenCalled();
    expect(owner.seekTo).not.toHaveBeenCalled();
    pointer('pointerup', 1, 100);
    expect(gestures.active).toBe(true);
    pointer('pointerup', 2, 160);
    expect(gestures.active).toBe(false);
    expect(gestures.suppressClick).toBe(true);
    expect(stage.releasePointerCapture.mock.calls).toEqual([[1], [2]]);
  });

  it('contracts from the original two-dimensional distance and ignores small motion', () => {
    owner.fit = 'cover';
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 100, 200);
    pointer('pointermove', 2, 100, 190);
    expect(owner.setFit).not.toHaveBeenCalled();
    pointer('pointermove', 2, 100, 187);
    expect(owner.setFit).toHaveBeenCalledExactlyOnceWith('contain');
  });

  it('does not change an already selected fit or switch again within the same gesture', () => {
    owner.fit = 'cover';
    pinch();
    pointer('pointermove', 2, 220);
    pointer('pointermove', 2, 150);
    expect(owner.setFit).not.toHaveBeenCalled();
  });

  it('retains click suppression through cancellation then clears on a fresh single touch', () => {
    pinch();
    pointer('pointercancel', 1, 100);
    pointer('lostpointercapture', 2, 200);
    expect(gestures.active).toBe(false);
    expect(gestures.suppressClick).toBe(true);
    expect(stage.releasePointerCapture).toHaveBeenCalledTimes(2);
    expect(pointer('pointerdown', 3, 100).defaultPrevented).toBe(false);
    expect(gestures.suppressClick).toBe(false);
    expect(gestures.active).toBe(false);
  });

  it('bounds tracked fingers and never recaptures the same pointer', () => {
    pinch();
    pointer('pointerdown', 2, 200);
    pointer('pointerdown', 3, 300);
    pointer('pointermove', 3, 400);
    expect(gestures.points.size).toBe(2);
    expect(stage.setPointerCapture).toHaveBeenCalledTimes(2);
    expect(owner.setFit).not.toHaveBeenCalled();
  });

  it('cleans listeners and capture idempotently without resuming playback', () => {
    const add = vi.spyOn(stage, 'addEventListener');
    gestures.attach();
    expect(add).not.toHaveBeenCalled();
    pinch();
    const remove = vi.spyOn(stage, 'removeEventListener');
    gestures.cleanup();
    gestures.cleanup();
    expect(remove).toHaveBeenCalledTimes(5);
    expect(stage.releasePointerCapture).toHaveBeenCalledTimes(2);
    expect(gestures.active).toBe(false);
    expect(gestures.suppressClick).toBe(false);
    expect(gestures.points.size).toBe(0);
    pinch();
    pointer('pointermove', 2, 230);
    expect(owner.setFit).not.toHaveBeenCalled();
    expect(owner.video.play).not.toHaveBeenCalled();
  });

  it('guards unavailable capture APIs, zero initial separation and inactive owners', () => {
    stage.setPointerCapture.mockImplementation(() => {
      throw new Error('gone');
    });
    pointer('pointerdown', 1, 100);
    pointer('pointerdown', 2, 100);
    pointer('pointermove', 2, 200);
    expect(owner.setFit).not.toHaveBeenCalled();
    owner.active = false;
    pointer('pointermove', 2, 230);
    expect(owner.setFit).not.toHaveBeenCalled();
    pointer('pointercancel', 1, 100);
    pointer('pointercancel', 2, 230);
    expect(() => gestures.cleanup()).not.toThrow();
  });

  it('removes the prior surface if attach is requested without a current UI', () => {
    pinch();
    owner.ui = null;
    expect(gestures.attach()).toBe(false);
    expect(gestures.active).toBe(false);
    expect(stage.releasePointerCapture).toHaveBeenCalledTimes(2);
    pointer('pointermove', 2, 240);
    expect(owner.setFit).not.toHaveBeenCalled();
  });

  it('can attach to a replacement surface while removing the previous listeners', () => {
    pinch();
    const replacement = document.createElement('div');
    owner.ui.stage = replacement;
    expect(gestures.attach()).toBe(true);
    expect(gestures.active).toBe(false);
    expect(stage.releasePointerCapture).toHaveBeenCalledTimes(2);
    pinch();
    pointer('pointermove', 2, 240);
    expect(owner.setFit).not.toHaveBeenCalled();
  });
});

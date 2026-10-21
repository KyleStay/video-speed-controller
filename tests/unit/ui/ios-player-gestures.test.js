import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-gestures.js';

describe('IOSPlayerGestures', () => {
  let owner;
  let stage;
  let gestures;
  function pointer(type, pointerId, clientX, clientY = 100, pointerType = 'touch') {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId, clientX, clientY, pointerType });
    stage.dispatchEvent(event);
    return event;
  }
  function pinch() {
    pointer('pointerdown', 1, 100);
    pointer('pointerdown', 2, 200);
  }
  beforeEach(() => {
    stage = document.createElement('div');
    document.body.append(stage);
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    owner = {
      active: true,
      ui: { stage },
      fit: 'contain',
      showControls: vi.fn(),
      setFit: vi.fn((mode) => {
        owner.fit = mode;
      }),
      video: { play: vi.fn(), pause: vi.fn() },
      seekTo: vi.fn(),
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

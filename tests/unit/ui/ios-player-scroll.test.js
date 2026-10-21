import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-scroll.js';

// Explicit layout-frame clock: a restoration transaction may schedule only two
// frames, and no delayed callback survives a user/navigation cancellation.
function frameClock(view) {
  let sequence = 0;
  const queue = new Map();
  const request = vi.spyOn(view, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++sequence;
    queue.set(id, callback);
    return id;
  });
  vi.spyOn(view, 'cancelAnimationFrame').mockImplementation((id) => queue.delete(id));
  return {
    queue,
    request,
    tick() {
      const pending = [...queue];
      for (const [id, callback] of pending) {
        queue.delete(id);
        callback(0);
      }
    },
  };
}

function windowScroll(view, x = 20, y = 600) {
  vi.spyOn(view, 'scrollX', 'get').mockImplementation(() => x);
  vi.spyOn(view, 'scrollY', 'get').mockImplementation(() => y);
  const write = vi.spyOn(view, 'scrollTo').mockImplementation((options) => {
    x = options.left;
    y = options.top;
  });
  return {
    write,
    move(left, top) {
      x = left;
      y = top;
    },
    read: () => [x, y],
  };
}

describe('IOSPlayerScrollState bounded presentation transactions', () => {
  let origin;
  let outer;
  let inner;
  let clock;
  let scroll;
  let states;
  const originalUrl = location.href;

  beforeEach(() => {
    outer = document.createElement('section');
    inner = document.createElement('div');
    origin = document.createElement('video');
    inner.append(origin);
    outer.append(inner);
    document.body.append(outer);
    outer.scrollLeft = 31;
    outer.scrollTop = 310;
    inner.scrollLeft = 17;
    inner.scrollTop = 170;
    clock = frameClock(window);
    scroll = windowScroll(window);
    states = [];
  });

  afterEach(() => {
    states.forEach((state) => state.cancel());
    vi.restoreAllMocks();
    outer.remove();
    document.documentElement.style.removeProperty('scroll-behavior');
    document.querySelectorAll('iframe').forEach((frame) => frame.remove());
    history.replaceState(null, '', originalUrl);
  });

  function snapshot(node = origin, parents = false) {
    const state = new window.VSC.IOSPlayerScrollState(node, parents);
    states.push(state);
    return state;
  }

  function disturb() {
    outer.scrollLeft = outer.scrollTop = 0;
    inner.scrollLeft = inner.scrollTop = 0;
    scroll.move(0, 0);
  }

  it('restores nested horizontal/vertical offsets and the window with instant scrolling', () => {
    const state = snapshot();
    outer.style.scrollBehavior = 'smooth';
    document.documentElement.style.scrollBehavior = 'smooth';
    disturb();
    state.restore(false);
    expect([outer.scrollLeft, outer.scrollTop, inner.scrollLeft, inner.scrollTop]).toEqual([
      31, 310, 17, 170,
    ]);
    expect(scroll.read()).toEqual([20, 600]);
    expect(scroll.write).toHaveBeenCalledWith({ left: 20, top: 600, behavior: 'instant' });
    expect(outer.style.scrollBehavior).toBe('smooth');
    document.documentElement.style.removeProperty('scroll-behavior');
    expect(clock.request).not.toHaveBeenCalled();
  });

  it('uses instant element scrollTo where available without rewriting smooth CSS', () => {
    const write = vi.fn(({ left, top }) => {
      inner.scrollLeft = left;
      inner.scrollTop = top;
    });
    inner.scrollTo = write;
    const state = snapshot();
    disturb();
    state.restore(false);
    expect(write).toHaveBeenCalledWith({ left: 17, top: 170, behavior: 'instant' });
  });

  it('covers delayed focus/layout movement for exactly two animation frames', () => {
    const state = snapshot();
    disturb();
    state.restore();
    expect(clock.queue.size).toBe(1);
    for (let index = 0; index < 2; index++) {
      disturb();
      clock.tick();
      expect(scroll.read()).toEqual([20, 600]);
    }
    expect(clock.request).toHaveBeenCalledTimes(2);
    expect(clock.queue.size).toBe(0);
    expect(state.removers).toHaveLength(0);
    disturb();
    clock.tick();
    expect(scroll.read()).toEqual([0, 0]);
  });

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown', 'pagehide', 'popstate'])(
    'cancels pending correction on %s so subsequent scrolling survives',
    (type) => {
      const state = snapshot();
      state.restore();
      scroll.move(80, 900);
      window.dispatchEvent(new Event(type));
      clock.tick();
      expect(scroll.read()).toEqual([80, 900]);
      expect(clock.queue.size).toBe(0);
      expect(state.removers).toHaveLength(0);
    }
  );

  it('refreshes a close snapshot instead of rewinding intentional scrolling during playback', () => {
    const state = snapshot();
    state.restore();
    scroll.move(45, 950);
    inner.scrollLeft = 25;
    inner.scrollTop = 225;
    expect(state.refresh()).toBe(state);
    expect(clock.queue.size).toBe(0);
    disturb();
    state.restore(false);
    expect(scroll.read()).toEqual([45, 950]);
    expect([inner.scrollLeft, inner.scrollTop]).toEqual([25, 225]);
  });

  it('preserves an untouched clamped axis when the user scrolls only the other axis', () => {
    const state = snapshot();
    outer.scrollLeft = outer.scrollTop = 0;
    state.checkpoint();
    outer.scrollLeft = 45;
    state.refresh(true);
    outer.scrollLeft = outer.scrollTop = 0;
    state.restore(false);
    expect([outer.scrollLeft, outer.scrollTop]).toEqual([45, 310]);
  });

  it('does not apply delayed corrections after the origin is removed or adopted', () => {
    const state = snapshot();
    state.restore();
    origin.remove();
    scroll.move(90, 1000);
    clock.tick();
    clock.tick();
    expect(scroll.read()).toEqual([90, 1000]);
    expect(clock.queue.size).toBe(0);
    expect(state.removers).toHaveLength(0);
    const other = document.implementation.createHTMLDocument('adopted');
    other.body.append(other.adoptNode(origin));
    state.restore();
    expect(clock.queue.size).toBe(0);
  });

  it('skips all stale URL entries when history navigation changes without an event', () => {
    const state = snapshot();
    state.restore();
    history.replaceState(null, '', '#another-route');
    disturb();
    clock.tick();
    expect(scroll.read()).toEqual([0, 0]);
    expect(inner.scrollTop).toBe(0);
  });

  it('does not write disconnected ancestors or nodes adopted into another document', () => {
    const state = snapshot();
    outer.remove();
    inner.scrollLeft = 5;
    inner.scrollTop = 6;
    state.restore(false);
    expect([inner.scrollLeft, inner.scrollTop]).toEqual([5, 6]);
    document.body.append(outer);
    const other = document.implementation.createHTMLDocument('replacement');
    other.body.append(other.adoptNode(inner));
    inner.scrollLeft = 8;
    inner.scrollTop = 9;
    state.restore(false);
    expect([inner.scrollLeft, inner.scrollTop]).toEqual([8, 9]);
  });

  it('cancel is repeatable and leaves no delayed writes or active listeners', () => {
    const state = snapshot();
    state.restore();
    state.cancel();
    state.cancel();
    disturb();
    clock.tick();
    expect(scroll.read()).toEqual([0, 0]);
    expect(state.frames).toHaveLength(0);
    expect(state.removers).toHaveLength(0);
  });

  it('captures same-origin parent-frame scrolling only when explicitly requested', () => {
    const frame = document.createElement('iframe');
    outer.append(frame);
    const child = frame.contentDocument.createElement('video');
    frame.contentDocument.body.append(child);
    windowScroll(frame.contentWindow, 2, 70);
    const local = snapshot(child);
    scroll.move(90, 1000);
    local.restore(false);
    expect(scroll.read()).toEqual([90, 1000]);
    const parent = snapshot(child, true);
    scroll.move(0, 0);
    outer.scrollTop = 0;
    parent.restore(false);
    expect(scroll.read()).toEqual([90, 1000]);
    expect(outer.scrollTop).toBe(310);
  });

  it('does not restore an old parent transaction after its originating child navigates', () => {
    const frame = document.createElement('iframe');
    outer.append(frame);
    const child = frame.contentDocument.createElement('video');
    frame.contentDocument.body.append(child);
    windowScroll(frame.contentWindow, 2, 70);
    const state = snapshot(child, true);
    frame.contentWindow.location.hash = 'new-child-route';
    scroll.move(90, 1000);
    state.restore(false);
    expect(scroll.read()).toEqual([90, 1000]);
  });

  it('does not scroll the old document after the originating media is adopted elsewhere', () => {
    const state = snapshot();
    const other = document.implementation.createHTMLDocument('new owner');
    other.body.append(other.adoptNode(origin));
    scroll.move(90, 1000);
    state.restore(false);
    expect(scroll.read()).toEqual([90, 1000]);
  });

  it('stops at an inaccessible frame boundary without touching the parent', () => {
    const frame = document.createElement('iframe');
    outer.append(frame);
    const child = frame.contentDocument.createElement('video');
    frame.contentDocument.body.append(child);
    windowScroll(frame.contentWindow, 2, 70);
    vi.spyOn(frame.contentWindow, 'frameElement', 'get').mockImplementation(() => {
      throw new DOMException('Cross-origin');
    });
    expect(() => snapshot(child, true)).not.toThrow();
    const state = states.at(-1);
    expect(state.entries.every((item) => item.doc === frame.contentDocument)).toBe(true);
    scroll.move(90, 1000);
    state.restore(false);
    expect(scroll.read()).toEqual([90, 1000]);
  });
});

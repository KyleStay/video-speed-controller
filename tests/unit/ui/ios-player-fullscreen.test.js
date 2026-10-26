import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-fullscreen.js';

const helpers = [];
const descriptors = [];
function property(object, key, value) {
  descriptors.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
  Object.defineProperty(object, key, { configurable: true, writable: true, value });
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup({ prefixed = false, enabled = true } = {}) {
  const host = document.createElement('vsc-ios-player');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="player"><button></button><p></p></div>';
  document.body.append(host);
  const screen = shadow.querySelector('.player');
  const ui = {
    host,
    shadow,
    screen,
    refs: { fullscreen: shadow.querySelector('button'), status: shadow.querySelector('p') },
  };
  const video = document.createElement('video');
  video.src = 'https://media.example.test/original.mp4';
  video.playbackRate = 1.5;
  screen.append(video);
  const owner = {
    ui,
    video,
    doc: document,
    view: window,
    active: true,
    disposed: false,
    session: 1,
    nativeGeneration: 0,
    position: vi.fn(),
  };
  property(document, 'fullscreenElement', null);
  property(document, 'webkitFullscreenElement', null);
  property(document, 'fullscreenEnabled', prefixed ? undefined : enabled);
  property(document, 'webkitFullscreenEnabled', prefixed ? enabled : undefined);
  const request = vi.fn(() => {
    document[prefixed ? 'webkitFullscreenElement' : 'fullscreenElement'] = host;
    document.dispatchEvent(new Event(prefixed ? 'webkitfullscreenchange' : 'fullscreenchange'));
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    document[prefixed ? 'webkitFullscreenElement' : 'fullscreenElement'] = null;
    document.dispatchEvent(new Event(prefixed ? 'webkitfullscreenchange' : 'fullscreenchange'));
    return Promise.resolve();
  });
  screen[prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen'] = request;
  property(document, prefixed ? 'webkitExitFullscreen' : 'exitFullscreen', exit);
  const helper = new window.VSC.IOSPlayerFullscreen(owner);
  helpers.push(helper);
  return { helper, owner, ui, video, screen, request, exit };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const snapshot = () => ({ restore: vi.fn(), refresh: vi.fn(), cancel: vi.fn() });

afterEach(() => {
  helpers.splice(0).forEach((helper) => helper.cleanup());
  for (const [object, key, descriptor] of descriptors.splice(0).reverse()) {
    if (descriptor) {
      Object.defineProperty(object, key, descriptor);
    } else {
      delete object[key];
    }
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('owned DOM fullscreen', () => {
  it.each([false, true])(
    'enters and exits the controls wrapper, leaving the original media intact (prefixed %s)',
    async (prefixed) => {
      const { helper, owner, ui, video, screen, request, exit } = setup({ prefixed });
      const state = snapshot();
      expect(helper.available()).toBe(true);
      expect(helper.enter(state)).toBe(true);
      expect(request).toHaveBeenCalledExactlyOnceWith();
      expect(request.mock.contexts[0]).toBe(screen);
      await flush();
      expect(state.restore).toHaveBeenCalledOnce();
      expect(ui.refs.fullscreen.dataset.vscIcon).toBe('contract');
      expect(ui.refs.fullscreen.getAttribute('aria-label')).toBe('Exit full screen');
      expect(ui.refs.fullscreen.getAttribute('aria-pressed')).toBe('true');
      expect(video.parentNode).toBe(screen);
      expect(video.playbackRate).toBe(1.5);
      expect(video.src).toBe('https://media.example.test/original.mp4');
      expect(helper.toggle()).toBe(true);
      await flush();
      expect(exit).toHaveBeenCalledOnce();
      expect(state.refresh).not.toHaveBeenCalled();
      expect(state.restore).toHaveBeenCalledOnce();
      expect(state.cancel).toHaveBeenCalledOnce();
      expect(owner.active).toBe(true);
      expect(ui.host.isConnected).toBe(true);
      expect(ui.refs.fullscreen.dataset.vscIcon).toBe('expand');
      expect(ui.refs.fullscreen.getAttribute('aria-label')).toBe('Full screen');
    }
  );

  it('stays in the owned viewport when capability or iframe permission is denied', () => {
    const { helper, owner, ui, request } = setup({ enabled: false });
    const state = snapshot();
    expect(helper.available()).toBe(false);
    expect(helper.enter(state)).toBe(false);
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(ui.refs.fullscreen.hidden).toBe(true);
    expect(ui.refs.status.textContent).toBe('');
    expect(owner.active).toBe(true);
  });

  it('honors explicit policy denial and guards throwing capability accessors', () => {
    const { helper, request, screen } = setup();
    property(document, 'permissionsPolicy', { allowsFeature: () => false });
    expect(helper.available()).toBe(false);
    expect(helper.enter()).toBe(false);
    expect(request).not.toHaveBeenCalled();
    property(document, 'permissionsPolicy', undefined);
    Object.defineProperty(screen, 'requestFullscreen', {
      configurable: true,
      get() {
        throw new Error('Page getter');
      },
    });
    expect(() => helper.available()).not.toThrow();
    expect(helper.available()).toBe(false);
  });

  it.each(['throw', 'reject'])(
    'keeps controls usable and reports an explicit %s',
    async (failure) => {
      const { helper, ui, owner, request } = setup();
      const state = snapshot();
      request.mockImplementation(() => {
        if (failure === 'throw') {
          throw new Error('Denied');
        }
        return Promise.reject(new Error('Denied'));
      });
      helper.enter(state);
      await flush();
      expect(owner.active).toBe(true);
      expect(ui.host.isConnected).toBe(true);
      expect(ui.refs.status.textContent).toContain('Continue in this player');
      expect(state.restore).toHaveBeenCalledOnce();
    }
  );

  it('recognizes a shadow-root target and leaves unrelated fullscreen untouched', () => {
    const { helper, ui, screen, exit } = setup();
    property(ui.shadow, 'fullscreenElement', screen);
    helper.updateButton();
    expect(ui.refs.fullscreen.dataset.vscIcon).toBe('contract');
    expect(ui.refs.fullscreen.getAttribute('aria-label')).toBe('Exit full screen');
    const unrelated = document.createElement('section');
    document.body.append(unrelated);
    document.fullscreenElement = unrelated;
    helper.cleanup();
    expect(exit).not.toHaveBeenCalled();
    expect(document.fullscreenElement).toBe(unrelated);
  });

  it('retains the viewport player after browser fullscreen exit and updates its layout', async () => {
    const { helper, ui, owner } = setup();
    helper.enter();
    await flush();
    owner.position.mockClear();
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(owner.active).toBe(true);
    expect(ui.host.isConnected).toBe(true);
    expect(ui.refs.fullscreen.dataset.vscIcon).toBe('expand');
    expect(ui.refs.fullscreen.getAttribute('aria-label')).toBe('Full screen');
    expect(owner.position).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('resize'));
    expect(owner.position).toHaveBeenCalledTimes(2);
  });

  function scrollFixture(owner) {
    const nested = document.createElement('section');
    const anchor = document.createComment('original media');
    nested.append(anchor);
    document.body.append(nested);
    owner.anchor = anchor;
    property(window, 'scrollX', 25);
    property(window, 'scrollY', 300);
    property(
      window,
      'scrollTo',
      vi.fn(({ left, top }) => {
        window.scrollX = left;
        window.scrollY = top;
      })
    );
    nested.scrollLeft = 10;
    nested.scrollTop = 180;
    const frames = new Map();
    let nextFrame = 0;
    property(window, 'requestAnimationFrame', (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    property(window, 'cancelAnimationFrame', (id) => frames.delete(id));
    const paint = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    };
    return { nested, frames, paint };
  }

  it.each(['input', 'site'])(
    'never replays entry offsets over newer %s scroll intent on browser exit',
    async (intent) => {
      const { helper, owner } = setup();
      const { nested, frames, paint } = scrollFixture(owner);
      const entry = new window.VSC.IOSPlayerScrollState(owner.anchor, true);
      helper.enter(entry);
      await flush();
      expect(frames.size).toBeGreaterThan(0);
      if (intent === 'input') {
        window.dispatchEvent(new Event('wheel'));
      }
      window.scrollX = 70;
      window.scrollY = 650;
      nested.scrollLeft = 45;
      nested.scrollTop = 390;
      document.fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      paint();
      paint();
      expect([window.scrollX, window.scrollY, nested.scrollLeft, nested.scrollTop]).toEqual([
        70, 650, 45, 390,
      ]);
      expect(frames.size).toBe(0);
      expect(owner.active).toBe(true);
    }
  );

  it('keeps entry correction separate from a fresh explicit-exit scroll snapshot', async () => {
    const { helper, owner, request, exit, ui } = setup();
    const { nested, paint } = scrollFixture(owner);
    const entry = new window.VSC.IOSPlayerScrollState(owner.anchor, true);
    request.mockImplementation(() => {
      window.scrollY = 0;
      nested.scrollTop = 0;
      document.fullscreenElement = ui.host;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    helper.enter(entry);
    await flush();
    expect([window.scrollY, nested.scrollTop]).toEqual([300, 180]);
    paint();
    paint();
    window.scrollY = 650;
    nested.scrollTop = 390;
    exit.mockImplementation(() => {
      window.scrollY = 0;
      nested.scrollTop = 0;
      document.fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    helper.toggle();
    await flush();
    paint();
    paint();
    expect([window.scrollY, nested.scrollTop]).toEqual([650, 390]);
    expect(owner.active).toBe(true);
  });

  it('cancels entry repair when user input changes scrolling while the request is pending', async () => {
    const { helper, owner, request, ui } = setup();
    const { nested, paint, frames } = scrollFixture(owner);
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    helper.enter(new window.VSC.IOSPlayerScrollState(owner.anchor, true));
    window.dispatchEvent(new Event('touchstart'));
    window.scrollY = 650;
    nested.scrollTop = 390;
    document.fullscreenElement = ui.host;
    document.dispatchEvent(new Event('fullscreenchange'));
    pending.resolve();
    await flush();
    paint();
    paint();
    expect([window.scrollY, nested.scrollTop]).toEqual([650, 390]);
    expect(frames.size).toBe(0);
  });

  it('cancels repair in accessible frame ancestors when input arrives while entry is pending', async () => {
    const { helper, owner, request, ui } = setup();
    const { nested, paint, frames } = scrollFixture(owner);
    const frame = document.createElement('iframe');
    nested.append(frame);
    const child = frame.contentWindow;
    const childDoc = frame.contentDocument;
    const anchor = childDoc.createComment('child media');
    childDoc.body.append(anchor);
    property(child, 'scrollX', 0);
    property(child, 'scrollY', 120);
    property(
      child,
      'scrollTo',
      vi.fn(({ left, top }) => {
        child.scrollX = left;
        child.scrollY = top;
      })
    );
    const entry = new window.VSC.IOSPlayerScrollState(anchor, true);
    expect(new Set(entry.entries.map((item) => item.view))).toEqual(new Set([child, window]));
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    helper.enter(entry);
    child.dispatchEvent(new Event('pointerdown'));
    window.scrollY = 650;
    nested.scrollTop = 390;
    child.scrollY = 240;
    document.fullscreenElement = ui.host;
    document.dispatchEvent(new Event('fullscreenchange'));
    pending.resolve();
    await flush();
    paint();
    paint();
    expect([window.scrollY, nested.scrollTop, child.scrollY]).toEqual([650, 390, 240]);
    expect(frames.size).toBe(0);
  });

  it('discards a denied explicit-exit snapshot before a later browser exit', async () => {
    const { helper, owner, exit } = setup();
    const { nested, paint } = scrollFixture(owner);
    helper.enter(new window.VSC.IOSPlayerScrollState(owner.anchor, true));
    await flush();
    paint();
    paint();
    window.scrollY = 650;
    nested.scrollTop = 390;
    exit.mockRejectedValue(new Error('Denied'));
    helper.toggle();
    await flush();
    window.scrollY = 800;
    nested.scrollTop = 450;
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    paint();
    paint();
    expect([window.scrollY, nested.scrollTop]).toEqual([800, 450]);
    expect(owner.active).toBe(true);
  });

  it.each(['close', 'session', 'source', 'ui'])(
    'ignores deferred rejection after %s and never changes a later UI',
    async (change) => {
      const { helper, owner, ui, request, exit } = setup();
      const pending = deferred();
      request.mockReturnValue(pending.promise);
      helper.enter(snapshot());
      if (change === 'close') {
        owner.active = false;
      }
      if (change === 'session') {
        owner.session++;
      }
      if (change === 'source') {
        owner.nativeGeneration++;
      }
      if (change === 'ui') {
        owner.ui = { refs: { status: { textContent: 'new UI' } } };
      }
      pending.reject(new Error('Old rejection'));
      await flush();
      expect(ui.refs.status.textContent).toBe('');
      expect(exit).not.toHaveBeenCalled();
      if (change === 'ui') {
        expect(owner.ui.refs.status.textContent).toBe('new UI');
      }
    }
  );

  it('exits only its obsolete exact target after a pending request resolves following cleanup', async () => {
    const { helper, ui, request, exit } = setup();
    const pending = deferred();
    const state = snapshot();
    request.mockReturnValue(pending.promise);
    helper.enter(state);
    helper.cleanup();
    expect(state.cancel).toHaveBeenCalledOnce();
    document.fullscreenElement = ui.host;
    pending.resolve();
    await flush();
    expect(exit).toHaveBeenCalledOnce();
    expect(state.restore).not.toHaveBeenCalled();
  });

  it.each(['source', 'close'])(
    'exits a late successful old wrapper request after %s',
    async (change) => {
      const { helper, owner, ui, request, exit } = setup();
      const pending = deferred();
      request.mockReturnValue(pending.promise);
      helper.enter(snapshot());
      if (change === 'source') {
        owner.nativeGeneration++;
      } else {
        owner.active = false;
      }
      document.fullscreenElement = ui.host;
      pending.resolve();
      await flush();
      expect(exit).toHaveBeenCalledOnce();
      expect(ui.refs.status.textContent).toBe('');
    }
  );

  it('does not exit future-session fullscreen when an obsolete request resolves', async () => {
    const { helper, owner, request, exit } = setup();
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    helper.enter();
    helper.cleanup();
    const future = document.createElement('vsc-ios-player');
    document.body.append(future);
    owner.session++;
    owner.ui = { host: future };
    document.fullscreenElement = future;
    pending.resolve();
    await flush();
    expect(exit).not.toHaveBeenCalled();
    expect(document.fullscreenElement).toBe(future);
  });

  it('does not exit an exact target reused by a future session', async () => {
    const { helper, owner, ui, request, exit } = setup();
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    helper.enter();
    helper.cleanup();
    owner.session++;
    document.fullscreenElement = ui.host;
    pending.resolve();
    await flush();
    expect(exit).not.toHaveBeenCalled();
  });

  it('captures later explicit fullscreen from the original anchor ancestry', async () => {
    const { helper, owner } = setup();
    const originalParent = document.createElement('section');
    const anchor = document.createComment('origin');
    originalParent.append(anchor);
    document.body.append(originalParent);
    owner.anchor = anchor;
    const scroll = snapshot();
    const capture = vi.fn();
    property(
      window.VSC,
      'IOSPlayerScrollState',
      class {
        constructor(origin, parents) {
          capture(origin, parents);
          Object.assign(this, scroll);
        }
      }
    );
    expect(helper.toggle()).toBe(true);
    await flush();
    expect(capture).toHaveBeenCalledExactlyOnceWith(anchor, true);
    expect(scroll.restore).toHaveBeenCalledOnce();
  });

  it('still exits owned fullscreen if cancellation or layout APIs throw', async () => {
    const { helper, owner, exit } = setup();
    const scroll = snapshot();
    scroll.cancel.mockImplementation(() => {
      throw new Error('Closed window');
    });
    owner.position.mockImplementation(() => {
      throw new Error('Layout unavailable');
    });
    expect(helper.enter(scroll)).toBe(true);
    await flush();
    expect(() => helper.cleanup()).not.toThrow();
    expect(exit).toHaveBeenCalledOnce();
  });

  it('coalesces pending requests and cancels superseded snapshots', async () => {
    const { helper, request } = setup();
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    const first = snapshot();
    const second = snapshot();
    expect(helper.enter(first)).toBe(true);
    expect(helper.enter(second)).toBe(true);
    expect(request).toHaveBeenCalledOnce();
    expect(first.cancel).not.toHaveBeenCalled();
    expect(second.cancel).toHaveBeenCalledOnce();
    pending.resolve();
    await flush();
  });

  it('removes listeners and cancels the original snapshot on idempotent cleanup', async () => {
    const { helper, owner, exit } = setup();
    const state = snapshot();
    helper.enter(state);
    await flush();
    helper.cleanup();
    helper.cleanup();
    owner.position.mockClear();
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('webkitfullscreenchange'));
    window.dispatchEvent(new Event('resize'));
    expect(owner.position).not.toHaveBeenCalled();
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(helper.enter()).toBe(false);
  });
});

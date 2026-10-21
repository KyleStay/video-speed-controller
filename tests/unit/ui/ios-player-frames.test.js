import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-frames.js';

const TYPE = 'VSC_IOS_PLAYER_FRAME';

describe('IOSPlayerFrames', () => {
  let coordinator;

  function frameInside(parent = document.body) {
    const frame = document.createElement('iframe');
    frame.src = 'about:blank#owned-player';
    parent.append(frame);
    return frame;
  }

  function message(
    source,
    action,
    token = 'player:123',
    extra = {},
    origin = window.location.origin
  ) {
    const event = new MessageEvent('message', {
      data: { type: TYPE, action, token, ...extra },
      origin,
    });
    Object.defineProperty(event, 'source', { value: source });
    window.dispatchEvent(event);
  }

  function fakeParent() {
    const postMessage = vi.fn();
    const parent = { postMessage };
    Object.defineProperty(parent, 'document', {
      get: () => {
        throw new Error('Cross-origin access');
      },
    });
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
    return postMessage;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
    coordinator = new window.VSC.IOSPlayerFrames(document);
  });

  afterEach(() => {
    coordinator.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('stays idle until activation and starts listeners only once', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const query = vi.spyOn(document, 'querySelectorAll');
    const NativeObserver = window.MutationObserver;
    const observerCreated = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      class extends NativeObserver {
        constructor(callback) {
          super(callback);
          observerCreated();
        }
      }
    );
    coordinator.start();
    coordinator.start();
    expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1);
    expect(query).not.toHaveBeenCalled();
    expect(observerCreated).not.toHaveBeenCalled();
    expect(document.body.style.cssText).toBe('');
  });

  it('expands the matched direct iframe without moving it, reading its document, or changing its src', () => {
    const ancestor = document.createElement('section');
    ancestor.style.cssText =
      'transform: translateX(30px); contain: paint; overflow: hidden !important; opacity: .5';
    document.body.append(ancestor);
    const frame = frameInside(ancestor);
    frame.style.cssText =
      'position: relative !important; width: 320px; height: 180px; border-radius: 9px';
    const source = frame.contentWindow;
    const src = frame.getAttribute('src');
    const childDocument = vi.fn(() => {
      throw new Error('Forbidden child document access');
    });
    Object.defineProperty(frame, 'contentDocument', { get: childDocument, configurable: true });
    const setAttribute = vi.spyOn(frame, 'setAttribute');
    coordinator.start();
    message(source, 'open');
    expect(frame.parentNode).toBe(ancestor);
    expect(frame.contentWindow).toBe(source);
    expect(frame.getAttribute('src')).toBe(src);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(childDocument).not.toHaveBeenCalled();
    expect(frame.style.position).toBe('fixed');
    expect(frame.style.width).toBe('100vw');
    expect(frame.style.height).toBe('100dvh');
    expect(frame.style.zIndex).toBe('2147483647');
    expect(ancestor.style.transform).toBe('none');
    expect(ancestor.style.contain).toBe('none');
    expect(ancestor.style.overflowX).toBe('visible');
    expect(document.body.style.overflowY).toBe('hidden');
    message(source, 'close');
    expect(frame.style.position).toBe('relative');
    expect(frame.style.getPropertyPriority('position')).toBe('important');
    expect(frame.style.width).toBe('320px');
    expect(frame.style.height).toBe('180px');
    expect(ancestor.style.transform).toBe('translateX(30px)');
    expect(ancestor.style.contain).toBe('paint');
    expect(ancestor.style.overflow).toBe('hidden');
    expect(ancestor.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.body.style.overflowY).toBe('');
  });

  describe('scroll preservation during iframe CSS ownership', () => {
    function scrollingWindow(x = 30, y = 700) {
      vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => x);
      vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
      vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
        x = options.left;
        y = options.top;
      });
      return {
        move(left, top) {
          x = left;
          y = top;
        },
        read: () => [x, y],
      };
    }

    function scrolledFrame() {
      const parent = document.createElement('section');
      parent.style.overflow = 'auto';
      parent.scrollLeft = 25;
      parent.scrollTop = 350;
      document.body.append(parent);
      return { parent, frame: frameInside(parent) };
    }

    function simulateExpansionClamp(parent) {
      const override = coordinator.override.bind(coordinator);
      vi.spyOn(coordinator, 'override').mockImplementation((session, element, property, value) => {
        override(session, element, property, value);
        if (element === parent && property.startsWith('overflow') && value === 'visible') {
          parent.scrollLeft = parent.scrollTop = 0;
        }
      });
    }

    it('restores pre-expansion offsets when owned CSS temporarily removes the nested scroll range', () => {
      const scroll = scrollingWindow();
      const { parent, frame } = scrolledFrame();
      simulateExpansionClamp(parent);
      coordinator.start();
      message(frame.contentWindow, 'open');
      expect([parent.scrollLeft, parent.scrollTop]).toEqual([0, 0]);
      message(frame.contentWindow, 'close');
      expect([parent.scrollLeft, parent.scrollTop]).toEqual([25, 350]);
      expect(scroll.read()).toEqual([30, 700]);
      expect(parent.style.overflow).toBe('auto');
      expect(frame.style.position).toBe('');
    });

    it('keeps intentional parent and nested scrolling through frame-style release disturbances', () => {
      const scroll = scrollingWindow();
      const { parent, frame } = scrolledFrame();
      simulateExpansionClamp(parent);
      coordinator.start();
      message(frame.contentWindow, 'open');
      scroll.move(65, 1100);
      parent.scrollLeft = 45;
      parent.scrollTop = 550;
      const restore = coordinator.restoreStyles.bind(coordinator);
      vi.spyOn(coordinator, 'restoreStyles').mockImplementation((session) => {
        restore(session);
        // Browser layout/focus can move the viewport as restored CSS takes effect.
        scroll.move(0, 0);
        parent.scrollLeft = parent.scrollTop = 0;
      });
      message(frame.contentWindow, 'close');
      expect(scroll.read()).toEqual([65, 1100]);
      expect([parent.scrollLeft, parent.scrollTop]).toEqual([45, 550]);
      expect(parent.style.overflow).toBe('auto');
      expect(frame.style.position).toBe('');
    });

    it('cancels frame handback corrections on coordinator cleanup', () => {
      const scroll = scrollingWindow();
      const { frame } = scrolledFrame();
      const queue = new Map();
      let id = 0;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        queue.set(++id, callback);
        return id;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((key) => queue.delete(key));
      coordinator.start();
      message(frame.contentWindow, 'open');
      message(frame.contentWindow, 'close');
      expect(queue.size).toBe(1);
      coordinator.cleanup();
      expect(queue.size).toBe(0);
      scroll.move(80, 1200);
      expect(scroll.read()).toEqual([80, 1200]);
    });
  });

  describe('synchronous authenticated ancestor handback', () => {
    let nested;
    let previousManager;

    beforeEach(() => {
      nested = [];
      previousManager = window.VSC.iosPlayerFrames;
      window.VSC.iosPlayerFrames = coordinator;
      coordinator.start();
    });

    afterEach(() => {
      for (const { manager } of nested.reverse()) {
        manager.cleanup();
      }
      window.VSC.iosPlayerFrames = previousManager;
    });

    function childOf(parentManager) {
      const doc = parentManager.document;
      const scroller = doc.createElement('section');
      scroller.style.overflow = 'auto';
      scroller.scrollLeft = 70;
      scroller.scrollTop = 220;
      doc.body.append(scroller);
      const frame = doc.createElement('iframe');
      // A real same-origin URL gives jsdom the same Location.origin contract as
      // the production HTTP fixture. No external resources are loaded.
      frame.src = `${window.location.origin}/nested-scroll-test`;
      scroller.append(frame);
      const childDocument = frame.contentDocument;
      if (!childDocument.body) {
        childDocument.append(childDocument.createElement('html'));
        childDocument.documentElement.append(childDocument.createElement('body'));
      }
      const manager = new window.VSC.IOSPlayerFrames(childDocument);
      manager.view.VSC = { iosPlayerFrames: manager };
      const posted = vi.spyOn(parentManager.view, 'postMessage').mockImplementation(() => {});
      // Vitest wraps the top Window in a different proxy from jsdom's native
      // iframe.parent. Normalize that alias while keeping actual documents,
      // frame.contentWindow identities and production coordinators intact.
      vi.spyOn(manager.view, 'parent', 'get').mockReturnValue(parentManager.view);
      const item = { manager, frame, scroller, posted, parentManager };
      nested.push(item);
      return item;
    }

    function acceptOpen(item, token = 'sync-scroll') {
      item.parentManager.handleMessage({
        data: { type: TYPE, action: 'open', token },
        source: item.manager.view,
        origin: window.location.origin,
      });
      expect(item.parentManager.childSession?.source).toBe(item.manager.view);
    }

    it('restores a validated parent frame and its scroll offsets before deactivate returns', () => {
      const child = childOf(coordinator);
      const override = coordinator.override.bind(coordinator);
      vi.spyOn(coordinator, 'override').mockImplementation((session, node, property, value) => {
        override(session, node, property, value);
        if (node === child.scroller && property.startsWith('overflow') && value === 'visible') {
          node.scrollLeft = node.scrollTop = 0;
        }
      });
      child.manager.activate('sync-scroll');
      expect(coordinator.childSession === null).toBe(true); // Opens remain queued.
      acceptOpen(child);
      expect(child.frame.style.position).toBe('fixed');
      expect([child.scroller.scrollLeft, child.scroller.scrollTop]).toEqual([0, 0]);
      expect(child.manager.deactivate('sync-scroll')).toBe(true);
      expect(coordinator.childSession === null).toBe(true);
      expect(child.frame.style.position).toBe('');
      expect([child.scroller.scrollLeft, child.scroller.scrollTop]).toEqual([70, 220]);
      expect(child.posted).toHaveBeenLastCalledWith(
        { type: TYPE, action: 'close', token: 'sync-scroll' },
        '*'
      );
    });

    it('releases both validated ancestors synchronously across three real documents', () => {
      const middle = childOf(coordinator);
      const leaf = childOf(middle.manager);
      leaf.manager.activate('sync-scroll');
      acceptOpen(leaf);
      acceptOpen(middle);
      expect(leaf.frame.style.position).toBe('fixed');
      expect(middle.frame.style.position).toBe('fixed');
      expect(leaf.manager.deactivate('sync-scroll')).toBe(true);
      expect(middle.manager.childSession === null).toBe(true);
      expect(coordinator.childSession === null).toBe(true);
      expect(leaf.frame.style.position).toBe('');
      expect(middle.frame.style.position).toBe('');
      expect(leaf.posted).toHaveBeenLastCalledWith(
        { type: TYPE, action: 'close', token: 'sync-scroll' },
        '*'
      );
      expect(middle.posted).toHaveBeenLastCalledWith(
        { type: TYPE, action: 'close', token: 'sync-scroll' },
        '*'
      );
    });

    it.each(['token', 'source', 'document', 'frame-window', 'manager-document', 'unvalidated'])(
      'does not directly release an ancestor with stale or unvalidated %s identity',
      (invalid) => {
        const child = childOf(coordinator);
        child.manager.activate('sync-scroll');
        acceptOpen(child);
        const session = coordinator.childSession;
        const receive = vi.spyOn(coordinator, 'handleMessage');
        if (invalid === 'source') {
          session.source = {};
        }
        if (invalid === 'document') {
          session.sourceDocument = {};
        }
        if (invalid === 'frame-window') {
          Object.defineProperty(child.frame, 'contentWindow', { configurable: true, value: {} });
        }
        if (invalid === 'manager-document') {
          coordinator.document = document.implementation.createHTMLDocument('unrelated');
        }
        if (invalid === 'unvalidated') {
          coordinator.childSession = null;
        }
        const token = invalid === 'token' ? 'stale-token' : 'sync-scroll';
        child.manager.postUpstream('close', token);
        expect(receive).not.toHaveBeenCalled();
        expect(child.posted).toHaveBeenLastCalledWith({ type: TYPE, action: 'close', token }, '*');
        expect(child.frame.style.position).toBe('fixed');
        // Restore test-only authentication mutations so normal cleanup owns CSS.
        coordinator.document = document;
        coordinator.childSession = session;
        session.source = child.manager.view;
        session.sourceDocument = child.manager.document;
      }
    );

    it('still queues a close after a pending open that has not authenticated yet', () => {
      const child = childOf(coordinator);
      child.manager.activate('pending');
      child.manager.deactivate('pending');
      expect(coordinator.childSession === null).toBe(true);
      expect(child.posted.mock.calls.map(([data]) => data.action)).toEqual(['open', 'close']);
      for (const [data] of child.posted.mock.calls) {
        coordinator.handleMessage({
          data,
          source: child.manager.view,
          origin: window.location.origin,
        });
      }
      expect(coordinator.childSession === null).toBe(true);
      expect(child.frame.style.position).toBe('');
    });

    it('retains the queued close when parent globals are cross-origin inaccessible', () => {
      const child = childOf(coordinator);
      const posted = vi.fn();
      const deniedParent = { postMessage: posted };
      Object.defineProperty(deniedParent, 'VSC', {
        get() {
          throw new DOMException('Cross-origin');
        },
      });
      vi.spyOn(child.manager.view, 'parent', 'get').mockReturnValue(deniedParent);
      expect(() => child.manager.postUpstream('close', 'local')).not.toThrow();
      expect(posted).toHaveBeenCalledWith({ type: TYPE, action: 'close', token: 'local' }, '*');
    });
  });

  it('restores unset shorthand families without residual owned styles', () => {
    const frame = frameInside();
    const original = frame.style.cssText;
    coordinator.start();
    message(frame.contentWindow, 'open');
    message(frame.contentWindow, 'close');
    expect(frame.style.cssText).toBe(original);
    expect(document.body.style.cssText).toBe('');
    expect(document.documentElement.style.cssText).toBe('');
  });

  it('preserves site edits to individual shorthand sides while restoring the rest', () => {
    const frame = frameInside();
    frame.style.cssText = 'margin: 4px; border: 2px solid red';
    // jsdom does not expand border-radius shorthand getters; use explicit corners.
    for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) {
      frame.style.setProperty(`border-${corner}-radius`, '6px');
    }
    coordinator.start();
    message(frame.contentWindow, 'open');
    frame.style.setProperty('margin-right', '12px', 'important');
    frame.style.setProperty('border-left-width', '5px', 'important');
    frame.style.setProperty('border-top-left-radius', '9px', 'important');
    message(frame.contentWindow, 'close');
    expect(frame.style.marginTop).toBe('4px');
    expect(frame.style.marginRight).toBe('12px');
    expect(frame.style.borderTopWidth).toBe('2px');
    expect(frame.style.borderLeftWidth).toBe('5px');
    expect(frame.style.borderTopLeftRadius).toBe('9px');
    expect(frame.style.borderBottomRightRadius).toBe('6px');
    expect(frame.style.borderTopColor).toBe('red');
    expect(frame.style.getPropertyPriority('margin-right')).toBe('important');
  });

  it('rejects unowned sources and malformed or oversized messages', () => {
    const frame = frameInside();
    coordinator.start();
    message(window, 'open');
    message({}, 'open');
    message(frame.contentWindow, 'open', 'x'.repeat(129));
    message(frame.contentWindow, 'open', 'invalid token');
    message(frame.contentWindow, 'wrong-action');
    message(frame.contentWindow, 'open', 'valid', { unexpected: true });
    const malformed = new MessageEvent('message', { data: null });
    Object.defineProperty(malformed, 'source', { value: frame.contentWindow });
    window.dispatchEvent(malformed);
    expect(coordinator.childSession).toBeNull();
    expect(frame.style.position).toBe('');
    expect(document.body.style.overflowY).toBe('');
  });

  it('requires both the active source and token to close', () => {
    const active = frameInside();
    const other = frameInside();
    coordinator.start();
    message(active.contentWindow, 'open', 'active-token');
    message(other.contentWindow, 'close', 'active-token');
    message(active.contentWindow, 'close', 'wrong-token');
    expect(active.style.position).toBe('fixed');
    message(active.contentWindow, 'close', 'active-token');
    expect(active.style.position).toBe('');
    expect(coordinator.childSession).toBeNull();
  });

  it('keeps duplicate opens idempotent and releases the previous child on replacement', () => {
    const post = fakeParent();
    const first = frameInside();
    const second = frameInside();
    first.style.width = '280px';
    coordinator.start();
    message(first.contentWindow, 'open', 'first');
    const session = coordinator.childSession;
    const disconnect = vi.spyOn(session.observer, 'disconnect');
    message(first.contentWindow, 'open', 'first');
    expect(coordinator.childSession).toBe(session);
    expect(disconnect).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    message(second.contentWindow, 'open', 'second');
    expect(disconnect).toHaveBeenCalled();
    expect(first.style.width).toBe('280px');
    expect(second.style.position).toBe('fixed');
    message(first.contentWindow, 'close', 'first');
    expect(second.style.position).toBe('fixed');
    expect(post.mock.calls.map(([data]) => [data.action, data.token])).toEqual([
      ['open', 'first'],
      ['close', 'first'],
      ['open', 'second'],
    ]);
  });

  it('preserves site changes while restoring every property it still owns', () => {
    const ancestor = document.createElement('div');
    ancestor.style.transform = 'translateY(8px)';
    document.body.append(ancestor);
    document.body.style.overflowY = 'auto';
    const frame = frameInside(ancestor);
    frame.style.width = '300px';
    frame.style.height = '200px';
    coordinator.start();
    message(frame.contentWindow, 'open');
    frame.style.setProperty('width', '640px', 'important');
    ancestor.style.setProperty('transform', 'rotate(5deg)', 'important');
    // Matching value with a different priority also belongs to the site's edit.
    document.body.style.setProperty('overflow-y', 'hidden');
    message(frame.contentWindow, 'close');
    expect(frame.style.width).toBe('640px');
    expect(frame.style.getPropertyPriority('width')).toBe('important');
    expect(frame.style.height).toBe('200px');
    expect(ancestor.style.transform).toBe('rotate(5deg)');
    expect(document.body.style.overflowY).toBe('hidden');
    expect(document.body.style.getPropertyPriority('overflow-y')).toBe('');
    expect(document.documentElement.style.overflowY).toBe('');
  });

  it('propagates local and nested sessions upward without accessing the parent DOM', () => {
    const post = fakeParent();
    expect(coordinator.activate('local')).toBe(true);
    coordinator.activate('local');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenLastCalledWith({ type: TYPE, action: 'open', token: 'local' }, '*');
    const frame = frameInside();
    message(frame.contentWindow, 'open', 'nested');
    expect(post.mock.calls.map(([data]) => [data.action, data.token])).toEqual([
      ['open', 'local'],
      ['close', 'local'],
      ['open', 'nested'],
    ]);
    message(frame.contentWindow, 'close', 'nested');
    expect(post).toHaveBeenLastCalledWith({ type: TYPE, action: 'open', token: 'local' }, '*');
    expect(coordinator.deactivate('spoof')).toBe(false);
    expect(coordinator.deactivate('local')).toBe(true);
    expect(post).toHaveBeenLastCalledWith({ type: TYPE, action: 'close', token: 'local' }, '*');
  });

  it('restores styles and closes the upstream session when the active iframe is removed', async () => {
    const post = fakeParent();
    const ancestor = document.createElement('div');
    ancestor.style.transform = 'translateZ(0)';
    document.body.append(ancestor);
    const frame = frameInside(ancestor);
    coordinator.start();
    message(frame.contentWindow, 'open', 'remove-me');
    frame.remove();
    await Promise.resolve();
    expect(coordinator.childSession).toBeNull();
    expect(ancestor.style.transform).toBe('translateZ(0)');
    expect(document.body.style.overflowY).toBe('');
    expect(post).toHaveBeenLastCalledWith({ type: TYPE, action: 'close', token: 'remove-me' }, '*');
  });

  it('resolves open shadow-root iframes and observes their removal with the same active observer', async () => {
    const host = document.createElement('div');
    host.style.transform = 'translateX(5px)';
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const frame = frameInside(shadow);
    const source = {};
    source.document = { defaultView: source };
    Object.defineProperty(frame, 'contentWindow', { value: source });
    coordinator.start();
    message(source, 'open', 'shadow');
    expect(frame.style.position).toBe('fixed');
    expect(host.style.transform).toBe('none');
    const observer = coordinator.childSession.observer;
    frame.remove();
    await Promise.resolve();
    expect(coordinator.childSession).toBeNull();
    expect(host.style.transform).toBe('translateX(5px)');
    expect(observer).toBeDefined();
  });

  it('restores on pagehide, removes listeners, and can be restarted for BFCache restoration', () => {
    const post = fakeParent();
    const frame = frameInside();
    const remove = vi.spyOn(window, 'removeEventListener');
    coordinator.start();
    message(frame.contentWindow, 'open', 'pagehide');
    window.dispatchEvent(new Event('pagehide'));
    expect(frame.style.position).toBe('');
    expect(coordinator.started).toBe(false);
    expect(remove).toHaveBeenCalledWith('message', coordinator.onMessage);
    expect(remove).toHaveBeenCalledWith('pagehide', coordinator.onPageHide);
    expect(post).toHaveBeenLastCalledWith({ type: TYPE, action: 'close', token: 'pagehide' }, '*');
    message(frame.contentWindow, 'open', 'ignored');
    expect(frame.style.position).toBe('');
    coordinator.start();
    message(frame.contentWindow, 'open', 'restored');
    expect(frame.style.position).toBe('fixed');
    coordinator.cleanup();
    coordinator.cleanup();
    expect(frame.style.position).toBe('');
  });

  it('continues past throwing frame getters and gracefully handles an unavailable parent', () => {
    const inaccessible = frameInside();
    const actual = frameInside();
    vi.spyOn(inaccessible, 'contentWindow', 'get').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const post = fakeParent();
    post.mockImplementation(() => {
      throw new Error('Parent unavailable');
    });
    coordinator.start();
    expect(() => message(actual.contentWindow, 'open')).not.toThrow();
    expect(actual.style.position).toBe('fixed');
    expect(() => coordinator.cleanup()).not.toThrow();
    expect(actual.style.position).toBe('');
    expect(coordinator.activate('still-frame-local')).toBe(true);
  });

  it('rolls back partial CSS changes if frame styling fails', () => {
    const frame = frameInside();
    frame.style.position = 'relative';
    frame.style.height = '150px';
    const set = frame.style.setProperty.bind(frame.style);
    vi.spyOn(frame.style, 'setProperty').mockImplementation((property, ...args) => {
      if (property === 'height') {
        throw new Error('Page replaced style API');
      }
      return set(property, ...args);
    });
    coordinator.start();
    message(frame.contentWindow, 'open');
    expect(coordinator.childSession).toBeNull();
    expect(frame.style.position).toBe('relative');
    expect(frame.style.height).toBe('150px');
    expect(document.body.style.overflowY).toBe('');
  });

  it('rejects cross-origin and opaque child requests before frame discovery', () => {
    const frame = frameInside();
    const find = vi.spyOn(coordinator, 'findFrame');
    const source = {};
    const sourceDocument = vi.fn(() => {
      throw new Error('Opaque sandbox');
    });
    Object.defineProperty(source, 'document', { get: sourceDocument });
    coordinator.start();
    message(source, 'open', 'ad', {}, 'https://ad.example');
    message(source, 'open', 'opaque', {}, 'null');
    expect(find).not.toHaveBeenCalled();
    expect(sourceDocument).not.toHaveBeenCalled();
    expect(frame.style.position).toBe('');
    message(source, 'open', 'spoofed-origin');
    expect(find).not.toHaveBeenCalled();
    expect(frame.style.position).toBe('');
  });

  it('releases CSS and the upstream token when navigation changes the authenticated document', () => {
    const post = fakeParent();
    const frame = frameInside();
    const source = {};
    let currentDocument = { defaultView: source };
    Object.defineProperty(source, 'document', { get: () => currentDocument });
    Object.defineProperty(frame, 'contentWindow', { value: source });
    coordinator.start();
    message(source, 'open', 'navigate');
    const load = coordinator.childSession.onLoad;
    const remove = vi.spyOn(frame, 'removeEventListener');
    currentDocument = { defaultView: source };
    frame.dispatchEvent(new Event('load'));
    expect(coordinator.childSession).toBeNull();
    expect(frame.style.position).toBe('');
    expect(document.body.style.overflowY).toBe('');
    expect(remove).toHaveBeenCalledWith('load', load);
    expect(post).toHaveBeenLastCalledWith({ type: TYPE, action: 'close', token: 'navigate' }, '*');
  });

  it('restores the parent if a formerly authenticated child becomes inaccessible on load', () => {
    const frame = frameInside();
    const source = {};
    let denied = false;
    Object.defineProperty(source, 'document', {
      get: () => {
        if (denied) {
          throw new Error('Navigated cross-origin');
        }
        return sourceDocument;
      },
    });
    const sourceDocument = { defaultView: source };
    Object.defineProperty(frame, 'contentWindow', { value: source });
    coordinator.start();
    message(source, 'open', 'denied');
    denied = true;
    expect(() => frame.dispatchEvent(new Event('load'))).not.toThrow();
    expect(coordinator.childSession).toBeNull();
    expect(frame.style.position).toBe('');
    expect(document.body.style.overflowY).toBe('');
  });
});

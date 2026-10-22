import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/ui/ios-player-takeover.js';

const changes = [];
const releases = [];
const Takeover = window.VSC.IOSPlayerTakeover;
function property(target, name, value, attributes = {}) {
  changes.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value,
    ...attributes,
  });
}
function player() {
  const container = document.createElement('section');
  const video = document.createElement('video');
  video.src = 'https://media.example.test/original.mp4';
  video.srcObject = { original: true };
  container.append(video);
  document.body.append(container);
  const owner = {
    video,
    attached: true,
    disposed: false,
    nativeGeneration: 1,
    open: vi.fn(() => true),
  };
  video.vsc = { iosPlayer: owner };
  return { owner, video, container };
}
function register(owner) {
  const release = Takeover.register(owner);
  releases.push(release);
  return release;
}
const browserEventGetter = Object.getOwnPropertyDescriptor(window, 'event')?.get;
let currentEvent;
function gesture(type = 'click') {
  // Model jsdom's unavailable trusted dispatch while preserving real nested events.
  currentEvent = { type, isTrusted: true, eventPhase: 2, target: document.body };
  return currentEvent;
}

let standard;
let prefixed;
let native;
let mode;
beforeEach(() => {
  window.VSC_controller.teardown();
  currentEvent = undefined;
  property(window, 'event', undefined);
  Object.defineProperty(window, 'event', {
    configurable: true,
    get() {
      return browserEventGetter?.call(window) || currentEvent;
    },
  });
  vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
  property(navigator, 'userActivation', { isActive: true });
  standard = vi.fn(() => Promise.resolve('native-standard'));
  prefixed = vi.fn(() => 'native-prefixed');
  native = vi.fn(() => 'native-video');
  mode = vi.fn(() => 'native-mode');
  property(Element.prototype, 'requestFullscreen', standard);
  property(Element.prototype, 'webkitRequestFullscreen', prefixed);
  property(Element.prototype, 'webkitRequestFullScreen', prefixed);
  property(HTMLVideoElement.prototype, 'webkitEnterFullscreen', native);
  property(HTMLVideoElement.prototype, 'webkitEnterFullScreen', native);
  property(HTMLVideoElement.prototype, 'webkitSetPresentationMode', mode);
});
afterEach(() => {
  releases
    .splice(0)
    .reverse()
    .forEach((release) => release());
  for (const [target, name, descriptor] of changes.splice(0).reverse()) {
    if (descriptor) {
      Object.defineProperty(target, name, descriptor);
    } else {
      delete target[name];
    }
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('iOS fullscreen request takeover', () => {
  it('stays inert before the first iOS player and restores exact descriptors on final release', () => {
    const { owner } = player();
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen');
    expect(Element.prototype.requestFullscreen).toBe(standard);
    const release = register(owner);
    expect(Element.prototype.requestFullscreen).not.toBe(standard);
    release();
    release();
    expect(Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen')).toEqual(
      descriptor
    );
    expect(Takeover.managers.has(window)).toBe(false);
  });

  it.each(['video', 'container'])(
    'routes a current trusted %s request synchronously around original media',
    async (target) => {
      const { owner, video, container } = player();
      const originalSource = video.src;
      const originalStream = video.srcObject;
      register(owner);
      gesture();
      const promise = (target === 'video' ? video : container).requestFullscreen({
        navigationUI: 'hide',
      });
      expect(owner.open).toHaveBeenCalledExactlyOnceWith({ fullscreen: true });
      expect(standard).not.toHaveBeenCalled();
      await expect(promise).resolves.toBeUndefined();
      expect(video.src).toBe(originalSource);
      expect(video.srcObject).toBe(originalStream);
      expect(video.parentElement).toBe(container);
    }
  );

  it.each([
    'webkitRequestFullscreen',
    'webkitRequestFullScreen',
    'webkitEnterFullscreen',
    'webkitEnterFullScreen',
  ])('preserves void return shape for intercepted %s', (name) => {
    const { owner, video } = player();
    register(owner);
    gesture();
    expect(video[name]()).toBeUndefined();
    expect(owner.open).toHaveBeenCalledOnce();
    expect(prefixed).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it('intercepts only fullscreen presentation mode, preserving inline and PiP arguments/receiver', () => {
    const { owner, video } = player();
    register(owner);
    for (const value of ['inline', 'picture-in-picture', 'unknown']) {
      expect(video.webkitSetPresentationMode(value)).toBe('native-mode');
      expect(mode).toHaveBeenLastCalledWith(value);
      expect(mode.mock.contexts.at(-1)).toBe(video);
    }
    gesture();
    expect(video.webkitSetPresentationMode('fullscreen')).toBeUndefined();
    expect(owner.open).toHaveBeenCalledOnce();
    expect(mode).toHaveBeenCalledTimes(3);
  });

  it('suppresses matched programmatic fullscreen instead of invoking native presentation', async () => {
    const { owner, video } = player();
    register(owner);
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(video.webkitEnterFullscreen()).toBeUndefined();
    expect(video.webkitSetPresentationMode('fullscreen')).toBeUndefined();
    expect(owner.open).not.toHaveBeenCalled();
    expect(standard).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
    expect(mode).not.toHaveBeenCalled();
  });

  it.each([false, undefined])(
    'requires a current trusted event even with activation %s',
    async (active) => {
      const { owner, video } = player();
      property(
        navigator,
        'userActivation',
        active === undefined ? undefined : { isActive: active }
      );
      register(owner);
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
      gesture();
      if (active === false) {
        await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
      } else {
        await expect(video.requestFullscreen()).resolves.toBeUndefined();
      }
      expect(owner.open).toHaveBeenCalledTimes(active === false ? 0 : 1);
    }
  );

  it('denies later tasks and microtasks immediately after dispatch, before any zero timer runs', async () => {
    vi.useFakeTimers();
    const { owner, video } = player();
    register(owner);
    gesture('keydown');
    const first = video.requestFullscreen();
    expect(owner.open).toHaveBeenCalledOnce();
    await first;
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    gesture();
    currentEvent = undefined; // Dispatch has returned; no timer has run.
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    await Promise.resolve();
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(owner.open).toHaveBeenCalledOnce();
    expect(standard).not.toHaveBeenCalled();
  });

  it('denies nested synthetic requests without spending the outer trusted event', async () => {
    const { owner, video } = player();
    register(owner);
    gesture();
    let nested;
    const request = () => {
      nested = video.requestFullscreen();
    };
    window.addEventListener('click', request);
    try {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await expect(nested).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(owner.open).not.toHaveBeenCalled();
      await video.requestFullscreen();
      expect(owner.open).toHaveBeenCalledOnce();
      expect(standard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', request);
    }
  });

  it.each(['click', 'keydown'])(
    'accepts a trusted %s request from an earlier window capture listener once',
    async (type) => {
      const { owner, video } = player();
      register(owner);
      const current = { type, isTrusted: true, eventPhase: 2, target: video };
      property(window, 'event', current);
      // No lazy gesture listener is required; the site's earlier capture works.
      const first = video.requestFullscreen();
      expect(owner.open).toHaveBeenCalledOnce();
      await expect(first).resolves.toBeUndefined();
      await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(owner.open).toHaveBeenCalledOnce();
      expect(standard).not.toHaveBeenCalled();
    }
  );

  it('does not regrant a previously consumed current event', async () => {
    const { owner, video } = player();
    register(owner);
    const current = gesture();
    await video.requestFullscreen();
    currentEvent = undefined;
    currentEvent = current;
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(owner.open).toHaveBeenCalledOnce();
  });

  it.each(['untrusted', 'other-event', 'other-document', 'activation-veto'])(
    'rejects invalid current-event fallback: %s',
    async (kind) => {
      const { owner, video } = player();
      register(owner);
      const event = {
        type: kind === 'other-event' ? 'play' : 'click',
        isTrusted: kind !== 'untrusted',
        eventPhase: 2,
        target: video,
      };
      if (kind === 'other-document') {
        event.target = document.implementation.createHTMLDocument().body;
      }
      if (kind === 'activation-veto') {
        property(navigator, 'userActivation', { isActive: false });
      }
      property(window, 'event', event);
      await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(owner.open).not.toHaveBeenCalled();
      expect(standard).not.toHaveBeenCalled();
    }
  );

  it.each(['removed', 'replaced'])(
    'accepts a current trusted click whose target was synchronously %s',
    async (change) => {
      const { owner, video } = player();
      const button = document.createElement('button');
      const icon = document.createElement('span');
      button.append(icon);
      document.body.append(button);
      register(owner);
      const event = gesture();
      event.target = icon;
      if (change === 'removed') {
        button.remove();
      } else {
        button.replaceWith(document.createElement('button'));
      }
      expect(icon.isConnected).toBe(false);
      expect(icon.ownerDocument).toBe(document);
      const request = video.requestFullscreen();
      expect(owner.open).toHaveBeenCalledExactlyOnceWith({ fullscreen: true });
      await expect(request).resolves.toBeUndefined();
      expect(standard).not.toHaveBeenCalled();
    }
  );

  it('rejects a retained trusted event whose synchronous dispatch has finished', async () => {
    const { owner, video } = player();
    register(owner);
    const event = gesture();
    event.eventPhase = 0;
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(owner.open).not.toHaveBeenCalled();
    expect(standard).not.toHaveBeenCalled();
  });

  it('rejects false/throwing owned entry through the standard Promise contract without native fallback', async () => {
    const { owner, video } = player();
    register(owner);
    gesture();
    owner.open.mockReturnValueOnce(false);
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    const failure = new Error('site callback failed');
    owner.open.mockImplementationOnce(() => {
      throw failure;
    });
    gesture();
    await expect(video.requestFullscreen()).rejects.toBe(failure);
    expect(standard).not.toHaveBeenCalled();
  });

  it('keeps recursive controlled requests from reopening or escaping to the native player', async () => {
    const { owner, video } = player();
    let nested;
    owner.open.mockImplementation(() => {
      nested = video.requestFullscreen();
      return true;
    });
    register(owner);
    gesture();
    await video.requestFullscreen();
    await expect(nested).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(owner.open).toHaveBeenCalledOnce();
    expect(standard).not.toHaveBeenCalled();
  });

  it('denies a synthetic request dispatched reentrantly while owned entry is running', async () => {
    const { owner, video } = player();
    let nested;
    const request = () => {
      nested = video.requestFullscreen();
    };
    window.addEventListener('click', request);
    owner.open.mockImplementation(() => {
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    });
    register(owner);
    gesture();
    try {
      await video.requestFullscreen();
      await expect(nested).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(owner.open).toHaveBeenCalledOnce();
      expect(standard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', request);
    }
  });

  it('passes the owned wrapper target through to the actual browser API without recursion', async () => {
    const { owner } = player();
    const host = document.createElement('vsc-ios-player');
    const screen = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(screen);
    document.body.append(host);
    owner.ui = { host, screen };
    register(owner);
    await expect(screen.requestFullscreen()).resolves.toBe('native-standard');
    expect(standard.mock.contexts[0]).toBe(screen);
    expect(owner.open).not.toHaveBeenCalled();
  });

  it.each(['body', 'html', 'unrelated', 'multiple', 'uncontrolled'])(
    'leaves %s targets with native semantics',
    async (kind) => {
      const { owner, video, container } = player();
      register(owner);
      gesture();
      let target = container;
      if (kind === 'body') {
        target = document.body;
      }
      if (kind === 'html') {
        target = document.documentElement;
      }
      if (kind === 'unrelated') {
        target = document.createElement('div');
        document.body.append(target);
      }
      if (kind === 'multiple') {
        const other = player();
        register(other.owner);
        container.append(other.video);
      }
      if (kind === 'uncontrolled') {
        container.append(document.createElement('video'));
      }
      await expect(target.requestFullscreen()).resolves.toBe('native-standard');
      expect(standard.mock.contexts[0]).toBe(target);
      expect(owner.open).not.toHaveBeenCalled();
      expect(video.src).toContain('original.mp4');
    }
  );

  it.each([
    'disposed',
    'detached',
    'unattached',
    'relinquished',
    'ownership',
    'non-ios',
    'adopted',
  ])('does not take over stale or excluded media: %s', async (change) => {
    const { owner, video } = player();
    register(owner);
    gesture();
    if (change === 'disposed') {
      owner.disposed = true;
    }
    if (change === 'detached') {
      video.remove();
    }
    if (change === 'unattached') {
      owner.attached = false;
    }
    if (change === 'relinquished') {
      window.VSC.IOSPlayer.siteRelinquished.add(video);
    }
    if (change === 'ownership') {
      video.vsc = {};
    }
    if (change === 'non-ios') {
      window.VSC.IOSPlayer.isSupported.mockReturnValue(false);
    }
    if (change === 'adopted') {
      document.implementation.createHTMLDocument().body.append(video);
    }
    await expect(video.requestFullscreen()).resolves.toBe('native-standard');
    expect(owner.open).not.toHaveBeenCalled();
  });

  it('keeps passive load/play inert and supports explicit fullscreen after source reuse', async () => {
    const { owner, video } = player();
    register(owner);
    for (const type of ['loadstart', 'emptied', 'play', 'playing']) {
      video.dispatchEvent(new Event(type));
    }
    expect(owner.open).not.toHaveBeenCalled();
    video.src = 'https://media.example.test/new.mp4';
    owner.nativeGeneration++;
    gesture();
    await video.requestFullscreen();
    expect(owner.open).toHaveBeenCalledOnce();
    expect(video.src).toContain('new.mp4');
  });

  it('unwraps only our wrappers and scopes nested explicit Apple bypass through throws', async () => {
    const { owner, video } = player();
    register(owner);
    expect(Takeover.nativeMethod(video, 'webkitEnterFullscreen')).toBe(native);
    expect(Takeover.nativeMethod(video, 'requestFullscreen')).toBe(standard);
    Takeover.withNative(owner, () => {
      expect(video.webkitEnterFullscreen()).toBe('native-video');
      Takeover.withNative(owner, () =>
        expect(video.webkitSetPresentationMode('fullscreen')).toBe('native-mode')
      );
    });
    expect(() =>
      Takeover.withNative(owner, () => {
        throw new Error('stop');
      })
    ).toThrow('stop');
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(owner.open).not.toHaveBeenCalled();
  });

  it('retains hooks until the final registration releases and reinstalls cleanly', () => {
    const first = player();
    const second = player();
    const a = register(first.owner);
    const duplicate = register(first.owner);
    const b = register(second.owner);
    const wrapped = Element.prototype.requestFullscreen;
    a();
    b();
    expect(Element.prototype.requestFullscreen).toBe(wrapped);
    duplicate();
    expect(Element.prototype.requestFullscreen).toBe(standard);
    const again = register(second.owner);
    expect(Element.prototype.requestFullscreen).not.toBe(standard);
    again();
    expect(Element.prototype.requestFullscreen).toBe(standard);
  });

  it('does not overwrite newer site descriptors on release and unwraps a captured old wrapper', () => {
    const { owner, video } = player();
    const release = register(owner);
    const wrapped = video.requestFullscreen;
    const replacement = vi.fn();
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      enumerable: true,
      value: replacement,
    });
    release();
    expect(Element.prototype.requestFullscreen).toBe(replacement);
    property(video, 'requestFullscreen', wrapped);
    expect(Takeover.nativeMethod(video, 'requestFullscreen')).toBe(standard);
  });

  it('does not install for non-iOS media or throwing platform getters', () => {
    const { owner } = player();
    window.VSC.IOSPlayer.isSupported.mockReturnValue(false);
    register(owner);
    expect(Element.prototype.requestFullscreen).toBe(standard);
    const bad = {
      get video() {
        throw new Error('unavailable');
      },
    };
    expect(() => register(bad)).not.toThrow();
    expect(Takeover.managers.has(window)).toBe(false);
  });

  it('fails closed on throwing activation getters and preserves site native getters', async () => {
    const { owner, video } = player();
    register(owner);
    gesture();
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
    property(video, 'webkitEnterFullscreen', undefined);
    Object.defineProperty(video, 'webkitEnterFullscreen', {
      configurable: true,
      get() {
        throw new Error('site getter');
      },
    });
    expect(Takeover.nativeMethod(video, 'webkitEnterFullscreen')).toBeNull();
  });
  it('skips throwing, accessor and immutable method descriptors without breaking other hooks', () => {
    const { owner } = player();
    register(owner);
    const manager = Takeover.managers.get(window);
    const immutable = {};
    const method = vi.fn();
    Object.defineProperty(immutable, 'requestFullscreen', {
      value: method,
      configurable: false,
      writable: false,
    });
    const accessor = {};
    const getter = vi.fn(() => {
      throw new Error('getter must not run');
    });
    Object.defineProperty(accessor, 'requestFullscreen', { get: getter });
    const throwing = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('site descriptor');
        },
      }
    );
    expect(() => manager.hook(immutable, 'requestFullscreen')).not.toThrow();
    expect(() => manager.hook(accessor, 'requestFullscreen')).not.toThrow();
    expect(() => manager.hook(throwing, 'requestFullscreen')).not.toThrow();
    expect(immutable.requestFullscreen).toBe(method);
    expect(getter).not.toHaveBeenCalled();
    expect(Element.prototype.requestFullscreen).not.toBe(standard);
  });

  it('wraps/restores a nonconfigurable writable descriptor and respects later attribute edits', () => {
    const { owner } = player();
    const release = register(owner);
    const manager = Takeover.managers.get(window);
    const target = {};
    const original = vi.fn();
    const descriptor = { value: original, configurable: false, writable: true, enumerable: true };
    Object.defineProperty(target, 'requestFullscreen', descriptor);
    manager.hook(target, 'requestFullscreen');
    expect(target.requestFullscreen).not.toBe(original);
    const wrapped = Element.prototype.requestFullscreen;
    Object.defineProperty(Element.prototype, 'requestFullscreen', { writable: false });
    release();
    expect(Object.getOwnPropertyDescriptor(target, 'requestFullscreen')).toEqual(descriptor);
    expect(Element.prototype.requestFullscreen).toBe(wrapped);
    expect(Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen').writable).toBe(
      false
    );
  });

  it('adds no gesture listeners or timers and releases captured wrapper references safely', async () => {
    const { owner, video } = player();
    const add = vi.spyOn(window, 'addEventListener');
    const timer = vi.spyOn(window, 'setTimeout');
    const release = register(owner);
    const captured = video.requestFullscreen;
    gesture();
    expect(add).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    release();
    await expect(captured.call(video)).resolves.toBe('native-standard');
    expect(owner.open).not.toHaveBeenCalled();
  });

  it('does not reuse a gesture after document navigation or root replacement', async () => {
    const { owner, video } = player();
    const originalURL = document.URL;
    const root = document.documentElement;
    register(owner);
    try {
      gesture();
      currentEvent = undefined;
      history.replaceState({}, '', '#new-document-route');
      await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
      gesture();
      currentEvent = undefined;
      const replacement = document.createElement('html');
      replacement.append(document.head, document.body);
      document.replaceChild(replacement, root);
      await expect(video.requestFullscreen()).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(owner.open).not.toHaveBeenCalled();
    } finally {
      history.replaceState({}, '', originalURL);
      if (document.documentElement !== root) {
        root.append(document.head, document.body);
        document.replaceChild(root, document.documentElement);
      }
    }
  });

  it('keeps partial hooks releasable when a page constructor getter throws', () => {
    const { owner } = player();
    property(window, 'HTMLVideoElement', window.HTMLVideoElement);
    Object.defineProperty(window, 'HTMLVideoElement', {
      configurable: true,
      get() {
        throw new Error('page constructor');
      },
    });
    const release = register(owner);
    expect(Takeover.managers.has(window)).toBe(true);
    expect(Element.prototype.requestFullscreen).not.toBe(standard);
    release();
    expect(Takeover.managers.has(window)).toBe(false);
    expect(Element.prototype.requestFullscreen).toBe(standard);
  });
});

/** Intercept explicit, user-initiated iOS player fullscreen requests. */
window.VSC = window.VSC || {};

class IOSPlayerTakeover {
  static managers = new WeakMap();
  static wrappers = new WeakMap();

  static register(player) {
    let manager;
    try {
      if (!window.VSC.IOSPlayer?.isSupported(player.video) || player.disposed) {
        return () => {};
      }
      const view = player.video.ownerDocument.defaultView;
      manager = this.managers.get(view);
      if (!manager) {
        manager = new IOSPlayerTakeover(view);
        this.managers.set(view, manager);
      }
    } catch {
      return () => {};
    }
    manager.players.add(player);
    manager.counts.set(player, (manager.counts.get(player) || 0) + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const count = manager.counts.get(player) - 1;
      if (count) {
        manager.counts.set(player, count);
      } else {
        manager.players.delete(player);
        manager.counts.delete(player);
      }
      if (!manager.players.size) {
        manager.cleanup();
        if (this.managers.get(manager.view) === manager) {
          this.managers.delete(manager.view);
        }
      }
    };
  }

  static withNative(player, callback) {
    let manager;
    try {
      manager = this.managers.get(player.video.ownerDocument.defaultView);
    } catch {
      // A detached browsing context cannot have an active interception manager.
    }
    if (!manager) {
      return callback();
    }
    const depth = manager.bypass.get(player) || 0;
    manager.bypass.set(player, depth + 1);
    try {
      return callback();
    } finally {
      if (depth) {
        manager.bypass.set(player, depth);
      } else {
        manager.bypass.delete(player);
      }
    }
  }

  static nativeMethod(video, name) {
    try {
      let method = video[name];
      const seen = new Set();
      while (this.wrappers.has(method) && !seen.has(method)) {
        seen.add(method);
        method = this.wrappers.get(method);
      }
      return typeof method === 'function' ? method : null;
    } catch {
      return null;
    }
  }

  constructor(view) {
    this.view = view;
    this.doc = view.document;
    this.players = new Set();
    this.counts = new WeakMap();
    this.bypass = new WeakMap();
    this.routing = new Set();
    this.hooks = [];
    this.consumedEvents = new WeakSet();
    this.stopped = false;
    for (const [constructor, names] of [
      ['Element', ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen']],
      [
        'HTMLVideoElement',
        ['webkitEnterFullscreen', 'webkitEnterFullScreen', 'webkitSetPresentationMode'],
      ],
    ]) {
      try {
        const prototype = view[constructor]?.prototype;
        for (const name of names) {
          this.hook(prototype, name);
        }
      } catch {
        // A page-replaced constructor must not leak a partially installed manager.
      }
    }
  }

  hook(prototype, name) {
    try {
      let target = prototype;
      let descriptor;
      while (target) {
        descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (descriptor) {
          break;
        }
        target = Object.getPrototypeOf(target);
      }
      if (
        typeof descriptor?.value !== 'function' ||
        (!descriptor.configurable && !descriptor.writable) ||
        this.hooks.some((hook) => hook.target === target && hook.name === name)
      ) {
        return;
      }
      const manager = this;
      const original = descriptor.value;
      function wrapper(...args) {
        const owner =
          name !== 'webkitSetPresentationMode' || args[0] === 'fullscreen'
            ? manager.ownerFor(this)
            : null;
        if (!owner) {
          return Reflect.apply(original, this, args);
        }
        if (!manager.consumeIntent()) {
          return name === 'requestFullscreen'
            ? manager.view.Promise.reject(
                new manager.view.DOMException(
                  'Fullscreen requires a current user gesture.',
                  'NotAllowedError'
                )
              )
            : undefined;
        }
        let opened;
        try {
          if (manager.routing.has(owner)) {
            opened = true;
          } else {
            manager.routing.add(owner);
            try {
              opened = owner.open({ fullscreen: true }) === true;
            } finally {
              manager.routing.delete(owner);
            }
          }
        } catch (error) {
          if (name === 'requestFullscreen') {
            return manager.view.Promise.reject(error);
          }
          throw error;
        }
        if (name === 'requestFullscreen') {
          return opened
            ? manager.view.Promise.resolve()
            : manager.view.Promise.reject(
                new manager.view.DOMException('StayFast player could not open.', 'NotAllowedError')
              );
        }
        return undefined;
      }
      Object.defineProperty(target, name, { ...descriptor, value: wrapper });
      this.hooks.push({ target, name, descriptor, wrapper });
      IOSPlayerTakeover.wrappers.set(wrapper, original);
    } catch {
      // Missing, throwing and immutable browser/page descriptors stay untouched.
    }
  }

  trustedGesture(event) {
    // Site handlers may replace the clicked icon/button before requesting entry.
    // Current dispatch and document identity remain valid after its detachment.
    return Boolean(
      event?.isTrusted === true &&
      (event.type === 'click' || event.type === 'keydown') &&
      event.eventPhase >= 1 &&
      event.eventPhase <= 3 &&
      (event.target === this.view ||
        event.target === this.doc ||
        event.target?.ownerDocument === this.doc)
    );
  }

  consumeIntent() {
    try {
      // Only the currently dispatching trusted event can grant takeover. Sticky
      // userActivation or a saved gesture must not authorize a later page task.
      const current = this.view.event;
      if (!this.trustedGesture(current) || this.consumedEvents.has(current)) {
        return false;
      }
      const activation = this.view.navigator.userActivation;
      if (activation !== undefined && activation !== null && activation.isActive !== true) {
        return false;
      }
      this.consumedEvents.add(current);
      return true;
    } catch {
      return false;
    }
  }

  ownerFor(target) {
    if (this.stopped) {
      return null;
    }
    try {
      if (
        !target?.isConnected ||
        target.ownerDocument !== this.doc ||
        target === this.doc.body ||
        target === this.doc.documentElement
      ) {
        return null;
      }
      let owner = null;
      for (const player of this.players) {
        // Wrapper fullscreen must reach the real browser API, not re-enter open.
        if (target === player.ui?.screen || target === player.ui?.host) {
          return null;
        }
        if (
          player.disposed ||
          !player.attached ||
          !player.video.isConnected ||
          player.video.ownerDocument !== this.doc ||
          player.video.vsc?.iosPlayer !== player ||
          !window.VSC.IOSPlayer.isSupported(player.video) ||
          window.VSC.IOSPlayer.siteRelinquished.has(player.video)
        ) {
          continue;
        }
        if (target !== player.video && !target.contains(player.video)) {
          continue;
        }
        if (this.bypass.has(player) || owner) {
          return null;
        }
        owner = player;
      }
      if (owner && target !== owner.video) {
        const videos = target.querySelectorAll('video');
        if (videos.length !== 1 || videos[0] !== owner.video) {
          return null;
        }
      }
      return owner;
    } catch {
      return null;
    }
  }

  cleanup() {
    this.stopped = true;
    for (const { target, name, descriptor, wrapper } of this.hooks.splice(0).reverse()) {
      try {
        const current = Object.getOwnPropertyDescriptor(target, name);
        if (
          current?.value === wrapper &&
          current.configurable === descriptor.configurable &&
          current.writable === descriptor.writable &&
          current.enumerable === descriptor.enumerable
        ) {
          Object.defineProperty(target, name, descriptor);
        }
      } catch {
        // Never overwrite a newer site edit or interrupt remaining cleanup.
      }
    }
    this.routing.clear();
  }
}

window.VSC.IOSPlayerTakeover = IOSPlayerTakeover;

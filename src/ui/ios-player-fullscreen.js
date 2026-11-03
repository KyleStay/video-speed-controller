/** Optional browser fullscreen for the owned video and its controls. */
window.VSC = window.VSC || {};

class IOSPlayerFullscreen {
  static boundaryRequests = new WeakMap();

  constructor(owner) {
    this.owner = owner;
    this.inPlace = Boolean(owner.nativeBoundary);
    this.ui = owner.ui;
    this.target = this.ui.screen;
    this.doc = owner.doc;
    this.view = owner.view;
    this.session = owner.session;
    this.nativeGeneration = owner.nativeGeneration;
    this.root = this.doc.documentElement;
    this.mountParent = this.ui.host.parentNode;
    this.mountNext = this.ui.host.nextSibling;
    try {
      const boundary =
        owner.nativeBoundary || window.VSC.TwitterMP4Playback?.fullscreenBoundary?.(owner.video);
      if (
        boundary?.element?.ownerDocument === this.doc &&
        boundary.element !== this.doc.body &&
        boundary.element !== this.root &&
        typeof boundary.current === 'function' &&
        typeof boundary.activate === 'function' &&
        boundary.current()
      ) {
        this.boundary = boundary;
        this.target = boundary.element;
      }
    } catch {
      // Unknown site structure retains the ordinary owned fullscreen target.
    }
    this.disposed = false;
    this.pending = false;
    this.exitPending = false;
    this.wasOwned = false;
    this.scrollSnapshot = null;
    this.exitScrollSnapshot = null;
    this.scrollRemovers = [];
    this.entryRepaired = false;
    this.removers = [];
    const changed = () => this.changed();
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      this.listen(this.doc, type, changed);
    }
    const resize = () => {
      if (this.current()) {
        this.position();
      }
    };
    this.listen(this.view, 'resize', resize);
    this.updateButton();
  }

  listen(target, type, callback) {
    try {
      target.addEventListener(type, callback);
      this.removers.push(() => {
        try {
          target.removeEventListener(type, callback);
        } catch {
          // A removed browsing context must not interrupt other cleanup.
        }
      });
    } catch {
      // Unavailable event APIs cannot strand the owned viewport.
    }
  }

  current() {
    try {
      return (
        !this.disposed &&
        !this.owner.disposed &&
        this.owner.active &&
        this.owner.ui === this.ui &&
        this.owner.session === this.session &&
        this.owner.nativeGeneration === this.nativeGeneration &&
        this.ui.host.isConnected &&
        this.target.isConnected &&
        (!this.boundary ||
          (this.boundary.current() &&
            this.ui.host.parentNode === (this.mounted ? this.target : this.mountParent)))
      );
    } catch {
      return false;
    }
  }

  position() {
    try {
      this.owner.position();
    } catch {
      // Layout repair must not reject an otherwise successful browser request.
    }
  }

  api() {
    try {
      if (
        (this.boundary &&
          typeof (
            this.doc.exitFullscreen ||
            this.doc.webkitExitFullscreen ||
            this.doc.webkitCancelFullScreen
          ) !== 'function') ||
        this.doc.fullscreenEnabled === false ||
        this.doc.webkitFullscreenEnabled === false ||
        (this.doc.permissionsPolicy || this.doc.featurePolicy)?.allowsFeature?.('fullscreen') ===
          false
      ) {
        return null;
      }
      for (const [enabled, name] of [
        ['fullscreenEnabled', 'requestFullscreen'],
        ['webkitFullscreenEnabled', 'webkitRequestFullscreen'],
        ['webkitFullscreenEnabled', 'webkitRequestFullScreen'],
      ]) {
        const method = this.target[name];
        if (this.doc[enabled] === true && typeof method === 'function') {
          return method;
        }
      }
    } catch {
      // Page accessors and permissions APIs can fail independently of playback.
    }
    return null;
  }

  available() {
    return this.current() && this.api() !== null;
  }

  owns() {
    try {
      if (
        this.boundary &&
        (!this.request ||
          IOSPlayerFullscreen.boundaryRequests.get(this.target) !== this.request ||
          (!this.inPlace && !this.boundary.current()) ||
          (this.inPlace &&
            (this.doc.documentElement !== this.root ||
              this.owner.ui !== this.ui ||
              this.owner.session !== this.session)))
      ) {
        return false;
      }
      const documents = [this.doc.fullscreenElement, this.doc.webkitFullscreenElement].filter(
        Boolean
      );
      // Never exit a newer session or an unrelated page's presentation.
      if (
        documents.some(
          (element) => element !== this.target && (this.boundary || element !== this.ui.host)
        )
      ) {
        return false;
      }
      return (
        documents.length > 0 ||
        this.ui.shadow.fullscreenElement === this.target ||
        this.ui.shadow.webkitFullscreenElement === this.target
      );
    } catch {
      return false;
    }
  }

  restoreMount() {
    if (!this.boundary) {
      return;
    }
    if (IOSPlayerFullscreen.boundaryRequests.get(this.target) === this.request) {
      IOSPlayerFullscreen.boundaryRequests.delete(this.target);
    }
    this.request = null;
    try {
      if (
        this.mounted &&
        this.ui.host.isConnected &&
        this.ui.host.parentNode === this.target &&
        this.doc.documentElement === this.root &&
        this.mountParent?.isConnected &&
        !(this.owner.active && this.owner.ui === this.ui && this.owner.session !== this.session)
      ) {
        this.mountParent.insertBefore(
          this.ui.host,
          this.mountNext?.parentNode === this.mountParent ? this.mountNext : null
        );
      }
    } catch {
      // Never reacquire a UI removed or moved by the site.
    }
    this.mounted = false;
  }

  cancelScroll(snapshot = this.scrollSnapshot) {
    try {
      snapshot?.cancel();
    } catch {
      // The original scheduling window may already be unavailable.
    }
  }

  repairScroll(snapshot = this.scrollSnapshot) {
    try {
      snapshot?.restore();
    } catch {
      // Scroll repair is bounded and must never prevent presentation changes.
    }
  }

  captureScroll() {
    try {
      const origin = this.owner.anchor?.isConnected ? this.owner.anchor : this.owner.video;
      return new window.VSC.IOSPlayerScrollState(origin, true);
    } catch {
      return null;
    }
  }

  clearScrollGuards() {
    for (const remove of this.scrollRemovers.splice(0)) {
      try {
        remove();
      } catch {
        // Continue through unavailable ancestor windows.
      }
    }
  }

  cancelScrollRepair() {
    this.cancelScroll();
    this.cancelScroll(this.exitScrollSnapshot);
    this.scrollSnapshot = null;
    this.exitScrollSnapshot = null;
    this.clearScrollGuards();
  }

  guardScrollIntent(snapshot) {
    this.clearScrollGuards();
    // The supplied snapshot contains only previously accessible ancestors.
    const windows = new Set([this.view, ...(snapshot?.entries || []).map((item) => item.view)]);
    const cancel = () => this.cancelScrollRepair();
    for (const view of windows) {
      for (const type of [
        'wheel',
        'touchstart',
        'pointerdown',
        'keydown',
        'pagehide',
        'popstate',
      ]) {
        try {
          view.addEventListener(type, cancel, { capture: true, passive: true });
          this.scrollRemovers.push(() => view.removeEventListener(type, cancel, true));
        } catch {
          // An inaccessible ancestor grants no additional scrolling authority.
        }
      }
    }
  }

  closeInPlace() {
    if (
      this.owner.nativeBoundary &&
      this.owner.active &&
      this.owner.ui === this.ui &&
      this.owner.session === this.session
    ) {
      this.owner.close();
      return true;
    }
    return false;
  }

  changed() {
    const owned = this.owns();
    if (!owned && this.wasOwned && this.closeInPlace()) {
      return;
    }
    if (this.boundary && !owned && this.wasOwned) {
      this.restoreMount();
    }
    if (!this.current()) {
      if (owned) {
        this.exit(false);
      } else if (!this.pending) {
        this.restoreMount();
      }
      return;
    }
    if (owned && !this.entryRepaired) {
      this.entryRepaired = true;
      this.repairScroll();
    } else if (!owned && this.wasOwned) {
      // A browser exit has no reliable pre-exit capture. Never replay entry
      // offsets over newer page/site intent. Only an explicit exit owns repair.
      this.cancelScroll();
      this.scrollSnapshot = null;
      this.clearScrollGuards();
      this.repairScroll(this.exitScrollSnapshot);
    }
    this.wasOwned = owned;
    this.position();
    this.updateButton();
  }

  failure(message) {
    if (this.current()) {
      try {
        this.ui.refs.status.textContent = message;
      } catch {
        // A site can remove the status surface during presentation changes.
      }
      this.updateButton();
    }
  }

  enter(scrollSnapshot = null) {
    if (!this.available()) {
      this.cancelScroll(scrollSnapshot);
      this.closeInPlace();
      return false;
    }
    if (this.owns() || this.pending) {
      if (scrollSnapshot !== this.scrollSnapshot) {
        this.cancelScroll(scrollSnapshot);
      }
      return true;
    }
    this.cancelScrollRepair();
    this.scrollSnapshot = scrollSnapshot || this.captureScroll();
    this.guardScrollIntent(this.scrollSnapshot);
    this.entryRepaired = false;
    this.pending = true;
    try {
      if (this.boundary) {
        if (
          this.doc.fullscreenElement ||
          this.doc.webkitFullscreenElement ||
          (!this.owner.video.paused && !this.boundary.activate())
        ) {
          throw new Error('Site fullscreen ownership changed');
        }
        // Keep X's observed player and retained producer in the real fullscreen
        // subtree. Only our UI moves; the site's media and ancestors stay put.
        this.target.append(this.ui.host);
        this.mounted = true;
        if (!this.current()) {
          throw new Error('Site player changed');
        }
        this.request = {};
        IOSPlayerFullscreen.boundaryRequests.set(this.target, this.request);
      }
      // Stay in the original gesture; do not await frame expansion or playback.
      const invoke = () => this.api().call(this.target);
      const result = window.VSC.IOSPlayerTakeover?.withNative
        ? window.VSC.IOSPlayerTakeover.withNative(this.owner, invoke)
        : invoke();
      Promise.resolve(result)
        .then(
          () => {
            this.pending = false;
            if (!this.owns()) {
              this.restoreMount();
            }
            if (!this.owns() && this.closeInPlace()) {
              return;
            }
            if (this.current()) {
              this.changed();
            } else if (this.owns()) {
              this.exit(false);
            }
          },
          () => {
            this.pending = false;
            this.restoreMount();
            if (this.closeInPlace()) {
              return;
            }
            if (this.current()) {
              this.repairScroll();
              this.failure('Full screen is unavailable. Continue in this player.');
            }
          }
        )
        .catch(() => {});
      return true;
    } catch {
      this.pending = false;
      this.restoreMount();
      this.repairScroll();
      if (!this.closeInPlace()) {
        this.failure('Full screen is unavailable. Continue in this player.');
      }
      return false;
    }
  }

  exit(explicit) {
    if (
      !this.owns() ||
      this.exitPending ||
      (this.owner.active && this.owner.ui === this.ui && this.owner.session !== this.session)
    ) {
      return false;
    }
    try {
      const method =
        this.doc.exitFullscreen || this.doc.webkitExitFullscreen || this.doc.webkitCancelFullScreen;
      if (typeof method !== 'function') {
        return false;
      }
      this.exitPending = true;
      const result = method.call(this.doc);
      Promise.resolve(result)
        .then(
          () => {
            this.exitPending = false;
            if (!this.owns()) {
              this.restoreMount();
            }
            if (this.current()) {
              this.changed();
            }
          },
          () => {
            this.exitPending = false;
            if (explicit) {
              this.cancelScrollRepair();
              this.failure('Use the browser control to leave full screen.');
            }
          }
        )
        .catch(() => {});
      return true;
    } catch {
      this.exitPending = false;
      if (explicit) {
        this.cancelScrollRepair();
        this.failure('Use the browser control to leave full screen.');
      }
      return false;
    }
  }

  toggle() {
    if (!this.current()) {
      return false;
    }
    if (this.owns()) {
      if (this.exitPending) {
        return false;
      }
      this.cancelScrollRepair();
      this.exitScrollSnapshot = this.captureScroll();
      this.guardScrollIntent(this.exitScrollSnapshot);
      const exiting = this.exit(true);
      if (!exiting) {
        this.cancelScrollRepair();
      }
      return exiting;
    }
    return this.enter();
  }

  updateButton() {
    if (!this.current()) {
      return;
    }
    try {
      const button = this.ui.refs.fullscreen;
      const owned = this.owns();
      button.hidden = !owned && !this.available();
      if (this.ui.setIcon) {
        this.ui.setIcon(button, owned ? 'contract' : 'expand');
      } else {
        window.VSC.ShadowDOMManager.setControlIcon(button, owned ? 'contract' : 'expand');
      }
      button.setAttribute('aria-label', owned ? 'Exit full screen' : 'Full screen');
      button.setAttribute('aria-pressed', String(owned));
    } catch {
      // Optional chrome must not prevent media cleanup or fullscreen settlement.
    }
  }

  cleanup() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const remove of this.removers.splice(0)) {
      remove();
    }
    this.cancelScrollRepair();
    this.exit(false);
    // A pending successful entry still owns its late completion and will exit
    // there. A newer fullscreen instance replaces the target's request token.
    if (!this.pending && !this.owns()) {
      this.restoreMount();
    }
  }
}

window.VSC.IOSPlayerFullscreen = IOSPlayerFullscreen;

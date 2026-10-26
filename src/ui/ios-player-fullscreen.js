/** Optional browser fullscreen for the owned video and its controls. */
window.VSC = window.VSC || {};

class IOSPlayerFullscreen {
  constructor(owner) {
    this.owner = owner;
    this.ui = owner.ui;
    this.target = this.ui.screen;
    this.doc = owner.doc;
    this.view = owner.view;
    this.session = owner.session;
    this.nativeGeneration = owner.nativeGeneration;
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
        this.target.isConnected
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
      const documents = [this.doc.fullscreenElement, this.doc.webkitFullscreenElement].filter(
        Boolean
      );
      // Never exit a newer session or an unrelated page's presentation.
      if (documents.some((element) => element !== this.target && element !== this.ui.host)) {
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

  changed() {
    const owned = this.owns();
    if (!this.current()) {
      if (owned) {
        this.exit(false);
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
      // Stay in the original gesture; do not await frame expansion or playback.
      const result = this.api().call(this.target);
      Promise.resolve(result)
        .then(
          () => {
            this.pending = false;
            if (this.current()) {
              this.changed();
            } else if (this.owns()) {
              this.exit(false);
            }
          },
          () => {
            this.pending = false;
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
      this.repairScroll();
      this.failure('Full screen is unavailable. Continue in this player.');
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
      window.VSC.ShadowDOMManager.setControlIcon(button, owned ? 'contract' : 'expand');
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
  }
}

window.VSC.IOSPlayerFullscreen = IOSPlayerFullscreen;

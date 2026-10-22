/** Own the iOS presentation while retaining the site's original media session. */
window.VSC = window.VSC || {};

// Comparing against the rendered DOM also repairs external edits without a
// second state cache. Avoid replacing unchanged text nodes on every clock tick.
function setControlProperty(element, property, value) {
  if (element[property] !== value) {
    element[property] = value;
  }
}
function setControlAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

class IOSPlayer {
  static activePlayers = new WeakMap();
  static siteRelinquished = new WeakSet();
  static sequence = 0;
  static presentationRevision = 0;

  static isSupported(video) {
    const nav = video?.ownerDocument?.defaultView?.navigator;
    return Boolean(
      video?.tagName === 'VIDEO' &&
      nav &&
      (/iPhone|iPad|iPod/.test(nav.userAgent) ||
        (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1))
    );
  }

  static isIOS(view) {
    return IOSPlayer.isSupported({ tagName: 'VIDEO', ownerDocument: view.document });
  }

  constructor(controller) {
    this.controller = controller;
    this.video = controller.video;
    this.doc = this.video.ownerDocument;
    this.view = this.doc.defaultView;
    this.active = false;
    this.attached = false;
    this.disposed = false;
    this.dismissed = false;
    this.listeners = [];
    this.activeListeners = [];
    this.attributes = new Map();
    this.inlineAttributes = new Map();
    this.inlineUnavailable = false;
    this.nativeMethods = new Map();
    this.nativeGeneration = 0;
    this.styles = [];
    this.fit = 'contain';
    this.remaining = false;
    this.attributeConflicts = 0;
    this.token = `stayfast-${Date.now()}-${++IOSPlayer.sequence}`;
  }

  listen(target, type, callback, active = false, options) {
    target.addEventListener(type, callback, options);
    (active ? this.activeListeners : this.listeners).push(() =>
      target.removeEventListener(type, callback, options)
    );
  }

  attach() {
    if (this.attached || this.disposed || !IOSPlayer.isSupported(this.video)) {
      return false;
    }
    this.attached = true;
    this.enableInlinePlayback();
    this.captureNativeFullscreenMethods();
    this.releaseTakeover = window.VSC.IOSPlayerTakeover?.register(this);
    this.prepareMedia();

    this.button = this.doc.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'Custom player';
    this.button.setAttribute('aria-label', 'Open StayFast player');
    this.button.style.cssText = 'min-width:44px;min-height:44px;';
    this.controller.div?.shadowRoot?.querySelector('#controls')?.append(this.button);
    this.listen(this.button, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.open({ play: true });
    });

    for (const type of [
      'timeupdate',
      'durationchange',
      'progress',
      'loadedmetadata',
      'ratechange',
      'play',
      'pause',
      'ended',
      'volumechange',
      'waiting',
      'playing',
      'error',
    ]) {
      this.listen(this.video, type, () => {
        if (this.active) {
          this.update();
          if (type === 'waiting') {
            this.ui.refs.status.textContent = 'Loading…';
          } else if (type === 'playing') {
            this.ui.refs.status.textContent = '';
            this.showControls();
          } else if (type === 'error') {
            this.ui.refs.status.textContent =
              'Playback unavailable. You can return to the site player.';
          }
        }
      });
    }
    const sourceReset = () => {
      // A verified rendition change retains this exact clip and presentation.
      // Site replacements still invalidate every old-resource resume/scroll flag.
      if (this.controller.safariPlayback?.ownsTransition()) {
        return;
      }
      // Feeds reuse media nodes. Presentation and scroll restoration belong to
      // the old resource, never to the next item loaded into the same element.
      this.nativeGeneration++;
      this.resumeAfterPip = false;
      this.resumeOnShow = false;
      this.nativeScroll?.cancel();
      this.nativeScroll = null;
      this.scrollRestore?.cancel();
      this.close();
      this.releaseMediaOwnership();
      this.nativeSession = false;
      this.dismissed = false;
      IOSPlayer.siteRelinquished.delete(this.video);
      this.inlineRelinquished = false;
      this.inlineConflicts = 0;
      this.enableInlinePlayback();
      this.prepareMedia();
    };
    this.listen(this.video, 'emptied', sourceReset);
    this.listen(this.video, 'loadstart', sourceReset);
    const nativeBegan = () => {
      this.nativeGeneration++;
      // Safari may already have moved the page when this event arrives. Only
      // enterNativeFullscreen can capture a reliable pre-entry scroll snapshot.
      this.nativeSession = true;
      this.resumeAfterPip = false;
      this.resumeOnShow = false;
      this.close();
      this.releaseMediaOwnership();
      this.scrollRestore?.cancel();
    };
    const nativeEnded = () => {
      this.nativeSession = false;
      this.nativeGeneration++;
      this.controller.repairDOMPlacement?.();
      this.restoreNativeScroll();
      this.prepareMedia();
    };
    this.listen(this.video, 'webkitbeginfullscreen', nativeBegan);
    this.listen(this.video, 'webkitendfullscreen', nativeEnded);
    this.listen(this.doc, 'fullscreenchange', () => {
      if (this.doc.fullscreenElement === this.video) {
        nativeBegan();
      } else if (this.nativeSession && !this.doc.fullscreenElement) {
        nativeEnded();
      }
    });
    const presentationChanged = () => {
      const mode = this.video.webkitPresentationMode;
      if (mode === 'fullscreen') {
        nativeBegan();
        return;
      }
      if (this.nativeSession) {
        if (mode === 'inline') {
          nativeEnded();
        }
        return;
      }
      const pip = mode === 'picture-in-picture' || this.doc.pictureInPictureElement === this.video;
      if (pip) {
        // WebKit may report one PiP entry through two different events.
        if (this.active) {
          this.resumeAfterPip = true;
        }
        this.close();
        this.releaseMediaOwnership();
      } else if (this.resumeAfterPip) {
        this.resumeAfterPip = false;
        this.open({ automatic: true });
      } else {
        this.prepareMedia();
      }
    };
    this.listen(this.video, 'webkitpresentationmodechanged', presentationChanged);
    this.listen(this.video, 'enterpictureinpicture', presentationChanged);
    this.listen(this.video, 'leavepictureinpicture', presentationChanged);
    this.listen(this.view, 'pagehide', () => {
      this.resumeOnShow = this.active;
      this.close({ settle: false });
      this.scrollRestore?.cancel();
      this.nativeScroll?.cancel();
      this.nativeScroll = null;
    });
    this.listen(this.view, 'pageshow', () => {
      if (this.resumeOnShow && !this.video.paused) {
        this.resumeOnShow = false;
        this.open();
      }
    });
    return true;
  }

  setInlineAvailability(available) {
    const unavailable = !available;
    if (this.inlineUnavailable === unavailable) {
      return;
    }
    this.inlineUnavailable = unavailable;
    if (unavailable) {
      this.releaseMediaOwnership();
    } else {
      this.prepareMedia();
    }
  }

  shouldOwnInlineMedia() {
    try {
      return Boolean(
        this.attached &&
        !this.disposed &&
        (this.active || !this.inlineUnavailable) &&
        !this.nativeSession &&
        !IOSPlayer.siteRelinquished.has(this.video) &&
        !this.video.webkitDisplayingFullscreen &&
        !['fullscreen', 'picture-in-picture'].includes(this.video.webkitPresentationMode) &&
        this.doc.pictureInPictureElement !== this.video
      );
    } catch {
      return false;
    }
  }

  refreshSiteControls() {
    if (!this.mediaPrepared || !this.shouldOwnInlineMedia()) {
      return;
    }
    try {
      this.siteControls?.acquire();
    } catch {
      // Reparenting must not interrupt controller repair.
    }
  }

  setInlineOwnership(owned) {
    try {
      this.controller.controlsManager?.inlinePlayer?.setOwned(owned);
      if (owned && this.shouldOwnInlineMedia()) {
        this.siteControls ||= new window.VSC.IOSSiteControls(this.video);
        this.siteControls.acquire();
      } else {
        this.siteControls?.release();
      }
    } catch {
      // A page can replace DOM APIs; presentation cleanup must remain available.
    }
  }

  prepareMedia() {
    if (!this.shouldOwnInlineMedia()) {
      return;
    }
    this.setInlineOwnership(true);
    if (!this.shouldOwnInlineMedia()) {
      this.setInlineOwnership(false);
      return;
    }
    if (this.mediaPrepared) {
      return;
    }
    this.mediaPrepared = true;
    for (const [name, desired] of [['controls', null]]) {
      this.attributes.set(name, { original: this.video.getAttribute(name), desired });
      this.writeAttribute(name, desired);
    }
    this.attributeObserver = new this.view.MutationObserver(() => {
      for (const [name, state] of this.attributes) {
        const current = this.video.getAttribute(name);
        if (current !== state.desired) {
          if (++this.attributeConflicts > 8) {
            // A competing site observer must not create an unbounded mutation fight.
            state.original = current;
            this.cleanup();
            return;
          }
          // Remember the site's latest intent for the eventual hand-back.
          state.original = current;
          this.writeAttribute(name, state.desired);
        }
      }
    });
    this.attributeObserver.observe(this.video, {
      attributes: true,
      attributeFilter: [...this.attributes.keys()],
    });
  }

  enableInlinePlayback() {
    if (
      this.disposed ||
      this.inlineObserver ||
      this.inlineRelinquished ||
      IOSPlayer.siteRelinquished.has(this.video)
    ) {
      return;
    }
    this.inlineConflicts = 0;
    try {
      for (const name of ['playsinline', 'webkit-playsinline']) {
        const original = this.video.getAttribute(name);
        this.inlineAttributes.set(name, { original, owned: original === null });
        if (original === null) {
          this.video.setAttribute(name, '');
        }
      }
      this.inlineObserver = new this.view.MutationObserver((records) => {
        for (const [name, state] of this.inlineAttributes) {
          try {
            const current = this.video.getAttribute(name);
            if (current !== null) {
              if (
                !state.owned ||
                current !== '' ||
                records.some((record) => record.attributeName === name && record.oldValue !== null)
              ) {
                state.original = current;
                state.owned = false;
              }
              continue;
            }
            state.original = null;
            state.owned = true;
            if (++this.inlineConflicts > 8) {
              // Keep the controller usable without fighting a competing site.
              this.inlineRelinquished = true;
              this.releaseInlinePlayback();
              return;
            }
            this.video.setAttribute(name, '');
          } catch {
            this.inlineRelinquished = true;
            this.releaseInlinePlayback();
            return;
          }
        }
      });
      this.inlineObserver.observe(this.video, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [...this.inlineAttributes.keys()],
      });
    } catch {
      this.inlineRelinquished = true;
      this.releaseInlinePlayback();
    }
  }

  releaseInlinePlayback() {
    const pending = this.inlineObserver?.takeRecords() || [];
    this.inlineObserver?.disconnect();
    this.inlineObserver = null;
    for (const [name, state] of this.inlineAttributes) {
      try {
        if (
          state.owned &&
          this.video.getAttribute(name) === '' &&
          !pending.some((record) => record.attributeName === name && record.oldValue !== null)
        ) {
          this.writeAttribute(name, state.original);
        }
      } catch {
        // A site-owned attribute API must not prevent the remaining cleanup.
      }
    }
    this.inlineAttributes.clear();
  }

  writeAttribute(name, value) {
    if (value === null) {
      this.video.removeAttribute(name);
    } else {
      this.video.setAttribute(name, value);
    }
  }

  isVisible() {
    if (this.doc.visibilityState === 'hidden' || this.video.readyState < 2) {
      return false;
    }
    const rect = this.video.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < this.view.innerHeight &&
      rect.left < this.view.innerWidth
    );
  }

  captureNativeFullscreenMethods() {
    for (const name of [
      'webkitEnterFullscreen',
      'webkitEnterFullScreen',
      'webkitSetPresentationMode',
      'requestFullscreen',
    ]) {
      try {
        const method =
          window.VSC.IOSPlayerTakeover?.nativeMethod(this.video, name) || this.video[name];
        if (typeof method === 'function') {
          this.nativeMethods.set(name, method);
        }
      } catch {
        // A page can expose a throwing getter; another native entry may remain usable.
      }
    }
  }

  canEnterNativeFullscreen() {
    try {
      return (
        this.nativeMethods.size > 0 &&
        this.video.readyState >= 1 &&
        this.video.webkitSupportsFullscreen !== false
      );
    } catch {
      return false;
    }
  }

  nativeFullscreenFailed(generation, recovery = null) {
    if (this.disposed || generation !== this.nativeGeneration) {
      return;
    }
    if (recovery) {
      let current = false;
      try {
        // Only this explicit request may recover its former owned viewport.
        // Even a newer player which has since closed supersedes that intent.
        current = !(
          recovery.cancelled ||
          recovery.revision !== IOSPlayer.presentationRevision ||
          recovery.session !== this.session ||
          this.active ||
          IOSPlayer.activePlayers.has(this.doc) ||
          !this.video.isConnected ||
          this.video.ownerDocument !== this.doc ||
          this.doc.documentElement !== recovery.root ||
          this.doc.URL !== recovery.url ||
          this.video.getAttribute('src') !== recovery.src ||
          this.video.currentSrc !== recovery.currentSrc ||
          this.video.srcObject !== recovery.srcObject
        );
      } catch {
        // Unavailable source access cannot grant authority to reopen a player.
      }
      if (!current) {
        this.nativeSession = false;
        this.nativeScroll?.cancel();
        this.nativeScroll = null;
        return;
      }
    }
    recovery?.cancel?.();
    this.nativeSession = false;
    this.restoreNativeScroll();
    this.prepareMedia();
    if (recovery) {
      // Reopen only the owned viewport: no fullscreen request and no play call.
      this.open();
    }
    this.nativeFullscreenError = this.active
      ? 'Apple fullscreen is unavailable. Continue in this player.'
      : 'Apple fullscreen is unavailable. Open the StayFast player to continue.';
    if (this.active && this.ui?.refs.native) {
      this.ui.refs.native.title = this.nativeFullscreenError;
      this.ui.refs.status.textContent = this.nativeFullscreenError;
    }
    this.video.dispatchEvent(
      new this.view.CustomEvent('vsc-native-fullscreen-error', {
        detail: this.nativeFullscreenError,
      })
    );
  }

  enterNativeFullscreen() {
    if (this.disposed || !this.attached || !this.video.isConnected) {
      return false;
    }
    this.nativeRecovery?.cancel();
    IOSPlayer.presentationRevision++;
    const generation = ++this.nativeGeneration;
    if (!this.canEnterNativeFullscreen()) {
      this.nativeFullscreenFailed(generation);
      return false;
    }
    this.resumeAfterPip = false;
    this.resumeOnShow = false;
    this.nativeFullscreenError = '';
    this.button.removeAttribute('title');
    this.controller.div?.shadowRoot
      ?.querySelector('.inline-fullscreen')
      ?.removeAttribute('aria-description');
    let recovery = null;
    if (this.active) {
      try {
        recovery = {
          session: this.session,
          root: this.doc.documentElement,
          url: this.doc.URL,
          revision: IOSPlayer.presentationRevision + 1,
          src: this.video.getAttribute('src'),
          currentSrc: this.video.currentSrc,
          srcObject: this.video.srcObject,
        };
      } catch {
        // Keep native entry available, but do not infer authority to recover.
        recovery = { cancelled: true };
      }
    }
    // Restore the original node and native attributes before calling the browser.
    // No await or modal opening may consume the caller's user activation.
    this.close();
    if (recovery && !recovery.cancelled) {
      const removers = [];
      recovery.cancel = (event) => {
        if (event && !event.isTrusted) {
          return;
        }
        recovery.cancelled = true;
        for (const remove of removers.splice(0)) {
          try {
            remove();
          } catch {
            // Continue releasing guards after a browsing context disappears.
          }
        }
        if (this.nativeRecovery === recovery) {
          this.nativeRecovery = null;
        }
      };
      this.nativeRecovery = recovery;
      const cancelLifecycle = () => recovery.cancel();
      for (const [type, listener] of [
        ...['pointerdown', 'touchstart', 'keydown', 'wheel'].map((type) => [type, recovery.cancel]),
        ...['pagehide', 'popstate'].map((type) => [type, cancelLifecycle]),
      ]) {
        try {
          this.view.addEventListener(type, listener, true);
          removers.push(() => this.view.removeEventListener(type, listener, true));
        } catch {
          recovery.cancel();
          break;
        }
      }
    }
    this.scrollRestore?.cancel();
    this.nativeScroll?.cancel();
    this.nativeScroll = new window.VSC.IOSPlayerScrollState(this.video, true);
    this.releaseMediaOwnership();
    this.nativeSession = true;
    for (const [name, method] of this.nativeMethods) {
      try {
        const invoke = () =>
          method.apply(this.video, name === 'webkitSetPresentationMode' ? ['fullscreen'] : []);
        const result = window.VSC.IOSPlayerTakeover
          ? window.VSC.IOSPlayerTakeover.withNative(this, invoke)
          : invoke();
        Promise.resolve(result)
          .then(
            () => recovery?.cancel?.(),
            () => {
              try {
                this.nativeFullscreenFailed(generation, recovery);
              } finally {
                recovery?.cancel?.();
              }
            }
          )
          .catch(() => {});
        return true;
      } catch {
        // Try another saved native entry while the trusted gesture is still active.
      }
    }
    try {
      this.nativeFullscreenFailed(generation, recovery);
    } finally {
      recovery?.cancel?.();
    }
    return false;
  }

  restoreNativeScroll() {
    if (!this.nativeScroll) {
      return;
    }
    this.scrollRestore?.cancel();
    this.scrollRestore = this.nativeScroll;
    this.nativeScroll = null;
    this.scrollRestore.restore(!this.disposed);
  }

  ownStyle(node, property, value) {
    const item = {
      node,
      property,
      priority: 'important',
      original: node.style.getPropertyValue(property),
      originalPriority: node.style.getPropertyPriority(property),
    };
    node.style.setProperty(property, value, 'important');
    item.value = node.style.getPropertyValue(property);
    this.styles.push(item);
  }

  open(options = {}) {
    this.nativeRecovery?.cancel();
    IOSPlayer.presentationRevision++;
    try {
      const scroll = options.fullscreen
        ? new window.VSC.IOSPlayerScrollState(this.video, true)
        : null;
      const opened = this.openPresentation(options);
      if (opened && options.fullscreen) {
        this.ownedFullscreen.enter(scroll);
      } else {
        scroll?.cancel();
      }
      return opened;
    } catch (error) {
      // A site can replace DOM/media APIs. Roll back rather than strand playback.
      try {
        this.cleanup();
      } catch {
        /* Best effort after a hostile page API. */
      }
      this.ui?.destroy();
      this.anchor?.remove();
      this.placeholder?.remove();
      window.VSC.logger?.warn(`Owned player unavailable: ${error?.message}`);
      return false;
    }
  }

  openPresentation({ play = false, automatic = false } = {}) {
    if (this.disposed || !this.attached || !this.video.isConnected) {
      return false;
    }
    if (automatic && IOSPlayer.siteRelinquished.has(this.video)) {
      return false;
    }
    const previous = IOSPlayer.activePlayers.get(this.doc);
    // Refusing a background return must not acquire controls or attributes.
    if (previous && previous !== this && automatic) {
      return false;
    }
    if (!automatic) {
      IOSPlayer.siteRelinquished.delete(this.video);
      this.inlineRelinquished = false;
    }
    this.enableInlinePlayback();
    this.prepareMedia();
    if (this.active) {
      if (play) {
        this.play();
      }
      return true;
    }
    previous?.close();
    this.scrollRestore?.cancel();
    const inlineShadow = this.controller.div?.shadowRoot;
    if (inlineShadow) {
      this.controller.controlsManager?.setTouchExpanded(inlineShadow, false);
    }
    this.dismissed = false;
    this.originLost = false;
    this.endingOrigin = false;
    this.session = (this.session || 0) + 1;
    this.pointerInteraction = true;
    this.focusBeforeOpen = this.doc.activeElement;
    this.ui = new window.VSC.IOSPlayerView(this.doc);
    this.portalNode = this.video;
    const container = this.video.closest('.html5-video-player, .video-js, .plyr');
    if (
      container?.parentNode &&
      container.querySelectorAll('video').length === 1 &&
      !container.querySelector('iframe')
    ) {
      // Retain known players' DOM-rendered captions and their existing media parent.
      this.portalNode = container;
    }
    this.originParent = this.portalNode.parentNode;
    if (!this.originParent) {
      this.ui.destroy();
      return false;
    }
    this.pageScroll = new window.VSC.IOSPlayerScrollState(this.portalNode);
    const rect = this.portalNode.getBoundingClientRect();
    this.anchor = this.doc.createComment('StayFast player origin');
    this.placeholder = this.doc.createElement('span');
    this.placeholder.style.cssText = `display:block;width:${Math.max(0, rect.width)}px;max-width:100%;height:${Math.max(0, rect.height)}px;pointer-events:none;`;
    this.originParent.insertBefore(this.anchor, this.portalNode);
    this.originParent.insertBefore(this.placeholder, this.portalNode);
    this.originalSlot = this.portalNode.getAttribute('slot');
    this.active = true;
    // Fullscreen ownership is independent of whether inline targets could fit.
    if (!this.mediaPrepared) {
      this.prepareMedia();
    }
    IOSPlayer.activePlayers.set(this.doc, this);
    this.doc.documentElement.append(this.ui.host);
    this.portalNode.setAttribute('slot', 'media');
    this.ui.host.append(this.portalNode); // Synchronous same-document move; retain src/MSE/DRM.
    this.controlsLocked = false;
    this.ownedFullscreen = new window.VSC.IOSPlayerFullscreen(this);

    for (const [key, value] of Object.entries({
      display: 'block',
      position: 'relative',
      width: '100%',
      height: '100%',
      'max-width': 'none',
      'max-height': 'none',
      'min-width': '0',
      'min-height': '0',
      'margin-top': '0px',
      'margin-right': '0px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'padding-top': '0px',
      'padding-right': '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      transform: 'none',
      visibility: 'visible',
      opacity: '1',
    })) {
      this.ownStyle(this.portalNode, key, value);
    }
    for (const [key, value] of Object.entries({
      width: '100%',
      height: '100%',
      'object-fit': 'contain',
      'max-width': 'none',
      'max-height': 'none',
      position: this.portalNode === this.video ? 'relative' : 'absolute',
      top: '0',
      left: '0',
      transform: 'none',
      visibility: 'visible',
      opacity: '1',
    })) {
      if (
        this.portalNode !== this.video ||
        ![
          'width',
          'height',
          'position',
          'max-width',
          'max-height',
          'transform',
          'visibility',
          'opacity',
        ].includes(key)
      ) {
        this.ownStyle(this.video, key, value);
      }
    }
    // WebKit evaluates native touch gestures on the light-DOM media surface;
    // the shadow stage's touch-action does not reliably cover slotted video.
    this.ownStyle(this.video, 'touch-action', 'none');
    if (this.portalNode !== this.video) {
      this.ownStyle(this.portalNode, 'touch-action', 'none');
    }
    if (this.controller.div) {
      this.ownStyle(this.controller.div, 'display', 'none');
    }
    for (const node of [this.doc.documentElement, this.doc.body].filter(Boolean)) {
      this.ownStyle(node, 'overflow', 'hidden');
    }
    if (this.portalNode !== this.video) {
      this.siteStyle = this.doc.createElement('style');
      this.siteStyle.textContent =
        'vsc-ios-player .ytp-chrome-top,vsc-ios-player .ytp-chrome-bottom,vsc-ios-player .ytp-gradient-top,vsc-ios-player .ytp-gradient-bottom,vsc-ios-player .ytp-pause-overlay,vsc-ios-player .vjs-control-bar,vsc-ios-player .plyr__controls{display:none!important}';
      this.portalNode.append(this.siteStyle);
    }
    this.bindUI();
    this.setFit(this.fit);
    this.scrubber = new window.VSC.IOSPlayerScrubber(this);
    this.scrubber.attach();
    this.gestures = new window.VSC.IOSPlayerGestures(this);
    this.gestures.attach();
    this.watchOrigin();
    window.VSC.iosPlayerFrames?.activate(this.token);
    try {
      this.ui.dialog.showModal();
      this.ui.dialog.focus({ preventScroll: true });
    } catch {
      this.ui.dialog.setAttribute('open', '');
    }
    this.update();
    this.showControls();
    this.pageScroll.restore();
    if (play) {
      this.play();
    }
    return true;
  }

  bindUI() {
    const { refs } = this.ui;
    const click = (node, callback) =>
      this.listen(
        node,
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.controlsLocked || node === refs.unlock) {
            callback(event);
          }
          this.showControls();
        },
        true
      );
    click(refs.done, () => this.close());
    click(refs.site, () => this.restoreSitePlayer());
    click(refs.more, () => this.toggleMore(!this.moreOpen));
    this.listen(refs.seek, 'pointerdown', () => this.toggleMore(false), true);
    click(refs.play, () => {
      if (this.video.ended) {
        const bounds = this.seekBounds();
        if (bounds) {
          this.seekTo(bounds[0]);
        }
        this.play();
      } else if (this.video.paused) {
        this.play();
      } else {
        this.video.pause();
      }
    });
    click(refs.fit, () => this.setFit(this.fit === 'contain' ? 'cover' : 'contain'));
    click(refs.duration, () => {
      this.remaining = !this.remaining;
      this.update();
    });
    click(refs.live, () => {
      const bounds = this.seekBounds();
      if (bounds) {
        this.seekTo(Math.max(bounds[0], bounds[1] - 0.1));
      }
    });
    click(refs.back, () => this.seekBy(-10));
    click(refs.forward, () => this.seekBy(10));
    for (const [button, action, direction] of [
      [refs.frameBack, 'rewindFrame', -1],
      [refs.frameForward, 'advanceFrame', 1],
    ]) {
      click(button, () => {
        if (!window.VSC.ControlsManager.canStepFrame(this.video) || this.scrubber?.active) {
          return;
        }
        this.controller.actionHandler.stepFrame(
          this.video,
          direction,
          this.controller.config.getKeyBinding(action)
        );
        this.update();
      });
    }
    click(refs.mute, () => {
      this.video.muted = !this.video.muted;
    });
    click(refs.normal, () => this.controller.actionHandler.setSpeed(this.video, 1, 'user'));
    click(refs.preferred, () =>
      this.controller.actionHandler.setSpeed(this.video, this.preferredSpeed(), 'user')
    );
    click(refs.fullscreen, () => this.requestFullscreen());
    click(refs.native, () => this.enterNativeFullscreen());
    click(refs.lock, () => this.setControlsLocked(true));
    click(refs.unlock, () => this.setControlsLocked(false));
    click(refs.pip, () => {
      if (
        this.video.disablePictureInPicture ||
        this.video.hasAttribute('disablepictureinpicture')
      ) {
        return;
      }
      try {
        if (typeof this.video.webkitSetPresentationMode === 'function') {
          this.video.webkitSetPresentationMode('picture-in-picture');
        } else {
          this.video.requestPictureInPicture?.()?.catch?.(() => {});
        }
      } catch {
        /* The system may reject PiP for this media or device. */
      }
    });
    click(refs.airplay, () => {
      if (this.video.disableRemotePlayback || this.video.hasAttribute('disableremoteplayback')) {
        return;
      }
      try {
        this.video.webkitShowPlaybackTargetPicker?.();
      } catch {
        /* Optional system picker. */
      }
    });
    this.listen(
      refs.speed,
      'change',
      () => {
        if (refs.speed.value === 'custom') {
          this.toggleMore(false);
          refs.customSpeedGroup.hidden = false;
          refs.customSpeed.value = String(this.video.playbackRate);
          refs.customSpeed.focus();
        } else {
          this.applySpeed(Number(refs.speed.value));
        }
        this.showControls();
      },
      true
    );
    click(refs.customSpeedApply, () => this.applySpeed(Number(refs.customSpeed.value)));
    this.listen(
      refs.customSpeed,
      'keydown',
      (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.applySpeed(Number(refs.customSpeed.value));
        }
      },
      true
    );
    this.listen(
      refs.seek,
      'change',
      () => {
        if (!this.scrubber?.active) {
          this.seekTo(Number(refs.seek.value));
        }
      },
      true
    );
    this.listen(
      refs.seek,
      'input',
      () => {
        if (!this.scrubber?.active) {
          this.seekTo(Number(refs.seek.value));
        }
      },
      true
    );
    this.listen(
      refs.captions,
      'change',
      () => {
        for (const [index, track] of this.captionTracks().entries()) {
          track.mode = String(index) === refs.captions.value ? 'showing' : 'disabled';
        }
        this.showControls();
      },
      true
    );
    this.listen(
      refs.audio,
      'change',
      () => {
        const selected = Number(refs.audio.value);
        const tracks = this.audioTracks();
        if (Number.isInteger(selected) && selected >= 0 && selected < tracks.length) {
          tracks.forEach((track, index) => {
            track.enabled = index === selected;
          });
        }
        this.update();
      },
      true
    );
    this.listen(
      refs.volume,
      'input',
      () => {
        const value = Number(refs.volume.value);
        if (Number.isFinite(value) && value >= 0 && value <= 1 && this.canSetVolume()) {
          try {
            this.video.volume = value;
            this.video.muted = value === 0;
          } catch {
            /* System locked volume. */
          }
        }
        this.showControls();
      },
      true
    );
    try {
      const audio = this.video.audioTracks;
      if (audio?.addEventListener) {
        for (const type of ['addtrack', 'removetrack', 'change']) {
          this.listen(audio, type, () => this.update(), true);
        }
      }
    } catch {
      /* Site-owned audio selection remains available through handback. */
    }
    const tracks = this.video.textTracks;
    if (tracks?.addEventListener) {
      for (const event of ['addtrack', 'removetrack', 'change']) {
        this.listen(tracks, event, () => this.update(), true);
      }
    }
    // Site players can handle touchend independently of synthesized clicks.
    // Keep their handlers out of our display surface without cancelling Safari's
    // default touch-to-click behavior used to reveal the owned HUD.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      this.listen(this.ui.stage, type, (event) => event.stopPropagation(), true, {
        capture: true,
        passive: true,
      });
    }
    this.listen(
      this.ui.stage,
      'click',
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.controlsLocked) {
          return;
        }
        if (this.gestures?.active || this.gestures?.suppressClick) {
          if (this.gestures) {
            this.gestures.suppressClick = false;
          }
          return;
        }
        if (this.moreOpen) {
          this.toggleMore(false);
          this.showControls();
          return;
        }
        if (this.ui.host.hasAttribute('data-controls-hidden')) {
          this.showControls();
        } else {
          this.ui.shadow.activeElement?.blur();
          this.ui.host.setAttribute('data-controls-hidden', '');
        }
      },
      true,
      true
    );
    this.listen(
      this.ui.stage,
      'dblclick',
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (
          this.controlsLocked ||
          this.gestures?.active ||
          this.gestures?.suppressClick ||
          this.gestures?.consumeDoubleClick(event)
        ) {
          return;
        }
        const rect = this.ui.stage.getBoundingClientRect();
        this.seekBy(event.clientX < rect.left + rect.width / 2 ? -10 : 10);
        this.showControls();
      },
      true
    );
    this.listen(
      this.ui.shadow,
      'pointerdown',
      (event) => {
        if (!event.composedPath().includes(this.ui.stage)) {
          this.pointerInteraction = true;
          this.showControls();
        }
      },
      true
    );
    this.listen(
      this.ui.shadow,
      'keydown',
      (event) => {
        this.pointerInteraction = false;
        if (event.key === 'Escape' && this.controlsLocked) {
          event.preventDefault();
          event.stopPropagation();
          this.setControlsLocked(false);
        } else if (event.key === 'Escape' && !refs.customSpeedGroup.hidden) {
          event.preventDefault();
          event.stopPropagation();
          refs.customSpeedGroup.hidden = true;
          refs.speed.focus();
        } else if (event.key === 'Escape' && this.moreOpen) {
          event.preventDefault();
          event.stopPropagation();
          this.toggleMore(false);
          this.ui.refs.more.focus();
        }
      },
      true
    );
    this.listen(
      this.ui.shadow,
      'focusout',
      () => {
        // Safari can deliver blur after a stage tap has deliberately hidden the HUD.
        if (!this.ui.host.hasAttribute('data-controls-hidden')) {
          this.showControls();
        }
      },
      true
    );
    this.listen(
      this.ui.dialog,
      'cancel',
      (event) => {
        event.preventDefault();
        if (this.controlsLocked) {
          this.setControlsLocked(false);
        } else {
          this.close();
        }
      },
      true
    );
    this.listen(
      this.ui.dialog,
      'close',
      () => {
        if (this.active) {
          this.close();
        }
      },
      true
    );
    this.listen(this.view, 'resize', () => this.position(), true);
    if (this.view.visualViewport) {
      this.listen(this.view.visualViewport, 'resize', () => this.position(), true);
      this.listen(this.view.visualViewport, 'scroll', () => this.position(), true);
    }
    this.ownedFullscreen.updateButton();
    refs.airplay.hidden =
      this.video.disableRemotePlayback ||
      this.video.hasAttribute('disableremoteplayback') ||
      typeof this.video.webkitShowPlaybackTargetPicker !== 'function';
    try {
      const webkitPip =
        typeof this.video.webkitSetPresentationMode === 'function' &&
        this.video.webkitSupportsPresentationMode?.('picture-in-picture');
      const standardPip =
        this.doc.pictureInPictureEnabled &&
        typeof this.video.requestPictureInPicture === 'function';
      refs.pip.hidden =
        this.video.disablePictureInPicture ||
        this.video.hasAttribute('disablepictureinpicture') ||
        (!webkitPip && !standardPip);
    } catch {
      refs.pip.hidden = true;
    }
    this.position();
  }

  position() {
    if (!this.active) {
      return;
    }
    const viewport = this.view.visualViewport;
    this.ui.dialog.style.width = `${viewport?.width || this.view.innerWidth}px`;
    const height = viewport?.height || this.view.innerHeight;
    this.ui.dialog.style.height = `${height}px`;
    this.ui.host.style.setProperty('--stayfast-viewport-height', `${height}px`);
    this.ui.dialog.style.left = `${viewport?.offsetLeft || 0}px`;
    this.ui.dialog.style.top = `${viewport?.offsetTop || 0}px`;
  }

  watchOrigin() {
    this.originObserver = new this.view.MutationObserver(() => {
      if (
        this.active &&
        !this.endingOrigin &&
        (!this.anchor.isConnected ||
          !this.ui.host.isConnected ||
          this.portalNode.parentNode !== this.ui.host ||
          !this.video.isConnected ||
          !this.portalNode.contains(this.video))
      ) {
        this.endingOrigin = true;
        this.originObserver.disconnect();
        this.originLost = !this.anchor.isConnected;
        const relocated =
          this.video.isConnected &&
          (this.portalNode.parentNode !== this.ui.host || !this.portalNode.contains(this.video));
        if (relocated) {
          IOSPlayer.siteRelinquished.add(this.video);
        }
        if (this.originLost || !this.video.isConnected || !this.ui.host.isConnected) {
          try {
            this.video.pause();
          } catch {
            /* Stop an abandoned site session where possible. */
          }
        }
        this.close();
        if (relocated) {
          this.releaseMediaOwnership();
        } else {
          this.controller.remove?.();
        }
      }
    });
    this.originObserver.observe(this.doc, { childList: true, subtree: true });
    const root = this.anchor.getRootNode();
    if (root !== this.doc) {
      this.originObserver.observe(root, { childList: true, subtree: true });
    }
  }

  play() {
    const session = this.session;
    const ui = this.ui;
    try {
      const result = this.video.play();
      Promise.resolve(result).catch(() => {
        if (this.active && this.session === session && this.ui === ui) {
          this.ui.refs.status.textContent = 'Tap Play to continue playback.';
          this.update();
          this.showControls();
        }
      });
    } catch {
      if (this.active) {
        this.ui.refs.status.textContent = 'Tap Play to continue playback.';
      }
    }
  }

  requestFullscreen() {
    return this.ownedFullscreen?.toggle() ?? false;
  }

  setControlsLocked(locked) {
    if (!this.active) {
      return false;
    }
    this.controlsLocked = Boolean(locked);
    const { refs } = this.ui;
    this.ui.host.toggleAttribute('data-controls-locked', this.controlsLocked);
    this.ui.shadow.querySelector('.hud').inert = this.controlsLocked;
    refs.lock.setAttribute('aria-pressed', String(this.controlsLocked));
    refs.unlock.hidden = !this.controlsLocked;
    if (this.controlsLocked) {
      this.view.clearTimeout(this.hideTimer);
      this.hideTimer = null;
      this.clearSeekFeedback();
      this.scrubber?.cleanup();
      this.gestures?.cleanup();
      this.ui.host.setAttribute('data-controls-hidden', '');
      refs.unlock.focus({ preventScroll: true });
    } else {
      this.scrubber?.attach();
      this.gestures?.attach();
      this.update();
      this.showControls();
      refs.lock.focus({ preventScroll: true });
    }
    return true;
  }

  clearSeekFeedback() {
    this.view.clearTimeout(this.seekFeedbackTimer);
    this.seekFeedbackTimer = null;
    this.seekFeedbackTotal = 0;
    if (this.ui?.refs.seekFeedback) {
      this.ui.refs.seekFeedback.hidden = true;
    }
  }

  showSeekFeedback(delta) {
    if (!this.active || this.controlsLocked || !Number.isFinite(delta) || delta === 0) {
      return;
    }
    const direction = Math.sign(delta);
    this.seekFeedbackTotal =
      Math.sign(this.seekFeedbackTotal) === direction ? this.seekFeedbackTotal + delta : delta;
    const feedback = this.ui.refs.seekFeedback;
    feedback.dataset.side = direction < 0 ? 'left' : 'right';
    feedback.textContent = `${this.seekFeedbackTotal < 0 ? '−' : '+'}${Number(Math.abs(this.seekFeedbackTotal).toFixed(1))}s`;
    feedback.hidden = false;
    this.view.clearTimeout(this.seekFeedbackTimer);
    const session = this.session;
    this.seekFeedbackTimer = this.view.setTimeout(() => {
      if (this.active && this.session === session) {
        this.clearSeekFeedback();
      }
    }, 800);
  }

  seekBounds() {
    if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
      return [0, this.video.duration];
    }
    try {
      const ranges = this.video.seekable;
      if (ranges?.length) {
        return [ranges.start(0), ranges.end(ranges.length - 1)];
      }
    } catch {
      /* Live seek ranges can change during a read. */
    }
    return null;
  }

  seekTo(value) {
    if (this.controlsLocked) {
      return;
    }
    const bounds = this.seekBounds();
    if (!bounds || !Number.isFinite(value)) {
      return;
    }
    const target = Math.max(bounds[0], Math.min(bounds[1], value));
    this.controller.actionHandler.seek(this.video, target - this.video.currentTime);
    this.showControls();
  }

  seekBy(delta) {
    const before = this.video.currentTime;
    this.seekTo(before + delta);
    this.showSeekFeedback(this.video.currentTime - before);
  }

  formatTime(value) {
    return IOSPlayer.formatTime(value);
  }

  static formatTime(value) {
    if (!Number.isFinite(value)) {
      return 'LIVE';
    }
    const seconds = Math.max(0, Math.floor(value));
    const minutes = Math.floor(seconds / 60);
    const tail = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}:${tail}`
      : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  toggleMore(open) {
    if (!this.active) {
      return;
    }
    this.moreOpen = open;
    if (open) {
      this.ui.refs.customSpeedGroup.hidden = true;
    }
    this.ui.refs.extra.hidden = !open;
    this.ui.refs.more.setAttribute('aria-expanded', String(open));
    this.showControls();
  }

  setFit(mode) {
    if (!this.active || !['contain', 'cover'].includes(mode)) {
      return;
    }
    this.fit = mode;
    this.ui.host.style.setProperty('--stayfast-video-fit', mode);
    this.video.style.setProperty('object-fit', mode, 'important');
    const owned = this.styles.find(
      (item) => item.node === this.video && item.property === 'object-fit'
    );
    if (owned) {
      owned.value = this.video.style.getPropertyValue('object-fit');
    }
    const fill = mode === 'cover';
    this.ui.refs.fit.textContent = fill ? 'Fit' : 'Fill';
    this.ui.refs.fit.setAttribute('aria-pressed', String(fill));
    this.ui.refs.fit.setAttribute(
      'aria-label',
      fill ? 'Fit entire video' : 'Fill screen (crop edges)'
    );
    this.showControls();
  }

  audioTracks() {
    try {
      return Array.from(this.video.audioTracks || []);
    } catch {
      return [];
    }
  }

  canSetVolume() {
    try {
      return Boolean(
        this.view.CSS?.supports?.('selector(:volume-locked)') &&
        !this.video.matches(':volume-locked')
      );
    } catch {
      return false;
    }
  }

  applySpeed(speed) {
    const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
    if (!Number.isFinite(speed) || speed < MIN || speed > MAX) {
      this.ui.refs.status.textContent =
        MAX > 16
          ? `Enter a speed of at least ${MIN}×.`
          : `Enter a speed between ${MIN}× and ${MAX}×.`;
      return false;
    }
    const accepted = this.controller.actionHandler.setSpeed(this.video, speed, 'user');
    if (accepted === false) {
      this.ui.refs.status.textContent = 'This video could not use that playback speed.';
      this.update();
      return false;
    }
    this.ui.refs.customSpeedGroup.hidden = true;
    this.ui.refs.status.textContent =
      this.video.playbackRate === speed ? '' : `This video accepted ${this.video.playbackRate}×.`;
    this.update();
    this.showControls();
    return true;
  }

  preferredSpeed() {
    const value = Number(this.controller.config?.getKeyBinding('fast'));
    const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
    return Number.isFinite(value) && value >= MIN && value <= MAX ? value : 1;
  }

  captionTracks() {
    return Array.from(this.video.textTracks || []).filter(
      (track) => track.kind === 'captions' || track.kind === 'subtitles'
    );
  }

  update() {
    if (!this.active || this.controlsLocked) {
      return;
    }
    const { refs } = this.ui;
    setControlProperty(refs.native, 'hidden', !this.canEnterNativeFullscreen());
    const position =
      this.scrubber?.active && Number.isFinite(this.scrubber.value)
        ? this.scrubber.value
        : this.video.currentTime;
    const bounds = this.seekBounds();
    const timeWidth = `${Math.max(IOSPlayer.formatTime(bounds?.[0] || 0).length, IOSPlayer.formatTime(bounds?.[1] || 0).length) + 3}ch`;
    if (refs.current.style.minWidth !== timeWidth) {
      refs.current.style.minWidth = timeWidth;
    }
    setControlProperty(
      refs.play,
      'textContent',
      this.video.ended ? 'Replay' : this.video.paused ? 'Play' : 'Pause'
    );
    setControlAttribute(
      refs.play,
      'aria-label',
      this.video.ended ? 'Replay video' : this.video.paused ? 'Play video' : 'Pause video'
    );
    setControlProperty(refs.mute, 'textContent', this.video.muted ? 'Unmute' : 'Mute');
    setControlAttribute(refs.mute, 'aria-label', this.video.muted ? 'Unmute video' : 'Mute video');
    const selectedTime = this.scrubber?.active
      ? this.scrubber.formatTime(position)
      : IOSPlayer.formatTime(position);
    setControlProperty(refs.current, 'textContent', selectedTime);
    const finite = Number.isFinite(this.video.duration) && this.video.duration > 0;
    setControlProperty(
      refs.duration,
      'textContent',
      this.remaining && finite
        ? `−${IOSPlayer.formatTime(Math.max(0, this.video.duration - position))}`
        : IOSPlayer.formatTime(this.video.duration)
    );
    setControlProperty(refs.duration, 'disabled', !finite);
    setControlAttribute(
      refs.duration,
      'aria-label',
      finite ? (this.remaining ? 'Show total duration' : 'Show remaining time') : 'Live video'
    );
    setControlProperty(refs.live, 'hidden', finite || !bounds);
    setControlProperty(refs.live, 'disabled', !bounds || bounds[1] - position < 1);
    setControlProperty(refs.volume, 'hidden', !this.canSetVolume());
    setControlProperty(refs.volume, 'value', String(this.video.muted ? 0 : this.video.volume));
    setControlProperty(refs.seek, 'disabled', !bounds);
    setControlProperty(refs.back, 'disabled', !bounds);
    setControlProperty(refs.forward, 'disabled', !bounds);
    const canStepFrame =
      window.VSC.ControlsManager.canStepFrame(this.video) && !this.scrubber?.active;
    setControlProperty(refs.frameBack, 'disabled', !canStepFrame);
    setControlProperty(refs.frameForward, 'disabled', !canStepFrame);
    if (bounds) {
      setControlProperty(refs.seek, 'min', String(bounds[0]));
      setControlProperty(refs.seek, 'max', String(bounds[1]));
      if (!this.scrubber?.active) {
        setControlProperty(refs.seek, 'value', String(position));
      }
      setControlAttribute(
        refs.seek,
        'aria-valuetext',
        `${selectedTime} of ${IOSPlayer.formatTime(bounds[1])}`
      );
    }
    this.ui.updateSeekProgress?.();
    const rate = String(this.video.playbackRate);
    if (!Array.from(refs.speed.options).some((option) => option.value === rate)) {
      const option = this.doc.createElement('option');
      option.value = rate;
      option.textContent = `${rate}×`;
      option.disabled = Number(rate) > window.VSC.Constants.SPEED_LIMITS.MAX;
      refs.speed.append(option);
    }
    setControlProperty(refs.speed, 'value', rate);
    setControlAttribute(refs.normal, 'aria-pressed', String(this.video.playbackRate === 1));
    const preferred = this.preferredSpeed();
    setControlAttribute(
      refs.preferred,
      'aria-pressed',
      String(this.video.playbackRate === preferred)
    );
    setControlProperty(refs.preferred, 'title', `Preferred speed: ${preferred}×`);
    const tracks = this.captionTracks();
    const signature = tracks
      .map((track, index) => `${index}:${track.label}:${track.language}`)
      .join('|');
    if (signature !== this.trackSignature) {
      this.trackSignature = signature;
      refs.captions.replaceChildren();
      const off = this.doc.createElement('option');
      off.value = 'off';
      off.textContent = 'Captions off';
      refs.captions.append(off);
      tracks.forEach((track, index) => {
        const option = this.doc.createElement('option');
        option.value = String(index);
        option.textContent = track.label || track.language || `Track ${index + 1}`;
        refs.captions.append(option);
      });
    }
    setControlProperty(refs.captions, 'hidden', tracks.length === 0);
    const showing = tracks.findIndex((track) => track.mode === 'showing');
    setControlProperty(refs.captions, 'value', showing < 0 ? 'off' : String(showing));
    const audio = this.audioTracks();
    setControlProperty(refs.audio, 'hidden', audio.length < 2);
    const audioSignature = audio
      .map((track, index) => `${index}:${track.id}:${track.label}:${track.language}`)
      .join('|');
    if (audioSignature !== this.audioSignature) {
      this.audioSignature = audioSignature;
      refs.audio.replaceChildren();
      audio.forEach((track, index) => {
        const option = this.doc.createElement('option');
        option.value = String(index);
        option.textContent = track.label || track.language || `Audio ${index + 1}`;
        refs.audio.append(option);
      });
    }
    setControlProperty(refs.audio, 'value', String(audio.findIndex((track) => track.enabled)));
    if (this.video.paused) {
      this.showControls();
    }
  }

  showControls() {
    this.view.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (!this.active || this.controlsLocked) {
      return;
    }
    this.ui.host.removeAttribute('data-controls-hidden');
    if (!this.video.paused) {
      this.hideTimer = this.view.setTimeout(() => {
        if (
          this.active &&
          !this.video.paused &&
          !this.moreOpen &&
          !this.scrubber?.active &&
          !this.gestures?.active &&
          (this.pointerInteraction || !this.ui.shadow.activeElement?.matches('button,select,input'))
        ) {
          if (this.pointerInteraction && this.ui.shadow.activeElement?.matches('button')) {
            this.ui.shadow.activeElement.blur();
          }
          if (!this.ui.shadow.activeElement?.matches('select,input')) {
            this.ui.host.setAttribute('data-controls-hidden', '');
          }
        }
      }, 3500);
    }
  }

  close({ settle = true } = {}) {
    this.nativeRecovery?.cancel();
    IOSPlayer.presentationRevision++;
    if (!this.active) {
      return;
    }
    // Capture current offsets, so an intentional site/page scroll during playback
    // is retained rather than rewinding to a stale entry position.
    const scroll = this.pageScroll?.refresh();
    this.pageScroll = null;
    this.scrollRestore?.cancel();
    this.ownedFullscreen?.cleanup();
    this.ownedFullscreen = null;
    this.controlsLocked = false;
    this.clearSeekFeedback();
    this.scrubber?.cleanup();
    this.scrubber = null;
    this.gestures?.cleanup();
    this.gestures = null;
    this.active = false;
    this.dismissed = true;
    this.view.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.originObserver?.disconnect();
    this.originObserver = null;
    for (const remove of this.activeListeners.splice(0)) {
      remove();
    }
    window.VSC.iosPlayerFrames?.deactivate(this.token);
    if (IOSPlayer.activePlayers.get(this.doc) === this) {
      IOSPlayer.activePlayers.delete(this.doc);
    }
    this.siteStyle?.remove();
    this.siteStyle = null;
    // Restore only nodes still owned by our shell. A framework can remove,
    // relocate, or replace the media; leave relocated/removed nodes alone and
    // preserve new light-DOM replacements before discarding the shadow UI.
    if (!this.originLost && this.anchor?.parentNode) {
      for (const node of Array.from(this.ui.host.childNodes)) {
        this.anchor.parentNode.insertBefore(node, this.anchor);
      }
    } else if (this.portalNode.parentNode === this.ui.host) {
      if (this.originLost) {
        this.portalNode.remove();
      } else {
        this.originParent?.append(this.portalNode);
      }
    }
    if (this.portalNode.getAttribute('slot') === 'media') {
      if (this.originalSlot === null) {
        this.portalNode.removeAttribute('slot');
      } else {
        this.portalNode.setAttribute('slot', this.originalSlot);
      }
    }
    const styles = this.styles.splice(0);
    // Rebuild shorthand families atomically: CSSOM can coalesce four owned sides.
    // Snapshot first so a site's changed side survives while untouched sides restore.
    for (const family of ['margin', 'padding']) {
      const items = styles.filter((item) => item.property.startsWith(`${family}-`));
      for (const node of new Set(items.map((item) => item.node))) {
        const sides = items.filter((item) => item.node === node);
        if (sides.length !== 4) {
          continue;
        }
        const final = sides.map((item) => {
          const value = node.style.getPropertyValue(item.property);
          const priority = node.style.getPropertyPriority(item.property);
          return {
            ...item,
            finalValue: value === item.value && priority === item.priority ? item.original : value,
            finalPriority:
              value === item.value && priority === item.priority ? item.originalPriority : priority,
          };
        });
        node.style.removeProperty(family);
        for (const item of final) {
          node.style.removeProperty(item.property);
          if (item.finalValue) {
            node.style.setProperty(item.property, item.finalValue, item.finalPriority);
          }
          sides.find((side) => side.property === item.property).restored = true;
        }
      }
    }
    for (const item of styles.reverse()) {
      if (item.restored) {
        continue;
      }
      if (
        item.node.style.getPropertyValue(item.property) === item.value &&
        item.node.style.getPropertyPriority(item.property) === item.priority
      ) {
        if (item.original) {
          item.node.style.setProperty(item.property, item.original, item.originalPriority);
        } else {
          item.node.style.removeProperty(item.property);
        }
      }
    }
    this.anchor?.remove();
    this.placeholder?.remove();
    this.ui.destroy();
    this.trackSignature = null;
    this.audioSignature = null;
    this.moreOpen = false;
    try {
      this.focusBeforeOpen?.isConnected && this.focusBeforeOpen.focus?.({ preventScroll: true });
    } catch {
      /* Site removed focus target. */
    }
    if (this.shouldOwnInlineMedia()) {
      this.prepareMedia();
    } else {
      this.releaseMediaOwnership();
    }
    this.controller.repairDOMPlacement?.();
    if (scroll) {
      this.scrollRestore = scroll;
      scroll.restore(settle && !this.disposed);
    }
  }

  restoreSitePlayer() {
    this.resumeAfterPip = false;
    this.resumeOnShow = false;
    IOSPlayer.siteRelinquished.add(this.video);
    this.controller.safariPlaybackPending?.cleanup();
    this.controller.safariPlayback?.cleanup({ restore: false });
    this.close();
    this.releaseMediaOwnership();
    this.releaseInlinePlayback();
  }

  releaseMediaOwnership() {
    this.setInlineOwnership(false);
    this.attributeObserver?.disconnect();
    this.attributeObserver = null;
    for (const [name, state] of this.attributes) {
      if (this.video.getAttribute(name) === state.desired) {
        this.writeAttribute(name, state.original);
      }
    }
    this.attributes.clear();
    this.mediaPrepared = false;
    this.attributeConflicts = 0;
  }

  cleanup() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.nativeGeneration++;
    this.nativeSession = false;
    this.releaseTakeover?.();
    this.releaseTakeover = null;
    this.nativeMethods.clear();
    this.close();
    this.scrollRestore?.cancel();
    this.nativeScroll?.cancel();
    this.nativeScroll = null;
    for (const remove of this.listeners.splice(0)) {
      remove();
    }
    this.button?.remove();
    this.releaseMediaOwnership();
    this.releaseInlinePlayback();
    this.attached = false;
  }
}

window.VSC.IOSPlayer = IOSPlayer;

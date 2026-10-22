/** Switch an explicitly accelerated native-HLS video to its supplied progressive rendition. */
window.VSC = window.VSC || {};

(function () {
  const readyInitializations = new WeakSet();

  // Joining an already-requested play promise does not restart playback. Wait
  // for it to settle before load() can reject the site's original play request.
  function deferInitialization(controller, rate, candidate) {
    const video = controller.video;
    if (video.paused || video.ended) {
      return;
    }
    const doc = video.ownerDocument;
    const view = doc.defaultView;
    const root = doc.documentElement;
    const url = doc.URL;
    const src = video.getAttribute('src');
    const poster = video.getAttribute('poster');
    const settings = controller.config?.settings;
    const lastSpeed = settings?.lastSpeed;
    const siteSpeed = settings?.siteDefaultSpeed;
    const revision = controller.config?.speedPreferenceRevision;
    const listeners = [];
    let closed = false;
    let timer;
    const pending = {
      cleanup() {
        if (closed) {
          return;
        }
        closed = true;
        try {
          view.clearTimeout(timer);
        } catch {
          /* Discarded scheduling window. */
        }
        try {
          observer?.disconnect();
        } catch {
          /* Release listeners independently. */
        }
        for (const remove of listeners) {
          try {
            remove();
          } catch {
            /* Page-owned APIs may be replaced. */
          }
        }
        if (controller.safariPlaybackPending === pending) {
          controller.safariPlaybackPending = null;
        }
      },
    };
    controller.safariPlaybackPending = pending;
    const observer = new view.MutationObserver(pending.cleanup);
    observer.observe(video, { attributes: true, attributeFilter: ['src', 'poster'] });
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    };
    for (const type of ['emptied', 'loadstart', 'pause', 'encrypted']) {
      listen(video, type, pending.cleanup, true);
    }
    listen(view, 'pagehide', pending.cleanup);
    listen(doc, 'visibilitychange', () => {
      if (doc.visibilityState === 'hidden') {
        pending.cleanup();
      }
    });
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
      listen(
        view,
        type,
        (event) => {
          if (event.isTrusted) {
            pending.cleanup();
          }
        },
        { capture: true, passive: true }
      );
    }
    timer = view.setTimeout(pending.cleanup, 10000);
    try {
      const playback = video.play();
      if (!playback?.then) {
        pending.cleanup();
        return;
      }
      playback
        .then(() => {
          if (closed) {
            return;
          }
          view.clearTimeout(timer);
          timer = view.setTimeout(() => {
            if (closed) {
              return;
            }
            try {
              if (observer.takeRecords().length) {
                pending.cleanup();
                return;
              }
              const valid =
                !controller.disposed &&
                video.vsc === controller &&
                video.isConnected &&
                video.ownerDocument === doc &&
                doc.documentElement === root &&
                doc.URL === url &&
                doc.visibilityState !== 'hidden' &&
                !video.paused &&
                !video.ended &&
                video.getAttribute('src') === src &&
                video.getAttribute('poster') === poster &&
                (video.currentSrc || video.src) === candidate.originalUrl &&
                controller.config?.settings?.lastSpeed === lastSpeed &&
                controller.config?.settings?.siteDefaultSpeed === siteSpeed &&
                controller.config?.speedPreferenceRevision === revision;
              pending.cleanup();
              if (!valid) {
                return;
              }
              readyInitializations.add(controller);
              try {
                controller.actionHandler?.setSpeed(video, rate, 'init');
              } finally {
                readyInitializations.delete(controller);
              }
            } catch {
              pending.cleanup();
            }
          }, 0);
        }, pending.cleanup)
        .catch(pending.cleanup);
    } catch {
      pending.cleanup();
    }
  }

  function eligible(controller) {
    const video = controller?.video;
    const doc = video?.ownerDocument;
    if (
      !window.VSC.SafariHLSPlayback.matches(video) ||
      controller.disposed ||
      !video.isConnected ||
      video.vsc !== controller ||
      video.readyState < 1 ||
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !Number.isFinite(video.currentTime) ||
      video.srcObject ||
      video.mediaKeys ||
      video.webkitKeys ||
      video.audioTracks?.length > 1 ||
      video.videoTracks?.length > 1 ||
      video.webkitDisplayingFullscreen ||
      (video.webkitPresentationMode && video.webkitPresentationMode !== 'inline') ||
      doc.fullscreenElement === video ||
      doc.pictureInPictureElement === video ||
      controller.iosPlayer?.nativeSession ||
      window.VSC.IOSPlayer.siteRelinquished?.has(video)
    ) {
      return false;
    }
    const tracks = video.textTracks;
    if (tracks) {
      if (tracks.length > 16) {
        return false;
      }
      const externalTracks = new Set(Array.from(video.querySelectorAll('track'), (el) => el.track));
      const inBand = Array.from(tracks).filter((track) => !externalTracks.has(track));
      if (
        inBand.length > 1 ||
        inBand.some(
          (track) =>
            // Native HLS can expose one unnamed CC placeholder even when the
            // clip has no caption text. Real/unknown tracks retain HLS. MP4
            // cannot retain a dormant stream that supplies captions later.
            track.kind !== 'captions' ||
            track.label !== '' ||
            track.language !== '' ||
            track.cues?.length !== 0 ||
            (track.activeCues && track.activeCues.length !== 0)
        )
      ) {
        return false;
      }
    }
    return true;
  }

  function resolveCandidate(controller, rate, source) {
    if (
      source === 'external' ||
      !Number.isFinite(rate) ||
      rate <= 2 ||
      !eligible(controller) ||
      (source === 'init' &&
        (controller.safariPlaybackFailedSource ===
          (controller.video.currentSrc || controller.video.src) ||
          (controller.config?.settings?.lastSpeed !== rate &&
            controller.config?.settings?.siteDefaultSpeed !== rate)))
    ) {
      return null;
    }
    const player = controller.iosPlayer;
    let originRoot;
    if (player?.active) {
      if (
        player.video !== controller.video ||
        player.doc !== controller.video.ownerDocument ||
        !player.originParent?.isConnected ||
        player.originParent.ownerDocument !== player.doc ||
        player.anchor?.parentNode !== player.originParent ||
        player.anchor.ownerDocument !== player.doc ||
        !player.ui?.host?.isConnected ||
        player.portalNode?.parentNode !== player.ui.host ||
        !player.portalNode.contains(controller.video)
      ) {
        return null;
      }
      originRoot = player.originParent;
    }
    const candidate = window.VSC.ProgressiveMediaSource?.findCandidate(
      controller.video,
      originRoot
    );
    if (
      candidate &&
      controller.video.hasAttribute('src') &&
      controller.video.src !== candidate.originalUrl
    ) {
      return null;
    }
    return candidate?.originalUrl === (controller.video.currentSrc || controller.video.src)
      ? candidate
      : null;
  }

  class SafariPlaybackSession {
    constructor(controller, candidate) {
      this.controller = controller;
      this.video = controller.video;
      this.doc = this.video.ownerDocument;
      this.view = this.doc.defaultView;
      this.root = this.doc.documentElement;
      this.documentURL = this.doc.URL;
      this.candidate = candidate;
      this.originalAttribute = this.video.getAttribute('src');
      this.originalTime = this.video.currentTime;
      this.originalRate = this.video.playbackRate;
      this.wasPlaying = !this.video.paused && !this.video.ended;
      this.pending = true;
      this.finished = false;
      this.closed = false;
      this.intentChanged = false;
      this.ownMutationSeen = false;
      this.sourceEvents = new Set();
      this.listeners = [];
    }

    listen(target, type, callback, options) {
      target.addEventListener(type, callback, options);
      this.listeners.push(() => target.removeEventListener(type, callback, options));
    }

    // Read all queued writes, not just the final value: an away-and-back site
    // update is still new site intent, even when it restores our exact URL.
    inspect(records) {
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        let next = this.video.getAttribute(record.attributeName);
        for (let later = index + 1; later < records.length; later++) {
          if (records[later].attributeName === record.attributeName) {
            next = records[later].oldValue;
            break;
          }
        }
        if (
          record.attributeName !== 'src' ||
          this.ownMutationSeen ||
          record.oldValue !== this.originalAttribute ||
          next !== this.candidate.progressiveUrl
        ) {
          this.cleanup({ restore: false });
          return false;
        }
        this.ownMutationSeen = true;
      }
      return !this.closed;
    }

    ownsSource() {
      try {
        if (
          this.closed ||
          this.controller.safariPlayback !== this ||
          this.video.vsc !== this.controller ||
          !this.video.isConnected ||
          this.video.ownerDocument !== this.doc ||
          this.doc.documentElement !== this.root ||
          this.doc.URL !== this.documentURL ||
          this.video.srcObject ||
          this.video.mediaKeys ||
          this.video.webkitKeys ||
          this.video.webkitDisplayingFullscreen ||
          (this.video.webkitPresentationMode && this.video.webkitPresentationMode !== 'inline') ||
          this.doc.pictureInPictureElement === this.video ||
          this.doc.fullscreenElement === this.video ||
          this.controller.iosPlayer?.nativeSession
        ) {
          return false;
        }
        if (!this.inspect(this.observer?.takeRecords() || [])) {
          return false;
        }
        return (
          this.video.getAttribute('src') === this.candidate.progressiveUrl &&
          (!this.video.currentSrc ||
            this.video.currentSrc === this.candidate.progressiveUrl ||
            (this.pending && this.video.currentSrc === this.candidate.originalUrl))
        );
      } catch {
        return false;
      }
    }

    ownsTransition() {
      return this.pending && this.ownsSource();
    }

    start() {
      const cancel = () => this.cleanup({ restore: false });
      this.observer = new this.view.MutationObserver((records) => {
        try {
          this.inspect(records);
        } catch {
          cancel();
        }
      });
      this.observer.observe(this.video, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['src', 'poster'],
      });
      for (const type of ['emptied', 'loadstart']) {
        // Capture precedes the ordinary player/source reset listeners. Each
        // expected event belongs to one load; a second load yields to the site.
        this.listen(
          this.video,
          type,
          () => {
            if (!this.pending || this.sourceEvents.has(type) || !this.ownsSource()) {
              cancel();
            } else {
              this.sourceEvents.add(type);
            }
          },
          true
        );
      }
      this.listen(this.video, 'loadeddata', () => {
        if (!this.ownsSource()) {
          cancel();
          return;
        }
        this.pending = false;
        this.view.clearTimeout(this.deadline);
        this.deadline = null;
      });
      this.listen(this.video, 'error', () => this.abort());
      this.listen(this.video, 'encrypted', cancel);
      const input = (event) => {
        if (event.isTrusted) {
          this.intentChanged = true;
        }
      };
      for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
        this.listen(this.view, type, input, { capture: true, passive: true });
      }
      for (const type of ['seeking', 'pause']) {
        this.listen(this.video, type, (event) => {
          // Loading queues its own pause/initial seek. Real input already
          // cancels rollback even before metadata becomes available.
          if (
            event.isTrusted &&
            this.finished &&
            this.video.readyState >= 1 &&
            (type === 'pause' || Math.abs(this.video.currentTime - this.originalTime) > 0.01)
          ) {
            this.intentChanged = true;
          }
        });
      }
      this.listen(this.view, 'pagehide', cancel);
      this.listen(this.doc, 'visibilitychange', () => {
        if (this.doc.visibilityState === 'hidden') {
          cancel();
        }
      });
      this.deadline = this.view.setTimeout(() => this.abort(), 10000);
      this.video.src = this.candidate.progressiveUrl;
      this.video.load();
      // WebKit retains this as its default start position at HAVE_NOTHING.
      // Do not defer a seek or playback to metadata/playing callbacks.
      this.video.currentTime = this.originalTime;
    }

    finish() {
      try {
        if (this.finished || this.closed) {
          return;
        }
        if (!this.ownsSource() || this.doc.visibilityState === 'hidden') {
          this.cleanup({ restore: false });
          return;
        }
        this.finished = true;
        if (this.wasPlaying && this.doc.visibilityState !== 'hidden') {
          const result = this.video.play();
          result?.catch?.(() => this.abort());
        }
      } catch {
        this.abort();
      }
    }

    abort() {
      if (this.ownsSource()) {
        this.controller.safariPlaybackFailedSource = this.candidate.originalUrl;
      }
      this.cleanup({ restore: !this.intentChanged, aborted: true });
    }

    cleanup({ restore = true, aborted = false } = {}) {
      if (this.closed) {
        return;
      }
      let owned = false;
      try {
        owned = restore && this.ownsSource();
      } catch {
        // Page-owned media properties may throw during disposal.
      }
      this.closed = true;
      this.pending = false;
      try {
        this.observer?.disconnect();
      } catch {
        // Continue releasing the remaining owned resources.
      }
      try {
        this.view.clearTimeout(this.deadline);
      } catch {
        // A discarded scheduling window must not prevent listener cleanup.
      }
      this.deadline = null;
      for (const remove of this.listeners.splice(0)) {
        try {
          remove();
        } catch {
          // A replaced site API must not retain the other subscriptions.
        }
      }
      if (this.controller.safariPlayback === this) {
        this.controller.safariPlayback = null;
      }
      if (!owned) {
        return;
      }
      try {
        const currentTime = this.video.currentTime;
        const currentRate = this.video.playbackRate;
        const time = Number.isFinite(currentTime) ? currentTime : this.originalTime;
        const rate =
          Number.isFinite(currentRate) && currentRate > 0 ? currentRate : this.originalRate;
        const resume = !aborted && !this.video.paused && this.doc.visibilityState !== 'hidden';
        if (aborted) {
          this.controller.actionHandler?.eventManager?.releaseMediaState?.(this.video);
        }
        this.video.pause();
        if (this.originalAttribute === null) {
          this.video.removeAttribute('src');
        } else {
          this.video.setAttribute('src', this.originalAttribute);
        }
        this.video.load();
        if (Number.isFinite(time)) {
          this.video.currentTime = time;
        }
        if (Number.isFinite(rate) && rate > 0) {
          if (aborted && this.controller.actionHandler?.setSpeed) {
            this.controller.actionHandler.setSpeed(this.video, rate, 'init');
          } else if (this.video.playbackRate !== rate) {
            this.video.playbackRate = rate;
          }
        }
        if (resume) {
          this.video.play()?.catch?.(() => {});
        }
      } catch {
        // Restoration is one attempt; never fight a replacement site session.
      }
    }
  }

  window.VSC.SafariHLSPlayback = {
    matches(video) {
      try {
        return Boolean(window.VSC.IOSPlayer?.isSupported(video));
      } catch {
        return false;
      }
    },
    canSwitch(controller, rate, source = 'internal') {
      try {
        if (controller?.safariPlaybackPending || controller?.safariPlayback?.ownsSource()) {
          return false;
        }
        return Boolean(resolveCandidate(controller, rate, source));
      } catch {
        return false;
      }
    },
    begin(controller, rate, source = 'internal') {
      let session;
      try {
        if (source !== 'init') {
          controller?.safariPlaybackPending?.cleanup();
        } else if (controller?.safariPlaybackPending) {
          return null;
        }
        if (source === 'external' || !Number.isFinite(rate)) {
          return null;
        }
        const existing = controller?.safariPlayback;
        if (existing?.ownsSource()) {
          return existing;
        }
        existing?.cleanup({ restore: false });
        const candidate = resolveCandidate(controller, rate, source);
        if (!candidate) {
          return null;
        }
        if (source === 'init' && !readyInitializations.has(controller)) {
          deferInitialization(controller, rate, candidate);
          return null;
        }
        if (source !== 'init') {
          controller.safariPlaybackFailedSource = null;
        }
        session = new SafariPlaybackSession(controller, candidate);
        controller.safariPlayback = session;
        session.start();
        return session;
      } catch {
        controller?.safariPlaybackPending?.cleanup();
        session?.abort();
        return null;
      }
    },
  };
})();

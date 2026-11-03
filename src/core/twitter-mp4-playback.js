/** Keep X's active MediaSource intact while a supplied MP4 supplies fast playback. */
window.VSC = window.VSC || {};

(function () {
  const originals = new WeakMap();
  const players = new WeakMap();
  const active = new Set();
  const failed = new WeakMap();
  const recoveryRequests = new WeakMap();
  const identityKeys = [
    'originalUrl',
    'sourceUrl',
    'contentId',
    'sessionId',
    'sdk',
    'api',
    'store',
    'progressiveUrl',
  ];
  const suppressAutomatic = (session) => {
    failed.set(
      session.original,
      Object.fromEntries(identityKeys.map((key) => [key, session.candidate[key]]))
    );
  };

  function idleCompanion(session) {
    try {
      const video = session.video;
      if (
        !session.committed ||
        session.closed ||
        session.committing ||
        session.creatingController ||
        !session.playReady ||
        session.pendingRelative ||
        session.recovery?.reload ||
        video.readyState < 2 ||
        !video.currentSrc ||
        !video.isConnected ||
        !session.original.isConnected ||
        !video.paused ||
        !session.original.paused ||
        video.seeking ||
        session.original.seeking ||
        !session.ownsNativeSource()
      ) {
        return false;
      }
      for (const media of [video, session.original]) {
        const player = media.vsc?.iosPlayer;
        if (
          player?.active ||
          player?.nativeSession ||
          media.webkitDisplayingFullscreen ||
          (media.webkitPresentationMode && media.webkitPresentationMode !== 'inline') ||
          session.doc.pictureInPictureElement === media ||
          session.doc.fullscreenElement === media
        ) {
          return false;
        }
      }
      const rect = video.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.bottom <= 0 ||
          rect.right <= 0 ||
          rect.top >= session.view.innerHeight ||
          rect.left >= session.view.innerWidth)
      );
    } catch {
      return false;
    }
  }

  function reclaimable(session) {
    try {
      return (
        idleCompanion(session) && session.candidate.current(session.video) && idleCompanion(session)
      );
    } catch {
      return false;
    }
  }

  function resolve(controller, rate, source) {
    if (
      !controller ||
      source === 'external' ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      (rate <= 2 && source !== 'presentation') ||
      controller.disposed ||
      players.has(controller.video) ||
      !window.VSC.IOSPlayer?.isSupported(controller.video) ||
      controller.video.ownerDocument.hidden ||
      (source === 'init' && controller.video.paused) ||
      controller.iosPlayer?.nativeSession ||
      controller.video.webkitDisplayingFullscreen ||
      (controller.video.webkitPresentationMode &&
        controller.video.webkitPresentationMode !== 'inline') ||
      controller.video.ownerDocument.pictureInPictureElement === controller.video ||
      controller.video.ownerDocument.fullscreenElement === controller.video ||
      (source !== 'presentation' && window.VSC.IOSPlayer.siteRelinquished.has(controller.video))
    ) {
      return null;
    }
    const originParent = controller.iosPlayer?.active ? controller.iosPlayer.originParent : null;
    const options = { allowSourceChild: source === 'presentation' };
    const candidate =
      window.VSC.TwitterPlayer?.resolve(controller.video, originParent, options) ||
      window.VSC.TwitterPlayer?.resolveCaptionedLoop?.(controller.video, originParent, options);
    const previous = failed.get(controller.video);
    return source === 'init' &&
      candidate &&
      previous &&
      identityKeys.every((key) => previous[key] === candidate[key])
      ? null
      : candidate;
  }

  class TwitterMP4Session {
    constructor(controller, candidate, rate, source) {
      this.controller = controller;
      this.original = controller.video;
      this.candidate = candidate;
      this.doc = this.original.ownerDocument;
      this.view = this.doc.defaultView;
      this.root = this.doc.documentElement;
      this.url = this.doc.URL;
      this.rate = rate;
      const localRate = controller.actionHandler.eventManager?.getMediaRateState?.(this.original);
      this.rateRevision =
        source === 'presentation' && localRate?.lifecycleSpeed === rate
          ? (localRate.lifecycleSpeedRevision ?? controller.config.speedPreferenceRevision ?? 0)
          : (controller.config.speedPreferenceRevision ?? 0);
      this.time = this.original.currentTime;
      this.originalRate = this.original.playbackRate;
      this.playing = !this.original.paused && !this.original.ended;
      this.video = this.doc.createElement('video');
      this.companionPause = this.video.pause;
      this.listeners = [];
      this.methods = new Map();
      this.closed = false;
      this.committed = false;
      this.committing = false;
      this.finished = false;
      this.captionProducerPaused = false;
      this.ready = false;
      this.playReady = false;
      this.playGeneration = 0;
      this.originalPlay = this.original.play;
      this.originalPause = this.original.pause;
      this.recovery = new window.VSC.OwnedMP4Recovery(this);
    }

    originCurrent() {
      try {
        if (this.observer?.takeRecords().length) {
          this.originalIntentChanged = true;
        }
        return Boolean(
          !this.closed &&
          !this.originalIntentChanged &&
          this.original.isConnected &&
          this.original.ownerDocument === this.doc &&
          this.doc.documentElement === this.root &&
          this.doc.URL === this.url &&
          this.candidate.current(this.video) &&
          (!this.captionOwner || this.captionOwner.isCurrent() === true)
        );
      } catch {
        return false;
      }
    }

    current() {
      try {
        return Boolean(
          this.originCurrent() &&
          this.ownsNativeSource() &&
          (!this.committed || (this.video.isConnected && this.video.ownerDocument === this.doc))
        );
      } catch {
        return false;
      }
    }

    ownsNativeSource() {
      try {
        if (this.nativeSourceIntent() || this.nativeSourceRevoked) {
          return false;
        }
        if (this.loopPlayback) {
          return this.loopPlayback.sourceCurrent();
        }
        return Boolean(
          this.video.src === this.candidate.progressiveUrl &&
          (!this.video.currentSrc || this.video.currentSrc === this.candidate.progressiveUrl) &&
          !this.video.srcObject &&
          !this.video.mediaKeys &&
          !this.video.webkitKeys
        );
      } catch {
        return false;
      }
    }

    identityCurrent() {
      try {
        if (this.observer?.takeRecords().length) {
          this.originalIntentChanged = true;
        }
        return Boolean(
          !this.closed &&
          !this.originalIntentChanged &&
          this.original.isConnected &&
          this.original.ownerDocument === this.doc &&
          this.doc.documentElement === this.root &&
          this.doc.URL === this.url &&
          (this.candidate.identityCurrent?.() ?? this.candidate.current(this.video))
        );
      } catch {
        return false;
      }
    }

    relativeCurrent(pending) {
      try {
        const controller = pending.controller;
        return Boolean(
          this.ready &&
          !this.loopPlayback?.nativeFallback &&
          this.committed &&
          this.video.isConnected &&
          controller === this.video.vsc &&
          !controller.disposed &&
          controller.actionHandler === pending.actionHandler &&
          typeof pending.setSpeed === 'function' &&
          pending.actionHandler.setSpeed === pending.setSpeed &&
          controller.config === pending.config &&
          pending.config.settings === pending.settings &&
          pending.settings.enabled !== false &&
          pending.settings.lastSpeed === pending.preference &&
          (pending.config.speedPreferenceRevision ?? 0) === pending.revision &&
          this.current()
        );
      } catch {
        return false;
      }
    }

    requestedSpeed(controller) {
      const pending = this.pendingRelative;
      if (!pending) {
        return null;
      }
      if (pending.controller !== controller || !this.relativeCurrent(pending)) {
        this.cancelRelative();
        return null;
      }
      return pending.target;
    }

    queueRelative(controller, target, source) {
      if (source === 'external' || source === 'init' || !Number.isFinite(target)) {
        return false;
      }
      if (!this.committed) {
        return false;
      }
      try {
        if (this.nativeSourceIntent()) {
          this.cleanup({ resume: false });
          return true;
        }
      } catch {
        this.cleanup({ resume: false });
        return true;
      }
      if (this.closed || !this.current()) {
        this.yieldRelative();
        return true;
      }
      if (this.loopPlayback?.nativeFallback) {
        this.cancelRelative();
        return false;
      }
      if (this.pendingRelative && !this.relativeCurrent(this.pendingRelative)) {
        this.cancelRelative();
      }
      const pending = this.pendingRelative || {
        controller,
        actionHandler: controller?.actionHandler,
        setSpeed: controller?.actionHandler?.setSpeed,
        config: controller?.config,
        settings: controller?.config?.settings,
        preference: controller?.config?.settings?.lastSpeed,
        revision: controller?.config?.speedPreferenceRevision ?? 0,
      };
      if (pending.controller !== controller || !this.relativeCurrent(pending)) {
        this.cancelRelative();
        this.cleanup({ resume: false });
        return true;
      }
      this.view.clearTimeout(pending.timer);
      pending.target = target;
      pending.source = source;
      // Safari stalls when every rapid relative click immediately rewrites its decoder rate.
      pending.timer = this.view.setTimeout(() => {
        if (this.pendingRelative !== pending) {
          return;
        }
        this.pendingRelative = null;
        if (!this.relativeCurrent(pending)) {
          if (pending.controller !== this.video.vsc || pending.controller.disposed) {
            this.cleanup({ resume: false });
          } else if (!this.current()) {
            this.yieldRelative();
          }
          return;
        }
        try {
          if (this.nativeSourceIntent()) {
            this.cleanup({ resume: false });
            return;
          }
          if (this.relativeCurrent(pending)) {
            pending.setSpeed.call(
              pending.actionHandler,
              this.video,
              pending.target,
              pending.source
            );
          } else if (!this.current()) {
            this.yieldRelative();
          }
        } catch {
          this.cleanup({ resume: false });
        }
      }, 100);
      this.pendingRelative = pending;
      return true;
    }

    cancelRelative() {
      if (this.pendingRelative) {
        this.view.clearTimeout(this.pendingRelative.timer);
        this.pendingRelative = null;
      }
    }

    yieldRelative() {
      this.cancelRelative();
      if (this.closed) {
        return;
      }
      let resume = false;
      try {
        resume = Boolean(
          !this.nativeSourceIntent() &&
          this.video.isConnected &&
          this.video.ownerDocument === this.doc &&
          this.video.vsc &&
          !this.video.vsc.disposed &&
          this.ownsNativeSource() &&
          this.identityCurrent()
        );
      } catch {
        /* Unknown source intent retains the site player. */
      }
      this.cleanup({ resume });
    }

    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    }

    recoveryCurrent() {
      try {
        if (this.loopPlayback) {
          return false;
        }
        const current = this.committed && this.current();
        if (this.nativeSourceIntent()) {
          this.cleanup({ resume: false });
          return false;
        }
        return current;
      } catch {
        return false;
      }
    }

    recoveryFailed() {
      this.cleanup({ site: true, playing: true });
    }
    cancelReload() {
      this.recovery?.cancel();
    }
    ownsTransition(type) {
      return this.recovery?.ownsTransition(type) || false;
    }
    watchPlayback() {
      if (this.loopPlayback) {
        this.recovery?.cancel();
        return;
      }
      this.recovery?.refresh();
    }

    applyRate(rate, revision = this.rateRevision) {
      this.rate = rate;
      this.rateRevision = revision;
      if (!this.loopPlayback?.holdingInitialRate) {
        this.video.playbackRate = rate;
      }
    }

    start() {
      if (!this.originCurrent()) {
        throw new Error('X playback identity changed');
      }
      const video = this.video;
      if (this.candidate.captionBinding) {
        const captionOwner = window.VSC.TwitterCaptionPlayback?.createLoopOwner?.(
          this.candidate.captionBinding,
          video
        );
        if (window.VSC.TwitterCaptionPlayback?.isLoopOwner?.(captionOwner) !== true) {
          throw new Error('Caption owner unavailable');
        }
        this.captionOwner = captionOwner;
        this.captionOwner.setInvalidated(() =>
          this.cleanup({
            resume: this.captionProducerPaused && this.identityCurrent(),
            site: this.committed,
          })
        );
        if (this.closed) {
          return;
        }
        this.captionAttachment = Promise.resolve(this.captionOwner.attach());
        this.captionAttachment.catch(() => this.playbackFailed());
      }
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', '');
      video.controls = true;
      video.preload = 'auto';
      video.loop = this.candidate.loop;
      video.muted = this.original.muted;
      video.volume = this.original.volume;
      for (const property of ['preservesPitch', 'webkitPreservesPitch']) {
        if (typeof this.original[property] === 'boolean') {
          video[property] = this.original[property];
        }
      }
      video.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
      const yieldToSite = () => this.cleanup({ resume: false });
      this.observer = new this.view.MutationObserver(() => {
        this.originalIntentChanged = true;
        yieldToSite();
      });
      this.observer.observe(this.original, {
        attributes: true,
        attributeFilter: ['src', 'poster'],
        childList: Boolean(this.candidate.sourceNode),
      });
      if (this.candidate.sourceNode) {
        this.observer.observe(this.candidate.sourceNode, {
          attributes: true,
          attributeFilter: ['src', 'type', 'media'],
        });
      }
      const unsubscribe = this.candidate.subscribe(() => {
        if (!this.originCurrent()) {
          this.cleanup({ resume: this.identityCurrent() });
        }
      });
      if (typeof unsubscribe !== 'function') {
        throw new Error('X player does not provide subscription cleanup');
      }
      if (this.closed) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
      if (!this.originCurrent()) {
        this.cleanup({ resume: false });
        return;
      }
      for (const name of ['play', 'pause']) {
        const descriptor = Object.getOwnPropertyDescriptor(this.original, name);
        if (descriptor && !descriptor.configurable && !descriptor.writable) {
          throw new Error('X media methods are not writable');
        }
        const originalMethod = this.original[name];
        const session = this;
        const wrapper = function (...args) {
          if (session.closed && session.cleanupInProgress) {
            session.cleanupPlaying = name === 'play';
            return originalMethod.apply(this, args);
          }
          if (!session.current()) {
            session.cleanup({ resume: false });
            return originalMethod.apply(this, args);
          }
          session.playing = name === 'play';
          if (session.captionOwner && !session.committed) {
            const result = originalMethod.apply(this, args);
            if (name === 'pause' || session.captionProducerPaused) {
              session.cleanup({ resume: false });
            }
            return result;
          }
          if (name === 'play') {
            return session.requestPlay(args);
          }
          session.playGeneration++;
          session.playReady = true;
          const result = session.video.pause(...args);
          if (session.ready && session.finished) {
            session.commit();
          }
          return result;
        };
        this.methods.set(name, { descriptor, wrapper });
        Object.defineProperty(this.original, name, {
          configurable: descriptor?.configurable ?? true,
          enumerable: descriptor?.enumerable ?? false,
          writable: descriptor?.writable ?? true,
          value: wrapper,
        });
      }
      this.listen(video, 'loadeddata', () => {
        if (this.loopFallback && (video.readyState < 2 || !this.current())) {
          return;
        }
        if (this.loopPlayback && !this.loopPlayback.ready) {
          return;
        }
        this.ready = true;
        if (this.finished) {
          this.commit();
        }
        this.watchPlayback();
      });
      this.listen(video, 'error', () => {
        if (!this.loopFallback || video.error) {
          this.playbackFailed();
        }
      });
      this.listen(video, 'loadstart', () => {
        if (!this.ownsNativeSource()) {
          this.cleanup({ resume: false });
        }
      });
      const capabilityChanged = () => {
        if (!this.originCurrent()) {
          this.cleanup({ resume: this.identityCurrent() });
        }
      };
      this.listen(this.original, 'encrypted', () =>
        this.cleanup({ resume: this.identityCurrent() })
      );
      if (this.original.textTracks?.addEventListener) {
        this.listen(this.original.textTracks, 'addtrack', capabilityChanged);
        this.listen(this.original.textTracks, 'change', capabilityChanged);
      }
      this.listen(this.original, 'emptied', yieldToSite);
      this.listen(this.original, 'loadstart', yieldToSite);
      this.listen(this.original, 'pause', () => {
        if (!this.captionOwner) {
          return;
        }
        if (this.captionReleasePausePending) {
          this.captionReleasePausePending = false;
          return;
        }
        if (!this.committed && this.original.paused) {
          if (this.original.ended && this.pendingCaptionReplay()) {
            this.captionAwaitingRestart = true;
            return;
          }
          this.playing = false;
          yieldToSite();
        }
      });
      this.listen(this.original, 'seeking', () => {
        if (!this.captionOwner || this.captionProducerPaused || this.committed) {
          yieldToSite();
        }
      });
      this.listen(this.original, 'playing', () => {
        if (this.captionOwner && !this.captionProducerPaused && !this.committed) {
          if (!this.original.paused && !this.original.ended) {
            this.captionAwaitingRestart = false;
            this.loopPlayback?.maybeReady();
          }
          return;
        }
        // A site may have captured the native method before our wrapper.
        if (!this.original.paused) {
          this.cleanup({ resume: false });
        }
      });
      this.listen(this.original, 'seeked', () => {
        if (this.captionOwner && !this.captionProducerPaused && !this.committed) {
          this.loopPlayback?.maybeReady();
        }
      });
      this.listen(this.view, 'pagehide', yieldToSite);
      this.listen(this.doc, 'visibilitychange', () => {
        if (this.doc.hidden) {
          this.cancelReload();
        } else {
          this.watchPlayback();
        }
        if (this.presentation && !this.committed && this.doc.hidden) {
          this.cleanup({ resume: false });
        }
      });
      this.deadline = this.view.setTimeout(() => this.playbackFailed(), 10000);
      if (window.VSC.TwitterLoopPlayback?.canUse(this)) {
        try {
          this.loopPlayback = new window.VSC.TwitterLoopPlayback(this, {
            ready: () => {
              if (!this.current()) {
                this.cleanup({ resume: false });
                return;
              }
              this.ready = video.readyState >= 2;
              if (this.ready && this.finished) {
                this.commit();
              }
            },
            failed: () => this.playbackFailed(),
          });
        } catch (error) {
          if (this.captionOwner || !this.identityCurrent()) {
            throw error;
          }
        }
      }
      if (!this.loopPlayback) {
        if (this.captionOwner) {
          throw new Error('Caption loop transport unavailable');
        }
        video.src = this.candidate.progressiveUrl;
        video.load();
      }
      video.currentTime = this.time;
      this.applyRate(this.rate);
      this.nativeObserver = new this.view.MutationObserver((records) => {
        if (this.nativeSourceIntent(records)) {
          this.cleanup({ resume: !this.captionOwner });
        }
      });
      this.observeNativeSource();
    }

    nativeSourceIntent(records) {
      try {
        records ||= this.nativeObserver?.takeRecords() || [];
        if (!records.length) {
          return false;
        }
        if (
          !this.captionOwner ||
          records.length !== 1 ||
          this.captionTrackWriteSeen ||
          this.captionOwner.attestsInitialTrackWrite(records[0]) !== true ||
          this.captionOwner.ownsTrack(this.video) !== true
        ) {
          this.nativeSourceRevoked = true;
          return true;
        }
        this.captionTrackWriteSeen = true;
        return false;
      } catch {
        this.nativeSourceRevoked = true;
        return true;
      }
    }

    observeNativeSource() {
      const video = this.video;
      this.nativeObserver.observe(video, {
        attributes: true,
        attributeOldValue: Boolean(this.captionOwner),
        attributeFilter: this.loopPlayback ? ['src', 'poster', 'type', 'media'] : ['src', 'poster'],
        childList: Boolean(this.loopPlayback),
        subtree: Boolean(this.loopPlayback),
      });
    }

    playbackFailed() {
      if (this.captionOwner) {
        this.cleanup({
          resume: this.captionProducerPaused && this.identityCurrent(),
          site: this.committed,
        });
        return;
      }
      if (!this.closed && this.committed && this.loopPlayback) {
        this.cleanup({ site: true });
        return;
      }
      if (!this.closed && !this.committed && this.loopPlayback && !this.loopFallback) {
        try {
          if (this.nativeSourceIntent()) {
            this.cleanup({ resume: false });
            return;
          }
          if (!this.current()) {
            this.cleanup({ resume: this.identityCurrent() });
            return;
          }
          const video = this.video;
          const time = video.currentTime;
          const rate = this.loopPlayback.holdingInitialRate ? this.rate : video.playbackRate;
          // Continue the same pending request on its verified MP4, never a metadata-triggered Play.
          this.playGeneration++;
          this.ready = false;
          this.playReady = this.finished && !this.playing;
          this.nativeObserver?.disconnect();
          this.loopPlayback.cleanup();
          this.loopPlayback = null;
          this.loopFallback = true;
          video.src = this.candidate.progressiveUrl;
          video.load();
          video.currentTime = time;
          video.playbackRate = rate;
          this.observeNativeSource();
          this.view.clearTimeout(this.deadline);
          this.deadline = this.view.setTimeout(() => this.abort(), 10000);
          if (this.finished && this.playing) {
            this.requestPlay();
          }
          return;
        } catch {
          /* An unavailable fallback retains the guarded original handback. */
        }
      }
      this.abort();
    }

    pendingCaptionReplay() {
      return Boolean(
        this.captionOwner &&
        !this.captionProducerPaused &&
        !this.committed &&
        this.finished &&
        this.playing &&
        this.playGeneration > 0 &&
        this.rate > 0 &&
        this.candidate.loop === true &&
        this.loopPlayback?.holdingInitialRate &&
        this.current()
      );
    }

    prepareLoopRelease() {
      if (!this.captionOwner) {
        return true;
      }
      if (
        !this.finished ||
        !this.current() ||
        !this.captionOwner.verifyEpoch(0) ||
        !this.captionOwner.readyToPlay(this.loopPlayback.nativeTime())
      ) {
        return false;
      }
      if (this.captionProducerPaused) {
        return true;
      }
      try {
        if (this.original.seeking) {
          return false;
        }
        if (this.original.ended && this.pendingCaptionReplay()) {
          this.captionAwaitingRestart = true;
        }
        if (this.captionAwaitingRestart) {
          return false;
        }
        if (this.playing && this.original.paused) {
          this.playing = false;
          this.cleanup({ resume: false });
          return false;
        }
        if (!this.original.paused) {
          // Mark only the pause we issue, before synchronous or queued delivery.
          this.captionReleasePausePending = true;
          this.originalPause.call(this.original);
        }
        if (!this.current() || !this.original.paused) {
          this.cleanup({ resume: false });
          return false;
        }
        const time = this.original.currentTime;
        if (!Number.isFinite(time)) {
          throw new Error('X paused position unavailable');
        }
        this.captionProducerPaused = true;
        this.time = time;
        this.video.currentTime = time;
        return this.current();
      } catch {
        this.cleanup({ resume: this.captionProducerPaused && this.identityCurrent() });
        return false;
      }
    }

    finish({ speedCommand = false } = {}) {
      if (this.closed) {
        return false;
      }
      // Reopening presentation is not another speed write. Keep a newer site
      // rate distinguishable from the command we may need to roll back.
      if (!this.finished || speedCommand) {
        try {
          this.appliedOriginalRate = this.original.playbackRate;
        } catch {
          this.abort();
          return false;
        }
      }
      if (this.finished) {
        return true;
      }
      this.finished = true;
      if (!this.current()) {
        this.cleanup({ resume: false });
        return false;
      }
      if (this.captionOwner) {
        if (this.playing) {
          this.requestPlay();
        } else {
          this.playReady = true;
        }
        this.loopPlayback?.maybeReady();
        return !this.closed;
      }
      // Both pause and the new play request occur in the speed command's
      // stack. Metadata callbacks only attach presentation; they never play.
      let pausedTime;
      try {
        this.originalPause.call(this.original);
        if (!this.current()) {
          this.cleanup({ resume: this.identityCurrent() });
          return false;
        }
        if (!this.original.paused) {
          this.cleanup({ resume: false });
          return false;
        }
        pausedTime = this.original.currentTime;
        if (!Number.isFinite(pausedTime)) {
          throw new Error('X paused position unavailable');
        }
        // Preparing the companion can advance the producer beyond its constructor snapshot.
        this.time = pausedTime;
        this.video.currentTime = pausedTime;
      } catch {
        if (Number.isFinite(pausedTime)) {
          this.abort();
        } else {
          this.cleanup({ resume: false });
        }
        return false;
      }
      if (this.playing) {
        this.requestPlay();
      } else {
        this.playReady = true;
      }
      if (this.ready) {
        this.commit();
      }
      return !this.closed;
    }

    requestPlay(args = []) {
      const generation = ++this.playGeneration;
      this.playReady = false;
      const accepted = () => {
        if (this.closed) {
          try {
            this.companionPause.call(this.video);
          } catch {
            /* A late Play cannot revive a released companion. */
          }
        } else if (generation === this.playGeneration && this.current()) {
          this.playReady = true;
          if (this.ready && this.finished) {
            this.commit();
          }
        }
      };
      const rejected = (error) => {
        if (!this.closed && generation === this.playGeneration) {
          window.VSC.logger?.debug?.(`X companion Play rejected: ${error?.name || 'Error'}`);
          this.playbackFailed();
        }
      };
      try {
        const result = this.video.play(...args);
        if (typeof result?.then === 'function') {
          result.then(accepted, rejected);
        } else {
          accepted();
        }
        return result;
      } catch (error) {
        rejected(error);
      }
    }

    commit() {
      if (this.closed || this.committed || !this.playReady || !this.current()) {
        return;
      }
      try {
        const wasFullscreen = Boolean(this.controller.iosPlayer?.active);
        const requestedPresentation =
          this.presentation &&
          !this.doc.hidden &&
          this.presentation.revision === window.VSC.IOSPlayer.presentationRevision;
        this.committing = true;
        this.controller.remove();
        this.committing = false;
        const presentationRevision = window.VSC.IOSPlayer.presentationRevision;
        if (!this.originCurrent()) {
          this.cleanup({ resume: false });
          return;
        }
        const parent = this.original.parentElement;
        if (!parent) {
          throw new Error('X media lost its container');
        }
        this.parent = parent;
        const position = this.view.getComputedStyle(parent).position;
        if (position === 'static') {
          this.parentPosition = parent.style.position;
          parent.style.position = 'relative';
        }
        this.host = this.doc.createElement('div');
        this.host.setAttribute('data-vsc-twitter-mp4', '');
        this.host.style.cssText =
          'position:absolute;inset:0;z-index:2147483646;background:#000;isolation:isolate;';
        this.host.append(this.video);
        parent.append(this.host);
        this.committed = true;
        this.view.clearTimeout(this.deadline);
        this.creatingController = true;
        try {
          const rate = this.video.playbackRate;
          const rateState = this.controller.actionHandler.eventManager?.getOrCreateMediaRateState?.(
            this.video
          );
          if (rateState) {
            const revision = this.rateRevision;
            rateState.lifecycleSpeed = rateState.acceptedSpeed = rate;
            rateState.lifecycleSpeedRevision = rateState.acceptedSpeedRevision = revision;
          }
          this.video.vsc = new window.VSC.VideoController(
            this.video,
            this.host,
            this.controller.config,
            this.controller.actionHandler,
            false,
            rate
          );
        } finally {
          this.creatingController = false;
        }
        if (!this.current() || this.closed) {
          this.cleanup({ resume: false });
          return;
        }
        if (
          (wasFullscreen || requestedPresentation) &&
          !this.doc.hidden &&
          presentationRevision === window.VSC.IOSPlayer.presentationRevision
        ) {
          // Play was requested in the entry/speed command stack. Async readiness
          // may open the overlay, never Play or browser DOM fullscreen.
          this.video.vsc.iosPlayer?.open();
        }
        this.watchPlayback();
      } catch {
        this.committing = false;
        this.abort();
      }
    }

    abort() {
      if (this.closed) {
        return;
      }
      suppressAutomatic(this);
      this.cleanup({ failed: true });
      try {
        if (this.presentation && this.candidate.identityCurrent?.()) {
          const player = this.original.vsc?.iosPlayer;
          player?.setPresentationUnavailable(true);
          player?.controller.controlsManager?.inlinePlayer?.error(
            'Fullscreen is unavailable for this stream.'
          );
        }
      } catch {
        /* A replaced page player retains its own interface. */
      }
    }

    cleanup({
      resume = true,
      reinitialize = true,
      site = false,
      playing: priorPlaying,
      failed = false,
      capacity = false,
    } = {}) {
      if (this.closed) {
        return;
      }
      let preferenceRevision = failed
        ? (this.controller.config.speedPreferenceRevision ?? 0)
        : this.rateRevision;
      if (this.captionOwner && !this.captionProducerPaused && !this.committed) {
        resume = false;
      }
      const sameProducer = this.identityCurrent();
      let ownedSource = this.ownsNativeSource();
      let nativeSource = null;
      try {
        nativeSource = ownedSource ? this.video.currentSrc || this.video.src : null;
      } catch {
        ownedSource = false;
      }
      let current = sameProducer && ownedSource;
      const sourceUnchanged = () =>
        ownedSource &&
        this.ownsNativeSource() &&
        (this.video.currentSrc || this.video.src) === nativeSource;
      if (capacity) {
        if (this.observer?.takeRecords().length) {
          this.originalIntentChanged = true;
        }
        if (this.originalIntentChanged) {
          this.cleanup({ resume: false });
          return;
        }
        if (!current || !idleCompanion(this)) {
          return;
        }
      }
      // A handback is final for automatic initialization on this clip. A later
      // explicit speed command or a genuinely new SDK session may try again.
      if (this.finished && !capacity) {
        suppressAutomatic(this);
      }
      let time, playing, rate, muted, volume, captionMode;
      try {
        time = this.committed
          ? this.video.currentTime
          : sameProducer && this.finished && this.original.paused
            ? this.original.currentTime
            : this.time;
        playing =
          this.finished && (priorPlaying ?? (this.committed ? !this.video.paused : this.playing));
        // load() resets the decoder's rate; snapshot playback before disposal.
        rate = failed
          ? this.original.playbackRate === this.appliedOriginalRate
            ? this.originalRate
            : this.original.playbackRate
          : this.loopPlayback?.holdingInitialRate
            ? this.rate
            : this.video.playbackRate;
        const localRate = this.controller.actionHandler.eventManager?.getMediaRateState?.(
          this.video
        );
        if (
          localRate?.lifecycleSpeed === rate &&
          Number.isFinite(localRate.lifecycleSpeedRevision)
        ) {
          preferenceRevision = localRate.lifecycleSpeedRevision;
        }
        muted = this.video.muted;
        volume = this.video.volume;
        if (
          this.committed &&
          this.captionOwner &&
          this.candidate.captionBinding.isCurrent(this.video)
        ) {
          captionMode = this.captionOwner.mode;
        }
      } catch {
        current = false;
      }
      this.cleanupInProgress = true;
      this.cleanupPlaying = null;
      this.closed = true;
      this.cancelRelative();
      this.cancelReload();
      try {
        this.recovery?.cleanup();
      } catch {
        /* Continue cleanup. */
      }
      active.delete(this);
      originals.delete(this.original);
      players.delete(this.video);
      for (const release of [() => this.view.clearTimeout(this.deadline)]) {
        try {
          release();
        } catch {
          /* Release remaining resources through their original owners. */
        }
      }
      try {
        this.unsubscribe?.();
      } catch {
        /* Keep releasing independent resources. */
      }
      for (const remove of this.listeners) {
        try {
          remove();
        } catch {
          /* Page APIs may have changed. */
        }
      }
      try {
        this.video.vsc?.remove();
      } catch {
        /* Continue decoder and host cleanup. */
      }
      let unloadOwned = false;
      try {
        unloadOwned = sourceUnchanged();
      } catch {
        /* Unknown ownership prevents source writes, never the owned node's pause. */
      }
      try {
        // The node is ours to dispose even when a newer source belongs to the page.
        this.companionPause.call(this.video);
      } catch {
        unloadOwned = false;
      }
      try {
        unloadOwned = unloadOwned && sourceUnchanged();
      } catch {
        unloadOwned = false;
        /* Lost source ownership must not cause a foreign load or source write. */
      }
      current = current && unloadOwned;
      try {
        this.nativeObserver?.disconnect();
      } catch {
        /* Continue releasing independent resources. */
      }
      try {
        this.loopPlayback?.cleanup();
      } catch {
        /* Release the remaining native source even if a page API changed. */
      }
      try {
        this.captionOwner?.cleanup();
      } catch {
        /* Release independent native resources after the owned caption track. */
      }
      try {
        if (unloadOwned) {
          if (!this.loopPlayback && sourceUnchanged()) {
            this.video.removeAttribute('src');
          }
          if (
            !this.video.hasAttribute('src') &&
            this.video.children.length === 0 &&
            !this.video.srcObject &&
            !this.video.mediaKeys &&
            !this.video.webkitKeys &&
            (!this.video.currentSrc || this.video.currentSrc === nativeSource)
          ) {
            this.video.load();
          }
        }
      } catch {
        /* Already disposed native decoder. */
      }
      for (const node of [this.video, this.host]) {
        try {
          node?.remove();
        } catch {
          /* A page may have removed or patched an owned node. */
        }
      }
      try {
        if (this.parentPosition !== undefined && this.parent?.style.position === 'relative') {
          this.parent.style.position = this.parentPosition;
        }
      } catch {
        /* Preserve a newer parent style. */
      }
      for (const [name, { descriptor, wrapper }] of this.methods) {
        try {
          if (this.original[name] === wrapper) {
            if (descriptor) {
              Object.defineProperty(this.original, name, descriptor);
            } else {
              delete this.original[name];
            }
          } else {
            resume = false;
          }
        } catch {
          resume = false;
          /* Preserve newer site patches. */
        }
      }
      this.cleanupInProgress = false;
      if (this.cleanupPlaying !== null) {
        resume = false;
      }
      // The original source was never replaced or loaded. Revalidate after
      // reentrant controller teardown before seeking/resuming that producer.
      try {
        const stillSame = () => {
          if (this.observer?.takeRecords().length) {
            this.originalIntentChanged = true;
          }
          return (
            !this.originalIntentChanged &&
            (this.candidate.identityCurrent?.() ?? this.candidate.current()) &&
            this.original.isConnected
          );
        };
        const sameOrigin = sameProducer && stillSame();
        if (sameOrigin && current && resume) {
          try {
            if (
              ['showing', 'hidden', 'disabled'].includes(captionMode) &&
              this.candidate.captionBinding.isCurrent(this.video)
            ) {
              this.candidate.captionBinding.track.mode = captionMode;
            }
          } catch {
            /* A caption-mode failure must not prevent the remaining guarded handback. */
          }
          try {
            this.original.muted = muted;
            this.original.volume = volume;
            this.original.playbackRate = rate;
            if (Number.isFinite(time) && stillSame()) {
              this.candidate.api.seekTo(time);
            }
          } catch {
            /* Restore the interface even when a page transport method fails. */
          }
          if (failed) {
            const state = this.controller.actionHandler.eventManager?.getOrCreateMediaRateState?.(
              this.original
            );
            if (state) {
              state.lifecycleSpeed = state.acceptedSpeed = this.original.playbackRate;
              state.lifecycleSpeedRevision = state.acceptedSpeedRevision = preferenceRevision;
            }
          }
        }
        if (sameOrigin && current && resume && playing && !this.doc.hidden && stillSame()) {
          const state = this.controller.actionHandler.eventManager?.getOrCreateMediaRateState?.(
            this.original
          );
          if (state) {
            state.lifecycleSpeed = state.acceptedSpeed = rate;
            state.lifecycleSpeedRevision = state.acceptedSpeedRevision = preferenceRevision;
          }
          try {
            const request = {};
            recoveryRequests.set(this.original, request);
            const reportFailure = (error) => {
              if (
                error?.name !== 'AbortError' &&
                recoveryRequests.get(this.original) === request &&
                this.original.paused &&
                stillSame() &&
                this.original.ownerDocument === this.doc &&
                this.doc.documentElement === this.root &&
                this.doc.URL === this.url
              ) {
                this.original.vsc?.controlsManager?.inlinePlayer?.error(
                  'Playback could not start.'
                );
              }
              if (recoveryRequests.get(this.original) === request) {
                recoveryRequests.delete(this.original);
              }
            };
            try {
              this.originalPlay.call(this.original)?.then?.(() => {
                if (recoveryRequests.get(this.original) === request) {
                  recoveryRequests.delete(this.original);
                }
              }, reportFailure);
            } catch (error) {
              reportFailure(error);
            }
          } catch {
            /* A refused resume must not strand the original interface. */
          }
        }
        if (site && sameOrigin) {
          window.VSC.IOSPlayer.siteRelinquished.add(this.original);
        }
        if (
          reinitialize &&
          this.committed &&
          sameOrigin &&
          stillSame() &&
          !window.VSC_controller?.teardownRequested &&
          this.controller.config.settings.enabled !== false
        ) {
          const initialSpeed = this.original.playbackRate;
          const state = this.controller.actionHandler.eventManager?.getOrCreateMediaRateState?.(
            this.original
          );
          if (state) {
            state.lifecycleSpeed = state.acceptedSpeed = initialSpeed;
            state.lifecycleSpeedRevision = state.acceptedSpeedRevision = preferenceRevision;
          }
          window.VSC_controller?.onVideoFound(this.original, this.original.parentElement, {
            forceAttach: true,
            initialSpeed,
          });
        }
        if (failed && sameOrigin && current && resume && stillSame()) {
          const shadow = this.original.vsc?.div?.shadowRoot;
          if (shadow) {
            window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, this.original.playbackRate);
          }
        }
      } catch {
        /* A replaced/detached page player retains its latest intent. */
      } finally {
        try {
          this.observer?.disconnect();
        } catch {
          /* Release the original observer after reentrant handback checks. */
        }
      }
    }
  }

  window.VSC.TwitterMP4Playback = {
    get: (video) => players.get(video),
    fullscreenBoundary(video) {
      try {
        const session = players.get(video);
        const factory = session?.candidate.fullscreenBoundary;
        const controller = video?.vsc;
        const source = video?.getAttribute('src');
        const poster = video?.getAttribute('poster');
        const current = () =>
          players.get(video) === session &&
          session?.committed &&
          !session.closed &&
          !session.committing &&
          !session.creatingController &&
          session.video === video &&
          video.vsc === controller &&
          controller?.video === video &&
          !controller.disposed &&
          video.getAttribute('src') === source &&
          video.getAttribute('poster') === poster &&
          video.isConnected &&
          session.current();
        if (!current() || typeof factory !== 'function') {
          return null;
        }
        const boundary = factory.call(session.candidate);
        const element = boundary?.element;
        const isCurrent = boundary?.current;
        const activate = boundary?.activate;
        if (
          typeof isCurrent !== 'function' ||
          typeof activate !== 'function' ||
          !(element instanceof session.view.HTMLElement) ||
          element === session.original ||
          element === video ||
          element === session.doc.body ||
          element === session.root ||
          element.ownerDocument !== session.doc ||
          !element.contains(session.original) ||
          !current()
        ) {
          return null;
        }
        const valid = () => {
          try {
            return Boolean(
              current() &&
              session.candidate.fullscreenBoundary === factory &&
              boundary.element === element &&
              boundary.current === isCurrent &&
              boundary.activate === activate &&
              element.isConnected &&
              isCurrent.call(boundary) &&
              current()
            );
          } catch {
            return false;
          }
        };
        if (!valid()) {
          return null;
        }
        return {
          element,
          current: valid,
          activate() {
            try {
              return valid() && activate.call(boundary) === true && valid();
            } catch {
              return false;
            }
          },
        };
      } catch {
        return null;
      }
    },
    getPending: (video) => {
      const session = originals.get(video);
      return session && !session.committed ? session : null;
    },
    cancelPresentation(video, { resume = true } = {}) {
      const session = originals.get(video);
      if (session?.presentation && !session.committing && !session.committed) {
        session.cleanup({ resume });
      }
    },
    open(controller, options = {}) {
      let scoped = false;
      let session;
      try {
        const video = controller?.video;
        if (
          !video ||
          players.has(video) ||
          !window.VSC.IOSPlayer?.isSupported(video) ||
          !window.VSC.EventManager.isTwitterHost(new URL(video.ownerDocument.URL).hostname)
        ) {
          return null;
        }
        scoped = true;
        if (!(video.currentSrc || video.src).startsWith('blob:')) {
          return null;
        }
        // Portaling an original X MSE node can detach its SourceBuffers in
        // WebKit. Unsupported streams stay inline rather than taking that path.
        if (options.automatic || controller.disposed || video.ownerDocument.hidden) {
          return false;
        }
        session = this.begin(controller, video.playbackRate, 'presentation');
        if (!session || !session.current()) {
          session?.cleanup({ resume: false });
          return false;
        }
        session.presentation = { revision: window.VSC.IOSPlayer.presentationRevision };
        if (options.play) {
          session.playing = true;
          if (session.finished) {
            session.requestPlay();
          }
        }
        session.finish();
        return !session.closed;
      } catch {
        session?.cleanup();
        return scoped ? false : null;
      }
    },
    isRetained: (video) => originals.get(video)?.committed === true,
    controllerRemoved(video) {
      recoveryRequests.delete(video);
      const original = originals.get(video);
      if (original && !original.committing) {
        original.cleanup({ resume: false, reinitialize: false });
      }
      const companion = players.get(video);
      if (companion?.creatingController) {
        companion.abort();
      } else {
        companion?.cleanup();
      }
    },
    mediaRemoved(video) {
      const original = originals.get(video);
      if (original && (!video.isConnected || !original.originCurrent())) {
        original.cleanup({ resume: false, reinitialize: false });
      }
      if (!video.isConnected) {
        players.get(video)?.cleanup();
      }
    },
    cleanupAll() {
      for (const session of [...active]) {
        session.cleanup({ reinitialize: false });
      }
    },
    canBegin(controller, rate, source = 'init') {
      try {
        return (
          (active.size < 4 || [...active].some(reclaimable)) &&
          !originals.has(controller?.video) &&
          Boolean(resolve(controller, rate, source))
        );
      } catch {
        return false;
      }
    },
    begin(controller, rate, source = 'internal') {
      let session;
      try {
        if (source !== 'init') {
          players.get(controller?.video)?.cancelReload();
        }
        if (controller?.video) {
          recoveryRequests.delete(controller.video);
        }
        if (!controller || players.has(controller.video) || source === 'external') {
          return null;
        }
        const prior = originals.get(controller.video);
        if (prior) {
          if (source === 'presentation') {
            return prior;
          }
          if (rate <= 2) {
            prior.cleanup();
            return null;
          }
          prior.applyRate(rate, controller.config.speedPreferenceRevision ?? 0);
          return prior;
        }
        const candidate = resolve(controller, rate, source);
        if (!candidate) {
          return null;
        }
        if (active.size >= 4) {
          let idle;
          for (const entry of active) {
            if (!idleCompanion(entry)) {
              continue;
            }
            if (!entry.current()) {
              if (entry.originalIntentChanged) {
                entry.cleanup({ resume: false });
              }
              if (active.size < 4) {
                break;
              }
            } else if (idleCompanion(entry)) {
              idle = entry;
              break;
            }
          }
          if (active.size >= 4) {
            if (!idle || !candidate.current() || !idleCompanion(idle)) {
              return null;
            }
            if (idle.observer?.takeRecords().length) {
              idle.originalIntentChanged = true;
              idle.cleanup({ resume: false });
              return null;
            }
            // Reuse paused handback: retain its position without starting the producer.
            idle.cleanup({ playing: false, capacity: true });
          }
          if (!candidate.current()) {
            return null;
          }
        }
        if (active.size >= 4) {
          return null;
        }
        session = new TwitterMP4Session(controller, candidate, rate, source);
        if (active.size >= 4 || originals.has(controller.video)) {
          session.closed = true;
          session.recovery.cleanup();
          return null;
        }
        originals.set(controller.video, session);
        players.set(session.video, session);
        active.add(session);
        session.start();
        return session.closed ? null : session;
      } catch {
        session?.cleanup({ resume: session.finished });
        return null;
      }
    },
  };
})();

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

  function resolve(controller, rate, source) {
    if (
      !controller ||
      source === 'external' ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      (rate <= 2 && source !== 'presentation') ||
      controller.disposed ||
      active.size >= 4 ||
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
    const candidate = window.VSC.TwitterPlayer?.resolve(
      controller.video,
      controller.iosPlayer?.active ? controller.iosPlayer.originParent : null,
      { allowSourceChild: source === 'presentation' }
    );
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
      this.listeners = [];
      this.methods = new Map();
      this.closed = false;
      this.committed = false;
      this.committing = false;
      this.finished = false;
      this.ready = false;
      this.playReady = false;
      this.playGeneration = 0;
      this.originalPlay = this.original.play;
      this.originalPause = this.original.pause;
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
          this.candidate.current(this.video)
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

    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    }

    start() {
      if (!this.originCurrent()) {
        throw new Error('X playback identity changed');
      }
      const video = this.video;
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', '');
      video.controls = true;
      video.preload = 'auto';
      video.loop = this.candidate.loop;
      video.muted = this.original.muted;
      video.volume = this.original.volume;
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
          if (!session.current()) {
            session.cleanup({ resume: false });
            return originalMethod.apply(this, args);
          }
          session.playing = name === 'play';
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
        this.ready = true;
        if (this.finished) {
          this.commit();
        }
      });
      this.listen(video, 'error', () => this.abort());
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
      this.listen(this.original, 'seeking', yieldToSite);
      this.listen(this.original, 'playing', () => {
        // A site may have captured the native method before our wrapper.
        if (!this.original.paused) {
          this.cleanup({ resume: false });
        }
      });
      this.listen(this.view, 'pagehide', yieldToSite);
      this.listen(this.doc, 'visibilitychange', () => {
        if (this.presentation && !this.committed && this.doc.hidden) {
          this.cleanup({ resume: false });
        }
      });
      this.deadline = this.view.setTimeout(() => this.abort(), 10000);
      video.src = this.candidate.progressiveUrl;
      video.load();
      video.currentTime = this.time;
      video.playbackRate = this.rate;
      this.nativeObserver = new this.view.MutationObserver(() => this.cleanup());
      this.nativeObserver.observe(video, {
        attributes: true,
        attributeFilter: ['src', 'poster'],
      });
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
      // Both pause and the new play request occur in the speed command's
      // stack. Metadata callbacks only attach presentation; they never play.
      this.originalPause.call(this.original);
      if (!this.current()) {
        this.cleanup({ resume: this.identityCurrent() });
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
            this.video.pause();
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
          this.abort();
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
    } = {}) {
      if (this.closed) {
        return;
      }
      let preferenceRevision = failed
        ? (this.controller.config.speedPreferenceRevision ?? 0)
        : this.rateRevision;
      const sameProducer = this.identityCurrent();
      let current = sameProducer && this.ownsNativeSource();
      // A handback is final for automatic initialization on this clip. A later
      // explicit speed command or a genuinely new SDK session may try again.
      if (this.finished) {
        suppressAutomatic(this);
      }
      let time, playing, rate, muted, volume;
      try {
        time = this.committed ? this.video.currentTime : this.time;
        playing =
          this.finished && (priorPlaying ?? (this.committed ? !this.video.paused : this.playing));
        // load() resets the decoder's rate; snapshot playback before disposal.
        rate = failed
          ? this.original.playbackRate === this.appliedOriginalRate
            ? this.originalRate
            : this.original.playbackRate
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
      } catch {
        current = false;
      }
      this.closed = true;
      active.delete(this);
      originals.delete(this.original);
      players.delete(this.video);
      for (const release of [
        () => this.view.clearTimeout(this.deadline),
        () => this.nativeObserver?.disconnect(),
      ]) {
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
      for (const [name, { descriptor, wrapper }] of this.methods) {
        try {
          if (this.original[name] === wrapper) {
            if (descriptor) {
              Object.defineProperty(this.original, name, descriptor);
            } else {
              delete this.original[name];
            }
          }
        } catch {
          /* Preserve newer site patches. */
        }
      }
      try {
        this.video.vsc?.remove();
      } catch {
        /* Continue decoder and host cleanup. */
      }
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
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
        return !originals.has(controller?.video) && Boolean(resolve(controller, rate, source));
      } catch {
        return false;
      }
    },
    begin(controller, rate, source = 'internal') {
      let session;
      try {
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
          prior.rate = rate;
          prior.rateRevision = controller.config.speedPreferenceRevision ?? 0;
          prior.video.playbackRate = rate;
          return prior;
        }
        const candidate = resolve(controller, rate, source);
        if (!candidate) {
          return null;
        }
        session = new TwitterMP4Session(controller, candidate, rate, source);
        originals.set(controller.video, session);
        players.set(session.video, session);
        active.add(session);
        session.start();
        return session.closed ? null : session;
      } catch {
        session?.cleanup();
        return null;
      }
    },
  };
})();

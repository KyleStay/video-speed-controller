/** Bounded decoded-frame evidence; the owning session alone changes transport. */
window.VSC = window.VSC || {};

window.VSC.DecodedPlaybackMonitor = class DecodedPlaybackMonitor {
  constructor(video, current, stalled) {
    this.video = video;
    this.doc = video.ownerDocument;
    this.view = this.doc.defaultView;
    this.current = current;
    this.stalled = stalled;
    try {
      if (this.view.IntersectionObserver) {
        this.intersection = new this.view.IntersectionObserver(([entry]) => {
          this.intersecting = entry.isIntersecting;
          if (this.intersecting) {
            this.start();
          } else {
            this.stop();
          }
        });
        this.intersection.observe(video);
      }
    } catch (error) {
      try {
        this.intersection?.disconnect();
      } catch {
        /* Preserve the original API failure. */
      }
      throw error;
    }
  }

  stop() {
    const watch = this.watch;
    this.watch = null;
    try {
      this.view.clearTimeout(watch?.timer);
    } catch {
      /* Release independently. */
    }
    try {
      if (watch?.frame !== undefined) {
        this.video.cancelVideoFrameCallback(watch.frame);
      }
    } catch {
      /* A page may replace the API. */
    }
  }

  start() {
    if (this.watch) {
      return;
    }
    try {
      const video = this.video;
      const eligible = () => {
        if (!this.current()) {
          return false;
        }
        const rect = video.getBoundingClientRect(),
          style = this.view.getComputedStyle(video);
        return (
          !this.doc.hidden &&
          !video.paused &&
          !video.ended &&
          !video.seeking &&
          video.playbackRate >= 2.1 &&
          video.readyState >= 3 &&
          Number.isFinite(video.duration) &&
          video.duration - video.currentTime > video.playbackRate &&
          !video.webkitDisplayingFullscreen &&
          (!video.webkitPresentationMode || video.webkitPresentationMode === 'inline') &&
          this.doc.pictureInPictureElement !== video &&
          this.doc.fullscreenElement !== video &&
          this.intersecting !== false &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < this.view.innerHeight &&
          rect.left < this.view.innerWidth &&
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          Number(style.opacity) !== 0 &&
          (!video.checkVisibility ||
            video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        );
      };
      if (!eligible() || typeof video.requestVideoFrameCallback !== 'function') {
        return;
      }
      const quality = () => video.getVideoPlaybackQuality?.().totalVideoFrames;
      const count = quality();
      if (!Number.isSafeInteger(count) || count < 0) {
        return;
      }
      const watch = (this.watch = { count, progress: this.view.performance.now() });
      const frame = (_now, metadata) => {
        if (this.watch !== watch) {
          return;
        }
        if (watch.requesting) {
          this.stop();
          return;
        }
        if (
          Number.isFinite(metadata?.mediaTime) &&
          Number.isFinite(metadata?.presentedFrames) &&
          (!watch.metadata ||
            metadata.mediaTime > watch.metadata.mediaTime ||
            metadata.presentedFrames > watch.metadata.presentedFrames)
        ) {
          watch.progress = this.view.performance.now();
          watch.metadata = {
            mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames,
          };
        }
        request();
      };
      const request = () => {
        watch.requesting = true;
        let handle;
        try {
          handle = video.requestVideoFrameCallback(frame);
        } catch {
          watch.requesting = false;
          this.stop();
          return;
        }
        watch.requesting = false;
        if (!Number.isSafeInteger(handle) || handle < 0 || this.watch !== watch) {
          this.stop();
          return;
        }
        watch.frame = handle;
      };
      const check = () => {
        if (this.watch !== watch) {
          return;
        }
        try {
          const next = quality(),
            now = this.view.performance.now();
          if (!eligible() || !Number.isSafeInteger(next) || next < watch.count) {
            this.stop();
            return;
          }
          if (next > watch.count) {
            watch.count = next;
            watch.progress = now;
          }
          const remaining = 3000 - (now - watch.progress);
          if (remaining > 0) {
            watch.timer = this.view.setTimeout(check, remaining);
            return;
          }
          let buffered = false;
          for (let i = 0; i < Math.min(video.buffered.length, 32); i++) {
            if (
              video.buffered.start(i) <= video.currentTime &&
              video.buffered.end(i) >= video.currentTime + 1
            ) {
              buffered = true;
            }
          }
          if (!buffered) {
            watch.progress = now;
            watch.timer = this.view.setTimeout(check, 3000);
            return;
          }
          this.stop();
          if (eligible()) {
            this.stalled();
          }
        } catch {
          this.stop();
        }
      };
      request();
      if (this.watch === watch) {
        watch.timer = this.view.setTimeout(check, 3000);
      }
    } catch {
      this.stop();
    }
  }

  cleanup() {
    this.stop();
    try {
      this.intersection?.disconnect();
    } catch {
      /* Release the scheduling owner. */
    }
  }
};

// Explicit session composition: owners retain source and caption authority.
window.VSC.OwnedMP4Recovery = class OwnedMP4Recovery {
  constructor(owner) {
    this.owner = owner;
    this.video = owner.video;
    this.doc = owner.doc;
    this.view = owner.view;
    owner.playGeneration ||= 0;
    this.listeners = [];
    try {
      const listen = (target, type, callback, options) => {
        target.addEventListener(type, callback, options);
        this.listeners.push(() => target.removeEventListener(type, callback, options));
      };
      for (const type of ['emptied', 'loadstart']) {
        listen(
          this.video,
          type,
          () => {
            const token = this.reload;
            if (token && !token.events.has(type) && this.reloadCurrent(token)) {
              token.events.add(type);
            } else {
              this.cancel();
            }
          },
          true
        );
      }
      listen(this.video, 'loadeddata', () => {
        if (this.reload) {
          this.reload.ready = true;
        }
        this.refresh();
      });
      for (const type of ['playing', 'seeked', 'ratechange']) {
        listen(this.video, type, () => {
          if (this.reload) {
            if (type === 'seeked') {
              this.refresh();
            }
          } else {
            this.monitor?.stop();
            this.start();
          }
        });
      }
      listen(this.doc, 'visibilitychange', () => {
        if (this.doc.hidden) {
          this.cancel();
        } else {
          this.refresh();
        }
      });
      listen(this.view, 'pagehide', () => this.cancel());
      listen(this.view, 'pageshow', () => this.refresh());
      this.bindIntent = () => {
        listen(this.video, 'pause', () => {
          if (!this.reload?.loading) {
            this.cancel();
          }
        });
        listen(this.video, 'seeking', () => {
          const token = this.reload;
          if (
            token &&
            !token.sought &&
            Math.abs(this.video.currentTime - token.time) < 0.25 &&
            this.reloadCurrent(token, true, true)
          ) {
            token.sought = true;
          } else {
            this.cancel();
          }
        });
        for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
          listen(
            this.view,
            type,
            (event) => {
              if (event.isTrusted) {
                this.cancel();
              }
            },
            { capture: true, passive: true }
          );
        }
      };
    } catch {
      this.cleanup();
    }
  }

  cancel() {
    this.monitor?.stop();
    if (this.reload) {
      this.reload = null;
      this.owner.playGeneration++;
      try {
        this.view.clearTimeout(this.deadline);
      } catch {
        /* Keep cancellation final. */
      }
    }
    this.start();
  }

  reloadCurrent(token, allowPaused = false, expectedSeek = false) {
    try {
      if (this.reload !== token || token.generation !== this.owner.playGeneration) {
        return false;
      }
      const current = this.owner.recoveryCurrent(true);
      const player = this.video.vsc?.iosPlayer;
      return (
        this.reload === token &&
        token.generation === this.owner.playGeneration &&
        !this.doc.hidden &&
        current &&
        this.video.getAttribute('poster') === token.poster &&
        this.video.muted === token.muted &&
        this.video.volume === token.volume &&
        this.video.vsc === token.controller &&
        player === token.player &&
        player?.active === token.active &&
        player?.ui === token.ui &&
        player?.nativeGeneration === token.nativeGeneration &&
        window.VSC.IOSPlayer.presentationRevision === token.presentationRevision &&
        this.owner.controller.config.speedPreferenceRevision === token.revision &&
        this.owner.controller.config.settings.lastSpeed === token.preference &&
        (token.command ||
          ((allowPaused || !this.video.paused) &&
            (!this.video.seeking ||
              ((expectedSeek || token.sought) &&
                Math.abs(this.video.currentTime - token.time) < 0.25)) &&
            this.video.playbackRate === token.rate))
      );
    } catch {
      return false;
    }
  }

  ownsTransition(type) {
    return Boolean(
      this.reload &&
      (type ? this.reload.events.has(type) : this.reload.events.size) &&
      this.reloadCurrent(this.reload)
    );
  }

  finishReload(token) {
    if (this.reload !== token || !token.ready || !token.accepted) {
      return;
    }
    if (!this.reloadCurrent(token)) {
      this.cancel();
      return;
    }
    if (!this.video.seeking && this.owner.recoveryCurrent(false)) {
      this.cancel();
    }
  }

  refresh() {
    if (this.reload) {
      this.finishReload(this.reload);
    } else {
      this.start();
    }
  }

  start() {
    if (this.closed || this.owner.closed || this.reload) {
      return;
    }
    try {
      this.bindIntent?.();
      this.bindIntent = null;
      this.monitor ||= new window.VSC.DecodedPlaybackMonitor(
        this.video,
        () => !this.reload && !this.closed && this.owner.recoveryCurrent(false),
        () => this.reloadVideo()
      );
      this.monitor.start();
    } catch {
      this.cleanup();
    }
  }

  reloadVideo() {
    if ((this.reloadAttempts || 0) >= 2) {
      this.owner.recoveryFailed();
      return;
    }
    let fail;
    try {
      if (!this.owner.recoveryCurrent(false) || this.video.paused || this.doc.hidden) {
        return;
      }
      const video = this.video,
        player = video.vsc?.iosPlayer;
      const token = (this.reload = {
        generation: ++this.owner.playGeneration,
        time: video.currentTime,
        rate: video.playbackRate,
        muted: video.muted,
        volume: video.volume,
        poster: video.getAttribute('poster'),
        controller: video.vsc,
        player,
        active: player?.active,
        ui: player?.ui,
        nativeGeneration: player?.nativeGeneration,
        presentationRevision: window.VSC.IOSPlayer.presentationRevision,
        revision: this.owner.controller.config.speedPreferenceRevision,
        preference: this.owner.controller.config.settings.lastSpeed,
        events: new Set(),
        command: true,
      });
      fail = () => {
        if (this.reload !== token) {
          return;
        }
        if (this.reloadCurrent(token, true)) {
          this.owner.recoveryFailed();
        } else {
          this.cancel();
        }
      };
      const valid = () => {
        if (this.reloadCurrent(token)) {
          return true;
        }
        this.cancel();
        return false;
      };
      if (!valid()) {
        return;
      }
      this.reloadAttempts = (this.reloadAttempts || 0) + 1;
      this.deadline = this.view.setTimeout(fail, 10000);
      const load = video.load;
      if (!valid()) {
        return;
      }
      token.loading = true;
      Reflect.apply(load, video, []);
      token.loading = false;
      if (!valid()) {
        return;
      }
      video.currentTime = token.time;
      if (!valid()) {
        return;
      }
      video.playbackRate = token.rate;
      if (!valid()) {
        return;
      }
      const play = video.play;
      if (!valid()) {
        return;
      }
      const playing = Reflect.apply(play, video, []);
      Promise.resolve(playing).then(() => {
        if (this.reloadCurrent(token)) {
          token.accepted = true;
          this.finishReload(token);
        } else if (this.reload === token) {
          this.cancel();
        }
      }, fail);
      if (!valid()) {
        return;
      }
      token.command = false;
      this.finishReload(token);
    } catch {
      fail?.();
    }
  }

  cleanup() {
    this.closed = true;
    this.cancel();
    try {
      this.monitor?.cleanup();
    } catch {
      /* Release listeners independently. */
    }
    for (const remove of this.listeners.splice(0)) {
      try {
        remove();
      } catch {
        /* Release other subscriptions after a page patch. */
      }
    }
  }
};

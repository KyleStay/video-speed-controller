/** Bounded decoded-frame recovery for an already owned iOS X MP4 session. */
window.VSC = window.VSC || {};

class TwitterPlaybackHealth {
  constructor(controller) {
    this.controller = controller;
    this.video = controller.video;
    this.doc = this.video.ownerDocument;
    this.view = this.doc.defaultView;
    this.listeners = [];
    this.attempts = 0;
    this.generation = 0;
    this.lastResult = { status: 'inactive' };
    this.lastRecovery = null;
    try {
      if (
        !window.VSC.IOSPlayer?.isSupported(this.video) ||
        !window.VSC.EventManager.isTwitterHost(new URL(this.doc.URL).hostname) ||
        typeof this.video.requestVideoFrameCallback !== 'function' ||
        typeof this.video.cancelVideoFrameCallback !== 'function'
      ) {
        return;
      }
      this.enabled = true;
      this.intersecting = !this.view.IntersectionObserver;
      const refresh = () => this.refresh();
      const stop = () => this.stop();
      for (const type of ['play', 'playing', 'seeked', 'ratechange']) {
        this.listen(this.video, type, refresh);
      }
      for (const type of ['loadeddata', 'canplay', 'progress']) {
        this.listen(this.video, type, () => {
          if (this.timer === undefined) {
            this.refresh();
          }
        });
      }
      for (const type of ['pause', 'seeking', 'ended', 'webkitbeginfullscreen']) {
        this.listen(this.video, type, stop);
      }
      this.listen(this.doc, 'visibilitychange', refresh);
      this.listen(this.view, 'pagehide', () => {
        this.suspended = true;
        this.stop();
      });
      this.listen(this.view, 'pageshow', (event) => {
        if (event.persisted) {
          this.suspended = false;
          this.refresh();
        }
      });
      this.listen(this.video, 'webkitpresentationmodechanged', refresh);
      this.listen(this.video, 'enterpictureinpicture', stop);
      this.listen(this.video, 'leavepictureinpicture', refresh);
      if (this.view.IntersectionObserver) {
        this.observer = new this.view.IntersectionObserver((entries) => {
          if (this.disposed) {
            return;
          }
          try {
            for (const entry of entries) {
              if (entry.target === this.video) {
                this.intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
                this.refresh();
              }
            }
          } catch {
            this.stop();
          }
        });
        this.observer.observe(this.video);
      }
      this.refresh();
    } catch {
      this.cleanup();
    }
  }

  listen(target, type, callback) {
    target.addEventListener(type, callback);
    this.listeners.push(() => target.removeEventListener(type, callback));
  }

  quality() {
    const count = this.video.getVideoPlaybackQuality?.().totalVideoFrames;
    return Number.isFinite(count) && count >= 0 ? count : null;
  }

  eligible() {
    const video = this.video;
    if (
      !this.enabled ||
      this.disposed ||
      this.suspended ||
      this.controller.disposed ||
      video.vsc !== this.controller ||
      video.ownerDocument !== this.doc ||
      this.doc.defaultView !== this.view ||
      !video.isConnected ||
      this.doc.hidden ||
      !this.intersecting ||
      this.controller.config?.settings?.enabled === false ||
      video.paused ||
      video.ended ||
      video.seeking ||
      !Number.isFinite(video.playbackRate) ||
      video.playbackRate < 2.1 ||
      video.readyState < 3 ||
      !Number.isFinite(video.duration) ||
      video.duration - video.currentTime <= Math.max(1, video.playbackRate) ||
      this.controller.iosPlayer?.nativeSession ||
      video.webkitDisplayingFullscreen ||
      (video.webkitPresentationMode && video.webkitPresentationMode !== 'inline') ||
      this.doc.pictureInPictureElement === video ||
      this.doc.fullscreenElement === video
    ) {
      return null;
    }
    let ancestor = video;
    // Observed X feed clips have 45 visible ancestors. Keep the visibility
    // check bounded while allowing those clips to reach their document root.
    for (let depth = 0; ancestor && depth < 64; depth++) {
      const style = this.view.getComputedStyle(ancestor);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.contentVisibility === 'hidden'
      ) {
        return null;
      }
      ancestor = ancestor.parentElement || ancestor.getRootNode()?.host;
    }
    if (ancestor) {
      return null;
    }
    const rect = video.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= this.view.innerHeight ||
      rect.left >= this.view.innerWidth
    ) {
      return null;
    }
    let buffered = false;
    // TimeRanges is page-owned; bound even a malformed replacement.
    for (let i = 0, length = Math.min(video.buffered.length, 32); i < length; i++) {
      if (
        video.buffered.start(i) <= video.currentTime &&
        video.buffered.end(i) >= video.currentTime + 1
      ) {
        buffered = true;
        break;
      }
    }
    if (!buffered || this.quality() === null) {
      return null;
    }
    return window.VSC.TwitterPlaybackRecovery?.identity(this.controller) || null;
  }

  refresh() {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      const identity = this.eligible();
      if (!identity) {
        this.stop();
        return;
      }
      if (identity !== this.identity) {
        this.stop();
        this.clearStall();
        this.identity = identity;
        this.attempts = 0;
        this.lastRecovery = null;
      }
      if (this.timer !== undefined || this.frame !== undefined) {
        return;
      }
      this.baseline = this.quality();
      this.clock = this.video.currentTime;
      this.lastFrame = this.view.performance.now();
      this.frameMetadata = null;
      this.lastResult = { status: 'armed', attempts: this.attempts };
      const generation = this.generation;
      this.requestFrame(generation);
      this.schedule(generation, 3000);
    } catch {
      this.stop();
    } finally {
      this.refreshing = false;
    }
  }

  requestFrame(generation) {
    this.requesting = true;
    let handle;
    try {
      handle = this.video.requestVideoFrameCallback((_now, metadata) => {
        if (this.disposed || generation !== this.generation) {
          return;
        }
        // A page-defined synchronous callback must not recurse or outlive stop().
        if (this.requesting) {
          this.stop();
          return;
        }
        this.frame = undefined;
        try {
          const frames = metadata?.presentedFrames;
          const time = metadata?.mediaTime;
          const validFrames = Number.isFinite(frames) && frames >= 0;
          const validTime = Number.isFinite(time) && time >= 0;
          const previous = this.frameMetadata;
          if (
            (validFrames && (!previous || frames > previous.frames)) ||
            (validTime && (!previous || time > previous.time))
          ) {
            this.lastFrame = this.view.performance.now();
            this.frameMetadata = {
              frames: validFrames ? frames : -1,
              time: validTime ? time : -1,
            };
            // One retained callback can be stale. Require a second advancing
            // sample, and fresh ownership, before claiming frames resumed.
            if (
              ((validFrames && previous?.frames >= 0 && frames > previous.frames) ||
                (validTime && previous?.time >= 0 && time > previous.time)) &&
              this.lastRecovery &&
              this.lastRecovery.status !== 'frames-resumed' &&
              window.VSC.TwitterPlaybackRecovery?.identity(this.controller) === this.identity
            ) {
              this.lastRecovery = { ...this.lastRecovery, status: 'frames-resumed', frames: 2 };
              this.clearStall();
            }
          }
          this.requestFrame(generation);
        } catch {
          this.stop();
        }
      });
    } finally {
      this.requesting = false;
    }
    if (!Number.isSafeInteger(handle) || handle < 0) {
      this.stop();
      return;
    }
    if (generation === this.generation && !this.disposed) {
      this.frame = handle;
    } else {
      this.video.cancelVideoFrameCallback(handle);
    }
  }

  check(generation) {
    if (this.disposed || generation !== this.generation) {
      return;
    }
    this.timer = undefined;
    try {
      if (this.eligible() !== this.identity) {
        this.stop();
        return;
      }
      const quality = this.quality();
      if (quality !== this.baseline) {
        this.baseline = quality;
        this.clock = this.video.currentTime;
        this.schedule(generation, 3000);
        return;
      }
      const gapMs = this.view.performance.now() - this.lastFrame;
      if (gapMs < 3000) {
        this.schedule(generation, 3000 - gapMs);
        return;
      }
      const clockAdvance = this.video.currentTime - this.clock;
      this.stop();
      if (this.attempts >= 2) {
        this.lastRecovery = {
          status: 'exhausted',
          attempt: this.attempts,
          frames: 0,
          gapMs,
        };
        this.lastResult = { status: 'exhausted', attempts: this.attempts, clockAdvance };
        window.VSC.TwitterPlaybackRecovery?.reportStall?.(this.controller);
        return;
      }
      this.attempts++;
      const recovery = { status: 'requested', attempt: this.attempts, frames: 0, gapMs };
      this.lastRecovery = recovery;
      const accepted = window.VSC.TwitterPlaybackRecovery?.reload(this.controller) === true;
      if (this.lastRecovery !== recovery || this.disposed) {
        return;
      }
      if (!accepted) {
        recovery.status = 'refused';
      }
      this.lastResult = {
        status: accepted ? 'reload-accepted' : 'reload-refused',
        attempts: this.attempts,
        clockAdvance,
      };
      if (accepted) {
        this.refresh();
      }
    } catch {
      this.stop();
      if (this.lastRecovery?.status === 'requested') {
        this.lastRecovery.status = 'refused';
      }
      this.lastResult = { status: 'unavailable', attempts: this.attempts };
    }
  }

  schedule(generation, delay) {
    if (generation === this.generation && !this.disposed) {
      this.timer = this.view.setTimeout(() => this.check(generation), delay);
    }
  }

  stop() {
    this.generation++;
    if (this.timer !== undefined) {
      try {
        this.view.clearTimeout(this.timer);
      } catch {
        /* Original window may be gone. */
      }
      this.timer = undefined;
    }
    if (this.frame !== undefined) {
      try {
        this.video.cancelVideoFrameCallback(this.frame);
      } catch {
        /* Page API may throw. */
      }
      this.frame = undefined;
    }
  }

  sourceChanged(ownedTransition = false) {
    this.stop();
    if (!ownedTransition) {
      this.clearStall();
      this.identity = null;
      this.attempts = 0;
      this.lastRecovery = null;
    }
  }

  cleanup() {
    this.disposed = true;
    this.stop();
    this.clearStall();
    try {
      this.observer?.disconnect();
    } catch {
      /* Page API may throw. */
    }
    for (const remove of this.listeners.splice(0)) {
      try {
        remove();
      } catch {
        /* Continue releasing the remaining resources. */
      }
    }
  }

  clearStall() {
    try {
      if (this.video.vsc === this.controller) {
        window.VSC.TwitterPlaybackRecovery?.clearStall?.(this.controller);
      }
    } catch {
      /* Releasing an owned warning must not block source or controller cleanup. */
    }
  }
}

window.VSC.TwitterPlaybackHealth = TwitterPlaybackHealth;

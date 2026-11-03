window.VSC = window.VSC || {};

/** Repeat complete supplied fragments without seeking the native decoder at each seam. */
window.VSC.TwitterLoopPlayback = class TwitterLoopPlayback {
  static canUse(owner) {
    try {
      const url = new URL(owner.candidate.sourceUrl);
      const asset = url.pathname.match(/^\/(amplify_video|ext_tw_video)\/(\d+)\/.+\.m3u8$/);
      return Boolean(
        typeof owner.view.ManagedMediaSource === 'function' &&
        typeof window.VSC.TwitterLoopSource?.create === 'function' &&
        owner.candidate.loop === true &&
        (!owner.candidate.captionBinding ||
          (window.VSC.TwitterCaptionPlayback?.isLoopOwner?.(owner.captionOwner) === true &&
            owner.captionOwner.isCurrent() === true)) &&
        owner.original.audioTracks?.length === 1 &&
        owner.original.audioTracks[0].enabled === true &&
        owner.original.webkitCurrentPlaybackTargetIsWireless !== true &&
        url.protocol === 'https:' &&
        url.hostname === 'video.twimg.com' &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        asset?.[2] === owner.candidate.contentId &&
        Number.isFinite(owner.original.duration) &&
        owner.original.duration >= 1 &&
        owner.original.duration <= 60 &&
        ['currentTime', 'duration', 'buffered', 'seekable'].every(
          (key) => !Object.hasOwn(owner.video, key)
        )
      );
    } catch {
      return false;
    }
  }

  constructor(owner, callbacks) {
    if (!TwitterLoopPlayback.canUse(owner)) {
      throw new Error('Unsupported loop transport');
    }
    this.owner = owner;
    this.captionOwner = owner.captionOwner;
    this.video = owner.video;
    this.view = owner.view;
    this.doc = owner.doc;
    this.root = this.doc.documentElement;
    this.pageURL = this.doc.URL;
    this.callbacks = callbacks;
    this.duration = owner.original.duration;
    this.pendingTime = owner.time;
    this.period = null;
    this.ready = false;
    this.closed = false;
    this.nativeFallback = false;
    this.listeners = [];
    this.waiters = new Set();
    this.properties = new Map();
    this.tracks = [];
    this.nextCycle = 0;
    this.removedBefore = 0;
    this.priming = true;
    this.abortController = new this.view.AbortController();
    this.native = Object.fromEntries(
      ['currentTime', 'duration', 'buffered', 'seekable', 'playbackRate'].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(this.view.HTMLMediaElement.prototype, key),
      ])
    );
    try {
      if (Object.values(this.native).some((descriptor) => typeof descriptor?.get !== 'function')) {
        throw new Error('Native media access unavailable');
      }
      this.installProperties();
      this.mediaSource = new this.view.ManagedMediaSource();
      this.ownedURL = this.view.URL.createObjectURL(this.mediaSource);
      this.sources = [
        this.makeSource(this.ownedURL, 'video/mp4'),
        this.makeSource(owner.candidate.sourceUrl, 'application/x-mpegURL'),
      ];
      this.video.append(...this.sources);
      this.video.loop = true;
      const opened = new Promise((resolve, reject) => {
        this.waiters.add(reject);
        const sourceOpen = () => {
          this.waiters.delete(reject);
          resolve();
        };
        this.listen(this.mediaSource, 'sourceopen', sourceOpen);
      });
      opened.catch(() => {});
      this.listen(this.mediaSource, 'sourceclose', () => {
        if (!this.closed && !this.checkFallback()) {
          this.fail(new Error('Loop source detached'));
        }
      });
      for (const type of ['timeupdate', 'waiting', 'seeking']) {
        this.listen(this.video, type, () => this.pump());
      }
      this.listen(this.video, 'ratechange', () => {
        try {
          if (
            this.holdingInitialRate &&
            !this.releasingInitialRate &&
            this.native.playbackRate.get.call(this.video) !== 0
          ) {
            throw new Error('Loop preparation rate changed');
          }
          this.pump();
        } catch (error) {
          this.fail(error);
        }
      });
      this.listen(this.video, 'play', () => {
        this.seekEnd = false;
        this.pump();
      });
      this.listen(this.mediaSource, 'startstreaming', () => this.pump());
      for (const type of ['loadstart', 'loadedmetadata', 'loadeddata', 'seeked']) {
        this.listen(this.video, type, () => {
          this.checkFallback();
          this.maybeReady();
        });
      }
      this.listen(this.video, 'encrypted', () => this.fail(new Error('Encrypted loop media')));
      for (const list of [this.video.textTracks, this.video.audioTracks, this.video.videoTracks]) {
        if (typeof list?.addEventListener === 'function') {
          this.listen(list, 'addtrack', () => {
            if (!this.sourceCurrent()) {
              this.fail(new Error('Unknown loop track'));
            }
          });
        }
      }
      const sourceURL = new URL(owner.candidate.sourceUrl);
      const asset = sourceURL.pathname.match(/^\/(amplify_video|ext_tw_video)\/(\d+)\//);
      if (!asset || asset[2] !== owner.candidate.contentId) {
        throw new Error('Loop asset mismatch');
      }
      this.loader = window.VSC.TwitterLoopSource.create(
        {
          hlsUrl: owner.candidate.sourceUrl,
          progressiveUrl: owner.candidate.progressiveUrl,
          assetType: asset[1],
          assetId: asset[2],
          duration: this.duration,
          isCurrent: () => this.authorityCurrent(),
          signal: this.abortController.signal,
          ...(this.captionOwner ? { captionOwner: this.captionOwner } : {}),
        },
        this.view
      );
      this.initialization = Promise.all([opened, this.loader.promise])
        .then(([, source]) => this.initialize(source))
        .catch((error) => this.fail(error));
      this.video.load();
      this.holdingInitialRate = this.releasingInitialRate = true;
      try {
        this.native.playbackRate.set.call(this.video, 0);
        this.verify();
        if (this.native.playbackRate.get.call(this.video) !== 0) {
          throw new Error('Loop preparation rate unavailable');
        }
      } finally {
        this.releasingInitialRate = false;
      }
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  makeSource(url, type) {
    const source = this.doc.createElement('source');
    source.setAttribute('src', url);
    source.setAttribute('type', type);
    return source;
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.listeners.push(() => target.removeEventListener(type, handler));
  }

  authorityCurrent() {
    try {
      return Boolean(
        !this.closed &&
        this.video.ownerDocument === this.doc &&
        this.doc.documentElement === this.root &&
        this.doc.URL === this.pageURL &&
        this.owner.originCurrent() &&
        (!this.captionOwner || this.captionOwner.isCurrent() === true)
      );
    } catch {
      return false;
    }
  }

  sourceCurrent() {
    try {
      return Boolean(
        !this.closed &&
        !this.owner.nativeSourceIntent?.() &&
        !this.owner.nativeSourceRevoked &&
        !this.video.hasAttribute('src') &&
        !this.video.srcObject &&
        !this.video.mediaKeys &&
        !this.video.webkitKeys &&
        (this.captionOwner
          ? window.VSC.TwitterCaptionPlayback?.isLoopOwner?.(this.captionOwner) === true &&
            this.captionOwner.ownsTrack(this.video) === true
          : !this.video.textTracks?.length) &&
        !(this.video.audioTracks?.length > 1) &&
        !(this.video.videoTracks?.length > 1) &&
        this.video.loop &&
        this.video.children.length === (this.captionOwner ? 3 : 2) &&
        Array.from(this.video.children).every(
          (child) =>
            this.sources.includes(child) || (this.captionOwner && child.localName === 'track')
        ) &&
        this.sources.every(
          (source, index) =>
            this.video.querySelectorAll(':scope > source')[index] === source &&
            source.getAttribute('src') ===
              (index === 0 ? this.ownedURL : this.owner.candidate.sourceUrl) &&
            source.getAttribute('type') === (index === 0 ? 'video/mp4' : 'application/x-mpegURL') &&
            !source.hasAttribute('media')
        ) &&
        (!this.video.currentSrc ||
          [this.ownedURL, this.owner.candidate.sourceUrl].includes(this.video.currentSrc)) &&
        (this.nativeFallback ||
          [...this.properties].every(
            ([key, descriptor]) =>
              Object.getOwnPropertyDescriptor(this.video, key)?.get === descriptor.get &&
              Object.getOwnPropertyDescriptor(this.video, key)?.set === descriptor.set
          ))
      );
    } catch {
      return false;
    }
  }

  verify() {
    if (!this.authorityCurrent() || !this.sourceCurrent() || this.nativeFallback) {
      throw new Error('Loop ownership changed');
    }
  }

  nativeTime() {
    return this.native.currentTime.get.call(this.video);
  }

  position() {
    const time = this.nativeTime();
    // Native seek readback may round an exact epoch boundary to microseconds.
    return Math.abs(time - this.seekTarget) <= 0.000001 ? this.seekTarget : time;
  }

  installProperties() {
    const property = (key, get, set) => {
      const descriptor = { configurable: true, get, ...(set ? { set } : {}) };
      Object.defineProperty(this.video, key, descriptor);
      this.properties.set(key, descriptor);
    };
    property('duration', () => this.period || this.duration);
    property(
      'currentTime',
      () => {
        if (!this.period) {
          return this.pendingTime;
        }
        const time = this.position();
        return this.seekEnd && this.video.paused
          ? this.period
          : time - Math.floor(time / this.period) * this.period;
      },
      (value) => this.seek(value)
    );
    for (const key of ['buffered', 'seekable']) {
      property(key, () => {
        const available = this.ready && this.fullCycleBuffered();
        const end = this.period;
        const position = (index, value) => {
          if (!available || index !== 0) {
            throw new this.view.DOMException('Time range index is unavailable', 'IndexSizeError');
          }
          return value;
        };
        return {
          length: available ? 1 : 0,
          start: (index) => position(index, 0),
          end: (index) => position(index, end),
        };
      });
    }
  }

  restoreProperties() {
    for (const [key, descriptor] of this.properties) {
      const current = Object.getOwnPropertyDescriptor(this.video, key);
      if (current?.get === descriptor.get && current?.set === descriptor.set) {
        delete this.video[key];
      }
    }
    this.properties.clear();
  }

  fullCycleBuffered() {
    if (!this.period) {
      return false;
    }
    const start = Math.floor(this.nativeTime() / this.period) * this.period;
    const ranges = this.native.buffered.get.call(this.video);
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= start + 0.001 && ranges.end(i) >= start + this.period - 0.05) {
        return true;
      }
    }
    return false;
  }

  seek(value) {
    if (!Number.isFinite(value) || this.closed || this.nativeFallback) {
      return;
    }
    const duration = this.period || this.duration;
    this.pendingTime = Math.max(0, Math.min(duration, value));
    this.seekEnd = this.pendingTime === duration;
    const time = this.seekEnd ? duration - 0.000001 : this.pendingTime;
    if (this.period) {
      const cycle = Math.floor(this.position() / this.period);
      this.seekTarget = cycle * this.period + time;
      this.native.currentTime.set.call(this.video, this.seekTarget);
      this.pump();
    } else {
      this.verify();
      // Set Safari's default start before metadata can start the requested Play at zero.
      this.native.currentTime.set.call(this.video, time);
      this.initialTarget = time;
    }
  }

  checkFallback() {
    if (
      this.closed ||
      this.video.currentSrc !== this.owner.candidate.sourceUrl ||
      !this.sourceCurrent() ||
      !this.authorityCurrent()
    ) {
      return this.nativeFallback;
    }
    let wireless = false;
    try {
      wireless = this.video.webkitCurrentPlaybackTargetIsWireless === true;
    } catch {
      /* Unavailable target state is not authorization for a source handoff. */
    }
    if (this.captionOwner || !this.owner.committed || !wireless) {
      this.fail(new Error('Unexpected native HLS selection'));
      return false;
    }
    if (!this.nativeFallback) {
      this.owner.cancelRelative?.();
      this.nativeFallback = true;
      this.restoreProperties();
      this.loader?.cancel();
      this.abortController.abort();
      for (const reject of this.waiters) {
        reject(new Error('Native HLS selected'));
      }
      this.waiters.clear();
    }
    this.maybeReady();
    return true;
  }

  maybeReady() {
    if (
      !this.ready &&
      !this.releasingInitialRate &&
      (this.nativeFallback || this.primed) &&
      this.video.readyState >= 2 &&
      !this.video.seeking &&
      this.authorityCurrent() &&
      this.sourceCurrent()
    ) {
      if (this.captionOwner) {
        try {
          if (
            !this.captionOwner.verifyEpoch(0) ||
            !this.captionOwner.readyToPlay(this.nativeTime()) ||
            !this.owner.prepareLoopRelease() ||
            this.video.seeking ||
            !this.captionOwner.readyToPlay(this.nativeTime())
          ) {
            return;
          }
          this.verify();
        } catch (error) {
          this.fail(error);
          return;
        }
      }
      if (this.holdingInitialRate) {
        const rate = this.owner.rate,
          revision = this.owner.rateRevision;
        try {
          this.verify();
          if (
            !Number.isFinite(rate) ||
            rate <= 0 ||
            this.native.playbackRate.get.call(this.video) !== 0
          ) {
            throw new Error('Loop preparation rate changed');
          }
          this.releasingInitialRate = true;
          this.native.playbackRate.set.call(this.video, rate);
          this.verify();
          if (
            this.owner.rate !== rate ||
            this.owner.rateRevision !== revision ||
            this.native.playbackRate.get.call(this.video) !== rate
          ) {
            throw new Error('Loop requested rate changed');
          }
          this.holdingInitialRate = false;
        } catch (error) {
          this.fail(error);
          return;
        } finally {
          this.releasingInitialRate = false;
        }
      }
      this.ready = true;
      this.callbacks.ready();
    }
  }

  operation(buffer, execute) {
    this.verify();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.view.clearTimeout(timer);
        for (const type of ['updateend', 'error', 'abort']) {
          buffer.removeEventListener(type, handlers[type]);
        }
        this.waiters.delete(cancel);
        if (error) {
          reject(error);
        } else {
          try {
            this.verify();
            resolve();
          } catch (failure) {
            reject(failure);
          }
        }
      };
      const cancel = (error) => finish(error);
      const handlers = {
        updateend: () => finish(),
        error: () => finish(new Error('Loop append failed')),
        abort: () => finish(new Error('Loop append aborted')),
      };
      for (const type of Object.keys(handlers)) {
        buffer.addEventListener(type, handlers[type]);
      }
      this.waiters.add(cancel);
      const timer = this.view.setTimeout(() => finish(new Error('Loop append deadline')), 3000);
      try {
        execute();
      } catch (error) {
        finish(error);
      }
    });
  }

  async appendCycle() {
    if (this.captionOwner && this.nextCycle > 0) {
      await this.captionOwner.installEpoch(this.nextCycle);
      this.verify();
      if (this.captionOwner.verifyEpoch(this.nextCycle) !== true) {
        throw new Error('Caption epoch unavailable');
      }
    }
    for (const track of this.tracks) {
      for (const segment of track.segments) {
        await this.operation(track.buffer, () => {
          track.buffer.timestampOffset = this.nextCycle * (this.period || 0);
          track.buffer.appendBuffer(segment);
        });
        this.verify();
      }
    }
    this.nextCycle++;
  }

  async initialize(source) {
    this.verify();
    for (const kind of ['video', 'audio']) {
      const track = source[kind];
      if (!this.view.ManagedMediaSource.isTypeSupported(track.mime)) {
        throw new Error('Loop codec unavailable');
      }
      const buffer = this.mediaSource.addSourceBuffer(track.mime);
      buffer.mode = 'segments';
      this.tracks.push({ ...track, buffer });
      this.listen(buffer, 'error', () => this.fail(new Error('Loop source error')));
    }
    // Keep the cached native start seekable before initialization supplies buffered media.
    this.mediaSource.duration = 3 * this.duration;
    for (const track of this.tracks) {
      await this.operation(track.buffer, () => track.buffer.appendBuffer(track.init));
    }
    await this.appendCycle();
    this.verify();
    const ends = this.tracks.map((track, index) => {
      const ranges = track.buffer.buffered;
      if (ranges.length !== 1 || Math.abs(ranges.start(0)) > 0.01) {
        throw new Error('Incomplete loop track');
      }
      const end = ranges.end(0);
      const declared = source.manifestDurations[index === 0 ? 'video' : 'audio'];
      if (!Number.isFinite(end) || Math.abs(end - declared) > 0.1) {
        throw new Error('Loop track duration mismatch');
      }
      return end;
    });
    this.period = Math.max(...ends);
    if (Math.abs(this.period - this.duration) > 0.1) {
      throw new Error('Loop resource duration mismatch');
    }
    const bytes = this.tracks.reduce(
      (total, track) =>
        total +
        track.init.byteLength +
        track.segments.reduce((size, data) => size + data.byteLength, 0),
      0
    );
    if (bytes / this.period > 512 * 1024) {
      throw new Error('Loop buffer budget');
    }
    this.verify();
    this.mediaSource.duration = Infinity;
    this.verify();
    this.seekEnd = this.seekEnd || this.pendingTime >= this.period;
    this.pendingTime = this.seekEnd
      ? this.period
      : Math.max(0, Math.min(this.period, this.pendingTime));
    const initialTarget = this.seekEnd ? this.period - 0.000001 : this.pendingTime;
    if (Number.isFinite(initialTarget) && initialTarget !== this.initialTarget) {
      this.native.currentTime.set.call(this.video, initialTarget);
    }
    if (this.captionOwner) {
      await this.captionOwner.promise;
      await this.owner.captionAttachment;
      this.verify();
      await this.captionOwner.setPeriod(this.period);
      await this.captionOwner.installEpoch(0);
      this.verify();
      if (this.captionOwner.verifyEpoch(0) !== true) {
        throw new Error('Initial caption epoch unavailable');
      }
    }
    this.priming = false;
    this.primed = true;
    this.maybeReady();
    this.pump();
  }

  pump() {
    if (this.closed || this.nativeFallback || this.priming || this.pumping) {
      return;
    }
    this.pumping = true;
    const run = async () => {
      this.verify();
      const current = this.nativeTime();
      const before = Math.max(0, (Math.floor(current / this.period) - 1) * this.period);
      if (before > this.removedBefore) {
        for (const track of this.tracks) {
          await this.operation(track.buffer, () => track.buffer.remove(0, before));
        }
        if (this.captionOwner) {
          this.verify();
          if (
            this.tracks.some(
              (track) =>
                !track.buffer.buffered.length || track.buffer.buffered.start(0) < before - 0.001
            )
          ) {
            throw new Error('Caption retention unavailable');
          }
          this.captionOwner.retireBefore(before);
          this.verify();
        }
        this.removedBefore = before;
      }
      while (!this.video.paused) {
        this.verify();
        const future = Math.max(
          this.period / 4,
          Math.max(0, this.native.playbackRate.get.call(this.video)) * 2
        );
        if (this.nextCycle * this.period >= this.nativeTime() + future) {
          break;
        }
        await this.appendCycle();
      }
    };
    run()
      .catch((error) => this.fail(error))
      .finally(() => {
        this.pumping = false;
      });
  }

  fail(error) {
    if (this.closed || this.nativeFallback || this.failed) {
      return;
    }
    this.failed = true;
    try {
      if (!this.owner.closed) {
        this.callbacks.failed(error);
      }
    } finally {
      this.cleanup();
    }
  }

  cleanup() {
    if (this.closed) {
      return;
    }
    const ownedSource = !this.owner.nativeSourceIntent?.() && !this.owner.nativeSourceRevoked;
    this.closed = true;
    this.ready = false;
    this.loader?.cancel();
    this.abortController.abort();
    for (const reject of this.waiters) {
      reject(new Error('Loop transport closed'));
    }
    this.waiters.clear();
    for (const remove of this.listeners) {
      try {
        remove();
      } catch {
        /* A newer page patch must not prevent remaining cleanup. */
      }
    }
    this.listeners.length = 0;
    this.restoreProperties();
    for (const track of this.tracks) {
      try {
        if (track.buffer.updating) {
          track.buffer.abort();
        }
        if (this.mediaSource.readyState === 'open') {
          this.mediaSource.removeSourceBuffer(track.buffer);
        }
      } catch {
        /* A detached native source is already released. */
      }
    }
    this.tracks.length = 0;
    for (const [index, source] of (this.sources || []).entries()) {
      if (
        ownedSource &&
        source.parentNode === this.video &&
        source.getAttribute('src') ===
          (index === 0 ? this.ownedURL : this.owner.candidate.sourceUrl) &&
        source.getAttribute('type') === (index === 0 ? 'video/mp4' : 'application/x-mpegURL') &&
        !source.hasAttribute('media')
      ) {
        source.remove();
      }
    }
    if (this.ownedURL) {
      this.view.URL.revokeObjectURL(this.ownedURL);
    }
  }
};

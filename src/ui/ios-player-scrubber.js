/** Pointer-driven precision seeking for an active owned player. */
window.VSC = window.VSC || {};

class IOSPlayerScrubber {
  constructor(owner) {
    this.owner = owner;
    this.ui = owner.ui;
    this.video = owner.video;
    this.range = this.ui.refs.seek;
    this.active = false;
    this.listeners = [];
    this.gestureListeners = [];
    this.view = this.range.ownerDocument.defaultView;
    this.timer = null;
    this.pending = null;
  }

  listen(target, type, callback, bag, options) {
    target.addEventListener(type, callback, options);
    bag.push(() => target.removeEventListener(type, callback, options));
  }

  attach() {
    if (this.listeners.length) {
      return;
    }
    this.listen(this.range, 'pointerdown', (event) => this.start(event), this.listeners);
    this.listen(
      this.range,
      'lostpointercapture',
      (event) => this.finish(event, true),
      this.listeners
    );
    // Cancelled native range gestures must not also trigger the ordinary
    // keyboard input/change handlers while our pointer gesture owns the value.
    for (const type of ['input', 'change']) {
      this.listen(
        this.range,
        type,
        (event) => {
          if (this.active) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.range.value = String(this.value);
          }
        },
        this.listeners,
        true
      );
    }
  }

  bounds() {
    try {
      const bounds = this.owner.seekBounds();
      if (
        bounds &&
        Number.isFinite(bounds[0]) &&
        Number.isFinite(bounds[1]) &&
        bounds[1] > bounds[0]
      ) {
        return bounds;
      }
    } catch {
      // A live seek window can disappear between readiness and a pointer event.
    }
    return null;
  }

  geometry() {
    const rect = this.range.getBoundingClientRect();
    return Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.width) &&
      rect.width > 0 &&
      Number.isFinite(rect.height)
      ? rect
      : null;
  }

  currentPresentation() {
    return Boolean(
      this.owner.active &&
      this.owner.ui === this.ui &&
      this.owner.video === this.video &&
      this.owner.session === this.session &&
      this.matchesSource(this.source) &&
      this.ui.host.isConnected &&
      this.range.isConnected &&
      this.video.isConnected
    );
  }

  captureSource() {
    try {
      return {
        src: this.video.getAttribute('src'),
        currentSrc: this.video.currentSrc,
        srcObject: this.video.srcObject,
      };
    } catch {
      return null;
    }
  }

  matchesSource(source) {
    try {
      return Boolean(
        source &&
        this.video.getAttribute('src') === source.src &&
        this.video.currentSrc === source.currentSrc &&
        this.video.srcObject === source.srcObject
      );
    } catch {
      return false;
    }
  }

  consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  start(event) {
    if (
      this.active ||
      this.finishing ||
      this.range.disabled ||
      event.isPrimary === false ||
      (event.button !== undefined && event.button !== 0) ||
      !Number.isFinite(event.pointerId) ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return;
    }
    // Native loadstart/emptied notifications are queued. A page-wrapped seek or
    // pause can replace the source synchronously before those events arrive.
    this.source = this.captureSource();
    this.session = this.owner.session;
    const bounds = this.bounds();
    const rect = this.geometry();
    if (!this.currentPresentation() || !bounds || !rect) {
      return;
    }
    this.consume(event);
    const clamp = (value) => Math.max(bounds[0], Math.min(bounds[1], value));
    this.startTime = clamp(
      Number.isFinite(this.video.currentTime) ? this.video.currentTime : bounds[0]
    );
    this.value = this.startTime;
    this.pointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.wasPlaying = !this.video.paused;
    this.active = true;
    try {
      this.video.pause();
    } catch {
      this.finish(null, false, false);
      return;
    }
    // Page-wrapped pause methods can synchronously close or replace the session.
    if (!this.active || !this.currentPresentation()) {
      this.finish(null, false, false, false);
      return;
    }
    try {
      this.range.setPointerCapture?.(this.pointerId);
    } catch {
      // Window capture still delivers the gesture when capture is unavailable.
    }
    const view = this.range.ownerDocument.defaultView;
    this.listen(view, 'pointermove', (move) => this.move(move), this.gestureListeners, true);
    this.listen(
      view,
      'pointerup',
      (up) => {
        // Safari may deliver the release beyond its last pointermove.
        this.move(up);
        this.finish(up);
      },
      this.gestureListeners,
      true
    );
    this.listen(
      view,
      'pointercancel',
      (cancel) => this.finish(cancel, true),
      this.gestureListeners,
      true
    );
    const thumbX =
      rect.left + ((this.startTime - bounds[0]) / (bounds[1] - bounds[0])) * rect.width;
    if (Math.abs(event.clientX - thumbX) > 22) {
      this.write(bounds[0] + ((event.clientX - rect.left) / rect.width) * (bounds[1] - bounds[0]));
    }
    this.precision(1);
    this.owner.showControls();
  }

  precision(rate) {
    if (rate === this.rate) {
      return;
    }
    this.rate = rate;
    if (this.ui.refs.scrubHint) {
      this.ui.refs.scrubHint.textContent =
        rate === 0.1
          ? 'Fine scrubbing · Tenth speed'
          : rate === 0.25
            ? 'Fine scrubbing · Quarter speed'
            : rate === 0.5
              ? 'Fine scrubbing · Half speed'
              : 'Scrubbing';
    }
  }

  rateForDistance(distance) {
    return distance >= 132 ? 0.1 : distance >= 88 ? 0.25 : distance >= 44 ? 0.5 : 1;
  }

  movementRate(fromY, toY, centerY) {
    const low = Math.min(fromY, toY) - centerY;
    const high = Math.max(fromY, toY) - centerY;
    if (high === low) {
      return this.rateForDistance(Math.abs(high));
    }
    // Average the gain along the whole segment, so grouping diagonal moves
    // into fewer events cannot skip a precision band or change the seek.
    const fractionWithin = (radius) =>
      Math.max(0, Math.min(high, radius) - Math.max(low, -radius)) / (high - low);
    return 0.1 + 0.15 * fractionWithin(132) + 0.25 * fractionWithin(88) + 0.5 * fractionWithin(44);
  }

  move(event) {
    if (!this.active || event.pointerId !== this.pointerId) {
      return;
    }
    this.consume(event);
    if (!this.currentPresentation()) {
      this.finish(null, false, false);
      return;
    }
    const bounds = this.bounds();
    const rect = this.geometry();
    if (!bounds || !rect || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return;
    }
    const centerY = rect.top + rect.height / 2;
    const rate = this.rateForDistance(Math.abs(event.clientY - centerY));
    const gain = this.movementRate(this.lastY, event.clientY, centerY);
    const delta = ((event.clientX - this.lastX) / rect.width) * (bounds[1] - bounds[0]) * gain;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (delta !== 0 || this.value < bounds[0] || this.value > bounds[1]) {
      this.queue(this.value + delta);
    }
    this.precision(rate);
    this.owner.showControls();
  }

  preview(value) {
    const bounds = this.bounds();
    if (!bounds || !Number.isFinite(value)) {
      return false;
    }
    this.value = Math.max(bounds[0], Math.min(bounds[1], value));
    this.range.min = String(bounds[0]);
    this.range.max = String(bounds[1]);
    this.range.value = String(this.value);
    this.ui.updateSeekProgress?.();
    const format = (time) => this.formatTime(time);
    if (this.ui.refs.current) {
      this.ui.refs.current.textContent = format(this.value);
    }
    this.range.setAttribute(
      'aria-valuetext',
      `${format(this.value)} of ${this.formatTime(bounds[1], false)}`
    );
    return true;
  }

  formatTime(time, precise = true) {
    const ticks = Math.round(Math.max(0, time) * 100);
    const shown = precise ? Math.floor(ticks / 100) : time;
    const whole =
      this.owner.formatTime?.(shown) ??
      `${Math.floor(shown / 60)}:${String(Math.floor(shown % 60)).padStart(2, '0')}`;
    return precise ? `${whole}.${String(ticks % 100).padStart(2, '0')}` : whole;
  }

  write(value) {
    if (!this.currentPresentation() || !this.preview(value)) {
      return;
    }
    this.owner.seekTo(this.value);
    if (!this.currentPresentation()) {
      return;
    }
    this.owner.update?.();
    // Site seek handlers can be asynchronous. Keep the selected time visible
    // even when the media's old currentTime has not caught up to the decoder.
    if (this.currentPresentation()) {
      this.preview(this.value);
    }
  }

  queue(value) {
    if (!this.preview(value)) {
      return;
    }
    this.pending = this.value;
    if (this.timer === null) {
      this.timer = this.view.setTimeout(() => {
        this.timer = null;
        const pending = this.pending;
        this.pending = null;
        if (this.active) {
          this.write(pending);
        }
      }, 50);
    }
  }

  cancelPending() {
    if (this.timer !== null) {
      this.view.clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  finish(event, cancelled = false, resume = true, flush = true) {
    if (!this.active || this.finishing || (event && event.pointerId !== this.pointerId)) {
      return;
    }
    this.finishing = true;
    try {
      if (event) {
        this.consume(event);
      }
      const current = this.currentPresentation();
      const pending = this.pending;
      this.cancelPending();
      if (current) {
        if (cancelled) {
          this.write(this.startTime);
        } else if (flush && pending !== null) {
          this.write(pending);
        }
      }
      this.active = false;
      const pointerId = this.pointerId;
      this.pointerId = null;
      for (const remove of this.gestureListeners.splice(0)) {
        remove();
      }
      try {
        this.range.releasePointerCapture?.(pointerId);
      } catch {
        // The browser may already have released capture for cancel/up.
      }
      this.owner.onScrubFinish?.(cancelled);
      if (this.ui.refs.scrubHint) {
        this.ui.refs.scrubHint.textContent = '';
      }
      if (current && this.currentPresentation()) {
        this.owner.update?.();
        if (this.currentPresentation()) {
          this.owner.showControls();
        }
        if (
          resume &&
          this.wasPlaying &&
          this.currentPresentation() &&
          this.range.ownerDocument.visibilityState !== 'hidden'
        ) {
          this.owner.play();
        }
      }
      this.wasPlaying = false;
      this.rate = null;
    } finally {
      this.finishing = false;
    }
  }

  cleanup() {
    this.finish(null, false, false, false);
    this.cancelPending();
    for (const remove of this.listeners.splice(0)) {
      remove();
    }
  }
}

window.VSC.IOSPlayerScrubber = IOSPlayerScrubber;

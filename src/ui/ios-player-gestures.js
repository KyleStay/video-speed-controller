/** Surface scrubbing, touch double taps and fit/fill pinch gestures. */
window.VSC = window.VSC || {};

class IOSPlayerGestures {
  constructor(owner) {
    this.owner = owner;
    this.stage = null;
    this.points = new Map();
    this.captured = new Set();
    this.active = false;
    this.suppressClick = false;
    this.initialDistance = 0;
    this.committed = false;
    this.tap = null;
    this.lastTap = null;
    this.lastTouchAt = null;
    this.scrubStart = null;
    this.blocked = false;
    this.surfaceTouchCommitted = false;
    this.trailingTouchView = null;
    this.trailingTouchTarget = null;
    this.onOutsideTouchEnd = (event) => {
      if (!event.touches?.length && !event.composedPath().includes(this.trailingTouchTarget)) {
        this.clearTrailingTouch();
      }
    };
    this.onNativeMove = (event) => this.preventNativeScroll(event);
    this.onNativeEnd = (event) => this.endNativeTouch(event);
    this.onDown = (event) => this.down(event);
    this.onMove = (event) => this.move(event);
    this.onEnd = (event) => this.end(event);
    this.onLost = (event) => this.end(event);
  }

  attach() {
    const stage = this.owner.ui?.stage;
    if (!stage) {
      this.cleanup();
      return false;
    }
    if (stage === this.stage) {
      return true;
    }
    this.cleanup();
    this.stage = stage;
    stage.addEventListener('pointerdown', this.onDown, { capture: true, passive: false });
    stage.addEventListener('pointermove', this.onMove, { capture: true, passive: false });
    stage.addEventListener('pointerup', this.onEnd, true);
    stage.addEventListener('pointercancel', this.onEnd, true);
    stage.addEventListener('lostpointercapture', this.onLost, true);
    stage.addEventListener('touchmove', this.onNativeMove, { capture: true, passive: false });
    stage.addEventListener('touchend', this.onNativeEnd, { capture: true, passive: false });
    stage.addEventListener('touchcancel', this.onNativeEnd, { capture: true, passive: false });
    return true;
  }

  validTouch(event) {
    return (
      event.pointerType === 'touch' &&
      Number.isInteger(event.pointerId) &&
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY)
    );
  }

  claim(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  distance() {
    const [first, second] = this.points.values();
    return second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  now() {
    try {
      const now = this.owner.view?.performance.now();
      return Number.isFinite(now) ? now : null;
    } catch {
      return null;
    }
  }

  clearTapChain() {
    this.tap = null;
    this.lastTap = null;
  }

  showControls() {
    try {
      this.owner.showControls();
    } catch {
      // A site callback can invalidate the current presentation during input.
    }
  }

  finishTap(event) {
    const tap = this.tap;
    this.tap = null;
    const now = this.now();
    if (
      !tap ||
      tap.pointerId !== event.pointerId ||
      event.type !== 'pointerup' ||
      !this.validTouch(event) ||
      this.active ||
      this.points.size !== 1 ||
      !this.owner.active ||
      this.owner.controlsLocked ||
      this.owner.ui?.stage !== this.stage ||
      now === null ||
      tap.startedAt === null ||
      now < tap.startedAt ||
      now - tap.startedAt > 280 ||
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 14
    ) {
      this.lastTap = null;
      return;
    }
    let zone;
    try {
      const rect = this.stage.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
        this.lastTap = null;
        return;
      }
      const position = (event.clientX - rect.left) / rect.width;
      zone =
        position >= 0 && position < 0.35
          ? 'left'
          : position > 0.65 && position <= 1
            ? 'right'
            : null;
    } catch {
      this.lastTap = null;
      return;
    }
    if (!zone) {
      this.lastTap = null;
      return;
    }
    const previous = this.lastTap;
    this.lastTap = { zone, x: event.clientX, y: event.clientY, endedAt: now };
    if (
      !previous ||
      previous.zone !== zone ||
      now < previous.endedAt ||
      now - previous.endedAt > 320 ||
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 40
    ) {
      return;
    }
    try {
      if (typeof this.owner.seekBy !== 'function') {
        return;
      }
      // The owner owns seek bounds and feedback; never write media time here.
      this.owner.seekBy(zone === 'left' ? -10 : 10);
      this.suppressClick = true;
      this.claim(event);
      this.showControls();
    } catch {
      this.clearTapChain();
    }
  }

  consumeDoubleClick(event) {
    // Touch seeking is decided above, including center taps and rejected
    // gestures. A browser-generated dblclick must never reinterpret them.
    const now = this.now();
    if (
      now === null ||
      this.lastTouchAt === null ||
      now < this.lastTouchAt ||
      now - this.lastTouchAt > 500
    ) {
      return false;
    }
    this.claim(event);
    return true;
  }

  preventNativeScroll(event) {
    if (
      this.owner.active &&
      this.owner.scrubber?.active &&
      this.owner.scrubber.surface === this.stage
    ) {
      this.claim(event);
    }
  }

  endNativeTouch(event) {
    if (!this.surfaceTouchCommitted) {
      return;
    }
    // Pointer-up finishes seeking before the browser delivers touchend. A site
    // tap recognizer must not reinterpret that committed drag as Play/Pause.
    this.claim(event);
    if (!event.touches?.length) {
      this.clearTrailingTouch();
    }
  }

  clearTrailingTouch() {
    this.trailingTouchView?.removeEventListener('touchend', this.onOutsideTouchEnd, true);
    this.trailingTouchView?.removeEventListener('touchcancel', this.onOutsideTouchEnd, true);
    this.trailingTouchView = null;
    this.trailingTouchTarget = null;
    this.surfaceTouchCommitted = false;
  }

  finishScrub() {
    this.points.clear();
    this.clearTapChain();
    this.scrubStart = null;
    this.lastTouchAt = this.now();
    this.suppressClick = true;
  }

  startScrub(event) {
    const start = this.scrubStart;
    if (!start || start.pointerId !== event.pointerId || this.points.size !== 1) {
      return false;
    }
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (Math.max(dx, dy) <= 10) {
      return false;
    }
    this.scrubStart = null;
    this.clearTapChain();
    if (dy >= dx) {
      this.suppressClick = true;
      return false; // Vertical intent belongs to page scrolling.
    }
    const scrubber = this.owner.scrubber;
    const current = () =>
      this.owner.active &&
      this.owner.session === start.session &&
      this.owner.ui?.stage === this.stage;
    try {
      if (!current() || (start.canStartScrub && !start.canStartScrub(start))) {
        return false;
      }
    } catch {
      return false;
    }
    if (!current() || !scrubber?.matchesSource(start.source) || !current()) {
      return false;
    }
    scrubber.start(event, { surface: this.stage, origin: start });
    if (!scrubber.active || scrubber.surface !== this.stage) {
      return false;
    }
    this.suppressClick = true;
    this.surfaceTouchCommitted = true;
    this.trailingTouchTarget = event.target;
    this.trailingTouchView = this.owner.view;
    for (const type of ['touchend', 'touchcancel']) {
      this.trailingTouchView?.addEventListener(type, this.onOutsideTouchEnd, {
        capture: true,
        passive: true,
      });
    }
    return true;
  }

  down(event, { canStartScrub } = {}) {
    if (this.validTouch(event)) {
      this.lastTouchAt = this.now();
    }
    if (!this.owner.active || this.owner.controlsLocked) {
      this.clearTapChain();
      return;
    }
    if (!this.validTouch(event) || this.points.has(event.pointerId)) {
      return;
    }
    const scrubber = this.owner.scrubber;
    if (
      scrubber?.active &&
      scrubber.surface === this.stage &&
      event.pointerId !== scrubber.pointerId
    ) {
      const pointerId = scrubber.pointerId;
      const first = this.points.get(pointerId);
      scrubber.finish(null, true);
      if (!this.owner.active || this.owner.ui?.stage !== this.stage) {
        return;
      }
      this.points.set(pointerId, first || { x: event.clientX, y: event.clientY });
      this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.blocked = true;
      return;
    }
    if (this.points.size === 0) {
      // A previous outside finger may have ended beyond this surface. A new
      // pointer sequence cannot inherit its trailing touch-event suppression.
      this.clearTrailingTouch();
      this.blocked = false;
      this.scrubStart = scrubber
        ? {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            session: this.owner.session,
            source: scrubber.captureSource(),
            canStartScrub,
          }
        : null;
      this.suppressClick = false;
      this.committed = false;
      this.initialDistance = 0;
      this.tap = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: this.now(),
      };
    }
    if (this.points.size >= 1) {
      this.clearTapChain();
      this.scrubStart = null;
    }
    if (this.points.size >= 2) {
      return;
    }
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.points.size !== 2) {
      return;
    }
    if (this.blocked || typeof this.owner.setFit !== 'function') {
      this.blocked = true; // Inline two-finger gestures stay with the browser.
      this.suppressClick = true;
      return;
    }
    if (!this.active) {
      this.active = true;
      this.initialDistance = this.distance();
      this.showControls();
    }
    this.suppressClick = true;
    for (const pointerId of this.points.keys()) {
      if (!this.captured.has(pointerId)) {
        try {
          this.stage.setPointerCapture(pointerId);
          this.captured.add(pointerId);
        } catch {
          // A finger may already have ended, or this page may replace capture APIs.
        }
      }
    }
    this.claim(event);
  }

  move(event) {
    if (!this.validTouch(event) || !this.points.has(event.pointerId)) {
      return;
    }
    this.lastTouchAt = this.now();
    if (!this.owner.active || this.owner.controlsLocked) {
      this.clearTapChain();
      return;
    }
    if (this.blocked || this.startScrub(event)) {
      return;
    }
    if (
      this.tap?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - this.tap.x, event.clientY - this.tap.y) > 14
    ) {
      this.clearTapChain();
    }
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.active) {
      return;
    }
    this.suppressClick = true;
    this.claim(event);
    if (this.points.size !== 2 || this.committed || !this.owner.active) {
      return;
    }
    const distance = this.distance();
    if (this.initialDistance <= 0) {
      this.initialDistance = distance;
      return;
    }
    const ratio = distance / this.initialDistance;
    const fit = ratio > 1.12 ? 'cover' : ratio < 0.88 ? 'contain' : null;
    if (fit) {
      this.committed = true;
      if (this.owner.fit !== fit) {
        try {
          this.owner.setFit(fit);
        } catch {
          // The page may invalidate its presentation during a gesture.
        }
      }
    }
  }

  release(pointerId) {
    if (this.captured.delete(pointerId)) {
      try {
        this.stage?.releasePointerCapture(pointerId);
      } catch {
        // Capture can already be gone after a native pointer cancellation.
      }
    }
  }

  end(event) {
    if (event.type === 'lostpointercapture' && event.target !== this.stage) {
      return; // Transferring implicit capture from the video to its stage is expected.
    }
    if (!this.points.has(event.pointerId)) {
      return;
    }
    // Tracked pointers are touches, even when cancellation omits coordinates.
    this.lastTouchAt = this.now();
    if (this.owner.scrubber?.active && this.owner.scrubber.surface === this.stage) {
      this.owner.scrubber.finish(event, true);
      return;
    }
    this.scrubStart = null;
    this.finishTap(event);
    if (this.active) {
      this.suppressClick = true;
      this.claim(event);
    }
    this.points.delete(event.pointerId);
    this.release(event.pointerId);
    if (this.points.size === 0) {
      this.active = false;
      this.initialDistance = 0;
      this.blocked = false;
    }
  }

  cleanup() {
    const stage = this.stage;
    if (stage) {
      stage.removeEventListener('pointerdown', this.onDown, true);
      stage.removeEventListener('pointermove', this.onMove, true);
      stage.removeEventListener('pointerup', this.onEnd, true);
      stage.removeEventListener('pointercancel', this.onEnd, true);
      stage.removeEventListener('lostpointercapture', this.onLost, true);
      stage.removeEventListener('touchmove', this.onNativeMove, true);
      stage.removeEventListener('touchend', this.onNativeEnd, true);
      stage.removeEventListener('touchcancel', this.onNativeEnd, true);
    }
    // Clear first: releasing capture can synchronously dispatch lostpointercapture.
    this.points.clear();
    for (const pointerId of [...this.captured]) {
      this.release(pointerId);
    }
    this.stage = null;
    this.clearTapChain();
    this.lastTouchAt = null;
    this.scrubStart = null;
    this.blocked = false;
    this.active = false;
    this.suppressClick = false;
    this.clearTrailingTouch();
    this.initialDistance = 0;
    this.committed = false;
  }
}

window.VSC.IOSPlayerGestures = IOSPlayerGestures;

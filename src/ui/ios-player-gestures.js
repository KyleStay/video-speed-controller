/** Touch double-tap seeking and fit/fill pinch gestures on the owned video's display surface. */
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

  down(event) {
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
    if (this.points.size === 0) {
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
    }
    if (this.points.size >= 2) {
      return;
    }
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.points.size !== 2) {
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
    if (!this.points.has(event.pointerId)) {
      return;
    }
    // Tracked pointers are touches, even when cancellation omits coordinates.
    this.lastTouchAt = this.now();
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
    }
    // Clear first: releasing capture can synchronously dispatch lostpointercapture.
    this.points.clear();
    for (const pointerId of [...this.captured]) {
      this.release(pointerId);
    }
    this.stage = null;
    this.clearTapChain();
    this.lastTouchAt = null;
    this.active = false;
    this.suppressClick = false;
    this.initialDistance = 0;
    this.committed = false;
  }
}

window.VSC.IOSPlayerGestures = IOSPlayerGestures;

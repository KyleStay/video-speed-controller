/** Touch-only fit/fill pinch gestures on the owned video's display surface. */
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

  down(event) {
    if (!this.owner.active || !this.validTouch(event) || this.points.has(event.pointerId)) {
      return;
    }
    if (this.points.size === 0) {
      this.suppressClick = false;
      this.committed = false;
      this.initialDistance = 0;
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
      this.owner.showControls();
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
        this.owner.setFit(fit);
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
    this.active = false;
    this.suppressClick = false;
    this.initialDistance = 0;
    this.committed = false;
  }
}

window.VSC.IOSPlayerGestures = IOSPlayerGestures;

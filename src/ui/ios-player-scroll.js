/** Preserve scrolling around a presentation transaction, without owning page navigation. */
window.VSC = window.VSC || {};

class IOSPlayerScrollState {
  constructor(origin, includeParentFrames = false) {
    this.origin = origin;
    this.document = origin.ownerDocument;
    this.view = this.document.defaultView;
    this.url = this.view?.location.href;
    this.root = this.document.documentElement;
    this.entries = [];
    this.frames = [];
    this.removers = [];
    const seen = new Set();
    let node = origin;
    for (let depth = 0; node && depth < 16; depth++) {
      const doc = node.ownerDocument;
      const view = doc.defaultView;
      if (!view) {
        break;
      }
      let ancestor = node;
      for (let index = 0; ancestor && index < 128; index++) {
        if (!seen.has(ancestor)) {
          seen.add(ancestor);
          this.entries.push({ node: ancestor, doc, view, url: view.location.href });
        }
        ancestor = ancestor.parentElement || ancestor.getRootNode()?.host;
      }
      const root = doc.scrollingElement || doc.documentElement;
      this.entries = this.entries.filter((item) => item.node !== root);
      this.entries.push({ node: root, doc, view, url: view.location.href, root: true });
      if (!includeParentFrames) {
        break;
      }
      try {
        const frame = view.frameElement;
        if (
          !frame ||
          frame.contentWindow !== view ||
          frame.ownerDocument !== view.parent.document
        ) {
          break;
        }
        node = frame;
      } catch {
        break; // A native presentation never grants access to a cross-origin ancestor.
      }
    }
    this.refresh();
  }

  refresh(changesOnly = false) {
    this.cancel();
    for (const item of this.entries) {
      try {
        const x = item.root ? item.view.scrollX : item.node.scrollLeft;
        const y = item.root ? item.view.scrollY : item.node.scrollTop;
        if (!changesOnly || x !== item.baselineX) {
          item.x = x;
        }
        if (!changesOnly || y !== item.baselineY) {
          item.y = y;
        }
      } catch {
        // An ancestor may have navigated since the presentation began.
      }
    }
    return this;
  }

  checkpoint() {
    // Frame expansion can temporarily remove a scroller's range. Distinguish
    // that owned layout change from a later deliberate page/site scroll.
    for (const item of this.entries) {
      try {
        item.baselineX = item.root ? item.view.scrollX : item.node.scrollLeft;
        item.baselineY = item.root ? item.view.scrollY : item.node.scrollTop;
      } catch {
        // Leave inaccessible ancestors untouched at handback.
      }
    }
  }

  isCurrent() {
    try {
      return (
        this.origin.isConnected &&
        this.origin.ownerDocument === this.document &&
        this.document.documentElement === this.root &&
        this.view.document === this.document &&
        this.view.location.href === this.url
      );
    } catch {
      return false;
    }
  }

  valid(item) {
    try {
      return (
        item.node.isConnected &&
        item.node.ownerDocument === item.doc &&
        item.view.document === item.doc &&
        item.view.location.href === item.url
      );
    } catch {
      return false;
    }
  }

  apply() {
    if (!this.isCurrent()) {
      return;
    }
    this.view.VSC?.recordVideoDiagnostic?.('scroll-restore-before', this.origin);
    for (const item of this.entries) {
      if (!this.valid(item)) {
        continue;
      }
      try {
        const target = item.root ? item.view : item.node;
        const x = item.root ? target.scrollX : target.scrollLeft;
        const y = item.root ? target.scrollY : target.scrollTop;
        if (x === item.x && y === item.y) {
          continue;
        }
        if (typeof target.scrollTo === 'function') {
          target.scrollTo({ left: item.x, top: item.y, behavior: 'instant' });
        } else {
          target.scrollLeft = item.x;
          target.scrollTop = item.y;
        }
      } catch {
        // Removed documents and page-owned scrolling APIs must not block handback.
      }
    }
    this.view.VSC?.recordVideoDiagnostic?.('scroll-restore-after', this.origin);
  }

  restore(settle = true) {
    this.cancel();
    this.apply();
    if (!settle || !this.isCurrent() || !this.view?.requestAnimationFrame) {
      return;
    }
    // Two layout frames cover deferred modal focus/fullscreen work; never poll.
    const cancel = () => this.cancel();
    for (const view of new Set(this.entries.map((item) => item.view))) {
      for (const type of [
        'wheel',
        'touchstart',
        'pointerdown',
        'keydown',
        'pagehide',
        'popstate',
      ]) {
        view.addEventListener(type, cancel, { capture: true, passive: true });
        this.removers.push(() => view.removeEventListener(type, cancel, true));
      }
    }
    const next = (remaining) => {
      const id = this.view.requestAnimationFrame(() => {
        this.frames = this.frames.filter((frame) => frame !== id);
        this.apply();
        if (remaining > 1) {
          next(remaining - 1);
        } else {
          this.cancel();
        }
      });
      this.frames.push(id);
    };
    next(2);
  }

  cancel() {
    for (const id of this.frames.splice(0)) {
      this.view.cancelAnimationFrame(id);
    }
    for (const remove of this.removers.splice(0)) {
      remove();
    }
  }
}

window.VSC.IOSPlayerScrollState = IOSPlayerScrollState;

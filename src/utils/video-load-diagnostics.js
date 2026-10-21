/** Opt-in, local-only timing evidence for media loading and scroll changes. */
window.VSC = window.VSC || {};

const diagnosticRead = (read, fallback = null) => {
  try {
    return read() ?? fallback;
  } catch {
    return fallback;
  }
};
const diagnosticNumber = (value) =>
  Number.isFinite(value) ? Math.max(-1e9, Math.min(1e9, value)) : 0;

class VideoLoadDiagnostics {
  static mediaEvents = [
    'loadstart',
    'emptied',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'play',
    'playing',
    'pause',
    'webkitbeginfullscreen',
    'webkitendfullscreen',
    'webkitpresentationmodechanged',
    'enterpictureinpicture',
    'leavepictureinpicture',
  ];

  static labels = new Set([
    ...VideoLoadDiagnostics.mediaEvents,
    'capture-start',
    'capture-stop',
    'duration-limit',
    'before-controller',
    'after-controller',
    'before-inline-policy',
    'after-inline-policy',
    'controller-remove',
    'extension-teardown',
    'scroll-restore-before',
    'scroll-restore-after',
    'fullscreenchange',
    'scroll-before-jump',
    'suspected-top-jump',
    'focusin',
    'scroll',
    'viewport-scroll',
    'viewport-resize',
    'pointerdown',
    'touchstart',
    'wheel',
    'keydown',
    'pagehide',
    'pageshow',
    'visibilitychange',
    'popstate',
    'frame',
  ]);

  constructor(document) {
    this.document = document;
    this.view = diagnosticRead(() => document.defaultView);
    this.roots = [];
    this.active = false;
    this.removers = [];
    this.attachedRoots = new WeakSet();
    this.rootRemovers = new WeakMap();
    this.frame = null;
    this.timer = null;
    this.pending = new Map();
    this.clear();
    this.observeRoot(document);
  }

  now() {
    return diagnosticRead(() => this.view.performance.now(), 0);
  }

  clear() {
    this.cancelFrame();
    this.events = [];
    this.ids = new WeakMap();
    this.scrollerIds = new WeakMap();
    this.nextScrollerId = 0;
    this.nextId = 0;
    this.sequence = 0;
    this.started = this.now();
    this.lastInput = null;
    this.seenEvents = new WeakSet();
    this.scrollSamples = new WeakMap();
    this.lastSample = null;
    this.lastScroll = -Infinity;
    this.lastInputRecord = -Infinity;
    this.incidentFrames = 0;
    this.lastMedia = null;
  }

  start({ reason } = {}) {
    this.stop();
    this.clear();
    this.reason = [
      'manual',
      'popup',
      'command',
      'test',
      'debug',
      'resume',
      'diagnostic-build',
    ].includes(reason)
      ? reason
      : 'other';
    if (!this.view || !this.document) {
      return false;
    }
    this.observeRoot(this.document);
    this.active = true;
    for (const reference of this.roots) {
      const root = reference.deref();
      if (root) {
        this.attachRoot(root);
      }
    }
    const capture = (event) => {
      if (!this.active) {
        return;
      }
      if (['pointerdown', 'touchstart', 'wheel', 'keydown'].includes(event.type)) {
        this.lastInput = this.now();
        if (this.lastInput - this.lastInputRecord < 125) {
          return;
        }
        this.lastInputRecord = this.lastInput;
      }
      this.record(event.type, null, {}, this.eventOrigin(event));
      if (event.type === 'pagehide') {
        if (this.incidentFrames) {
          this.stop();
        } else {
          this.cancelFrame();
        }
      }
    };
    for (const type of [
      'pointerdown',
      'touchstart',
      'wheel',
      'keydown',
      'pagehide',
      'pageshow',
      'popstate',
    ]) {
      this.listen(this.view, type, capture);
    }
    this.listen(this.document, 'visibilitychange', capture);
    this.listen(this.document, 'fullscreenchange', () => {
      const current = diagnosticRead(() => this.document.fullscreenElement);
      this.mark('fullscreenchange', this.isMedia(current) ? current : this.lastMedia?.deref());
    });
    const viewport = diagnosticRead(() => this.view.visualViewport);
    this.listen(viewport, 'resize', () => this.record('viewport-resize'));
    this.listen(viewport, 'scroll', () => this.queueScroll('viewport-scroll'));
    this.timer = diagnosticRead(() =>
      this.view.setTimeout(() => {
        this.record('duration-limit');
        this.stop();
      }, 600000)
    );
    this.record('capture-start');
    return true;
  }

  listen(target, type, listener, removers = this.removers) {
    if (!target) {
      return;
    }
    const options = { capture: true, passive: true };
    const added = diagnosticRead(() => {
      target.addEventListener(type, listener, options);
      return true;
    }, false);
    if (added) {
      removers.push(() => diagnosticRead(() => target.removeEventListener(type, listener, true)));
    }
  }

  observeRoot(root) {
    if (!root || !['object', 'function'].includes(typeof root)) {
      return;
    }
    if (!this.roots.some((reference) => reference.deref() === root)) {
      if (this.roots.length >= 64) {
        this.roots = this.roots.filter((reference) => reference.deref());
      }
      if (this.roots.length >= 64) {
        return;
      }
      this.roots.push(new WeakRef(root));
    }
    if (this.active) {
      this.attachRoot(root);
    }
  }

  unobserveRoot(root) {
    for (const remove of this.rootRemovers.get(root) || []) {
      remove();
    }
    this.rootRemovers.delete(root);
    this.attachedRoots.delete(root);
    this.roots = this.roots.filter((reference) => reference.deref() && reference.deref() !== root);
  }

  attachRoot(root) {
    if (this.attachedRoots.has(root)) {
      return;
    }
    this.attachedRoots.add(root);
    const removers = [];
    this.rootRemovers.set(root, removers);
    const media = (event) => {
      if (!this.active || this.seenEvents.has(event)) {
        return;
      }
      const target = this.eventOrigin(event);
      if (this.isMedia(target)) {
        this.seenEvents.add(event);
        this.mark(event.type, target);
      }
    };
    for (const type of VideoLoadDiagnostics.mediaEvents) {
      this.listen(root, type, media, removers);
    }
    this.listen(
      root,
      'scroll',
      (event) => this.queueScroll('scroll', this.eventOrigin(event)),
      removers
    );
    this.listen(
      root,
      'focusin',
      (event) => {
        if (this.seenEvents.has(event)) {
          return;
        }
        this.seenEvents.add(event);
        this.record('focusin', null, {}, this.eventOrigin(event));
      },
      removers
    );
  }

  isMedia(media) {
    return ['VIDEO', 'AUDIO'].includes(diagnosticRead(() => media.tagName));
  }

  eventOrigin(event) {
    return diagnosticRead(
      () => event.composedPath()[0],
      diagnosticRead(() => event.target)
    );
  }

  mark(event, media) {
    if (!this.active || !VideoLoadDiagnostics.labels.has(event)) {
      return;
    }
    diagnosticRead(() => {
      this.record(event, media);
      if (this.isMedia(media)) {
        this.lastMedia = new WeakRef(media);
        const id = this.mediaId(media);
        if (!this.pending.has(id) && this.pending.size < 16) {
          this.pending.set(id, { reference: new WeakRef(media), remaining: 2, trigger: event });
        }
        this.queueFrame();
      }
    });
  }

  mediaId(media) {
    if (!this.ids.has(media)) {
      this.ids.set(media, ++this.nextId);
    }
    return this.ids.get(media);
  }

  queueScroll(event, target) {
    if (!this.active) {
      return;
    }
    const previous = target && this.scrollSamples.get(target);
    const pageY = diagnosticNumber(diagnosticRead(() => this.view.scrollY, 0));
    const nestedY = diagnosticNumber(diagnosticRead(() => target.scrollTop, 0));
    const nestedPrevious = previous?.scrollers?.[0]?.y;
    const pageJump = this.lastSample?.page.y >= 400 && pageY <= 80;
    const nestedJump = nestedPrevious >= 400 && nestedY <= 80;
    if (!this.incidentFrames && (pageJump || nestedJump)) {
      const before = pageJump ? this.lastSample : previous;
      if (before) {
        this.append({
          ...before,
          seq: ++this.sequence,
          t: diagnosticNumber(Math.max(0, this.now() - this.started)),
          event: 'scroll-before-jump',
        });
      }
      this.record('suspected-top-jump', null, {}, target);
      this.reason = 'suspected-top-jump';
      this.incidentFrames = 2;
      this.incidentTarget = target && typeof target === 'object' ? new WeakRef(target) : null;
      this.queueFrame();
      return;
    }
    if (this.now() - this.lastScroll < 125) {
      return;
    }
    this.scrollEvent = event;
    this.scrollTarget = target && typeof target === 'object' ? new WeakRef(target) : null;
    this.queueFrame();
  }

  queueFrame() {
    if (!this.active || this.frame !== null) {
      return;
    }
    this.frame = diagnosticRead(() =>
      this.view.requestAnimationFrame(() => {
        this.frame = null;
        if (!this.active) {
          return;
        }
        if (this.scrollEvent) {
          this.record(this.scrollEvent, null, {}, this.scrollTarget?.deref());
          this.lastScroll = this.now();
          this.scrollEvent = null;
          this.scrollTarget = null;
        }
        for (const [id, item] of this.pending) {
          const media = item.reference.deref();
          if (
            !media ||
            !diagnosticRead(() => media.isConnected, false) ||
            diagnosticRead(() => media.ownerDocument) !== this.document
          ) {
            this.pending.delete(id);
            continue;
          }
          this.record('frame', media, { phase: 3 - item.remaining, trigger: item.trigger });
          if (--item.remaining === 0) {
            this.pending.delete(id);
          }
        }
        if (this.incidentFrames) {
          const origin = this.incidentTarget?.deref();
          const context = {
            phase: 3 - this.incidentFrames,
            trigger: 'suspected-top-jump',
          };
          this.record('frame', null, context, origin);
          const media = this.lastMedia?.deref();
          if (
            media &&
            media !== origin &&
            diagnosticRead(() => media.isConnected, false) &&
            diagnosticRead(() => media.ownerDocument) === this.document
          ) {
            this.record('frame', media, context);
          }
          if (--this.incidentFrames === 0) {
            this.stop();
            return;
          }
        }
        if (this.pending.size || this.incidentFrames) {
          this.queueFrame();
        }
      })
    );
  }

  cancelFrame() {
    if (this.frame !== null) {
      diagnosticRead(() => this.view.cancelAnimationFrame(this.frame));
    }
    this.frame = null;
    this.pending?.clear();
    this.scrollTarget = null;
    this.scrollEvent = null;
    this.incidentFrames = 0;
    this.incidentTarget = null;
  }

  geometry(node, root = false) {
    const read = (key) => diagnosticNumber(diagnosticRead(() => node[key], 0));
    return {
      x: root ? diagnosticNumber(diagnosticRead(() => this.view.scrollX, 0)) : read('scrollLeft'),
      y: root ? diagnosticNumber(diagnosticRead(() => this.view.scrollY, 0)) : read('scrollTop'),
      width: read('clientWidth'),
      height: read('clientHeight'),
      scrollWidth: read('scrollWidth'),
      scrollHeight: read('scrollHeight'),
    };
  }

  rect(node) {
    const rect = diagnosticRead(() => node.getBoundingClientRect());
    if (!rect) {
      return null;
    }
    const read = (key) => diagnosticNumber(diagnosticRead(() => rect[key], 0));
    return { x: read('x'), y: read('y'), width: read('width'), height: read('height') };
  }

  record(event, media, extra = {}, origin = media) {
    if (!this.active || !VideoLoadDiagnostics.labels.has(event)) {
      return;
    }
    diagnosticRead(() => {
      const now = this.now();
      const viewport = diagnosticRead(() => this.view.visualViewport);
      const activeTag = diagnosticRead(() => this.document.activeElement.tagName, 'OTHER');
      const entry = {
        seq: ++this.sequence,
        t: diagnosticNumber(Math.max(0, now - this.started)),
        event,
        ...extra,
        inputAgoMs:
          this.lastInput === null ? null : diagnosticNumber(Math.max(0, now - this.lastInput)),
        page: this.geometry(this.document.scrollingElement || this.document.documentElement, true),
        viewport: {
          x: diagnosticNumber(diagnosticRead(() => viewport.offsetLeft, 0)),
          y: diagnosticNumber(diagnosticRead(() => viewport.offsetTop, 0)),
          width: diagnosticNumber(
            diagnosticRead(
              () => viewport.width,
              diagnosticRead(() => this.view.innerWidth, 0)
            )
          ),
          height: diagnosticNumber(
            diagnosticRead(
              () => viewport.height,
              diagnosticRead(() => this.view.innerHeight, 0)
            )
          ),
          scale: diagnosticNumber(diagnosticRead(() => viewport.scale, 1)),
        },
        activeTag: [
          'BODY',
          'HTML',
          'VIDEO',
          'AUDIO',
          'BUTTON',
          'INPUT',
          'TEXTAREA',
          'SELECT',
          'DIV',
          'A',
          'DIALOG',
        ].includes(activeTag)
          ? activeTag
          : 'OTHER',
        scrollers: [],
      };
      let node = origin;
      const sampledNodes = [];
      for (let depth = 0; node && depth < 24 && entry.scrollers.length < 8; depth++) {
        if (diagnosticRead(() => node.ownerDocument) !== this.document) {
          break;
        }
        const geometry = this.geometry(node);
        if (
          geometry.x ||
          geometry.y ||
          geometry.scrollHeight > geometry.height ||
          geometry.scrollWidth > geometry.width
        ) {
          if (!this.scrollerIds.has(node)) {
            this.scrollerIds.set(node, ++this.nextScrollerId);
          }
          geometry.id = this.scrollerIds.get(node);
          entry.scrollers.push(geometry);
          sampledNodes.push(node);
        }
        node = diagnosticRead(() => node.parentElement || node.getRootNode()?.host);
      }
      if (this.isMedia(media)) {
        entry.mediaId = this.mediaId(media);
        const read = (key) => diagnosticRead(() => media[key]);
        const mode = read('webkitPresentationMode');
        entry.media = {
          rect: this.rect(media),
          controllerRect: this.rect(
            diagnosticRead(() => media.vsc.div.shadowRoot.querySelector('#controller'))
          ),
          hostRect: this.rect(diagnosticRead(() => media.vsc.div)),
          readyState: diagnosticNumber(read('readyState')),
          networkState: diagnosticNumber(read('networkState')),
          paused: Boolean(read('paused')),
          rate: diagnosticNumber(read('playbackRate')),
          time: diagnosticNumber(read('currentTime')),
          playsInline: Boolean(read('playsInline')),
          webkitInline: Boolean(
            diagnosticRead(() => media.hasAttribute('webkit-playsinline'), false)
          ),
          controls: Boolean(read('controls')),
          nativeFullscreen:
            Boolean(read('webkitDisplayingFullscreen')) ||
            diagnosticRead(() => this.document.fullscreenElement === media, false),
          nativeMode: ['inline', 'fullscreen', 'picture-in-picture'].includes(mode)
            ? mode
            : 'unknown',
          custom: Boolean(diagnosticRead(() => media.vsc.iosPlayer.active, false)),
        };
      }
      const nestedBefore = sampledNodes
        .map((sampled, index) => ({
          before: this.scrollSamples.get(sampled),
          after: entry.scrollers[index],
        }))
        .find(({ before, after }) => before?.scrollers[0]?.y >= 400 && after.y <= 80)?.before;
      const jumpBefore =
        this.lastSample?.page.y >= 400 && entry.page.y <= 80 ? this.lastSample : nestedBefore;
      if (!this.incidentFrames && event !== 'suspected-top-jump' && jumpBefore) {
        this.append({
          ...jumpBefore,
          seq: ++this.sequence,
          t: entry.t,
          event: 'scroll-before-jump',
        });
        entry.seq = ++this.sequence;
        this.append(entry);
        this.append({ ...entry, seq: ++this.sequence, event: 'suspected-top-jump' });
        this.reason = 'suspected-top-jump';
        this.incidentFrames = 2;
        this.incidentTarget = origin && typeof origin === 'object' ? new WeakRef(origin) : null;
        this.queueFrame();
      } else {
        this.append(entry);
      }
      this.lastSample = entry;
      for (const sampled of sampledNodes) {
        const index = sampledNodes.indexOf(sampled);
        this.scrollSamples.set(sampled, { ...entry, scrollers: entry.scrollers.slice(index) });
      }
    });
  }

  append(entry) {
    this.events.push(entry);
    if (this.events.length > 240) {
      this.events.shift();
    }
  }

  stop() {
    if (this.active) {
      this.record('capture-stop');
    }
    this.active = false;
    this.cancelFrame();
    diagnosticRead(() => this.view.clearTimeout(this.timer));
    this.timer = null;
    for (const remove of this.removers.splice(0)) {
      remove();
    }
    for (const reference of this.roots) {
      const root = reference.deref();
      if (!root) {
        continue;
      }
      for (const remove of this.rootRemovers.get(root) || []) {
        remove();
      }
    }
    this.rootRemovers = new WeakMap();
    this.attachedRoots = new WeakSet();
  }

  snapshot() {
    return {
      schema: 1,
      active: this.active,
      reason: this.reason || 'other',
      events: JSON.parse(JSON.stringify(this.events)),
    };
  }

  cleanup() {
    this.stop();
    this.roots = [];
  }
}

window.VSC.VideoLoadDiagnostics = VideoLoadDiagnostics;
window.VSC.recordVideoDiagnostic = (event, media) => {
  diagnosticRead(() =>
    media.ownerDocument.defaultView.VSC_controller?.videoDiagnostics?.mark(event, media)
  );
};

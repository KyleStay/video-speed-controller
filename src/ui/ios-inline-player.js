/** Owned inline transport. The original media stays in its site's DOM. */
window.VSC = window.VSC || {};

class IOSInlinePlayer {
  /** Observe input without claiming the site's click, playback or scroll gesture. */
  static observeInteractions(target, onInteraction) {
    const types = [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'pointermove',
      'touchstart',
      'touchend',
      'click',
      'keydown',
      'focusin',
      'focusout',
    ];
    const onInput = (event) => {
      try {
        if (event.type !== 'pointermove' || event.pointerType !== 'touch') {
          onInteraction(event);
        }
      } catch {
        // Page-owned getters may disappear during the same interaction.
      }
    };
    for (const type of types) {
      try {
        target.addEventListener(type, onInput, { capture: true, passive: true });
      } catch {
        // Keep the remaining input paths available on a patched page target.
      }
    }
    return () => {
      for (const type of types) {
        try {
          target.removeEventListener(type, onInput, true);
        } catch {
          // One patched API must not prevent the rest of ownership cleanup.
        }
      }
    };
  }

  constructor(manager, shadow, video) {
    this.manager = manager;
    this.shadow = shadow;
    this.host = shadow.host;
    this.video = video;
    this.view = this.host.ownerDocument.defaultView;
    this.root = shadow.querySelector('#controller');
    this.owned = false;
    this.disposed = false;
    this.generation = 0;
    this.removers = [];
    this.timer = null;
    this.layout = null;
    this.idle = false;
    this.pointerInteraction = false;
    this.heldPointers = new Set();
    this.pointerRemovers = [];
    this.pictureTap = null;
    this.seeking = false;
    this.seekCancelled = false;
    this.refs = {};
    const doc = this.host.ownerDocument;
    const button = (name, label, text, action) => {
      const node = doc.createElement('button');
      node.type = 'button';
      node.className = `inline-owned-control inline-${name}`;
      node.dataset.inlineAction = name;
      node.setAttribute('aria-label', label);
      node.textContent = text;
      node.hidden = true;
      // Keep primary targets in a stable order across responsive layout changes.
      this.root.insertBefore(
        node,
        shadow.querySelector(name === 'play' ? '.draggable' : '#controls')
      );
      this.refs[name] = node;
      this.listen(
        node,
        'click',
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!this.available()) {
            return;
          }
          this.reveal();
          try {
            action();
          } catch {
            this.error('This video could not use that control.');
          }
        },
        true
      );
    };
    button('rewind', 'Rewind 10 seconds', '−10', () => this.seekBy(-10));
    button('play', 'Play video', '▶', () => this.playPause());
    button('forward', 'Forward 10 seconds', '+10', () => this.seekBy(10));
    button('mute', 'Mute video', 'Mute', () => {
      this.video.muted = !this.video.muted;
      this.update();
    });
    const group = doc.createElement('span');
    group.className = 'inline-owned-control inline-timeline';
    group.hidden = true;
    const timeline = doc.createElement('input');
    timeline.type = 'range';
    timeline.className = 'inline-seek';
    timeline.step = '0.1';
    timeline.setAttribute('aria-label', 'Seek video');
    const time = doc.createElement('span');
    time.className = 'inline-time';
    time.setAttribute('aria-hidden', 'true');
    const scrubHint = doc.createElement('span');
    scrubHint.className = 'inline-scrub-hint';
    scrubHint.id = 'inline-scrub-hint';
    scrubHint.setAttribute('role', 'status');
    scrubHint.setAttribute('aria-live', 'polite');
    timeline.setAttribute('aria-describedby', scrubHint.id);
    group.append(timeline, time, scrubHint);
    this.root.append(group);
    const status = doc.createElement('span');
    status.className = 'inline-owned-status';
    status.setAttribute('role', 'status');
    this.root.append(status);
    Object.assign(this.refs, { timeline, timelineGroup: group, time, status, scrubHint });
    // Inline and fullscreen use the same captured, distance-sensitive gesture.
    // The adapter keeps its authority scoped to this inline presentation/source.
    const inline = this;
    const ui = {
      host: this.host,
      refs: { seek: timeline, scrubHint },
      updateSeekProgress: () => this.updateSeekProgress(),
    };
    this.scrubber = new window.VSC.IOSPlayerScrubber({
      ui,
      video,
      get active() {
        return inline.available() && !inline.idle && !group.hidden;
      },
      get session() {
        return inline.generation;
      },
      seekBounds: () => this.bounds(),
      seekTo: (value) => this.seekTo(value),
      formatTime: (value) => this.format(value),
      update: () => this.update(),
      showControls: () => {
        this.seeking = this.scrubber.active;
        this.reveal();
      },
      onScrubFinish: (cancelled) => {
        this.seeking = false;
        this.seekCancelled = this.seekCancelled || cancelled;
      },
      play: () => this.play(),
    });
    this.scrubber.attach();
    this.listen(timeline, 'input', () => {
      if (!this.seekCancelled) {
        this.seekTo(Number(timeline.value));
      }
    });
    this.listen(timeline, 'change', () => {
      if (!this.seekCancelled) {
        this.seekTo(Number(timeline.value));
      }
      this.seekCancelled = false;
      this.seeking = false;
      this.update();
    });
    this.listen(
      timeline,
      'pointerdown',
      () => {
        this.seekCancelled = false;
      },
      true
    );
    this.listen(timeline, 'keydown', () => {
      this.seekCancelled = false;
    });
    this.listen(
      timeline,
      'pointercancel',
      () => {
        this.seekCancelled = true;
      },
      true
    );
    this.removers.push(
      IOSInlinePlayer.observeInteractions(this.root, (event) => this.controlInteraction(event)),
      IOSInlinePlayer.observeInteractions(video, (event) => this.surfaceInteraction(event))
    );
    for (const type of ['play', 'playing', 'pause', 'ended']) {
      this.listen(video, type, () => this.reveal());
    }
    for (const type of [
      'timeupdate',
      'durationchange',
      'progress',
      'ratechange',
      'volumechange',
      'loadedmetadata',
      'webkitpresentationmodechanged',
      'webkitbeginfullscreen',
      'webkitendfullscreen',
      'enterpictureinpicture',
      'leavepictureinpicture',
    ]) {
      this.listen(video, type, () => this.update());
    }
    for (const type of ['emptied', 'loadstart']) {
      this.listen(video, type, () => {
        this.cancelScrub();
        this.releasePointers();
        this.pictureTap = null;
        this.generation++;
        this.seekCancelled = this.seekCancelled || this.seeking;
        this.seeking = false;
        this.error('');
        this.reveal();
      });
    }
  }

  listen(target, type, listener, options) {
    try {
      target.addEventListener(type, listener, options);
      this.removers.push(() => target.removeEventListener(type, listener, options));
    } catch {
      // A page-owned target can disappear during controller creation.
    }
  }

  set(node, property, value) {
    if (node[property] !== value) {
      node[property] = value;
    }
  }

  available() {
    try {
      return (
        this.owned &&
        !this.disposed &&
        this.video.isConnected &&
        this.video.ownerDocument === this.host.ownerDocument &&
        !this.video.vsc?.iosPlayer?.active &&
        !this.host.classList.contains('vsc-native-presentation')
      );
    } catch {
      return false;
    }
  }

  setOwned(owned) {
    if (this.disposed) {
      return;
    }
    this.cancelScrub();
    this.releasePointers();
    this.pictureTap = null;
    this.owned = Boolean(owned);
    this.generation++;
    this.host.toggleAttribute('data-vsc-inline-owned', this.owned);
    this.clearTimer();
    if (!this.owned) {
      this.seekCancelled = this.seekCancelled || this.seeking;
      this.seeking = false;
      for (const name of ['play', 'rewind', 'forward', 'mute', 'timelineGroup']) {
        this.refs[name].hidden = true;
      }
      this.error('');
      for (const property of [
        '--vsc-inline-owned-width',
        '--vsc-inline-scale-x',
        '--vsc-inline-scale-y',
        '--vsc-inline-timeline-left',
        '--vsc-inline-timeline-top',
        '--vsc-inline-timeline-width',
      ]) {
        this.root.style.removeProperty(property);
      }
      this.scale = null;
      this.host.removeAttribute('data-vsc-inline-layout');
      this.host.removeAttribute('data-vsc-inline-idle');
      this.host.removeAttribute('data-vsc-inline-strip-hidden');
      this.setIdle(false);
      return;
    }
    this.update();
    this.manager.positionInlineControls(this.shadow, this.video);
    this.reveal();
  }

  position(layout) {
    if (!this.owned || this.disposed) {
      return;
    }
    const couldAutoHide = this.canAutoHide();
    this.layout = layout;
    let x = 1;
    let y = 1;
    try {
      const rect = this.root.getBoundingClientRect();
      let width;
      let height;
      try {
        const style = this.view.getComputedStyle(this.root);
        if (style.boxSizing === 'border-box') {
          // offsetWidth/Height round to integers and destabilize fractional
          // transforms. Computed used border-box dimensions retain precision.
          const usedWidth = Number.parseFloat(style.width);
          const usedHeight = Number.parseFloat(style.height);
          width = Number.isFinite(usedWidth) && usedWidth > 0 ? usedWidth : undefined;
          height = Number.isFinite(usedHeight) && usedHeight > 0 ? usedHeight : undefined;
        }
      } catch {
        // The integer layout fallback remains usable if computed style fails.
      }
      width ??= this.root.offsetWidth;
      height ??= this.root.offsetHeight;
      if (width > 0 && Number.isFinite(rect.width) && rect.width > 0) {
        x = rect.width / width;
      }
      if (height > 0 && Number.isFinite(rect.height) && rect.height > 0) {
        y = rect.height / height;
      }
    } catch {
      // An unmeasurable surface keeps the ordinary CSS-pixel fallback.
    }
    this.scale = { x, y };
    const width = Math.max(44, Math.min(420, layout.width - 8)) / x;
    for (const [property, value] of [
      ['--vsc-inline-owned-width', `${width}px`],
      ['--vsc-inline-scale-x', String(x)],
      ['--vsc-inline-scale-y', String(y)],
    ]) {
      if (this.root.style.getPropertyValue(property) !== value) {
        this.root.style.setProperty(property, value);
      }
    }
    if (this.idle && !this.canAutoHide()) {
      this.reveal();
    } else {
      this.update();
      if (couldAutoHide !== this.canAutoHide()) {
        this.scheduleIdleHide();
      }
    }
  }

  applyLayout(bounds = this.bounds()) {
    if (!this.owned) {
      return;
    }
    const width = this.layout?.width || 52;
    const height = this.layout?.height || 52;
    const mode = width < 100 ? 'minimal' : width < 164 || height < 96 ? 'compact' : 'standard';
    if (this.host.getAttribute('data-vsc-inline-layout') !== mode) {
      this.host.setAttribute('data-vsc-inline-layout', mode);
    }
    this.set(this.refs.play, 'hidden', false);
    const secondary = width >= 320 && height >= 96;
    for (const name of ['rewind', 'forward', 'mute']) {
      this.set(this.refs[name], 'hidden', !secondary);
    }
    this.set(this.refs.timelineGroup, 'hidden', width < 240 || height < 144 || !bounds);
  }

  bounds() {
    try {
      if (!Number.isFinite(this.video.currentTime)) {
        return null;
      }
      if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
        return [0, this.video.duration];
      }
      const ranges = this.video.seekable;
      const index = ranges.length - 1;
      const start = index >= 0 ? ranges.start(index) : NaN;
      const end = index >= 0 ? ranges.end(index) : NaN;
      return Number.isFinite(start) && Number.isFinite(end) && end > start ? [start, end] : null;
    } catch {
      return null;
    }
  }

  seekBy(delta) {
    this.seekTo(this.video.currentTime + delta);
  }

  seekTo(value) {
    if (!this.available()) {
      return;
    }
    try {
      const bounds = this.bounds();
      if (!bounds || !Number.isFinite(value)) {
        return;
      }
      const target = Math.max(bounds[0], Math.min(bounds[1], value));
      const delta = target - this.video.currentTime;
      if (delta !== 0) {
        this.manager.actionHandler.seek(this.video, delta);
      }
      this.update();
    } catch {
      this.error('This video could not seek.');
    }
  }

  playPause() {
    if (!this.video.paused && !this.video.ended) {
      this.video.pause();
      this.update();
      return;
    }
    this.play();
  }

  play() {
    if (!this.available()) {
      return;
    }
    const generation = this.generation;
    const source = this.scrubber.captureSource();
    const samePresentation = () => this.available() && generation === this.generation;
    // Page-owned getters can hand back and reacquire controls during inspection.
    const current = () =>
      samePresentation() && this.scrubber.matchesSource(source) && samePresentation();
    if (this.video.ended) {
      const bounds = this.bounds();
      if (bounds) {
        this.seekTo(bounds[0]);
      }
    }
    if (source ? !current() : !samePresentation()) {
      return;
    }
    this.error('');
    const fail = () => {
      if (current()) {
        this.error('Playback could not start.');
        this.update();
      }
    };
    try {
      Promise.resolve(this.video.play()).catch(fail);
    } catch {
      fail();
    }
    this.update();
  }

  format(value) {
    value = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  cancelScrub() {
    this.seekCancelled = this.seekCancelled || Boolean(this.scrubber?.active);
    this.scrubber?.finish(null, false, false, false);
    this.seeking = false;
  }

  updateSeekProgress() {
    const { timeline } = this.refs;
    const min = Number(timeline.min);
    const max = Number(timeline.max);
    const progress =
      max > min
        ? Math.max(0, Math.min(100, ((Number(timeline.value) - min) / (max - min)) * 100))
        : 0;
    const value = `${progress}%`;
    if (timeline.style.getPropertyValue('--seek-progress') !== value) {
      timeline.style.setProperty('--seek-progress', value);
    }
  }

  update() {
    if (!this.available()) {
      this.cancelScrub();
      this.clearTimer();
      this.releasePointers();
      this.pictureTap = null;
      return;
    }
    try {
      const label = this.video.ended
        ? 'Replay video'
        : this.video.paused
          ? 'Play video'
          : 'Pause video';
      this.set(this.refs.play, 'textContent', this.video.ended || this.video.paused ? '▶' : 'Ⅱ');
      if (this.refs.play.getAttribute('aria-label') !== label) {
        this.refs.play.setAttribute('aria-label', label);
      }
      const mute = this.video.muted ? 'Unmute video' : 'Mute video';
      if (this.refs.mute.getAttribute('aria-label') !== mute) {
        this.refs.mute.setAttribute('aria-label', mute);
      }
      this.set(this.refs.mute, 'textContent', this.video.muted ? 'Sound' : 'Mute');
      const bounds = this.bounds();
      this.set(this.refs.timeline, 'disabled', !bounds);
      this.set(this.refs.rewind, 'disabled', !bounds);
      this.set(this.refs.forward, 'disabled', !bounds);
      this.applyLayout(bounds);
      if (bounds && !this.idle && !this.refs.timelineGroup.hidden) {
        // Reserve fractional feedback before a drag; changing the label must
        // never resize the range underneath the captured finger.
        const timeWidth = `${Math.max(this.format(bounds[0]).length, this.format(bounds[1]).length) + this.format(bounds[1]).length + 6}ch`;
        if (this.refs.time.style.minWidth !== timeWidth) {
          this.refs.time.style.minWidth = timeWidth;
        }
        this.set(this.refs.timeline, 'min', String(bounds[0]));
        this.set(this.refs.timeline, 'max', String(bounds[1]));
        const position = this.scrubber?.active
          ? this.scrubber.value
          : Math.max(bounds[0], Math.min(bounds[1], this.video.currentTime));
        if (!this.scrubber?.active && !this.seeking) {
          this.set(this.refs.timeline, 'value', String(position));
        }
        this.updateSeekProgress();
        const text = `${this.scrubber?.active ? this.scrubber.formatTime(position) : this.format(position)} / ${this.format(bounds[1])}`;
        this.set(this.refs.time, 'textContent', text);
        if (this.refs.timeline.getAttribute('aria-valuetext') !== text) {
          this.refs.timeline.setAttribute('aria-valuetext', text);
        }
      }
    } catch {
      // Missing page-owned media getters must not break the content script.
    }
  }

  error(message) {
    this.set(this.refs.status, 'textContent', message);
  }

  canAutoHide() {
    return this.layout?.width >= 240 && this.layout?.height >= 144;
  }

  setIdle(idle) {
    this.idle = idle;
    this.host.toggleAttribute('data-vsc-inline-idle', idle);
  }

  releasePointers() {
    this.heldPointers.clear();
    for (const remove of this.pointerRemovers.splice(0)) {
      try {
        remove();
      } catch {
        // Release the remaining original-window subscriptions on patched pages.
      }
    }
  }

  holdPointer(event) {
    if (!Number.isFinite(event.pointerId)) {
      return;
    }
    this.heldPointers.add(event.pointerId);
    this.clearTimer();
    if (this.pointerRemovers.length) {
      return;
    }
    const finish = (end) => {
      if (!this.heldPointers.delete(end.pointerId)) {
        return;
      }
      if (end.type === 'pointercancel') {
        this.pictureTap = null;
      }
      if (!this.heldPointers.size) {
        this.releasePointers();
        this.scheduleIdleHide();
      }
    };
    const cancel = () => {
      this.pictureTap = null;
      this.releasePointers();
      this.scheduleIdleHide();
    };
    for (const [type, listener] of [
      ['pointerup', finish],
      ['pointercancel', finish],
      ['blur', cancel],
      ['pagehide', cancel],
    ]) {
      try {
        // Element blur is not a lost window interaction; focus may move while held.
        const capture = type !== 'blur';
        this.view.addEventListener(type, listener, capture);
        this.pointerRemovers.push(() => this.view.removeEventListener(type, listener, capture));
      } catch {
        this.releasePointers();
        break;
      }
    }
  }

  controlInteraction(event) {
    if (!this.available() || (event.type === 'focusout' && this.idle)) {
      return;
    }
    if (event.type === 'pointerdown') {
      this.pointerInteraction = true;
      this.holdPointer(event);
    } else if (event.type === 'keydown' || (event.type === 'click' && event.detail === 0)) {
      this.pointerInteraction = false;
    }
    this.reveal();
  }

  isPictureInteraction(event) {
    try {
      const path = event.composedPath();
      if (path.includes(this.host)) {
        return false;
      }
      if (path.includes(this.video)) {
        return true;
      }
      const container = this.video.vsc?.iosPlayer?.siteControls?.container;
      if (!container || !path.includes(container)) {
        return false;
      }
      const point = event.touches?.[0] || event.changedTouches?.[0] || event;
      const rect = this.video.getBoundingClientRect();
      if (!(
        point.clientX >= rect.left &&
        point.clientX <= rect.right &&
        point.clientY >= rect.top &&
        point.clientY <= rect.bottom
      )) {
        return false;
      }
      const control = event.target.closest?.('button,a,input,select,textarea,[role="button"]');
      if (!control) {
        return true;
      }
      // A full-picture button is a cover surface; retain independent site controls.
      const cover = control.getBoundingClientRect();
      return (
        control.localName === 'button' &&
        container.contains(control) &&
        cover.left <= rect.left + 1 &&
        cover.top <= rect.top + 1 &&
        cover.right >= rect.right - 1 &&
        cover.bottom >= rect.bottom - 1
      );
    } catch {
      return false;
    }
  }

  surfaceInteraction(event) {
    if (!this.available()) {
      return;
    }
    const path = event.composedPath();
    // The video and controller own their input even inside a recognized player.
    if (
      path.includes(this.host) ||
      (event.currentTarget !== this.video && path.includes(this.video))
    ) {
      return;
    }
    if (!this.isPictureInteraction(event)) {
      this.controlInteraction(event);
      return;
    }
    if (event.type === 'pointerdown') {
      this.pointerInteraction = true;
      this.pictureTap = { visible: !this.idle };
      this.holdPointer(event);
      if (event.pointerType === 'mouse') {
        this.reveal();
      }
    } else if (event.type === 'click') {
      this.pictureClicked(event);
    } else if (
      event.type === 'keydown' ||
      event.type === 'focusin' ||
      event.type === 'pointermove'
    ) {
      this.controlInteraction(event);
    }
  }

  pictureClicked(event) {
    if (!this.available()) {
      return;
    }
    const visible = event?.detail === 0 ? !this.idle : (this.pictureTap?.visible ?? !this.idle);
    this.pictureTap = null;
    if (this.host.classList.contains('vsc-touch-open')) {
      this.manager.setTouchExpanded(this.shadow, false);
      this.reveal();
    } else if (visible && this.canAutoHide() && !this.scrubber.active) {
      this.clearTimer();
      this.setIdle(true);
      this.shadow.activeElement?.blur();
    } else {
      this.reveal();
    }
  }

  clearTimer() {
    if (this.timer !== null) {
      this.view.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reveal() {
    if (!this.available()) {
      this.cancelScrub();
      this.clearTimer();
      return;
    }
    const generation = this.generation;
    this.clearTimer();
    this.setIdle(false);
    this.update();
    if (generation !== this.generation) {
      return;
    }
    if (!this.available()) {
      this.cancelScrub();
      this.clearTimer();
      return;
    }
    this.scheduleIdleHide();
  }

  scheduleIdleHide() {
    this.clearTimer();
    const generation = this.generation;
    try {
      if (
        !this.available() ||
        this.idle ||
        !this.canAutoHide() ||
        this.video.paused ||
        this.video.ended ||
        this.scrubber.active ||
        this.heldPointers.size ||
        this.host.classList.contains('vsc-touch-open')
      ) {
        return;
      }
      const focused = this.shadow.activeElement;
      if (
        this.root.contains(focused) &&
        (!this.pointerInteraction || focused.matches(':focus-visible'))
      ) {
        return;
      }
      if (generation !== this.generation || !this.available()) {
        return;
      }
      this.timer = this.view.setTimeout(() => {
        this.timer = null;
        try {
          if (
            generation === this.generation &&
            this.available() &&
            this.canAutoHide() &&
            !this.video.paused &&
            !this.video.ended &&
            !this.scrubber.active &&
            !this.heldPointers.size &&
            !this.host.classList.contains('vsc-touch-open') &&
            generation === this.generation &&
            this.available()
          ) {
            this.setIdle(true);
          }
        } catch {
          // A site can replace playback getters after the timer was scheduled.
        }
      }, 4000);
    } catch {
      // Keep the transport available if page-owned state is inaccessible.
    }
  }

  cleanup() {
    if (this.disposed) {
      return;
    }
    this.setOwned(false);
    this.scrubber.cleanup();
    this.disposed = true;
    this.generation++;
    for (const remove of this.removers.splice(0)) {
      try {
        remove();
      } catch {
        /* Continue releasing the other listeners. */
      }
    }
    for (const name of ['play', 'rewind', 'forward', 'mute', 'timelineGroup', 'status']) {
      this.refs[name].remove();
    }
  }
}

window.VSC.IOSInlinePlayer = IOSInlinePlayer;

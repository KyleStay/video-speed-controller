/** Owned inline transport. The original media stays in its site's DOM. */
window.VSC = window.VSC || {};

class IOSInlinePlayer {
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
      // Keep permanent primary targets ahead of idle-hidden controls. Revealing
      // secondary transport on pointerdown/focus must not move the tapped target.
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
        return inline.available() && !group.hidden;
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
    this.listen(this.root, 'pointerdown', () => this.reveal(), true);
    this.listen(this.root, 'focusin', () => this.reveal());
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
    this.update();
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
    const secondary = !this.idle && width >= 320 && height >= 96;
    for (const name of ['rewind', 'forward', 'mute']) {
      this.set(this.refs[name], 'hidden', !secondary);
    }
    this.set(
      this.refs.timelineGroup,
      'hidden',
      this.idle || width < 240 || height < 144 || !bounds
    );
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
      if (bounds && !this.refs.timelineGroup.hidden) {
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
    this.idle = false;
    this.host.removeAttribute('data-vsc-inline-idle');
    this.update();
    if (generation !== this.generation) {
      return;
    }
    if (!this.available()) {
      this.cancelScrub();
      this.clearTimer();
      return;
    }
    try {
      const playing = !this.video.paused && !this.video.ended;
      if (playing && this.available() && generation === this.generation) {
        this.clearTimer();
        this.timer = this.view.setTimeout(() => {
          if (generation !== this.generation) {
            return;
          }
          this.timer = null;
          try {
            if (
              !this.available() ||
              this.video.paused ||
              this.video.ended ||
              this.root.contains(this.shadow.activeElement) ||
              this.host.classList.contains('vsc-touch-open') ||
              generation !== this.generation
            ) {
              return;
            }
            this.idle = true;
            this.host.setAttribute('data-vsc-inline-idle', '');
            this.applyLayout();
          } catch {
            // Playback getters can disappear after this timer was scheduled.
          }
        }, 2500);
      }
    } catch {
      // Keep the transport available if playback state is inaccessible.
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

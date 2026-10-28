/** Media-shaped adapter on the original image. A browser animation owns drawing,
 * so GIF playback needs no frame timer, polling, canvas overlay, or DOM replacement.
 */
window.VSC = window.VSC || {};

class GifPlayback {
  static instances = new WeakMap();

  static get(image) {
    return GifPlayback.instances.get(image);
  }

  constructor(image, gif, frames, onDispose) {
    this.image = image;
    this.document = image.ownerDocument;
    this.view = this.document.defaultView;
    this.gif = gif;
    this.frames = frames;
    this.onDispose = onDispose;
    this.descriptors = new Map();
    this.rate = 1;
    this.userPaused = false;
    this.suspended = false;
    this.disposed = false;
    this.finished = false;
    this.seekEnd = false;
    const iterations = gif.repetitions === 0 ? Infinity : (gif.repetitions ?? 0) + 1;
    const keyframes = frames.map((frame) => ({
      content: `url("${frame.url}")`,
      offset: frame.start / gif.duration,
      easing: 'steps(1, end)',
    }));
    keyframes.push({ content: keyframes.at(-1).content, offset: 1 });
    try {
      this.animation = image.animate(keyframes, {
        duration: gif.duration * 1000,
        iterations,
        fill: 'both',
      });
      if (
        !this.animation.effect
          ?.getKeyframes()
          .some((frame) => frame.content?.includes(frames[0].url))
      ) {
        throw new Error('Animated image content is unavailable');
      }
      this.animation.pause();
      this.animation.currentTime = 0;
      const property = (key, get, set) => {
        // Never overwrite properties supplied by the page or another extension.
        if (key in image) {
          throw new Error(`Image already has ${key}`);
        }
        const descriptor = { configurable: true, get, ...(set ? { set } : {}) };
        Object.defineProperty(image, key, descriptor);
        this.descriptors.set(key, descriptor);
      };
      property(
        'playbackRate',
        () => this.rate,
        (value) => {
          const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
          if (!Number.isFinite(value) || value < MIN || value > MAX) {
            return;
          }
          this.rate = value;
          this.animation.playbackRate = value;
          this.emit('ratechange');
        }
      );
      property('duration', () => gif.duration);
      property('readyState', () => 4);
      property(
        'paused',
        () => this.userPaused || this.finished || this.animation.playState === 'finished'
      );
      property('ended', () => this.finished || this.animation.playState === 'finished');
      property(
        'currentTime',
        () => this.currentTime,
        (value) => {
          if (!Number.isFinite(value)) {
            return;
          }
          const time = Math.max(0, Math.min(gif.duration, value));
          this.finished = false;
          this.seekEnd = time === gif.duration;
          this.animation.currentTime = this.seekEnd ? gif.duration * 1000 - 0.001 : time * 1000;
          this.emit('timeupdate');
          this.emit('seeked');
        }
      );
      property('seekable', () => ({ length: 1, start: () => 0, end: () => gif.duration }));
      property(
        'muted',
        () => true,
        () => {}
      );
      property(
        'volume',
        () => 0,
        () => {}
      );
      property('play', () => () => this.play());
      property('pause', () => () => this.pause());
      this.animation.onfinish = () => {
        this.finished = true;
        this.emit('pause');
        this.emit('ended');
      };
      GifPlayback.instances.set(image, this);
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  get currentTime() {
    if (
      this.finished ||
      this.animation.playState === 'finished' ||
      (this.userPaused && this.seekEnd)
    ) {
      return this.gif.duration;
    }
    return ((this.animation.currentTime || 0) / 1000) % this.gif.duration;
  }

  emit(type) {
    if (!this.disposed) {
      this.image.dispatchEvent(new this.view.Event(type));
    }
  }

  async play() {
    if (this.disposed) {
      return;
    }
    this.userPaused = false;
    if (this.finished || this.animation.playState === 'finished') {
      this.animation.currentTime = 0;
    }
    this.finished = this.seekEnd = false;
    if (!this.suspended) {
      this.animation.play();
    }
    this.emit('play');
    this.emit('playing');
  }

  pause() {
    if (this.disposed) {
      return;
    }
    this.userPaused = true;
    this.animation.pause();
    this.emit('pause');
  }

  suspend(value) {
    if (this.disposed) {
      return;
    }
    this.suspended = value;
    if (this.finished || this.animation.playState === 'finished') {
      return;
    }
    if (value) {
      this.animation.pause();
    } else if (!this.userPaused && this.animation.playState !== 'finished') {
      this.animation.play();
    }
  }

  stepFrame(direction) {
    if (!this.image.paused) {
      return;
    }
    const time = this.currentTime;
    let index = this.frames.findIndex((frame) => frame.end > time + 1e-7);
    if (index < 0) {
      index = this.frames.length - 1;
    }
    const next = Math.max(0, Math.min(this.frames.length - 1, index + direction));
    this.image.currentTime = this.frames[next].start;
  }

  cleanup() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    GifPlayback.instances.delete(this.image);
    try {
      this.animation?.cancel();
    } catch {
      // A page patch must not block property/frame-URL cleanup.
    }
    for (const [key, descriptor] of this.descriptors) {
      const current = Object.getOwnPropertyDescriptor(this.image, key);
      if (
        current?.configurable &&
        current.get === descriptor.get &&
        current.set === descriptor.set
      ) {
        delete this.image[key];
      }
    }
    for (const frame of this.frames) {
      try {
        this.view.URL.revokeObjectURL(frame.url);
      } catch {
        // Release the remaining owned resources if this page API fails.
      }
    }
    this.frames = [];
    this.onDispose?.();
  }
}

window.VSC.GifPlayback = GifPlayback;

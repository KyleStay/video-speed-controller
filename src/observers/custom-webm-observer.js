/** Prefer native WebM for a bounded, recognizable JavaScript decoder surface on iOS. */
window.VSC = window.VSC || {};

class CustomWebMObserver {
  static players = new WeakMap();
  static sequence = 0;

  static get(video) {
    return this.players.get(video);
  }

  constructor(document, attach) {
    this.document = document;
    this.view = document.defaultView;
    this.attach = attach;
    this.entries = new Map();
    this.attempts = new WeakMap();
    this.roots = new Set();
    this.active = window.VSC.IOSPlayer.isIOS(this.view);
    this.ready = (event) => {
      try {
        if (event.target?.localName === 'ogvjs') {
          const row = this.entries.get(event.target);
          if (event.type === 'playing' && row?.owned() && !event.target.paused) {
            // A site may retain its original play function before attachment.
            // OGV also queues notifications that can arrive after our pause.
            row.cleanup(false);
            return;
          }
          this.consider(event.target);
        }
      } catch {
        // Patched decoder properties retain site ownership.
      }
    };
    if (this.active) {
      this.observeRoot(document);
    }
  }

  observeRoot(root) {
    if (!this.active || this.roots.has(root)) {
      return;
    }
    this.roots.add(root);
    for (const type of ['loadedmetadata', 'playing', 'loadstart']) {
      root.addEventListener(type, this.ready, true);
    }
    for (const original of root.querySelectorAll('ogvjs')) {
      this.consider(original);
    }
  }

  unobserveRoot(root) {
    for (const type of ['loadedmetadata', 'playing', 'loadstart']) {
      root.removeEventListener(type, this.ready, true);
    }
    this.roots.delete(root);
  }

  consider(original) {
    let rollback;
    try {
      if (!this.active || original?.localName !== 'ogvjs') {
        return;
      }
      const prior = this.entries.get(original);
      if (prior) {
        if (!prior.current()) {
          prior.cleanup(false);
        } else {
          return;
        }
      }
      const container = original.parentElement;
      const source = new URL(original.src, this.document.baseURI);
      if (
        !original.isConnected ||
        original.ownerDocument !== this.document ||
        !container?.matches('.ogv-cnt.expandedWebm') ||
        container.querySelectorAll('ogvjs,video,audio,iframe').length !== 1 ||
        !['https:', 'http:'].includes(source.protocol) ||
        source.username ||
        source.password ||
        !/\.webm$/i.test(source.pathname) ||
        this.attempts.get(original) === source.href ||
        this.entries.size >= 8 ||
        typeof original.play !== 'function' ||
        typeof original.pause !== 'function' ||
        typeof original.stop !== 'function'
      ) {
        return;
      }
      const descriptors = new Map(
        ['play', 'pause', 'stop'].map((name) => [
          name,
          Object.getOwnPropertyDescriptor(original, name),
        ])
      );
      if ([...descriptors.values()].some((item) => item && !item.configurable && !item.writable)) {
        return;
      }
      const video = this.document.createElement('video');
      if (!video.canPlayType('video/webm')) {
        return;
      }
      this.attempts.set(original, source.href);
      const removers = [];
      const token = `webm-${++CustomWebMObserver.sequence}`;
      const attribute = 'data-vsc-custom-webm';
      const originalMarker = container.getAttribute(attribute);
      const originRoot = container.getRootNode();
      const originalPause = original.pause;
      const originalPlay = original.play;
      const originalStop = original.stop;
      let committed = false,
        closed = false,
        style,
        observer,
        requestedPlay = false;
      const listen = (target, type, callback) => {
        target.addEventListener(type, callback);
        removers.push(() => target.removeEventListener(type, callback));
      };
      const current = (allowDetached = false) => {
        try {
          return (
            !closed &&
            this.active &&
            original.isConnected &&
            original.ownerDocument === this.document &&
            original.parentElement === container &&
            container.getRootNode() === originRoot &&
            new URL(original.src, this.document.baseURI).href === source.href &&
            video.src === source.href &&
            (!committed ||
              allowDetached ||
              (video.isConnected && video.ownerDocument === this.document))
          );
        } catch {
          return false;
        }
      };
      const cleanup = (resume = true, forcePlay = false, restorePlayback = true) => {
        if (closed) {
          return;
        }
        const restore = committed && resume && current() && !this.document.hidden;
        const time = video.currentTime,
          playing = forcePlay || (!video.paused && !video.ended);
        closed = true;
        this.entries.delete(original);
        CustomWebMObserver.players.delete(video);
        this.view.clearTimeout(timer);
        observer?.disconnect();
        for (const remove of removers) {
          try {
            remove();
          } catch {
            /* Release remaining listeners independently. */
          }
        }
        for (const [name, method] of methods) {
          try {
            if (original[name] === method) {
              const descriptor = descriptors.get(name);
              if (descriptor) {
                Object.defineProperty(original, name, descriptor);
              } else {
                delete original[name];
              }
            }
          } catch {
            /* Preserve a newer site patch. */
          }
        }
        try {
          video.vsc?.remove();
        } catch {
          /* Release media independently. */
        }
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {
          /* Disposed decoder. */
        }
        video.remove();
        if (container.getAttribute(attribute) === token) {
          if (originalMarker === null) {
            container.removeAttribute(attribute);
          } else {
            container.setAttribute(attribute, originalMarker);
          }
        }
        style?.remove();
        if (restore) {
          try {
            original.muted = video.muted;
            original.volume = video.volume;
            if (original.seekable?.length && Number.isFinite(time)) {
              original.currentTime = time;
            }
            if (playing && restorePlayback) {
              originalPlay.call(original)?.catch?.(() => {});
            }
          } catch {
            /* Site player may already have been disposed. */
          }
        }
      };
      const stop = (...args) => {
        cleanup(false);
        return originalStop.apply(original, args);
      };
      const methods = new Map([
        ['stop', stop],
        ...[
          ['play', originalPlay],
          ['pause', originalPause],
        ].map(([name, method]) => [
          name,
          (...args) => {
            if (committed) {
              cleanup(true, false, false);
            }
            return method.apply(original, args);
          },
        ]),
      ]);
      const row = {
        video,
        original,
        container,
        source: source.href,
        current,
        cleanup,
        owned: () => committed && current(),
      };
      rollback = cleanup;
      this.entries.set(original, row);
      CustomWebMObserver.players.set(video, row);
      const timer = this.view.setTimeout(() => cleanup(false), 10000);
      for (const [name, method] of methods) {
        const descriptor = descriptors.get(name);
        Object.defineProperty(original, name, {
          configurable: descriptor?.configurable ?? true,
          enumerable: descriptor?.enumerable ?? false,
          writable: descriptor?.writable ?? true,
          value: method,
        });
      }
      video.controls = true;
      video.preload = 'auto';
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', '');
      // The recognized decoder surface loops its clip after completion.
      video.loop = true;
      listen(video, 'error', () => cleanup());
      listen(video, 'loadeddata', () => {
        if (committed || !current()) {
          return;
        }
        try {
          const playing = (requestedPlay = !original.paused);
          const time = original.currentTime;
          video.muted = Boolean(original.muted);
          if (Number.isFinite(original.volume)) {
            video.volume = original.volume;
          }
          if (Number.isFinite(time) && time > 0) {
            video.currentTime = time;
          }
          style = this.document.createElement('style');
          style.textContent = `[${attribute}="${token}"] > ogvjs, [${attribute}="${token}"] > .ogv-ctrl { display:none !important; }`;
          const root = container.getRootNode();
          (root === this.document
            ? this.document.head || this.document.documentElement
            : root
          ).append(style);
          video.style.cssText = 'display:block;width:100%;height:auto;max-width:100%;';
          committed = true;
          originalPause.call(original);
          // Page-owned methods and their synchronous events may stop/recycle
          // this decoder. Do not resurrect it after reentrant cleanup.
          if (!current(true)) {
            cleanup(false);
            return;
          }
          container.setAttribute(attribute, token);
          original.after(video);
          this.view.clearTimeout(timer);
          observer = new this.view.MutationObserver(() => {
            if (!current()) {
              cleanup(false);
            }
          });
          observer.observe(original, { attributes: true, attributeFilter: ['src'] });
          this.attach(video, container);
          if (!current()) {
            cleanup(false);
            return;
          }
          if (playing) {
            video.play()?.then(
              () => {
                if (closed) {
                  video.pause();
                }
              },
              () => cleanup(true, playing)
            );
          }
        } catch {
          cleanup(true, requestedPlay);
        }
      });
      for (const type of ['timeupdate', 'play', 'playing']) {
        listen(video, type, () => {
          if (committed && !current()) {
            cleanup(false);
          }
        });
      }
      video.src = source.href;
      video.load();
    } catch {
      rollback?.(false);
      // Unknown or patched decoder APIs retain the original player.
    }
  }

  remove(original) {
    this.entries.get(original)?.cleanup(false);
    this.attempts.delete(original);
  }

  cleanup() {
    // Restore the custom renderer before disabling discovery.
    for (const row of [...this.entries.values()]) {
      row.cleanup();
    }
    this.active = false;
    for (const root of this.roots) {
      this.unobserveRoot(root);
    }
  }
}

window.VSC.CustomWebMObserver = CustomWebMObserver;

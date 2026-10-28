/** GIF discovery shares the media mutation walk. Only visible GIF candidates
 * are fetched, with one decoder and a bounded frame budget per document.
 */
window.VSC = window.VSC || {};

class GifObserver {
  constructor(document, attach) {
    this.document = document;
    this.view = document.defaultView;
    this.attach = attach;
    this.entries = new Map();
    this.waiting = new Set();
    this.attempts = new WeakMap();
    this.roots = new Set();
    this.active = true;
    this.decoding = false;
    this.framePixels = 0;
    this.pumpTimer = null;
    this.load = (event) => this.consider(event.target);
    this.visibility = () => {
      for (const row of this.entries.values()) {
        row.playback?.suspend(this.document.hidden || !row.visible);
      }
      this.schedule();
    };
    if (typeof this.view.IntersectionObserver === 'function') {
      this.intersections = new this.view.IntersectionObserver((entries) => {
        for (const entry of entries) {
          const row = this.entries.get(entry.target);
          if (!row) {
            if (entry.isIntersecting) {
              this.consider(entry.target, true);
            } else {
              this.waiting.delete(entry.target);
            }
            continue;
          }
          row.visible = entry.isIntersecting;
          if (!row.visible && !row.started) {
            // A queued image can scroll away before its turn. Return its slot
            // without treating that cancellation as a failed resource attempt.
            this.attempts.delete(row.image);
            this.release(row);
            this.intersections.observe(row.image);
            continue;
          }
          row.playback?.suspend(this.document.hidden || !row.visible);
        }
        this.schedule();
      });
    }
    this.observeRoot(document);
    document.addEventListener('visibilitychange', this.visibility);
  }

  static source(image) {
    return image.currentSrc || image.src || '';
  }

  static candidate(image) {
    if (image?.tagName !== 'IMG') {
      return false;
    }
    try {
      const url = new URL(GifObserver.source(image), image.ownerDocument.baseURI);
      return (
        /^data:image\/gif[;,]/i.test(url.href) ||
        url.protocol === 'blob:' ||
        (['http:', 'https:', 'file:'].includes(url.protocol) &&
          (/\.gif$/i.test(url.pathname) ||
            /^(gif)$/i.test(url.searchParams.get('format') || url.searchParams.get('fm') || '')))
      );
    } catch {
      return false;
    }
  }

  static signature(image) {
    return JSON.stringify([
      GifObserver.source(image),
      image.getAttribute('src'),
      image.getAttribute('srcset'),
      image.getAttribute('sizes'),
    ]);
  }

  observeRoot(root) {
    if (!this.active || this.roots.has(root)) {
      return;
    }
    this.roots.add(root);
    root.addEventListener('load', this.load, true);
    this.scan(root);
  }

  unobserveRoot(root) {
    root.removeEventListener('load', this.load, true);
    this.roots.delete(root);
  }

  scan(root) {
    // No whole-tree walk or decoding on ordinary image-only pages.
    for (const image of root.querySelectorAll(
      'img[src*=".gif" i],img[srcset*=".gif" i],img[src^="data:image/gif" i],img[src^="blob:"],img[src*="format=gif" i],img[src*="fm=gif" i],picture img'
    )) {
      this.consider(image);
    }
  }

  consider(image, visible = !this.intersections) {
    try {
      this.considerImage(image, visible);
    } catch (error) {
      window.VSC.logger.debug(`GIF candidate unavailable: ${error?.message}`);
    }
  }

  considerImage(image, visible) {
    if (
      !this.active ||
      !image?.isConnected ||
      image.ownerDocument !== this.document ||
      image.tagName !== 'IMG'
    ) {
      return;
    }
    const signature = GifObserver.signature(image);
    const previous = this.entries.get(image);
    if (previous?.signature === signature) {
      return;
    }
    if (previous) {
      this.remove(image);
    }
    if (
      !image.complete ||
      !image.naturalWidth ||
      image.vsc ||
      !GifObserver.candidate(image) ||
      this.attempts.get(image) === signature
    ) {
      return;
    }
    // Observe visibility before allocating a decoding slot. Offscreen images
    // cannot fill the queue and prevent a later visible image from qualifying.
    if (!visible) {
      this.intersections?.observe(image);
      return;
    }
    if (this.entries.size >= 32) {
      this.waiting.add(image);
      return;
    }
    this.waiting.delete(image);
    this.attempts.set(image, signature);
    const row = {
      image,
      signature,
      source: GifObserver.source(image),
      abort: new this.view.AbortController(),
      visible,
      started: false,
    };
    // Only candidates own attribute observers. Source intent immediately ends
    // takeover, even while the replacement image is still loading.
    row.observer = new this.view.MutationObserver(() => {
      this.remove(image);
      this.attempts.delete(image);
      this.consider(image);
    });
    row.observer.observe(image, { attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
    this.entries.set(image, row);
    this.intersections?.observe(image);
    this.schedule();
  }

  schedule() {
    if (!this.active || this.decoding || this.pumpTimer !== null || this.document.hidden) {
      return;
    }
    this.pumpTimer = this.view.setTimeout(() => {
      this.pumpTimer = null;
      for (const image of this.waiting) {
        if (this.entries.size >= 32) {
          break;
        }
        this.waiting.delete(image);
        this.consider(image, true);
      }
      void this.pump();
    }, 0);
  }

  current(row) {
    return (
      this.active &&
      this.entries.get(row.image) === row &&
      !row.abort.signal.aborted &&
      row.image.isConnected &&
      row.image.ownerDocument === this.document &&
      GifObserver.signature(row.image) === row.signature
    );
  }

  async pump() {
    if (!this.active || this.decoding || this.document.hidden) {
      return;
    }
    const row = [...this.entries.values()].find((entry) => entry.visible && !entry.started);
    if (!row) {
      return;
    }
    row.started = this.decoding = true;
    let frames;
    row.deadline = this.view.setTimeout(() => row.abort.abort(), 10000);
    try {
      const decoder = window.VSC.GifDecoder;
      const response = await decoder.wait(
        this.view.fetch(row.source, {
          signal: row.abort.signal,
          credentials: 'same-origin',
          cache: 'force-cache',
        }),
        row.abort.signal
      );
      const gif = decoder.parse(await decoder.read(response, row.abort.signal));
      if (gif.frames.length < 2 || !this.current(row)) {
        return;
      }
      const pixels = gif.width * gif.height * gif.frames.length;
      if (
        this.framePixels + pixels > decoder.limits.framePixels ||
        [...this.entries.values()].filter((entry) => entry.playback).length >= 8
      ) {
        return;
      }
      row.pixels = pixels;
      this.framePixels += pixels;
      frames = await decoder.decode(gif, this.document, row.abort.signal);
      // Confirm these PNGs are allowed by the document's image CSP before
      // suppressing native animation. Decode failure leaves the original intact.
      for (const frame of frames) {
        const probe = new this.view.Image();
        probe.src = frame.url;
        await decoder.wait(probe.decode(), row.abort.signal);
        row.abort.signal.throwIfAborted();
      }
      if (!this.current(row)) {
        return;
      }
      // The playback object needs timing/loop metadata, not compressed patches.
      for (const frame of gif.frames) {
        delete frame.parts;
      }
      const playbackFrames = frames;
      frames = null;
      row.playback = new window.VSC.GifPlayback(row.image, gif, playbackFrames, () =>
        this.release(row)
      );
      this.attach(row.image, row.image.parentElement);
      if (!row.image.vsc) {
        this.remove(row.image);
        return;
      }
      row.playback.suspend(this.document.hidden || !row.visible);
      await row.playback.play();
    } catch (error) {
      window.VSC.logger.debug(`GIF left with its site renderer: ${error?.message}`);
    } finally {
      if (frames) {
        for (const frame of frames) {
          this.view.URL.revokeObjectURL(frame.url);
        }
      }
      this.view.clearTimeout(row.deadline);
      if (!row.playback || !this.current(row)) {
        this.remove(row.image, row);
      }
      this.decoding = false;
      this.schedule();
    }
  }

  release(row) {
    if (row.released) {
      return;
    }
    row.released = true;
    if (this.entries.get(row.image) === row) {
      this.entries.delete(row.image);
      if (row.playback || !row.image.isConnected) {
        this.attempts.delete(row.image);
      }
    }
    row.abort.abort();
    row.observer.disconnect();
    this.intersections?.unobserve(row.image);
    this.view.clearTimeout(row.deadline);
    this.framePixels -= row.pixels || 0;
  }

  remove(image, expected = this.entries.get(image)) {
    if (!expected) {
      this.waiting.delete(image);
      this.intersections?.unobserve(image);
    }
    if (!expected || this.entries.get(image) !== expected) {
      return;
    }
    this.release(expected);
    if (expected.playback) {
      image.vsc?.remove();
      expected.playback.cleanup();
    }
  }

  cleanup() {
    this.active = false;
    this.view.clearTimeout(this.pumpTimer);
    for (const root of this.roots) {
      this.unobserveRoot(root);
    }
    this.document.removeEventListener('visibilitychange', this.visibility);
    this.intersections?.disconnect();
    this.waiting.clear();
    for (const image of this.entries.keys()) {
      this.remove(image);
    }
  }
}

window.VSC.GifObserver = GifObserver;

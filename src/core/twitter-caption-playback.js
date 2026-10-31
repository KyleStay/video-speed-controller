/** Preserve a proven complete X caption rendition on the original fast MP4. */
window.VSC = window.VSC || {};
(function () {
  const CUE_FIELDS = [
    'vertical',
    'snapToLines',
    'line',
    'lineAlign',
    'position',
    'positionAlign',
    'size',
    'align',
    'pauseOnExit',
  ];
  const failed = new WeakMap();
  const requests = new WeakMap();
  const safely = (callback, fallback = false) => {
    try {
      return callback();
    } catch {
      return fallback;
    }
  };
  const modes = new Set(['disabled', 'hidden', 'showing']);
  const cueScalars = (cue, view) => {
    if (typeof view.VTTCue !== 'function' || !(cue instanceof view.VTTCue) || cue.region !== null) {
      return null;
    }
    const result = {};
    for (const key of CUE_FIELDS) {
      const value = cue[key];
      if (
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && value.length > 32)
      ) {
        return null;
      }
      result[key] = value;
    }
    return result;
  };
  const expectedSettings = (raw) => {
    const value = {
      vertical: '',
      snapToLines: true,
      line: 'auto',
      lineAlign: 'start',
      position: 'auto',
      positionAlign: 'auto',
      size: 100,
      align: 'center',
      pauseOnExit: false,
    };
    for (const token of raw
      .trim()
      .split(/[ \t]+/)
      .filter(Boolean)) {
      const [key, setting] = token.split(':');
      if (key === 'line') {
        const [line, align] = setting.split(',');
        value.snapToLines = !line.endsWith('%');
        value.line = line === 'auto' ? 'auto' : Number(line.replace('%', ''));
        if (align) {
          value.lineAlign = align;
        }
      } else if (key === 'position') {
        const [position, align] = setting.split(',');
        value.position = Number(position.replace('%', ''));
        if (align) {
          value.positionAlign = align;
        }
      } else if (key === 'size') {
        value.size = Number(setting.replace('%', ''));
      } else {
        value[key] = setting;
      }
    }
    return value;
  };
  const sameCue = (cue, oracle, tolerance = 0.002) =>
    Number.isFinite(cue.startTime) &&
    Number.isFinite(cue.endTime) &&
    Math.abs(cue.startTime - oracle.start) < tolerance &&
    Math.abs(cue.endTime - oracle.end) < tolerance &&
    cue.text === oracle.text;
  const fullTrack = (element, certificate, view, style = null) => {
    if (element?.readyState !== 2) {
      return false;
    }
    const list = element.track?.cues;
    if (!list || list.length !== certificate.oracle.length || list.length > 256) {
      return false;
    }
    for (let index = 0; index < list.length; index++) {
      const cue = list[index],
        oracle = certificate.oracle[index];
      const scalars = cueScalars(cue, view);
      const expected = expectedSettings(oracle.settings);
      if (style) {
        expected.line = style.line;
        expected.snapToLines = style.snapToLines;
      }
      if (
        !scalars ||
        !sameCue(cue, oracle) ||
        cue.id !== oracle.id ||
        CUE_FIELDS.some((key) => scalars[key] !== expected[key])
      ) {
        return false;
      }
    }
    return true;
  };
  const mediaState = (controller) =>
    controller.actionHandler?.eventManager?.getMediaRateState?.(controller.video);
  const authorized = (controller, rate) => {
    const config = controller.config;
    const local = mediaState(controller);
    if (
      Number.isFinite(local?.lifecycleSpeed) &&
      (local.lifecycleSpeedRevision ?? 0) === (config.speedPreferenceRevision ?? 0)
    ) {
      return local.lifecycleSpeed === rate;
    }
    return config.settings.lastSpeed === rate || config.settings.siteDefaultSpeed === rate;
  };
  const base = (controller) => {
    const video = controller?.video,
      doc = video?.ownerDocument;
    return Boolean(
      controller &&
      !controller.disposed &&
      video?.vsc === controller &&
      window.VSC.IOSPlayer?.isSupported(video) &&
      window.VSC.EventManager.isTwitterHost(new URL(doc.URL).hostname) &&
      video.isConnected &&
      doc.visibilityState !== 'hidden' &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      !video.srcObject &&
      !video.mediaKeys &&
      !video.webkitKeys &&
      !(video.audioTracks?.length > 1) &&
      !(video.videoTracks?.length > 1) &&
      !window.VSC.IOSPlayer.siteRelinquished?.has(video) &&
      !controller.iosPlayer?.nativeSession &&
      !video.webkitDisplayingFullscreen &&
      (!video.webkitPresentationMode || video.webkitPresentationMode === 'inline') &&
      doc.pictureInPictureElement !== video &&
      doc.fullscreenElement !== video
    );
  };
  const candidateFor = (controller) =>
    window.VSC.TwitterMediaSource.findCaptionCandidate(
      controller.video,
      controller.iosPlayer?.active ? controller.iosPlayer.originParent : undefined
    );
  const ownedSpeedInput = (controller, event) =>
    safely(() => {
      const path = event.composedPath();
      if (!Array.isArray(path) || path.length > 64) {
        return false;
      }
      const root = controller.div?.shadowRoot;
      return Boolean(
        root &&
        path.some(
          (node) =>
            node?.localName === 'button' &&
            node.getRootNode() === root &&
            ['faster', 'slower', 'setSpeed', 'preferredSpeed'].includes(node.dataset.action)
        )
      );
    });

  // A separate, finite owner restores only native caption modes. It never
  // loads/seeks/plays media and yields immediately to a new source or choice.
  function restoreCaptionModes(session) {
    const { controller, video, doc, view, preparation: prep } = session;
    controller.twitterCaptionRestore?.cleanup();
    const removals = [];
    const sourceEvents = new Set();
    const priorEvents = new Set(
      session.pending ? ['emptied', 'loadstart'].filter((type) => !session.events.has(type)) : []
    );
    let closed = false,
      writing = false,
      timer,
      observer;
    const owner = {
      cleanup() {
        if (closed) {
          return;
        }
        closed = true;
        safely(() => observer?.disconnect());
        safely(() => view.clearTimeout(timer));
        for (const remove of removals.splice(0)) {
          safely(remove);
        }
        if (controller.twitterCaptionRestore === owner) {
          controller.twitterCaptionRestore = null;
        }
      },
    };
    controller.twitterCaptionRestore = owner;
    const listen = (target, type, callback, options) => {
      if (!target?.addEventListener) {
        return;
      }
      target.addEventListener(type, callback, options);
      removals.push(() => target.removeEventListener(type, callback, options));
    };
    const identity = () =>
      video.isConnected &&
      video.ownerDocument === doc &&
      doc.documentElement === prep.root &&
      doc.URL === prep.url &&
      (video.vsc === controller || (controller.disposed && video.vsc === undefined)) &&
      video.getAttribute('src') === prep.src &&
      video.getAttribute('poster') === prep.poster &&
      !video.srcObject &&
      !video.mediaKeys &&
      !video.webkitKeys &&
      prep.children.length === video.children.length &&
      prep.children.every((node, index) => video.children[index] === node);
    const pairs = () => {
      const tracks = Array.from(video.textTracks || []);
      if (tracks.length > 2) {
        return null;
      }
      const result = prep.snapshots.map((snapshot) => ({
        snapshot,
        matches: tracks.filter(
          (track) =>
            track.kind === snapshot.kind &&
            track.label === snapshot.label &&
            track.language === snapshot.language
        ),
      }));
      return result.every((value) => value.matches.length === 1) ? result : null;
    };
    const intended = (snapshot) =>
      snapshot === session.recipe
        ? session.captionOn
          ? 'showing'
          : 'disabled'
        : snapshot.mode === 'showing'
          ? 'disabled'
          : snapshot.mode;
    const update = () => {
      if (closed) {
        return;
      }
      try {
        if (!identity() || observer.takeRecords().length) {
          owner.cleanup();
          return;
        }
        if (video.readyState < 2 || video.currentSrc !== session.candidate.originalUrl) {
          return;
        }
        // The restored HLS may become ready before X updates its selected
        // variant index; retain only the already-bound MP4 during this owner.
        if (!session.candidate.restoreCurrent(true)) {
          owner.cleanup();
          return;
        }
        const mapped = pairs();
        if (!mapped) {
          return;
        }
        writing = true;
        for (const value of mapped) {
          value.matches[0].mode = intended(value.snapshot);
        }
        writing = false;
        owner.cleanup();
      } catch {
        writing = false;
        owner.cleanup();
      }
    };
    try {
      observer = new view.MutationObserver(() => owner.cleanup());
      observer.observe(video, {
        attributes: true,
        attributeFilter: ['src', 'poster'],
        childList: true,
      });
      for (const child of prep.children) {
        if (child.localName === 'source') {
          observer.observe(child, { attributes: true, attributeFilter: ['src', 'type', 'media'] });
        }
      }
      for (const type of ['loadedmetadata', 'loadeddata', 'canplay']) {
        listen(video, type, update);
      }
      listen(video.textTracks, 'addtrack', update);
      listen(video.textTracks, 'change', () => {
        if (!writing) {
          owner.cleanup();
        }
      });
      for (const type of ['emptied', 'loadstart']) {
        listen(
          video,
          type,
          () => {
            if (priorEvents.delete(type)) {
              return;
            }
            if (sourceEvents.has(type)) {
              owner.cleanup();
            } else {
              sourceEvents.add(type);
            }
          },
          true
        );
      }
      for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
        listen(
          view,
          type,
          (event) => {
            if (event.isTrusted) {
              owner.cleanup();
            }
          },
          { capture: true, passive: true }
        );
      }
      listen(view, 'pagehide', () => owner.cleanup());
      timer = view.setTimeout(() => owner.cleanup(), 3000);
      update();
    } catch {
      owner.cleanup();
    }
  }

  class Preparation {
    constructor(controller, rate, source, context) {
      this.controller = controller;
      this.video = controller.video;
      this.doc = this.video.ownerDocument;
      this.view = this.doc.defaultView;
      this.root = this.doc.documentElement;
      this.url = this.doc.URL;
      this.candidate = candidateFor(controller);
      if (!this.candidate) {
        throw new Error('Caption source changed');
      }
      this.rate = rate;
      this.source = source;
      this.context = context;
      this.listeners = [];
      this.deferred = true;
      this.settled = new Promise((resolve) => {
        this.resolveSettled = resolve;
      });
      this.src = this.video.getAttribute('src');
      this.poster = this.video.getAttribute('poster');
      this.children = Array.from(this.video.children);
      this.muted = this.video.muted;
      this.volume = this.video.volume;
      this.entryRate = this.video.playbackRate;
      this.revision = controller.config.speedPreferenceRevision;
      this.preference = controller.config.settings.lastSpeed;
      this.sitePreference = controller.config.settings.siteDefaultSpeed;
      const local = mediaState(controller);
      this.priorLocal = local
        ? {
            lifecycleSpeed: local.lifecycleSpeed,
            lifecycleSpeedRevision: local.lifecycleSpeedRevision,
          }
        : null;
      this.tracks = Array.from(this.video.textTracks || []);
      this.snapshots = this.tracks.map((track) => ({
        track,
        kind: track.kind,
        label: track.label,
        language: track.language,
        mode: track.mode,
      }));
    }
    listen(target, type, callback, options) {
      target.addEventListener(type, callback, options);
      this.listeners.push(() => target.removeEventListener(type, callback, options));
    }
    current() {
      return safely(
        () =>
          !this.closed &&
          this.controller.twitterCaptionPending === this &&
          base(this.controller) &&
          this.video.ownerDocument === this.doc &&
          this.doc.documentElement === this.root &&
          this.doc.URL === this.url &&
          this.video.getAttribute('src') === this.src &&
          this.video.getAttribute('poster') === this.poster &&
          this.video.muted === this.muted &&
          this.video.volume === this.volume &&
          this.video.playbackRate === this.entryRate &&
          this.children.length === this.video.children.length &&
          this.children.every((child, index) => child === this.video.children[index]) &&
          !this.observer.takeRecords().length &&
          this.controller.config.speedPreferenceRevision === this.revision &&
          this.controller.config.settings.lastSpeed === this.preference &&
          this.controller.config.settings.siteDefaultSpeed === this.sitePreference &&
          this.candidate.isCurrent()
      );
    }
    start() {
      const cancel = () => this.cleanup();
      this.observer = new this.view.MutationObserver(cancel);
      this.observer.observe(this.video, {
        attributes: true,
        attributeFilter: ['src', 'poster'],
        childList: true,
      });
      for (const child of this.children) {
        if (child.localName === 'source') {
          this.observer.observe(child, {
            attributes: true,
            attributeFilter: ['src', 'type', 'media'],
          });
        }
      }
      for (const type of [
        'emptied',
        'loadstart',
        'pause',
        'seeking',
        'encrypted',
        'error',
        'volumechange',
      ]) {
        this.listen(this.video, type, cancel);
      }
      this.listen(this.doc, 'visibilitychange', () => {
        if (this.doc.visibilityState === 'hidden') {
          cancel();
        }
      });
      this.listen(this.view, 'pagehide', cancel);
      for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
        this.listen(
          this.view,
          type,
          (event) => {
            if (event.isTrusted) {
              if (ownedSpeedInput(this.controller, event)) {
                return;
              }
              this.intentChanged = true;
              cancel();
            }
          },
          { capture: true, passive: true }
        );
      }
      for (const track of this.tracks) {
        this.listen(track, 'cuechange', () => this.ready());
      }
      this.deadline = this.view.setTimeout(cancel, 10000);
      requests.set(this.controller, this);
      const joining = this.video.play();
      if (!joining || typeof joining.then !== 'function') {
        this.cleanup();
        return;
      }
      Promise.resolve(joining)
        .then(
          () => {
            if (!this.current()) {
              this.cleanup();
              return;
            }
            this.playSettled = true;
            this.ready();
          },
          () => this.cleanup()
        )
        .catch(() => this.cleanup());
      this.abortController = new this.view.AbortController();
      this.fetch = window.VSC.TwitterCaptionSource.create({
        hlsUrl: this.candidate.originalUrl,
        duration: this.candidate.duration,
        assetType: this.candidate.assetType,
        assetId: this.candidate.mediaId,
        isCurrent: () => this.current(),
        signal: this.abortController.signal,
      });
      this.fetch.promise
        .then((certificate) => {
          if (!this.current()) {
            cancel();
            return;
          }
          this.certificate = certificate;
          if (certificate.oracle.some((cue) => /<v(?:[ .>])/.test(cue.text))) {
            cancel();
            return;
          }
          this.blob = this.view.URL.createObjectURL(
            new this.view.Blob([certificate.vttBytes], { type: 'text/vtt' })
          );
          this.parser = this.doc.createElement('video');
          this.parser.muted = true;
          this.parser.preload = 'metadata';
          this.parser.playsInline = true;
          this.parserTrack = this.doc.createElement('track');
          this.parserTrack.kind = 'captions';
          this.parserTrack.label = certificate.rendition.name;
          this.parserTrack.srclang = certificate.rendition.language;
          this.parserTrack.src = this.blob;
          this.listen(this.parserTrack, 'load', () => this.ready());
          this.listen(this.parserTrack, 'error', cancel);
          this.listen(this.parser, 'error', cancel);
          this.parser.append(this.parserTrack);
          this.parserTrack.track.mode = 'hidden';
          this.parser.src = this.candidate.progressiveUrl;
          this.parser.load();
          this.ready();
        }, cancel)
        .catch(cancel);
    }
    mapping() {
      if (!this.current() || !fullTrack(this.parserTrack, this.certificate, this.view)) {
        return false;
      }
      const tracks = Array.from(this.video.textTracks || []);
      if (
        tracks.length !== 2 ||
        !this.tracks.every((track) => tracks.includes(track)) ||
        !this.snapshots.every(
          (value) =>
            value.track.kind === value.kind &&
            value.track.label === value.label &&
            value.track.language === value.language
        ) ||
        tracks.filter((track) => track.mode === 'showing').length > 1 ||
        !tracks.some(
          (track) =>
            track.label === this.certificate.rendition.name &&
            track.language === this.certificate.rendition.language
        )
      ) {
        return false;
      }
      const showing = tracks.find((track) => track.mode === 'showing');
      let style = null;
      for (const track of tracks) {
        if (
          !modes.has(track.mode) ||
          !track.cues ||
          track.cues.length < 2 ||
          track.cues.length > 256
        ) {
          return false;
        }
        for (const cue of Array.from(track.cues)) {
          // Native HLS cue times have an observed 3–18 ms encoding offset.
          // Match one original cue only; the complete private file stays strict.
          const oracle = this.certificate.oracle;
          let index = -1;
          for (let candidate = 0, length = oracle.length; candidate < length; candidate++) {
            if (sameCue(cue, oracle[candidate], 0.05)) {
              if (index !== -1) {
                return false;
              }
              index = candidate;
            }
          }
          if (index < 0) {
            return false;
          }
          const actual = cueScalars(cue, this.view);
          const expected = cueScalars(this.parserTrack.track.cues[index], this.view);
          if (
            !actual ||
            !expected ||
            actual.vertical ||
            CUE_FIELDS.some(
              (key) =>
                actual[key] !== expected[key] &&
                (track !== showing || !['line', 'snapToLines'].includes(key))
            )
          ) {
            return false;
          }
          if (track === showing) {
            const next = { line: actual.line, snapToLines: actual.snapToLines };
            if (
              !(
                next.line === 'auto' ||
                (Number.isFinite(next.line) && Math.abs(next.line) <= 10000)
              ) ||
              typeof next.snapToLines !== 'boolean' ||
              (!next.snapToLines &&
                (typeof next.line !== 'number' || next.line < 0 || next.line > 100)) ||
              (style && (style.line !== next.line || style.snapToLines !== next.snapToLines))
            ) {
              return false;
            }
            style = next;
          }
        }
      }
      this.style = style;
      this.recipe =
        this.snapshots.find((value) => value.track === showing) ||
        this.snapshots.find((value) => value.kind === 'captions');
      return true;
    }
    ready() {
      if (this.closed || this.readyToCommit || !this.certificate || !this.playSettled) {
        return;
      }
      try {
        if (!this.current()) {
          this.cleanup();
          return;
        }
        if (++this.readinessEvents > 32) {
          this.cleanup();
          return;
        }
        if (!this.mapping()) {
          return;
        }
        this.readyToCommit = true;
        this.command = this.view.setTimeout(() => {
          if (!this.current() || !authorized(this.controller, this.rate) || !this.mapping()) {
            this.cleanup();
            return;
          }
          this.commandAuthorized = true;
          try {
            this.controller.actionHandler.setSpeed(this.video, this.rate, 'init');
          } finally {
            this.commandAuthorized = false;
            if (!this.transferred) {
              this.cleanup();
            }
          }
        }, 0);
      } catch {
        this.cleanup();
      }
    }
    cleanup(transfer = false) {
      if (this.closed) {
        return;
      }
      this.closed = true;
      try {
        this.transferred = transfer;
        if (transfer) {
          requests.delete(this.controller);
        }
        safely(() => this.observer?.disconnect());
        safely(() => this.view.clearTimeout(this.deadline));
        safely(() => this.view.clearTimeout(this.command));
        for (const remove of this.listeners.splice(0)) {
          safely(remove);
        }
        safely(() => this.fetch?.cancel());
        safely(() => this.abortController?.abort());
        if (this.controller.twitterCaptionPending === this) {
          this.controller.twitterCaptionPending = null;
        }
        if (!transfer) {
          failed.set(this.video, this.candidate.originalUrl);
          if (requests.get(this.controller) === this) {
            requests.delete(this.controller);
          }
          this.releaseCertificate();
          const config = this.controller.config;
          if (
            !this.intentChanged &&
            this.source !== 'init' &&
            config.speedPreferenceRevision === this.revision &&
            config.settings.lastSpeed === this.rate &&
            authorized(this.controller, this.rate)
          ) {
            config.settings.lastSpeed = this.context.previousSpeed;
            const local = mediaState(this.controller);
            if (local && this.priorLocal) {
              Object.assign(local, this.priorLocal);
            }
          }
        }
      } finally {
        safely(() => this.resolveSettled?.({ transferred: transfer === true }));
        this.resolveSettled = null;
      }
    }
    releaseCertificate() {
      safely(() => {
        this.parserTrack?.remove();
        this.parser?.removeAttribute('src');
        this.parser?.load();
      });
      safely(() => {
        if (this.blob) {
          this.view.URL.revokeObjectURL(this.blob);
        }
      });
      this.blob = null;
    }
  }

  class CaptionSession {
    constructor(preparation) {
      this.preparation = preparation;
      this.controller = preparation.controller;
      this.video = preparation.video;
      this.doc = preparation.doc;
      this.view = preparation.view;
      this.candidate = preparation.candidate;
      this.certificate = preparation.certificate;
      this.listeners = [];
      this.events = new Set();
      this.pending = true;
      this.captioned = true;
      this.time = this.video.currentTime;
      this.rate = preparation.rate;
      this.originalRate = this.video.playbackRate;
      this.wasPlaying = !this.video.paused;
      const showing = preparation.snapshots.filter((value) => value.track.mode === 'showing');
      if (showing.length > 1) {
        throw new Error('Caption selection');
      }
      this.captionOn = showing.length === 1;
      this.recipe = showing[0] || preparation.recipe;
      this.expectedMode = this.captionOn ? 'showing' : 'disabled';
      this.repairs = 0;
    }
    listen(...args) {
      Preparation.prototype.listen.apply(this, args);
    }
    inspect(records) {
      const reject = (start = 0) => {
        const poster =
          records.length <= 32 &&
          records.every(
            (record, index) =>
              index < start ||
              (record.target === this.video &&
                record.type === 'attributes' &&
                record.attributeName === 'poster')
          );
        this.mutationFailure = this.mutationFailure === 'foreign' || !poster ? 'foreign' : 'poster';
        return false;
      };
      if (this.mutationFailure) {
        return reject();
      }
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (
          record.type === 'childList' &&
          record.target === this.video &&
          !this.addSeen &&
          record.addedNodes.length === 1 &&
          record.addedNodes[0] === this.track &&
          !record.removedNodes.length
        ) {
          this.addSeen = true;
          continue;
        }
        let next = this.video.getAttribute(record.attributeName);
        for (let later = index + 1; later < records.length; later++) {
          if (
            records[later].target === this.video &&
            records[later].attributeName === record.attributeName
          ) {
            next = records[later].oldValue;
            break;
          }
        }
        if (
          record.target !== this.video ||
          record.type !== 'attributes' ||
          record.attributeName !== 'src' ||
          this.srcSeen ||
          record.oldValue !== this.preparation.src ||
          next !== this.candidate.progressiveUrl
        ) {
          return reject(index);
        }
        this.srcSeen = true;
      }
      return true;
    }
    ownsSource(allowDisposed = false) {
      return safely(
        () =>
          !this.closed &&
          !this.handingBack &&
          this.controller.safariPlayback === this &&
          (!this.controller.disposed || allowDisposed) &&
          this.video.vsc === this.controller &&
          this.video.isConnected &&
          this.video.ownerDocument === this.doc &&
          this.doc.documentElement === this.preparation.root &&
          this.doc.URL === this.preparation.url &&
          this.video.getAttribute('poster') === this.preparation.poster &&
          !this.video.srcObject &&
          !this.video.mediaKeys &&
          !this.video.webkitKeys &&
          this.inspect(this.observer.takeRecords()) &&
          this.video.getAttribute('src') === this.candidate.progressiveUrl &&
          (!this.video.currentSrc ||
            this.video.currentSrc === this.candidate.progressiveUrl ||
            (this.pending && this.video.currentSrc === this.candidate.originalUrl)) &&
          this.preparation.children.every((child, index) => this.video.children[index] === child) &&
          this.video.children.length ===
            this.preparation.children.length + (this.track?.parentNode === this.video ? 1 : 0)
      );
    }
    ownsTransition() {
      return this.pending && this.ownsSource();
    }
    start() {
      const cancel = () => this.cleanup({ restore: false });
      this.observer = new this.view.MutationObserver((records) => {
        if (!this.inspect(records)) {
          cancel();
        }
      });
      this.observer.observe(this.video, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['src', 'poster'],
        childList: true,
      });
      for (const child of this.preparation.children) {
        if (child.localName === 'source') {
          this.observer.observe(child, {
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['src', 'type', 'media'],
          });
        }
      }
      for (const type of ['emptied', 'loadstart']) {
        this.listen(
          this.video,
          type,
          (event) => {
            const recovery = window.VSC.TwitterPlaybackRecovery;
            if (
              recovery?.isReloading(this.controller, this) &&
              recovery.acceptSourceEvent(this.controller, event, this)
            ) {
              if (type === 'loadstart') {
                this.repairs = 0;
                this.reloading = true;
                this.styleApplied = false;
              }
              return;
            }
            if (!this.pending || this.events.has(type) || !this.ownsSource()) {
              cancel();
            } else {
              this.events.add(type);
            }
          },
          true
        );
      }
      for (const type of ['loadedmetadata', 'loadeddata', 'canplay']) {
        this.listen(this.video, type, () => this.ready());
      }
      this.listen(this.video, 'encrypted', cancel);
      this.listen(this.video, 'error', () => this.abort());
      this.listen(this.doc, 'visibilitychange', () => {
        if (this.doc.visibilityState === 'hidden') {
          this.cleanup();
        }
      });
      this.listen(this.view, 'pagehide', () => this.cleanup());
      for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
        this.listen(
          this.view,
          type,
          (event) => {
            if (event.isTrusted) {
              this.intentChanged = true;
            }
          },
          { capture: true, passive: true }
        );
      }
      this.listen(this.video.textTracks, 'change', () => this.modeChanged());
      this.listen(this.video.textTracks, 'addtrack', () => {
        if (!this.knownTracks()) {
          cancel();
        } else {
          this.ready();
        }
      });
      this.track = this.doc.createElement('track');
      this.track.kind = 'captions';
      this.track.label = this.certificate.rendition.name;
      this.track.srclang = this.certificate.rendition.language;
      this.track.src = this.preparation.blob;
      this.listen(this.track, 'load', () => this.ready());
      this.listen(this.track, 'error', () => this.abort());
      this.deadline = this.view.setTimeout(() => this.abort(), 10000);
      this.ownMode = true;
      for (const track of this.preparation.tracks) {
        track.mode = 'disabled';
      }
      this.video.src = this.candidate.progressiveUrl;
      this.video.load();
      this.video.append(this.track);
      this.track.track.mode = this.expectedMode;
      this.ownMode = false;
      this.video.currentTime = this.time;
    }
    knownTracks() {
      return Array.from(this.video.textTracks || []).every(
        (track) => track === this.track?.track || this.preparation.tracks.includes(track)
      );
    }
    modeChanged() {
      if (this.closed || this.ownMode || this.handingBack) {
        return;
      }
      try {
        if (!this.knownTracks()) {
          this.cleanup({ restore: false });
          return;
        }
        const old = this.preparation.snapshots.filter(
          (value) =>
            Array.from(this.video.textTracks).includes(value.track) &&
            value.track.mode !== 'disabled' &&
            !(
              value.kind === 'subtitles' &&
              value.mode === 'hidden' &&
              value.track.mode === 'hidden'
            )
        );
        if (old.length) {
          this.captionOn = old.some((value) => value.track.mode === 'showing');
          this.recipe = old.find((value) => value.track.mode === 'showing') || this.recipe;
          this.intentChanged = true;
          this.cleanup();
          return;
        }
        const mode = this.track.track.mode;
        if (mode === this.expectedMode) {
          return;
        }
        if (
          (this.pending || this.reloading) &&
          !this.intentChanged &&
          this.captionOn &&
          mode === 'hidden' &&
          this.repairs === 0
        ) {
          this.ready();
          return;
        }
        if (mode === 'showing' || mode === 'disabled') {
          this.captionOn = mode === 'showing';
          this.expectedMode = mode;
          return;
        }
        this.intentChanged = true;
        this.cleanup();
      } catch {
        this.cleanup({ restore: false });
      }
    }
    ready() {
      if (this.handingBack) {
        return;
      }
      try {
        if (!this.ownsSource() || !this.knownTracks()) {
          this.cleanup({ restore: false });
          return;
        }
        if (this.track.readyState === 3) {
          this.abort();
          return;
        }
        if (this.track.readyState !== 2) {
          return;
        }
        if (
          !fullTrack(this.track, this.certificate, this.view, this.preparation.style) &&
          !fullTrack(this.track, this.certificate, this.view)
        ) {
          this.abort();
          return;
        }
        if (this.preparation.style) {
          for (const cue of Array.from(this.track.track.cues)) {
            Object.assign(cue, this.preparation.style);
          }
          this.styleApplied = true;
        }
        if (!fullTrack(this.track, this.certificate, this.view, this.preparation.style)) {
          this.abort();
          return;
        }
        if (
          this.captionOn &&
          this.track.track.mode === 'hidden' &&
          !this.intentChanged &&
          this.repairs === 0 &&
          this.video.currentSrc === this.candidate.progressiveUrl
        ) {
          this.ownMode = true;
          this.track.track.mode = 'showing';
          this.ownMode = false;
          this.repairs++;
        }
        if (this.video.readyState >= 2 && this.video.currentSrc === this.candidate.progressiveUrl) {
          if (!this.candidate.revalidate()) {
            this.cleanup({ restore: false });
            return;
          }
          this.pending = false;
          this.reloading = false;
          this.view.clearTimeout(this.deadline);
        }
      } catch {
        this.abort();
      }
    }
    finish() {
      if (!this.ownsSource() || this.doc.visibilityState === 'hidden') {
        this.cleanup({ restore: false });
        return false;
      }
      if (this.finished) {
        return true;
      }
      this.finished = true;
      try {
        if (this.wasPlaying && !this.intentChanged) {
          const current = () =>
            this.ownsSource() &&
            this.candidate.revalidate(this.pending, false, this.pending) &&
            this.ownsSource();
          const play = this.video.play;
          if (typeof play !== 'function' || !current()) {
            this.cleanup({ restore: false });
            return false;
          }
          const playing = Reflect.apply(play, this.video, []);
          Promise.resolve(playing)
            .then(
              () => {
                if (!this.ownsSource()) {
                  return;
                }
                const prep = this.preparation,
                  config = this.controller.config;
                if (
                  prep.source !== 'init' &&
                  config.settings.rememberSpeed &&
                  config.settings.lastSpeed === this.rate &&
                  config.speedPreferenceRevision === prep.revision
                ) {
                  config.save({ lastSpeed: this.rate });
                }
              },
              (error) => {
                if (this.closed || !this.ownsSource()) {
                  return;
                }
                this.lastPlayError = [
                  'NotAllowedError',
                  'AbortError',
                  'NotSupportedError',
                  'SecurityError',
                ].includes(error?.name)
                  ? error.name
                  : 'other';
                if (this.lastPlayError === 'AbortError' && this.video.paused) {
                  this.intentChanged = true;
                }
                safely(() => this.abort());
              }
            )
            ?.catch?.(() => safely(() => this.abort()));
          if (!current()) {
            this.cleanup({ restore: false });
            return false;
          }
        }
        return true;
      } catch {
        this.abort();
        return false;
      }
    }
    recoveryCurrent(controller) {
      return safely(() => {
        const reloading = window.VSC.TwitterPlaybackRecovery?.isReloading(controller, this);
        return (
          controller === this.controller &&
          !this.pending &&
          this.ownsSource() &&
          this.knownTracks() &&
          this.candidate.revalidate(reloading) &&
          fullTrack(this.preparation.parserTrack, this.certificate, this.view) &&
          (reloading || fullTrack(this.track, this.certificate, this.view, this.preparation.style))
        );
      });
    }
    recoveryFailed() {
      this.abort();
    }
    abort() {
      if (this.closed || !this.ownsSource()) {
        this.cleanup({ restore: false });
        return;
      }
      failed.set(this.video, this.candidate.originalUrl);
      if (this.cleanup({ aborted: true })) {
        safely(() =>
          this.controller.controlsManager?.inlinePlayer?.error('Playback could not restart.')
        );
      }
    }
    handback(time, rate, resume) {
      const removals = [];
      try {
        const video = this.video,
          prep = this.preparation,
          events = new Set();
        const revision = this.controller.config.speedPreferenceRevision;
        const preference = this.controller.config.settings.lastSpeed;
        const sitePreference = this.controller.config.settings.siteDefaultSpeed;
        const disposed = this.controller.disposed,
          intent = this.intentChanged;
        const muted = video.muted,
          volume = video.volume;
        const defaultRate = safely(() => video.defaultPlaybackRate, 1);
        let phase = 'mp4',
          stage = '',
          cancelled = false,
          ownSourceSeen = false;
        let expected = {
          times: [video.currentTime],
          rates: [video.playbackRate],
          pauses: [video.paused],
          seeks: [video.seeking],
        };
        const listen = (target, type, callback) => {
          target.addEventListener(type, callback, true);
          removals.push(() => target.removeEventListener(type, callback, true));
        };
        const mutations = () => {
          const records = this.observer.takeRecords();
          for (let index = 0; index < records.length; index++) {
            const record = records[index];
            let next = video.getAttribute(record.attributeName);
            for (let later = index + 1; later < records.length; later++) {
              if (
                records[later].target === video &&
                records[later].attributeName === record.attributeName
              ) {
                next = records[later].oldValue;
                break;
              }
            }
            if (
              phase !== 'hls' ||
              ownSourceSeen ||
              record.target !== video ||
              record.type !== 'attributes' ||
              record.attributeName !== 'src' ||
              record.oldValue !== this.candidate.progressiveUrl ||
              next !== prep.src
            ) {
              return false;
            }
            ownSourceSeen = true;
          }
          return true;
        };
        const direct = () =>
          !cancelled &&
          this.controller.video === video &&
          video.vsc === this.controller &&
          this.controller.safariPlayback === this &&
          this.controller.disposed === disposed &&
          video.isConnected &&
          video.ownerDocument === this.doc &&
          this.doc.documentElement === prep.root &&
          this.doc.URL === prep.url &&
          video.getAttribute('poster') === prep.poster &&
          !video.srcObject &&
          !video.mediaKeys &&
          !video.webkitKeys &&
          video.muted === muted &&
          video.volume === volume &&
          this.intentChanged === intent &&
          this.controller.config.speedPreferenceRevision === revision &&
          this.controller.config.settings.lastSpeed === preference &&
          this.controller.config.settings.siteDefaultSpeed === sitePreference &&
          video.getAttribute('src') ===
            (phase === 'mp4' ? this.candidate.progressiveUrl : prep.src) &&
          (!video.currentSrc ||
            video.currentSrc === this.candidate.progressiveUrl ||
            ((phase === 'hls' || this.pending) &&
              video.currentSrc === this.candidate.originalUrl)) &&
          prep.children.every((child, index) => video.children[index] === child) &&
          video.children.length === prep.children.length + 1 &&
          this.track.parentNode === video &&
          expected.times.some((value) => Math.abs(video.currentTime - value) < 0.01) &&
          expected.rates.some((value) => video.playbackRate === value) &&
          expected.pauses.includes(video.paused) &&
          expected.seeks.includes(video.seeking);
        const valid = () =>
          safely(
            () =>
              direct() &&
              mutations() &&
              (phase === 'mp4'
                ? this.candidate.revalidate(this.pending, true, this.pending)
                : this.candidate.restoreCurrent(true)) &&
              direct() &&
              mutations()
          );
        const reset = () => ({
          times: [video.currentTime, 0],
          rates: [video.playbackRate, defaultRate],
          pauses: [true],
          seeks: [video.seeking, false],
        });
        const method = (name) => {
          if (!valid()) {
            return null;
          }
          const value = video[name];
          return typeof value === 'function' && valid() ? value : null;
        };
        for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
          listen(this.view, type, (event) => {
            if (event.isTrusted) {
              cancelled = true;
            }
          });
        }
        listen(video, 'volumechange', () => {
          cancelled = true;
        });
        for (const type of ['pause', 'seeking', 'seeked', 'emptied', 'loadstart']) {
          listen(video, type, () => {
            if (
              (type === 'pause' && stage === 'pause') ||
              ((type === 'seeking' || type === 'seeked') && stage === 'time') ||
              ((type === 'emptied' || type === 'loadstart') &&
                (stage === 'src' || stage === 'load') &&
                !events.has(type))
            ) {
              events.add(type);
              return;
            }
            cancelled = true;
          });
        }
        const pause = method('pause');
        if (!pause) {
          return false;
        }
        expected.pauses = [true];
        stage = 'pause';
        Reflect.apply(pause, video, []);
        stage = '';
        if (!valid()) {
          return false;
        }
        const source = method(prep.src === null ? 'removeAttribute' : 'setAttribute');
        if (!source) {
          return false;
        }
        expected = reset();
        phase = 'hls';
        stage = 'src';
        Reflect.apply(source, video, prep.src === null ? ['src'] : ['src', prep.src]);
        stage = '';
        if (!valid()) {
          return false;
        }
        const load = method('load');
        if (!load) {
          return false;
        }
        expected = reset();
        stage = 'load';
        Reflect.apply(load, video, []);
        stage = '';
        if (!valid()) {
          return false;
        }
        expected = {
          times: [time],
          rates: [video.playbackRate],
          pauses: [true],
          seeks: [true, false],
        };
        stage = 'time';
        video.currentTime = time;
        stage = '';
        if (!valid()) {
          return false;
        }
        expected = {
          times: [video.currentTime],
          rates: [rate],
          pauses: [true],
          seeks: [video.seeking],
        };
        stage = 'rate';
        video.playbackRate = rate;
        stage = '';
        if (!valid()) {
          return false;
        }
        if (resume) {
          const play = method('play');
          if (!play) {
            return false;
          }
          expected.pauses = [true, false];
          stage = 'play';
          const playing = Reflect.apply(play, video, []);
          Promise.resolve(playing).catch(() => {});
          stage = '';
          if (!valid()) {
            return false;
          }
        }
        return valid();
      } catch {
        return false;
      } finally {
        for (const remove of removals) {
          safely(remove);
        }
      }
    }
    cleanup({ restore = true, aborted = false } = {}) {
      if (this.closed || this.cleanupInProgress) {
        return;
      }
      this.cleanupInProgress = true;
      try {
        safely(() => this.inspect(this.observer.takeRecords()));
        if (
          this.mutationFailure === 'poster' &&
          !this.pending &&
          this.video.currentSrc === this.candidate.progressiveUrl &&
          this.video.getAttribute('src') === this.candidate.progressiveUrl
        ) {
          const oldPoster = this.preparation.poster;
          this.preparation.poster = this.video.getAttribute('poster');
          this.mutationFailure = null;
          if (
            this.ownsSource(true) &&
            this.candidate.revalidate(false, true) &&
            this.ownsSource(true)
          ) {
            restore = true;
          } else {
            this.preparation.poster = oldPoster;
            this.mutationFailure = 'foreign';
          }
        }
        const owned =
          restore &&
          this.ownsSource(true) &&
          this.candidate.revalidate(this.pending, true, this.pending);
        const time = owned ? safely(() => this.video.currentTime, this.time) : this.time;
        const rate =
          owned && !aborted
            ? safely(() => this.video.playbackRate, this.originalRate)
            : this.originalRate;
        const resume =
          owned &&
          safely(
            () =>
              (aborted ? this.wasPlaying : !this.video.paused) &&
              !this.video.ended &&
              (!aborted || !this.intentChanged) &&
              this.doc.visibilityState !== 'hidden'
          );
        this.handingBack = true;
        safely(() => window.VSC.TwitterPlaybackRecovery?.cancel(this.controller, this));
        const restored = owned && this.handback(time, rate, resume);
        this.releaseResources();
        if (restored) {
          safely(() => {
            restoreCaptionModes(this);
            if (aborted) {
              const config = this.controller.config;
              if (
                config.speedPreferenceRevision === this.preparation.revision &&
                config.settings.lastSpeed === this.rate
              ) {
                config.settings.lastSpeed = this.preparation.context.previousSpeed;
              }
              const local = mediaState(this.controller);
              if (local) {
                local.lifecycleSpeed = rate;
                local.acceptedSpeed = rate;
              }
              window.VSC.ShadowDOMManager?.updateSpeedDisplay(
                this.controller.div?.shadowRoot,
                rate
              );
            }
          });
        }
        return restored;
      } catch {
        return false;
      } finally {
        this.releaseResources();
        if (!this.certificateReleased) {
          this.certificateReleased = true;
          safely(() => this.preparation.releaseCertificate());
        }
        this.cleanupInProgress = false;
      }
    }
    releaseResources() {
      if (this.resourcesReleased) {
        return;
      }
      this.resourcesReleased = true;
      this.closed = true;
      safely(() => window.VSC.TwitterPlaybackRecovery?.cancel(this.controller, this));
      safely(() => this.observer.disconnect());
      safely(() => this.view.clearTimeout(this.deadline));
      for (const remove of this.listeners.splice(0)) {
        safely(remove);
      }
      safely(() => {
        if (this.controller.safariPlayback === this) {
          this.controller.safariPlayback = null;
        }
      });
      safely(() => this.track.remove());
    }
  }

  window.VSC.TwitterCaptionPlayback = {
    requestedSpeed(controller) {
      return safely(() => {
        const request = requests.get(controller);
        if (
          !request ||
          controller.disposed ||
          controller.video !== request.video ||
          request.video.vsc !== controller ||
          request.video.ownerDocument !== request.doc ||
          request.doc.documentElement !== request.root ||
          request.doc.URL !== request.url ||
          request.video.getAttribute('poster') !== request.poster ||
          request.video.getAttribute('src') !== request.src ||
          (request.video.currentSrc || request.video.src) !== request.candidate.originalUrl ||
          controller.config.speedPreferenceRevision !== request.revision ||
          controller.config.settings.lastSpeed !== request.preference ||
          !authorized(controller, request.rate)
        ) {
          requests.delete(controller);
          return undefined;
        }
        return request.rate;
      }, undefined);
    },
    canBegin(controller, rate, source = 'init') {
      return safely(
        () =>
          source !== 'external' &&
          Number.isFinite(rate) &&
          rate > 2 &&
          base(controller) &&
          !controller.twitterCaptionPending &&
          !controller.safariPlayback &&
          failed.get(controller.video) !== (controller.video.currentSrc || controller.video.src) &&
          (source !== 'init' || authorized(controller, rate)) &&
          Boolean(candidateFor(controller))
      );
    },
    begin(controller, rate, source = 'internal', context = {}) {
      controller?.twitterCaptionRestore?.cleanup();
      let pending = controller?.twitterCaptionPending;
      if (source !== 'init') {
        if (pending && source === 'external') {
          pending.intentChanged = true;
        }
        pending?.cleanup();
        pending = null;
        if (source !== 'external' && controller?.video) {
          failed.delete(controller.video);
        }
      }
      if (pending) {
        if (!pending.commandAuthorized) {
          return pending;
        }
        if (
          !pending.current() ||
          !authorized(controller, rate) ||
          rate !== pending.rate ||
          !pending.mapping()
        ) {
          pending.cleanup();
          return null;
        }
        let session;
        try {
          session = new CaptionSession(pending);
          pending.cleanup(true);
          controller.safariPlayback = session;
          session.start();
          return session;
        } catch {
          session?.abort();
          pending.cleanup();
          return null;
        }
      }
      if (controller?.safariPlayback?.captioned && controller.safariPlayback.ownsSource()) {
        return controller.safariPlayback;
      }
      if (!this.canBegin(controller, rate, source)) {
        return null;
      }
      try {
        pending = new Preparation(controller, rate, source, context);
        pending.readinessEvents = 0;
        controller.twitterCaptionPending = pending;
        pending.start();
        return pending;
      } catch {
        pending?.cleanup();
        return null;
      }
    },
  };
})();

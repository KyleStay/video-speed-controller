/** Reload only an exact MP4 already owned by a current X playback adapter. */
window.VSC = window.VSC || {};

(function () {
  const loads = new WeakMap();
  const sessions = new WeakMap();

  function owner(controller) {
    const video = controller?.video;
    if (!video || controller.disposed || video.vsc !== controller) {
      return null;
    }
    const session = controller.safariPlayback || window.VSC.TwitterMP4Playback?.get(video);
    return session?.recoveryCurrent?.(controller) ? session : null;
  }

  function release(token) {
    if (!token || token.closed) {
      return;
    }
    token.closed = true;
    try {
      token.view.clearTimeout(token.timer);
    } catch {
      /* Continue release through the original scheduling context. */
    }
    try {
      token.observer?.disconnect();
    } catch {
      /* A replaced observer must not retain the token. */
    }
    for (const remove of token.listeners) {
      try {
        remove();
      } catch {
        /* Release independent subscriptions after a page API changes. */
      }
    }
    if (loads.get(token.controller) === token) {
      loads.delete(token.controller);
    }
    if (sessions.get(token.session) === token) {
      sessions.delete(token.session);
    }
  }

  function current(token) {
    try {
      const unchanged = () =>
        !token.closed &&
        loads.get(token.controller) === token &&
        !token.observer?.takeRecords().length &&
        token.video.ownerDocument === token.doc &&
        token.doc.documentElement === token.root &&
        token.doc.URL === token.url &&
        token.doc.visibilityState !== 'hidden' &&
        token.video.getAttribute('src') === token.src &&
        token.video.getAttribute('poster') === token.poster &&
        !token.video.srcObject &&
        token.video.muted === token.muted &&
        token.video.volume === token.volume &&
        token.controller.config?.speedPreferenceRevision === token.revision &&
        token.controller.config?.settings?.lastSpeed === token.preference &&
        token.controller.iosPlayer === token.player &&
        token.player?.session === token.presentation &&
        token.player?.ui === token.ui;
      const paused = token.video.paused,
        rate = token.video.playbackRate,
        seeking = token.video.seeking,
        time = token.video.currentTime;
      if (
        !unchanged() ||
        owner(token.controller) !== token.session ||
        !unchanged() ||
        token.video.paused !== paused ||
        token.video.playbackRate !== rate ||
        token.video.seeking !== seeking ||
        Math.abs(token.video.currentTime - time) > 0.25
      ) {
        release(token);
        return false;
      }
      return true;
    } catch {
      release(token);
      return false;
    }
  }

  const STALL_MESSAGE = 'Playback is still stalled. Try the site player.';

  function updateWarning(controller, report) {
    // Resolve independently: one inaccessible surface cannot block either the
    // other owned message or the caller's playback teardown.
    for (const surface of [
      () => controller?.controlsManager?.inlinePlayer?.refs?.status,
      () => controller?.iosPlayer?.ui?.refs?.status,
    ]) {
      let node, text;
      try {
        node = surface();
      } catch {
        continue;
      }
      if (!node) {
        continue;
      }
      try {
        text = node.textContent;
      } catch {
        continue;
      }
      if (report ? !text || text === STALL_MESSAGE : text === STALL_MESSAGE) {
        try {
          node.textContent = report ? STALL_MESSAGE : '';
        } catch {
          /* A discarded warning surface must not interrupt playback cleanup. */
        }
      }
    }
  }

  window.VSC.TwitterPlaybackRecovery = {
    reportStall(controller) {
      if (this.identity(controller)) {
        updateWarning(controller, true);
      }
    },
    clearStall(controller) {
      updateWarning(controller, false);
    },
    identity(controller) {
      try {
        const token = loads.get(controller);
        return token ? (current(token) ? token.session : null) : owner(controller);
      } catch {
        return null;
      }
    },
    cancel(controller, session) {
      const token = loads.get(controller) || (session && sessions.get(session));
      if (!session || token?.session === session) {
        release(token);
      }
      if (controller) {
        try {
          this.clearStall(controller);
        } catch {
          /* An unavailable status surface must not retain playback work. */
        }
      }
    },
    isReloading(controller, session) {
      const token = loads.get(controller);
      return Boolean(token && !token.closed && token.session === session);
    },
    // Adapter capture listeners validate each event before ordinary source-reset
    // listeners can preserve presentation/rate authority for this one load.
    acceptSourceEvent(controller, event, session) {
      const token = loads.get(controller);
      if (!token || token.session !== session) {
        return false;
      }
      if (
        !['emptied', 'loadstart'].includes(event.type) ||
        token.events.has(event.type) ||
        !current(token)
      ) {
        release(token);
        return false;
      }
      token.events.add(event.type);
      return true;
    },
    ownsTransition(controller, eventType) {
      const token = loads.get(controller);
      return Boolean(token && current(token) && (!eventType || token.events.has(eventType)));
    },
    reload(controller) {
      let token;
      try {
        const session = this.identity(controller);
        const video = controller?.video;
        if (!session || loads.has(controller)) {
          return false;
        }
        const doc = video.ownerDocument;
        const rect = video.getBoundingClientRect();
        const source = new URL(video.src);
        if (
          !['http:', 'https:'].includes(source.protocol) ||
          !/\.mp4$/i.test(source.pathname) ||
          video.currentSrc !== video.src ||
          video.readyState < 2 ||
          video.paused ||
          video.ended ||
          video.seeking ||
          !Number.isFinite(video.currentTime) ||
          !Number.isFinite(video.duration) ||
          video.duration <= 0 ||
          !Number.isFinite(video.playbackRate) ||
          video.playbackRate < 2.1 ||
          doc.visibilityState === 'hidden' ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.bottom <= 0 ||
          rect.right <= 0 ||
          rect.top >= doc.defaultView.innerHeight ||
          rect.left >= doc.defaultView.innerWidth
        ) {
          return false;
        }
        const player = controller.iosPlayer;
        token = {
          controller,
          session,
          video,
          doc,
          view: doc.defaultView,
          root: doc.documentElement,
          url: doc.URL,
          src: video.getAttribute('src'),
          poster: video.getAttribute('poster'),
          time: video.currentTime,
          rate: video.playbackRate,
          muted: video.muted,
          volume: video.volume,
          revision: controller.config?.speedPreferenceRevision,
          preference: controller.config?.settings?.lastSpeed,
          player,
          presentation: player?.session,
          ui: player?.ui,
          events: new Set(),
          listeners: [],
          closed: false,
          inCommand: true,
          expectedSeek: true,
          ready: false,
          playAccepted: false,
        };
        loads.set(controller, token);
        sessions.set(session, token);
        const listen = (target, type, fn, options) => {
          target.addEventListener(type, fn, options);
          token.listeners.push(() => target.removeEventListener(type, fn, options));
        };
        const cancel = () => release(token);
        const fail = () => {
          if (!current(token)) {
            return;
          }
          release(token);
          session.recoveryFailed?.(controller);
          const shadow = video.vsc?.div?.shadowRoot;
          if (shadow && Number.isFinite(video.playbackRate)) {
            window.VSC.ShadowDOMManager?.updateSpeedDisplay(shadow, video.playbackRate);
          }
        };
        const complete = () => {
          if (token.ready && token.playAccepted && current(token)) {
            release(token);
          }
        };
        token.observer = new token.view.MutationObserver(cancel);
        token.observer.observe(video, {
          attributes: true,
          attributeFilter: ['src', 'poster'],
          childList: true,
        });
        listen(video, 'loadeddata', () => {
          if (!token.events.has('loadstart') || !current(token)) {
            cancel();
            return;
          }
          token.ready = true;
          complete();
        });
        listen(video, 'pause', () => {
          if (!token.inLoad && video.paused) {
            cancel();
          }
        });
        listen(video, 'seeking', () => {
          if (token.expectedSeek && Math.abs(video.currentTime - token.time) < 0.25) {
            token.expectedSeek = false;
          } else {
            cancel();
          }
        });
        listen(video, 'ratechange', () => {
          if (video.playbackRate !== token.rate) {
            cancel();
          }
        });
        listen(video, 'error', fail);
        listen(video, 'encrypted', cancel);
        listen(doc, 'visibilitychange', () => {
          if (doc.visibilityState === 'hidden') {
            cancel();
          }
        });
        listen(token.view, 'pagehide', cancel);
        for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
          listen(
            token.view,
            type,
            (event) => {
              if (event.isTrusted) {
                cancel();
              }
            },
            { capture: true, passive: true }
          );
        }
        token.timer = token.view.setTimeout(fail, 10000);
        // Same supplied MP4, same node; never touch a retained blob producer.
        token.inLoad = true;
        video.load();
        token.inLoad = false;
        if (!current(token)) {
          return false;
        }
        video.currentTime = token.time;
        video.playbackRate = token.rate;
        if (video.playbackRate !== token.rate || !current(token)) {
          fail();
          return false;
        }
        const playing = video.play();
        token.inCommand = false;
        if (playing?.then) {
          playing.then(() => {
            token.playAccepted = true;
            complete();
          }, fail);
        } else {
          token.playAccepted = true;
          complete();
        }
        return !token.closed || (token.ready && token.playAccepted);
      } catch {
        if (token) {
          const owned = current(token);
          release(token);
          if (owned) {
            token.session.recoveryFailed?.(token.controller);
          }
        }
        return false;
      }
    },
  };
})();

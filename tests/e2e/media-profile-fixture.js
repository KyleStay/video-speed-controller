export const MEDIA_PROFILE_CASES = Object.freeze([
  { id: 'watch-navigation', contract: 'Watch and short layouts with delayed playlist replacement' },
  {
    id: 'carousel-viewer',
    contract: 'Mixed carousel selection, pause intent and viewer restoration',
  },
  { id: 'command-feed', contract: 'Frame commands, rapid clip recycling and mute persistence' },
  {
    id: 'floating-feed',
    contract: 'Inline, expanded and floating playback with visibility pauses',
  },
  { id: 'live-window', contract: 'Moving live seek windows and recorded-source handoff' },
  {
    id: 'coordinated-embeds',
    contract: 'Independent captioned frames with optional coordinated pausing',
  },
  { id: 'attachment-thread', contract: 'Mixed attachments, source renewal and message removal' },
  {
    id: 'staged-player',
    contract: 'Visibility-gated startup, staged content and presentation changes',
  },
]);

/** Additional profiles share native media and cleanup with the fixture host. */
export function installMediaProfile({
  document,
  profile,
  main,
  params,
  button,
  video,
  player,
  replaceSource,
  source,
  removeMedia,
  listen,
  qualities,
  embeddedPlayer,
  initialAsset = 1,
  show,
  onDispose,
}) {
  const view = document.defaultView;
  if (profile !== 'command-player' && !MEDIA_PROFILE_CASES.some(({ id }) => id === profile)) {
    return false;
  }
  let disposed = false;
  let pending = null;
  const abort = new view.AbortController();
  onDispose(() => {
    disposed = true;
    view.clearTimeout(pending);
    abort.abort();
  });
  const state = { asset: initialAsset, mode: 'inline', phase: 'ready', messages: 0 };
  view.__mediaProfileState = () => ({ ...state, disposed });
  const play = (clip) =>
    clip?.play().catch((error) => {
      if (!disposed) {
        show(error.name);
      }
    });
  const transport = (current) =>
    button('play', 'Play or pause', () => {
      const clip = current();
      if (!clip) {
        return;
      }
      if (clip.paused) {
        play(clip);
      } else {
        clip.pause();
      }
    });
  const defer = (run) => {
    view.clearTimeout(pending);
    pending = view.setTimeout(() => {
      pending = null;
      if (!disposed) {
        run();
      }
    }, 200);
  };
  const move = (stage, destination) => {
    const clip = stage.querySelector('video');
    const resume = clip && !clip.paused;
    destination.append(stage);
    if (resume) {
      play(clip);
    }
  };
  const send = (frame, command, extra = {}) =>
    frame?.contentWindow?.postMessage(
      { type: 'local-media-command', command, ...extra },
      new view.URL(frame.src).origin
    );

  if (profile === 'watch-navigation') {
    const stage = player();
    let clip = video(stage);
    transport(() => clip);
    button('short-layout', 'Toggle short layout', () => {
      state.mode = state.mode === 'short' ? 'watch' : 'short';
      stage.classList.toggle('short-layout', state.mode === 'short');
    });
    button('next-entry', 'Next entry', () => {
      state.asset++;
      state.phase = 'loading';
      defer(() => {
        removeMedia(clip);
        clip = video(stage, 'mock-video', source(state.asset));
        state.phase = 'ready';
        const url = new view.URL(view.location.href);
        url.searchParams.set('entry', String(state.asset));
        view.history.pushState({}, '', url);
      });
    });
    return true;
  }
  if (profile === 'carousel-viewer') {
    const slot = document.createElement('div');
    main.append(slot);
    const stage = player(slot);
    const viewer = document.createElement('section');
    viewer.className = 'profile-viewer';
    // Keep the viewer's own Close control above narrow-layout page actions.
    viewer.style.zIndex = '60';
    viewer.hidden = true;
    main.append(viewer);
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const card = document.createElement('div');
      card.id = `card-${i}`;
      stage.append(card);
      cards.push(card);
      if (i === 0 || i === 3) {
        video(card, `carousel-video-${i}`, source(i + 1, 'base', i === 0 ? 'mp4' : 'webm'));
      } else {
        const image = document.createElement('img');
        image.width = 320;
        image.height = 180;
        image.alt = 'Synthetic picture';
        image.src = i === 1 ? '/mock-still.gif' : '/mock-animated.gif';
        card.append(image);
      }
    }
    state.active = 0;
    state.muted = true;
    const select = (index) => {
      stage.querySelectorAll('video').forEach((clip) => clip.pause());
      state.active = (index + cards.length) % cards.length;
      cards.forEach((card, i) => {
        card.hidden = i !== state.active;
      });
      const clip = cards[state.active].querySelector('video');
      if (clip) {
        clip.muted = state.muted;
      }
    };
    select(0);
    transport(() => cards[state.active].querySelector('video'));
    button('carousel-next', 'Next item', () => select(state.active + 1));
    button('carousel-previous', 'Previous item', () => select(state.active - 1));
    button('mute-active', 'Mute or unmute', () => {
      state.muted = !state.muted;
      const clip = cards[state.active].querySelector('video');
      if (clip) {
        clip.muted = state.muted;
      }
    });
    button('viewer-open', 'Open viewer', () => {
      viewer.hidden = false;
      move(stage, viewer);
    });
    button(
      'viewer-close',
      'Close viewer',
      () => {
        move(stage, slot);
        viewer.hidden = true;
      },
      viewer
    );
    return true;
  }
  if (profile === 'command-player') {
    document.body.classList.add('frame-player');
    const clip = video(player(), 'mock-video', source(state.asset));
    qualities(clip);
    const port = params.get('parentPort') || '';
    const origin =
      /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
        ? `http://127.0.0.1:${port}`
        : null;
    const reply = (command) => {
      if (!disposed && origin && view.parent !== view) {
        view.parent.postMessage(
          {
            type: 'local-media-status',
            command,
            asset: state.asset,
            paused: clip.paused,
            muted: clip.muted,
          },
          origin
        );
      }
    };
    listen(clip, 'play', () => reply('playing'));
    listen(clip, 'pause', () => reply('paused'));
    listen(view, 'message', (event) => {
      const data = event.data;
      if (
        !origin ||
        event.origin !== origin ||
        event.source !== view.parent ||
        !data ||
        data.type !== 'local-media-command'
      ) {
        return;
      }
      if (!['play', 'pause', 'mute', 'next'].includes(data.command)) {
        return;
      }
      if (
        data.command === 'next' &&
        (!Number.isSafeInteger(data.asset) || data.asset < 1 || data.asset > 1000000)
      ) {
        return;
      }
      state.messages++;
      if (data.command === 'play') {
        clip
          .play()
          .then(() => reply('play'))
          .catch((error) => {
            if (!disposed) {
              show(error.name);
            }
          });
      } else {
        if (data.command === 'pause') {
          clip.pause();
        }
        if (data.command === 'mute') {
          clip.muted = !clip.muted;
        }
        if (data.command === 'next') {
          state.asset = data.asset;
          replaceSource(clip, source(state.asset));
        }
        reply(data.command);
      }
    });
    return true;
  }
  if (profile === 'command-feed' || profile === 'coordinated-embeds') {
    const stage = player();
    const frames = [];
    const count = profile === 'command-feed' ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const frame = embeddedPlayer(stage, 'command-player', i + 1);
      if (frame) {
        frame.id = `command-frame-${i}`;
        frames.push(frame);
      }
    }
    state.concurrent = false;
    listen(view, 'message', (event) => {
      const frame = frames.find(
        (item) =>
          item.contentWindow === event.source && new view.URL(item.src).origin === event.origin
      );
      if (!frame || event.data?.type !== 'local-media-status') {
        return;
      }
      state.messages++;
      if (count > 1 && !state.concurrent && event.data.command === 'playing') {
        frames.filter((item) => item !== frame).forEach((item) => send(item, 'pause'));
      }
    });
    button('play-first', 'Play first clip', () => send(frames[0], 'play'));
    button('pause-first', 'Pause first clip', () => send(frames[0], 'pause'));
    if (count === 1) {
      button('mute-first', 'Mute or unmute', () => send(frames[0], 'mute'));
      button('next-entry', 'Next entry', () => {
        state.asset++;
        send(frames[0], 'next', { asset: state.asset });
      });
    } else {
      button('play-second', 'Play second clip', () => send(frames[1], 'play'));
      button('allow-concurrent', 'Toggle concurrent playback', () => {
        state.concurrent = !state.concurrent;
      });
    }
    return true;
  }
  if (profile === 'floating-feed') {
    const slot = document.createElement('div');
    main.append(slot);
    const stage = player(slot);
    const clip = video(stage);
    const expanded = document.createElement('section');
    expanded.className = 'profile-viewer';
    expanded.hidden = true;
    main.append(expanded);
    const floating = document.createElement('div');
    floating.className = 'profile-floating';
    main.append(floating);
    transport(() => clip);
    button('expand-player', 'Expand player', () => {
      expanded.hidden = false;
      move(stage, expanded);
      state.mode = 'expanded';
    });
    button('float-player', 'Float player', () => {
      move(stage, floating);
      expanded.hidden = true;
      state.mode = 'floating';
    });
    button('return-player', 'Return inline', () => {
      move(stage, slot);
      expanded.hidden = true;
      state.mode = 'inline';
    });
    button('hide-player', 'Hide player', () => {
      clip.pause();
      stage.hidden = true;
      state.phase = 'hidden';
    });
    button('show-player', 'Show player', () => {
      stage.hidden = false;
      state.phase = 'ready';
    });
    return true;
  }
  if (profile === 'attachment-thread') {
    const thread = document.createElement('section');
    main.append(thread);
    const viewer = document.createElement('section');
    viewer.className = 'profile-viewer';
    viewer.hidden = true;
    main.append(viewer);
    const reply = document.createElement('textarea');
    reply.id = 'thread-reply';
    reply.setAttribute('aria-label', 'Message');
    main.append(reply);
    let message, stage, clip;
    const clear = () => {
      if (clip) {
        removeMedia(clip);
      }
      stage?.remove();
      message?.remove();
      viewer.hidden = true;
    };
    const render = () => {
      clear();
      message = document.createElement('article');
      thread.append(message);
      stage = player(message);
      clip = video(stage, 'mock-video', source(state.asset));
      for (const path of ['/mock-still.gif', '/mock-animated.gif']) {
        const image = document.createElement('img');
        image.width = 80;
        image.height = 45;
        image.alt = 'Synthetic attachment';
        image.src = path;
        message.append(image);
      }
    };
    render();
    transport(() => (clip?.isConnected ? clip : null));
    button('open-attachment', 'Open attachment', () => {
      if (clip.isConnected) {
        viewer.hidden = false;
        move(stage, viewer);
      }
    });
    button('close-attachment', 'Close attachment', () => {
      if (message.isConnected) {
        move(stage, message);
      }
      viewer.hidden = true;
    });
    button('expire-attachment', 'Expire attachment', () => {
      if (clip.isConnected) {
        replaceSource(clip, '/mock-media/unavailable.mp4');
      }
    });
    button('renew-attachment', 'Renew attachment', () => {
      state.asset++;
      if (clip.isConnected) {
        replaceSource(clip, source(state.asset));
      }
    });
    button('remove-message', 'Remove message', clear);
    button('new-message', 'New message', () => {
      state.asset++;
      render();
    });
    return true;
  }
  if (profile === 'staged-player') {
    state.phase = 'placeholder';
    const spacer = document.createElement('div');
    spacer.style.height = '900px';
    main.append(spacer);
    const stage = player();
    stage.id = 'staged-player';
    stage.style.minHeight = '300px';
    const image = document.createElement('img');
    image.src = '/mock-still.gif';
    image.alt = 'Player placeholder';
    stage.append(image);
    let clip;
    const content = () => {
      removeMedia(clip);
      image.remove();
      state.phase = 'content';
      clip = video(stage, 'mock-video', source(state.asset, 'high', 'mp4'));
      qualities(clip);
    };
    const observer = new view.IntersectionObserver((entries) => {
      if (!disposed && state.phase === 'armed' && entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        image.remove();
        state.phase = 'preview';
        clip = video(stage);
        clip.loop = false;
        play(clip);
      }
    });
    onDispose(() => observer.disconnect());
    button('load-player', 'Load player', () => {
      state.phase = 'armed';
      observer.observe(stage);
      stage.scrollIntoView();
    });
    button('skip-stage', 'Continue to content', () => {
      if (state.phase === 'preview') {
        content();
      }
    });
    button('next-entry', 'Next entry', () => {
      if (state.phase === 'content') {
        state.asset++;
        replaceSource(clip, source(state.asset, 'high', 'mp4'));
      }
    });
    button('float-stage', 'Toggle floating player', () =>
      stage.classList.toggle('profile-floating')
    );
    transport(() => clip);
    return true;
  }
  state.mode = 'live';
  state.advances = 0;
  state.phase = 'loading';
  const StreamSource = view.MediaSource || view.ManagedMediaSource;
  if (!StreamSource?.isTypeSupported('video/mp4; codecs="avc1.42c00a, mp4a.40.2"')) {
    show('Native MediaSource unavailable');
    return true;
  }
  const mediaSource = new StreamSource();
  const objectUrl = view.URL.createObjectURL(mediaSource);
  const clip = video(player(main), 'mock-video', objectUrl);
  // WebKit requires this or an AirPlay alternative for ManagedMediaSource.
  // This local stream tests decoded playback and seeking; it has no receiver.
  if (!view.MediaSource) {
    clip.disableRemotePlayback = true;
  }
  clip.querySelector('source').type = 'video/mp4';
  clip.load();
  clip.loop = false;
  let buffer,
    nextSegment = 0,
    windowStart = 0;
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    abort.abort();
    if (mediaSource.readyState === 'open' && buffer?.updating) {
      buffer.abort();
    }
    view.URL.revokeObjectURL(objectUrl);
  };
  onDispose(release);
  const update = (run) =>
    new Promise((resolve, reject) => {
      const finish = (error) => {
        buffer.removeEventListener('updateend', done);
        buffer.removeEventListener('error', failed);
        abort.signal.removeEventListener('abort', failed);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const done = () => finish();
      const failed = () => finish(new Error('Local stream update cancelled'));
      buffer.addEventListener('updateend', done, { once: true });
      buffer.addEventListener('error', failed, { once: true });
      abort.signal.addEventListener('abort', failed, { once: true });
      try {
        run();
      } catch (error) {
        finish(error);
      }
    });
  const append = async (name) => {
    const response = await view.fetch(`/mock-live/${name}`, { signal: abort.signal });
    if (!response.ok) {
      throw new Error('Local stream segment unavailable');
    }
    const bytes = await response.arrayBuffer();
    if (released) {
      throw new Error('Local stream released');
    }
    await update(() => buffer.appendBuffer(bytes));
  };
  const appendSegments = async (count) => {
    for (let i = 0; i < count && nextSegment < 12; i++) {
      await append(`segment-${String(nextSegment++).padStart(2, '0')}.m4s`);
    }
  };
  listen(
    mediaSource,
    'sourceopen',
    async () => {
      if (buffer || released) {
        return;
      }
      try {
        buffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42c00a, mp4a.40.2"');
        await append('init.mp4');
        mediaSource.duration = Infinity;
        await appendSegments(4);
        mediaSource.setLiveSeekableRange(0, 8);
        state.phase = 'live-ready';
      } catch (error) {
        if (!disposed && !released) {
          show(error.message);
        }
      }
    },
    { once: true, signal: abort.signal }
  );
  button('play', 'Play or pause', () => {
    if (clip.paused) {
      if (state.mode === 'live' && clip.seekable.length) {
        clip.currentTime = Math.max(
          clip.seekable.start(0),
          clip.seekable.end(clip.seekable.length - 1) - 4
        );
      }
      clip.play().catch((error) => show(error.name));
    } else {
      clip.pause();
    }
  });
  button('advance-window', 'Advance live window', async () => {
    try {
      if (state.phase !== 'live-ready' || released || nextSegment >= 12) {
        return;
      }
      state.phase = 'advancing';
      await appendSegments(2);
      windowStart += 4;
      await update(() => buffer.remove(0, windowStart));
      mediaSource.setLiveSeekableRange(windowStart, nextSegment * 2);
      if (!disposed && !released) {
        state.advances++;
        state.phase = 'live-ready';
      }
    } catch (error) {
      if (!disposed) {
        show(error.message);
      }
    }
  });
  button('recording', 'Use recording', () => {
    state.mode = 'recording';
    replaceSource(clip, source(1, 'recording', 'mp4'));
    release();
  });
  return true;
}

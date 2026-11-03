import { MEDIA_PROFILE_CASES, installMediaProfile } from './media-profile-fixture.js';

/** Stable behavior profiles; maintenance notes live in CUSTOM-PLAYER-FIXTURES.md. */
export const MEDIA_MOCK_CASES = Object.freeze([
  { id: 'loop-feed', contract: 'Recycled clips, rendition selection and mute intent' },
  { id: 'adaptive-watch', contract: 'Adaptive transport, file fallback and retained captions' },
  { id: 'rendition-watch', contract: 'File quality changes and delayed rate-reset cancellation' },
  { id: 'discussion-feed', contract: 'Independent duplicate clips, comments and embedded players' },
  { id: 'mixed-gallery', contract: 'Still images, animation and video with owner cleanup' },
  { id: 'source-embed', contract: 'Embedded source replacement, quality and viewer sizing' },
  {
    id: 'playlist-watch',
    contract: 'Unavailable media recovery and same-element playlist handoff',
  },
  { id: 'post-viewer', contract: 'Mixed-media posts with same-node viewer restoration' },
  { id: 'compact-embed', contract: 'Iframe resize, reinsertion and parent isolation' },
  ...MEDIA_PROFILE_CASES,
]);

export function installMediaMock(document) {
  const view = document.defaultView;
  const params = new view.URLSearchParams(view.location.search);
  const profile = params.get('case') || 'loop-feed';
  const main = document.querySelector('main');
  const status = document.querySelector('#status');
  const format = params.has('mp4') ? 'mp4' : 'webm';
  const removers = [];
  const errors = [];
  const requestedAsset = Number(params.get('asset') || 1);
  let asset = Number.isSafeInteger(requestedAsset) && requestedAsset > 0 ? requestedAsset : 1;
  let timer = null;
  let resets = 0;
  let disposed = false;
  const listen = (node, type, handler, options) => {
    node.addEventListener(type, handler, options);
    removers.push(() => node.removeEventListener(type, handler, options));
  };
  const show = (text) => {
    status.textContent = text;
  };
  const button = (id, label, handler, parent = main) => {
    const node = document.createElement('button');
    node.id = id;
    node.type = 'button';
    node.textContent = label;
    listen(node, 'click', handler);
    parent.append(node);
    return node;
  };
  const source = (index, quality = 'base', extension = format) =>
    `/mock-media/${extension === 'mp4' ? 'fallback.mp4' : 'clip.webm'}?asset=${index}&quality=${quality}`;
  const video = (parent, id = 'mock-video', url = source(asset)) => {
    const node = document.createElement('video');
    node.id = id;
    node.controls = node.muted = node.loop = node.playsInline = true;
    node.preload = 'auto';
    const child = document.createElement('source');
    child.src = url;
    child.type = url.includes('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : url.includes('.mp4')
        ? 'video/mp4'
        : 'video/webm';
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'Example captions';
    track.srclang = 'en';
    track.src = '/mock-captions.vtt';
    track.default = params.has('native-qa');
    node.append(child, track);
    parent.append(node);
    if (params.has('native-qa') && !parent.querySelector('[data-native-focus]')) {
      const focus = button(
        `show-${id}`,
        `Show ${id} controls`,
        () => {
          parent.querySelector('video')?.scrollIntoView({ block: 'center' });
        },
        parent
      );
      focus.dataset.nativeFocus = id;
    }
    return node;
  };
  const replaceSource = (node, url) => {
    if (timer !== null) {
      view.clearTimeout(timer);
      timer = null;
    }
    const resume = !node.paused;
    const child = node.querySelector('source');
    child.src = url;
    child.type = url.includes('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : url.includes('.mp4')
        ? 'video/mp4'
        : 'video/webm';
    node.load();
    if (resume) {
      const selectedSource = child.src;
      node.play().catch((error) => {
        if (child.src === selectedSource && error.name !== 'AbortError') {
          show(error.name);
        }
      });
    }
  };
  const removeMedia = (node) => {
    if (node?.tagName === 'VIDEO') {
      node.pause();
    }
    node?.remove();
  };
  const player = (parent = main, className = '') => {
    const node = document.createElement('div');
    node.className = `player ${className}`;
    parent.append(node);
    return node;
  };
  const qualities = (node, values = ['low', 'high']) => {
    const label = document.createElement('label');
    label.textContent = 'Quality ';
    const select = document.createElement('select');
    select.id = 'quality';
    for (const value of values) {
      const option = document.createElement('option');
      option.value = option.textContent = value;
      select.append(option);
    }
    label.append(select);
    main.append(label);
    const current = new view.URL(node.querySelector('source').src).searchParams.get('quality');
    select.value = values.includes(current) ? current : values[0];
    const apply = () =>
      replaceSource(
        node,
        source(
          Number(new view.URL(node.querySelector('source').src).searchParams.get('asset')) || asset,
          select.value,
          profile === 'adaptive-watch' || profile === 'rendition-watch' ? 'mp4' : format
        )
      );
    listen(select, 'change', apply);
    for (const value of values) {
      button(`quality-${value}`, value.toUpperCase(), () => {
        select.value = value;
        apply();
      });
    }
    return select;
  };
  const embeddedPlayer = (parent = main, childCase = 'frame-player', childAsset = asset) => {
    const port = params.get('framePort') || view.location.port;
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      show('Invalid local frame port');
      return null;
    }
    const frame = document.createElement('iframe');
    frame.title = 'Local embedded player';
    frame.allowFullscreen = true;
    frame.allow = 'autoplay; fullscreen';
    frame.src = `http://127.0.0.1:${port}/media-mocks.html?case=${childCase}&asset=${childAsset}${childCase === 'command-player' || params.has('native-qa') ? `&parentPort=${view.location.port}` : ''}${params.has('mp4') ? '&mp4' : ''}${params.has('native-qa') ? '&native-qa' : ''}`;
    parent.append(frame);
    return frame;
  };
  listen(
    document,
    'error',
    (event) => {
      if (event.target?.tagName !== 'VIDEO' && event.target?.tagName !== 'SOURCE') {
        return;
      }
      errors.push('Local media unavailable');
      if (errors.length > 16) {
        errors.shift();
      }
      show('Local media unavailable');
    },
    true
  );

  if (profile === 'loop-feed') {
    const clip = video(player(), 'mock-video', source(asset, 'gif'));
    const quality = qualities(clip, ['gif', 'sd', 'hd']);
    button('play', 'Play or pause', () => {
      if (clip.paused) {
        clip.play().catch((error) => show(error.name));
      } else {
        clip.pause();
      }
    });
    button('mute', 'Mute or unmute', () => {
      clip.muted = !clip.muted;
    });
    button('next', 'Next clip', () => {
      asset++;
      replaceSource(clip, source(asset, quality.value));
    });
  } else if (
    ['adaptive-watch', 'rendition-watch', 'playlist-watch', 'frame-player'].includes(profile)
  ) {
    if (profile === 'frame-player') {
      document.body.classList.add('frame-player');
    }
    const clip = video(
      player(main, profile === 'playlist-watch' ? 'jwplayer' : 'video-js'),
      'mock-video',
      source(
        asset,
        'high',
        profile === 'adaptive-watch' || profile === 'rendition-watch' ? 'mp4' : format
      )
    );
    qualities(clip);
    button('play', 'Play or pause', () => {
      if (clip.paused) {
        clip.play().catch((error) => show(error.name));
      } else {
        clip.pause();
      }
    });
    if (profile === 'adaptive-watch' || profile === 'rendition-watch') {
      button('adaptive', 'Use adaptive source', () =>
        replaceSource(clip, '/mock-media/playlist.m3u8')
      );
      button('file', 'Use file source', () => replaceSource(clip, source(asset, 'high', 'mp4')));
    }
    if (profile === 'rendition-watch') {
      button('queue-reset', 'Queue site rate reset', () => {
        if (timer !== null) {
          view.clearTimeout(timer);
        }
        timer = view.setTimeout(() => {
          timer = null;
          if (!disposed && clip.isConnected) {
            resets++;
            clip.playbackRate = 1;
          }
        }, 3000);
      });
    }
    if (profile === 'playlist-watch') {
      button('unavailable', 'Choose unavailable source', () =>
        replaceSource(clip, '/mock-media/unavailable.mp4')
      );
      button('recover', 'Use available source', () => replaceSource(clip, source(asset)));
      button('next', 'Next clip', () => {
        asset++;
        replaceSource(clip, source(asset));
      });
    }
  } else if (profile === 'mixed-gallery') {
    const stage = player();
    const items = [
      '/mock-still.gif',
      '/mock-animated.gif',
      '/mock-media/fallback.mp4',
      '/mock-media/clip.webm',
    ];
    let index = 0;
    const render = () => {
      removeMedia(stage.querySelector('video, img'));
      if (index < 2) {
        const image = document.createElement('img');
        image.id = 'gallery-item';
        image.alt = 'Synthetic picture';
        image.width = 320;
        image.height = 180;
        image.src = items[index];
        stage.append(image);
      } else {
        video(stage, 'gallery-item', items[index]);
      }
      show(`Item ${index + 1}`);
    };
    button('gallery-next', 'Next item', () => {
      index = (index + 1) % items.length;
      render();
    });
    button('gallery-previous', 'Previous item', () => {
      index = (index + items.length - 1) % items.length;
      render();
    });
    button('play', 'Play clip', () => {
      const clip = stage.querySelector('video');
      if (clip) {
        clip.play().catch((error) => show(error.name));
      }
    });
    render();
  } else if (profile === 'discussion-feed' || profile === 'post-viewer') {
    const post = document.createElement('article');
    post.id = 'original-post';
    main.append(post);
    const clip = video(player(post), 'original-video');
    const reply = document.createElement('textarea');
    reply.id = 'reply';
    reply.setAttribute('aria-label', 'Comment');
    main.append(reply);
    const extras = document.createElement('section');
    extras.id = 'extra-posts';
    main.append(extras);
    button('duplicate', profile === 'discussion-feed' ? 'Crosspost clip' : 'Repost clip', () => {
      if (extras.querySelector('video')) {
        return;
      }
      const duplicate = clip.cloneNode(true);
      duplicate.id = 'duplicate-video';
      duplicate.muted = true;
      player(extras).append(duplicate);
    });
    button('remove-duplicate', 'Remove repost', () => {
      const duplicate = extras.querySelector('video');
      const wrapper = duplicate?.parentElement;
      removeMedia(duplicate);
      wrapper?.remove();
    });
    button('embed', 'Add embedded clip', () => {
      if (!main.querySelector('iframe')) {
        embeddedPlayer(extras);
      }
    });
    if (profile === 'post-viewer') {
      const image = document.createElement('img');
      image.id = 'post-animation';
      image.alt = 'Synthetic animation';
      image.width = 320;
      image.height = 180;
      image.src = '/mock-animated.gif';
      post.append(image);
      const viewer = document.createElement('section');
      viewer.id = 'site-viewer';
      viewer.hidden = true;
      main.append(viewer);
      const slot = document.createElement('div');
      slot.id = 'post-slot';
      button('open-viewer', 'Open post viewer', () => {
        if (!viewer.hidden) {
          return;
        }
        slot.style.height = `${post.getBoundingClientRect().height}px`;
        post.before(slot);
        viewer.append(post);
        viewer.hidden = false;
      });
      button('close-viewer', 'Close post viewer', () => {
        if (viewer.hidden) {
          return;
        }
        slot.replaceWith(post);
        viewer.hidden = true;
      });
    }
  } else if (profile === 'source-embed' || profile === 'compact-embed') {
    const actions = document.createElement('div');
    actions.className = 'actions';
    main.append(actions);
    const stage = player();
    const open = () => {
      if (!stage.querySelector('iframe')) {
        embeddedPlayer(stage);
      }
    };
    button('open-embed', 'Load embedded clip', open, actions);
    button(
      'close-embed',
      'Remove embedded clip',
      () => stage.querySelector('iframe')?.remove(),
      actions
    );
    if (profile === 'source-embed') {
      button(
        'recreate',
        'Recreate player',
        () => {
          stage.querySelector('iframe')?.remove();
          asset++;
          open();
        },
        actions
      );
      button(
        'theater',
        'Toggle site viewer',
        () => stage.querySelector('iframe')?.classList.toggle('expanded'),
        actions
      );
    } else {
      button(
        'resize',
        'Resize embedded clip',
        () => stage.querySelector('iframe')?.classList.toggle('wide'),
        actions
      );
    }
  } else if (
    !installMediaProfile({
      document,
      profile,
      main,
      params,
      button,
      video,
      player,
      replaceSource,
      removeMedia,
      source,
      listen,
      show,
      embeddedPlayer,
      qualities,
      initialAsset: asset,
      onDispose: (remove) => removers.push(remove),
    })
  ) {
    show('Unknown local case');
  }

  view.__mediaMockState = () => ({
    profile,
    asset,
    resets,
    pendingReset: timer !== null,
    disposed,
    detail: view.__mediaProfileState?.(),
    errors: [...errors],
    media: [...document.querySelectorAll('video, img')].map((node) => ({
      id: node.id,
      tag: node.tagName,
      source: node.currentSrc || node.src,
      rate: node.playbackRate,
      muted: node.muted,
      paused: node.paused,
      time: node.currentTime,
      duration: String(node.duration),
      readyState: node.readyState,
      frames: node.getVideoPlaybackQuality?.().totalVideoFrames,
      seekable: node.seekable?.length
        ? [node.seekable.start(0), node.seekable.end(node.seekable.length - 1)]
        : [],
    })),
  });
  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    if (timer !== null) {
      view.clearTimeout(timer);
    }
    timer = null;
    removers.splice(0).forEach((remove) => remove());
    document.querySelectorAll('video').forEach((node) => node.pause());
  }
  listen(view, 'pagehide', dispose, { once: true });
  return { dispose };
}

/** Resolve same-item alternatives supplied by HTML or a recognized player. */
window.VSC = window.VSC || {};

(function () {
  const HLS_TYPES = new Set(['hls', 'application/x-mpegurl', 'application/vnd.apple.mpegurl']);
  const own = (object, key) => Object.getOwnPropertyDescriptor(object || {}, key)?.value;

  function url(value, doc) {
    if (typeof value !== 'string' || value.length > 4096 || /[\s'"\\]/.test(value)) {
      return null;
    }
    const parsed = new URL(value, doc.baseURI);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash
      ? parsed
      : null;
  }

  function protectedItem(item) {
    return ['drm', 'key_systems', 'keySystems', 'licenseUrl', 'license_url', 'ssai', 'live'].some(
      (key) => Boolean(own(item, key))
    );
  }

  function alternatives(sources, originalUrl, doc, provider) {
    if (!Array.isArray(sources) || sources.length > 32) {
      return null;
    }
    let original = false;
    let best;
    for (let index = 0; index < sources.length; index++) {
      const source = own(sources, String(index));
      if (!source || protectedItem(source)) {
        return null;
      }
      const parsed = url(own(source, 'src') || own(source, 'file'), doc);
      if (!parsed) {
        continue;
      }
      const type = (own(source, 'type') || '').toLowerCase();
      if (
        parsed.href === originalUrl &&
        (HLS_TYPES.has(type) || /\.m3u8$/i.test(parsed.pathname))
      ) {
        original = true;
      }
      if (type !== 'video/mp4' && type !== 'mp4' && (type || !/\.mp4$/i.test(parsed.pathname))) {
        continue;
      }
      const rawHeight = own(source, 'height');
      const width = own(source, 'width');
      const label = own(source, 'label');
      const height =
        Number.isFinite(rawHeight) && rawHeight > 0
          ? Number.isFinite(width) && width > 0
            ? Math.min(width, rawHeight)
            : rawHeight
          : typeof label === 'string' && /^\d{2,4}p$/.test(label)
            ? Number.parseInt(label, 10)
            : 0;
      const limited = height > 0 && height <= 720;
      const preferred = limited
        ? height > (best?.height || 0)
        : height > 0 && (!best?.height || height < best.height);
      if (!best || (limited && !best.limited) || (limited === best.limited && preferred)) {
        best = { href: parsed.href, height, limited };
      }
    }
    return original && best ? { originalUrl, progressiveUrl: best.href, provider } : null;
  }

  function origin(video, originParent) {
    if (!originParent) {
      return video.parentElement;
    }
    const player = video.vsc?.iosPlayer;
    return player?.active &&
      player.video === video &&
      player.originParent === originParent &&
      originParent.isConnected &&
      originParent.ownerDocument === video.ownerDocument &&
      player.anchor?.parentNode === originParent
      ? originParent
      : null;
  }

  function singleMedia(scope, video, originParent) {
    const videos = scope.querySelectorAll('video');
    return videos.length === 1 ? videos[0] === video : videos.length === 0 && !!originParent;
  }

  window.VSC.ProgressiveMediaSource = {
    findCandidate(video, originParent) {
      try {
        if (
          video?.localName !== 'video' ||
          !video.isConnected ||
          video.srcObject ||
          video.mediaKeys ||
          video.webkitKeys ||
          video.duration === Infinity
        ) {
          return null;
        }
        const doc = video.ownerDocument;
        const originalUrl = video.currentSrc || video.src;
        const current = url(originalUrl, doc);
        let scope = origin(video, originParent);
        if (
          !current ||
          !scope ||
          video.children.length > 32 ||
          (video.hasAttribute('src')
            ? video.src !== originalUrl
            : !Array.from(video.children).some(
                (child) => child.localName === 'source' && child.src === originalUrl
              ))
        ) {
          return null;
        }
        if (current.hostname === 'video.twimg.com') {
          const twitter = window.VSC.TwitterMediaSource?.findCandidate(video, originParent);
          if (twitter) {
            return twitter;
          }
        }
        if (video.children.length <= 32) {
          const sources = [];
          for (const child of video.children) {
            if (
              child.localName === 'source' &&
              (!child.media || doc.defaultView.matchMedia(child.media).matches)
            ) {
              sources.push({
                src: child.src,
                type: child.type,
                label: child.getAttribute('label'),
              });
            }
          }
          const html = alternatives(sources, originalUrl, doc, 'html');
          if (html) {
            return html;
          }
        }
        const view = doc.defaultView;
        for (let hops = 0; scope && hops < 12; hops++, scope = scope.parentElement) {
          if (
            !scope.id ||
            (!scope.classList.contains('video-js') && !scope.classList.contains('jwplayer')) ||
            !singleMedia(scope, video, originParent)
          ) {
            continue;
          }
          if (
            scope.classList.contains('video-js') &&
            typeof view.videojs?.getPlayer === 'function'
          ) {
            const player = view.videojs.getPlayer(scope.id);
            if (
              player?.el?.() !== scope ||
              player.ads?.isInAdMode?.() ||
              player.ads?.inAdBreak?.()
            ) {
              continue;
            }
            const info = own(player, 'mediainfo');
            if (protectedItem(info) || own(info, 'text_tracks')?.length) {
              continue;
            }
            const candidate = alternatives(player.currentSources?.(), originalUrl, doc, 'videojs');
            if (candidate) {
              return candidate;
            }
          }
          if (scope.classList.contains('jwplayer') && typeof view.jwplayer === 'function') {
            const player = view.jwplayer(scope.id);
            if (player?.getContainer?.() !== scope) {
              continue;
            }
            const item = player.getPlaylistItem?.();
            if (
              protectedItem(item) ||
              own(item, 'streamtype') === 'live' ||
              own(item, 'tracks')?.length
            ) {
              continue;
            }
            const candidate = alternatives(own(item, 'sources'), originalUrl, doc, 'jwplayer');
            if (candidate) {
              return candidate;
            }
          }
        }
      } catch {
        // Site metadata and player APIs are optional, page-owned inputs.
      }
      return null;
    },
  };
})();

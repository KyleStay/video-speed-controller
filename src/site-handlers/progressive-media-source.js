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

  function protectedTracks(tracks, doc) {
    if (tracks === null || tracks === undefined) {
      return false;
    }
    if (!Array.isArray(tracks) || tracks.length > 16) {
      return true;
    }
    for (let index = 0; index < tracks.length; index++) {
      const track = own(tracks, String(index));
      // External SDK metadata (e.g. thumbnail VTTs) remains on the same player.
      // Caption and unknown declarations may describe not-yet-loaded in-band data.
      if (own(track, 'kind') !== 'metadata') {
        return true;
      }
      const src = own(track, 'src') || own(track, 'file');
      if (typeof src !== 'string' || src.length > 4096) {
        return true;
      }
      const remote = new URL(src, doc.baseURI);
      if (
        !['https:', 'http:'].includes(remote.protocol) ||
        remote.username ||
        remote.password ||
        remote.hash
      ) {
        return true;
      }
    }
    return false;
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
        const originalScope = origin(video, originParent);
        if (
          !current ||
          !originalScope ||
          video.children.length > 32 ||
          (video.hasAttribute('src')
            ? video.src !== originalUrl
            : !Array.from(video.children).some(
                (child) => child.localName === 'source' && child.src === originalUrl
              ))
        ) {
          return null;
        }
        const view = doc.defaultView;
        const twitterPlayer =
          current.hostname === 'video.twimg.com'
            ? window.VSC.TwitterMediaSource?.findPlayerStateCandidate?.(video, originParent)
            : undefined;
        // A recognized X SDK's protected/changed item cannot fall back to stale
        // React metadata or HTML alternatives. Publisher vetoes below still win.
        if (twitterPlayer === null) {
          return null;
        }
        let publisherCandidate;
        const seen = new Set();
        // Whole-player portals retain metadata beside the video; video-only
        // portals retain it at the validated restoration anchor. Inspect both.
        const roots = [video.parentElement, originalScope];
        for (const root of roots) {
          let scope = root;
          for (let hops = 0; scope && hops < 12; hops++, scope = scope.parentElement) {
            if (seen.has(scope)) {
              continue;
            }
            seen.add(scope);
            if (
              !scope.id ||
              (!scope.classList.contains('video-js') && !scope.classList.contains('jwplayer'))
            ) {
              continue;
            }
            if (!singleMedia(scope, video, originParent)) {
              return null;
            }
            let sources;
            let provider;
            let persistentMetadataTrack;
            if (scope.classList.contains('video-js')) {
              const player = view.videojs?.getPlayer?.(scope.id);
              if (
                player?.el?.() !== scope ||
                player.ads?.isInAdMode?.() ||
                player.ads?.inAdBreak?.()
              ) {
                return null;
              }
              const info = own(player, 'mediainfo');
              if (protectedItem(info) || protectedTracks(own(info, 'text_tracks'), doc)) {
                return null;
              }
              sources = player.currentSources?.();
              provider = 'videojs';
              const proxy = own(own(player, 'proxyTracks_'), 'media');
              const track = own(proxy, 'track_');
              if (
                own(proxy, 'player_') === player &&
                own(proxy, 'type_') === 'media' &&
                track?.kind === 'metadata' &&
                track.label === 'media-cues' &&
                track.inBandMetadataTrackDispatchType === '' &&
                video.textTracks?.length <= 16 &&
                Array.from(video.textTracks).includes(track)
              ) {
                persistentMetadataTrack = track;
              }
            } else {
              const player = typeof view.jwplayer === 'function' && view.jwplayer(scope.id);
              if (player?.getContainer?.() !== scope) {
                return null;
              }
              const item = player.getPlaylistItem?.();
              if (
                protectedItem(item) ||
                own(item, 'streamtype') === 'live' ||
                protectedTracks(own(item, 'tracks'), doc)
              ) {
                return null;
              }
              // JW normalizes sources to the active format; allSources retains
              // the configured alternatives for this same current item.
              sources = own(item, 'allSources') || own(item, 'sources');
              provider = 'jwplayer';
            }
            // Publisher restrictions apply to every resolution route, including
            // HTML children retained by the SDK. Never bypass a protected item.
            if (!Array.isArray(sources) || sources.length > 32) {
              return null;
            }
            for (let index = 0; index < sources.length; index++) {
              if (protectedItem(own(sources, String(index)))) {
                return null;
              }
            }
            publisherCandidate = alternatives(sources, originalUrl, doc, provider);
            if (publisherCandidate) {
              return persistentMetadataTrack
                ? { ...publisherCandidate, persistentMetadataTrack }
                : publisherCandidate;
            }
            // The nearest recognized player is the only publisher authority.
            return null;
          }
        }
        if (current.hostname === 'video.twimg.com') {
          if (twitterPlayer) {
            return twitterPlayer;
          }
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
      } catch {
        // Site metadata and player APIs are optional, page-owned inputs.
      }
      return null;
    },
  };
})();

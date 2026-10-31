/** Resolve an explicitly supplied progressive rendition; never fetch or rewrite a source. */
window.VSC = window.VSC || {};

(function () {
  const CHILD_KEYS = [
    'children',
    'props',
    'playerProps',
    'poppedOutSource',
    'content',
    'videoProps',
    'videoInfo',
    'video_info',
    'media',
    'mediaDetails',
    'video',
    'variants',
  ];

  function ownValue(object, key) {
    try {
      return Object.getOwnPropertyDescriptor(object, key)?.value;
    } catch {
      return undefined;
    }
  }

  function asset(value, kind) {
    if (typeof value !== 'string' || value.length > 4096 || /[\s'"\\]/.test(value)) {
      return null;
    }
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'video.twimg.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        url.href !== value
      ) {
        return null;
      }
      const match = url.pathname.match(
        /^\/(amplify_video|ext_tw_video)\/(\d+)\/(?:pu\/)?(pl|vid)\/[\w/.-]+\.(m3u8|mp4)$/
      );
      if (
        !match ||
        (kind === 'hls'
          ? match[3] !== 'pl' || match[4] !== 'm3u8'
          : match[3] !== 'vid' || match[4] !== 'mp4')
      ) {
        return null;
      }
      const dimensions = url.pathname.match(/\/(\d+)x(\d+)\//);
      const height = dimensions ? Math.min(Number(dimensions[1]), Number(dimensions[2])) : 0;
      return {
        type: match[1],
        id: match[2],
        height: Number.isSafeInteger(height) && height > 0 ? height : 0,
      };
    } catch {
      return null;
    }
  }

  function variantCandidate(variants, originalUrl, original, visit) {
    let hasOriginal = false;
    let best = null;
    const length = Math.min(ownValue(variants, 'length') || 0, 8);
    for (let index = 0; index < length; index++) {
      const entry = ownValue(variants, String(index));
      if (!visit(entry)) {
        continue;
      }
      const type = ownValue(entry, 'content_type') ?? ownValue(entry, 'type');
      const url = ownValue(entry, 'url') ?? ownValue(entry, 'src');
      if (
        url === originalUrl &&
        typeof type === 'string' &&
        ['application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(type.toLowerCase())
      ) {
        hasOriginal = true;
      }
      const progressive = type === 'video/mp4' ? asset(url, 'mp4') : null;
      if (progressive?.type !== original.type || progressive.id !== original.id) {
        continue;
      }
      const rawBitrate = ownValue(entry, 'bitrate');
      const bitrate = Number.isFinite(rawBitrate) && rawBitrate > 0 ? rawBitrate : 0;
      const limited = progressive.height > 0 && progressive.height <= 720;
      if (
        !best ||
        (limited && !best.limited) ||
        (limited === best.limited &&
          (progressive.height > best.height ||
            (progressive.height === best.height && bitrate > best.bitrate)))
      ) {
        best = { url, height: progressive.height, bitrate, limited };
      }
    }
    return hasOriginal ? best?.url : null;
  }

  function playerAccessoryVariants(value) {
    // X keeps playback renditions beside its download link in this fixed path.
    // Read only data descriptors; do not expand the general React traversal.
    for (const key of ['timeRemainingAccessory', 'props', 'media', 'video_info', 'variants']) {
      value = ownValue(value, key);
      if (!value || typeof value !== 'object') {
        return null;
      }
    }
    return Array.isArray(value) ? value : null;
  }

  function currentPlayerHlsMatches(declaredUrl, originalUrl) {
    if (!asset(declaredUrl, 'hls')) {
      return false;
    }
    if (declaredUrl === originalUrl) {
      return true;
    }
    // Remove only the observed literal appended marker. Comparing the rest of
    // the URL verbatim preserves query encoding, ordering and empty segments.
    const marker = declaredUrl.includes('?') ? '&variant_version=1' : '?variant_version=1';
    return (
      !new URL(declaredUrl).searchParams.has('variant_version') &&
      originalUrl.endsWith(marker) &&
      originalUrl.slice(0, -marker.length) === declaredUrl
    );
  }

  // undefined: this SDK is absent; null: its current source must retain HLS.
  // Read the observed videoComponent slot directly instead of expanding the
  // generic React search into SDK objects, other playlist items or functions.
  function playerStateCandidate(
    video,
    originParent,
    retained,
    expectedReload = false,
    captioned = false,
    preparing = false,
    allowDisposed = false,
    pendingHls = false,
    restoring = false
  ) {
    try {
      const actualUrl = video?.currentSrc || video?.src;
      const originalUrl = retained ? retained.originalUrl : actualUrl;
      if (
        retained &&
        (video !== retained.video ||
          (video.vsc !== retained.controller &&
            !(allowDisposed && retained.controller?.disposed && video.vsc === undefined)) ||
          (video.vsc?.disposed && !allowDisposed) ||
          video.ownerDocument !== retained.doc ||
          retained.doc.documentElement !== retained.root ||
          retained.doc.URL !== retained.url ||
          (preparing
            ? video.getAttribute('src') !== retained.originalAttribute ||
              (actualUrl !== originalUrl &&
                !(restoring && video.currentSrc === retained.progressiveUrl))
            : video.getAttribute('src') !== retained.progressiveUrl ||
              (video.currentSrc &&
                video.currentSrc !== retained.progressiveUrl &&
                !(captioned && pendingHls && video.currentSrc === originalUrl))))
      ) {
        return null;
      }
      const original = asset(originalUrl, 'hls');
      if (!original || !video.isConnected) {
        return undefined;
      }
      if (
        video.localName !== 'video' ||
        video.srcObject ||
        video.mediaKeys ||
        video.webkitKeys ||
        video.duration === Infinity ||
        video.audioTracks?.length > 1 ||
        video.videoTracks?.length > 1
      ) {
        return null;
      }
      if (
        video.hasAttribute('src') &&
        video.src !== ((!preparing && retained?.progressiveUrl) || originalUrl)
      ) {
        return null;
      }
      const player = video.vsc?.iosPlayer;
      if (
        originParent &&
        (!player?.active ||
          player.video !== video ||
          player.originParent !== originParent ||
          !originParent.isConnected ||
          originParent.ownerDocument !== video.ownerDocument ||
          player.anchor?.parentNode !== originParent)
      ) {
        return null;
      }
      const seen = new Set();
      for (const root of [video.parentElement, originParent]) {
        let node = root;
        for (let hops = 0; node && hops < 12; hops++, node = node.parentElement) {
          if (seen.has(node)) {
            continue;
          }
          seen.add(node);
          if (node.getAttribute('data-testid') !== 'videoComponent') {
            continue;
          }
          const keys = Object.getOwnPropertyNames(node);
          if (keys.length > 64) {
            continue;
          }
          for (const key of keys) {
            if (!key.startsWith('__reactProps$')) {
              continue;
            }
            const children = ownValue(ownValue(node, key), 'children');
            if (!Array.isArray(children) || ownValue(children, 'length') > 8) {
              continue;
            }
            const props = ownValue(ownValue(children, '1'), 'props');
            if (!Object.getOwnPropertyDescriptor(props || {}, 'playerState')) {
              continue;
            }
            const state = ownValue(props, 'playerState');
            const source = ownValue(state, 'source');
            const tracks = ownValue(state, 'tracks');
            const id = ownValue(state, 'currentTrackId');
            const validId =
              (typeof id === 'string' && id.length > 0 && id.length <= 256) ||
              (Number.isSafeInteger(id) && id >= 0);
            if (
              !validId ||
              ownValue(source, 'type') !== 'tweet' ||
              ownValue(source, 'trackId') !== id ||
              !Array.isArray(tracks) ||
              ownValue(tracks, 'length') > 8 ||
              (captioned
                ? typeof ownValue(state, 'hasCaptions') !== 'boolean'
                : ownValue(state, 'hasCaptions') !== false)
            ) {
              return null;
            }
            let selected;
            for (let index = 0; index < ownValue(tracks, 'length'); index++) {
              const track = ownValue(tracks, String(index));
              if (ownValue(track, 'id') !== id) {
                continue;
              }
              if (selected) {
                return null;
              }
              selected = track;
            }
            if (
              !selected ||
              ownValue(selected, 'contentType') !== 'media_entity' ||
              ownValue(selected, 'hasCaptions') !== captioned
            ) {
              return null;
            }
            const durationMs = ownValue(selected, 'durationMs');
            if (!Number.isFinite(durationMs) || durationMs <= 0) {
              return null;
            }
            if (
              retained &&
              (node !== retained.node ||
                key !== retained.key ||
                id !== retained.trackId ||
                ownValue(source, 'id') !== retained.sourceId ||
                ownValue(source, 'index') !== retained.sourceIndex)
            ) {
              return null;
            }
            if (retained) {
              const nativeDuration = video.duration;
              const loading =
                expectedReload &&
                video.readyState < 1 &&
                (Number.isNaN(nativeDuration) || nativeDuration === 0);
              if (
                Math.abs(durationMs - retained.durationMs) > 250 ||
                (!loading &&
                  (!Number.isFinite(nativeDuration) ||
                    nativeDuration <= 0 ||
                    Math.abs(nativeDuration * 1000 - durationMs) > 250))
              ) {
                return null;
              }
            }
            // X's expanded viewer omits availability on its current clear track.
            // An explicit declaration still vetoes unknown/unavailable states;
            // never evaluate an accessor to find out which state it represents.
            const availability = Object.getOwnPropertyDescriptor(selected, 'mediaAvailability');
            if (
              availability &&
              (availability.get ||
                availability.set ||
                (availability.value !== undefined &&
                  ownValue(availability.value, 'status') !== 'available'))
            ) {
              return null;
            }
            const protectedKeys = [
              'drm',
              'key_systems',
              'keySystems',
              'encrypted',
              'licenseUrl',
              'license_url',
              'ssai',
              'live',
              'vmapUrl',
              'generateDrmTokenCallback',
            ];
            if (captioned) {
              protectedKeys.push('isProtected', 'isLive', 'isAd', 'isAdvertisement', 'preroll');
              for (const value of [state, source]) {
                for (const key of protectedKeys) {
                  const descriptor = Object.getOwnPropertyDescriptor(value, key);
                  if (descriptor && (descriptor.get || descriptor.set || descriptor.value)) {
                    return null;
                  }
                }
              }
            }
            for (const key of protectedKeys) {
              const descriptor = Object.getOwnPropertyDescriptor(selected, key);
              if (descriptor && (descriptor.get || descriptor.set || descriptor.value)) {
                return null;
              }
            }
            const variants = ownValue(selected, 'variants');
            const variantCount = ownValue(variants, 'length');
            if (
              !Array.isArray(variants) ||
              !Number.isSafeInteger(variantCount) ||
              variantCount < 0 ||
              variantCount > 8
            ) {
              return null;
            }
            // Snapshot identities before reading page-owned variant descriptors.
            // Neither a Proxy nor an SDK update may grow a loop's work budget.
            const entries = [];
            for (let index = 0; index < variantCount; index++) {
              entries.push(ownValue(variants, String(index)));
            }
            const keys = ['content_type', 'type', 'url', 'src', 'bitrate'];
            const readFields = (entry) => {
              const values = [];
              for (const key of keys) {
                const descriptor =
                  entry && typeof entry === 'object'
                    ? Object.getOwnPropertyDescriptor(entry, key)
                    : undefined;
                if (descriptor && !Object.hasOwn(descriptor, 'value')) {
                  return null;
                }
                values.push(descriptor?.value);
              }
              return values;
            };
            const fields = [];
            for (let index = 0; index < variantCount; index++) {
              const values = readFields(entries[index]);
              if (!values) {
                return null;
              }
              fields.push(values);
            }
            const unchanged = () => {
              if (
                ownValue(selected, 'variants') !== variants ||
                ownValue(variants, 'length') !== variantCount
              ) {
                return false;
              }
              for (let index = 0; index < variantCount; index++) {
                if (ownValue(variants, String(index)) !== entries[index]) {
                  return false;
                }
                const values = readFields(entries[index]);
                if (
                  !values ||
                  !values.every((value, field) => Object.is(value, fields[index][field]))
                ) {
                  return false;
                }
              }
              return (
                ownValue(variants, 'length') === variantCount &&
                entries.every((entry, index) => ownValue(variants, String(index)) === entry)
              );
            };
            if (!unchanged()) {
              return null;
            }
            for (let index = 0; index < variantCount; index++) {
              const variant = entries[index];
              if (!variant || typeof variant !== 'object') {
                continue;
              }
              for (const key of protectedKeys) {
                const descriptor = Object.getOwnPropertyDescriptor(variant, key);
                if (descriptor && (descriptor.get || descriptor.set || descriptor.value)) {
                  return null;
                }
              }
            }
            const snapshot = fields.map((value, index) =>
              entries[index] && typeof entries[index] === 'object'
                ? { type: value[0] ?? value[1], src: value[2] ?? value[3], bitrate: value[4] }
                : entries[index]
            );
            const indexDescriptor = Object.getOwnPropertyDescriptor(
              selected,
              'currentVariantIndex'
            );
            let declaredOriginalUrl = retained?.declaredOriginalUrl || originalUrl;
            if (indexDescriptor) {
              const index = indexDescriptor.value;
              if (!Number.isSafeInteger(index) || index < 0 || index >= variantCount) {
                return null;
              }
              const declared = fields[index]?.[3];
              if (!(
                currentPlayerHlsMatches(declared, originalUrl) ||
                (retained && (!preparing || restoring) && declared === retained.progressiveUrl)
              )) {
                return null;
              }
              if (!retained) {
                declaredOriginalUrl = declared;
              }
            } else if (retained?.hasVariantIndex) {
              return null;
            }
            const visited = new Set();
            const visit = (value) => {
              if (!value || typeof value !== 'object' || visited.has(value) || visited.size >= 8) {
                return false;
              }
              visited.add(value);
              return true;
            };
            const progressiveUrl = variantCandidate(snapshot, declaredOriginalUrl, original, visit);
            if (!progressiveUrl) {
              return null;
            }
            // X replaces SDK objects and selects its MP4 after our same-clip
            // handoff. Bind primitive rendition contents, not those objects.
            const variantBindings = [];
            for (let index = 0; index < variantCount; index++) {
              const variant = snapshot[index];
              const bitrate = ownValue(variant, 'bitrate');
              const type = ownValue(variant, 'type');
              const url = ownValue(variant, 'src');
              if (
                (type !== undefined && typeof type !== 'string') ||
                (url !== undefined && typeof url !== 'string')
              ) {
                return null;
              }
              variantBindings.push([
                type,
                url,
                Number.isFinite(bitrate) && bitrate > 0 ? bitrate : 0,
              ]);
            }
            if (!unchanged()) {
              return null;
            }
            if (
              variantBindings.filter((entry) => entry[1] === declaredOriginalUrl).length !== 1 ||
              variantBindings.filter((entry) => entry[1] === progressiveUrl).length !== 1 ||
              (retained &&
                (variantBindings.length !== retained.variantBindings.length ||
                  !variantBindings.every((entry, index) =>
                    entry.every((value, field) => value === retained.variantBindings[index][field])
                  )))
            ) {
              return null;
            }
            const doc = video.ownerDocument;
            if (
              captioned &&
              window.VSC.TwitterPlayer?.validateRetainedHls?.(
                video,
                originalUrl,
                progressiveUrl,
                originParent,
                expectedReload && video.readyState < 1 ? durationMs / 1000 : undefined
              ) !== undefined
            ) {
              return null;
            }
            const binding = {
              video,
              controller: video.vsc,
              doc,
              root: doc.documentElement,
              url: doc.URL,
              node,
              key,
              trackId: id,
              sourceId: ownValue(source, 'id'),
              sourceIndex: ownValue(source, 'index'),
              durationMs,
              declaredOriginalUrl,
              hasVariantIndex: Boolean(indexDescriptor),
              variantBindings,
              originalUrl,
              progressiveUrl,
              originalAttribute: video.getAttribute('src'),
            };
            const result = {
              originalUrl,
              progressiveUrl,
              mediaId: original.id,
              revalidate(expectedReload = false, allowDisposed = false, pendingHls = false) {
                try {
                  const player = video.vsc?.iosPlayer;
                  const retainedOrigin = player?.active ? player.originParent : undefined;
                  const next = playerStateCandidate(
                    video,
                    retainedOrigin,
                    binding,
                    expectedReload,
                    captioned,
                    false,
                    captioned && allowDisposed,
                    captioned && pendingHls
                  );
                  if (
                    !next ||
                    next.originalUrl !== originalUrl ||
                    next.progressiveUrl !== progressiveUrl
                  ) {
                    return false;
                  }
                  // A newly bound modern SDK may veto the retained legacy item.
                  return captioned
                    ? window.VSC.TwitterPlayer?.validateRetainedHls?.(
                        video,
                        originalUrl,
                        progressiveUrl,
                        retainedOrigin,
                        expectedReload && video.readyState < 1 ? durationMs / 1000 : undefined
                      ) === undefined
                    : window.VSC.TwitterPlayer?.validateRetainedHls?.(
                        video,
                        originalUrl,
                        progressiveUrl,
                        retainedOrigin,
                        expectedReload && video.readyState < 1 ? durationMs / 1000 : undefined
                      ) !== false;
                } catch {
                  return false;
                }
              },
            };
            Object.defineProperty(result, 'revalidate', { enumerable: false });
            if (captioned) {
              result.assetType = original.type;
              result.duration = durationMs / 1000;
              result.isCurrent = () => {
                const player = video.vsc?.iosPlayer;
                const origin = player?.active ? player.originParent : undefined;
                const next = playerStateCandidate(video, origin, binding, false, true, true);
                return Boolean(
                  next && next.originalUrl === originalUrl && next.progressiveUrl === progressiveUrl
                );
              };
              result.restoreCurrent = (transition = false) => {
                const player = video.vsc?.iosPlayer || binding.controller?.iosPlayer;
                const origin = player?.active ? player.originParent : undefined;
                const next = playerStateCandidate(
                  video,
                  origin,
                  binding,
                  transition,
                  true,
                  true,
                  true,
                  false,
                  transition
                );
                return Boolean(
                  next && next.originalUrl === originalUrl && next.progressiveUrl === progressiveUrl
                );
              };
            }
            if (!unchanged()) {
              return null;
            }
            return result;
          }
        }
      }
    } catch {
      return null;
    }
    return undefined;
  }

  window.VSC.TwitterMediaSource = {
    matchesCurrentPlayerHls: currentPlayerHlsMatches,
    findCaptionCandidate(video, originParent) {
      try {
        const tracks = Array.from(video.textTracks || []);
        if (
          tracks.length !== 2 ||
          tracks.filter((t) => t.kind === 'captions').length !== 1 ||
          tracks.filter((t) => t.kind === 'subtitles').length !== 1 ||
          video.querySelectorAll('track').length ||
          !Number.isFinite(video.duration) ||
          video.duration <= 0
        ) {
          return null;
        }
        const current = video.currentSrc || video.src;
        const sources = Array.from(video.children).filter((child) => child.localName === 'source');
        if (
          video.hasAttribute('src')
            ? video.src !== current
            : sources.length !== 1 || sources[0].src !== current
        ) {
          return null;
        }
        const candidate = playerStateCandidate(video, originParent, undefined, false, true);
        return candidate && Math.abs(candidate.duration - video.duration) <= 0.25
          ? candidate
          : null;
      } catch {
        return null;
      }
    },
    findPlayerStateCandidate(video, originParent) {
      const legacy = playerStateCandidate(video, originParent);
      if (legacy === null) {
        return null;
      }
      const modern = window.VSC.TwitterPlayer?.findNativeHlsCandidate(video, originParent);
      return modern === undefined ? legacy : modern;
    },
    findCandidate(video, originParent) {
      try {
        if (
          video?.localName !== 'video' ||
          !video.isConnected ||
          video.srcObject ||
          video.mediaKeys ||
          video.duration === Infinity ||
          video.audioTracks?.length > 1
        ) {
          return null;
        }
        // A blob currentSrc is MSE even if a stale src attribute names a playlist.
        const originalUrl = video.currentSrc || video.src;
        const original = asset(originalUrl, 'hls');
        if (!original) {
          return null;
        }
        // Resource selection is asynchronous: currentSrc may still describe the
        // old feed item after the site has already changed its source intent.
        if (video.hasAttribute('src')) {
          if (video.src !== originalUrl) {
            return null;
          }
        } else if (
          !Array.from(video.children).some(
            (child) => child.localName === 'source' && child.src === originalUrl
          )
        ) {
          return null;
        }

        const currentPlayer = this.findPlayerStateCandidate(video, originParent);
        if (currentPlayer !== undefined) {
          return currentPlayer;
        }

        const visited = new Set();
        let visits = 0;
        const visit = (value) => {
          if (!value || typeof value !== 'object' || visited.has(value) || visits >= 128) {
            return false;
          }
          visited.add(value);
          visits++;
          return true;
        };
        let ancestor = video.parentElement;
        if (originParent) {
          const player = video.vsc?.iosPlayer;
          if (
            !player?.active ||
            player.video !== video ||
            player.originParent !== originParent ||
            !originParent.isConnected ||
            originParent.ownerDocument !== video.ownerDocument ||
            player.anchor?.parentNode !== originParent
          ) {
            return null;
          }
          // The owned player portals the same media away from X's React tree.
          // Its connected restoration anchor identifies the original scope.
        }
        const scopes = new Set();
        for (const root of [ancestor, originParent]) {
          ancestor = root;
          for (let hops = 0; ancestor && hops < 12; hops++, ancestor = ancestor.parentElement) {
            if (scopes.has(ancestor)) {
              continue;
            }
            scopes.add(ancestor);
            const keys = Object.getOwnPropertyNames(ancestor);
            if (keys.length > 64) {
              continue;
            }
            for (const key of keys) {
              if (!key.startsWith('__reactProps$')) {
                continue;
              }
              const stack = [{ value: ownValue(ancestor, key), depth: 0 }];
              while (stack.length && visits < 128) {
                const { value, depth, variants } = stack.pop();
                if (!visit(value)) {
                  continue;
                }
                if (variants && Array.isArray(value)) {
                  // The active HLS and chosen MP4 must belong to this same array.
                  const progressiveUrl =
                    depth < 6 && variantCandidate(value, originalUrl, original, visit);
                  if (progressiveUrl) {
                    return { originalUrl, progressiveUrl, mediaId: original.id };
                  }
                  continue;
                }
                const accessory = playerAccessoryVariants(value);
                if (accessory && visit(accessory)) {
                  const progressiveUrl = variantCandidate(accessory, originalUrl, original, visit);
                  if (progressiveUrl) {
                    return { originalUrl, progressiveUrl, mediaId: original.id };
                  }
                }
                if (ownValue(value, 'src') === originalUrl) {
                  const progressiveUrl = ownValue(value, 'downloadUrl');
                  const progressive = asset(progressiveUrl, 'mp4');
                  if (progressive?.type === original.type && progressive.id === original.id) {
                    return { originalUrl, progressiveUrl, mediaId: original.id };
                  }
                }
                if (depth >= 6) {
                  continue;
                }
                if (Array.isArray(value)) {
                  const length = Math.min(ownValue(value, 'length') || 0, 8);
                  for (let index = length - 1; index >= 0; index--) {
                    stack.push({ value: ownValue(value, String(index)), depth: depth + 1 });
                  }
                } else {
                  for (let index = CHILD_KEYS.length - 1; index >= 0; index--) {
                    stack.push({
                      value: ownValue(value, CHILD_KEYS[index]),
                      depth: depth + 1,
                      variants: CHILD_KEYS[index] === 'variants',
                    });
                  }
                }
              }
              if (visits >= 128) {
                return null;
              }
            }
          }
        }
      } catch {
        // Site-owned descriptors, media getters and reparenting may be hostile.
      }
      return null;
    },
  };
})();

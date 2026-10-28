/** Read the observed current X player without changing its MSE source or producer. */
window.VSC = window.VSC || {};

(function () {
  const FLAGS = [
    'drm',
    'key_systems',
    'keySystems',
    'licenseUrl',
    'license_url',
    'isProtected',
    'encrypted',
    'ssai',
    'live',
    'isLive',
    'isAd',
    'isAdvertisement',
    'vmapUrl',
    'generateDrmTokenCallback',
    'preroll',
    'hasCaptions',
    'unavailability',
  ];
  // Accessors are unknown inputs, including a declared capability getter.
  const own = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object || {}, key);
    if (descriptor && !('value' in descriptor)) {
      throw new Error('Player accessor');
    }
    return descriptor?.value;
  };
  const clear = (object) => {
    if (!object || typeof object !== 'object') {
      return false;
    }
    if (FLAGS.some((key) => Boolean(own(object, key)))) {
      return false;
    }
    for (const key of ['alternateAudioTracks', 'alternateVideoTracks', 'captionTracks']) {
      const tracks = own(object, key);
      if (tracks !== undefined && (!Array.isArray(tracks) || tracks.length !== 0)) {
        return false;
      }
    }
    return true;
  };
  const id = (value) => typeof value === 'string' && /^\d{1,30}$/.test(value);
  const near = (left, right) =>
    Number.isFinite(left) &&
    left > 0 &&
    Number.isFinite(right) &&
    right > 0 &&
    Math.abs(left - right) <= 1;

  function asset(value, kind) {
    if (typeof value !== 'string' || value.length > 4096 || /[\s'"\\]/.test(value)) {
      return null;
    }
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
    return {
      type: match[1],
      id: match[2],
      height: dimensions ? Math.min(Number(dimensions[1]), Number(dimensions[2])) : 0,
    };
  }

  function scopeFor(video, originParent, restored = false) {
    if (!originParent) {
      return video.parentElement;
    }
    const player = video.vsc?.iosPlayer;
    if (
      restored &&
      !player?.active &&
      originParent.isConnected &&
      originParent.ownerDocument === video.ownerDocument &&
      originParent.contains(video)
    ) {
      return originParent;
    }
    return player?.active &&
      player.video === video &&
      player.doc === video.ownerDocument &&
      player.originParent === originParent &&
      originParent.isConnected &&
      originParent.ownerDocument === video.ownerDocument &&
      player.anchor?.parentNode === originParent &&
      player.anchor.ownerDocument === video.ownerDocument &&
      player.ui?.host?.isConnected &&
      player.portalNode?.parentNode === player.ui.host &&
      player.portalNode.contains(video)
      ? originParent
      : null;
  }

  function nativeSafe(video, doc, originalUrl, identityOnly = false) {
    const page = new URL(doc.URL);
    const current = video.currentSrc || video.src;
    const blob = new URL(current);
    return (
      video.localName === 'video' &&
      video.isConnected &&
      video.ownerDocument === doc &&
      doc === window.document &&
      window.VSC.EventManager.isTwitterHost(page.hostname) &&
      blob.protocol === 'blob:' &&
      blob.origin === page.origin &&
      blob.href === current &&
      (!originalUrl || originalUrl === current) &&
      video.hasAttribute('src') &&
      video.src === current &&
      // Seeking the retained producer can temporarily drop decoded readiness.
      // Its loaded metadata and exact SDK/source identity still permit handback.
      video.readyState >= (identityOnly ? 1 : 2) &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      Number.isFinite(video.currentTime) &&
      !video.srcObject &&
      (identityOnly ||
        (!video.mediaKeys &&
          !video.webkitKeys &&
          video.textTracks?.length === 0 &&
          video.querySelectorAll('track').length === 0 &&
          !(video.audioTracks?.length > 1) &&
          !(video.videoTracks?.length > 1)))
    );
  }

  function mediaScopeSafe(scope, video, companion, portal) {
    if (!scope) {
      return false;
    }
    const media = scope.querySelectorAll('video,audio,iframe,ogvjs');
    if (media.length > 2) {
      return false;
    }
    let found = false;
    for (const node of media) {
      if (node === video) {
        found = true;
      } else if (node !== companion) {
        return false;
      }
    }
    return found || portal;
  }

  function inspect(video, originParent, companion, identityOnly = false, restored = false) {
    const scope = scopeFor(video, originParent, restored);
    if (
      !scope ||
      !mediaScopeSafe(scope, video, companion, Boolean(originParent)) ||
      !mediaScopeSafe(video.parentElement, video, companion, false)
    ) {
      return null;
    }
    const fibers = [];
    const seen = new Set();
    for (const node of new Set([video.parentElement, scope])) {
      const keys = Object.getOwnPropertyNames(node);
      if (keys.length > 64) {
        return null;
      }
      for (const key of keys) {
        if (!key.startsWith('__reactFiber$')) {
          continue;
        }
        let fiber = own(node, key);
        while (fiber && !seen.has(fiber) && fibers.length < 8) {
          seen.add(fiber);
          fibers.push(fiber);
          fiber = own(fiber, 'return');
        }
      }
    }
    let result;
    for (const fiber of fibers) {
      let hook = own(fiber, 'memoizedState');
      const hooks = new Set();
      for (let index = 0; hook && index < 16; index++) {
        if (hooks.has(hook)) {
          return null;
        }
        hooks.add(hook);
        const sdk = own(hook, 'memoizedState');
        if (sdk && own(sdk, 'element') === video) {
          const controller = own(sdk, 'controller');
          const api = own(controller, 'api');
          const store = own(sdk, 'store');
          const getMediaElement = own(api, 'getMediaElement');
          const getState = own(api, 'getState');
          const getSnapshot = own(store, 'getSnapshot');
          const subscribe = own(store, 'subscribe');
          const seekTo = own(api, 'seekTo');
          if (
            typeof getMediaElement !== 'function' ||
            getMediaElement.call(api) !== video ||
            typeof getState !== 'function' ||
            typeof getSnapshot !== 'function' ||
            typeof subscribe !== 'function' ||
            typeof seekTo !== 'function' ||
            (!identityOnly && (!clear(sdk) || !clear(controller)))
          ) {
            return null;
          }
          const state = getState.call(api);
          const snapshot = getSnapshot.call(store);
          if (snapshot !== state) {
            return null;
          }
          const props = own(fiber, 'memoizedProps');
          const content = own(props, 'content');
          const selected = own(state, 'content');
          const sourceUrl = own(sdk, 'src');
          const source = own(state, 'source');
          const sourceAsset = asset(sourceUrl, 'hls');
          const contentId = own(content, 'contentId');
          const post = own(content, 'sourceId');
          const hostKey = own(props, 'hostKey');
          const sessionId = own(own(state, 'session'), 'id');
          if (
            !sourceAsset ||
            !id(contentId) ||
            sourceAsset.id !== contentId ||
            !id(post) ||
            own(content, 'tweetId') !== post ||
            hostKey !== `${post}:${contentId}` ||
            own(props, 'src') !== sourceUrl ||
            own(content, 'mediaAssetUrl') !== sourceUrl ||
            own(content, 'contentType') !== 'video' ||
            own(content, 'sourceType') !== 'tweet' ||
            own(selected, 'contentId') !== contentId ||
            own(selected, 'sourceId') !== post ||
            own(selected, 'tweetId') !== post ||
            own(selected, 'mediaAssetUrl') !== sourceUrl ||
            own(selected, 'contentType') !== 'video' ||
            own(selected, 'sourceType') !== 'tweet' ||
            own(source, 'kind') !== 'hls' ||
            own(source, 'src') !== sourceUrl ||
            typeof sessionId !== 'string' ||
            !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(sessionId) ||
            !near(own(content, 'durationMs') / 1000, video.duration) ||
            !near(own(selected, 'durationMs') / 1000, video.duration) ||
            !near(own(source, 'playlistDurationSec'), video.duration) ||
            (!identityOnly && ![props, content, selected, source, state].every(clear))
          ) {
            return null;
          }
          for (const value of [state, snapshot]) {
            const tracks = own(own(value, 'textTracks'), 'tracks');
            if (
              (!identityOnly && (!Array.isArray(tracks) || tracks.length !== 0 || !clear(value))) ||
              own(own(value, 'session'), 'id') !== sessionId ||
              own(own(value, 'content'), 'contentId') !== contentId ||
              own(own(value, 'source'), 'src') !== sourceUrl
            ) {
              return null;
            }
          }
          const binding = {
            sdk,
            api,
            store,
            subscribe,
            seekTo,
            getState,
            getSnapshot,
            getMediaElement,
            content,
            selected,
            sourceUrl,
            contentId,
            sessionId,
            scope,
          };
          if (result && result.sdk !== sdk) {
            return null;
          }
          if (identityOnly) {
            result = binding;
            hook = own(hook, 'next');
            continue;
          }
          const loop = own(own(state, 'playback'), 'shouldLoop');
          if (typeof loop !== 'boolean') {
            return null;
          }
          let modern;
          const metadataSeen = new Set();
          for (
            let parent = own(fiber, 'return');
            parent && seen.has(parent) && !metadataSeen.has(parent);
            parent = own(parent, 'return')
          ) {
            metadataSeen.add(parent);
            const metadata = own(parent, 'memoizedProps');
            if (own(metadata, 'poppedOutSource') !== undefined) {
              modern = metadata;
              break;
            }
          }
          const popped = own(modern, 'poppedOutSource');
          const supplied = own(popped, 'playerProps');
          const media = own(own(own(modern, 'timeRemainingAccessory'), 'props'), 'media');
          const info = own(media, 'video_info');
          const variants = own(info, 'variants');
          const download = own(modern, 'downloadUrl');
          const downloadAsset = asset(download, 'mp4');
          if (
            !modern ||
            ![modern, popped, supplied, media, info].every(clear) ||
            own(popped, 'hostKey') !== hostKey ||
            own(supplied, 'src') !== sourceUrl ||
            own(supplied, 'content') !== content ||
            own(supplied, 'downloadUrl') !== download ||
            own(media, 'id_str') !== contentId ||
            !near(own(info, 'duration_millis') / 1000, video.duration) ||
            downloadAsset?.id !== contentId ||
            downloadAsset.type !== sourceAsset.type ||
            own(media, 'video_download_url') !== download ||
            !Array.isArray(variants) ||
            variants.length > 8
          ) {
            return null;
          }
          let matchedHls = false;
          let best;
          for (let variant = 0; variant < variants.length; variant++) {
            const item = own(variants, String(variant));
            if (!clear(item)) {
              return null;
            }
            const type = own(item, 'content_type');
            const url = own(item, 'url');
            if (
              url === sourceUrl &&
              typeof type === 'string' &&
              ['application/x-mpegurl', 'application/vnd.apple.mpegurl'].includes(
                type.toLowerCase()
              )
            ) {
              matchedHls = true;
            }
            if (type !== 'video/mp4') {
              continue;
            }
            const parsed = asset(url, 'mp4');
            if (!parsed || parsed.id !== contentId || parsed.type !== sourceAsset.type) {
              return null;
            }
            const bitrate = own(item, 'bitrate');
            const ranked = {
              url,
              height: parsed.height,
              limited: parsed.height > 0 && parsed.height <= 720,
              bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : 0,
            };
            if (
              !best ||
              (ranked.limited && !best.limited) ||
              (ranked.limited === best.limited &&
                (ranked.height > best.height ||
                  (ranked.height === best.height && ranked.bitrate > best.bitrate)))
            ) {
              best = ranked;
            }
          }
          if (!matchedHls || !best || (result && result.sdk !== sdk)) {
            return null;
          }
          result = {
            ...binding,
            progressiveUrl: best.url,
            loop,
            scope,
          };
        }
        hook = own(hook, 'next');
      }
    }
    return result || null;
  }

  window.VSC.TwitterPlayer = {
    resolve(video, originParent) {
      try {
        const doc = video?.ownerDocument;
        if (!doc || !nativeSafe(video, doc)) {
          return null;
        }
        const originalUrl = video.currentSrc || video.src;
        const root = doc.documentElement;
        const documentUrl = doc.URL;
        const initial = inspect(video, originParent);
        if (!initial) {
          return null;
        }
        const scopeRoot = initial.scope.getRootNode();
        let companion;
        return {
          originalUrl,
          progressiveUrl: initial.progressiveUrl,
          sourceUrl: initial.sourceUrl,
          contentId: initial.contentId,
          sessionId: initial.sessionId,
          sdk: initial.sdk,
          api: initial.api,
          store: initial.store,
          loop: initial.loop,
          current(allowed) {
            try {
              if (allowed !== undefined) {
                if (companion && allowed !== companion) {
                  return false;
                }
                if (!companion) {
                  if (
                    allowed === video ||
                    allowed?.localName !== 'video' ||
                    allowed.ownerDocument !== doc ||
                    allowed.isConnected
                  ) {
                    return false;
                  }
                  companion = allowed;
                }
              }
              if (companion && companion.ownerDocument !== doc) {
                return false;
              }
              if (
                doc.documentElement !== root ||
                doc.URL !== documentUrl ||
                !nativeSafe(video, doc, originalUrl) ||
                initial.scope.getRootNode() !== scopeRoot
              ) {
                return false;
              }
              const next = inspect(video, originParent, companion, false, true);
              return Boolean(
                next &&
                [
                  'sdk',
                  'api',
                  'store',
                  'getState',
                  'getSnapshot',
                  'getMediaElement',
                  'seekTo',
                  'subscribe',
                  'content',
                  'selected',
                  'sourceUrl',
                  'contentId',
                  'sessionId',
                  'progressiveUrl',
                  'loop',
                  'scope',
                ].every((key) => next[key] === initial[key])
              );
            } catch {
              return false;
            }
          },
          identityCurrent() {
            try {
              if (
                doc.documentElement !== root ||
                doc.URL !== documentUrl ||
                !nativeSafe(video, doc, originalUrl, true) ||
                initial.scope.getRootNode() !== scopeRoot ||
                (companion && companion.ownerDocument !== doc)
              ) {
                return false;
              }
              const next = inspect(video, originParent, companion, true, true);
              return Boolean(
                next &&
                [
                  'sdk',
                  'api',
                  'store',
                  'getState',
                  'getSnapshot',
                  'getMediaElement',
                  'seekTo',
                  'subscribe',
                  'content',
                  'selected',
                  'sourceUrl',
                  'contentId',
                  'sessionId',
                  'scope',
                ].every((key) => next[key] === initial[key])
              );
            } catch {
              return false;
            }
          },
          subscribe(callback) {
            try {
              if (typeof callback !== 'function') {
                return null;
              }
              const dispose = initial.subscribe.call(initial.store, callback);
              if (typeof dispose !== 'function') {
                return null;
              }
              let active = true;
              return () => {
                if (active) {
                  active = false;
                  try {
                    dispose();
                  } catch {
                    /* Release is best effort. */
                  }
                }
              };
            } catch {
              return null;
            }
          },
        };
      } catch {
        return null;
      }
    },
  };
})();

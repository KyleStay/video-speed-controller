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

  function sourceChild(video, current) {
    if (video.hasAttribute('src') || video.src || video.children.length > 32) {
      return null;
    }
    const sources = Array.from(video.children).filter((child) => child.localName === 'source');
    if (sources.length !== 1 || sources[0].src !== current) {
      return null;
    }
    const node = sources[0];
    return {
      node,
      attributes: ['src', 'type', 'media'].map((key) => node.getAttribute(key)),
      properties: [node.src, node.type, node.media],
    };
  }

  function assignedSourceCurrent(video, current, binding) {
    if (!binding) {
      return video.hasAttribute('src') && video.src === current;
    }
    const next = sourceChild(video, current);
    return Boolean(
      next &&
      next.node === binding.node &&
      next.node.parentNode === video &&
      next.node.ownerDocument === video.ownerDocument &&
      next.attributes.every((value, index) => value === binding.attributes[index]) &&
      next.properties.every((value, index) => value === binding.properties[index])
    );
  }

  function nativeSafe(video, doc, originalUrl, identityOnly = false, sourceBinding = null) {
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
      assignedSourceCurrent(video, current, sourceBinding) &&
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

  const relayClear = (value) =>
    clear(value) &&
    [...FLAGS, 'alternateAudioTracks', 'alternateVideoTracks', 'captionTracks'].every(
      (key) => Object.hasOwn(value, key) || !(key in value)
    );

  function relayVariants(fiber, post, contentId, duration, download, current) {
    const reads = [],
      methods = [],
      ancestors = new Set();
    const data = (object, key) => {
      const value = own(object, key);
      if (object && !Object.hasOwn(object, key) && key in Object(object)) {
        throw Error('Inherited cache data');
      }
      reads.push([object, key, value]);
      return value;
    };
    const method = (object, key) => {
      for (let depth = 0; object && depth < 4; depth++, object = Object.getPrototypeOf(object)) {
        if (Object.getOwnPropertyDescriptor(object, key)) {
          return own(object, key);
        }
      }
    };
    const capture = (object, key) => {
      const value = method(object, key);
      methods.push([object, key, value]);
      return value;
    };
    const call = (object, fn, args) => {
      const valid = () => current() && methods.every(([o, k, v]) => method(o, k) === v);
      if (typeof fn !== 'function' || !valid()) {
        throw Error('Changed cache owner');
      }
      const result = Reflect.apply(fn, object, args);
      if (!valid()) {
        throw Error('Changed cache owner');
      }
      return result;
    };
    const list = (value, max) => {
      const count = data(value, 'length');
      if (!Array.isArray(value) || !Number.isSafeInteger(count) || count < 1 || count > max) {
        throw Error('Cache list budget');
      }
      const result = [];
      for (let i = 0; i < count; i++) {
        result.push(data(value, String(i)));
      }
      if (data(value, 'length') !== count) {
        throw Error('Changed cache list');
      }
      return result;
    };
    const reference = (value) =>
      typeof value === 'string' && value.length > 0 && value.length <= 512;
    let environment,
      mediaRef,
      contexts = 0;
    for (let depth = 0; fiber && depth < 24; depth++, fiber = data(fiber, 'return')) {
      if (ancestors.has(fiber)) {
        throw Error('Cache ancestor cycle');
      }
      ancestors.add(fiber);
      const tweet = data(data(fiber, 'memoizedProps'), 'tweet');
      if (tweet && data(tweet, 'rest_id') === post) {
        const ref = data(list(data(tweet, 'media_entities2'), 1)[0], '__id');
        if (!reference(ref) || (mediaRef && mediaRef !== ref)) {
          throw Error('Ambiguous cache media');
        }
        mediaRef = ref;
      }
      let dependency = data(data(fiber, 'dependencies'), 'firstContext');
      const seen = new Set();
      for (let i = 0; dependency && i < 64; i++, dependency = data(dependency, 'next')) {
        if (seen.has(dependency) || ++contexts > 64) {
          throw Error('Cache context budget');
        }
        seen.add(dependency);
        const next = data(data(dependency, 'memoizedValue'), 'environment');
        if (next) {
          if (
            method(next, '@@RelayModernEnvironment') !== true ||
            (environment && next !== environment)
          ) {
            throw Error('Ambiguous cache environment');
          }
          environment = next;
        }
      }
      if (dependency) {
        throw Error('Cache dependency budget');
      }
    }
    if (!environment || !mediaRef) {
      return null;
    }
    capture(environment, '@@RelayModernEnvironment');
    const store = call(environment, capture(environment, 'getStore'), []);
    const source = call(store, capture(store, 'getSource'), []);
    const get = capture(source, 'get'),
      records = new Set();
    const record = (ref) => {
      if (!reference(ref) || records.has(ref) || records.size >= 8) {
        throw Error('Cache record budget');
      }
      records.add(ref);
      const value = call(source, get, [ref]);
      if (!relayClear(value)) {
        throw Error('Cache capability veto');
      }
      for (const key of [
        ...FLAGS,
        'alternateAudioTracks',
        'alternateVideoTracks',
        'captionTracks',
      ]) {
        data(value, key);
      }
      return value;
    };
    const media = record(mediaRef);
    if (data(media, 'id_str') !== contentId || data(media, 'type') !== 'video') {
      return null;
    }
    const info = record(data(data(media, 'video_info'), '__ref'));
    if (!near(data(info, 'duration_millis') / 1000, duration)) {
      return null;
    }
    const variants = list(data(data(info, 'variants'), '__refs'), 8).map((ref) => {
      const item = record(ref);
      return {
        content_type: data(item, 'content_type'),
        url: data(item, 'url'),
        bitrate: data(item, 'bitrate'),
      };
    });
    if (
      !variants.some((item) => item.content_type === 'video/mp4' && item.url === download) ||
      reads.some(
        ([object, key, value]) =>
          own(object, key) !== value ||
          (object && !Object.hasOwn(object, key) && key in Object(object))
      ) ||
      !current() ||
      methods.some(([object, key, value]) => method(object, key) !== value)
    ) {
      return null;
    }
    return variants;
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
            const tracks = identityOnly ? null : own(own(value, 'textTracks'), 'tracks');
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
          let variants = own(info, 'variants');
          const download = own(modern, 'downloadUrl');
          const downloadAsset = asset(download, 'mp4');
          const cached = Boolean(
            modern &&
            !Object.getOwnPropertyDescriptor(modern, 'timeRemainingAccessory') &&
            !('timeRemainingAccessory' in modern)
          );
          if (cached) {
            // Without countdown UI, the same post's renditions live in Relay.
            const doc = video.ownerDocument,
              root = doc.documentElement,
              url = doc.URL;
            const nativeUrl = video.currentSrc || video.src,
              assigned = video.getAttribute('src'),
              poster = video.getAttribute('poster');
            const fields = [
              [sdk, 'element', 'src', 'controller', 'store'],
              [controller, 'api'],
              [api, 'getState', 'getMediaElement', 'seekTo'],
              [store, 'getSnapshot', 'subscribe'],
              [props, 'src', 'hostKey', 'content'],
              [
                content,
                'contentId',
                'sourceId',
                'tweetId',
                'mediaAssetUrl',
                'durationMs',
                'contentType',
                'sourceType',
              ],
              [
                selected,
                'contentId',
                'sourceId',
                'tweetId',
                'mediaAssetUrl',
                'durationMs',
                'contentType',
                'sourceType',
              ],
              [state, 'source', 'content', 'session', 'playback', 'textTracks'],
              [source, 'src', 'kind', 'playlistDurationSec'],
              [modern, 'poppedOutSource', 'downloadUrl'],
              [popped, 'hostKey', 'playerProps'],
              [supplied, 'src', 'content', 'downloadUrl'],
            ].flatMap(([object, ...keys]) => keys.map((key) => [object, key, own(object, key)]));
            const stable = () =>
              own(sdk, 'controller') === controller &&
              own(sdk, 'store') === store &&
              own(controller, 'api') === api &&
              own(api, 'getState') === getState &&
              own(api, 'getMediaElement') === getMediaElement &&
              own(api, 'seekTo') === seekTo &&
              own(store, 'getSnapshot') === getSnapshot &&
              own(store, 'subscribe') === subscribe &&
              fields.every(([object, key, value]) => own(object, key) === value) &&
              video.ownerDocument === doc &&
              doc.documentElement === root &&
              doc.URL === url &&
              video.isConnected &&
              (video.currentSrc || video.src) === nativeUrl &&
              video.getAttribute('src') === assigned &&
              video.getAttribute('poster') === poster &&
              !video.srcObject &&
              !video.mediaKeys &&
              !video.webkitKeys &&
              video.textTracks?.length === 0 &&
              video.querySelectorAll('track').length === 0 &&
              !(video.audioTracks?.length > 1) &&
              !(video.videoTracks?.length > 1) &&
              [
                sdk,
                controller,
                state,
                props,
                content,
                selected,
                source,
                modern,
                popped,
                supplied,
              ].every(relayClear) &&
              own(own(state, 'session'), 'id') === sessionId &&
              own(own(state, 'playback'), 'shouldLoop') === loop &&
              own(own(state, 'textTracks'), 'tracks')?.length === 0;
            const current = () =>
              stable() &&
              getState.call(api) === state &&
              stable() &&
              getSnapshot.call(store) === state &&
              stable() &&
              getMediaElement.call(api) === video &&
              stable();
            if (!current()) {
              return null;
            }
            variants = relayVariants(fiber, post, contentId, video.duration, download, current);
            if (!variants) {
              return null;
            }
          }
          const variantCount = own(variants, 'length');
          if (
            !modern ||
            ![modern, popped, supplied].every(clear) ||
            own(popped, 'hostKey') !== hostKey ||
            own(supplied, 'src') !== sourceUrl ||
            own(supplied, 'content') !== content ||
            own(supplied, 'downloadUrl') !== download ||
            (!cached &&
              (!clear(media) ||
                !clear(info) ||
                own(media, 'id_str') !== contentId ||
                !near(own(info, 'duration_millis') / 1000, video.duration) ||
                own(media, 'video_download_url') !== download)) ||
            downloadAsset?.id !== contentId ||
            downloadAsset.type !== sourceAsset.type ||
            !Array.isArray(variants) ||
            !Number.isSafeInteger(variantCount) ||
            variantCount < 0 ||
            variantCount > 8
          ) {
            return null;
          }
          // Snapshot entries before their page-owned descriptors can mutate the
          // array. Neither validation nor ranking may follow a growing length.
          const variantEntries = [];
          for (let variant = 0; variant < variantCount; variant++) {
            variantEntries.push(own(variants, String(variant)));
          }
          let matchedHls = false;
          let best;
          for (const item of variantEntries) {
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
          if (
            own(variants, 'length') !== variantCount ||
            !matchedHls ||
            !best ||
            (result && result.sdk !== sdk)
          ) {
            return null;
          }
          result = {
            ...binding,
            progressiveUrl: best.url,
            cached,
            loop,
            scope,
          };
        }
        hook = own(hook, 'next');
      }
    }
    return result;
  }

  window.VSC.TwitterPlayer = {
    // undefined means no bound current SDK; null is an authoritative veto that
    // callers must preserve before considering React or HTML alternatives.
    findNativeHlsCandidate(video, originParent) {
      try {
        const doc = video?.ownerDocument;
        const originalUrl = video?.currentSrc || video?.src;
        const documentUrl = doc?.URL;
        const root = doc?.documentElement;
        if (
          !doc ||
          !asset(originalUrl, 'hls') ||
          !window.VSC.EventManager.isTwitterHost(new URL(doc.URL).hostname)
        ) {
          return undefined;
        }
        const candidate = inspect(video, originParent);
        if (!candidate) {
          return candidate;
        }
        if (
          video.localName !== 'video' ||
          !video.isConnected ||
          doc !== window.document ||
          doc.URL !== documentUrl ||
          doc.documentElement !== root ||
          video.ownerDocument !== doc ||
          (video.currentSrc || video.src) !== originalUrl ||
          (video.hasAttribute('src')
            ? video.src !== originalUrl
            : video.children.length > 32 ||
              !Array.from(video.children).some(
                (child) => child.localName === 'source' && child.src === originalUrl
              )) ||
          video.readyState < 1 ||
          !Number.isFinite(video.duration) ||
          video.duration <= 0 ||
          !Number.isFinite(video.currentTime) ||
          video.srcObject ||
          video.mediaKeys ||
          video.webkitKeys ||
          video.audioTracks?.length > 1 ||
          video.videoTracks?.length > 1 ||
          !window.VSC.TwitterMediaSource.matchesCurrentPlayerHls(candidate.sourceUrl, originalUrl)
        ) {
          return null;
        }
        return {
          originalUrl,
          progressiveUrl: candidate.progressiveUrl,
          mediaId: candidate.contentId,
        };
      } catch {
        return null;
      }
    },
    resolve(video, originParent, { allowSourceChild = false } = {}) {
      try {
        const doc = video?.ownerDocument;
        if (!doc) {
          return null;
        }
        const originalUrl = video.currentSrc || video.src;
        // Automatic child-source entry requires the same-post cache route below.
        // Retain the exact node and its representation throughout the session.
        const sourceBinding = sourceChild(video, originalUrl);
        if (!nativeSafe(video, doc, originalUrl, false, sourceBinding)) {
          return null;
        }
        const root = doc.documentElement;
        const documentUrl = doc.URL;
        const initial = inspect(video, originParent);
        if (
          !initial ||
          (sourceBinding && !allowSourceChild && !initial.cached) ||
          !nativeSafe(video, doc, originalUrl, false, sourceBinding)
        ) {
          return null;
        }
        const scopeRoot = initial.scope.getRootNode();
        let companion;
        return {
          originalUrl,
          sourceNode: sourceBinding?.node,
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
                !nativeSafe(video, doc, originalUrl, false, sourceBinding) ||
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
                  'cached',
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
                !nativeSafe(video, doc, originalUrl, true, sourceBinding) ||
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

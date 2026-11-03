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
  const noDownload = (object) =>
    object &&
    own(object, 'downloadUrl') === undefined &&
    (Object.hasOwn(object, 'downloadUrl') || !('downloadUrl' in object));
  const loopEligible = (object) => {
    if (own(object, 'forceLoop') === true || own(object, 'loop') === true) {
      return true;
    }
    const duration = own(object, 'durationMs'),
      threshold = own(object, 'loopingThresholdMs');
    return (
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(threshold) &&
      threshold >= duration
    );
  };
  const unlimitedLoop = (props, content, selected) =>
    own(props, 'loop') === true ||
    [content, selected].every(
      (object) =>
        loopEligible(object) &&
        ['maxLoopCount', 'maxLoopingThresholdSeconds'].every((key) => {
          const limit = Object.getOwnPropertyDescriptor(object, key);
          return limit
            ? Object.hasOwn(limit, 'value') && (limit.value === null || limit.value === undefined)
            : !(key in object);
        })
    );
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

  // Bind the original caption state; presentation also permits an empty track set.
  function captionRoleFor(video, purpose = 'loop') {
    const tracks = video.textTracks,
      nodes = video.querySelectorAll('track'),
      audio = video.audioTracks;
    const noCaptions = purpose === 'presentation' && tracks?.length === 0 && nodes.length === 0;
    const count = noCaptions ? 0 : 1;
    if (tracks?.length !== count || nodes.length !== count || audio?.length !== 1) {
      return null;
    }
    const track = noCaptions ? null : tracks[0],
      node = noCaptions ? null : nodes[0],
      audioTrack = audio[0],
      duration = video.duration;
    const values = (object, keys) =>
      keys.every((key) => {
        const field = Object.getOwnPropertyDescriptor(object, key);
        return !field || Object.hasOwn(field, 'value');
      });
    if (
      (!noCaptions && !values(track, ['kind', 'language', 'label', 'mode'])) ||
      !values(audioTrack, ['enabled'])
    ) {
      return null;
    }
    const language = track?.language,
      label = track?.label;
    if (
      (!noCaptions &&
        (track.kind !== 'subtitles' ||
          track.mode !== 'showing' ||
          typeof language !== 'string' ||
          !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language) ||
          typeof label !== 'string' ||
          !label.trim() ||
          label.length > 256 ||
          node.parentElement !== video ||
          node.track !== track ||
          node.getAttribute('src') !== 'data:,WEBVTT' ||
          node.kind !== 'subtitles' ||
          node.srclang !== language ||
          node.label !== label ||
          node.attributes.length > 8)) ||
      audioTrack.enabled !== true ||
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > (purpose === 'presentation' ? 3600 : 60)
    ) {
      return null;
    }
    const attributes = node ? Array.from(node.attributes, ({ name, value }) => [name, value]) : [];
    const metadataShape = (metadata) => {
      if (!metadata || typeof metadata !== 'object') {
        return null;
      }
      const keys = Reflect.ownKeys(metadata);
      if (keys.length > 16 || (!keys.includes('captionInsets') && 'captionInsets' in metadata)) {
        return null;
      }
      const fields = [];
      for (const key of keys) {
        const field = Object.getOwnPropertyDescriptor(metadata, key);
        if (!field || !Object.hasOwn(field, 'value')) {
          return null;
        }
        // The SDK replaces this presentation field without changing captions.
        if (key !== 'captionInsets') {
          fields.push([key, field.value, field.enumerable, field.configurable, field.writable]);
        }
      }
      return { prototype: Object.getPrototypeOf(metadata), fields };
    };
    const sameMetadata = (left, right) =>
      left.prototype === right.prototype &&
      left.fields.length === right.fields.length &&
      left.fields.every(([key, ...values]) => {
        const next = right.fields.find(([name]) => name === key);
        return next && values.every((value, index) => Object.is(value, next[index + 1]));
      });
    let metadata, entries, record;
    const role = {
      purpose,
      track,
      node,
      language,
      label,
      duration,
      nativeCurrent() {
        return (
          video.textTracks === tracks &&
          tracks.length === count &&
          video.querySelectorAll('track').length === count &&
          (noCaptions ||
            (tracks[0] === track &&
              node.parentElement === video &&
              node.track === track &&
              node.attributes.length === attributes.length &&
              attributes.every(([name, value]) => node.getAttribute(name) === value) &&
              values(track, ['kind', 'language', 'label', 'mode']) &&
              track.kind === 'subtitles' &&
              track.language === language &&
              track.label === label &&
              track.mode === 'showing')) &&
          (purpose !== 'presentation' || video.loop === false) &&
          video.duration === duration &&
          video.audioTracks === audio &&
          audio.length === 1 &&
          audio[0] === audioTrack &&
          values(audioTrack, ['enabled']) &&
          audioTrack.enabled === true
        );
      },
      sdkCurrent(state) {
        const nextMetadata = own(state, 'textTracks'),
          nextShape = metadataShape(nextMetadata),
          nextEntries = own(nextMetadata, 'tracks'),
          nextRecord = noCaptions ? null : own(nextEntries, '0');
        if (
          !nextShape ||
          !Array.isArray(nextEntries) ||
          own(nextEntries, 'length') !== count ||
          (purpose === 'presentation' && !relayClear(nextMetadata)) ||
          (!noCaptions &&
            (!nextRecord ||
              Reflect.ownKeys(nextRecord).length !== 4 ||
              own(nextRecord, 'id') !== 0 ||
              own(nextRecord, 'kind') !== 'subtitles' ||
              own(nextRecord, 'language') !== language ||
              own(nextRecord, 'label') !== label))
        ) {
          return false;
        }
        if (!entries) {
          metadata = nextShape;
          entries = nextEntries;
          record = nextRecord;
        }
        return (
          sameMetadata(metadata, nextShape) && entries === nextEntries && record === nextRecord
        );
      },
    };
    return role.nativeCurrent() ? role : null;
  }

  function nativeSafe(
    video,
    doc,
    originalUrl,
    identityOnly = false,
    sourceBinding = null,
    captionRole = null,
    readyFloor = 2
  ) {
    const captionCurrent = !captionRole || captionRole.nativeCurrent();
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
      // A retained producer seek can temporarily drop decoded readiness.
      // Lower readiness still requires every full capability check below.
      video.readyState >= (identityOnly ? 1 : readyFloor) &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      Number.isFinite(video.currentTime) &&
      !video.srcObject &&
      (identityOnly ||
        (!video.mediaKeys &&
          !video.webkitKeys &&
          (captionRole
            ? captionCurrent
            : video.textTracks?.length === 0 && video.querySelectorAll('track').length === 0) &&
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

  function fullscreenBoundary(video, binding, companion, current) {
    const doc = video.ownerDocument;
    const root = doc.documentElement;
    const url = doc.URL;
    const controller = own(binding.sdk, 'controller');
    const data = (object, key) => {
      const value = own(object, key);
      if (object && !Object.hasOwn(object, key) && key in Object(object)) {
        throw Error('Inherited group data');
      }
      return value;
    };
    const method = (object, key) => {
      const seen = new Set();
      for (let depth = 0; object && depth < 4; depth++, object = Object.getPrototypeOf(object)) {
        if (seen.has(object)) {
          throw Error('Group prototype cycle');
        }
        seen.add(object);
        if (Object.getOwnPropertyDescriptor(object, key)) {
          return own(object, key);
        }
      }
    };
    const read = () => {
      const reads = [],
        maps = [],
        fibers = new Set(),
        registries = new Set();
      let contexts = 0,
        entriesRead = 0,
        found;
      const capture = (object, key) => {
        const value = data(object, key);
        reads.push([object, key, value]);
        return value;
      };
      if (
        capture(binding.sdk, 'controller') !== controller ||
        capture(controller, 'api') !== binding.api ||
        capture(binding.api, 'getMediaElement') !== binding.getMediaElement
      ) {
        return null;
      }
      for (const node of new Set([video.parentElement, binding.scope])) {
        const keys = Object.getOwnPropertyNames(node);
        if (keys.length > 64) {
          return null;
        }
        for (const key of keys.filter((key) => key.startsWith('__reactFiber$'))) {
          let fiber = capture(node, key);
          const path = new Set();
          while (fiber) {
            if (path.has(fiber)) {
              throw Error('Group fiber budget');
            }
            path.add(fiber);
            if (fibers.has(fiber)) {
              break;
            }
            if (fibers.size >= 24) {
              break;
            }
            fibers.add(fiber);
            let context = capture(capture(fiber, 'dependencies'), 'firstContext');
            const seen = new Set();
            while (context) {
              if (seen.has(context) || ++contexts > 64) {
                throw Error('Group context budget');
              }
              seen.add(context);
              const value = capture(context, 'memoizedValue');
              const registry = capture(value, 'registry');
              if (registry !== undefined && !registries.has(registry)) {
                registries.add(registry);
                const entries = capture(registry, 'entries');
                const notifyPlay = method(registry, 'notifyPlay');
                const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(
                  entries
                );
                if (typeof notifyPlay !== 'function' || size > 32 || entriesRead + size > 32) {
                  return null;
                }
                const rows = [];
                for (const [id, entry] of Map.prototype.entries.call(entries)) {
                  if (++entriesRead > 32) {
                    return null;
                  }
                  rows.push([id, entry]);
                  const entryController = capture(entry, 'controller');
                  const element = capture(entry, 'element');
                  const instanceId = capture(entry, 'instanceId');
                  const api = capture(entryController, 'api');
                  if (
                    typeof id !== 'string' ||
                    !id ||
                    id.length > 256 ||
                    instanceId !== id ||
                    (api === binding.api && entryController !== controller) ||
                    (element instanceof doc.defaultView.HTMLElement &&
                      element.contains(video) &&
                      entryController !== controller)
                  ) {
                    return null;
                  }
                  if (entryController === controller) {
                    if (found || api !== binding.api) {
                      return null;
                    }
                    found = { registry, entries, entry, id, notifyPlay, element };
                  }
                }
                maps.push([entries, size, rows]);
              }
              context = capture(context, 'next');
            }
            fiber = capture(fiber, 'return');
          }
        }
      }
      if (!found) {
        return null;
      }
      const { element } = found;
      const domCurrent = () =>
        video.ownerDocument === doc &&
        doc.documentElement === root &&
        doc.URL === url &&
        element instanceof doc.defaultView.HTMLElement &&
        element !== video &&
        element !== companion &&
        element !== doc.body &&
        element !== root &&
        element.ownerDocument === doc &&
        element.isConnected &&
        element.contains(video) &&
        mediaScopeSafe(element, video, companion, false);
      const stable = () =>
        reads.every(([object, key, value]) => data(object, key) === value) &&
        maps.every(
          ([entries, size, rows]) =>
            Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(entries) === size &&
            rows.every(([id, entry]) => Map.prototype.get.call(entries, id) === entry)
        ) &&
        method(found.registry, 'notifyPlay') === found.notifyPlay &&
        domCurrent();
      return { ...found, stable, parent: element.parentNode, originalParent: video.parentNode };
    };
    const initial = read();
    if (!initial || !current() || !initial.stable()) {
      return null;
    }
    const valid = () => {
      try {
        if (!current()) {
          return false;
        }
        const next = read();
        return Boolean(
          next &&
          [
            'registry',
            'entries',
            'entry',
            'id',
            'notifyPlay',
            'element',
            'parent',
            'originalParent',
          ].every((key) => next[key] === initial[key]) &&
          current() &&
          next.stable()
        );
      } catch {
        return false;
      }
    };
    return {
      element: initial.element,
      current: valid,
      activate() {
        try {
          if (!valid()) {
            return false;
          }
          initial.notifyPlay.call(initial.registry, initial.id);
          return valid();
        } catch {
          return false;
        }
      },
    };
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
      (download !== undefined &&
        !variants.some((item) => item.content_type === 'video/mp4' && item.url === download)) ||
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

  function inspect(
    video,
    originParent,
    companion,
    identityOnly = false,
    restored = false,
    expectedDuration = video.duration,
    requireUnlimitedLoop = false,
    captionRole = null
  ) {
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
    const captionReads = [],
      captionRoots = [],
      originalParent = video.parentElement;
    const retain = (object, key, value = own(object, key)) => {
      if (captionRole) {
        captionReads.push([object, key, value]);
      }
      return value;
    };
    for (const node of new Set([video.parentElement, scope])) {
      const keys = Object.getOwnPropertyNames(node);
      if (keys.length > 64) {
        return null;
      }
      if (captionRole) {
        captionRoots.push([node, keys.filter((key) => key.startsWith('__reactFiber$'))]);
      }
      for (const key of keys) {
        if (!key.startsWith('__reactFiber$')) {
          continue;
        }
        let fiber = retain(node, key);
        while (fiber && !seen.has(fiber) && fibers.length < 8) {
          seen.add(fiber);
          fibers.push(fiber);
          if (captionRole) {
            retain(fiber, 'memoizedProps');
            retain(fiber, 'memoizedState');
          }
          fiber = retain(fiber, 'return');
        }
      }
    }
    let result, captionCurrent, captionVariants;
    for (const fiber of fibers) {
      let hook = own(fiber, 'memoizedState');
      const hooks = new Set();
      for (let index = 0; hook && index < 16; index++) {
        if (hooks.has(hook)) {
          return null;
        }
        hooks.add(hook);
        const sdk = retain(hook, 'memoizedState');
        const nextHook = captionRole ? retain(hook, 'next') : undefined;
        if (sdk && retain(sdk, 'element') === video) {
          const controller = retain(sdk, 'controller');
          const api = retain(controller, 'api');
          const store = retain(sdk, 'store');
          const getMediaElement = retain(api, 'getMediaElement');
          const getState = retain(api, 'getState');
          const getSnapshot = retain(store, 'getSnapshot');
          const subscribe = retain(store, 'subscribe');
          const seekTo = retain(api, 'seekTo');
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
          const props = retain(fiber, 'memoizedProps');
          const content = retain(props, 'content');
          const selected = retain(state, 'content');
          const sourceUrl = retain(sdk, 'src');
          const source = retain(state, 'source');
          const sourceAsset = asset(sourceUrl, 'hls');
          const contentId = retain(content, 'contentId');
          const post = retain(content, 'sourceId');
          const hostKey = retain(props, 'hostKey');
          const sessionId = retain(retain(state, 'session'), 'id');
          if (
            !sourceAsset ||
            !id(contentId) ||
            sourceAsset.id !== contentId ||
            !id(post) ||
            retain(content, 'tweetId') !== post ||
            hostKey !== `${post}:${contentId}` ||
            retain(props, 'src') !== sourceUrl ||
            retain(content, 'mediaAssetUrl') !== sourceUrl ||
            retain(content, 'contentType') !== 'video' ||
            retain(content, 'sourceType') !== 'tweet' ||
            retain(selected, 'contentId') !== contentId ||
            retain(selected, 'sourceId') !== post ||
            retain(selected, 'tweetId') !== post ||
            retain(selected, 'mediaAssetUrl') !== sourceUrl ||
            retain(selected, 'contentType') !== 'video' ||
            retain(selected, 'sourceType') !== 'tweet' ||
            retain(source, 'kind') !== 'hls' ||
            retain(source, 'src') !== sourceUrl ||
            typeof sessionId !== 'string' ||
            !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(sessionId) ||
            !near(retain(content, 'durationMs') / 1000, expectedDuration) ||
            !near(retain(selected, 'durationMs') / 1000, expectedDuration) ||
            !near(retain(source, 'playlistDurationSec'), expectedDuration) ||
            (!identityOnly && ![props, content, selected, source, state].every(clear))
          ) {
            return null;
          }
          for (const value of [state, snapshot]) {
            const tracks = identityOnly ? null : retain(retain(value, 'textTracks'), 'tracks');
            if (
              (!identityOnly &&
                (!clear(value) ||
                  (captionRole
                    ? !captionRole.sdkCurrent(value)
                    : !Array.isArray(tracks) || tracks.length !== 0))) ||
              retain(retain(value, 'session'), 'id') !== sessionId ||
              retain(retain(value, 'content'), 'contentId') !== contentId ||
              retain(retain(value, 'source'), 'src') !== sourceUrl
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
            ...(captionRole ? { fiber, post } : {}),
          };
          if (result && (result.sdk !== sdk || (captionRole && result.fiber !== fiber))) {
            return null;
          }
          if (identityOnly) {
            result = binding;
            hook = retain(hook, 'next');
            continue;
          }
          const loop = retain(retain(state, 'playback'), 'shouldLoop');
          // SDK shouldLoop can permit only a finite number of remaining repeats.
          if (
            typeof loop !== 'boolean' ||
            (captionRole && loop !== (captionRole.purpose !== 'presentation')) ||
            (requireUnlimitedLoop && loop && !unlimitedLoop(props, content, selected))
          ) {
            return null;
          }
          // Presentation retains the renderer, so an alternative-source catalog is optional.
          if (captionRole?.purpose === 'presentation') {
            const owners = [sdk, controller, state, props, content, selected, source];
            const claim = (object, key) => {
              const value = retain(object, key);
              if (object && !Object.hasOwn(object, key) && key in Object(object)) {
                throw Error('Inherited native metadata');
              }
              return value;
            };
            const optional = (object, key, valid) => {
              const value = claim(object, key);
              return value === undefined || valid(value);
            };
            const sameAsset = (url, kind) => {
              const parsed = asset(url, kind);
              return parsed?.id === contentId && parsed.type === sourceAsset.type;
            };
            const owner = (object) => {
              if (
                !object ||
                typeof object !== 'object' ||
                Array.isArray(object) ||
                !relayClear(object)
              ) {
                return false;
              }
              owners.push(object);
              return (
                [
                  ['src', sourceUrl],
                  ['mediaAssetUrl', sourceUrl],
                  ['hostKey', hostKey],
                  ['contentId', contentId],
                  ['id_str', contentId],
                  ['sourceId', post],
                  ['tweetId', post],
                  ['contentType', 'video'],
                  ['sourceType', 'tweet'],
                  ['content', content],
                ].every(([key, expected]) =>
                  optional(object, key, (value) => value === expected)
                ) &&
                ['durationMs', 'duration_millis'].every((key) =>
                  optional(object, key, (value) => near(value / 1000, expectedDuration))
                ) &&
                ['downloadUrl', 'video_download_url'].every((key) =>
                  optional(object, key, (value) => value === null || sameAsset(value, 'mp4'))
                )
              );
            };
            const child = (object, key) => {
              const value = claim(object, key);
              if (value === undefined || value === null || value === false) {
                return null;
              }
              if (!owner(value)) {
                throw Error('Native metadata contradiction');
              }
              return value;
            };
            for (const ancestor of fibers) {
              const metadata = claim(ancestor, 'memoizedProps');
              const keys = ['poppedOutSource', 'timeRemainingAccessory', 'downloadUrl'];
              const values = keys.map((key) => claim(metadata, key));
              if (!metadata || !keys.some((key) => Object.hasOwn(metadata, key))) {
                continue;
              }
              if (!owner(metadata)) {
                return null;
              }
              const popped = child(metadata, 'poppedOutSource');
              if (popped) {
                child(popped, 'playerProps');
              }
              const accessory = values[1];
              if (accessory !== undefined && accessory !== null && accessory !== false) {
                if (!owner(accessory)) {
                  return null;
                }
                const uiProps = child(accessory, 'props');
                const media = uiProps && child(uiProps, 'media');
                const info = media && child(media, 'video_info');
                const variants = info && claim(info, 'variants');
                if (variants !== undefined && variants !== null && variants !== false) {
                  const count = claim(variants, 'length');
                  if (
                    !Array.isArray(variants) ||
                    !Number.isSafeInteger(count) ||
                    count < 0 ||
                    count > 8
                  ) {
                    return null;
                  }
                  for (let i = 0; i < count; i++) {
                    const item = claim(variants, String(i));
                    if (!owner(item)) {
                      return null;
                    }
                    const type = claim(item, 'content_type'),
                      url = claim(item, 'url');
                    if (
                      type === 'video/mp4'
                        ? !sameAsset(url, 'mp4')
                        : !['application/x-mpegURL', 'application/vnd.apple.mpegurl'].includes(
                            type
                          ) || !sameAsset(url, 'hls')
                    ) {
                      return null;
                    }
                  }
                }
              }
            }
            const doc = video.ownerDocument,
              root = doc.documentElement,
              url = doc.URL;
            const nativeUrl = video.currentSrc || video.src,
              assigned = video.getAttribute('src'),
              poster = video.getAttribute('poster');
            const stable = () =>
              captionReads.every(
                ([object, key, value]) =>
                  own(object, key) === value &&
                  !(object && !Object.hasOwn(object, key) && key in Object(object))
              ) &&
              owners.every(relayClear) &&
              captionRole.nativeCurrent() &&
              captionRole.sdkCurrent(state) &&
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
              own(own(state, 'playback'), 'shouldLoop') === false;
            captionCurrent = () =>
              stable() &&
              getState.call(api) === state &&
              stable() &&
              getSnapshot.call(store) === state &&
              stable() &&
              getMediaElement.call(api) === video &&
              stable();
            if (!captionCurrent()) {
              return null;
            }
            result = { ...binding, loop, scope };
            hook = nextHook;
            continue;
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
          const missingDownload = cached && [modern, supplied].every(noDownload);
          if (cached && download === undefined && !missingDownload) {
            return null;
          }
          let current;
          if (cached || captionRole) {
            // Retain the metadata authority through the last rendition read.
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
              (!missingDownload || [modern, supplied].every(noDownload)) &&
              own(sdk, 'controller') === controller &&
              own(sdk, 'store') === store &&
              own(controller, 'api') === api &&
              own(api, 'getState') === getState &&
              own(api, 'getMediaElement') === getMediaElement &&
              own(api, 'seekTo') === seekTo &&
              own(store, 'getSnapshot') === getSnapshot &&
              own(store, 'subscribe') === subscribe &&
              fields.every(([object, key, value]) => own(object, key) === value) &&
              (!captionRole ||
                cached ||
                (own(own(own(modern, 'timeRemainingAccessory'), 'props'), 'media') === media &&
                  own(media, 'video_info') === info &&
                  own(info, 'variants') === variants &&
                  own(media, 'id_str') === contentId &&
                  own(media, 'video_download_url') === download &&
                  near(own(info, 'duration_millis') / 1000, expectedDuration) &&
                  [media, info].every(relayClear))) &&
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
              (captionRole
                ? captionRole.nativeCurrent()
                : video.textTracks?.length === 0 && video.querySelectorAll('track').length === 0) &&
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
              (!requireUnlimitedLoop || !loop || unlimitedLoop(props, content, selected)) &&
              (captionRole
                ? captionRole.sdkCurrent(state)
                : own(own(state, 'textTracks'), 'tracks')?.length === 0);
            current = () =>
              stable() &&
              getState.call(api) === state &&
              stable() &&
              getSnapshot.call(store) === state &&
              stable() &&
              getMediaElement.call(api) === video &&
              stable();
            if (captionRole) {
              captionCurrent = current;
            }
          }
          if (cached) {
            // Without countdown UI, the same post's renditions live in Relay.
            if (!current()) {
              return null;
            }
            variants = relayVariants(fiber, post, contentId, expectedDuration, download, current);
            if (!variants) {
              return null;
            }
          }
          const variantCount = retain(variants, 'length');
          if (
            !modern ||
            ![modern, popped, supplied].every(clear) ||
            own(popped, 'hostKey') !== hostKey ||
            own(supplied, 'src') !== sourceUrl ||
            own(supplied, 'content') !== content ||
            own(supplied, 'downloadUrl') !== download ||
            (missingDownload && ![modern, supplied].every(noDownload)) ||
            (!cached &&
              (!clear(media) ||
                !clear(info) ||
                own(media, 'id_str') !== contentId ||
                !near(own(info, 'duration_millis') / 1000, expectedDuration) ||
                own(media, 'video_download_url') !== download)) ||
            (!missingDownload &&
              (downloadAsset?.id !== contentId || downloadAsset.type !== sourceAsset.type)) ||
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
            variantEntries.push(retain(variants, String(variant)));
          }
          let matchedHls = false;
          let best;
          for (const item of variantEntries) {
            if (!clear(item)) {
              return null;
            }
            const type = retain(item, 'content_type');
            const url = retain(item, 'url');
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
            const bitrate = retain(item, 'bitrate');
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
            (result && (result.sdk !== sdk || (captionRole && result.fiber !== fiber)))
          ) {
            return null;
          }
          if (captionRole) {
            captionVariants = variantEntries;
          }
          result = {
            ...binding,
            progressiveUrl: best.url,
            cached,
            loop,
            scope,
          };
        }
        hook = captionRole ? nextHook : own(hook, 'next');
      }
    }
    if (
      captionRole &&
      (video.parentElement !== originalParent ||
        !captionRole.nativeCurrent() ||
        captionReads.some(([object, key, value]) => own(object, key) !== value) ||
        captionRoots.some(([node, keys]) => {
          const next = Object.getOwnPropertyNames(node).filter((key) =>
            key.startsWith('__reactFiber$')
          );
          return next.length !== keys.length || next.some((key, index) => key !== keys[index]);
        }) ||
        (captionVariants && !captionVariants.every(clear)) ||
        (captionCurrent && !captionCurrent()))
    ) {
      return null;
    }
    return result;
  }

  function resolvePlayer(
    video,
    originParent,
    { allowSourceChild = false } = {},
    captionRole = null
  ) {
    try {
      const doc = video?.ownerDocument;
      if (!doc) {
        return null;
      }
      const originalUrl = video.currentSrc || video.src;
      // Automatic child-source entry requires the same-post cache route below.
      // Retain the exact node and its representation throughout the session.
      const sourceBinding = sourceChild(video, originalUrl);
      if (!nativeSafe(video, doc, originalUrl, false, sourceBinding, captionRole)) {
        return null;
      }
      const root = doc.documentElement;
      const documentUrl = doc.URL;
      const initial = inspect(
        video,
        originParent,
        undefined,
        false,
        false,
        undefined,
        true,
        captionRole
      );
      if (
        !initial ||
        (sourceBinding && !allowSourceChild && !initial.cached) ||
        !nativeSafe(video, doc, originalUrl, false, sourceBinding, captionRole)
      ) {
        return null;
      }
      const scopeRoot = initial.scope.getRootNode();
      let companion;
      const candidate = {
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
        fullscreenBoundary() {
          try {
            return fullscreenBoundary(video, initial, companion, () => current());
          } catch {
            return null;
          }
        },
        current(allowed) {
          try {
            // Only an already-bound caption producer may be temporarily seeking.
            const readyFloor = captionRole && (companion || captionRole.presentationBound) ? 1 : 2;
            let currentCompanion = companion;
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
                currentCompanion = allowed;
                if (!captionRole) {
                  companion = allowed;
                }
              }
            }
            if (currentCompanion && currentCompanion.ownerDocument !== doc) {
              return false;
            }
            if (
              doc.documentElement !== root ||
              doc.URL !== documentUrl ||
              !nativeSafe(video, doc, originalUrl, false, sourceBinding, captionRole, readyFloor) ||
              initial.scope.getRootNode() !== scopeRoot
            ) {
              return false;
            }
            const next = inspect(
              video,
              originParent,
              currentCompanion,
              false,
              true,
              undefined,
              true,
              captionRole
            );
            const valid = Boolean(
              next &&
              (!captionRole ||
                (nativeSafe(
                  video,
                  doc,
                  originalUrl,
                  false,
                  sourceBinding,
                  captionRole,
                  readyFloor
                ) &&
                  (!currentCompanion ||
                    (currentCompanion.ownerDocument === doc &&
                      (!companion || companion === currentCompanion) &&
                      (companion || !currentCompanion.isConnected))))) &&
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
                ...(captionRole ? ['fiber', 'post'] : []),
              ].every((key) => next[key] === initial[key])
            );
            if (valid && captionRole && !companion) {
              companion = currentCompanion;
            }
            return valid;
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
      const current = candidate.current;
      if (captionRole) {
        const sourceAsset = asset(initial.sourceUrl, 'hls');
        candidate.captionBinding = {
          original: video,
          track: captionRole.track,
          node: captionRole.node,
          hlsUrl: initial.sourceUrl,
          assetType: sourceAsset.type,
          assetId: sourceAsset.id,
          duration: captionRole.duration,
          language: captionRole.language,
          label: captionRole.label,
          isCurrent: (allowed) => current(allowed),
        };
      }
      return candidate;
    } catch {
      return null;
    }
  }

  window.VSC.TwitterPlayer = {
    validateRetainedHls(video, originalUrl, progressiveUrl, originParent, expectedDuration) {
      try {
        const next = inspect(video, originParent, undefined, false, true, expectedDuration);
        return next === undefined
          ? undefined
          : Boolean(
              next &&
              window.VSC.TwitterMediaSource.matchesCurrentPlayerHls(next.sourceUrl, originalUrl) &&
              next.progressiveUrl === progressiveUrl
            );
      } catch {
        return false;
      }
    },
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
        const duration = video.duration,
          post = own(candidate.content, 'sourceId'),
          controller = video.vsc;
        const result = {
          originalUrl,
          progressiveUrl: candidate.progressiveUrl,
          mediaId: candidate.contentId,
          revalidate(expectedReload = false) {
            try {
              const unchanged = () =>
                video.ownerDocument === doc &&
                doc.documentElement === root &&
                doc.URL === documentUrl &&
                video.isConnected &&
                video.vsc === controller &&
                video.getAttribute('src') === candidate.progressiveUrl &&
                (!video.currentSrc || video.currentSrc === candidate.progressiveUrl) &&
                !video.srcObject &&
                !video.mediaKeys &&
                !video.webkitKeys &&
                !(video.audioTracks?.length > 1) &&
                !(video.videoTracks?.length > 1);
              if (!unchanged()) {
                return false;
              }
              const player = video.vsc?.iosPlayer;
              const next = inspect(
                video,
                player?.active ? player.originParent : originParent,
                undefined,
                false,
                true,
                expectedReload && video.readyState < 1 ? duration : video.duration
              );
              return Boolean(
                next &&
                unchanged() &&
                own(next.content, 'sourceId') === post &&
                [
                  'sdk',
                  'api',
                  'store',
                  'getState',
                  'getSnapshot',
                  'getMediaElement',
                  'seekTo',
                  'subscribe',
                  'sourceUrl',
                  'contentId',
                  'sessionId',
                  'progressiveUrl',
                  'loop',
                  'scope',
                ].every((key) => next[key] === candidate[key])
              );
            } catch {
              return false;
            }
          },
        };
        Object.defineProperty(result, 'revalidate', { enumerable: false });
        return result;
      } catch {
        return null;
      }
    },
    resolve(video, originParent, options) {
      return resolvePlayer(video, originParent, options);
    },
    resolveNativePresentation(video, originParent) {
      try {
        if (
          originParent !== undefined &&
          originParent !== null &&
          originParent !== video?.parentNode
        ) {
          return null;
        }
        const role = captionRoleFor(video, 'presentation');
        if (!role) {
          return null;
        }
        const candidate = resolvePlayer(video, null, { allowSourceChild: true }, role);
        const boundary = candidate?.fullscreenBoundary();
        if (!boundary?.current() || !candidate.current()) {
          return null;
        }
        const element = boundary.element,
          parent = element.parentNode,
          originalParent = video.parentNode;
        // This is a retained native renderer certificate, never a transport.
        role.presentationBound = true;
        const current = () => {
          try {
            return Boolean(
              candidate.current() &&
              boundary.current() &&
              candidate.current() &&
              element.parentNode === parent &&
              video.parentNode === originalParent
            );
          } catch {
            return false;
          }
        };
        let subscription = null;
        const presentation = Object.freeze({
          element,
          current,
          activate: current,
          subscribe(callback) {
            if (typeof callback !== 'function' || subscription || !current()) {
              return null;
            }
            const token = {};
            subscription = token;
            let active = true;
            const dispose = candidate.subscribe(() => {
              if (active) {
                try {
                  callback(current());
                } catch {
                  /* A presentation callback must not interrupt the SDK store. */
                }
              }
            });
            const release = () => {
              if (!active) {
                return;
              }
              active = false;
              if (subscription === token) {
                subscription = null;
              }
              dispose?.();
            };
            if (typeof dispose !== 'function' || !current()) {
              release();
              return null;
            }
            return release;
          },
        });
        return current() ? presentation : null;
      } catch {
        return null;
      }
    },
    resolveCaptionedLoop(video, originParent, options) {
      try {
        const role = captionRoleFor(video);
        return role ? resolvePlayer(video, originParent, options, role) : null;
      } catch {
        return null;
      }
    },
  };
})();

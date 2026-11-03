window.VSC = window.VSC || {};

(function () {
  /** Read only the complete, explicit fMP4 chain of a bound short X loop. */
  function createLoopSource(descriptor, runtime = globalThis) {
    const limits = { playlist: 32768, init: 131072, segment: 8388608, total: 8388608 };
    let bound, controller, timer, reader, rejectAbort, externalAbort, captionBrand, captionGroup;
    let closed = false;
    let reason = null;
    let requests = 0;
    let total = 0;
    const fail = (code) => {
      const error = new Error(code);
      error.code = code;
      throw error;
    };
    const cancelReader = () => {
      if (reader) {
        try {
          Promise.resolve(reader.cancel()).catch(() => {});
        } catch {
          /* Release the remaining request context. */
        }
        reader = null;
      }
    };
    const cancel = (code = 'aborted') => {
      if (closed || reason) {
        return;
      }
      reason = code;
      try {
        controller?.abort();
      } catch {
        /* The rejection still ends pending waits. */
      }
      cancelReader();
      const error = new Error(code);
      error.code = code;
      rejectAbort?.(error);
    };
    const current = () => {
      let value = false;
      try {
        value =
          bound.isCurrent() === true &&
          (!bound.captionOwner ||
            (window.VSC.TwitterCaptionPlayback?.isLoopOwner === captionBrand &&
              captionBrand(bound.captionOwner) === true &&
              bound.captionOwner.isCurrent() === true));
      } catch {
        /* A throwing owner has lost authority. */
      }
      return value;
    };
    const verify = () => {
      if (reason || controller?.signal.aborted || bound?.signal?.aborted) {
        cancel(reason || 'aborted');
        fail(reason || 'aborted');
      }
      if (!current()) {
        cancel('source-changed');
        fail('source-changed');
      }
      if (reason || controller?.signal.aborted || bound.signal?.aborted) {
        cancel(reason || 'aborted');
        fail(reason || 'aborted');
      }
    };
    const promise = (async () => {
      const fields = [
        'hlsUrl',
        'progressiveUrl',
        'assetType',
        'assetId',
        'duration',
        'isCurrent',
        'signal',
      ];
      const own = Object.getOwnPropertyDescriptors(descriptor);
      if (Object.hasOwn(own, 'captionOwner')) {
        fields.push('captionOwner');
      }
      if (
        Reflect.ownKeys(own).length !== fields.length ||
        fields.some((key) => !Object.hasOwn(own, key) || !Object.hasOwn(own[key], 'value'))
      ) {
        fail('descriptor');
      }
      bound = Object.fromEntries(fields.map((key) => [key, own[key].value]));
      if (Object.hasOwn(bound, 'captionOwner')) {
        captionBrand = window.VSC.TwitterCaptionPlayback?.isLoopOwner;
        if (typeof captionBrand !== 'function' || captionBrand(bound.captionOwner) !== true) {
          fail('caption-owner');
        }
      }
      if (
        !['amplify_video', 'ext_tw_video'].includes(bound.assetType) ||
        typeof bound.assetId !== 'string' ||
        !/^[1-9]\d{0,31}$/.test(bound.assetId) ||
        !Number.isFinite(bound.duration) ||
        bound.duration <= 0 ||
        bound.duration > 60 ||
        typeof bound.isCurrent !== 'function' ||
        (bound.signal !== null &&
          bound.signal !== undefined &&
          (typeof bound.signal.addEventListener !== 'function' ||
            typeof bound.signal.removeEventListener !== 'function'))
      ) {
        fail('descriptor');
      }
      controller = new runtime.AbortController();
      const aborted = new Promise((_resolve, reject) => {
        rejectAbort = reject;
      });
      aborted.catch(() => {});
      timer = runtime.setTimeout(() => cancel('deadline'), 12000);
      externalAbort = () => cancel('aborted');
      bound.signal?.addEventListener('abort', externalAbort, { once: true });
      verify();
      const awaitCurrent = async (callback) => {
        verify();
        const pending = Promise.resolve(callback());
        pending.catch(() => {});
        verify();
        const value = await Promise.race([pending, aborted]);
        verify();
        return value;
      };
      const uri = (value, parent, kind) => {
        if (
          typeof value !== 'string' ||
          !value ||
          value.length > 4096 ||
          /[\s'"\\#]/u.test(value)
        ) {
          fail('uri');
        }
        const authority = /^(?:https:)?\/\/([^/?#]*)/i.exec(value)?.[1];
        if (authority && /[:@]/.test(authority)) {
          fail('uri');
        }
        let url;
        try {
          url = new runtime.URL(value, parent);
        } catch {
          fail('uri');
        }
        const suffix = { playlist: /\.m3u8$/i, init: /\.mp4$/i, segment: /\.m4s$/i };
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'video.twimg.com' ||
          url.port ||
          url.username ||
          url.password ||
          url.hash ||
          /%|[^A-Za-z0-9_./-]/.test(url.pathname) ||
          !url.pathname.startsWith(`/${bound.assetType}/${bound.assetId}/`) ||
          !suffix[kind].test(url.pathname)
        ) {
          fail('uri');
        }
        return url.href;
      };
      const read = async (url, kind) => {
        verify();
        if (++requests > 37) {
          fail('request-limit');
        }
        const response = await awaitCurrent(() =>
          runtime.fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            redirect: 'error',
            cache: 'default',
            signal: controller.signal,
          })
        );
        if (
          response.status !== 200 ||
          response.ok !== true ||
          response.redirected === true ||
          response.type === 'opaqueredirect' ||
          response.url !== url ||
          typeof response.body?.getReader !== 'function'
        ) {
          fail('response');
        }
        verify();
        reader = response.body.getReader();
        verify();
        const chunks = [];
        let size = 0;
        let ended = false;
        try {
          for (let count = 0; count < 2048; count++) {
            const chunk = await awaitCurrent(() => reader.read());
            if (chunk.done === true) {
              ended = true;
              break;
            }
            if (chunk.done !== false || !(chunk.value instanceof Uint8Array)) {
              fail('reader');
            }
            size += chunk.value.byteLength;
            total += chunk.value.byteLength;
            if (size > limits[kind] || total > limits.total) {
              fail('bytes');
            }
            chunks.push(chunk.value.slice());
            verify();
          }
          if (!ended || !size) {
            fail(ended ? 'empty' : 'chunks');
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          verify();
          return bytes;
        } finally {
          cancelReader();
        }
      };
      const playlist = async (url, attest = false) => {
        const bytes = await read(url, 'playlist');
        verify();
        const decoder = new runtime.TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        if (!decoder.fatal || !decoder.ignoreBOM) {
          fail('encoding');
        }
        const text = decoder.decode(bytes);
        verify();
        if (attest) {
          captionGroup = bound.captionOwner.attestsMaster(url, text);
          if (typeof captionGroup !== 'string' || !captionGroup || captionGroup.length > 128) {
            fail('caption-master');
          }
          verify();
        }
        for (let index = 0; index < text.length; index++) {
          const code = text.charCodeAt(index);
          if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            fail('encoding');
          }
        }
        const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/);
        if (
          lines.length > 1024 ||
          lines.some((line) => line.length > 4096 || line.includes('\r')) ||
          lines.shift() !== '#EXTM3U'
        ) {
          fail('playlist');
        }
        return lines.map((line) => line.trim()).filter(Boolean);
      };
      const attributes = (text) => {
        const result = Object.create(null);
        let offset = 0;
        if (!text || text.endsWith(',')) {
          fail('attributes');
        }
        while (offset < text.length) {
          const match = /^([A-Z0-9-]+)=((?:"[^"\r\n]*")|[^,\s]+)(?:,|$)/.exec(text.slice(offset));
          if (!match || Object.hasOwn(result, match[1])) {
            fail('attributes');
          }
          result[match[1]] = match[2].startsWith('"') ? match[2].slice(1, -1) : match[2];
          offset += match[0].length;
        }
        return result;
      };
      const positive = (text) => {
        if (typeof text !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(text)) {
          fail('number');
        }
        const value = Number(text);
        if (!Number.isFinite(value) || value <= 0) {
          fail('number');
        }
        return value;
      };
      const dimensions = (value) => {
        const match = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/.exec(value || '');
        if (
          !match ||
          Math.min(Number(match[1]), Number(match[2])) > 720 ||
          Math.max(Number(match[1]), Number(match[2])) > 1280
        ) {
          fail('tracks');
        }
        return match[0];
      };
      const progressiveUrl = uri(bound.progressiveUrl, undefined, 'init');
      const progressivePath = new runtime.URL(progressiveUrl).pathname;
      const suppliedDimensions = progressivePath
        .split('/')
        .filter((part) => /^\d+x\d+$/.test(part));
      if (
        progressiveUrl !== bound.progressiveUrl ||
        (!progressivePath.startsWith(`/${bound.assetType}/${bound.assetId}/vid/`) &&
          !progressivePath.startsWith(`/${bound.assetType}/${bound.assetId}/pu/vid/`)) ||
        suppliedDimensions.length !== 1
      ) {
        fail('uri');
      }
      const expectedDimensions = dimensions(suppliedDimensions[0]);
      const masterUrl = uri(bound.hlsUrl, undefined, 'playlist');
      if (masterUrl !== bound.hlsUrl) {
        fail('uri');
      }
      if (bound.captionOwner) {
        await awaitCurrent(() => bound.captionOwner.promise);
      }
      const master = await playlist(masterUrl, Boolean(bound.captionOwner));
      verify();
      const audios = [],
        streams = [];
      let version = false,
        independent = false,
        pending,
        subtitles;
      for (const line of master) {
        if (pending && line.startsWith('#')) {
          fail('layout');
        }
        if (line === '#EXT-X-VERSION:6' || line === '#EXT-X-VERSION:7') {
          if (version) {
            fail('duplicate');
          }
          version = true;
        } else if (line === '#EXT-X-INDEPENDENT-SEGMENTS') {
          if (independent) {
            fail('duplicate');
          }
          independent = true;
        } else if (line.startsWith('#EXT-X-MEDIA:')) {
          const audio = attributes(line.slice(13));
          if (audio.TYPE === 'SUBTITLES') {
            const allowed = [
              'TYPE',
              'GROUP-ID',
              'NAME',
              'LANGUAGE',
              'DEFAULT',
              'AUTOSELECT',
              'FORCED',
              'URI',
              'CHARACTERISTICS',
            ];
            if (
              !captionGroup ||
              subtitles ||
              audio['GROUP-ID'] !== captionGroup ||
              !audio.NAME ||
              !audio.LANGUAGE ||
              Object.keys(audio).some((key) => !allowed.includes(key))
            ) {
              fail('tracks');
            }
            subtitles = uri(audio.URI, masterUrl, 'playlist');
            if (subtitles === masterUrl) {
              fail('ambiguous');
            }
            continue;
          }
          if (audios.length >= 8) {
            fail('ambiguous');
          }
          const allowed = [
            'TYPE',
            'GROUP-ID',
            'NAME',
            'AUTOSELECT',
            'URI',
            'LANGUAGE',
            'DEFAULT',
            'CHANNELS',
          ];
          if (
            audio.TYPE !== 'AUDIO' ||
            !audio['GROUP-ID'] ||
            audio['GROUP-ID'].length > 128 ||
            !audio.NAME?.trim() ||
            audio.NAME.length > 256 ||
            audio.AUTOSELECT !== 'YES' ||
            (audio.DEFAULT !== undefined && !['YES', 'NO'].includes(audio.DEFAULT)) ||
            (audio.LANGUAGE !== undefined &&
              (audio.LANGUAGE.length > 128 ||
                !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(audio.LANGUAGE))) ||
            (audio.CHANNELS !== undefined && !/^[1-8]$/.test(audio.CHANNELS)) ||
            Object.keys(audio).some((key) => !allowed.includes(key))
          ) {
            fail('tracks');
          }
          audio.url = uri(audio.URI, masterUrl, 'playlist');
          audios.push(audio);
        } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
          if (streams.length >= 8) {
            fail('ambiguous');
          }
          pending = attributes(line.slice(18));
        } else if (!line.startsWith('#') && pending) {
          pending.url = uri(line, masterUrl, 'playlist');
          streams.push(pending);
          pending = undefined;
        } else {
          fail('unsupported-playlist');
        }
      }
      if (
        !version ||
        !independent ||
        !audios.length ||
        audios.length !== streams.length ||
        Boolean(subtitles) !== Boolean(captionGroup) ||
        pending
      ) {
        fail('ambiguous');
      }
      const allowedStream = [
        'BANDWIDTH',
        'AVERAGE-BANDWIDTH',
        'RESOLUTION',
        'CODECS',
        'AUDIO',
        'CLOSED-CAPTIONS',
        ...(captionGroup ? ['SUBTITLES'] : []),
        'url',
      ];
      const urls = new Set(subtitles ? [masterUrl, subtitles] : [masterUrl]);
      const groups = new Map();
      const semantics = ['NAME', 'AUTOSELECT', 'LANGUAGE', 'DEFAULT', 'CHANNELS'];
      for (const audio of audios) {
        if (
          groups.has(audio['GROUP-ID']) ||
          urls.has(audio.url) ||
          semantics.some((key) => audio[key] !== audios[0][key])
        ) {
          fail('ambiguous');
        }
        groups.set(audio['GROUP-ID'], audio);
        urls.add(audio.url);
      }
      const resolutions = new Set(),
        usedGroups = new Set();
      for (const stream of streams) {
        const codecs = stream.CODECS?.split(',');
        const avc = codecs?.find((codec) => /^avc1\.[0-9a-f]{6}$/i.test(codec));
        if (
          !avc ||
          codecs.length !== 2 ||
          !codecs.includes('mp4a.40.2') ||
          !groups.has(stream.AUDIO) ||
          (captionGroup && stream.SUBTITLES !== captionGroup) ||
          (stream['CLOSED-CAPTIONS'] !== undefined && stream['CLOSED-CAPTIONS'] !== 'NONE') ||
          Object.keys(stream).some((key) => !allowedStream.includes(key))
        ) {
          fail('tracks');
        }
        const resolution = dimensions(stream.RESOLUTION);
        positive(stream.BANDWIDTH);
        if (stream['AVERAGE-BANDWIDTH'] !== undefined) {
          positive(stream['AVERAGE-BANDWIDTH']);
        }
        if (resolutions.has(resolution) || usedGroups.has(stream.AUDIO) || urls.has(stream.url)) {
          fail('ambiguous');
        }
        resolutions.add(resolution);
        usedGroups.add(stream.AUDIO);
        urls.add(stream.url);
      }
      const selected = streams.filter((stream) => stream.RESOLUTION === expectedDimensions);
      if (selected.length !== 1) {
        fail('ambiguous');
      }
      const stream = selected[0];
      const avc = stream.CODECS.split(',').find((codec) => /^avc1\.[0-9a-f]{6}$/i.test(codec));
      const videoUrl = stream.url;
      const audioUrl = groups.get(stream.AUDIO).url;
      const mediaPlaylist = async (url) => {
        const input = await playlist(url);
        verify();
        const seen = new Set();
        const segments = [];
        let init,
          duration = 0,
          nextDuration,
          target,
          end = false;
        for (const line of input) {
          if (end) {
            fail('layout');
          }
          if (nextDuration !== undefined) {
            if (line.startsWith('#')) {
              fail('layout');
            }
            segments.push({ url: uri(line, url, 'segment'), duration: nextDuration });
            duration += nextDuration;
            nextDuration = undefined;
            if (segments.length > 16 || duration > 60.1) {
              fail('duration');
            }
            continue;
          }
          if (line.startsWith('#EXTINF:')) {
            const match = /^#EXTINF:([^,]+),$/.exec(line);
            if (!init || !match) {
              fail('layout');
            }
            nextDuration = positive(match[1]);
          } else if (line === '#EXT-X-ENDLIST') {
            end = true;
          } else if (line.startsWith('#EXT-X-MAP:')) {
            if (init || segments.length) {
              fail('duplicate');
            }
            const map = attributes(line.slice(11));
            if (Object.keys(map).length !== 1 || !map.URI) {
              fail('unsupported-playlist');
            }
            init = uri(map.URI, url, 'init');
          } else {
            const match =
              /^#EXT-X-(VERSION|MEDIA-SEQUENCE|TARGETDURATION|PLAYLIST-TYPE):(.+)$/.exec(line);
            if (!match || seen.has(match[1]) || segments.length) {
              fail('unsupported-playlist');
            }
            seen.add(match[1]);
            if (match[1] === 'VERSION' && !['6', '7'].includes(match[2])) {
              fail('unsupported-playlist');
            }
            if (match[1] === 'MEDIA-SEQUENCE' && match[2] !== '0') {
              fail('unsupported-playlist');
            }
            if (match[1] === 'PLAYLIST-TYPE' && match[2] !== 'VOD') {
              fail('unsupported-playlist');
            }
            if (match[1] === 'TARGETDURATION') {
              if (!/^[1-9]\d?$/.test(match[2])) {
                fail('duration');
              }
              target = positive(match[2]);
            }
          }
        }
        if (
          !end ||
          !init ||
          !segments.length ||
          nextDuration !== undefined ||
          !['VERSION', 'MEDIA-SEQUENCE', 'TARGETDURATION', 'PLAYLIST-TYPE'].every((tag) =>
            seen.has(tag)
          ) ||
          segments.some((segment) => segment.duration > target + 0.1) ||
          Math.abs(duration - bound.duration) > 0.1
        ) {
          fail('duration');
        }
        if (new Set(segments.map((segment) => segment.url)).size !== segments.length) {
          fail('duplicate');
        }
        return { init, segments, duration };
      };
      const video = await mediaPlaylist(videoUrl);
      const audioMedia = await mediaPlaylist(audioUrl);
      verify();
      if (Math.abs(video.duration - audioMedia.duration) > 0.1) {
        fail('duration');
      }
      const loadTrack = async (definition, mime) => {
        const init = await read(definition.init, 'init');
        verify();
        const segments = [];
        for (const segment of definition.segments) {
          segments.push(await read(segment.url, 'segment'));
          verify();
        }
        return { mime, init, segments };
      };
      const videoTrack = await loadTrack(video, `video/mp4; codecs="${avc}"`);
      const audioTrack = await loadTrack(audioMedia, 'audio/mp4; codecs="mp4a.40.2"');
      verify();
      return {
        video: videoTrack,
        audio: audioTrack,
        manifestDurations: { video: video.duration, audio: audioMedia.duration },
      };
    })()
      .catch((error) => {
        cancel(error?.code || 'unavailable');
        throw error;
      })
      .finally(() => {
        cancelReader();
        try {
          if (timer !== undefined) {
            runtime.clearTimeout(timer);
          }
        } catch {
          /* Continue cleanup. */
        }
        try {
          bound?.signal?.removeEventListener('abort', externalAbort);
        } catch {
          /* Continue cleanup. */
        }
        try {
          controller?.abort();
        } catch {
          /* Release completed requests. */
        }
      })
      .then(
        (result) => {
          try {
            if (reason) {
              fail(reason);
            }
            if (!current()) {
              fail('source-changed');
            }
            if (reason) {
              fail(reason);
            }
            if (bound.signal?.aborted) {
              fail('aborted');
            }
            if (reason) {
              fail(reason);
            }
            return result;
          } finally {
            closed = true;
          }
        },
        (error) => {
          closed = true;
          throw error;
        }
      );
    return { promise, cancel: () => cancel('aborted') };
  }

  window.VSC.TwitterLoopSource = { create: createLoopSource };
})();

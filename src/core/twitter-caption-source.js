window.VSC = window.VSC || {};

(function () {
  /** Fetch only the explicit finite caption chain of an already-bound X asset. */
  function createCaptionSource(descriptor, runtime = globalThis) {
    const limits = { master: 32768, subtitle: 16384, vtt: 65536, total: 114688 };
    let bound, controller, timer, reader, rejectAbort, externalAbort;
    let closed = false;
    let reason = null;
    let total = 0;
    let requests = 0;
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
          /* Best effort. */
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
        /* The rejection still terminates waits. */
      }
      cancelReader();
      const error = new Error(code);
      error.code = code;
      rejectAbort?.(error);
    };
    const verify = () => {
      if (reason || controller?.signal.aborted || bound?.signal?.aborted) {
        cancel(reason || 'aborted');
        fail(reason || 'aborted');
      }
      let current = false;
      try {
        current = bound.isCurrent() === true;
      } catch {
        /* Lost authority. */
      }
      if (!current) {
        cancel('source-changed');
        fail('source-changed');
      }
      if (reason || controller?.signal.aborted || bound.signal?.aborted) {
        cancel(reason || 'aborted');
        fail(reason || 'aborted');
      }
    };
    const promise = (async () => {
      // Never invoke descriptor accessors or consult SDK/page metadata here.
      const fields = ['hlsUrl', 'duration', 'assetType', 'assetId', 'isCurrent', 'signal'];
      const own = Object.getOwnPropertyDescriptors(descriptor);
      if (
        Reflect.ownKeys(own).length !== fields.length ||
        fields.some((key) => !Object.hasOwn(own, key) || !Object.hasOwn(own[key], 'value'))
      ) {
        fail('descriptor');
      }
      bound = Object.fromEntries(fields.map((key) => [key, own[key].value]));
      if (
        !['amplify_video', 'ext_tw_video'].includes(bound.assetType) ||
        typeof bound.assetId !== 'string' ||
        !/^[1-9]\d{0,31}$/.test(bound.assetId) ||
        !Number.isFinite(bound.duration) ||
        bound.duration <= 0 ||
        bound.duration > 3600 ||
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
      timer = runtime.setTimeout(() => cancel('deadline'), 6000);
      externalAbort = () => cancel('aborted');
      bound.signal?.addEventListener('abort', externalAbort, { once: true });
      verify();
      const awaitCurrent = async (callback) => {
        verify();
        const pending = Promise.resolve(callback());
        // A callback may lose authority and reject in the same stack. Consume
        // that rejection even when the following identity check ends this wait.
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
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'video.twimg.com' ||
          url.port ||
          url.username ||
          url.password ||
          url.hash ||
          /%|[^A-Za-z0-9_./-]/.test(url.pathname)
        ) {
          fail('uri');
        }
        const prefix = `${bound.assetType}/${bound.assetId}/`;
        const path = url.pathname.slice(1);
        if (kind === 'vtt') {
          if (
            !(path.startsWith(prefix) || path.startsWith(`subtitles/${prefix}`)) ||
            !/\.vtt$/i.test(path)
          ) {
            fail('uri');
          }
        } else if (!path.startsWith(prefix) || !/\.m3u8$/i.test(path)) {
          fail('uri');
        }
        return url.href;
      };
      const read = async (url, kind) => {
        verify();
        if (++requests > 3) {
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
        verify();
        if (
          response.status !== 200 ||
          response.ok !== true ||
          response.redirected === true ||
          response.type === 'opaqueredirect' ||
          response.url !== url
        ) {
          fail('response');
        }
        if (typeof response.body?.getReader !== 'function') {
          fail('reader');
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
            verify();
            if (chunk.done === true) {
              ended = true;
              break;
            }
            if (!(chunk.value instanceof Uint8Array) || chunk.done !== false) {
              fail('reader');
            }
            size += chunk.value.byteLength;
            total += chunk.value.byteLength;
            if (size > limits[kind] || total > limits.total) {
              fail('bytes');
            }
            // Copy only accepted bytes; no retained oversized response buffer.
            chunks.push(chunk.value.slice());
            verify();
          }
          if (!ended) {
            fail('chunks');
          }
          const bytes = new Uint8Array(size);
          let at = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.length;
          }
          verify();
          const decoder = new runtime.TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
          });
          if (decoder.fatal !== true || decoder.ignoreBOM !== true) {
            fail('encoding');
          }
          verify();
          const text = decoder.decode(bytes);
          verify();
          for (let index = 0; index < text.length; index++) {
            const code = text.charCodeAt(index);
            if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
              fail('encoding');
            }
          }
          return { bytes, text };
        } finally {
          cancelReader();
        }
      };
      const lines = (text) => {
        const result = text.replace(/^\uFEFF/u, '').split(/\r?\n/);
        if (
          result.length > 4096 ||
          result.some((line) => line.length > 4096 || line.includes('\r'))
        ) {
          fail('layout');
        }
        return result;
      };
      const attributes = (text) => {
        if (!text || text.endsWith(',')) {
          fail('attributes');
        }
        const result = Object.create(null);
        let at = 0;
        while (at < text.length) {
          const match = /^\s*([A-Z0-9-]+)=((?:"[^"\r\n]*")|[^,\s]+)\s*(?:,|$)/.exec(text.slice(at));
          if (!match || Object.hasOwn(result, match[1])) {
            fail('attributes');
          }
          result[match[1]] = match[2].startsWith('"') ? match[2].slice(1, -1) : match[2];
          at += match[0].length;
        }
        return result;
      };
      const veto = (line) => {
        if (
          /^#EXT-X-(?:(?:SESSION-)?KEY|MAP|BYTERANGE|PART|PRELOAD-HINT|DISCONTINUITY|SKIP|DEFINE|START)(?::|$)/.test(
            line
          )
        ) {
          fail('unsupported-playlist');
        }
      };
      const master = (text, parent) => {
        const input = lines(text);
        if (input.shift() !== '#EXTM3U') {
          fail('playlist');
        }
        const subtitles = [],
          streams = [];
        const audio = new Map();
        let audioChoice;
        let pending = false;
        for (const raw of input) {
          const line = raw.trim();
          if (!line) {
            continue;
          }
          veto(line);
          if (line.startsWith('#EXT-X-MEDIA:')) {
            if (pending) {
              fail('layout');
            }
            const value = attributes(line.slice(13));
            if (value.TYPE === 'CLOSED-CAPTIONS') {
              fail('captions');
            }
            if (value.TYPE === 'SUBTITLES') {
              subtitles.push(value);
            } else if (value.TYPE === 'AUDIO') {
              // RFC 8216 §4.3.4.1.1: equivalent singleton groups can encode
              // the same audio choice. Do not accept alternate selections.
              const allowed = [
                'TYPE',
                'GROUP-ID',
                'NAME',
                'LANGUAGE',
                'DEFAULT',
                'AUTOSELECT',
                'URI',
                'CHANNELS',
              ];
              const group = value['GROUP-ID'];
              if (
                !group ||
                group.length > 128 ||
                audio.has(group) ||
                !value.NAME?.trim() ||
                value.NAME.length > 256 ||
                value.AUTOSELECT !== 'YES' ||
                (value.LANGUAGE !== undefined &&
                  (value.LANGUAGE.length > 128 ||
                    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.LANGUAGE))) ||
                (value.DEFAULT !== undefined && !['YES', 'NO'].includes(value.DEFAULT)) ||
                (value.CHANNELS !== undefined &&
                  (!/^[1-9]\d?$/.test(value.CHANNELS) || Number(value.CHANNELS) > 64)) ||
                Object.keys(value).some((key) => !allowed.includes(key))
              ) {
                fail('captions');
              }
              uri(value.URI, parent, 'master');
              const choice = [
                value.NAME,
                value.LANGUAGE,
                value.DEFAULT,
                value.AUTOSELECT,
                value.CHANNELS,
              ];
              if (audioChoice && !choice.every((field, index) => field === audioChoice[index])) {
                fail('ambiguous');
              }
              audioChoice = choice;
              audio.set(group, true);
            } else {
              fail('captions');
            }
          } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
            if (pending) {
              fail('layout');
            }
            streams.push(attributes(line.slice(18)));
            pending = true;
          } else if (!line.startsWith('#')) {
            if (!pending) {
              fail('layout');
            }
            uri(line, parent, 'master');
            pending = false;
          } else if (!/^#EXT-X-(?:VERSION:\d+|INDEPENDENT-SEGMENTS)$/.test(line)) {
            fail('unsupported-playlist');
          }
          if (streams.length > 64 || subtitles.length > 1 || audio.size > 64) {
            fail('ambiguous');
          }
        }
        if (pending || subtitles.length !== 1 || !streams.length) {
          fail('ambiguous');
        }
        const selected = subtitles[0];
        if (
          !selected['GROUP-ID'] ||
          selected['GROUP-ID'].length > 128 ||
          !selected.LANGUAGE ||
          !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(selected.LANGUAGE) ||
          selected.LANGUAGE.length > 128 ||
          !selected.NAME ||
          selected.NAME.length > 256 ||
          !streams.every(
            (stream) =>
              (audio.size ? audio.has(stream.AUDIO) : !Object.hasOwn(stream, 'AUDIO')) &&
              !Object.hasOwn(stream, 'VIDEO') &&
              stream.SUBTITLES === selected['GROUP-ID'] &&
              (!stream['CLOSED-CAPTIONS'] || stream['CLOSED-CAPTIONS'] === 'NONE')
          ) ||
          !Array.from(audio.keys()).every((group) =>
            streams.some((stream) => stream.AUDIO === group)
          )
        ) {
          fail('ambiguous');
        }
        return {
          url: uri(selected.URI, parent, 'subtitle'),
          rendition: { language: selected.LANGUAGE, name: selected.NAME },
        };
      };
      const playlist = (text, parent) => {
        const input = lines(text);
        if (input.shift() !== '#EXTM3U') {
          fail('playlist');
        }
        let duration = null,
          leaf = null,
          end = false;
        for (const raw of input) {
          const line = raw.trim();
          if (!line) {
            continue;
          }
          veto(line);
          if (end) {
            fail('incomplete');
          }
          if (line.startsWith('#EXTINF:')) {
            if (duration !== null || !/^#EXTINF:\d+(?:\.\d+)?,[^\r\n]*$/.test(line)) {
              fail('incomplete');
            }
            duration = Number(line.slice(8).split(',')[0]);
            if (
              !Number.isFinite(duration) ||
              duration <= 0 ||
              Math.abs(duration - bound.duration) > 0.1
            ) {
              fail('duration');
            }
          } else if (!line.startsWith('#')) {
            if (duration === null || leaf !== null) {
              fail('incomplete');
            }
            leaf = uri(line, parent, 'vtt');
          } else if (line === '#EXT-X-ENDLIST') {
            if (!leaf) {
              fail('incomplete');
            }
            end = true;
          } else if (
            !/^#EXT-X-(?:VERSION:\d+|TARGETDURATION:[1-9]\d*|MEDIA-SEQUENCE:0|PLAYLIST-TYPE:VOD)$/.test(
              line
            )
          ) {
            fail('unsupported-playlist');
          }
        }
        if (!end || !leaf || duration === null) {
          fail('incomplete');
        }
        return { url: leaf, duration };
      };
      const time = (value) => {
        const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
        if (!match) {
          fail('timestamp');
        }
        const result =
          Number(match[1] || 0) * 3600 +
          Number(match[2]) * 60 +
          Number(match[3]) +
          Number(match[4]) / 1000;
        if (
          Number(match[2]) > 59 ||
          Number(match[3]) > 59 ||
          !Number.isFinite(result) ||
          result > 3600
        ) {
          fail('timestamp');
        }
        return result;
      };
      const settings = (value) => {
        const seen = new Set();
        for (const token of value
          .trim()
          .split(/[ \t]+/)
          .filter(Boolean)) {
          const [key, setting, extra] = token.split(':');
          if (!setting || extra !== undefined || seen.has(key)) {
            fail('settings');
          }
          seen.add(key);
          const percent = (part) =>
            /^\d+(?:\.\d+)?%$/.test(part) && Number(part.slice(0, -1)) <= 100;
          const parts = setting?.split(',');
          if (key === 'vertical' && /^(?:rl|lr)$/.test(setting)) {
            continue;
          }
          if (key === 'align' && /^(?:start|center|end|left|right)$/.test(setting)) {
            continue;
          }
          if (key === 'size' && percent(setting)) {
            continue;
          }
          if (
            key === 'line' &&
            parts.length <= 2 &&
            (parts[0] === 'auto' || /^-?\d+$/.test(parts[0]) || percent(parts[0])) &&
            (parts.length === 1 || /^(?:start|center|end)$/.test(parts[1]))
          ) {
            continue;
          }
          if (
            key === 'position' &&
            parts.length <= 2 &&
            percent(parts[0]) &&
            (parts.length === 1 || /^(?:line-left|center|line-right|auto)$/.test(parts[1]))
          ) {
            continue;
          }
          fail('settings');
        }
      };
      const vtt = (text) => {
        const input = lines(text);
        if (!/^WEBVTT(?:[ \t][^\r\n]*)?$/.test(input.shift()) || input[0]?.trim()) {
          fail('header');
        }
        const cues = [];
        let at = 0;
        while (at < input.length) {
          while (at < input.length && !input[at].trim()) {
            at++;
          }
          if (at >= input.length) {
            break;
          }
          const block = [];
          while (at < input.length && input[at].trim()) {
            block.push(input[at++]);
          }
          if (/^NOTE(?:[ \t]|$)/.test(block[0])) {
            continue;
          }
          if (/^(?:STYLE|REGION)(?:[ \t]|$)/.test(block[0])) {
            fail('vtt-feature');
          }
          const index = block[0].includes('-->') ? 0 : 1;
          const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/.exec(block[index] || '');
          if (!match || (index && block[0].length > 256)) {
            fail('cue');
          }
          const start = time(match[1]),
            end = time(match[2]);
          const text = block.slice(index + 1).join('\n');
          const rawSettings = match[3] || '';
          settings(rawSettings);
          if (
            end <= start ||
            end > bound.duration + 0.1 ||
            text.length > 8192 ||
            /<\d/.test(text) ||
            text.includes('-->') ||
            (cues.length && start < cues[cues.length - 1].start) ||
            cues.length >= 256
          ) {
            fail('cue');
          }
          cues.push({
            id: index ? block[0] : '',
            start,
            end,
            text,
            settings: rawSettings,
          });
        }
        if (!cues.length) {
          fail('cue');
        }
        return cues;
      };
      const hlsUrl = uri(bound.hlsUrl, undefined, 'master');
      const first = await read(hlsUrl, 'master');
      verify();
      const selected = master(first.text, hlsUrl);
      verify();
      const second = await read(selected.url, 'subtitle');
      verify();
      const segment = playlist(second.text, selected.url);
      verify();
      const third = await read(segment.url, 'vtt');
      verify();
      const oracle = vtt(third.text);
      verify();
      const result = {
        vttBytes: third.bytes,
        vttText: third.text,
        oracle,
        rendition: selected.rendition,
        duration: segment.duration,
        chain: { hlsUrl, subtitleUrl: selected.url, vttUrl: segment.url },
      };
      verify();
      return result;
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
          /* Cleanup continues. */
        }
        try {
          bound?.signal?.removeEventListener('abort', externalAbort);
        } catch {
          /* Cleanup continues. */
        }
        try {
          controller?.abort();
        } catch {
          /* Release any completed request context. */
        }
      })
      .then(
        (result) => {
          // Cancellation remains live through cleanup and final authority reads,
          // until this public promise is about to settle.
          try {
            if (reason) {
              fail(reason);
            }
            let current = false;
            try {
              current = bound.isCurrent() === true;
            } catch {
              /* Lost authority. */
            }
            if (reason) {
              fail(reason);
            }
            if (!current) {
              fail('source-changed');
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

  window.VSC.TwitterCaptionSource = { create: createCaptionSource };
})();

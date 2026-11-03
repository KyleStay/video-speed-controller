import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/core/twitter-caption-playback.js';

// Synthetic text only; native Safari parsing/rendering requires physical verification.
describe('verified rolling X caption owner', () => {
  const HLS = 'https://video.twimg.com/amplify_video/123/pl/master.m3u8';
  const oracle = [
    { id: '', start: 0.2, end: 0.8, text: 'First example', settings: '' },
    { id: '', start: 1.2, end: 1.8, text: 'Second example', settings: '' },
    { id: '', start: 2.2, end: 3.5, text: 'Third example', settings: '' },
  ];
  const generated = [
    '1933607131933668512731226391',
    '1933607121933668503617692253',
    '1933607151933555972713341198',
  ];
  class Cue {
    constructor(startTime, endTime, text) {
      Object.assign(this, {
        startTime,
        endTime,
        text,
        id: '',
        region: null,
        vertical: '',
        snapToLines: true,
        line: 'auto',
        lineAlign: 'start',
        position: 'auto',
        positionAlign: 'auto',
        size: 100,
        align: 'center',
        pauseOnExit: false,
      });
    }
  }
  const cue = (entry, index) =>
    Object.assign(new Cue(entry.start, entry.end, entry.text), {
      id: generated[index],
    });
  const list = (items) => {
    const events = new EventTarget();
    for (const method of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
      items[method] = events[method].bind(events);
    }
    return items;
  };
  const property = (node, key, value) =>
    Object.defineProperty(node, key, {
      configurable: true,
      writable: true,
      value,
    });
  let original, companion, originalNode, nativeTrack, binding, task, resolveSource;
  let owner, nodes, current, malformed, addFailure, removeFailure, nativeModes;
  let addHook, removeHook, normalizationHook, delayParse, parsePending;
  let delayBootstrap, bootstrapPending, blobError, bootstrapError, safariAutoSelect, appendSource;
  let srcHook, parsedOracle;
  const certificate = () => ({
    oracle: oracle.map((entry) => ({ ...entry })),
    vttBytes: new Uint8Array([87, 69, 66, 86, 84, 84]),
    rendition: { language: 'en', name: 'English' },
    duration: 4,
    chain: { hlsUrl: HLS, subtitleUrl: HLS.replace('master', 'subtitles') },
    masterText: '#EXTM3U\n# exact synthetic master\n',
    subtitleGroupId: 'subs',
  });
  const flush = async () => {
    for (let index = 0; index < 12; index++) {
      await Promise.resolve();
    }
  };
  const create = () =>
    (owner = window.VSC.TwitterCaptionPlayback.createLoopOwner(binding, companion));
  async function prepared(result = certificate()) {
    create();
    const attached = owner.attach();
    resolveSource(result);
    await owner.promise;
    await attached;
    owner.setPeriod(4.064);
    expect(owner.installEpoch(0)).toBe(true);
    return owner;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    current = true;
    addHook = removeHook = normalizationHook = null;
    delayParse = false;
    parsePending = null;
    delayBootstrap = blobError = bootstrapError = safariAutoSelect = false;
    bootstrapPending = appendSource = null;
    srcHook = null;
    parsedOracle = oracle;
    malformed = addFailure = removeFailure = false;
    nodes = [];
    vi.spyOn(document, 'URL', 'get').mockReturnValue('https://x.com/example');
    vi.stubGlobal('VTTCue', Cue);
    class OwnedURL extends window.URL {}
    OwnedURL.createObjectURL = vi.fn(() => 'blob:https://x.com/private-captions');
    OwnedURL.revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', OwnedURL);
    original = document.createElement('video');
    companion = document.createElement('video');
    originalNode = document.createElement('track');
    original.append(originalNode);
    document.body.append(original);
    nativeTrack = Object.assign(new EventTarget(), {
      kind: 'subtitles',
      language: 'en',
      label: 'English',
      mode: 'showing',
      cues: oracle.map(cue),
    });
    property(originalNode, 'track', nativeTrack);
    property(original, 'textTracks', list([nativeTrack]));
    property(companion, 'textTracks', list([]));
    for (const media of [original, companion]) {
      for (const method of ['play', 'pause', 'load']) {
        media[method] = vi.fn();
      }
    }
    nativeModes = [];
    binding = {
      original,
      track: nativeTrack,
      node: originalNode,
      hlsUrl: HLS,
      assetType: 'amplify_video',
      assetId: '123',
      duration: 4,
      language: 'en',
      label: 'English',
      isCurrent: vi.fn(() => current),
    };
    task = {
      promise: new Promise((resolve) => {
        resolveSource = (value) => {
          parsedOracle = value.oracle;
          resolve(value);
        };
      }),
      cancel: vi.fn(),
    };
    vi.spyOn(window.VSC.TwitterCaptionSource, 'create').mockReturnValue(task);
    const append = companion.append.bind(companion);
    companion.append = (node) => {
      append(node);
      companion.textTracks.push(node.track);
      appendSource = node.getAttribute('src');
      if (safariAutoSelect) {
        node.track.mode = 'showing';
        if (!appendSource) {
          queueMicrotask(() => {
            node.readyState = 3;
            node.dispatchEvent(new Event('error'));
          });
        }
      }
    };
    const rawCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((name, options) => {
      const node = rawCreate(name, options);
      if (name !== 'track') {
        return node;
      }
      let mode = 'disabled';
      const track = Object.assign(new EventTarget(), {
        kind: 'subtitles',
        label: 'English',
        language: 'en',
        cues: [],
        addCue: vi.fn((value) => {
          if (addFailure) {
            throw new Error('append rejected');
          }
          track.cues.push(value);
          addHook?.();
        }),
        removeCue: vi.fn((value) => {
          if (removeFailure) {
            throw new Error('remove rejected');
          }
          track.cues.splice(track.cues.indexOf(value), 1);
          removeHook?.();
        }),
      });
      Object.defineProperty(track, 'mode', {
        get: () => mode,
        set(value) {
          mode = value;
          nativeModes.push(value);
          companion.textTracks.dispatchEvent(new Event('change'));
        },
      });
      property(node, 'track', track);
      property(node, 'readyState', 0);
      Object.defineProperty(node, 'src', {
        get: () => node.getAttribute('src'),
        set(value) {
          node.setAttribute('src', value);
          srcHook?.(node, value);
          const parse = () => {
            const bootstrap = value === 'data:,WEBVTT';
            if ((bootstrap && bootstrapError) || (!bootstrap && blobError)) {
              node.readyState = 3;
              node.dispatchEvent(new Event('error'));
              return;
            }
            track.cues = bootstrap
              ? []
              : parsedOracle.map((entry) => {
                  const parsed = Object.assign(new Cue(entry.start, entry.end, entry.text), {
                    id: entry.id,
                  });
                  const line = /line:(\d+)%(?:,(start|center|end))?/.exec(entry.settings);
                  if (line) {
                    Object.assign(parsed, {
                      line: Number(line[1]),
                      snapToLines: false,
                      lineAlign: line[2] || 'start',
                    });
                  }
                  return parsed;
                });
            if (!bootstrap && normalizationHook) {
              let id = track.cues[0].id;
              delete track.cues[0].id;
              const prototype = Object.create(Cue.prototype);
              Object.defineProperty(prototype, 'id', {
                get: () => id,
                set(value) {
                  id = value;
                  normalizationHook(node);
                },
              });
              Object.setPrototypeOf(track.cues[0], prototype);
            }
            if (malformed) {
              track.cues.pop();
            }
            node.readyState = 2;
            node.dispatchEvent(new Event('load'));
          };
          if (value === 'data:,WEBVTT' && delayBootstrap) {
            bootstrapPending = parse;
          } else if (value !== 'data:,WEBVTT' && delayParse) {
            parsePending = parse;
          } else {
            queueMicrotask(parse);
          }
        },
      });
      const remove = node.remove.bind(node);
      node.remove = () => {
        companion.textTracks.splice(companion.textTracks.indexOf(track), 1);
        remove();
      };
      nodes.push(node);
      return node;
    });
  });
  afterEach(() => {
    owner?.cleanup();
    owner = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('separates full source proof from synchronous attachment and native epoch readiness', async () => {
    create();
    expect(window.VSC.TwitterCaptionPlayback.isLoopOwner(owner)).toBe(true);
    expect(window.VSC.TwitterCaptionPlayback.isLoopOwner({ ...owner })).toBe(false);
    const attached = owner.attach();
    expect(nodes[0].parentNode).toBe(companion);
    expect(owner.ownsTrack(companion)).toBe(true);
    expect(owner.readyToPlay(0)).toBe(false);
    resolveSource(certificate());
    await owner.promise;
    await attached;
    expect(owner.attestsMaster(HLS, certificate().masterText)).toBe('subs');
    expect(owner.attestsMaster(HLS, `${certificate().masterText}\n`)).toBe(null);
    owner.setPeriod(4.064);
    expect(owner.installEpoch(0)).toBe(true);
    expect(owner.readyToPlay(0.4)).toBe(true);
    expect(nodes[0].track.cues.map((entry) => entry.id)).toEqual(generated);
    expect(nativeTrack.mode).toBe('showing');
    for (const media of [original, companion]) {
      expect(media.play).not.toHaveBeenCalled();
      expect(media.pause).not.toHaveBeenCalled();
      expect(media.load).not.toHaveBeenCalled();
    }
  });

  it('provides a valid empty header before iOS auto-selects the appended track', async () => {
    safariAutoSelect = true;
    create();
    const attached = owner.attach();
    expect(appendSource).toBe('data:,WEBVTT');
    expect(nodes[0].getAttribute('src')).toBe('data:,WEBVTT');
    resolveSource(certificate());
    await attached;
    owner.setPeriod(4.064);
    expect(owner.readyToPlay(0)).toBe(true);
    expect(nativeTrack.mode).toBe('showing');
    expect(nativeTrack.cues).toHaveLength(3);
    expect(original.play).not.toHaveBeenCalled();
    expect(companion.play).not.toHaveBeenCalled();
  });

  it('cannot accept bootstrap load as caption readiness before the full source certificate', async () => {
    create();
    let accepted = false;
    const attached = owner.attach().then(() => {
      accepted = true;
    });
    await flush();
    expect(nodes[0].readyState).toBe(2);
    expect(nodes[0].track.cues).toHaveLength(0);
    expect(accepted).toBe(false);
    expect(owner.readyToPlay(0)).toBe(false);
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    resolveSource(certificate());
    await attached;
    expect(accepted).toBe(true);
  });

  it('waits for the delayed bootstrap load even when the source certificate is already cached', async () => {
    delayBootstrap = true;
    create();
    const attached = owner.attach();
    resolveSource(certificate());
    await owner.promise;
    await flush();
    expect(nodes[0].getAttribute('src')).toBe('data:,WEBVTT');
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(owner.readyToPlay(0)).toBe(false);
    bootstrapPending();
    await attached;
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(nodes[0].track.cues).toHaveLength(3);
  });

  it.each(['bootstrap', 'certified-Blob'])(
    'does not ignore a real %s resource error',
    async (phase) => {
      bootstrapError = phase === 'bootstrap';
      blobError = phase === 'certified-Blob';
      create();
      const attached = owner.attach();
      resolveSource(certificate());
      await expect(attached).rejects.toThrow('failed to load');
      expect(owner.readyToPlay(0)).toBe(false);
      expect(nativeTrack.mode).toBe('showing');
    }
  );

  it('does not append, register or write mode after the header setter reentrantly cleans up', async () => {
    create();
    let modesAtCleanup;
    srcHook = (node, value) => {
      if (value === 'data:,WEBVTT') {
        owner.cleanup();
        modesAtCleanup = nativeModes.length;
      }
    };
    expect(() => owner.attach()).toThrow('authority ended');
    expect(nodes[0].parentNode).toBe(null);
    resolveSource(certificate());
    await expect(owner.promise).rejects.toThrow();
    await flush();
    expect(nativeModes.length).toBe(modesAtCleanup);
    expect(vi.getTimerCount()).toBe(0);
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('does not steal a preappend header track adopted without invoking owner cleanup', async () => {
    const foreign = document.createElement('video');
    document.body.append(foreign);
    create();
    srcHook = (node, value) => {
      if (value === 'data:,WEBVTT') {
        foreign.append(node);
      }
    };
    expect(() => owner.attach()).toThrow('adopted');
    expect(nodes[0].parentNode).toBe(foreign);
    owner.cleanup();
    resolveSource(certificate());
    await expect(owner.promise).rejects.toThrow();
    expect(nodes[0].parentNode).toBe(foreign);
    expect(nativeModes).toEqual([]);
  });

  it('stops after a Blob setter adopts the track and centrally cleans up before hidden mode', async () => {
    const foreign = document.createElement('video');
    document.body.append(foreign);
    let modesAtCleanup;
    create();
    owner.setInvalidated(() => owner.cleanup());
    srcHook = (node, value) => {
      if (value !== 'data:,WEBVTT') {
        foreign.append(node);
        owner.isCurrent();
        modesAtCleanup = nativeModes.length;
      }
    };
    const attached = owner.attach();
    resolveSource(certificate());
    await expect(attached).rejects.toThrow();
    await flush();
    expect(nodes[0].parentNode).toBe(foreign);
    expect(nativeModes.length).toBe(modesAtCleanup);
  });

  it('uses actual A/V period for future epochs and retires only complete A/V-removed cycles', async () => {
    await prepared();
    owner.installEpoch(1);
    owner.installEpoch(2);
    const track = nodes[0].track;
    expect(track.cues[3].startTime).toBe(0.2 + 4.064);
    expect(track.cues[3].id).toBe(generated[0]);
    expect(owner.verifyEpoch(2)).toBe(true);
    expect(owner.readyToPlay(2 * 4.064 + 0.3)).toBe(true);
    owner.retireBefore(4.064);
    expect(owner.verifyEpoch(0)).toBe(false);
    expect(track.cues).toHaveLength(6);
    expect(owner.verifyEpoch(1)).toBe(true);
    expect(owner.readyToPlay(0.3)).toBe(false);
    expect(() => owner.retireBefore(4)).toThrow('retirement');
  });

  it('pins source IDs exactly and rejects generated-prefix substitution', async () => {
    const result = certificate();
    result.oracle[0].id = 'explicit-example';
    nativeTrack.cues[0].id = 'hlsjscc1_explicit-example';
    create();
    resolveSource(result);
    await expect(owner.promise).rejects.toThrow('identity');
  });

  it.each(['text', 'timing', 'id', 'region', 'settings', 'count', 'language', 'mode'])(
    'rejects changed native %s instead of issuing a partial caption certificate',
    async (field) => {
      const c = nativeTrack.cues[0];
      if (field === 'text') {
        c.text = 'Different example';
      }
      if (field === 'timing') {
        c.startTime += 0.002;
      }
      if (field === 'id') {
        c.id += 'x';
      }
      if (field === 'region') {
        c.region = {};
      }
      if (field === 'settings') {
        c.size = 90;
      }
      if (field === 'count') {
        nativeTrack.cues.pop();
      }
      if (field === 'language') {
        nativeTrack.language = 'fr';
      }
      if (field === 'mode') {
        nativeTrack.mode = 'hidden';
      }
      if (field === 'language' || field === 'mode') {
        expect(create).toThrow();
      } else {
        create();
        resolveSource(certificate());
        await expect(owner.promise).rejects.toThrow();
      }
    }
  );

  it('accepts supplied identifiers only when the current native identifier is identical', async () => {
    const result = certificate();
    result.oracle[0].id = 'supplied-example';
    nativeTrack.cues[0].id = 'supplied-example';
    create();
    resolveSource(result);
    await expect(owner.promise).resolves.toBe(owner);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(owner.templates).toBeUndefined();
  });

  it('rejects a transient foreign track attribute write even when its URL is restored', async () => {
    await prepared();
    const track = nodes[0],
      src = track.getAttribute('src');
    track.setAttribute('src', 'https://example.invalid/foreign.vtt');
    track.setAttribute('src', src);
    expect(owner.ownsTrack(companion)).toBe(false);
    expect(owner.isCurrent()).toBe(false);
  });

  it('attests the single private initial URL assignment independently for multiple observers', async () => {
    create();
    const attached = owner.attach(),
      observed = [];
    const a = new MutationObserver((rows) => observed.push(...rows));
    const b = new MutationObserver((rows) => observed.push(...rows));
    for (const observer of [a, b]) {
      observer.observe(nodes[0], { attributes: true, attributeOldValue: true });
    }
    resolveSource(certificate());
    await attached;
    expect(observed).toHaveLength(2);
    expect(
      observed.every(
        (record) => record.oldValue === 'data:,WEBVTT' && owner.attestsInitialTrackWrite(record)
      )
    ).toBe(true);
    expect(
      owner.attestsInitialTrackWrite({
        target: nodes[0],
        type: 'attributes',
        attributeName: 'src',
        oldValue: null,
      })
    ).toBe(false);
    expect(
      owner.attestsInitialTrackWrite({
        ...observed[0],
        target: nodes[0],
        type: 'attributes',
        attributeName: 'src',
        oldValue: nodes[0].src,
      })
    ).toBe(false);
    current = false;
    expect(owner.attestsInitialTrackWrite(observed[0])).toBe(false);
    a.disconnect();
    b.disconnect();
  });

  it('withholds handback mode until the private parsed track has a complete native proof', async () => {
    delayParse = true;
    create();
    const attached = owner.attach();
    resolveSource(certificate());
    await owner.promise;
    await flush();
    expect(nodes[0].track.mode).toBe('hidden');
    expect(owner.mode).toBeUndefined();
    expect(nativeTrack.mode).toBe('showing');
    parsePending();
    await attached;
    expect(owner.mode).toBe('showing');
  });

  it.each(['add', 'remove'])(
    'stops each owned %s operation before writing to a reentrantly adopted track',
    async (operation) => {
      await prepared();
      if (operation === 'remove') {
        owner.installEpoch(1);
      }
      const node = nodes[0],
        foreign = document.createElement('video');
      document.body.append(foreign);
      owner.setInvalidated(() => owner.cleanup());
      const adopt = () => {
        foreign.append(node);
        owner.isCurrent();
      };
      if (operation === 'add') {
        addHook = adopt;
      } else {
        removeHook = adopt;
      }
      const method = node.track[operation === 'add' ? 'addCue' : 'removeCue'];
      method.mockClear();
      expect(() =>
        operation === 'add' ? owner.installEpoch(1) : owner.retireBefore(4.064)
      ).toThrow();
      expect(method).toHaveBeenCalledTimes(1);
      expect(node.parentNode).toBe(foreign);
    }
  );

  it('stops base cue normalization when the first identifier setter adopts the track', async () => {
    const foreign = document.createElement('video');
    document.body.append(foreign);
    normalizationHook = (node) => {
      foreign.append(node);
      owner.isCurrent();
    };
    create();
    owner.setInvalidated(() => owner.cleanup());
    const attached = owner.attach();
    resolveSource(certificate());
    await expect(attached).rejects.toThrow();
    expect(nodes[0].parentNode).toBe(foreign);
    expect(nodes[0].track.cues[1].id).toBe('');
  });

  it.each(['pending-transient', 'inspected-transient', 'companion-adopted'])(
    'preserves foreign %s ownership during cleanup',
    async (change) => {
      await prepared();
      const track = nodes[0];
      if (change === 'companion-adopted') {
        document.implementation.createHTMLDocument('foreign').adoptNode(companion);
      } else {
        const src = track.getAttribute('src');
        track.setAttribute('src', 'https://example.invalid/foreign.vtt');
        track.setAttribute('src', src);
      }
      if (change === 'inspected-transient') {
        expect(owner.ownsTrack(companion)).toBe(false);
      }
      owner.cleanup();
      expect(track.parentNode).toBe(companion);
      expect(window.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects ambiguous source/native signatures even when all counts match', async () => {
    const result = certificate();
    result.oracle[1] = { ...result.oracle[0] };
    nativeTrack.cues[1] = cue(result.oracle[0], 0);
    create();
    resolveSource(result);
    await expect(owner.promise).rejects.toThrow('Ambiguous');
  });

  it('does not authorize native play when the owned parser has missing cues', async () => {
    malformed = true;
    create();
    const attached = owner.attach();
    resolveSource(certificate());
    await expect(attached).rejects.toThrow('parser mismatch');
    expect(owner.readyToPlay(0)).toBe(false);
  });

  it('cancels source authority during fetch without late attachment/blob mutation', async () => {
    create();
    const invalidated = vi.fn();
    owner.setInvalidated(invalidated);
    const attached = owner.attach();
    current = false;
    resolveSource(certificate());
    await expect(owner.promise).rejects.toThrow();
    await expect(attached).rejects.toThrow();
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('notifies original-mode loss before central cleanup while retaining structural B ownership', async () => {
    await prepared();
    const observations = [];
    owner.setInvalidated(() =>
      observations.push({
        owned: owner.ownsTrack(companion),
        connected: nodes[0].parentNode === companion,
      })
    );
    nativeTrack.mode = 'disabled';
    original.textTracks.dispatchEvent(new Event('change'));
    expect(owner.isCurrent()).toBe(false);
    expect(observations).toEqual([{ owned: true, connected: true }]);
    expect(nativeTrack.mode).toBe('disabled');
    expect(owner.mode).toBeUndefined();
  });

  it('reads handback mode without invalidation callbacks and rejects unprocessed foreign mutations', async () => {
    await prepared();
    const invalidated = vi.fn();
    owner.setInvalidated(invalidated);
    expect(owner.mode).toBe('showing');
    expect(invalidated).not.toHaveBeenCalled();
    const track = nodes[0],
      src = track.getAttribute('src');
    track.setAttribute('src', 'https://example.invalid/foreign.vtt');
    track.setAttribute('src', src);
    expect(owner.mode).toBeUndefined();
    expect(invalidated).not.toHaveBeenCalled();
    expect(owner.isCurrent()).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(1);
  });

  it('rejects own original cue accessors before a late read can mutate an earlier checked cue', async () => {
    await prepared();
    const first = nativeTrack.cues[0],
      last = nativeTrack.cues.at(-1);
    let reads = 0;
    Object.defineProperty(last, 'pauseOnExit', {
      configurable: true,
      get() {
        reads++;
        first.text = 'Foreign';
        return false;
      },
    });
    expect(owner.isCurrent()).toBe(false);
    expect(reads).toBe(0);
    expect(first.text).toBe(oracle[0].text);
  });

  it('vetoes an own owned-cue getter without invoking it or callback from the pure handback read', async () => {
    await prepared();
    const invalidated = vi.fn();
    owner.setInvalidated(invalidated);
    let reads = 0;
    Object.defineProperty(nodes[0].track.cues.at(-1), 'pauseOnExit', {
      configurable: true,
      get() {
        reads++;
        current = false;
        return false;
      },
    });
    expect(owner.mode).toBeUndefined();
    expect(reads).toBe(0);
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('captures real native disabled/null-cues intent before invalidating playback authority', async () => {
    await prepared();
    const track = nodes[0].track,
      captured = track.cues;
    Object.defineProperty(track, 'cues', {
      configurable: true,
      get: () => (track.mode === 'disabled' ? null : captured),
    });
    const handback = [];
    owner.setInvalidated(() => handback.push(owner.mode));
    track.mode = 'disabled';
    expect(handback).toEqual(['disabled']);
    expect(owner.mode).toBe('disabled');
    expect(nativeTrack.mode).toBe('showing');
    expect(owner.isCurrent()).toBe(false);
    expect(owner.ownsTrack(companion)).toBe(true);
  });

  it('retains latest companion toggle for handback without rewriting the original', async () => {
    await prepared();
    nodes[0].track.mode = 'disabled';
    expect(owner.mode).toBe('disabled');
    expect(owner.readyToPlay(0.2)).toBe(true);
    expect(nativeTrack.mode).toBe('showing');
    owner.cleanup();
    expect(nativeTrack.mode).toBe('showing');
  });

  it.each(['extra', 'text', 'id', 'style', 'hidden'])(
    'vetoes unknown owned %s edits',
    async (change) => {
      await prepared();
      const track = nodes[0].track;
      if (change === 'extra') {
        track.cues.push(new Cue(0, 1, 'Unknown'));
      }
      if (change === 'text') {
        track.cues[0].text = 'Foreign';
      }
      if (change === 'id') {
        track.cues[0].id += 'x';
      }
      if (change === 'style') {
        track.cues[0].line = 10;
      }
      if (change === 'hidden') {
        track.mode = 'hidden';
      }
      expect(owner.isCurrent()).toBe(false);
      expect(owner.ownsTrack(companion)).toBe(true);
    }
  );

  it('preserves the observed three-field SDK position tuple across epochs and handback', async () => {
    for (const entry of nativeTrack.cues) {
      Object.assign(entry, { line: 94.66666666666667, snapToLines: false, lineAlign: 'end' });
    }
    await prepared();
    owner.installEpoch(1);
    expect(
      nodes[0].track.cues.every(
        (entry) =>
          entry.line === 94.66666666666667 &&
          entry.snapToLines === false &&
          entry.lineAlign === 'end'
      )
    ).toBe(true);
    expect(owner.mode).toBe('showing');
    expect(owner.verifyEpoch(1)).toBe(true);
    owner.cleanup();
    expect(nativeTrack.cues.every((entry) => entry.lineAlign === 'end')).toBe(true);
    expect(nativeTrack.mode).toBe('showing');
  });

  it('certifies fresh mixed canonical and SDK-positioned cues independently', async () => {
    Object.assign(nativeTrack.cues[1], { line: 40, snapToLines: false, lineAlign: 'end' });
    await prepared();
    owner.installEpoch(1);
    const positions = nodes[0].track.cues.map(({ line, snapToLines, lineAlign }) => ({
      line,
      snapToLines,
      lineAlign,
    }));
    expect(positions).toEqual([
      { line: 'auto', snapToLines: true, lineAlign: 'start' },
      { line: 40, snapToLines: false, lineAlign: 'end' },
      { line: 'auto', snapToLines: true, lineAlign: 'start' },
      { line: 'auto', snapToLines: true, lineAlign: 'start' },
      { line: 40, snapToLines: false, lineAlign: 'end' },
      { line: 'auto', snapToLines: true, lineAlign: 'start' },
    ]);
  });

  it('allows later documented native active-cue positioning without rewriting frozen B templates', async () => {
    await prepared();
    const invalidated = vi.fn();
    owner.setInvalidated(invalidated);
    // The loaded SDK applies z$ to activeCues only (startup-BHuSY_da offsets825129/826169).
    Object.assign(nativeTrack.cues[1], {
      line: 94.66666666666667,
      snapToLines: false,
      lineAlign: 'end',
    });
    nativeTrack.dispatchEvent(new Event('cuechange'));
    expect(owner.isCurrent()).toBe(true);
    expect(invalidated).not.toHaveBeenCalled();
    owner.installEpoch(1);
    expect(nodes[0].track.cues[1].line).toBe('auto');
    expect(nodes[0].track.cues[4].lineAlign).toBe('start');
    nodes[0].track.cues[1].lineAlign = 'end';
    expect(owner.isCurrent()).toBe(false);
  });

  it.each([
    { line: 70, snapToLines: false, lineAlign: 'start' },
    { line: 'auto', snapToLines: false, lineAlign: 'end' },
    { line: 101, snapToLines: false, lineAlign: 'end' },
    { line: -1, snapToLines: false, lineAlign: 'end' },
    { line: 'auto', snapToLines: true, lineAlign: 'end' },
    { line: 40, snapToLines: false, lineAlign: 'middle' },
  ])('rejects impossible or undocumented native position tuples %j', async (tuple) => {
    Object.assign(nativeTrack.cues[1], tuple);
    create();
    resolveSource(certificate());
    await expect(owner.promise).rejects.toThrow('identity or style');
  });

  it('preserves the existing explicit source85 percent position through native B parsing and epochs', async () => {
    const result = certificate();
    result.oracle[0].settings = 'line:85%';
    Object.assign(nativeTrack.cues[0], { line: 85, snapToLines: false, lineAlign: 'start' });
    await prepared(result);
    owner.installEpoch(1);
    for (const index of [0, 3]) {
      expect(nodes[0].track.cues[index].line).toBe(85);
      expect(nodes[0].track.cues[index].snapToLines).toBe(false);
      expect(nodes[0].track.cues[index].lineAlign).toBe('start');
    }
    expect(owner.isCurrent()).toBe(true);
    expect(owner.verifyEpoch(1)).toBe(true);
  });

  it('rejects an SDK tuple substituted for explicit source positioning', async () => {
    const result = certificate();
    result.oracle[0].settings = 'line:85%';
    Object.assign(nativeTrack.cues[0], {
      line: 94.66666666666667,
      snapToLines: false,
      lineAlign: 'end',
    });
    create();
    resolveSource(result);
    await expect(owner.promise).rejects.toThrow('identity or style');
  });

  it('revokes explicit-source authority if a later SDK layout would replace that content', async () => {
    const result = certificate();
    result.oracle[0].settings = 'line:85%';
    Object.assign(nativeTrack.cues[0], { line: 85, snapToLines: false, lineAlign: 'start' });
    await prepared(result);
    Object.assign(nativeTrack.cues[0], {
      line: 94.66666666666667,
      snapToLines: false,
      lineAlign: 'end',
    });
    expect(owner.isCurrent()).toBe(false);
  });

  it.each([
    { settings: 'line:10001', line: 10001, snapToLines: true, lineAlign: 'start' },
    { settings: 'line:101%', line: 101, snapToLines: false, lineAlign: 'start' },
    { settings: 'line:-1%', line: -1, snapToLines: false, lineAlign: 'start' },
    { settings: 'line:85%,middle', line: 85, snapToLines: false, lineAlign: 'middle' },
  ])(
    'retains native bounds and enum vetoes even for an identical source tuple %j',
    async (tuple) => {
      const result = certificate();
      result.oracle[0].settings = tuple.settings;
      Object.assign(nativeTrack.cues[0], tuple);
      create();
      resolveSource(result);
      await expect(owner.promise).rejects.toThrow('identity or style');
    }
  );

  it('still vetoes later native nonposition fields', async () => {
    await prepared();
    nativeTrack.cues[0].align = 'start';
    expect(owner.isCurrent()).toBe(false);
  });

  it('rejects period clipping, nonsequential epochs and retained-budget overflow', async () => {
    await prepared();
    expect(() => owner.setPeriod(3.4)).toThrow('period');
    expect(() => owner.installEpoch(2)).toThrow('budget');
    for (let index = 1; index < 64; index++) {
      owner.installEpoch(index);
    }
    expect(nodes[0].track.cues).toHaveLength(192);
    expect(() => owner.installEpoch(64)).toThrow('budget');
    owner.retireBefore(4.064);
    expect(owner.installEpoch(64)).toBe(true);
  });

  it.each(['add', 'remove'])(
    'fails an owned cue %s transaction without continuing play readiness',
    async (operation) => {
      await prepared();
      if (operation === 'add') {
        addFailure = true;
      } else {
        owner.installEpoch(1);
        removeFailure = true;
      }
      expect(() =>
        operation === 'add' ? owner.installEpoch(1) : owner.retireBefore(4.064)
      ).toThrow();
      expect(owner.isCurrent()).toBe(false);
      expect(owner.ownsTrack(companion)).toBe(true);
    }
  );

  it('preserves a foreign track replacement/adoption and releases its private URL only once', async () => {
    await prepared();
    const track = nodes[0];
    track.setAttribute('src', 'https://example.invalid/new.vtt');
    await flush();
    owner.cleanup();
    owner.cleanup();
    expect(track.parentNode).toBe(companion);
    expect(track.getAttribute('src')).toBe('https://example.invalid/new.vtt');
    expect(window.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending attachment deadline and never resurrects after cleanup', async () => {
    create();
    const attached = owner.attach();
    owner.cleanup();
    resolveSource(certificate());
    await expect(attached).rejects.toThrow('closed');
    await expect(owner.promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10001);
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(nodes[0].parentNode).toBe(null);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/core/twitter-loop-playback.js';

describe('continuous X loop playback', () => {
  const period = 215040 / 44100;
  const hls = 'https://video.twimg.com/amplify_video/123/pl/current.m3u8?tag=29';
  let media, owner, source, callbacks, transport, instances, operations, hold, pending;
  let nativeWrites, firstDecodedTimes, metadataStates, durationWrites, rateWrites;
  let previousLoader, previousMMS, previousCreate, previousRevoke;
  const settle = async () => {
    for (let i = 0; i < 150; i++) {
      await Promise.resolve();
    }
  };
  const get = (video) => {
    if (!media.has(video)) {
      media.set(video, {
        time: 0,
        duration: Infinity,
        paused: true,
        ready: 4,
        source: '',
        seeking: false,
        rate: 1,
      });
    }
    return media.get(video);
  };
  const ranges = (start, end) => ({
    length: end > start ? 1 : 0,
    start: () => start,
    end: () => end,
  });
  const create = () => {
    transport = new window.VSC.TwitterLoopPlayback(owner, callbacks);
    // TwitterMP4Session.start sets currentTime after the constructor's native load.
    owner.video.currentTime = owner.time;
    return transport;
  };
  const initialized = async () => {
    create();
    await settle();
    expect(transport.ready).toBe(true);
    return transport;
  };

  beforeEach(() => {
    window.VSC_controller?.mutationObserver?.stop();
    document.body.replaceChildren();
    media = new WeakMap();
    instances = [];
    operations = [];
    pending = [];
    nativeWrites = [];
    firstDecodedTimes = [];
    metadataStates = [];
    durationWrites = [];
    rateWrites = [];
    hold = false;
    previousLoader = window.VSC.TwitterLoopSource;
    previousMMS = window.ManagedMediaSource;
    previousCreate = window.URL.createObjectURL;
    previousRevoke = window.URL.revokeObjectURL;
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(function () {
      return get(this).defaultStart ?? get(this).time;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(function (time) {
      const state = get(this);
      nativeWrites.push({ time, ready: state.ready });
      if (state.ready === 0) {
        state.defaultStart = time;
      } else {
        state.time = time;
        state.seeking = true;
      }
    });
    vi.spyOn(HTMLMediaElement.prototype, 'playbackRate', 'get').mockImplementation(function () {
      return get(this).rate;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'playbackRate', 'set').mockImplementation(function (rate) {
      const state = get(this);
      rateWrites.push({ video: this, rate, ready: state.ready });
      if (state.rejectZero && rate === 0) {
        throw new Error('Native zero unsupported');
      }
      if (state.rejectPositive && rate > 0) {
        throw new Error('Native rate rejected');
      }
      state.rate = state.ignoreZero && rate === 0 ? 1 : state.clampRate && rate > 0 ? 2 : rate;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockImplementation(function () {
      return get(this).duration;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () {
      return get(this).paused;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockImplementation(function () {
      return get(this).ready;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'seeking', 'get').mockImplementation(function () {
      return get(this).seeking;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'currentSrc', 'get').mockImplementation(function () {
      return get(this).source;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'buffered', 'get').mockImplementation(() => {
      const buffers = instances[0]?.buffers || [];
      return ranges(
        Math.max(0, ...buffers.map((buffer) => buffer.start)),
        buffers.length ? Math.min(...buffers.map((buffer) => buffer.end)) : 0
      );
    });
    vi.spyOn(HTMLMediaElement.prototype, 'seekable', 'get').mockImplementation(function () {
      return ranges(0, get(this).duration);
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
      get(this).paused = false;
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function () {
      const state = get(this);
      state.source = this.querySelector('source')?.src || '';
      state.ready = 0;
      state.time = 0;
      state.defaultStart = undefined;
      const instance = instances[instances.length - 1];
      instance.readyState = 'open';
      queueMicrotask(() => instance.dispatchEvent(new Event('sourceopen')));
    });
    class Buffer extends EventTarget {
      constructor(mime) {
        super();
        this.mime = mime;
        this.start = this.end = 0;
        this.timestampOffset = 0;
        this.updating = false;
        this.appendBuffer = vi.fn((data) => {
          operations.push({
            type: 'append',
            mime,
            offset: this.timestampOffset,
            duration: instances[0].duration,
            data,
          });
          this.updating = true;
          const offset = this.timestampOffset;
          const complete = () => {
            const state = get(owner.video);
            if (data[0] === 2) {
              state.ready = 1;
              const buffered = instances[0].buffers.some((buffer) => buffer.end > 0);
              const seekable = Number.isFinite(state.duration) || buffered;
              metadataStates.push({ buffered, duration: state.duration, seekable });
              // WebKit consumes the default at metadata, even when an empty MSE
              // seekable range makes it abort without passing the seek to the engine.
              state.time = seekable ? (state.defaultStart ?? 0) : 0;
              state.defaultStart = undefined;
              state.seeking = seekable;
              owner.video.dispatchEvent(new Event('loadedmetadata'));
            }
            if (data[0] >= 3) {
              this.end = Math.max(
                this.end,
                offset + (mime.startsWith('video') ? 4.833333333 : period)
              );
            }
            if (data[0] === 4 && !state.holdData) {
              state.ready = 4;
              state.seeking = Boolean(state.holdSeek);
              if (!firstDecodedTimes.length) {
                firstDecodedTimes.push(state.time);
              }
              owner.video.dispatchEvent(new Event('loadeddata'));
              if (!state.seeking) {
                owner.video.dispatchEvent(new Event('seeked'));
              }
            }
            this.updating = false;
            this.dispatchEvent(new Event('updateend'));
          };
          if (hold) {
            pending.push(complete);
          } else {
            queueMicrotask(complete);
          }
        });
        this.remove = vi.fn((start, end) => {
          operations.push({ type: 'remove', mime, start, end });
          this.updating = true;
          queueMicrotask(() => {
            this.start = end;
            this.updating = false;
            this.dispatchEvent(new Event('updateend'));
          });
        });
        this.abort = vi.fn(() => {
          this.updating = false;
          this.dispatchEvent(new Event('abort'));
        });
      }
      get buffered() {
        return ranges(this.start, this.end);
      }
    }
    window.ManagedMediaSource = class extends EventTarget {
      static isTypeSupported = vi.fn(() => true);
      constructor() {
        super();
        this.readyState = 'closed';
        this._duration = NaN;
        this.buffers = [];
        this.endOfStream = vi.fn();
        this.addSourceBuffer = vi.fn((mime) => {
          const buffer = new Buffer(mime);
          this.buffers.push(buffer);
          return buffer;
        });
        this.removeSourceBuffer = vi.fn((buffer) => {
          this.buffers.splice(this.buffers.indexOf(buffer), 1);
        });
        instances.push(this);
      }
      get duration() {
        return this._duration;
      }
      set duration(value) {
        this._duration = value;
        get(owner.video).duration = value;
        durationWrites.push(value);
      }
    };
    window.URL.createObjectURL = vi.fn(() => 'blob:https://x.com/owned-loop');
    window.URL.revokeObjectURL = vi.fn();
    source = {
      video: {
        mime: 'video/mp4; codecs="avc1.64001f"',
        init: new Uint8Array([1]),
        segments: [new Uint8Array([3])],
      },
      audio: {
        mime: 'audio/mp4; codecs="mp4a.40.2"',
        init: new Uint8Array([2]),
        segments: [new Uint8Array([4])],
      },
      manifestDurations: { video: 4.833, audio: 4.88 },
    };
    window.VSC.TwitterLoopSource = {
      create: vi.fn(() => ({ promise: Promise.resolve(source), cancel: vi.fn() })),
    };
    const original = document.createElement('video');
    original.src = 'blob:https://x.com/original';
    original.muted = true;
    original.volume = 0.7;
    get(original).duration = period;
    Object.defineProperty(original, 'audioTracks', {
      configurable: true,
      value: [{ enabled: true }],
    });
    const video = document.createElement('video');
    document.body.append(original, video);
    owner = {
      video,
      original,
      candidate: {
        loop: true,
        sourceUrl: hls,
        progressiveUrl: 'https://video.twimg.com/amplify_video/123/vid/avc1/720x1280/supplied.mp4',
        contentId: '123',
      },
      doc: document,
      view: window,
      time: 1.25,
      rate: 4,
      identityCurrent: vi.fn(() => true),
      originCurrent: vi.fn(() => owner.identityCurrent()),
    };
    callbacks = { ready: vi.fn(), failed: vi.fn() };
  });

  afterEach(async () => {
    transport?.cleanup();
    await settle();
    vi.useRealTimers();
    transport = null;
    window.VSC.TwitterLoopSource = previousLoader;
    window.ManagedMediaSource = previousMMS;
    window.URL.createObjectURL = previousCreate;
    window.URL.revokeObjectURL = previousRevoke;
    vi.restoreAllMocks();
  });

  it('limits eligibility to finite bound audio loops without page-owned media properties', () => {
    const canUse = () => window.VSC.TwitterLoopPlayback.canUse(owner);
    expect(canUse()).toBe(true);
    owner.candidate.loop = false;
    expect(canUse()).toBe(false);
    owner.candidate.loop = true;
    get(owner.original).duration = 60;
    expect(canUse()).toBe(true);
    get(owner.original).duration = 60.01;
    expect(canUse()).toBe(false);
    get(owner.original).duration = period;
    owner.original.audioTracks[0].enabled = false;
    expect(canUse()).toBe(false);
    owner.original.audioTracks[0].enabled = true;
    owner.candidate.sourceUrl = 'https://video.twimg.com/amplify_video/999/pl/current.m3u8';
    expect(canUse()).toBe(false);
    owner.candidate.sourceUrl = hls;
    Object.defineProperty(owner.video, 'currentTime', { configurable: true, value: 2 });
    expect(canUse()).toBe(false);
  });

  it('installs native source ownership synchronously and primes both tracks without requesting Play', async () => {
    create();
    expect(owner.video.children).toHaveLength(2);
    expect(owner.video.children[0].src).toBe(transport.ownedURL);
    expect(owner.video.children[1].src).toBe(hls);
    expect(owner.video.hasAttribute('src')).toBe(false);
    expect(owner.video.disableRemotePlayback).not.toBe(true);
    expect(transport.sourceCurrent()).toBe(true);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await settle();
    expect(transport.ready).toBe(true);
    expect(callbacks.ready).toHaveBeenCalledOnce();
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(operations.slice(0, 4).map((operation) => operation.data[0])).toEqual([1, 2, 3, 4]);
    expect(transport.period).toBe(period);
    expect(owner.video.duration).toBe(period);
    expect(owner.video.currentTime).toBe(1.25);
    expect(transport.nativeTime()).toBe(1.25);
    expect(transport.nextCycle).toBe(1);
    expect(owner.original.muted).toBe(true);
    expect(owner.original.volume).toBe(0.7);
    expect(owner.original.getAttribute('src')).toBe('blob:https://x.com/original');
  });

  it('holds the native clock at zero until one validated cycle and native seek readiness, then releases once without Play', async () => {
    get(owner.video).holdSeek = true;
    create();
    expect(owner.video.playbackRate).toBe(0);
    expect(owner.video.defaultPlaybackRate).toBe(1);
    expect(rateWrites.map(({ rate }) => rate)).toEqual([0]);
    await owner.video.play();
    await settle();
    expect(firstDecodedTimes).toEqual([owner.time]);
    expect(transport.nextCycle).toBe(1);
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(owner.video.playbackRate).toBe(0);
    expect(rateWrites.map(({ rate }) => rate)).toEqual([0]);
    owner.rate = 2.1;
    get(owner.video).seeking = false;
    owner.video.dispatchEvent(new Event('seeked'));
    expect(owner.video.playbackRate).toBe(2.1);
    expect(callbacks.ready).toHaveBeenCalledOnce();
    owner.video.dispatchEvent(new Event('loadeddata'));
    expect(rateWrites.map(({ rate }) => rate)).toEqual([0, 2.1]);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(owner.video.loop).toBe(true);
    expect(owner.video.muted).toBe(false);
    expect(owner.original).toMatchObject({ muted: true, volume: 0.7 });
  });

  it('releases the latest owner rate after a genuine pause without another Play', async () => {
    get(owner.video).holdSeek = true;
    create();
    await owner.video.play();
    await settle();
    get(owner.video).paused = true;
    owner.video.dispatchEvent(new Event('pause'));
    owner.rate = 3.6;
    get(owner.video).seeking = false;
    owner.video.dispatchEvent(new Event('seeked'));
    expect(owner.video.playbackRate).toBe(3.6);
    expect(owner.video.paused).toBe(true);
    expect(callbacks.ready).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it.each(['source', 'caption', 'DRM', 'capability', 'cleanup'])(
    'does not release the held native rate after %s loss before seek readiness',
    async (loss) => {
      get(owner.video).holdSeek = true;
      create();
      await settle();
      if (loss === 'source') {
        owner.video.children[0].src = 'blob:foreign';
      }
      if (loss === 'caption') {
        Object.defineProperty(owner.video, 'textTracks', { configurable: true, value: [{}] });
      }
      if (loss === 'DRM') {
        Object.defineProperty(owner.video, 'mediaKeys', { configurable: true, value: {} });
      }
      if (loss === 'capability') {
        owner.originCurrent.mockReturnValue(false);
      }
      if (loss === 'cleanup') {
        transport.cleanup();
      }
      get(owner.video).seeking = false;
      owner.video.dispatchEvent(new Event('seeked'));
      await settle();
      expect(rateWrites.filter(({ rate }) => rate > 0)).toHaveLength(0);
      expect(callbacks.ready).not.toHaveBeenCalled();
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      expect(owner.original.src).toBe('blob:https://x.com/original');
    }
  );

  it('fails external positive rate input during preparation before any release or Ready', async () => {
    get(owner.video).holdSeek = true;
    create();
    await settle();
    get(owner.video).rate = 4;
    owner.video.dispatchEvent(new Event('ratechange'));
    await settle();
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(transport.closed).toBe(true);
    expect(rateWrites.map(({ rate }) => rate)).toEqual([0]);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it.each(['rate command', 'revision', 'source', 'capability'])(
    'does not certify a release whose native setter reenters newer %s authority',
    async (change) => {
      get(owner.video).holdSeek = true;
      create();
      await settle();
      vi.spyOn(HTMLMediaElement.prototype, 'playbackRate', 'set').mockImplementationOnce(
        function (rate) {
          get(this).rate = rate;
          if (change === 'rate command') {
            owner.rate = 2.1;
          }
          if (change === 'revision') {
            owner.rateRevision = 2;
          }
          if (change === 'source') {
            owner.video.children[0].src = 'blob:foreign-source';
          }
          if (change === 'capability') {
            owner.originCurrent.mockReturnValue(false);
          }
        }
      );
      get(owner.video).seeking = false;
      owner.video.dispatchEvent(new Event('seeked'));
      await settle();
      expect(callbacks.ready).not.toHaveBeenCalled();
      expect(callbacks.failed).toHaveBeenCalledOnce();
      expect(transport.closed).toBe(true);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    }
  );

  it('cancels held preparation append deadlines and ignores completion after teardown', async () => {
    vi.useFakeTimers();
    hold = true;
    create();
    await settle();
    expect(pending).toHaveLength(1);
    const count = operations.length;
    transport.cleanup();
    pending.shift()();
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(operations).toHaveLength(count);
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(rateWrites.map(({ rate }) => rate)).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(window.VSC.TwitterLoopSource.create.mock.results[0].value.cancel).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it.each(['ignoreZero', 'rejectZero'])(
    'rejects a native decoder that cannot hold zero (%s) and releases owned resources',
    (failure) => {
      get(owner.video)[failure] = true;
      expect(create).toThrow();
      expect(callbacks.ready).not.toHaveBeenCalled();
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      expect(owner.video.children).toHaveLength(0);
      expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
      expect(owner.original.src).toBe('blob:https://x.com/original');
    }
  );

  it.each(['reset', 'clampRate', 'rejectPositive'])(
    'fails a %s native rate instead of declaring a prepared high-rate decoder',
    async (failure) => {
      get(owner.video).holdSeek = true;
      create();
      await settle();
      if (failure === 'reset') {
        get(owner.video).rate = 1;
      } else {
        get(owner.video)[failure] = true;
      }
      get(owner.video).seeking = false;
      owner.video.dispatchEvent(new Event('seeked'));
      await settle();
      expect(callbacks.ready).not.toHaveBeenCalled();
      expect(callbacks.failed).toHaveBeenCalledOnce();
      expect(transport.closed).toBe(true);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    }
  );

  it('requires native decoded readiness in addition to complete priming', async () => {
    get(owner.video).holdData = true;
    create();
    await settle();
    expect(transport.nextCycle).toBe(1);
    expect(transport.ready).toBe(false);
    expect(callbacks.ready).not.toHaveBeenCalled();
    get(owner.video).ready = 2;
    get(owner.video).seeking = false;
    owner.video.dispatchEvent(new Event('loadeddata'));
    expect(transport.ready).toBe(true);
    expect(callbacks.ready).toHaveBeenCalledOnce();
  });

  it('sets the nonzero native default start before metadata or the first decoded frame', async () => {
    create();
    expect(operations).toHaveLength(0);
    expect(nativeWrites).toEqual([{ time: 1.25, ready: 0 }]);
    expect(get(owner.video).time).toBe(0);
    expect(transport.nativeTime()).toBe(1.25);
    await settle();
    expect(metadataStates).toEqual([{ buffered: false, duration: 3 * period, seekable: true }]);
    expect(firstDecodedTimes).toEqual([1.25]);
    expect(nativeWrites).toEqual([{ time: 1.25, ready: 0 }]);
    expect(durationWrites).toEqual([3 * period, Infinity]);
    expect(operations.slice(0, 4).every((operation) => operation.duration === 3 * period)).toBe(
      true
    );
    expect(operations.slice(4).every((operation) => operation.duration === Infinity)).toBe(true);
    expect(owner.video.duration).toBe(period);
    expect(transport.nextCycle).toBe(1);
    expect(callbacks.ready).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('models the discarded native default when an infinite bootstrap has no buffered range', async () => {
    create();
    Object.defineProperty(transport.mediaSource, 'duration', {
      get: () => Infinity,
      set: () => {
        get(owner.video).duration = Infinity;
      },
    });
    await settle();
    expect(metadataStates).toEqual([{ buffered: false, duration: Infinity, seekable: false }]);
    expect(firstDecodedTimes).toEqual([0]);
    expect(transport.nativeTime()).toBe(0);
    expect(nativeWrites).toEqual([{ time: 1.25, ready: 0 }]);
  });

  it('propagates a rejected native default start to the caller without a partial fallback callback', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementationOnce(() => {
      throw new Error('Native start rejected');
    });
    expect(create).toThrow('Native start rejected');
    expect(callbacks.failed).not.toHaveBeenCalled();
    // Session.begin owns cleanup when its post-constructor currentTime write fails.
    transport.cleanup();
    await settle();
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(instances[0].addSourceBuffer).not.toHaveBeenCalled();
    expect(owner.original.currentTime).toBe(0);
    expect(owner.original.paused).toBe(true);
    expect(owner.original.getAttribute('src')).toBe('blob:https://x.com/original');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('does not rewind native progress when the first complete cycle establishes the period', async () => {
    create();
    const operation = transport.operation.bind(transport);
    transport.operation = async (buffer, execute) => {
      await operation(buffer, execute);
      const last = operations.at(-1);
      if (last.data?.[0] === 4 && last.offset === 0) {
        get(owner.video).time += 0.3;
      }
    };
    await settle();
    expect(firstDecodedTimes).toEqual([1.25]);
    expect(transport.nativeTime()).toBeCloseTo(1.55);
    expect(nativeWrites).toEqual([{ time: 1.25, ready: 0 }]);
    expect(callbacks.ready).toHaveBeenCalledOnce();
  });

  it('keeps the latest seek made before metadata as the native default start', async () => {
    create();
    owner.video.currentTime = 2.75;
    await settle();
    expect(firstDecodedTimes).toEqual([2.75]);
    expect(transport.nativeTime()).toBe(2.75);
    expect(nativeWrites).toEqual([
      { time: 1.25, ready: 0 },
      { time: 2.75, ready: 0 },
    ]);
  });

  it('waits for the native initial seek to finish after the first complete cycle is validated', async () => {
    get(owner.video).holdSeek = true;
    create();
    await settle();
    expect(transport.nextCycle).toBe(1);
    expect(owner.video.readyState).toBe(4);
    expect(owner.video.seeking).toBe(true);
    expect(transport.ready).toBe(false);
    owner.video.dispatchEvent(new Event('loadeddata'));
    expect(callbacks.ready).not.toHaveBeenCalled();
    get(owner.video).seeking = false;
    owner.video.dispatchEvent(new Event('seeked'));
    expect(callbacks.ready).toHaveBeenCalledOnce();
    owner.video.dispatchEvent(new Event('seeked'));
    expect(callbacks.ready).toHaveBeenCalledOnce();
  });

  it('discards a late initial seek completion after cleanup', async () => {
    get(owner.video).holdSeek = true;
    create();
    await settle();
    transport.cleanup();
    get(owner.video).seeking = false;
    owner.video.dispatchEvent(new Event('seeked'));
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it.each([
    ['at end', period, period - 0.000001, period],
    ['beyond end', period + 1, period - 0.000001, period],
    ['before start', -1, 0, 0],
  ])(
    'clamps the initial %s seek before media data without losing the paused end marker',
    async (_name, time, native, relative) => {
      owner.time = time;
      await initialized();
      expect(nativeWrites).toEqual([{ time: native, ready: 0 }]);
      expect(transport.nativeTime()).toBe(native);
      expect(owner.video.currentTime).toBe(relative);
    }
  );

  it('corrects a rounded SDK end to the verified first-cycle end without seeking into the next cycle', async () => {
    get(owner.original).duration = period + 0.04;
    owner.time = period + 0.04;
    create();
    await settle();
    expect(transport.ready).toBe(false);
    expect(owner.video.playbackRate).toBe(0);
    get(owner.video).seeking = false;
    owner.video.dispatchEvent(new Event('seeked'));
    expect(transport.ready).toBe(true);
    expect(nativeWrites).toEqual([
      { time: period + 0.04 - 0.000001, ready: 0 },
      { time: period - 0.000001, ready: 4 },
    ]);
    expect(transport.nativeTime()).toBe(period - 0.000001);
    expect(owner.video.currentTime).toBe(period);
  });

  it('continues native time across many cycles and removes only whole older cycles', async () => {
    await initialized();
    get(owner.video).paused = false;
    owner.video.playbackRate = 4;
    for (let cycle = 0; cycle < 12; cycle++) {
      get(owner.video).time = cycle * period + 0.2;
      owner.video.dispatchEvent(new Event('timeupdate'));
      await settle();
      expect(transport.nextCycle * period).toBeGreaterThanOrEqual(
        transport.nativeTime() + Math.max(period / 4, owner.video.playbackRate * 2)
      );
    }
    expect(transport.nativeTime()).toBeGreaterThan(50);
    expect(owner.video.currentTime).toBeCloseTo(0.2);
    const removals = operations.filter((operation) => operation.type === 'remove');
    expect(removals.length).toBeGreaterThan(0);
    expect(removals.at(-1).end).toBeCloseTo(10 * period);
    expect(removals.at(-1).end).toBeLessThan(transport.nativeTime() - period);
    expect(instances[0].endOfStream).not.toHaveBeenCalled();
    expect(owner.video.loop).toBe(true);
    expect(callbacks.failed).not.toHaveBeenCalled();
  });

  it('provides rate-scaled future runway and stops extra appends while paused', async () => {
    await initialized();
    const before = operations.length;
    owner.video.dispatchEvent(new Event('timeupdate'));
    await settle();
    expect(operations).toHaveLength(before);
    owner.video.playbackRate = 16;
    get(owner.video).paused = false;
    owner.video.dispatchEvent(new Event('play'));
    await settle();
    expect(transport.nextCycle * period).toBeGreaterThanOrEqual(transport.nativeTime() + 32);
    get(owner.video).paused = true;
    const paused = operations.length;
    owner.video.dispatchEvent(new Event('ratechange'));
    await settle();
    expect(operations).toHaveLength(paused);
  });

  it('keeps paused seek-to-end distinct from wrap zero and exposes clip-relative seek bounds', async () => {
    await initialized();
    owner.video.currentTime = period;
    expect(owner.video.currentTime).toBe(period);
    expect(transport.nativeTime()).toBeCloseTo(period - 0.000001, 7);
    expect(owner.video.seekable.length).toBe(1);
    expect(owner.video.seekable.start(0)).toBe(0);
    expect(owner.video.seekable.end(0)).toBe(period);
    expect(() => owner.video.seekable.end(1)).toThrow();
    owner.video.currentTime = 1.5;
    expect(owner.video.currentTime).toBe(1.5);
    expect(transport.nativeTime()).toBe(1.5);
    owner.video.currentTime = period;
    get(owner.video).paused = false;
    owner.video.dispatchEvent(new Event('play'));
    expect(owner.video.currentTime).toBeLessThan(period);
  });

  it('keeps consecutive paused seeks in the same epoch after rounded native boundary readback', async () => {
    await initialized();
    transport.period = 5.021353;
    get(owner.video).time = 5 * transport.period + 0.5;
    owner.video.currentTime = 0;
    const boundary = 5 * transport.period;
    get(owner.video).time = Number(boundary.toFixed(6));
    expect(transport.nativeTime()).toBeLessThan(boundary);
    expect(owner.video.currentTime).toBe(0);
    for (let i = 0; i < 10; i++) {
      owner.video.currentTime += 0.1;
      get(owner.video).time = Number(get(owner.video).time.toFixed(6));
    }
    expect(owner.video.currentTime).toBeCloseTo(1, 8);
    expect(transport.nativeTime()).toBeCloseTo(boundary + 1, 6);
    // Real advancement is still read from the native getter without normalization.
    get(owner.video).time = boundary + 1.01;
    expect(owner.video.currentTime).toBeCloseTo(1.01, 8);
  });

  it('reports an append failure before releasing source ownership and clip-relative state', async () => {
    await initialized();
    callbacks.failed.mockImplementation(() => {
      expect(transport.sourceCurrent()).toBe(true);
      expect(owner.video.duration).toBe(period);
      expect(owner.video.currentTime).toBe(1.25);
    });
    instances[0].buffers[0].dispatchEvent(new Event('error'));
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(transport.closed).toBe(true);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(transport.ownedURL);
  });

  it('notifies the owner before releasing a held append after source identity loss', async () => {
    hold = true;
    create();
    await settle();
    expect(pending).toHaveLength(1);
    callbacks.failed.mockImplementation(() => {
      expect(transport.sourceCurrent()).toBe(true);
      expect(Object.hasOwn(owner.video, 'currentTime')).toBe(true);
    });
    owner.identityCurrent.mockReturnValue(false);
    pending.shift()();
    await settle();
    expect(transport.closed).toBe(true);
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(window.VSC.TwitterLoopSource.create.mock.results[0].value.cancel).toHaveBeenCalled();
    expect(Object.hasOwn(owner.video, 'currentTime')).toBe(false);
    expect(owner.original.getAttribute('src')).toBe('blob:https://x.com/original');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('uses full capabilities rather than identity-only authority for a pending loader', async () => {
    let reject;
    window.VSC.TwitterLoopSource.create.mockReturnValue({
      promise: new Promise((_resolve, fail) => {
        reject = fail;
      }),
      cancel: vi.fn(),
    });
    create();
    await settle();
    const descriptor = window.VSC.TwitterLoopSource.create.mock.calls[0][0];
    expect(descriptor.progressiveUrl).toBe(owner.candidate.progressiveUrl);
    expect(Object.keys(descriptor).sort()).toEqual(
      ['hlsUrl', 'progressiveUrl', 'assetType', 'assetId', 'duration', 'isCurrent', 'signal'].sort()
    );
    expect(descriptor.isCurrent()).toBe(true);
    owner.originCurrent.mockReturnValue(false);
    expect(owner.identityCurrent()).toBe(true);
    expect(descriptor.isCurrent()).toBe(false);
    callbacks.failed.mockImplementation(() => {
      expect(transport.sourceCurrent()).toBe(true);
      expect(owner.video.currentTime).toBe(1.25);
    });
    reject(new Error('Capability revoked'));
    await settle();
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(instances[0].addSourceBuffer).not.toHaveBeenCalled();
    expect(transport.closed).toBe(true);
  });

  it('aborts an in-flight append when capabilities revoke but source identity remains current', async () => {
    hold = true;
    create();
    await settle();
    callbacks.failed.mockImplementation(() => {
      expect(transport.sourceCurrent()).toBe(true);
      expect(owner.video.duration).toBe(period);
    });
    owner.originCurrent.mockReturnValue(false);
    expect(owner.identityCurrent()).toBe(true);
    pending.shift()();
    await settle();
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(transport.closed).toBe(true);
    expect(owner.original.getAttribute('src')).toBe('blob:https://x.com/original');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('rechecks capabilities after a completed append before reading timing or applying the initial seek', async () => {
    create();
    const operation = transport.operation.bind(transport);
    transport.operation = async (buffer, execute) => {
      await operation(buffer, execute);
      if (operations.at(-1).data?.[0] === 4) {
        owner.originCurrent.mockReturnValue(false);
      }
    };
    callbacks.failed.mockImplementation(() => {
      expect(transport.sourceCurrent()).toBe(true);
      expect(nativeWrites).toEqual([{ time: 1.25, ready: 0 }]);
      expect(owner.video.currentTime).toBe(1.25);
    });
    await settle();
    expect(owner.identityCurrent()).toBe(true);
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(transport.period).toBeNull();
    expect(durationWrites).toEqual([3 * period]);
    expect(nativeWrites).toEqual([{ time: 1.25, ready: 0 }]);
  });

  it('cleans itself without a late owner callback after the owner has closed', async () => {
    await initialized();
    owner.closed = true;
    instances[0].buffers[0].dispatchEvent(new Event('error'));
    expect(transport.closed).toBe(true);
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(owner.video.children).toHaveLength(0);
  });

  it('rejects source writes, unknown tracks and encryption without changing original media', async () => {
    await initialized();
    owner.video.children[0].src = 'blob:https://x.com/site-replacement';
    expect(transport.sourceCurrent()).toBe(false);
    owner.video.dispatchEvent(new Event('timeupdate'));
    await settle();
    expect(transport.closed).toBe(true);
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(owner.original.getAttribute('src')).toBe('blob:https://x.com/original');
  });

  it('fails encrypted initialization and still preserves the original audio intent', async () => {
    await initialized();
    owner.video.dispatchEvent(new Event('encrypted'));
    expect(transport.closed).toBe(true);
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(owner.original.muted).toBe(true);
    expect(owner.original.volume).toBe(0.7);
  });

  it('rejects a late unknown native track before continuing the transport', async () => {
    const tracks = new EventTarget();
    tracks.length = 0;
    Object.defineProperty(owner.video, 'textTracks', { configurable: true, value: tracks });
    await initialized();
    tracks.length = 1;
    tracks.dispatchEvent(new Event('addtrack'));
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(transport.closed).toBe(true);
  });

  it('rejects mismatched track timing rather than accumulating a guessed loop period', async () => {
    source.manifestDurations.audio = 8;
    create();
    await settle();
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(transport.closed).toBe(true);
    expect(durationWrites).toEqual([3 * period]);
  });

  it('rejects a clip whose cached bytes would exceed the rolling buffer density budget', async () => {
    const data = new Uint8Array(3 * 1024 * 1024);
    data[0] = 3;
    source.video.segments = [data];
    create();
    await settle();
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(callbacks.failed.mock.calls[0][0].message).toBe('Loop buffer budget');
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(durationWrites).toEqual([3 * period]);
  });

  it('discards loader completion after cleanup without creating source buffers', async () => {
    let resolve;
    window.VSC.TwitterLoopSource.create.mockReturnValue({
      promise: new Promise((done) => {
        resolve = done;
      }),
      cancel: vi.fn(),
    });
    create();
    transport.cleanup();
    resolve(source);
    await settle();
    expect(instances[0].addSourceBuffer).not.toHaveBeenCalled();
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.failed).not.toHaveBeenCalled();
  });

  it('rejects an unexpected HLS fallback instead of declaring high-rate MMS ready', async () => {
    get(owner.video).holdData = true;
    create();
    await settle();
    expect(transport.ready).toBe(false);
    get(owner.video).source = hls;
    get(owner.video).ready = 4;
    owner.video.dispatchEvent(new Event('loadedmetadata'));
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(transport.closed).toBe(true);
  });

  it('hands the exact HLS fallback to an active wireless session without unloading it', async () => {
    await initialized();
    owner.committed = true;
    owner.cancelRelative = vi.fn();
    owner.video.webkitCurrentPlaybackTargetIsWireless = true;
    const loads = HTMLMediaElement.prototype.load.mock.calls.length;
    get(owner.video).source = hls;
    get(owner.video).duration = period;
    get(owner.video).time = 2;
    owner.video.dispatchEvent(new Event('loadedmetadata'));
    expect(transport.nativeFallback).toBe(true);
    expect(owner.cancelRelative).toHaveBeenCalledOnce();
    expect(transport.sourceCurrent()).toBe(true);
    expect(Object.hasOwn(owner.video, 'currentTime')).toBe(false);
    expect(owner.video.currentTime).toBe(2);
    instances[0].readyState = 'closed';
    instances[0].dispatchEvent(new Event('sourceclose'));
    expect(transport.closed).toBe(false);
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(loads);
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();
    transport.cleanup();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('preserves a newer site property while releasing every owned source and native buffer', async () => {
    await initialized();
    const replacement = () => 42;
    Object.defineProperty(owner.video, 'duration', { configurable: true, get: replacement });
    expect(transport.sourceCurrent()).toBe(false);
    const sourceBuffers = [...instances[0].buffers];
    transport.cleanup();
    expect(Object.getOwnPropertyDescriptor(owner.video, 'duration').get).toBe(replacement);
    expect(Object.hasOwn(owner.video, 'currentTime')).toBe(false);
    expect(owner.video.children).toHaveLength(0);
    expect(instances[0].removeSourceBuffer.mock.calls.map(([buffer]) => buffer)).toEqual(
      sourceBuffers
    );
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
    transport.cleanup();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('preserves a changed source child while releasing owned buffers, properties and URL', async () => {
    await initialized();
    const changed = owner.video.children[0];
    changed.src = 'https://example.com/site-owned.mp4';
    const buffers = [...instances[0].buffers];
    const loads = HTMLMediaElement.prototype.load.mock.calls.length;
    transport.cleanup();
    expect(changed.parentNode).toBe(owner.video);
    expect(changed.src).toBe('https://example.com/site-owned.mp4');
    expect(owner.video.children).toHaveLength(1);
    expect(Object.hasOwn(owner.video, 'currentTime')).toBe(false);
    expect(instances[0].removeSourceBuffer.mock.calls.map(([buffer]) => buffer)).toEqual(buffers);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(transport.ownedURL);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(loads);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  describe('caption epoch transport integration', () => {
    let previousCaption;
    beforeEach(() => {
      previousCaption = window.VSC.TwitterCaptionPlayback;
    });
    afterEach(() => {
      window.VSC.TwitterCaptionPlayback = previousCaption;
    });
    function captions() {
      let sourceReady, attachedReady;
      const state = { attached: false, current: true, period: null };
      const nativeTrack = { mode: 'showing' },
        node = document.createElement('track');
      node.src = 'blob:https://x.com/caption-epochs';
      owner.video.append(node);
      Object.defineProperty(owner.video, 'textTracks', {
        configurable: true,
        value: [nativeTrack],
      });
      const epochs = new Set();
      const caption = {
        promise: new Promise((resolve) => {
          sourceReady = resolve;
        }),
        isCurrent: vi.fn(() => state.current),
        ownsTrack: vi.fn(
          (video) =>
            node.parentNode === video &&
            video.textTracks.length === 1 &&
            video.textTracks[0] === nativeTrack
        ),
        setPeriod: vi.fn((value) => {
          state.period = value;
          return true;
        }),
        installEpoch: vi.fn((epoch) => {
          operations.push({ type: 'caption-epoch', epoch });
          epochs.add(epoch);
          return true;
        }),
        verifyEpoch: vi.fn((epoch) => epochs.has(epoch)),
        readyToPlay: vi.fn((time) => state.attached && epochs.has(Math.floor(time / state.period))),
        retireBefore: vi.fn((time) => {
          operations.push({ type: 'caption-retire', time });
          return true;
        }),
        cleanup: vi.fn(),
      };
      owner.captionOwner = caption;
      owner.candidate.captionBinding = {};
      owner.captionAttachment = new Promise((resolve) => {
        attachedReady = () => {
          state.attached = true;
          resolve();
        };
      });
      owner.prepareLoopRelease = vi.fn(() => true);
      window.VSC.TwitterCaptionPlayback = { isLoopOwner: (value) => value === caption };
      return { caption, state, sourceReady, attachedReady, node, epochs };
    }

    it('holds rate zero through source proof, B track parsing and epoch zero verification without another Play', async () => {
      const c = captions();
      create();
      await owner.video.play();
      await settle();
      expect(transport.period).toBe(period);
      expect(owner.video.playbackRate).toBe(0);
      expect(callbacks.ready).not.toHaveBeenCalled();
      expect(c.caption.installEpoch).not.toHaveBeenCalled();
      c.sourceReady();
      await settle();
      expect(owner.video.playbackRate).toBe(0);
      c.attachedReady();
      await settle();
      expect(c.caption.setPeriod).toHaveBeenCalledExactlyOnceWith(period);
      expect(c.caption.installEpoch).toHaveBeenCalledWith(0);
      expect(owner.prepareLoopRelease).toHaveBeenCalledOnce();
      expect(owner.video.playbackRate).toBe(4);
      expect(callbacks.ready).toHaveBeenCalledOnce();
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
      expect(c.caption.cleanup).not.toHaveBeenCalled();
      expect(owner.original.src).toBe('blob:https://x.com/original');
    });

    it('installs each future cue epoch before either AV track can append it, then retires only after both retained starts advance', async () => {
      const c = captions();
      c.sourceReady();
      c.attachedReady();
      await initialized();
      get(owner.video).paused = false;
      owner.video.dispatchEvent(new Event('play'));
      await settle();
      get(owner.video).time = period + 0.2;
      owner.video.dispatchEvent(new Event('timeupdate'));
      await settle();
      for (const epoch of [1, 2]) {
        const cue = operations.findIndex(
          (row) => row.type === 'caption-epoch' && row.epoch === epoch
        );
        const av = operations.findIndex(
          (row) => row.type === 'append' && row.offset === epoch * period
        );
        expect(cue).toBeGreaterThanOrEqual(0);
        expect(av).toBeGreaterThan(cue);
      }
      for (let cycle = 2; cycle <= 4; cycle++) {
        get(owner.video).time = cycle * period + 0.2;
        owner.video.dispatchEvent(new Event('timeupdate'));
        await settle();
      }
      const retirement = operations.findIndex((row) => row.type === 'caption-retire');
      const removals = operations
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.type === 'remove');
      expect(removals).toHaveLength(6);
      expect(retirement).toBeGreaterThan(removals[1].index);
      expect(c.caption.retireBefore).toHaveBeenLastCalledWith(3 * period);
      expect(instances[0].buffers.every((buffer) => buffer.buffered.start(0) >= 3 * period)).toBe(
        true
      );
      expect(callbacks.failed).not.toHaveBeenCalled();
    });

    it('never treats the caption owner as permission to ignore an additional native track', async () => {
      const c = captions();
      c.sourceReady();
      c.attachedReady();
      await initialized();
      owner.video.textTracks.push({ mode: 'showing' });
      expect(transport.sourceCurrent()).toBe(false);
      owner.video.dispatchEvent(new Event('timeupdate'));
      await settle();
      expect(callbacks.failed).toHaveBeenCalledOnce();
      expect(c.caption.cleanup).not.toHaveBeenCalled();
      expect(owner.original.src).toBe('blob:https://x.com/original');
    });

    it('does not append future AV when its cue epoch cannot be verified', async () => {
      const c = captions();
      c.sourceReady();
      c.attachedReady();
      await initialized();
      c.caption.verifyEpoch.mockImplementation((epoch) => epoch === 0);
      get(owner.video).paused = false;
      owner.video.dispatchEvent(new Event('play'));
      await settle();
      expect(callbacks.failed).toHaveBeenCalledOnce();
      expect(operations.some((row) => row.type === 'append' && row.offset > 0)).toBe(false);
      expect(c.caption.cleanup).not.toHaveBeenCalled();
    });

    it('never retires cues after a one-sided native AV removal', async () => {
      const c = captions();
      c.sourceReady();
      c.attachedReady();
      await initialized();
      get(owner.video).paused = false;
      owner.video.dispatchEvent(new Event('play'));
      await settle();
      for (let cycle = 1; cycle <= 2; cycle++) {
        get(owner.video).time = cycle * period + 0.2;
        owner.video.dispatchEvent(new Event('timeupdate'));
        await settle();
      }
      c.caption.retireBefore.mockClear();
      instances[0].buffers[1].remove.mockImplementation(function () {
        this.updating = true;
        queueMicrotask(() => {
          this.updating = false;
          this.dispatchEvent(new Event('updateend'));
        });
      });
      get(owner.video).time = 3 * period + 0.2;
      owner.video.dispatchEvent(new Event('timeupdate'));
      await settle();
      expect(callbacks.failed).toHaveBeenCalledOnce();
      expect(c.caption.retireBefore).not.toHaveBeenCalled();
    });

    it('rejects native HLS/AirPlay selection for captioned MMS rather than bypassing its cue owner', async () => {
      const c = captions();
      c.sourceReady();
      c.attachedReady();
      await initialized();
      owner.committed = true;
      owner.video.webkitCurrentPlaybackTargetIsWireless = true;
      get(owner.video).source = hls;
      owner.video.dispatchEvent(new Event('loadedmetadata'));
      expect(transport.nativeFallback).toBe(false);
      expect(callbacks.failed).toHaveBeenCalledOnce();
      expect(c.caption.cleanup).not.toHaveBeenCalled();
    });

    it('does not release or install epoch zero after teardown during native caption preparation', async () => {
      const c = captions();
      create();
      await settle();
      transport.cleanup();
      c.sourceReady();
      c.attachedReady();
      await settle();
      expect(callbacks.ready).not.toHaveBeenCalled();
      expect(callbacks.failed).not.toHaveBeenCalled();
      expect(rateWrites.filter(({ rate }) => rate > 0)).toHaveLength(0);
      expect(c.caption.installEpoch).not.toHaveBeenCalled();
      expect(c.caption.cleanup).not.toHaveBeenCalled();
    });
  });
});

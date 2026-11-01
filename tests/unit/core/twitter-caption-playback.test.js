/** Native-like handoff boundaries; actual Safari parsing/timing remain runtime QA. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/core/twitter-caption-playback.js';

describe('owned X caption playback command and cleanup', () => {
  const HLS = 'https://video.twimg.com/amplify_video/123/pl/master.m3u8';
  const MP4 = 'https://video.twimg.com/amplify_video/123/vid/1280x720/clip.mp4';
  const oracle = Array.from({ length: 15 }, (_, n) => ({
    id: '',
    start: n * 2,
    end: n * 2 + 1,
    text: `Cue ${n}${n === 2 ? '\nsecond line é' : ''}`,
    settings: '',
  }));
  const vtt = `WEBVTT\n\n${oracle
    .map(
      (cue) =>
        `00:${String(cue.start).padStart(2, '0')}.000 --> 00:${String(cue.end).padStart(2, '0')}.000\n${cue.text}\n`
    )
    .join('\n')}`;
  let video, controller, config, manager, action, nativeTracks, a, b, selected;
  let state, probes, tracks, sourceTask, resolveSource, rejectSource, modesAtPlay;
  let parserMismatch, ownedMismatch, rejectPlay, privateError, syncModeChange, delayedOwnedParse;
  const event = (type) => video.dispatchEvent(new Event(type));
  const list = (rows) => {
    const target = new EventTarget();
    for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
      rows[name] = target[name].bind(target);
    }
    return rows;
  };
  class Cue {
    constructor(startTime, endTime, text) {
      Object.assign(this, {
        id: '',
        startTime,
        endTime,
        text,
        vertical: '',
        snapToLines: true,
        line: 'auto',
        lineAlign: 'start',
        position: 'auto',
        positionAlign: 'auto',
        size: 100,
        align: 'center',
        pauseOnExit: false,
        region: null,
      });
    }
  }
  const cue = (value) =>
    Object.assign(new Cue(value.start, value.end, value.text), { id: value.id });
  const property = (node, key, value) =>
    Object.defineProperty(node, key, {
      configurable: true,
      writable: true,
      value,
    });
  const flush = async () => {
    for (let n = 0; n < 8; n++) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
    }
  };
  const result = () => ({
    vttBytes: Uint8Array.from(new TextEncoder().encode(vtt)),
    vttText: vtt,
    oracle: oracle.map((entry) => ({ ...entry })),
    rendition: { language: 'en', name: 'English' },
    duration: 37.12,
    chain: {
      hlsUrl: HLS,
      subtitleUrl: HLS.replace('master', 'captions'),
      vttUrl: 'https://video.twimg.com/subtitles/amplify_video/123/en.vtt',
    },
  });
  function ownedTrack() {
    return tracks.find((track) => track.parentNode === video);
  }
  function command(rate = 4, source = 'internal') {
    return action.setSpeed(video, rate, source);
  }
  async function commit() {
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(MP4);
    expect(ownedTrack()).toBeTruthy();
    return controller.safariPlayback;
  }
  function ownedPlayer() {
    const player = new window.VSC.IOSPlayer(controller);
    controller.iosPlayer = player;
    player.attach();
    expect(player.openPresentation()).toBe(true);
    return player;
  }
  function recoveryMedia() {
    let frame = 0;
    video.requestVideoFrameCallback = () => ++frame;
    video.cancelVideoFrameCallback = vi.fn();
    video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 100 });
    video.getBoundingClientRect = () => new DOMRect(0, 0, 320, 180);
    video.style.cssText = 'opacity:1;visibility:visible;';
    property(video, 'videoWidth', 640);
    property(video, 'videoHeight', 360);
    property(video, 'audioTracks', [{ id: 'main', label: 'Audio', language: 'en', enabled: true }]);
    property(video, 'videoTracks', [{ selected: true }]);
    property(video, 'buffered', { length: 1, start: () => 0, end: () => 37 });
  }

  beforeEach(async () => {
    document.body.replaceChildren();
    vi.spyOn(document, 'URL', 'get').mockReturnValue('https://x.com/example/status/123');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(window.VSC.IOSPlayer, 'isSupported').mockReturnValue(true);
    config = new window.VSC.VideoSpeedConfig();
    await config.load();
    config.settings.lastSpeed = 4;
    config.settings.rememberSpeed = true;
    vi.spyOn(config, 'save');
    vi.useFakeTimers();
    probes = [];
    tracks = [];
    modesAtPlay = [];
    parserMismatch = ownedMismatch = rejectPlay = privateError = syncModeChange = false;
    delayedOwnedParse = false;
    const parent = document.createElement('div');
    parent.dataset.testid = 'videoComponent';
    video = document.createElement('video');
    video.src = HLS;
    parent.append(video);
    document.body.append(parent);
    a = Object.assign(new EventTarget(), {
      kind: 'captions',
      language: '',
      label: 'English',
      mode: 'showing',
      cues: oracle.slice(0, 3).map(cue),
    });
    b = Object.assign(new EventTarget(), {
      kind: 'subtitles',
      language: 'en',
      label: 'English',
      mode: 'hidden',
      cues: oracle.slice(0, 3).map(cue),
    });
    nativeTracks = list([a, b]);
    state = {
      currentSrc: HLS,
      readyState: 4,
      duration: 37.104,
      currentTime: 3,
      playbackRate: 1,
      paused: false,
      seeking: false,
      ended: false,
    };
    for (const key of Object.keys(state)) {
      Object.defineProperty(video, key, {
        configurable: true,
        get: () => state[key],
        set: (value) => {
          state[key] = value;
        },
      });
    }
    property(video, 'textTracks', nativeTracks);
    property(video, 'audioTracks', { length: 1 });
    property(video, 'videoTracks', { length: 1 });
    // Media state is controlled by this native-like fixture; avoid jsdom's
    // queued setup volumechange event becoming a later user-volume action.
    property(video, 'muted', false);
    property(video, 'volume', 0.65);
    video.pause = vi.fn(() => {
      state.paused = true;
    });
    video.play = vi.fn(() => {
      modesAtPlay.push({ src: video.src, ownedMode: ownedTrack()?.track.mode, muted: video.muted });
      if (rejectPlay && video.src === MP4) {
        return Promise.reject(new DOMException('Gesture refused', 'NotAllowedError'));
      }
      state.paused = false;
      return Promise.resolve();
    });
    video.load = vi.fn(() => {
      state.currentSrc = '';
      state.readyState = 0;
      state.duration = NaN;
      state.paused = true;
      state.playbackRate = 1;
      if (syncModeChange) {
        nativeTracks.dispatchEvent(new Event('change'));
      }
      event('emptied');
      event('loadstart');
      setTimeout(() => {
        state.currentSrc = video.src;
        state.readyState = 4;
        state.duration = 37.12;
        for (const track of tracks.filter((node) => node.parentNode === video)) {
          const parsed = () => {
            track.readyState = 2;
            if (delayedOwnedParse) {
              track.track.cues = oracle.map(cue);
            }
            if (ownedMismatch) {
              track.track.cues.pop();
            }
            track.dispatchEvent(new Event('load'));
          };
          if (delayedOwnedParse) {
            track.readyState = 1;
            track.track.cues = [];
            track.track.mode = 'hidden';
            nativeTracks.dispatchEvent(new Event('change'));
            setTimeout(parsed, 20);
          } else {
            parsed();
          }
        }
        event('loadedmetadata');
        event('loadeddata');
      }, 1);
    });
    selected = {
      id: 0,
      contentType: 'media_entity',
      durationMs: 37104,
      hasCaptions: true,
      currentVariantIndex: 0,
      variants: [
        { type: 'application/x-mpegURL', src: HLS },
        { type: 'video/mp4', src: MP4 },
      ],
      textCues: a.cues,
    };
    parent.__reactProps$caption = {
      children: [
        null,
        {
          props: {
            playerState: {
              source: { type: 'tweet', trackId: 0 },
              currentTrackId: 0,
              hasCaptions: false,
              tracks: [selected],
            },
          },
        },
      ],
    };
    manager = new window.VSC.EventManager(config, null);
    action = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = action;
    const div = document.createElement('div');
    const speedIndicator = document.createElement('span');
    speedIndicator.textContent = '1.00';
    div.append(speedIndicator);
    controller = {
      video,
      config,
      actionHandler: action,
      disposed: false,
      div,
      speedIndicator,
      iosPlayer: { nativeSession: false, active: false },
      controlsManager: { inlinePlayer: { error: vi.fn() } },
    };
    video.vsc = controller;
    vi.spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange').mockImplementation(
      (media, rate) => {
        media.playbackRate = rate;
      }
    );
    const originalAppend = video.append.bind(video);
    video.append = (node) => {
      originalAppend(node);
      if (node.localName === 'track' && !nativeTracks.includes(node.track)) {
        nativeTracks.push(node.track);
      }
    };
    vi.stubGlobal('VTTCue', Cue);
    class FixtureURL extends window.URL {}
    FixtureURL.createObjectURL = vi.fn(() => 'blob:https://x.com/caption-owned');
    FixtureURL.revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', FixtureURL);
    const rawCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((name, options) => {
      const node = rawCreate(name, options);
      if (name === 'track') {
        const native = Object.assign(new EventTarget(), {
          kind: 'captions',
          language: 'en',
          label: 'English',
          mode: 'disabled',
          cues: oracle.map(cue),
        });
        if (parserMismatch && tracks.length === 0) {
          native.cues.pop();
        }
        property(node, 'track', native);
        property(node, 'readyState', 0);
        const remove = node.remove.bind(node);
        node.remove = () => {
          const index = nativeTracks.indexOf(native);
          if (index >= 0) {
            nativeTracks.splice(index, 1);
          }
          remove();
        };
        tracks.push(node);
      } else if (name === 'video') {
        probes.push(node);
        const privateTracks = list([]);
        property(node, 'textTracks', privateTracks);
        property(node, 'readyState', 4);
        property(node, 'duration', 37.12);
        const append = node.append.bind(node);
        node.append = (track) => {
          append(track);
          if (track.localName === 'track') {
            privateTracks.push(track.track);
          }
        };
        node.pause = vi.fn();
        node.play = vi.fn(() => Promise.reject(new Error('Private parser must never Play')));
        node.load = vi.fn(() => {
          if (!node.hasAttribute('src')) {
            return;
          }
          setTimeout(() => {
            for (const track of tracks.filter((entry) => entry.parentNode === node)) {
              track.readyState = privateError ? 3 : 2;
              track.dispatchEvent(new Event(privateError ? 'error' : 'load'));
            }
          }, 1);
        });
      }
      return node;
    });
    sourceTask = {
      cancel: vi.fn(),
      promise: new Promise((resolve, reject) => {
        resolveSource = resolve;
        rejectSource = reject;
      }),
    };
    vi.spyOn(window.VSC.TwitterCaptionSource, 'create').mockReturnValue(sourceTask);
  });

  afterEach(() => {
    if (controller instanceof window.VSC.VideoController && !controller.disposed) {
      controller.remove();
    }
    controller.twitterCaptionPending?.cleanup();
    controller.safariPlayback?.cleanup();
    controller.twitterCaptionRestore?.cleanup();
    manager.cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('prepares a complete native track without touching or playing the original before the command', async () => {
    command();
    expect(window.VSC.TwitterCaptionSource.create).toHaveBeenCalledOnce();
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
    expect(modesAtPlay.every((entry) => entry.src === HLS)).toBe(true);
    resolveSource(result());
    await flush();
    expect(video.src).toBe(MP4);
    expect(ownedTrack().track.cues).toHaveLength(15);
    expect(ownedTrack().track.cues.map((entry) => entry.text)).toEqual(
      oracle.map((entry) => entry.text)
    );
    expect(probes).toHaveLength(1);
    expect(probes[0].play).not.toHaveBeenCalled();
    expect(modesAtPlay.find((entry) => entry.src === MP4)).toMatchObject({
      ownedMode: 'showing',
      muted: false,
    });
    expect(video.volume).toBe(0.65);
    const session = controller.safariPlayback;
    await vi.advanceTimersByTimeAsync(11000);
    expect(video.src).toBe(MP4);
    expect(controller.safariPlayback).toBe(session);
    expect(session.closed).not.toBe(true);
    expect(video.load).toHaveBeenCalledOnce();
  });

  it('keeps fresh caption preparation at its accepted rate through queued native ratechange', async () => {
    expect(manager.getMediaRateState(video)?.acceptedSpeed).toBeUndefined();
    const nativeRateChange = Promise.resolve().then(() =>
      manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() })
    );
    expect(command(4, 'init')).toBe(false);
    await nativeRateChange;
    expect(video.playbackRate).toBe(1);
    expect(controller.speedIndicator.textContent).toBe('1.00');
    expect(manager.getMediaRateState(video)).toMatchObject({ lifecycleSpeed: 4, acceptedSpeed: 1 });
    expect(video.load).not.toHaveBeenCalled();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(MP4);
    expect(video.playbackRate).toBe(4);
    expect(manager.getMediaRateState(video).acceptedSpeed).toBe(4);
    expect(config.settings.lastSpeed).toBe(4);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('does not reload while initial MP4 Play is held even after complete native cue readiness', async () => {
    recoveryMedia();
    let accept,
      held = false;
    video.play.mockImplementation(() => {
      state.paused = false;
      if (video.src === MP4 && !held) {
        held = true;
        return new Promise((resolve) => {
          accept = resolve;
        });
      }
      return Promise.resolve();
    });
    const session = await commit();
    event('playing');
    await vi.advanceTimersByTimeAsync(9500);
    expect(ownedTrack().track.cues).toHaveLength(15);
    expect(video.load).toHaveBeenCalledOnce();
    accept();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(video.src).toBe(MP4);
    expect(controller.safariPlayback).toBe(session);
    expect(session.closed).not.toBe(true);
    expect(video.load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2100);
    expect(video.load).toHaveBeenCalledTimes(2);
  });

  it('hands back after initial MP4 Play never settles and ignores its late acceptance', async () => {
    recoveryMedia();
    let accept;
    const playedSources = [];
    video.play.mockImplementation(() => {
      state.paused = false;
      playedSources.push(video.src);
      return video.src === MP4
        ? new Promise((resolve) => {
            accept = resolve;
          })
        : Promise.resolve();
    });
    const session = await commit();
    event('playing');
    await vi.advanceTimersByTimeAsync(11000);
    expect(session.closed).toBe(true);
    expect(controller.safariPlayback).toBeFalsy();
    expect(video.src).toBe(HLS);
    expect(ownedTrack()).toBeUndefined();
    expect(a.mode).toBe('showing');
    expect(b.mode).toBe('hidden');
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.65);
    expect(video.load).toHaveBeenCalledTimes(2);
    expect(playedSources.filter((src) => src === MP4)).toHaveLength(1);
    const calls = [
      video.load.mock.calls.length,
      video.play.mock.calls.length,
      video.pause.mock.calls.length,
    ];
    accept();
    await flush();
    expect(video.src).toBe(HLS);
    expect([
      video.load.mock.calls.length,
      video.play.mock.calls.length,
      video.pause.mock.calls.length,
    ]).toEqual(calls);
  });

  it('shows preparing captions for the actual owned-UI command and clears it after transfer', async () => {
    recoveryMedia();
    const player = ownedPlayer();
    try {
      expect(player.applySpeed(4)).toBe(false);
      expect(video.playbackRate).toBe(1);
      expect(player.ui.refs.status.textContent).toMatch(/Preparing captions/);
      expect(player.ui.refs.speed.value).toBe('1');
      resolveSource(result());
      await flush();
      expect(player.ui.refs.status.textContent).toBe('');
      expect(player.ui.refs.speed.value).toBe('4');
    } finally {
      player.cleanup();
    }
  });

  it.each(['new UI', 'new speed'])(
    'keeps a cancelled preparation from overwriting %s status',
    async (change) => {
      recoveryMedia();
      const player = ownedPlayer();
      try {
        player.applySpeed(4);
        const pending = controller.twitterCaptionPending;
        if (change === 'new UI') {
          player.close();
          expect(player.openPresentation()).toBe(true);
          player.ui.refs.status.textContent = 'Current presentation';
          pending.cleanup();
        } else {
          expect(player.applySpeed(1)).toBe(true);
        }
        await flush();
        expect(player.ui.refs.status.textContent).toBe(
          change === 'new UI' ? 'Current presentation' : ''
        );
        expect(video.playbackRate).toBe(1);
        expect(video.src).toBe(HLS);
      } finally {
        player.cleanup();
      }
    }
  );

  it('maps both original HLS tracks with observed -3 to -18ms offsets while retaining exact complete VTT cues', async () => {
    const offsets = [-3, -6, -9, -12, -15, -18];
    for (const track of [a, b]) {
      track.cues = oracle.slice(1, 7).map((value, index) => {
        const native = cue(value);
        native.startTime += offsets[index] / 1000;
        native.endTime += offsets[index] / 1000;
        return native;
      });
    }
    selected.textCues = a.cues;
    await commit();
    const complete = ownedTrack().track.cues;
    expect(complete).toHaveLength(15);
    expect(complete.map((value) => [value.id, value.startTime, value.endTime, value.text])).toEqual(
      oracle.map((value) => [value.id, value.start, value.end, value.text])
    );
    expect(probes[0].play).not.toHaveBeenCalled();
  });

  it.each(['more than 50ms early', 'more than 50ms late', 'different text'])(
    'rejects original native cue identity with %s',
    async (reason) => {
      for (const track of [a, b]) {
        track.cues = oracle.slice(1, 7).map(cue);
        if (reason === 'different text') {
          track.cues[0].text += ' changed';
        } else {
          const delta = reason === 'more than 50ms early' ? -0.051 : 0.051;
          track.cues[0].startTime += delta;
          track.cues[0].endTime += delta;
        }
      }
      selected.textCues = a.cues;
      command();
      resolveSource(result());
      await flush();
      expect(tracks[0].track.cues).toHaveLength(15);
      expect(video.src).toBe(HLS);
      expect(video.load).not.toHaveBeenCalled();
    }
  );

  it('rejects ambiguous original cue mapping despite an exact complete private file', async () => {
    const certificate = result();
    certificate.oracle[2] = {
      ...certificate.oracle[1],
      start: certificate.oracle[1].start + 0.04,
      end: certificate.oracle[1].end + 0.04,
    };
    const timestamp = (seconds) => new Date(seconds * 1000).toISOString().slice(11, 23);
    certificate.vttText = `WEBVTT\n\n${certificate.oracle
      .map((entry) => `${timestamp(entry.start)} --> ${timestamp(entry.end)}\n${entry.text}\n`)
      .join('\n')}`;
    certificate.vttBytes = Uint8Array.from(new TextEncoder().encode(certificate.vttText));
    for (const track of [a, b]) {
      track.cues = oracle.slice(0, 2).map(cue);
    }
    selected.textCues = a.cues;
    const create = document.createElement.getMockImplementation();
    document.createElement.mockImplementation((name, options) => {
      const node = create(name, options);
      if (name === 'track') {
        node.track.cues = certificate.oracle.map(cue);
      }
      return node;
    });
    command();
    resolveSource(certificate);
    await flush();
    expect(
      tracks[0].track.cues.map((entry) => [entry.startTime, entry.endTime, entry.text])
    ).toEqual(certificate.oracle.map((entry) => [entry.start, entry.end, entry.text]));
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
  });

  it.each([
    'private parser mismatch',
    'private track error',
    'unmatched original cue',
    'two showing tracks',
  ])('refuses %s before changing the original source', async (reason) => {
    if (reason === 'private parser mismatch') {
      parserMismatch = true;
    } else if (reason === 'private track error') {
      privateError = true;
    } else if (reason === 'unmatched original cue') {
      a.cues.push(new Cue(1, 2, 'not in supplied VTT'));
    } else {
      b.mode = 'showing';
    }
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
    expect(modesAtPlay.every((entry) => entry.src === HLS)).toBe(true);
  });

  it('contains an actual caption-source rejection without starting or muting the original', async () => {
    command();
    rejectSource(new Error('finite caption source rejected'));
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
    expect(modesAtPlay.every((entry) => entry.src === HLS)).toBe(true);
    expect(video.muted).toBe(false);
    expect(controller.twitterCaptionPending).toBeFalsy();
  });

  it.each(['fulfilled', 'rejected', 'source changed'])(
    'joins the original pending Play before an automatic prepared handoff: %s',
    async (outcome) => {
      let resolvePlay, rejectPending;
      const originalPlay = new Promise((resolve, reject) => {
        resolvePlay = resolve;
        rejectPending = reject;
      });
      video.play.mockImplementation(() => {
        if (video.src === HLS) {
          expect(state.paused).toBe(false);
          return originalPlay;
        }
        state.paused = false;
        return Promise.resolve();
      });
      command(4, 'init');
      resolveSource(result());
      await flush();
      expect(video.play).toHaveBeenCalledOnce();
      expect(video.src).toBe(HLS);
      expect(video.load).not.toHaveBeenCalled();
      if (outcome === 'source changed') {
        video.src = `${HLS}?newer=1`;
        state.currentSrc = video.src;
      }
      if (outcome === 'rejected') {
        rejectPending(new DOMException('Original Play refused', 'NotAllowedError'));
      } else {
        resolvePlay();
      }
      await Promise.resolve();
      expect(video.load).not.toHaveBeenCalled();
      await flush();
      expect(video.src).toBe(
        outcome === 'fulfilled' ? MP4 : outcome === 'source changed' ? `${HLS}?newer=1` : HLS
      );
      if (outcome !== 'fulfilled') {
        expect(video.load).not.toHaveBeenCalled();
      }
    }
  );

  it('restores only its still-owned HLS after a refused MP4 Play and preserves audio intent', async () => {
    rejectPlay = true;
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(HLS);
    expect(controller.safariPlayback).toBeFalsy();
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.65);
    expect(modesAtPlay.filter((entry) => entry.src === MP4)).toHaveLength(1);
  });

  it('preserves caption selection when acquiring the MP4 source throws', async () => {
    config.settings.lastSpeed = 1;
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(video, 'src', {
      configurable: true,
      get() {
        return src.get.call(this);
      },
      set(value) {
        if (value === MP4) {
          throw new Error('Site source setter refused MP4');
        }
        src.set.call(this, value);
      },
    });
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
    expect(a.mode).toBe('showing');
    expect(b.mode).toBe('hidden');
    expect(video.playbackRate).toBe(1);
    expect(video.paused).toBe(false);
    expect(ownedTrack()).toBeUndefined();
    expect(config.save).not.toHaveBeenCalled();
    expect(config.settings.lastSpeed).toBe(1);
    event('playing');
    await flush();
    expect(window.VSC.TwitterCaptionPlayback.canBegin(controller, 4, 'init')).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
  });

  it.each(['unknown captions', 'protection'])(
    'refuses a later command after SDK %s changes without reloading or changing accepted playback',
    async (reason) => {
      await commit();
      const loads = video.load.mock.calls.length,
        plays = video.play.mock.calls.length;
      const saves = config.save.mock.calls.length;
      if (reason === 'unknown captions') {
        selected.hasCaptions = undefined;
      } else {
        selected.keySystems = { protected: true };
      }
      expect(command(3)).toBe(false);
      await flush();
      expect(controller.safariPlayback).toBeFalsy();
      expect(video.src).toBe(MP4);
      expect(video.playbackRate).toBe(4);
      expect(video.load).toHaveBeenCalledTimes(loads);
      expect(video.play).toHaveBeenCalledTimes(plays);
      expect(config.save).toHaveBeenCalledTimes(saves);
    }
  );

  it.each(['source', 'cleanup', 'pause', 'preferences', 'trusted input', 'audio'])(
    'cannot apply a prepared old caption handoff after newer %s intent',
    async (reason) => {
      const listeners = vi.spyOn(window, 'addEventListener');
      command();
      if (reason === 'source') {
        video.src = `${HLS}?new=1`;
        event('loadstart');
      } else if (reason === 'cleanup') {
        controller.twitterCaptionPending.cleanup();
      } else if (reason === 'pause') {
        state.paused = true;
        event('pause');
      } else if (reason === 'preferences') {
        config.speedPreferenceRevision++;
        config.settings.lastSpeed = 2;
      } else if (reason === 'audio') {
        video.volume = 0.2;
        event('volumechange');
      } else {
        const captured = listeners.mock.calls.find(([type]) => type === 'pointerdown')[1];
        captured({
          isTrusted: true,
          type: 'pointerdown',
          target: document.body,
          composedPath: () => [document.body],
        });
      }
      const expectedSource = video.src;
      resolveSource(result());
      await flush();
      expect(video.src).toBe(expectedSource);
      expect(video.load).not.toHaveBeenCalled();
      expect(modesAtPlay.every((entry) => entry.src === HLS)).toBe(true);
    }
  );

  it('keeps synchronous source-load mode changes from erasing intended caption On', async () => {
    syncModeChange = true;
    await commit();
    expect(ownedTrack().track.mode).toBe('showing');
    expect(modesAtPlay.find((entry) => entry.src === MP4).ownedMode).toBe('showing');
  });

  it('uses the latest caption Off chosen while the complete track is being prepared', async () => {
    command();
    a.mode = 'disabled';
    nativeTracks.dispatchEvent(new Event('change'));
    resolveSource(result());
    await flush();
    expect(video.src).toBe(MP4);
    expect(ownedTrack().track.mode).toBe('disabled');
    expect(modesAtPlay.find((entry) => entry.src === MP4).ownedMode).toBe('disabled');
  });

  it('refuses an incomplete fresh native track after the original MP4 load', async () => {
    ownedMismatch = true;
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(HLS);
    expect(controller.safariPlayback).toBeFalsy();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('retains relative pending intent across a delayed owned speed-button pointerdown and click', async () => {
    const shadow = controller.div.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.dataset.action = 'faster';
    shadow.append(button);
    const listeners = vi.spyOn(window, 'addEventListener');
    command();
    const pending = controller.twitterCaptionPending;
    const captured = listeners.mock.calls.find(([type]) => type === 'pointerdown')[1];
    captured({
      isTrusted: true,
      type: 'pointerdown',
      target: button,
      composedPath: () => [button, shadow, controller.div],
    });
    await vi.advanceTimersByTimeAsync(75);
    expect(controller.twitterCaptionPending).toBe(pending);
    action.adjustSpeed(video, 0.1, { relative: true, source: 'internal' });
    expect(video.playbackRate).toBe(1);
    expect(window.VSC.TwitterCaptionPlayback.requestedSpeed(controller)).toBe(4.1);
    resolveSource(result());
    await flush();
    expect(video.src).toBe(MP4);
    expect(video.playbackRate).toBe(4.1);
    expect(modesAtPlay.filter((entry) => entry.src === MP4)).toHaveLength(1);
  });

  it('ignores an old rejected Play after the site replaces the owned MP4', async () => {
    let reject;
    video.play.mockImplementation(() => {
      if (video.src === HLS) {
        return Promise.resolve();
      }
      state.paused = false;
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    });
    await commit();
    const foreign = `${HLS}?site=replacement`;
    video.src = foreign;
    state.currentSrc = foreign;
    event('loadstart');
    reject(new DOMException('Old Play refused', 'NotAllowedError'));
    await flush();
    expect(video.src).toBe(foreign);
    expect(controller.controlsManager.inlinePlayer.error).not.toHaveBeenCalled();
    expect(controller.safariPlayback).toBeFalsy();
  });

  it('releases the full track and restores current time, rate, and latest caption Off on handback', async () => {
    const session = await commit();
    const track = ownedTrack();
    track.track.mode = 'disabled';
    nativeTracks.dispatchEvent(new Event('change'));
    state.currentTime = 12.5;
    state.playbackRate = 3;
    session.cleanup();
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.currentTime).toBe(12.5);
    expect(video.playbackRate).toBe(3);
    expect(track.isConnected).toBe(false);
    expect(a.mode).not.toBe('showing');
    expect(b.mode).not.toBe('showing');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('keeps the caption certificate and presentation through reload until delayed full native cues are ready', async () => {
    recoveryMedia();
    for (const entry of a.cues) {
      Object.assign(entry, { line: 90.762, snapToLines: false });
    }
    const session = await commit();
    const track = ownedTrack();
    const fields = [
      'startTime',
      'endTime',
      'text',
      'vertical',
      'snapToLines',
      'line',
      'lineAlign',
      'position',
      'positionAlign',
      'size',
      'align',
      'pauseOnExit',
      'region',
    ];
    const snapshot = () =>
      track.track.cues.map((entry) => Object.fromEntries(fields.map((key) => [key, entry[key]])));
    const full = snapshot();
    expect(full.every((entry) => entry.line === 90.762 && entry.snapToLines === false)).toBe(true);
    const player = ownedPlayer();
    const nativeLoad = video.load.getMockImplementation(),
      loads = [];
    video.load.mockImplementation(() => {
      loads.push(video.src);
      nativeLoad();
    });
    try {
      const ui = player.ui;
      delayedOwnedParse = true;
      event('playing');
      await vi.advanceTimersByTimeAsync(3002);
      expect(loads).toEqual([MP4]);
      expect(track.readyState).toBe(1);
      expect(track.track.mode).toBe('hidden');
      expect(session.recovery.reload).toBeTruthy();
      expect(player.active).toBe(true);
      await vi.advanceTimersByTimeAsync(30);
      expect(session.recovery.reload).toBeFalsy();
      expect(snapshot()).toEqual(full);
      expect(track.track.cues).toHaveLength(15);
      expect(track.track.mode).toBe('showing');
      expect(nativeTracks.slice(0, 2)).toEqual([a, b]);
      expect(player.ui).toBe(ui);
      expect(player.active).toBe(true);
      expect(video.src).toBe(MP4);
    } finally {
      video.load.mockImplementation(nativeLoad);
      player.cleanup();
    }
  });
});

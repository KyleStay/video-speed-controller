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
  let parserMismatch, ownedMismatch, rejectPlay, privateError, syncModeChange;
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
          track.readyState = 2;
          if (ownedMismatch) {
            track.track.cues.pop();
          }
          track.dispatchEvent(new Event('load'));
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
  });

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

  it('rejects private complete-file timing drift above 2ms even when original HLS cues match', async () => {
    const create = document.createElement.getMockImplementation();
    document.createElement.mockImplementation((name, options) => {
      const node = create(name, options);
      if (name === 'track' && tracks[0] === node) {
        node.track.cues[0].startTime += 0.003;
        node.track.cues[0].endTime += 0.003;
      }
      return node;
    });
    command();
    resolveSource(result());
    await flush();
    expect(tracks[0].track.cues).toHaveLength(15);
    expect(video.src).toBe(HLS);
    expect(video.load).not.toHaveBeenCalled();
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

  it('keeps a programmatic site Pause when pending continuation Play rejects with AbortError', async () => {
    let rejectPending;
    video.play.mockImplementation(() => {
      if (video.src === HLS) {
        state.paused = false;
        return Promise.resolve();
      }
      state.paused = false;
      return new Promise((_resolve, reject) => {
        rejectPending = reject;
      });
    });
    await commit();
    expect(video.src).toBe(MP4);
    video.pause();
    event('pause');
    expect(video.paused).toBe(true);
    video.play.mockClear();
    rejectPending(new DOMException('Play interrupted by site Pause', 'AbortError'));
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(a.mode).toBe('showing');
    expect(controller.safariPlayback).toBeNull();
  });

  it('does not invoke foreign Play returned by a getter during the first MP4 continuation', async () => {
    const originalPlay = video.play;
    const foreign = 'https://video.twimg.com/amplify_video/999/vid/new.mp4';
    const foreignPlay = vi.fn(() => {
      state.paused = false;
      return Promise.resolve();
    });
    Object.defineProperty(video, 'play', {
      configurable: true,
      get() {
        if (video.src === HLS) {
          return originalPlay;
        }
        video.src = foreign;
        Object.assign(state, {
          currentSrc: foreign,
          currentTime: 7,
          playbackRate: 0.75,
          paused: true,
        });
        return foreignPlay;
      },
    });
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(foreign);
    expect(video.currentTime).toBe(7);
    expect(video.playbackRate).toBe(0.75);
    expect(video.paused).toBe(true);
    expect(foreignPlay).not.toHaveBeenCalled();
    expect(controller.safariPlayback).toBeNull();
    expect(ownedTrack()).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it.each(['unmute', 'volume'])(
    'preserves a committed user %s change through caption playback and handback',
    async (kind) => {
      if (kind === 'unmute') {
        video.muted = true;
      }
      const session = await commit();
      const track = ownedTrack();
      if (kind === 'unmute') {
        video.muted = false;
      } else {
        video.volume = 0.2;
      }
      event('volumechange');
      expect(controller.safariPlayback).toBe(session);
      expect(session.ownsSource()).toBe(true);
      expect(track.track.mode).toBe('showing');
      session.cleanup();
      await flush();
      expect(video.src).toBe(HLS);
      expect(video.muted).toBe(false);
      expect(video.volume).toBe(kind === 'volume' ? 0.2 : 0.65);
    }
  );

  it('keeps failed initialization suppressed after an external rate command but permits an explicit retry', async () => {
    rejectPlay = true;
    command();
    resolveSource(result());
    await flush();
    expect(video.src).toBe(HLS);
    expect(window.VSC.TwitterCaptionPlayback.canBegin(controller, 4, 'init')).toBe(false);
    command(3, 'external');
    expect(window.VSC.TwitterCaptionPlayback.canBegin(controller, 4, 'init')).toBe(false);
    rejectPlay = false;
    command(4, 'internal');
    await flush();
    expect(video.src).toBe(MP4);
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

  it.each([
    ['hidden', false],
    ['pagehide', false],
    ['hidden', true],
    ['pagehide', true],
  ])(
    'preserves caption playback on %s cleanup without reviving a foreign source=%s',
    async (reason, foreign) => {
      await commit();
      const track = ownedTrack();
      const foreignSource = `${HLS}?site=newer`;
      if (foreign) {
        video.src = foreignSource;
        state.currentSrc = foreignSource;
      }
      video.play.mockClear();
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      if (reason === 'hidden') {
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        window.dispatchEvent(new Event('pagehide'));
      }
      await flush();
      expect(video.src).toBe(foreign ? foreignSource : HLS);
      expect(track.isConnected).toBe(false);
      expect(video.play).not.toHaveBeenCalled();
      if (!foreign) {
        expect(a.mode).toBe('showing');
      }
    }
  );

  it('does not let late handback readiness overwrite a newer native caption On choice', async () => {
    const session = await commit();
    ownedTrack().track.mode = 'disabled';
    nativeTracks.dispatchEvent(new Event('change'));
    session.cleanup();
    expect(a.mode).toBe('disabled');
    a.mode = 'showing';
    nativeTracks.dispatchEvent(new Event('change'));
    event('loadeddata');
    nativeTracks.dispatchEvent(new Event('addtrack'));
    await flush();
    expect(a.mode).toBe('showing');
  });

  it('restores caption On while ready HLS precedes the real SDK selected-index handback', async () => {
    const session = await commit();
    selected.currentVariantIndex = 1;
    expect(selected.variants[selected.currentVariantIndex].src).toBe(MP4);
    expect(session.candidate.revalidate()).toBe(true);
    const plays = video.play.mock.calls.length;
    session.cleanup();
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.currentSrc).toBe(HLS);
    expect(video.readyState).toBe(4);
    expect(selected.currentVariantIndex).toBe(1);
    expect(a.mode).toBe('showing');
    expect(b.mode).not.toBe('showing');
    selected.currentVariantIndex = 0;
    event('loadeddata');
    nativeTracks.dispatchEvent(new Event('addtrack'));
    await flush();
    expect(a.mode).toBe('showing');
    expect(video.play.mock.calls.length).toBe(plays + 1);
    expect(controller.twitterCaptionRestore).toBeFalsy();
  });

  it.each(['same clip', 'foreign source', 'new SDK clip'])(
    'hands caption playback back after a poster change only for %s',
    async (change) => {
      const session = await commit();
      const track = ownedTrack();
      const foreign = 'https://video.twimg.com/amplify_video/999/vid/new.mp4';
      const poster = 'https://pbs.twimg.com/new-poster.jpg';
      if (change === 'foreign source') {
        video.src = foreign;
        state.currentSrc = foreign;
      } else if (change === 'new SDK clip') {
        const sdk = video.parentElement.__reactProps$caption.children[1].props.playerState;
        sdk.source = { ...sdk.source, trackId: 1 };
        sdk.currentTrackId = 1;
        sdk.tracks = [{ ...selected, id: 1 }];
        expect(session.candidate.revalidate()).toBe(false);
      }
      video.load.mockClear();
      video.play.mockClear();
      video.setAttribute('poster', poster);
      await flush();
      expect(video.getAttribute('poster')).toBe(poster);
      expect(track.isConnected).toBe(false);
      expect(controller.safariPlayback).toBeNull();
      if (change === 'same clip') {
        expect(video.src).toBe(HLS);
        expect(a.mode).toBe('showing');
        expect(b.mode).not.toBe('showing');
      } else {
        expect(video.src).toBe(change === 'foreign source' ? foreign : MP4);
        expect(video.load).not.toHaveBeenCalled();
        expect(video.play).not.toHaveBeenCalled();
      }
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    }
  );

  it('yields foreign source, time, rate and Pause intent written synchronously by restore load', async () => {
    const session = await commit();
    state.currentTime = 12;
    const foreign = 'https://video.twimg.com/amplify_video/999/vid/new.mp4';
    video.load.mockImplementation(() => {
      video.src = foreign;
      Object.assign(state, {
        currentSrc: foreign,
        currentTime: 7,
        playbackRate: 0.75,
        paused: true,
      });
    });
    video.play.mockClear();
    const track = ownedTrack();
    session.cleanup();
    await flush();
    expect(video.src).toBe(foreign);
    expect(video.currentTime).toBe(7);
    expect(video.playbackRate).toBe(0.75);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(track.isConnected).toBe(false);
    expect(controller.safariPlayback).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it.each(['pause', 'src', 'currentTime', 'playbackRate'])(
    'stops handback after a page replaces the source during restore %s',
    async (boundary) => {
      const session = await commit();
      state.currentTime = 12;
      const track = ownedTrack();
      const foreign = 'https://video.twimg.com/amplify_video/999/vid/new.mp4';
      const setAttribute = video.setAttribute.bind(video);
      const siteReplacement = () => {
        setAttribute('src', foreign);
        Object.assign(state, {
          currentSrc: foreign,
          currentTime: 7,
          playbackRate: 0.75,
          paused: true,
        });
      };
      video.load.mockImplementation(() => {
        Object.assign(state, { currentSrc: video.src, readyState: 4, paused: true });
      });
      if (boundary === 'pause') {
        video.pause.mockImplementationOnce(siteReplacement);
      } else if (boundary === 'src') {
        vi.spyOn(video, 'setAttribute').mockImplementation((name, value) => {
          setAttribute(name, value);
          if (name === 'src' && value === HLS) {
            siteReplacement();
          }
        });
      } else {
        Object.defineProperty(video, boundary, {
          configurable: true,
          get: () => state[boundary],
          set(value) {
            state[boundary] = value;
            siteReplacement();
          },
        });
      }
      video.play.mockClear();
      video.load.mockClear();
      session.cleanup();
      await flush();
      expect(video.src).toBe(foreign);
      expect(video.currentTime).toBe(7);
      expect(video.playbackRate).toBe(0.75);
      expect(video.paused).toBe(true);
      expect(video.play).not.toHaveBeenCalled();
      if (boundary === 'pause' || boundary === 'src') {
        expect(video.load).not.toHaveBeenCalled();
      }
      expect(track.isConnected).toBe(false);
      expect(controller.safariPlayback).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    }
  );

  it('does not treat source away-and-back during restore load as continued handback ownership', async () => {
    const session = await commit();
    state.currentTime = 12;
    video.load.mockImplementation(() => {
      video.src = 'https://video.twimg.com/amplify_video/999/vid/new.mp4';
      video.src = HLS;
      Object.assign(state, {
        currentSrc: HLS,
        currentTime: 7,
        playbackRate: 0.75,
        paused: true,
      });
    });
    video.play.mockClear();
    session.cleanup();
    await flush();
    expect(video.src).toBe(HLS);
    expect(video.currentTime).toBe(7);
    expect(video.playbackRate).toBe(0.75);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(controller.twitterCaptionRestore).toBeFalsy();
  });

  it('does not invoke a Play method after its page getter changes source and Pause intent', async () => {
    const session = await commit();
    const track = ownedTrack();
    const foreign = 'https://video.twimg.com/amplify_video/999/vid/new.mp4';
    const foreignPlay = vi.fn(() => {
      state.paused = false;
      return Promise.resolve();
    });
    video.load.mockImplementation(() => {
      Object.assign(state, { currentSrc: video.src, readyState: 4, paused: true });
    });
    Object.defineProperty(video, 'play', {
      configurable: true,
      get() {
        video.src = foreign;
        Object.assign(state, {
          currentSrc: foreign,
          currentTime: 7,
          playbackRate: 0.75,
          paused: true,
        });
        return foreignPlay;
      },
    });
    session.cleanup();
    await flush();
    expect(video.src).toBe(foreign);
    expect(video.currentTime).toBe(7);
    expect(video.playbackRate).toBe(0.75);
    expect(video.paused).toBe(true);
    expect(foreignPlay).not.toHaveBeenCalled();
    expect(track.isConnected).toBe(false);
    expect(controller.twitterCaptionRestore).toBeFalsy();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('restores its exact owned HLS and latest caption state through real controller teardown', async () => {
    delete video.vsc;
    config.settings.lastSpeed = 1;
    controller = new window.VSC.VideoController(
      video,
      video.parentElement,
      config,
      action,
      false,
      1
    );
    config.settings.lastSpeed = 4;
    await commit();
    const track = ownedTrack();
    track.track.mode = 'disabled';
    nativeTracks.dispatchEvent(new Event('change'));
    controller.remove();
    await flush();
    expect(controller.disposed).toBe(true);
    expect(video.src).toBe(HLS);
    expect(video.vsc).toBeUndefined();
    expect(track.isConnected).toBe(false);
    expect(a.mode).not.toBe('showing');
    expect(b.mode).not.toBe('showing');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('releases an older handback owner through real controller removal before held metadata returns', async () => {
    delete video.vsc;
    config.settings.lastSpeed = 1;
    controller = new window.VSC.VideoController(
      video,
      video.parentElement,
      config,
      action,
      false,
      1
    );
    config.settings.lastSpeed = 4;
    const session = await commit();
    // The HLS handback has begun, but its decoder has not delivered metadata.
    // This leaves the bounded mode-restoration owner alive after the session.
    video.load.mockImplementationOnce(() => {
      state.currentSrc = '';
      state.readyState = 0;
      state.duration = NaN;
      state.paused = true;
      event('emptied');
      event('loadstart');
    });
    const targets = [video, nativeTracks, window];
    const registrations = targets.map((target) => ({
      added: vi.spyOn(target, 'addEventListener'),
      removed: vi.spyOn(target, 'removeEventListener'),
    }));
    const scheduled = vi.spyOn(window, 'setTimeout');
    const cleared = vi.spyOn(window, 'clearTimeout');
    const observed = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');
    session.cleanup();
    expect(controller.safariPlayback).toBeNull();
    expect(video.src).toBe(HLS);
    expect(video.readyState).toBe(0);
    const restore = controller.twitterCaptionRestore;
    expect(restore).toBeTruthy();
    expect(scheduled).toHaveBeenCalledOnce();
    const timeout = scheduled.mock.results[0].value;
    const observers = [...observed.mock.instances];
    expect(observers.length).toBeGreaterThan(0);
    const cleanup = vi.spyOn(restore, 'cleanup');
    controller.remove();
    expect(controller.disposed).toBe(true);
    expect(video.vsc).toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(controller.twitterCaptionRestore).toBeNull();
    expect(cleared).toHaveBeenCalledWith(timeout);
    for (const observer of observers) {
      expect(disconnected.mock.instances).toContain(observer);
    }
    for (const { added, removed } of registrations) {
      for (const [type, listener, options] of added.mock.calls) {
        expect(
          removed.mock.calls.some(
            ([removedType, removedListener, removedOptions]) =>
              type === removedType && listener === removedListener && options === removedOptions
          )
        ).toBe(true);
      }
    }
  });

  it.each(['muted', 'volume'])(
    'releases every session resource when restore-enabled cleanup encounters a throwing %s getter',
    async (field) => {
      const added = vi.spyOn(video, 'addEventListener');
      const removed = vi.spyOn(video, 'removeEventListener');
      const cleared = vi.spyOn(window, 'clearTimeout');
      const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const session = await commit();
      const track = ownedTrack();
      const value = video[field];
      Object.defineProperty(video, field, {
        configurable: true,
        get() {
          throw Error(`Page ${field} getter failed during handback`);
        },
      });
      try {
        expect(() => session.cleanup()).not.toThrow();
        expect(session.closed).toBe(true);
        expect(session.cleanupInProgress).toBe(false);
        expect(controller.safariPlayback).toBeNull();
        expect(controller.twitterCaptionRestore).toBeFalsy();
        expect(session.listeners).toHaveLength(0);
        expect(track.isConnected).toBe(false);
        expect(tracks.every((element) => !element.isConnected)).toBe(true);
        expect(probes[0].getAttribute('src')).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalled();
        expect(cleared).toHaveBeenCalledWith(session.deadline);
        expect(disconnected.mock.instances).toContain(session.observer);
        for (const [type, listener, options] of added.mock.calls) {
          expect(
            removed.mock.calls.some(
              ([removedType, removedListener, removedOptions]) =>
                type === removedType && listener === removedListener && options === removedOptions
            )
          ).toBe(true);
        }
        expect(() => session.cleanup()).not.toThrow();
        expect(session.cleanupInProgress).toBe(false);
      } finally {
        property(video, field, value);
      }
    }
  );

  it.each(['currentTime', 'playbackRate', 'paused'])(
    'releases independent resources when cleanup cannot read native %s',
    async (field) => {
      const added = vi.spyOn(video, 'addEventListener');
      const removed = vi.spyOn(video, 'removeEventListener');
      const cleared = vi.spyOn(window, 'clearTimeout');
      const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const session = await commit();
      const track = ownedTrack();
      Object.defineProperty(video, field, {
        configurable: true,
        get() {
          throw Error('site replaced getter');
        },
      });
      expect(() => session.cleanup({ restore: false })).not.toThrow();
      expect(track.isConnected).toBe(false);
      expect(controller.safariPlayback).toBeFalsy();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
      expect(cleared).toHaveBeenCalledWith(session.deadline);
      expect(disconnected.mock.instances).toContain(session.observer);
      for (const [type, listener, options] of added.mock.calls) {
        expect(
          removed.mock.calls.some(
            ([removedType, removedListener, removedOptions]) =>
              type === removedType && listener === removedListener && options === removedOptions
          )
        ).toBe(true);
      }
      property(video, field, state[field]);
    }
  );
});

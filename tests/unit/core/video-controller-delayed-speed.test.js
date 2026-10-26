import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  simulateExternalStorageWrite,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

describe('VideoController deferred speed initialization', () => {
  let dom;
  let config;
  let manager;
  let action;
  let controllers;

  beforeEach(async () => {
    installChromeMock();
    resetMockStorage();
    dom = createMockDOM();
    controllers = [];
    window.VSC.siteHandlerManager.initialize(document);
    config = new window.VSC.VideoSpeedConfig();
    await config.load();
    config.settings.lastSpeed = 1.5;
    config.settings.rememberSpeed = true;
    vi.spyOn(config, 'save');
    manager = new window.VSC.EventManager(config, null);
    action = new window.VSC.ActionHandler(config, manager);
    manager.actionHandler = action;
  });

  afterEach(() => {
    for (const controller of controllers) {
      if (!controller.disposed) {
        controller.remove();
      }
    }
    manager.cleanup();
    if (config.saveTimer) {
      clearTimeout(config.saveTimer);
    }
    cleanupChromeMock();
    window.VSC.stateManager.controllers.clear();
    dom.cleanup();
    vi.restoreAllMocks();
  });

  function attach(video = createMockVideo({ readyState: 0 })) {
    if (!video.isConnected) {
      dom.container.append(video);
    }
    const controller = new window.VSC.VideoController(video, null, config, action);
    controllers.push(controller);
    return { video, controller };
  }

  function metadata(video) {
    video.readyState = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
  }

  it('uses a newer external preference for metadata and later play/seek recovery', () => {
    const { video, controller } = attach();
    const revision = config.speedPreferenceRevision;
    simulateExternalStorageWrite({ lastSpeed: 2.25 });
    expect(config.speedPreferenceRevision).toBe(revision + 1);

    metadata(video);

    expect(video.playbackRate).toBe(2.25);
    expect(controller.initMetadataHandler).toBeNull();
    expect(manager.getMediaRateState(video).lifecycleSpeedRevision).toBe(
      config.speedPreferenceRevision
    );
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('seeked'));
    expect(video.playbackRate).toBe(2.25);
    expect(config.settings.lastSpeed).toBe(2.25);
    expect(config.save).not.toHaveBeenCalled();
  });

  it('skips an obsolete write when the new preference already matches playback', () => {
    const { video } = attach();
    const adjust = vi.spyOn(action, 'adjustSpeed');
    simulateExternalStorageWrite({ lastSpeed: 1 });

    metadata(video);

    expect(video.playbackRate).toBe(1);
    expect(adjust).not.toHaveBeenCalled();
    expect(config.save).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    'does no speed work after metadata when the accepted %s rate needs no switch',
    (rate) => {
      config.settings.lastSpeed = rate;
      const { video } = attach(createMockVideo({ readyState: 0, playbackRate: rate }));
      const adjust = vi.spyOn(action, 'adjustSpeed');

      metadata(video);

      expect(video.playbackRate).toBe(rate);
      expect(adjust).not.toHaveBeenCalled();
      expect(config.save).not.toHaveBeenCalled();
    }
  );

  it('preserves a newer session command even without a preference revision change', () => {
    config.settings.rememberSpeed = false;
    const { video } = attach();
    const revision = config.speedPreferenceRevision;
    action.adjustSpeed(video, 2.5);
    expect(config.speedPreferenceRevision).toBe(revision);

    metadata(video);

    expect(video.playbackRate).toBe(2.5);
    expect(config.settings.lastSpeed).toBe(2.5);
    expect(config.save).not.toHaveBeenCalled();
  });

  it.each(['before attachment', 'while loading'])(
    'selects the supplied MP4 when a fast rate was accepted %s',
    async (timing) => {
      const hls = 'https://video.twimg.com/ext_tw_video/123/pu/pl/original.m3u8';
      const mp4 = 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/720x1280/original.mp4';
      config.settings.lastSpeed = 4;
      const target = timing === 'before attachment' ? 4 : 2.5;
      const video = createMockVideo({
        readyState: 0,
        currentSrc: hls,
        playbackRate: timing === 'before attachment' ? target : 1,
      });
      video.src = hls;
      dom.container.__reactProps$hls = { children: { props: { src: hls, downloadUrl: mp4 } } };
      // Only the platform is substituted; use the real source resolver and transition.
      vi.spyOn(window.VSC.SafariHLSPlayback, 'matches').mockReturnValue(true);
      const load = vi.spyOn(video, 'load').mockImplementation(() => {});
      attach(video);

      if (timing === 'while loading') {
        action.adjustSpeed(video, target);
      }
      expect(video.playbackRate).toBe(target);
      expect(load).not.toHaveBeenCalled();
      vi.mocked(config.save).mockClear();

      metadata(video);

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      expect(video.src).toBe(mp4);
      expect(video.playbackRate).toBe(target);
      expect(config.settings.lastSpeed).toBe(target);
      expect(config.save).not.toHaveBeenCalled();
    }
  );

  it('retains the unchanged null preference and site baseline without persisting init', () => {
    config.settings.lastSpeed = null;
    config.settings.siteDefaultSpeed = 1.75;
    const { video } = attach();

    metadata(video);

    expect(video.playbackRate).toBe(1.75);
    expect(config.settings.lastSpeed).toBeNull();
    expect(config.save).not.toHaveBeenCalled();
  });

  it("preserves this media's current rate when a sibling command changes shared preference", () => {
    config.settings.rememberSpeed = false;
    const { video } = attach();
    action.adjustSpeed(video, 2.5);
    const sibling = attach(createMockVideo({ readyState: 1 })).video;
    action.adjustSpeed(sibling, 3);

    metadata(video);

    expect(video.playbackRate).toBe(2.5);
    expect(config.settings.lastSpeed).toBe(3);
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('seeked'));
    expect(video.playbackRate).toBe(2.5);
  });

  it('supersedes an older local rate after an external preference revision', () => {
    config.settings.rememberSpeed = false;
    const { video } = attach();
    action.adjustSpeed(video, 2.5);
    simulateExternalStorageWrite({ lastSpeed: 3.25 });

    metadata(video);

    expect(video.playbackRate).toBe(3.25);
    expect(manager.getMediaRateState(video).lifecycleSpeedRevision).toBe(
      config.speedPreferenceRevision
    );
  });

  it('cancels initialization when removed before metadata', () => {
    const { video, controller } = attach();
    const adjust = vi.spyOn(action, 'adjustSpeed');
    controller.remove();

    metadata(video);

    expect(video.playbackRate).toBe(1);
    expect(controller.initMetadataHandler).toBeNull();
    expect(adjust).not.toHaveBeenCalled();
  });

  it('ignores a captured metadata callback after removal', () => {
    const { video, controller } = attach();
    const pending = controller.initMetadataHandler;
    controller.remove();
    const adjust = vi.spyOn(action, 'adjustSpeed');

    pending();

    expect(video.playbackRate).toBe(1);
    expect(adjust).not.toHaveBeenCalled();
  });

  it('does not let an old callback initialize a replacement controller on the same node', () => {
    const { video, controller } = attach();
    const pending = controller.initMetadataHandler;
    controller.remove();
    config.settings.lastSpeed = 2.75;
    const replacement = attach(video).controller;
    const replacementPending = replacement.initMetadataHandler;
    const adjust = vi.spyOn(action, 'adjustSpeed');

    pending();

    expect(video.vsc).toBe(replacement);
    expect(replacement.initMetadataHandler).toBe(replacementPending);
    expect(video.playbackRate).toBe(1);
    expect(adjust).not.toHaveBeenCalled();
    metadata(video);
    expect(video.playbackRate).toBe(2.75);
  });
});

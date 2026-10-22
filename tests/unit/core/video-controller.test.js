/**
 * Unit tests for VideoController class
 * Using global variables to match browser extension architecture
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  simulateExternalStorageWrite,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';

// Load all required modules

let mockDOM;

describe('VideoController', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    // Clear state manager for tests
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    // Initialize site handler manager for tests
    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();

    // Clear state manager after each test to prevent state leakage
    if (window.VSC && window.VSC.stateManager) {
      window.VSC.stateManager.controllers.clear();
    }

    // Remove any lingering video elements
    document.querySelectorAll('video, audio').forEach((el) => el.remove());

    if (mockDOM) {
      mockDOM.cleanup();
    }
  });

  it('VideoController should initialize with video element', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller).toBeDefined();
    expect(controller.video).toBe(mockVideo);
    expect(controller.div).toBeDefined();
    expect(mockVideo.vsc).toBeDefined();
    expect(mockVideo.vsc).toBe(controller);
  });

  it('VideoController should return existing controller if already attached', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller1 = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    const controller2 = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller1).toBe(controller2);
  });

  it('VideoController should initialize speed based on settings', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 2.0;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(mockVideo.playbackRate).toBe(2.0);
  });

  it('VideoController should create controller UI', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.div).toBeDefined();
    expect(controller.div.classList.contains('vsc-controller')).toBe(true);
    expect(controller.speedIndicator).toBeDefined();
  });

  it('VideoController should handle video without source', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ currentSrc: '' });
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.div.classList.contains('vsc-nosource')).toBe(true);
  });

  it('VideoController should start hidden when configured', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.startHidden = true;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.div.classList.contains('vsc-hidden')).toBe(true);
  });

  it('VideoController should clean up properly when removed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    controller.div.flashTimer = setTimeout(() => {}, 1000);
    const flashTimer = controller.div.flashTimer;
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const cancelPendingPlayback = vi.fn();
    controller.safariPlaybackPending = { cleanup: cancelPendingPlayback };

    // Verify setup
    expect(mockVideo.vsc).toBeDefined();
    expect(window.VSC.stateManager.controllers.size).toBe(1);

    // Remove controller
    controller.remove();

    // Verify cleanup
    expect(mockVideo.vsc).toBe(undefined);
    expect(window.VSC.stateManager.controllers.size).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(flashTimer);
    expect(cancelPendingPlayback).toHaveBeenCalledOnce();

    clearTimeoutSpy.mockRestore();
  });

  it('VideoController should register with state manager', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo1 = createMockVideo();
    const mockVideo2 = createMockVideo();
    mockDOM.container.appendChild(mockVideo1);
    mockDOM.container.appendChild(mockVideo2);

    // State manager should be clean from beforeEach
    expect(window.VSC.stateManager.controllers.size).toBe(0);

    const controller1 = new window.VSC.VideoController(
      mockVideo1,
      mockDOM.container,
      config,
      actionHandler
    );
    expect(window.VSC.stateManager.controllers.size).toBe(1);

    const controller2 = new window.VSC.VideoController(
      mockVideo2,
      mockDOM.container,
      config,
      actionHandler
    );
    expect(window.VSC.stateManager.controllers.size).toBe(2);

    // Clean up
    controller1.remove();
    controller2.remove();
    expect(window.VSC.stateManager.controllers.size).toBe(0);
  });

  it('VideoController should initialize speed using adjustSpeed method', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable global persistence
    config.settings.lastSpeed = 1.75;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/test.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);

    // Track adjustSpeed calls
    let adjustSpeedCalled = false;
    let adjustSpeedParams = null;
    const originalAdjustSpeed = actionHandler.adjustSpeed;
    actionHandler.adjustSpeed = function (video, value, options) {
      adjustSpeedCalled = true;
      adjustSpeedParams = { video, value, options };
      return originalAdjustSpeed.call(this, video, value, options);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have called adjustSpeed with the stored speed
    expect(adjustSpeedCalled).toBe(true);
    expect(adjustSpeedParams.value).toBe(1.75);
    expect(adjustSpeedParams.video).toBe(mockVideo);
    expect(mockVideo.playbackRate).toBe(1.75);
  });

  it('VideoController should handle initialization with no stored speed', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = false;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/new-video.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should remain at default speed when no stored speed exists
    expect(mockVideo.playbackRate).toBe(1.0);
  });

  it('VideoController should initialize in global speed mode correctly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Global mode
    config.settings.lastSpeed = 2.25;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should use global lastSpeed
    expect(mockVideo.playbackRate).toBe(2.25);
  });

  it('VideoController should properly setup event handlers', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);

    // Track event listeners added
    const addedListeners = [];
    const originalAddEventListener = mockVideo.addEventListener;
    mockVideo.addEventListener = function (type, listener, options) {
      addedListeners.push({ type, listener, options });
      return originalAddEventListener.call(this, type, listener, options);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have added media event listeners
    expect(addedListeners.length > 0).toBe(true); // Should have added some listeners

    // Should have proper vsc structure with speedIndicator
    expect(mockVideo.vsc).toBeDefined();
    expect(mockVideo.vsc.speedIndicator).toBeDefined();
    // Speed indicator should show current playback rate
    expect(mockVideo.vsc.speedIndicator.textContent).toBeDefined();
  });

  it('VideoController should handle media events correctly', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true; // Enable global persistence
    config.settings.lastSpeed = 1.5;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/video.mp4',
      playbackRate: 1.0,
    });
    mockDOM.container.appendChild(mockVideo);

    // Track adjustSpeed calls during events
    const adjustSpeedCalls = [];
    const originalAdjustSpeed = actionHandler.adjustSpeed;
    actionHandler.adjustSpeed = function (video, value, options) {
      adjustSpeedCalls.push({ video, value, options });
      return originalAdjustSpeed.call(this, video, value, options);
    };

    const _controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    // Should have called adjustSpeed during initialization
    expect(adjustSpeedCalls.length > 0).toBe(true);
    const initCall = adjustSpeedCalls.find((call) => call.value === 1.5);
    expect(initCall).toBeDefined();
  });

  it('play event restore does not overwrite lastSpeed (#1494)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    config.settings.rememberSpeed = true;
    config.settings.lastSpeed = 1.8;

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({
      currentSrc: 'https://example.com/video.mp4',
      playbackRate: 1.8,
    });
    mockDOM.container.appendChild(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(controller).toBeDefined();

    // Simulate browser resetting playbackRate during background, then play resumes
    mockVideo.playbackRate = 1.0;
    controller.handlePlay({ type: 'play', target: mockVideo });

    // Lifecycle restore should re-apply speed but NOT corrupt lastSpeed
    expect(mockVideo.playbackRate).toBe(1.8);
    expect(config.settings.lastSpeed).toBe(1.8);
  });

  describe('source-specific lifecycle speed restoration', () => {
    async function setup(lastSpeed = 8) {
      const config = new window.VSC.VideoSpeedConfig();
      await config.load();
      config.settings.lastSpeed = lastSpeed;
      const manager = new window.VSC.EventManager(config, null);
      const action = new window.VSC.ActionHandler(config, manager);
      manager.actionHandler = action;
      const video = createMockVideo({ readyState: 4 });
      mockDOM.container.append(video);
      const setter = vi
        .spyOn(window.VSC.siteHandlerManager, 'handleSpeedChange')
        .mockImplementation((media, speed) => {
          media.playbackRate = Math.min(speed, 2);
        });
      const controller = new window.VSC.VideoController(video, null, config, action);
      return { config, manager, action, video, setter, controller };
    }

    it('does no rate, cooldown or UI work on repeated play/seek after a source clamps initialization', async () => {
      const { config, manager, action, video, setter, controller } = await setup();
      const cooldown = vi.spyOn(manager, 'refreshCoolDown');
      const flash = vi.spyOn(action, 'flashController');
      const dispatch = vi.spyOn(video, 'dispatchEvent');
      const state = manager.getMediaRateState(video);
      try {
        expect(video.playbackRate).toBe(2);
        expect(state.lifecycleSpeed).toBe(2);
        for (const type of ['play', 'seeked', 'play', 'seeked']) {
          video.dispatchEvent(new Event(type));
        }
        expect(setter).toHaveBeenCalledTimes(1);
        expect(cooldown).not.toHaveBeenCalled();
        expect(flash).not.toHaveBeenCalled();
        expect(dispatch.mock.calls.filter(([event]) => event.type === 'ratechange')).toHaveLength(
          0
        );
        expect(manager.getMediaRateState(video)).toBe(state);
        expect(config.settings.lastSpeed).toBe(8);
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('restores the locally accepted rate once after an actual reset and still accepts a new command', async () => {
      const { config, manager, action, video, setter, controller } = await setup();
      try {
        video.playbackRate = 1;
        video.dispatchEvent(new Event('seeked'));
        video.dispatchEvent(new Event('play'));
        video.dispatchEvent(new Event('seeked'));
        expect(setter).toHaveBeenCalledTimes(2);
        expect(setter).toHaveBeenLastCalledWith(video, 2);
        expect(video.playbackRate).toBe(2);
        expect(config.settings.lastSpeed).toBe(8);
        action.setSpeed(video, 1.5, 'user');
        expect(video.playbackRate).toBe(1.5);
        video.dispatchEvent(new Event('play'));
        expect(setter).toHaveBeenCalledTimes(3);
        expect(manager.getMediaRateState(video).lifecycleSpeed).toBe(1.5);
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('updates the lifecycle cache when a native speed change follows a user gesture', async () => {
      const { config, manager, video, setter, controller } = await setup();
      try {
        const state = manager.getMediaRateState(video);
        clearTimeout(state.coolDown);
        state.coolDown = false;
        manager.lastUserInteractionAt = 1000;
        video.playbackRate = 1.75;
        manager.handleRateChange({
          target: video,
          timeStamp: 1050,
          stopImmediatePropagation: vi.fn(),
        });
        expect(config.settings.lastSpeed).toBe(1.75);
        expect(manager.getMediaRateState(video).lifecycleSpeed).toBe(1.75);
        setter.mockClear();
        video.dispatchEvent(new Event('play'));
        video.dispatchEvent(new Event('seeked'));
        expect(video.playbackRate).toBe(1.75);
        expect(setter).not.toHaveBeenCalled();
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it.each([
      ['reset', 1, 'play'],
      ['reset', 1, 'seeked'],
      ['import', 1.5, 'play'],
      ['import', 1.5, 'seeked'],
      ['removal', undefined, 'play'],
      ['removal', undefined, 'seeked'],
    ])('adopts an external %s on %s preference through %s', async (_reason, speed, type) => {
      const { config, manager, video, setter, controller } = await setup();
      try {
        const revision = config.speedPreferenceRevision;
        simulateExternalStorageWrite({ lastSpeed: speed });
        expect(config.speedPreferenceRevision).toBe(revision + 1);
        const expected = speed ?? window.VSC.Constants.DEFAULT_SETTINGS.lastSpeed;
        video.dispatchEvent(new Event(type));
        expect(setter).toHaveBeenLastCalledWith(video, expected);
        expect(video.playbackRate).toBe(expected);
        const state = manager.getMediaRateState(video);
        expect(state.lifecycleSpeedRevision).toBe(config.speedPreferenceRevision);
        expect(state.acceptedSpeedRevision).toBe(config.speedPreferenceRevision);
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it.each([false, true])(
      'uses external authority before lifecycle recovery (cooldown %s)',
      async (cooldown) => {
        const { config, manager, video, setter, controller } = await setup();
        try {
          const state = manager.getMediaRateState(video);
          if (!cooldown) {
            clearTimeout(state.coolDown);
            state.coolDown = false;
          }
          simulateExternalStorageWrite({ lastSpeed: 1.5 });
          video.playbackRate = 1;
          manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
          expect(setter).toHaveBeenLastCalledWith(video, 1.5);
          expect(video.playbackRate).toBe(1.5);
          expect(state.acceptedSpeedRevision).toBe(config.speedPreferenceRevision);
          expect(state.lifecycleSpeedRevision).toBe(config.speedPreferenceRevision);
        } finally {
          controller.remove();
          manager.cleanup();
          vi.restoreAllMocks();
        }
      }
    );

    it('retries a replaced preference even when an external reset repeats its saved value', async () => {
      const { config, manager, video, setter, controller } = await setup();
      try {
        const revision = config.speedPreferenceRevision;
        simulateExternalStorageWrite({ lastSpeed: 8 });
        expect(config.speedPreferenceRevision).toBe(revision + 1);
        setter.mockImplementation((media, speed) => {
          media.playbackRate = speed;
        });
        video.dispatchEvent(new Event('play'));
        expect(setter).toHaveBeenLastCalledWith(video, 8);
        expect(video.playbackRate).toBe(8);
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('adopts an already matching replacement without a native write', async () => {
      const { config, manager, video, setter, controller } = await setup();
      try {
        simulateExternalStorageWrite({ lastSpeed: 2 });
        setter.mockClear();
        video.dispatchEvent(new Event('play'));
        const state = manager.getMediaRateState(video);
        expect(state.lifecycleSpeedRevision).toBe(config.speedPreferenceRevision);
        expect(state.acceptedSpeedRevision).toBe(config.speedPreferenceRevision);
        expect(setter).not.toHaveBeenCalled();
        // An ordinary sibling command changes the shared preference, not this revision.
        config.settings.lastSpeed = 1.5;
        video.dispatchEvent(new Event('seeked'));
        expect(video.playbackRate).toBe(2);
        expect(setter).not.toHaveBeenCalled();
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('keeps local authority through its actual debounced storage self-echo', async () => {
      const { config, manager, action, video, setter, controller } = await setup();
      vi.useFakeTimers();
      try {
        config.settings.rememberSpeed = true;
        const revision = config.speedPreferenceRevision;
        action.setSpeed(video, 1.5, 'user');
        await vi.advanceTimersByTimeAsync(1100);
        expect(config.speedPreferenceRevision).toBe(revision);
        expect(config._lastWrittenSpeed).toBeNull();
        setter.mockClear();
        video.dispatchEvent(new Event('play'));
        video.dispatchEvent(new Event('seeked'));
        expect(video.playbackRate).toBe(1.5);
        expect(setter).not.toHaveBeenCalled();
      } finally {
        controller.remove();
        manager.cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });

    it('keeps a source clamp through a sibling command without replacing its revision', async () => {
      const { config, manager, action, video, setter, controller } = await setup();
      const other = createMockVideo({ readyState: 4 });
      mockDOM.container.append(other);
      const sibling = new window.VSC.VideoController(other, null, config, action);
      try {
        const revision = config.speedPreferenceRevision;
        action.setSpeed(other, 1.5, 'user');
        expect(config.settings.lastSpeed).toBe(1.5);
        expect(config.speedPreferenceRevision).toBe(revision);
        setter.mockClear();
        video.dispatchEvent(new Event('play'));
        video.dispatchEvent(new Event('seeked'));
        expect(video.playbackRate).toBe(2);
        expect(setter).not.toHaveBeenCalled();
        video.playbackRate = 1;
        manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
        expect(setter).toHaveBeenLastCalledWith(video, 2);
      } finally {
        sibling.remove();
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('contains a page-owned playbackRate getter failure in play and seek callbacks', async () => {
      const { manager, video, setter, controller } = await setup();
      const descriptor = Object.getOwnPropertyDescriptor(video, 'playbackRate');
      try {
        Object.defineProperty(video, 'playbackRate', {
          configurable: true,
          get() {
            throw new Error('Page getter unavailable');
          },
        });
        expect(() => controller.handlePlay({ target: video, type: 'play' })).not.toThrow();
        expect(() => controller.handleSeek({ target: video, type: 'seeked' })).not.toThrow();
        expect(setter).toHaveBeenCalledTimes(1);
      } finally {
        if (descriptor) {
          Object.defineProperty(video, 'playbackRate', descriptor);
        } else {
          delete video.playbackRate;
        }
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });

    it.each(['emptied', 'loadstart'])(
      'releases source rate state on %s and retries preference for the next resource',
      async (type) => {
        const { config, manager, video, setter, controller } = await setup();
        try {
          const oldState = manager.getMediaRateState(video);
          video.dispatchEvent(new Event(type));
          expect(manager.getMediaRateState(video)).toBeNull();
          expect(oldState.coolDown).toBe(false);
          setter.mockImplementation((media, speed) => {
            media.playbackRate = speed;
          });
          video.playbackRate = 1;
          video.dispatchEvent(new Event('play'));
          expect(setter).toHaveBeenLastCalledWith(video, 8);
          expect(video.playbackRate).toBe(8);
          expect(manager.getMediaRateState(video)).not.toBe(oldState);
          expect(config.settings.lastSpeed).toBe(8);
          const release = vi.spyOn(manager, 'releaseMediaState');
          controller.remove();
          release.mockClear();
          video.dispatchEvent(new Event(type));
          expect(release).not.toHaveBeenCalled();
          expect(manager.getMediaRateState(video)).toBeNull();
        } finally {
          if (!controller.disposed) {
            controller.remove();
          }
          manager.cleanup();
          vi.restoreAllMocks();
        }
      }
    );

    it.each(['emptied', 'loadstart'])(
      'retains rate authority only through a verified same-clip rendition transition on %s',
      async (type) => {
        const { manager, video, controller } = await setup();
        const ownsTransition = vi.fn(() => true);
        controller.safariPlayback = { ownsTransition, cleanup: vi.fn() };
        try {
          const state = manager.getMediaRateState(video);
          video.dispatchEvent(new Event(type));
          expect(manager.getMediaRateState(video)).toBe(state);
          ownsTransition.mockReturnValue(false);
          video.dispatchEvent(new Event(type));
          expect(manager.getMediaRateState(video)).toBeNull();
        } finally {
          controller.remove();
          manager.cleanup();
          vi.restoreAllMocks();
        }
      }
    );

    it('tracks lifecycle readback without establishing fight authority for null startup', async () => {
      const { config, manager, video, setter, controller } = await setup(null);
      try {
        // Force initialization of a non-default site baseline, retaining null user authority.
        controller.actionHandler.setSpeed(video, 1.5, 'init');
        expect(manager.getMediaRateState(video).lifecycleSpeed).toBe(1.5);
        expect(manager.getMediaRateState(video).acceptedSpeed).toBeUndefined();
        expect(config.settings.lastSpeed).toBeNull();
        setter.mockClear();
        video.dispatchEvent(new Event('play'));
        video.dispatchEvent(new Event('seeked'));
        expect(setter).not.toHaveBeenCalled();
        video.playbackRate = 1;
        manager.handleRateChange({ target: video, stopImmediatePropagation: vi.fn() });
        // The external rate is accepted, never restored to the lifecycle baseline.
        expect(video.playbackRate).toBe(1);
        expect(setter.mock.calls.every(([, speed]) => speed === 1)).toBe(true);
        expect(config.settings.lastSpeed).toBeNull();
      } finally {
        controller.remove();
        manager.cleanup();
        vi.restoreAllMocks();
      }
    });
  });

  // --- Frame-rate detection (rVFC burst for frame-step shortcuts) ---

  /**
   * Attach a controllable requestVideoFrameCallback mock to a video.
   * Returns helpers to drive frames and observe the pending/cancelled state.
   */
  function installRvfcMock(video) {
    let nextHandle = 1;
    const pending = new Map();
    const cancelled = [];

    video.requestVideoFrameCallback = (cb) => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    };
    video.cancelVideoFrameCallback = (handle) => {
      cancelled.push(handle);
      pending.delete(handle);
    };

    // The burst keeps at most one callback registered at a time; drive it.
    const frame = (mediaTime, presentedFrames) => {
      const entry = [...pending.entries()][0];
      if (!entry) {
        return false;
      }
      const [handle, cb] = entry;
      pending.delete(handle);
      cb(0, { mediaTime, presentedFrames });
      return true;
    };

    return { pending, cancelled, frame };
  }

  it('fps detection: rVFC burst converges to a detected fps then stops', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const { pending, frame } = installRvfcMock(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(controller.detectedFps).toBe(null);

    // Four 30fps frames: the first seeds the delta baseline, the next three
    // produce three agreeing samples (FPS_MIN_SAMPLES) → convergence.
    frame(1 / 30, 1);
    frame(2 / 30, 2);
    frame(3 / 30, 3);
    frame(4 / 30, 4);

    expect(controller.detectedFps).toBe(30);
    // Burst ended: nothing pending → zero steady-state per-frame cost.
    expect(pending.size).toBe(0);

    controller.remove();
  });

  it('fps detection: snaps ΔpresentedFrames/ΔmediaTime to the nearest common rate', () => {
    const snap = window.VSC.VideoController.snapToCommonFps;
    expect(snap(29.9)).toBe(29.97);
    expect(snap(59.8)).toBe(59.94);
    expect(snap(24.01)).toBe(24);
    // 42fps is >5% from any common rate → kept raw.
    expect(snap(42)).toBe(42);
  });

  it('fps detection: teardown cancels the pending rVFC callback (no leak)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const { pending, cancelled } = installRvfcMock(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    // Construction armed exactly one in-flight callback.
    expect(pending.size).toBe(1);
    const handle = [...pending.keys()][0];

    controller.remove();

    expect(cancelled).toContain(handle);
    expect(pending.size).toBe(0);
    expect(controller.vfcHandle).toBe(null);
  });

  it('fps detection: re-arms on source change (emptied) and resets detectedFps', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    const { pending, frame } = installRvfcMock(mockVideo);

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    frame(1 / 30, 1);
    frame(2 / 30, 2);
    frame(3 / 30, 3);
    frame(4 / 30, 4);
    expect(controller.detectedFps).toBe(30);

    // Source swap: detectedFps clears and a fresh burst arms.
    mockVideo.dispatchEvent({ type: 'emptied' });
    expect(controller.detectedFps).toBe(null);
    expect(pending.size).toBe(1);

    controller.remove();
  });

  it('fps detection: a stale callback after remove() does not re-arm (disposed guard)', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);

    // Capture the in-flight sampler, but make cancel a no-op so the callback
    // "survives" teardown — the disposed flag must still prevent re-arming.
    let capturedCb = null;
    let registerCount = 0;
    mockVideo.requestVideoFrameCallback = (cb) => {
      capturedCb = cb;
      registerCount++;
      return registerCount;
    };
    mockVideo.cancelVideoFrameCallback = () => {}; // cancel fails to actually cancel

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(registerCount).toBe(1);

    controller.remove();
    expect(controller.disposed).toBe(true);

    // Fire the stale callback that cancel failed to remove.
    capturedCb(0, { mediaTime: 0.1, presentedFrames: 3 });

    // It must NOT have registered another callback on the detached controller.
    expect(registerCount).toBe(1);
  });

  it('fps detection: remove() fully tears down even if cancelVideoFrameCallback throws', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    mockVideo.requestVideoFrameCallback = () => 1;
    // A hostile/broken page accessor that throws on the very lookup.
    Object.defineProperty(mockVideo, 'cancelVideoFrameCallback', {
      configurable: true,
      get() {
        throw new Error('page tampered with cancelVideoFrameCallback');
      },
    });

    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    expect(window.VSC.stateManager.controllers.size).toBe(1);

    // remove() must not throw and must complete teardown regardless.
    expect(() => controller.remove()).not.toThrow();
    expect(mockVideo.vsc).toBe(undefined);
    expect(window.VSC.stateManager.controllers.size).toBe(0);
    expect(controller.handleFpsReset).toBe(null);
  });

  it('fps detection: no burst when requestVideoFrameCallback is unavailable', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo({ playbackRate: 1.0 });
    mockDOM.container.appendChild(mockVideo);
    // No requestVideoFrameCallback (default mock) — must not throw, no handle.
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);

    expect(controller.detectedFps).toBe(null);
    expect(controller.vfcHandle).toBe(null);
    expect(controller.handleFpsReset).toBe(null);

    controller.remove();
  });

  // R5: a site handler can hand back an unusable insertion point. The controller
  // must still attach via a media-parent fallback rather than throwing and
  // silently dropping the controller.
  it('attaches via media-parent fallback when positioning has no usable anchor', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();

    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);

    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo); // video.parentElement = container

    // Force a degenerate positioning result (null insertion point).
    const spy = vi
      .spyOn(window.VSC.siteHandlerManager, 'getControllerPosition')
      .mockReturnValue({ insertionPoint: null, insertionMethod: 'firstChild', targetParent: null });

    let controller;
    expect(() => {
      controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    }).not.toThrow();

    expect(mockVideo.vsc).toBe(controller);
    // Wrapper landed under the media's real parent.
    expect(mockDOM.container.contains(controller.div)).toBe(true);

    spy.mockRestore();
  });

  it('rolls back registration and the media expando when construction fails', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const actionHandler = new window.VSC.ActionHandler(config, null);
    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    const initializeControls = vi
      .spyOn(window.VSC.VideoController.prototype, 'initializeControls')
      .mockImplementation(() => {
        throw new Error('page DOM failure');
      });

    expect(() => new window.VSC.VideoController(mockVideo, null, config, actionHandler)).toThrow(
      /page DOM failure/
    );
    expect(mockVideo.vsc).toBeUndefined();
    expect(window.VSC.stateManager.controllers.size).toBe(0);

    initializeControls.mockRestore();
  });

  it('guards an FPS re-arm when the page replaces requestVideoFrameCallback', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const actionHandler = new window.VSC.ActionHandler(config, null);
    const mockVideo = createMockVideo();
    mockDOM.container.appendChild(mockVideo);
    mockVideo.requestVideoFrameCallback = vi.fn(() => 1);
    const controller = new window.VSC.VideoController(mockVideo, null, config, actionHandler);
    mockVideo.requestVideoFrameCallback = () => {
      throw new Error('page replaced rVFC');
    };

    expect(() => mockVideo.dispatchEvent({ type: 'loadstart' })).not.toThrow();
    expect(controller.vfcHandle).toBeNull();
    controller.remove();
  });

  it('uses collision-free controller IDs for same-source media', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const actionHandler = new window.VSC.ActionHandler(config, null);
    const firstVideo = createMockVideo();
    const secondVideo = createMockVideo();
    mockDOM.container.append(firstVideo, secondVideo);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1234);

    const first = new window.VSC.VideoController(firstVideo, null, config, actionHandler);
    const second = new window.VSC.VideoController(secondVideo, null, config, actionHandler);

    expect(first.controllerId).not.toBe(second.controllerId);
    expect(window.VSC.stateManager.controllers.size).toBe(2);
    first.remove();
    second.remove();
    now.mockRestore();
  });
  it('repairs a removed overlay and a moved media using the same controller and listeners', async () => {
    const config = window.VSC.videoSpeedConfig;
    await config.load();
    const eventManager = new window.VSC.EventManager(config, null);
    const actionHandler = new window.VSC.ActionHandler(config, eventManager);
    const video = createMockVideo();
    mockDOM.container.append(video);
    const controller = new window.VSC.VideoController(video, null, config, actionHandler);
    const wrapper = controller.div;
    wrapper.classList.add('vsc-manual', 'vsc-hidden');
    const setup = vi.spyOn(controller, 'setupEventHandlers');
    wrapper.remove();
    expect(controller.repairDOMPlacement()).toBe(true);
    expect(controller.div).toBe(wrapper);
    expect(wrapper.classList.contains('vsc-manual')).toBe(true);
    expect(wrapper.classList.contains('vsc-hidden')).toBe(true);
    const newParent = document.createElement('section');
    mockDOM.container.append(newParent);
    newParent.append(video);
    expect(controller.repairDOMPlacement()).toBe(true);
    expect(wrapper.parentNode).toBe(newParent);
    expect(video.vsc).toBe(controller);
    expect(setup).not.toHaveBeenCalled();
    expect(window.VSC.stateManager.controllers.size).toBe(1);
    eventManager.refreshCoolDown(video);
    controller.remove();
    expect(eventManager.getMediaRateState(video)).toBeNull();
    expect(controller.repairDOMPlacement()).toBe(false);
    eventManager.cleanup();
  });
});

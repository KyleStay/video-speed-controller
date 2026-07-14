/**
 * Unit tests for VideoController class
 * Using global variables to match browser extension architecture
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
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

    // Verify setup
    expect(mockVideo.vsc).toBeDefined();
    expect(window.VSC.stateManager.controllers.size).toBe(1);

    // Remove controller
    controller.remove();

    // Verify cleanup
    expect(mockVideo.vsc).toBe(undefined);
    expect(window.VSC.stateManager.controllers.size).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(flashTimer);

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
});

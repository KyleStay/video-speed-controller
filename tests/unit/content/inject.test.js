/**
 * Unit tests for VideoSpeedExtension (inject.js)
 * Testing the fix for video elements without parentElement
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
} from '../../helpers/chrome-mock.js';
import { createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { bridgeEvents } from '../../../src/utils/bridge-events.js';

// Load all required modules

let mockDOM;
let extension;

describe('Inject', () => {
  beforeEach(() => {
    installChromeMock();
    resetMockStorage();
    mockDOM = createMockDOM();

    // Initialize site handler manager for tests
    if (window.VSC && window.VSC.siteHandlerManager) {
      window.VSC.siteHandlerManager.initialize(document);
    }
  });

  afterEach(() => {
    cleanupChromeMock();
    if (mockDOM) {
      mockDOM.cleanup();
    }
    if (extension) {
      extension = null;
    }

    // Clean up any remaining video elements
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      if (video.vsc) {
        try {
          video.vsc.remove();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (video.parentNode) {
        try {
          video.parentNode.removeChild(video);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  /**
   * Create a video element without parentElement but with parentNode
   * This simulates shadow DOM scenarios where parentElement is undefined
   */
  function createVideoWithoutParentElement() {
    const video = createMockVideo({ readyState: 4 });
    const parentNode = document.createElement('div');

    // Simulate shadow DOM scenario where parentElement is undefined
    Object.defineProperty(video, 'parentElement', {
      value: null,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'parentNode', {
      value: parentNode,
      writable: false,
      configurable: true,
    });

    // Mock isConnected property for validity check
    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    return { video, parentNode };
  }

  it('onVideoFound should handle video elements without parentElement', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const { video, parentNode } = createVideoWithoutParentElement();

    extension.onVideoFound(video, parentNode);

    expect(video.vsc).toBeDefined();
    expect(video.vsc instanceof window.VSC.VideoController).toBe(true);
    expect(video.vsc.parent).toBe(parentNode);
  });

  it('teardown cleans up early event listeners before full initialization', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const cleanup = vi.fn();
    extension.initialized = false;
    extension.eventListenersInitialized = true;
    extension.eventManager = { cleanup };
    extension.actionHandler = {};

    extension.teardown();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(extension.eventManager).toBeNull();
    expect(extension.eventListenersInitialized).toBe(false);
    expect(extension.teardownRequested).toBe(true);

    extension.teardownRequested = false;
  });

  it('teardown invalidates an initialization still waiting for settings', async () => {
    const freshExtension = new window.VSC_controller.constructor();
    let resolveLoad;
    const originalLoad = window.VSC.videoSpeedConfig.load;
    window.VSC.videoSpeedConfig.load = vi.fn(
      () => new Promise((resolve) => (resolveLoad = resolve))
    );
    const setupEventPipeline = vi.spyOn(freshExtension, 'setupEventPipeline');

    const initialization = freshExtension.initialize();
    freshExtension.teardown();
    resolveLoad();
    await initialization;

    expect(setupEventPipeline).not.toHaveBeenCalled();
    expect(freshExtension.teardownRequested).toBe(true);
    window.VSC.videoSpeedConfig.load = originalLoad;
  });

  it('coalesces concurrent initialization requests', async () => {
    const freshExtension = new window.VSC_controller.constructor();
    let resolveLoad;
    const originalLoad = window.VSC.videoSpeedConfig.load;
    window.VSC.videoSpeedConfig.load = vi.fn(
      () => new Promise((resolve) => (resolveLoad = resolve))
    );
    vi.spyOn(freshExtension, 'deferDOMWork').mockImplementation(() => {});

    const first = freshExtension.initialize();
    const second = freshExtension.initialize();
    resolveLoad();
    await Promise.all([first, second]);

    expect(window.VSC.videoSpeedConfig.load).toHaveBeenCalledOnce();
    freshExtension.teardown();
    window.VSC.videoSpeedConfig.load = originalLoad;
  });

  it.each([
    [false, false, false, 1],
    [true, false, false, 0],
    [false, true, false, 0],
    [false, false, true, 0],
  ])(
    'late bridge readiness respects initialized=%s, pending=%s, teardown=%s',
    (initialized, pending, teardown, expectedCalls) => {
      const instance = window.VSC_controller;
      const previous = {
        initialized: instance.initialized,
        initializationInProgress: instance.initializationInProgress,
        teardownRequested: instance.teardownRequested,
      };
      const initialize = vi.spyOn(instance, 'initialize').mockResolvedValue(undefined);
      try {
        Object.assign(instance, {
          initialized,
          initializationInProgress: pending,
          teardownRequested: teardown,
        });
        bridgeEvents.dispatchEvent(new CustomEvent('VSC_BRIDGE_READY'));
        expect(initialize).toHaveBeenCalledTimes(expectedCalls);
      } finally {
        Object.assign(instance, previous);
        initialize.mockRestore();
      }
    }
  );

  it('handleDocumentReplaced tears down then reinitializes (R2)', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const teardown = vi.spyOn(extension, 'teardown').mockImplementation(() => {});
    const initialize = vi.spyOn(extension, 'initialize').mockResolvedValue(undefined);

    extension.documentReplacementInProgress = false;
    extension.handleDocumentReplaced();

    expect(teardown).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledOnce();

    // The in-progress guard resets after initialize settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(extension.documentReplacementInProgress).toBe(false);

    teardown.mockRestore();
    initialize.mockRestore();
  });

  it('arms attribute observation even when discovered media is not yet valid (P3 regression guard)', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const enableAttributeObservation = vi.fn();
    const prevMutationObserver = extension.mutationObserver;
    const prevMediaObserver = extension.mediaObserver;
    extension.mutationObserver = { enableAttributeObservation };
    // Force the media to be treated as invalid so onVideoFound early-returns.
    extension.mediaObserver = {
      isValidMediaElement: () => false,
    };

    const video = document.createElement('video');
    extension.onVideoFound(video, document.body);

    // Even though no controller attached, style/class observation must be armed
    // so a later reveal of this video is caught.
    expect(enableAttributeObservation).toHaveBeenCalledOnce();
    expect(video.vsc).toBeUndefined();

    extension.mutationObserver = prevMutationObserver;
    extension.mediaObserver = prevMediaObserver;
  });

  it('handleDocumentReplaced is re-entrancy guarded (R2)', () => {
    extension = window.VSC_controller;
    const teardown = vi.spyOn(extension, 'teardown').mockImplementation(() => {});
    const initialize = vi.spyOn(extension, 'initialize').mockReturnValue(new Promise(() => {}));

    extension.documentReplacementInProgress = false;
    extension.handleDocumentReplaced(); // starts; leaves flag set (initialize never resolves)
    extension.handleDocumentReplaced(); // should be ignored while in progress

    expect(teardown).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledOnce();

    teardown.mockRestore();
    initialize.mockRestore();
    extension.documentReplacementInProgress = false;
  });

  it('deferred DOM work is skipped after teardown is requested', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalInjectControllerCSS = extension.injectControllerCSS;
    window.requestIdleCallback = (callback) => callback();
    extension.teardownRequested = true;
    extension.injectControllerCSS = vi.fn();

    extension.deferDOMWork(document);

    expect(extension.injectControllerCSS).not.toHaveBeenCalled();
    extension.teardownRequested = false;
    extension.injectControllerCSS = originalInjectControllerCSS;
    window.requestIdleCallback = originalRequestIdleCallback;
  });

  it('clears scheduled deferred work during teardown', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    window.requestIdleCallback = vi.fn(() => 123);
    window.cancelIdleCallback = vi.fn();
    const callback = vi.fn();

    extension.scheduleDeferredWork(callback, { idle: true });
    extension.initialized = true;
    extension.teardown();

    expect(window.cancelIdleCallback).toHaveBeenCalledWith(123);
    expect(callback).not.toHaveBeenCalled();
    expect(extension.scheduledWork.size).toBe(0);

    extension.teardownRequested = false;
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('gives idle work a bounded deadline so startup cannot stall indefinitely', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    window.requestIdleCallback = vi.fn(() => 123);

    extension.scheduleDeferredWork(() => {}, { idle: true, delay: 200 });

    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 1000,
    });

    extension.clearScheduledWork();
    window.requestIdleCallback = originalRequestIdleCallback;
  });

  it('deferred media scan schedules comprehensive scan even after light scan finds media', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    window.requestIdleCallback = (callback) => callback();

    const video = createMockVideo({ readyState: 4 });
    mockDOM.container.appendChild(video);
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => [video]),
      isValidMediaElement: vi.fn(() => true),
      shouldStartHidden: vi.fn(() => false),
    };
    extension.scheduleComprehensiveScan = vi.fn();

    extension.deferredMediaScan(document);

    expect(extension.scheduleComprehensiveScan).toHaveBeenCalledWith(document);

    window.requestIdleCallback = originalRequestIdleCallback;
  });

  it('clearScheduledWork cancels pending idle callbacks and timers', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    const cancelIdleCallback = vi.fn();
    window.requestIdleCallback = vi.fn(() => 42);
    window.cancelIdleCallback = cancelIdleCallback;

    const timer = extension.scheduleDeferredWork(() => {}, { delay: 1000 });
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    extension.scheduleDeferredWork(() => {}, { idle: true });

    expect(extension.scheduledWork.size).toBeGreaterThanOrEqual(2);

    extension.clearScheduledWork();

    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer.id);
    expect(extension.scheduledWork.size).toBe(0);

    clearTimeoutSpy.mockRestore();
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('rejects canceled light-scan callbacks after reinitialization', () => {
    vi.useFakeTimers();
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    const idleCallbacks = [];
    window.requestIdleCallback = (callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    };
    // Simulate a callback already dequeued when cancellation is requested.
    window.cancelIdleCallback = (id) => idleCallbacks[id - 1]();

    const recoveringExtension = new window.VSC_controller.constructor();
    recoveringExtension.logger = window.VSC.logger;
    recoveringExtension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => []),
    };
    recoveringExtension.mutationObserver = { observeOpenShadowRoots: vi.fn() };
    recoveringExtension.onVideoFound = vi.fn();

    recoveringExtension.deferredMediaScan(document);
    const staleCallback = idleCallbacks[0];
    recoveringExtension.clearScheduledWork();
    recoveringExtension.teardownRequested = false;
    recoveringExtension.deferredMediaScan(document);
    const currentCallback = idleCallbacks[1];

    staleCallback();
    expect(recoveringExtension.scheduledWork.size).toBe(1);
    currentCallback();
    expect(recoveringExtension.mediaObserver.scanForMediaLight).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(recoveringExtension.mediaObserver.scanAll).toHaveBeenCalledOnce();

    recoveringExtension.clearScheduledWork();
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
    vi.useRealTimers();
  });

  it('releases failed scheduling state so a later comprehensive scan can retry', () => {
    const subject = new window.VSC_controller.constructor();
    subject.logger = { info() {}, debug() {}, error() {} };
    subject.mediaObserver = {
      hasMediaIndicators: () => true,
      scanAll: vi.fn(() => []),
    };
    let callback;
    const schedule = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementationOnce(() => {
        throw new Error('temporary page scheduler failure');
      })
      .mockImplementation((run) => {
        callback = run;
        return -1;
      });
    try {
      expect(() => subject.scheduleComprehensiveScan(document)).toThrow(
        'temporary page scheduler failure'
      );
      expect(subject.pendingComprehensiveScans.has(document)).toBe(false);
      expect(subject.scheduledWork.size).toBe(0);
      subject.scheduleComprehensiveScan(document);
      callback();
      expect(subject.mediaObserver.scanAll).toHaveBeenCalledOnce();
      expect(subject.pendingComprehensiveScans.has(document)).toBe(false);
      expect(subject.scheduledWork.size).toBe(0);
    } finally {
      subject.clearScheduledWork();
      schedule.mockRestore();
    }
  });

  it('coalesces pending comprehensive scans per document and allows a fresh scan after completion', () => {
    vi.useFakeTimers();
    const recoveringExtension = new window.VSC_controller.constructor();
    recoveringExtension.logger = window.VSC.logger;
    recoveringExtension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => []),
    };
    recoveringExtension.mutationObserver = { observeOpenShadowRoots: vi.fn() };
    recoveringExtension.onVideoFound = vi.fn();

    recoveringExtension.deferredMediaScan(document);
    recoveringExtension.deferredMediaScan(document);
    vi.advanceTimersByTime(200);
    expect(recoveringExtension.mediaObserver.scanForMediaLight).toHaveBeenCalledTimes(2);
    expect(recoveringExtension.mediaObserver.scanAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(recoveringExtension.mediaObserver.scanAll).toHaveBeenCalledOnce();

    recoveringExtension.scheduleComprehensiveScan(document);
    vi.advanceTimersByTime(1000);
    expect(recoveringExtension.mediaObserver.scanAll).toHaveBeenCalledTimes(2);

    recoveringExtension.teardown();
    vi.useRealTimers();
  });

  it('ignores a canceled comprehensive callback without clearing newer same-document work', () => {
    const recoveringExtension = new window.VSC_controller.constructor();
    recoveringExtension.logger = window.VSC.logger;
    recoveringExtension.mediaObserver = {
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => []),
    };
    recoveringExtension.mutationObserver = { observeOpenShadowRoots: vi.fn() };
    recoveringExtension.onVideoFound = vi.fn();
    const callbacks = [];
    recoveringExtension.scheduleDeferredWork = vi.fn((callback) => {
      callbacks.push(callback);
      return {};
    });

    recoveringExtension.scheduleComprehensiveScan(document);
    recoveringExtension.clearScheduledWork();
    recoveringExtension.scheduleComprehensiveScan(document);

    callbacks[0]();
    expect(recoveringExtension.mediaObserver.scanAll).not.toHaveBeenCalled();
    callbacks[1]();
    expect(recoveringExtension.mediaObserver.scanAll).toHaveBeenCalledOnce();

    recoveringExtension.teardown();
  });

  it('deferred media scan schedules comprehensive scan even when light scan finds media', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    window.requestIdleCallback = (callback) => {
      callback();
      return 1;
    };

    const video = createMockVideo({ readyState: 4 });
    const parent = document.createElement('div');
    parent.appendChild(video);
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => [video]),
      isValidMediaElement: vi.fn(() => true),
      shouldStartHidden: vi.fn(() => false),
    };
    extension.scheduleComprehensiveScan = vi.fn();

    extension.deferredMediaScan(document);

    expect(extension.mediaObserver.scanForMediaLight).toHaveBeenCalledOnce();
    expect(extension.scheduleComprehensiveScan).toHaveBeenCalledWith(document);

    window.requestIdleCallback = originalRequestIdleCallback;
  });

  it('onVideoFound should prefer parentElement when available', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4 });
    const parentElement = document.createElement('div');
    const parentNode = document.createElement('span');

    Object.defineProperty(video, 'parentElement', {
      value: parentElement,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'parentNode', {
      value: parentNode,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parentNode);

    expect(video.vsc).toBeDefined();
    // VideoController constructor uses target.parentElement || parent
    expect(video.vsc.parent).toBe(parentElement);
  });

  it('onVideoFound defers controller when readyState < 2 and video has src', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    // readyState=1 with a src → should defer, not attach immediately
    const video = createMockVideo({ readyState: 1 });
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);

    // Controller should NOT be attached yet — waiting for loadeddata
    expect(video.vsc).toBeUndefined();
  });

  it('onVideoFound attaches immediately when readyState >= 2', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4 });
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);

    // Controller should be attached immediately
    expect(video.vsc).toBeDefined();
    expect(video.vsc instanceof window.VSC.VideoController).toBe(true);
  });

  it('onVideoFound defers controller when video has no src (no-source placeholder)', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    // readyState=0, no src → MUST defer, because injecting into raw uninitialized DOM crashes Polymer
    const video = createMockVideo({ readyState: 0, currentSrc: '' });
    video.addEventListener = vi.fn();
    const parent = document.createElement('div');

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);

    expect(video.vsc).toBeUndefined();
    // Verify event listener was added
    expect(video.addEventListener).toHaveBeenCalledWith(
      'loadeddata',
      expect.any(Function),
      expect.objectContaining({ once: true })
    );
    expect(video.addEventListener).toHaveBeenCalledWith(
      'canplay',
      expect.any(Function),
      expect.objectContaining({ once: true })
    );
    expect(video.addEventListener).toHaveBeenCalledWith(
      'play',
      expect.any(Function),
      expect.objectContaining({ once: true })
    );
  });

  it('onVideoFound only registers one deferred attachment per unready video', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 1 });
    const parent = document.createElement('div');
    video.addEventListener = vi.fn();
    video.removeEventListener = vi.fn();

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);
    extension.onVideoFound(video, parent);

    expect(video.addEventListener).toHaveBeenCalledTimes(3);

    extension.onVideoRemoved(video);

    expect(video.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it('deferred video attachment can attach on play before loadeddata', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 1 });
    const parent = document.createElement('div');
    parent.appendChild(video);

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    extension.onVideoFound(video, parent);
    expect(video.vsc).toBeUndefined();

    video.dispatchEvent({ type: 'play' });

    expect(video.vsc).toBeDefined();
    expect(video.vsc instanceof window.VSC.VideoController).toBe(true);
  });

  it('onVideoFound should handle video with neither parentElement nor parentNode', async () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4 });
    const fallbackParent = document.createElement('div');

    Object.defineProperty(video, 'parentElement', {
      value: null,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'parentNode', {
      value: null,
      writable: false,
      configurable: true,
    });

    Object.defineProperty(video, 'isConnected', {
      value: true,
      writable: false,
      configurable: true,
    });

    // Should not throw even with no parent references
    extension.onVideoFound(video, fallbackParent);

    expect(video.vsc).toBeDefined();
    expect(video.vsc.parent).toBe(fallbackParent);
  });

  // --- SPA navigation recovery (re-claim shortcuts after media swap) ---

  it('rescans for media on yt-navigate-finish (SPA navigation recovery)', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    window.requestIdleCallback = (callback) => {
      callback();
      return 1;
    };

    extension.teardownRequested = false;
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
    };
    extension.spaNavigationHandler = null;
    const deferredMediaScan = vi.spyOn(extension, 'deferredMediaScan').mockImplementation(() => {});

    extension.setupSpaNavigationRecovery();
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));

    expect(deferredMediaScan).toHaveBeenCalledWith(document);

    deferredMediaScan.mockRestore();
    window.requestIdleCallback = originalRequestIdleCallback;
    // Clean up listeners registered by setupSpaNavigationRecovery
    extension.initialized = true;
    extension.teardown();
    extension.teardownRequested = false;
  });

  it('rescans for media on popstate (generic SPA fallback)', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const originalRequestIdleCallback = window.requestIdleCallback;
    window.requestIdleCallback = (callback) => {
      callback();
      return 1;
    };

    extension.teardownRequested = false;
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
    };
    extension.spaNavigationHandler = null;
    const deferredMediaScan = vi.spyOn(extension, 'deferredMediaScan').mockImplementation(() => {});

    extension.setupSpaNavigationRecovery();
    window.dispatchEvent(new Event('popstate'));

    expect(deferredMediaScan).toHaveBeenCalledWith(document);

    deferredMediaScan.mockRestore();
    window.requestIdleCallback = originalRequestIdleCallback;
    extension.initialized = true;
    extension.teardown();
    extension.teardownRequested = false;
  });

  it('coalesces repeated SPA navigation events before scanning the document', () => {
    extension = window.VSC_controller;
    const originalRequestIdleCallback = window.requestIdleCallback;
    let idleCallback;
    window.requestIdleCallback = (callback) => {
      idleCallback = callback;
      return 1;
    };
    extension.teardownRequested = false;
    extension.spaNavigationHandler = null;
    extension.spaRecoveryScheduled = false;
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
    };
    const deferredMediaScan = vi.spyOn(extension, 'deferredMediaScan').mockImplementation(() => {});

    extension.setupSpaNavigationRecovery();
    window.dispatchEvent(new Event('popstate'));
    window.dispatchEvent(new Event('popstate'));

    expect(extension.mediaObserver.hasMediaIndicators).toHaveBeenCalledOnce();
    expect(deferredMediaScan).not.toHaveBeenCalled();
    idleCallback();
    expect(deferredMediaScan).toHaveBeenCalledOnce();

    deferredMediaScan.mockRestore();
    window.requestIdleCallback = originalRequestIdleCallback;
    extension.initialized = true;
    extension.teardown();
    extension.teardownRequested = false;
  });

  it('SPA navigation handler is a no-op after teardown is requested', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    extension.spaNavigationHandler = null;
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
    };
    const deferredMediaScan = vi.spyOn(extension, 'deferredMediaScan').mockImplementation(() => {});

    extension.setupSpaNavigationRecovery();
    extension.teardownRequested = true;
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));

    expect(deferredMediaScan).not.toHaveBeenCalled();

    deferredMediaScan.mockRestore();
    extension.initialized = true;
    extension.teardown();
    extension.teardownRequested = false;
  });

  it('SPA navigation does not rescan when the frame has no media signal (P2 perf gate)', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    extension.teardownRequested = false;
    extension.spaNavigationHandler = null;
    const hasMediaIndicators = vi.fn(() => false);
    extension.mediaObserver = { scanForMediaLight: vi.fn(() => []), hasMediaIndicators };
    const deferredMediaScan = vi.spyOn(extension, 'deferredMediaScan').mockImplementation(() => {});

    extension.setupSpaNavigationRecovery();
    document.dispatchEvent(new CustomEvent('yt-navigate-finish'));

    expect(hasMediaIndicators).toHaveBeenCalledWith(document);
    expect(deferredMediaScan).not.toHaveBeenCalled();

    deferredMediaScan.mockRestore();
    extension.initialized = true;
    extension.teardown();
    extension.teardownRequested = false;
  });

  it('SPA navigation listeners are removed during teardown', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    extension.spaNavigationHandler = null;
    extension.setupSpaNavigationRecovery();
    const handler = extension.spaNavigationHandler;
    expect(handler).toBeInstanceOf(Function);

    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');

    extension.initialized = true;
    extension.teardown();

    expect(docRemove).toHaveBeenCalledWith('yt-navigate-finish', handler);
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', handler);
    expect(winRemove).toHaveBeenCalledWith('popstate', handler);
    expect(winRemove).toHaveBeenCalledWith('pageshow', handler);
    expect(extension.spaNavigationHandler).toBeNull();

    docRemove.mockRestore();
    winRemove.mockRestore();
    extension.teardownRequested = false;
  });

  describe('tab restoration recovery', () => {
    let recoveringExtension;
    let scan;

    beforeEach(() => {
      vi.useFakeTimers();
      recoveringExtension = new window.VSC_controller.constructor();
      recoveringExtension.logger = window.VSC.logger;
      recoveringExtension.initialized = true;
      recoveringExtension.mediaObserver = {
        hasMediaIndicators: vi.fn(() => true),
      };
      scan = vi.spyOn(recoveringExtension, 'deferredMediaScan').mockImplementation(() => {});
      recoveringExtension.setupSpaNavigationRecovery();
    });

    afterEach(() => {
      recoveringExtension.teardown();
      delete document.visibilityState;
      vi.useRealTimers();
    });

    function showPage(persisted) {
      const event = new Event('pageshow');
      Object.defineProperty(event, 'persisted', { value: persisted });
      window.dispatchEvent(event);
    }

    it('coalesces bfcache and visible-tab restoration into one deferred scan', () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      showPage(true);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('popstate'));

      expect(scan).not.toHaveBeenCalled();
      expect(recoveringExtension.mediaObserver.hasMediaIndicators).toHaveBeenCalledOnce();
      vi.runOnlyPendingTimers();
      expect(scan).toHaveBeenCalledExactlyOnceWith(document);
    });

    it('recovers a visible tab even when there was no history navigation', () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.runOnlyPendingTimers();
      expect(scan).toHaveBeenCalledExactlyOnceWith(document);
    });

    it('does no media work for initial pageshow or background visibility changes', () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      showPage(false);
      document.dispatchEvent(new Event('visibilitychange'));
      vi.runOnlyPendingTimers();
      expect(recoveringExtension.mediaObserver.hasMediaIndicators).not.toHaveBeenCalled();
      expect(scan).not.toHaveBeenCalled();
    });

    it('keeps media-less restored frames cheap', () => {
      recoveringExtension.mediaObserver.hasMediaIndicators.mockReturnValue(false);
      showPage(true);
      vi.runOnlyPendingTimers();
      expect(scan).not.toHaveBeenCalled();
      expect(recoveringExtension.scheduledWork.size).toBe(0);
    });

    it('cancels pending recovery and removes restoration listeners on teardown', () => {
      showPage(true);
      recoveringExtension.teardown();
      showPage(true);
      document.dispatchEvent(new Event('visibilitychange'));
      vi.runOnlyPendingTimers();
      expect(scan).not.toHaveBeenCalled();
      expect(recoveringExtension.scheduledWork.size).toBe(0);
    });

    it('repairs existing shadow controllers during comprehensive rediscovery', () => {
      const video = document.createElement('video');
      const repairDOMPlacement = vi.fn();
      video.vsc = { repairDOMPlacement };
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).append(video);
      document.body.append(host);
      recoveringExtension.mediaObserver.scanAll = vi.fn(() => [video]);
      recoveringExtension.mediaObserver.isValidMediaElement = vi.fn(() => true);

      recoveringExtension.scheduleComprehensiveScan(document);
      vi.runOnlyPendingTimers();

      expect(repairDOMPlacement).toHaveBeenCalledOnce();
      host.remove();
    });
  });

  // --- CSS injection: adoptedStyleSheets composition ---

  /** Helper: reset extension CSS state so injectControllerCSS can re-run. */
  function resetCSSState(ext) {
    document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(
      (s) => s !== ext._controllerSheet && s !== ext._customSheet
    );
    ext._controllerSheet = null;
    ext._customSheet = null;
  }

  it('injectControllerCSS adds default sheet to adoptedStyleSheets', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();

    expect(extension._controllerSheet).not.toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
  });

  it('injectControllerCSS adds both default and custom sheets when customCSS is set', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = 'vsc-controller { top: 42px; }';

    extension.injectControllerCSS();

    expect(extension._controllerSheet).not.toBeNull();
    expect(extension._customSheet).not.toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
    expect(document.adoptedStyleSheets).toContain(extension._customSheet);
  });

  it('preprocesses domain selectors in initial custom CSS', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = `:root[style*='--vsc-domain: "${location.hostname}"'] vsc-controller { top: 42px; }`;
    const replaceSync = vi.spyOn(CSSStyleSheet.prototype, 'replaceSync');

    extension.injectControllerCSS();

    expect(replaceSync).toHaveBeenLastCalledWith('vsc-controller { top: 42px; }');
    replaceSync.mockRestore();
  });

  it('injectControllerCSS skips custom sheet when customCSS is empty', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();

    expect(extension._controllerSheet).not.toBeNull();
    expect(extension._customSheet).toBeNull();
  });

  it('injectControllerCSS is idempotent (no-op on second call)', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();
    const countAfterFirst = document.adoptedStyleSheets.length;
    extension.injectControllerCSS();

    expect(document.adoptedStyleSheets.length).toBe(countAfterFirst);
  });

  it('setupCSSLiveUpdates adds custom sheet on storage change', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';

    extension.injectControllerCSS();
    // deferDOMWork is async — register listener explicitly for unit test
    extension.setupCSSLiveUpdates();
    expect(extension._customSheet).toBeNull();

    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: { customCSS: { newValue: 'vsc-controller { color: red; }' } },
      })
    );

    expect(extension._customSheet).not.toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._customSheet);
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
  });

  it('preprocesses domain selectors in live custom CSS updates', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';
    extension.injectControllerCSS();
    extension.setupCSSLiveUpdates();
    const replaceSync = vi.spyOn(CSSStyleSheet.prototype, 'replaceSync');

    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: {
          customCSS: {
            newValue: `:root[style*='--vsc-domain: "${location.hostname}"'] vsc-controller { color: red; }`,
          },
        },
      })
    );

    expect(replaceSync).toHaveBeenLastCalledWith('vsc-controller { color: red; }');
    replaceSync.mockRestore();
  });

  it.each([{ newValue: '' }, { oldValue: 'vsc-controller { color: red; }' }])(
    'setupCSSLiveUpdates removes custom sheet when customCSS cleared or deleted (%j)',
    (change) => {
      extension = window.VSC_controller;
      resetCSSState(extension);
      extension.config.settings.customCSS = 'vsc-controller { color: red; }';

      extension.injectControllerCSS();
      extension.setupCSSLiveUpdates();
      expect(extension._customSheet).not.toBeNull();

      document.documentElement.dispatchEvent(
        new CustomEvent('VSC_STORAGE_CHANGED', {
          detail: { customCSS: change },
        })
      );

      expect(extension._customSheet).toBeNull();
      expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
    }
  );

  it('setupCSSLiveUpdates is removed during teardown', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = '';
    extension.injectControllerCSS();
    extension.setupCSSLiveUpdates();

    const handler = extension.cssLiveUpdateHandler;
    const removeEventListener = vi.spyOn(document.documentElement, 'removeEventListener');

    extension.initialized = true;
    extension.teardown();

    expect(removeEventListener).toHaveBeenCalledWith('VSC_STORAGE_CHANGED', handler);
    expect(extension.cssLiveUpdateHandler).toBeNull();

    removeEventListener.mockRestore();
    extension.teardownRequested = false;
  });

  it('coalesces site-rule changes after settings listeners and stops queued updates on teardown', async () => {
    extension = window.VSC_controller;
    extension.setupSiteControlsLiveUpdates();
    const refresh = vi.spyOn(extension, 'refreshSiteControls').mockImplementation(() => {});
    const send = (detail) =>
      document.documentElement.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail }));
    send({ lastSpeed: { newValue: 2 } });
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    send({ siteRules: { newValue: [{ pattern: '/.*/', hideSiteControls: true }] } });
    send({ siteRules: { oldValue: [] } });
    expect(refresh).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    send({ siteRules: { newValue: [] } });
    extension.initialized = true;
    extension.teardown();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(extension.siteControlsLiveUpdateHandler).toBeNull();
    refresh.mockRestore();
    extension.teardownRequested = false;
  });

  it('VSC_GET_STATUS responds with current speed when all controlled media match', () => {
    extension = window.VSC_controller;
    expect(extension).toBeDefined();

    const video = createMockVideo({ readyState: 4, playbackRate: 1.5 });
    mockDOM.container.appendChild(video);
    video.vsc = { remove: vi.fn() };
    window.VSC.stateManager.controllers.set('status-test', {
      element: video,
      controller: { video },
    });

    const results = [];
    const handleResult = (event) => results.push(event.detail);
    document.documentElement.addEventListener('VSC_MESSAGE_RESULT', handleResult);

    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_MESSAGE', {
        detail: {
          type: window.VSC.Constants.MESSAGE_TYPES.GET_STATUS,
          requestId: 'status-1',
        },
      })
    );

    expect(results).toEqual([
      {
        requestId: 'status-1',
        ok: true,
        mediaCount: 1,
        pausedVideoCount: 0,
        currentSpeed: 1.5,
        speeds: [1.5],
      },
    ]);

    document.documentElement.removeEventListener('VSC_MESSAGE_RESULT', handleResult);
    window.VSC.stateManager.controllers.delete('status-test');
    delete video.vsc;
  });

  it('popup frame commands step paused videos using detected or configured fps, without rate changes', () => {
    extension = window.VSC_controller;
    const previousHandler = extension.actionHandler;
    const previousConfig = extension.config;
    const config = { getKeyBinding: vi.fn(() => 24) };
    const handler = new window.VSC.ActionHandler(config, null);
    const paused = createMockVideo({ currentTime: 10, paused: true });
    const playing = createMockVideo({ currentTime: 10, paused: false });
    mockDOM.container.append(paused, playing);
    const audio = document.createElement('audio');
    const rateWrite = vi.fn();
    Object.defineProperty(paused, 'playbackRate', { get: () => 3, set: rateWrite });
    Object.defineProperty(audio, 'currentTime', { value: 10, writable: true });
    paused.vsc = { detectedFps: 60, remove: vi.fn() };
    const media = [paused, playing, audio];
    const getAll = vi.spyOn(window.VSC.stateManager, 'getAllMediaElements').mockReturnValue(media);
    extension.actionHandler = handler;
    extension.config = config;
    const results = [];
    const onResult = (event) => results.push(event.detail);
    document.documentElement.addEventListener('VSC_MESSAGE_RESULT', onResult);
    const command = (direction) =>
      document.documentElement.dispatchEvent(
        new CustomEvent('VSC_MESSAGE', {
          detail: { type: 'VSC_STEP_FRAME', payload: { direction }, requestId: 'frame-test' },
        })
      );
    try {
      command(1);
      expect(paused.currentTime).toBeCloseTo(10 + 1 / 60);
      delete paused.vsc.detectedFps;
      command(-1);
      expect(paused.currentTime).toBeCloseTo(10 + 1 / 60 - 1 / 24);
      const beforeInvalid = paused.currentTime;
      for (const direction of [0, 2, -2, '1', NaN, null]) {
        command(direction);
      }
      expect(paused.currentTime).toBe(beforeInvalid);
      expect(playing.currentTime).toBe(10);
      expect(playing.paused).toBe(false);
      expect(audio.currentTime).toBe(10);
      expect(rateWrite).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({ ok: true, pausedVideoCount: 1 });
      expect(results.slice(2).every((result) => result.ok === false)).toBe(true);
      expect(config.getKeyBinding.mock.calls).toEqual([['advanceFrame'], ['rewindFrame']]);
    } finally {
      getAll.mockRestore();
      extension.actionHandler = previousHandler;
      extension.config = previousConfig;
      document.documentElement.removeEventListener('VSC_MESSAGE_RESULT', onResult);
      delete paused.vsc;
    }
  });

  it('popup frame status and dispatch require a current seekable paused video', () => {
    extension = window.VSC_controller;
    const previousHandler = extension.actionHandler;
    const stepFrame = vi.fn();
    const video = createMockVideo({ currentTime: 10, paused: true });
    video.duration = NaN;
    mockDOM.container.append(video);
    const getAll = vi
      .spyOn(window.VSC.stateManager, 'getAllMediaElements')
      .mockReturnValue([video]);
    extension.actionHandler = { stepFrame };
    const results = [];
    const onResult = (event) => results.push(event.detail);
    document.documentElement.addEventListener('VSC_MESSAGE_RESULT', onResult);
    const command = () =>
      document.documentElement.dispatchEvent(
        new CustomEvent('VSC_MESSAGE', {
          detail: { type: 'VSC_STEP_FRAME', payload: { direction: 1 }, requestId: 'bounds-test' },
        })
      );
    try {
      for (const duration of [NaN, Infinity, 0]) {
        video.duration = duration;
        expect(extension.getMediaStatus([video]).pausedVideoCount).toBe(0);
        command();
        expect(results.at(-1)).toMatchObject({ ok: false, pausedVideoCount: 0 });
      }
      expect(stepFrame).not.toHaveBeenCalled();
      Object.defineProperty(video, 'seekable', {
        configurable: true,
        value: { length: 1, start: () => 2, end: () => 30 },
      });
      expect(extension.getMediaStatus([video]).pausedVideoCount).toBe(1);
      command();
      expect(stepFrame).toHaveBeenCalledOnce();
      video.paused = false;
      command();
      expect(stepFrame).toHaveBeenCalledOnce();
      expect(results.at(-1)).toMatchObject({ ok: false, pausedVideoCount: 0 });
      video.paused = true;
      video.remove();
      command();
      expect(stepFrame).toHaveBeenCalledOnce();
      expect(results.at(-1)).toMatchObject({ ok: false, pausedVideoCount: 0 });
    } finally {
      getAll.mockRestore();
      extension.actionHandler = previousHandler;
      document.documentElement.removeEventListener('VSC_MESSAGE_RESULT', onResult);
    }
  });

  // --- Keypress-triggered synchronous rescan (late-loaded media safety net) ---

  it('rescanForMediaSync attaches a ready video and reports controlled media', () => {
    extension = window.VSC_controller;
    window.VSC.stateManager.controllers.clear();
    extension.teardownRequested = false;

    const video = createMockVideo({ readyState: 4 });
    mockDOM.container.appendChild(video);
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => [video]),
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => []),
    };
    const onVideoFound = vi.spyOn(extension, 'onVideoFound').mockImplementation((v) => {
      window.VSC.stateManager.controllers.set('rescan-ready', {
        element: v,
        controller: { video: v },
      });
    });

    const result = extension.rescanForMediaSync();

    expect(onVideoFound).toHaveBeenCalledWith(video, video.parentElement || video.parentNode);
    expect(extension.mediaObserver.scanAll).not.toHaveBeenCalled();
    expect(result).toBe(true);

    onVideoFound.mockRestore();
    window.VSC.stateManager.controllers.clear();
  });

  it('rescanForMediaSync skips scanAll when no media indicators and returns false', () => {
    extension = window.VSC_controller;
    window.VSC.stateManager.controllers.clear();
    extension.teardownRequested = false;

    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => false),
      scanAll: vi.fn(() => []),
    };
    const onVideoFound = vi.spyOn(extension, 'onVideoFound');

    const result = extension.rescanForMediaSync();

    expect(extension.mediaObserver.scanAll).not.toHaveBeenCalled();
    expect(onVideoFound).not.toHaveBeenCalled();
    expect(result).toBe(false);

    onVideoFound.mockRestore();
  });

  it('rescanForMediaSync escalates to scanAll when light scan is empty but indicators exist', () => {
    extension = window.VSC_controller;
    window.VSC.stateManager.controllers.clear();
    extension.teardownRequested = false;

    const shadowVideo = createMockVideo({ readyState: 4 });
    mockDOM.container.appendChild(shadowVideo);
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => [shadowVideo]),
    };
    const onVideoFound = vi.spyOn(extension, 'onVideoFound').mockImplementation(() => {});

    extension.rescanForMediaSync();

    expect(extension.mediaObserver.scanAll).toHaveBeenCalledWith(document);
    expect(onVideoFound).toHaveBeenCalledWith(
      shadowVideo,
      shadowVideo.parentElement || shadowVideo.parentNode
    );

    onVideoFound.mockRestore();
  });

  it('rescanForMediaSync does not escalate to scanAll when the light scan attaches media', () => {
    extension = window.VSC_controller;
    window.VSC.stateManager.controllers.clear();
    extension.teardownRequested = false;

    const video = createMockVideo({ readyState: 4 });
    mockDOM.container.appendChild(video);
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => [video]),
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => []),
    };
    vi.spyOn(extension, 'onVideoFound').mockImplementation((v) => {
      window.VSC.stateManager.controllers.set('rescan-light', {
        element: v,
        controller: { video: v },
      });
    });

    extension.rescanForMediaSync();

    expect(extension.mediaObserver.scanAll).not.toHaveBeenCalled();

    extension.onVideoFound.mockRestore();
    window.VSC.stateManager.controllers.clear();
  });

  it('rescanForMediaSync is a no-op (returns false) after teardown is requested', () => {
    extension = window.VSC_controller;
    extension.teardownRequested = true;
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => []),
      hasMediaIndicators: vi.fn(() => true),
      scanAll: vi.fn(() => []),
    };

    const result = extension.rescanForMediaSync();

    expect(result).toBe(false);
    expect(extension.mediaObserver.scanForMediaLight).not.toHaveBeenCalled();
    expect(extension.mediaObserver.scanAll).not.toHaveBeenCalled();

    extension.teardownRequested = false;
  });

  it('rescanForMediaSync primes a not-ready video without attaching (returns false)', () => {
    extension = window.VSC_controller;
    window.VSC.stateManager.controllers.clear();
    extension.teardownRequested = false;

    const video = createMockVideo({ readyState: 1 });
    video.addEventListener = vi.fn();
    mockDOM.container.appendChild(video);
    extension.mediaObserver = {
      scanForMediaLight: vi.fn(() => [video]),
      hasMediaIndicators: vi.fn(() => false),
      scanAll: vi.fn(() => []),
      isValidMediaElement: vi.fn(() => true),
      shouldStartHidden: vi.fn(() => false),
    };
    const onVideoFound = vi.spyOn(extension, 'onVideoFound');

    const result = extension.rescanForMediaSync();

    expect(onVideoFound).toHaveBeenCalledWith(video, video.parentElement || video.parentNode);
    expect(video.vsc).toBeUndefined();
    expect(window.VSC.stateManager.getControlledElements().length).toBe(0);
    expect(result).toBe(false);

    onVideoFound.mockRestore();
  });

  it('setupEventPipeline wires eventManager.requestMediaRescan to rescanForMediaSync', () => {
    extension = window.VSC_controller;
    extension.eventManager = null;
    extension.eventListenersInitialized = false;

    extension.setupEventPipeline(document);

    expect(typeof extension.eventManager.requestMediaRescan).toBe('function');

    const rescan = vi.spyOn(extension, 'rescanForMediaSync').mockReturnValue(true);
    const result = extension.eventManager.requestMediaRescan();

    expect(rescan).toHaveBeenCalledOnce();
    expect(result).toBe(true);

    rescan.mockRestore();
    extension.eventManager.cleanup();
    extension.eventManager = null;
    extension.eventListenersInitialized = false;
  });
  it('leaves foreign-document media to its own frame instance', () => {
    extension = window.VSC_controller;
    const foreign = document.implementation.createHTMLDocument('child');
    const video = foreign.createElement('video');
    foreign.body.append(video);
    extension.onVideoFound(video, foreign.body);
    expect(video.vsc).toBeUndefined();
    expect(video._vscPendingAttachment).toBeUndefined();
    expect(new window.VSC.YouTubeHandler().detectSpecialVideos(document)).toEqual([]);
  });
});

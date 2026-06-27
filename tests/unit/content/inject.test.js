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

  it('setupCSSLiveUpdates removes custom sheet when customCSS cleared', () => {
    extension = window.VSC_controller;
    resetCSSState(extension);
    extension.config.settings.customCSS = 'vsc-controller { color: red; }';

    extension.injectControllerCSS();
    extension.setupCSSLiveUpdates();
    expect(extension._customSheet).not.toBeNull();

    document.documentElement.dispatchEvent(
      new CustomEvent('VSC_STORAGE_CHANGED', {
        detail: { customCSS: { newValue: '' } },
      })
    );

    expect(extension._customSheet).toBeNull();
    expect(document.adoptedStyleSheets).toContain(extension._controllerSheet);
  });

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
        currentSpeed: 1.5,
        speeds: [1.5],
      },
    ]);

    document.documentElement.removeEventListener('VSC_MESSAGE_RESULT', handleResult);
    window.VSC.stateManager.controllers.delete('status-test');
    delete video.vsc;
  });
});

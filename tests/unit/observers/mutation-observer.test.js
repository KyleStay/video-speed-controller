// Import necessary modules
import { installChromeMock, cleanupChromeMock } from '../../helpers/chrome-mock.js';

// Load all required modules

describe('MutationObserver', () => {
  beforeEach(() => {
    installChromeMock();
  });

  afterEach(() => {
    cleanupChromeMock();
  });

  it('VideoMutationObserver should process element nodes', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    const videoElement = document.createElement('video');
    const divElement = document.createElement('div');

    const mutation = {
      type: 'childList',
      addedNodes: [videoElement, divElement],
      removedNodes: [],
      target: document.body,
    };

    observer.processChildListMutation(mutation);

    // Video element should trigger callback
    expect(mockOnVideoFound.length).toBe(1);
    expect(mockOnVideoFound[0].video).toBe(videoElement);
    expect(mockOnVideoFound[0].parent).toBe(document.body);
  });

  it('VideoMutationObserver should skip non-element nodes', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    const textNode = document.createTextNode('text');
    const commentNode = document.createComment('comment');
    const videoElement = document.createElement('video');

    const mutation = {
      type: 'childList',
      addedNodes: [textNode, commentNode, videoElement],
      removedNodes: [],
      target: document.body,
    };

    observer.processChildListMutation(mutation);

    // Only video element should be processed
    expect(mockOnVideoFound.length).toBe(1);
    expect(mockOnVideoFound[0].video).toBe(videoElement);
    expect(mockOnVideoFound[0].parent).toBe(document.body);
  });

  it('VideoMutationObserver should handle removed video elements', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    const videoElement = document.createElement('video');
    videoElement.vsc = { remove: () => {} };

    const mutation = {
      type: 'childList',
      addedNodes: [],
      removedNodes: [videoElement],
      target: document.body,
    };

    observer.processChildListMutation(mutation);

    expect(mockOnVideoRemoved.length).toBe(1);
    expect(mockOnVideoRemoved[0]).toBe(videoElement);
  });

  it('VideoMutationObserver should handle null and undefined nodes gracefully', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    const mutation = {
      type: 'childList',
      addedNodes: [null, undefined, document.createElement('video')],
      removedNodes: [null, undefined],
      target: document.body,
    };

    // Should not throw
    observer.processChildListMutation(mutation);

    // Only the video element should be processed
    expect(mockOnVideoFound.length).toBe(1);
    expect(mockOnVideoRemoved.length).toBe(0);
  });

  it('VideoMutationObserver should detect video elements in shadow DOM', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const videoElement = document.createElement('video');
    shadowRoot.appendChild(videoElement);

    observer.checkForVideoAndShadowRoot(host, document.body, true);

    expect(mockOnVideoFound.length).toBe(1);
    expect(mockOnVideoFound[0].video).toBe(videoElement);
    expect(mockOnVideoFound[0].parent).toBe(videoElement.parentNode);
  });

  it('VideoMutationObserver should handle HTMLCollection children properly', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    // Create a container with multiple child elements including a video
    const container = document.createElement('div');
    const videoElement = document.createElement('video');
    const spanElement = document.createElement('span');
    const pElement = document.createElement('p');

    container.appendChild(spanElement);
    container.appendChild(videoElement);
    container.appendChild(pElement);

    // Simulate the processNodeChildren call directly
    observer.processNodeChildren(container, document.body, true);

    // Should find the video element in the children
    expect(mockOnVideoFound.length).toBe(1);
    expect(mockOnVideoFound[0].video).toBe(videoElement);
  });

  it('VideoMutationObserver should detect nested video elements', () => {
    const mockConfig = { settings: {} };
    const mockOnVideoFound = [];
    const mockOnVideoRemoved = [];

    const onVideoFound = (video, parent) => {
      mockOnVideoFound.push({ video, parent });
    };

    const onVideoRemoved = (video) => {
      mockOnVideoRemoved.push(video);
    };

    const observer = new window.VSC.VideoMutationObserver(mockConfig, onVideoFound, onVideoRemoved);

    const container = document.createElement('div');
    const innerDiv = document.createElement('div');
    const videoElement = document.createElement('video');
    innerDiv.appendChild(videoElement);
    container.appendChild(innerDiv);

    observer.checkForVideoAndShadowRoot(container, document.body, true);

    expect(mockOnVideoFound.length).toBe(1);
    expect(mockOnVideoFound[0].video).toBe(videoElement);
    expect(mockOnVideoFound[0].parent).toBe(videoElement.parentNode);
  });

  it('VideoMutationObserver should coalesce mutation processing into one idle callback', () => {
    const originalRequestIdleCallback = window.requestIdleCallback;
    const idleCallbacks = [];
    window.requestIdleCallback = (callback) => {
      idleCallbacks.push(callback);
    };

    const observer = new window.VSC.VideoMutationObserver(
      { settings: {} },
      () => {},
      () => {}
    );
    observer.processMutations = vi.fn();

    const firstMutation = { type: 'childList', addedNodes: [], removedNodes: [] };
    const secondMutation = { type: 'attributes', target: document.body };

    observer.scheduleMutationProcessing([firstMutation]);
    observer.scheduleMutationProcessing([secondMutation]);

    expect(idleCallbacks.length).toBe(1);

    idleCallbacks[0]();

    expect(observer.processMutations).toHaveBeenCalledOnce();
    expect(observer.processMutations).toHaveBeenCalledWith([firstMutation, secondMutation]);

    window.requestIdleCallback = originalRequestIdleCallback;
  });

  it('VideoMutationObserver should cancel pending mutation callback on stop', () => {
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    let pendingCallback;
    window.requestIdleCallback = (callback) => {
      pendingCallback = callback;
      return 99;
    };
    window.cancelIdleCallback = vi.fn();

    const observer = new window.VSC.VideoMutationObserver(
      { settings: {} },
      () => {},
      () => {}
    );
    observer.processMutations = vi.fn();

    observer.scheduleMutationProcessing([{ type: 'childList', addedNodes: [], removedNodes: [] }]);
    observer.stop();
    pendingCallback();

    expect(window.cancelIdleCallback).toHaveBeenCalledWith(99);
    expect(observer.processMutations).not.toHaveBeenCalled();
    expect(observer.pendingMutations).toEqual([]);

    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('VideoMutationObserver should not query arbitrary style/class mutation subtrees', () => {
    const observer = new window.VSC.VideoMutationObserver(
      { settings: { audioBoolean: true } },
      () => {},
      () => {}
    );
    const container = document.createElement('div');
    container.querySelectorAll = vi.fn();
    container.querySelector = vi.fn(() => null);

    observer.handleVisibilityChanges(container);

    expect(container.querySelectorAll).not.toHaveBeenCalled();
  });

  it('VideoMutationObserver should disconnect shadow observers on stop', () => {
    const observer = new window.VSC.VideoMutationObserver(
      { settings: {} },
      () => {},
      () => {}
    );
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });

    observer.observeShadowRoot(shadowRoot);
    const shadowObserver = observer.shadowObservers.get(shadowRoot);
    const disconnect = vi.spyOn(shadowObserver, 'disconnect');

    observer.stop();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(observer.shadowObservers.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // P3: style/class attribute observation deferred until first media element
  // ---------------------------------------------------------------------------

  describe('deferred attribute observation (P3)', () => {
    it('does not watch style/class before any media is seen', () => {
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        () => {},
        () => {}
      );
      const options = observer.buildObserverOptions();
      expect(observer.attributeObservationEnabled).toBe(false);
      expect(options.attributeFilter).not.toContain('style');
      expect(options.attributeFilter).not.toContain('class');
      // Minimal attributes still watched for the Apple TV / shadow cases.
      expect(options.attributeFilter).toContain('aria-hidden');
    });

    it('enableAttributeObservation adds style/class and re-observes the document', () => {
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        () => {},
        () => {}
      );
      observer.start(document);
      const observeSpy = vi.spyOn(observer.observer, 'observe');

      observer.enableAttributeObservation();

      expect(observer.attributeObservationEnabled).toBe(true);
      const options = observer.buildObserverOptions();
      expect(options.attributeFilter).toContain('style');
      expect(options.attributeFilter).toContain('class');
      // Re-observed with the upgraded filter.
      expect(observeSpy).toHaveBeenCalledWith(document, expect.objectContaining({ subtree: true }));

      observer.stop();
    });

    it('enableAttributeObservation is idempotent', () => {
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        () => {},
        () => {}
      );
      observer.start(document);
      const observeSpy = vi.spyOn(observer.observer, 'observe');

      observer.enableAttributeObservation();
      observer.enableAttributeObservation();
      observer.enableAttributeObservation();

      expect(observeSpy).toHaveBeenCalledTimes(1);
      observer.stop();
    });
  });

  // ---------------------------------------------------------------------------
  // R3: shadow observers pruned when their host leaves the DOM
  // ---------------------------------------------------------------------------

  describe('shadow observer pruning (R3)', () => {
    it('prunes observers whose host is disconnected', () => {
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        () => {},
        () => {}
      );

      const connectedHost = document.createElement('div');
      document.body.appendChild(connectedHost);
      const connectedRoot = connectedHost.attachShadow({ mode: 'open' });

      const detachedHost = document.createElement('div'); // never added to DOM
      const detachedRoot = detachedHost.attachShadow({ mode: 'open' });

      observer.observeShadowRoot(connectedRoot);
      observer.observeShadowRoot(detachedRoot);
      expect(observer.shadowObservers.size).toBe(2);

      observer.pruneDetachedShadowObservers();

      expect(observer.shadowObservers.has(connectedRoot)).toBe(true);
      expect(observer.shadowObservers.has(detachedRoot)).toBe(false);
      expect(observer.shadowObservers.size).toBe(1);

      connectedHost.remove();
    });

    it('processMutations prunes detached shadow observers after a removal', () => {
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        () => {},
        () => {}
      );
      const detachedHost = document.createElement('div');
      const detachedRoot = detachedHost.attachShadow({ mode: 'open' });
      observer.observeShadowRoot(detachedRoot);
      expect(observer.shadowObservers.size).toBe(1);

      // A childList mutation that removed a node triggers the prune pass.
      observer.processMutations([
        { type: 'childList', addedNodes: [], removedNodes: [document.createElement('span')] },
      ]);

      expect(observer.shadowObservers.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // R2: document replacement triggers reinitialization callback
  // ---------------------------------------------------------------------------

  describe('document replacement recovery (R2)', () => {
    it('invokes the onDocumentReplaced callback when documentElement is re-added', () => {
      const onReplaced = vi.fn();
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        () => {},
        () => {},
        null,
        onReplaced
      );

      observer.processChildListMutation({
        type: 'childList',
        addedNodes: [document.documentElement],
        removedNodes: [],
        target: document,
      });

      expect(onReplaced).toHaveBeenCalledOnce();
    });

    it('stops processing remaining added nodes once teardown deactivates it', () => {
      const onVideoFound = vi.fn();
      // Callback simulates the extension tearing the observer down mid-batch.
      const observer = new window.VSC.VideoMutationObserver(
        { settings: {} },
        onVideoFound,
        () => {},
        null,
        () => {
          observer.active = false;
        }
      );

      const trailingVideo = document.createElement('video');
      observer.processChildListMutation({
        type: 'childList',
        addedNodes: [document.documentElement, trailingVideo],
        removedNodes: [],
        target: document,
      });

      // The video after the documentElement node must not be processed against
      // the now-stale tree.
      expect(onVideoFound).not.toHaveBeenCalled();
    });
  });
});

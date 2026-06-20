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
});

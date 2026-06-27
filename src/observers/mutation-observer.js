/**
 * DOM mutation observer for detecting video elements
 */

window.VSC = window.VSC || {};

class VideoMutationObserver {
  constructor(config, onVideoFound, onVideoRemoved, mediaObserver, onDocumentReplaced) {
    this.config = config;
    this.onVideoFound = onVideoFound;
    this.onVideoRemoved = onVideoRemoved;
    this.mediaObserver = mediaObserver;
    this.onDocumentReplacedCallback = onDocumentReplaced || null;
    this.observer = null;
    this.observedDocument = null;
    this.shadowObservers = new Map();
    this.pendingMutations = [];
    this.mutationCallbackScheduled = false;
    this.mutationCallbackId = null;
    this.mutationCallbackType = null;
    this.active = true;
    // style/class attribute churn is only worth watching once a media element
    // exists on the page. Until then we observe a minimal attribute set to
    // avoid processing constant SPA style/class mutations on media-less pages.
    this.attributeObservationEnabled = false;
  }

  /**
   * Start observing DOM mutations
   * @param {Document} document - Document to observe
   */
  start(document) {
    this.active = true;
    this.observedDocument = document;
    this.observer = new MutationObserver((mutations) => {
      this.scheduleMutationProcessing(mutations);
    });

    this.observer.observe(document, this.buildObserverOptions());
    window.VSC.logger.debug('Video mutation observer started');
  }

  /**
   * Build observer options. style/class are only included once media has been
   * seen (see enableAttributeObservation).
   * @returns {MutationObserverInit}
   * @private
   */
  buildObserverOptions() {
    const attributeFilter = ['aria-hidden', 'data-focus-method'];
    if (this.attributeObservationEnabled) {
      attributeFilter.push('style', 'class');
    }
    return {
      attributeFilter,
      childList: true,
      subtree: true,
    };
  }

  /**
   * Upgrade the root observer to also watch style/class once a media element
   * exists. Idempotent and cheap to call on every video attach.
   */
  enableAttributeObservation() {
    if (this.attributeObservationEnabled || !this.active) {
      return;
    }
    this.attributeObservationEnabled = true;
    if (this.observer && this.observedDocument) {
      // Re-observing the same node replaces its options with the fuller filter.
      this.observer.observe(this.observedDocument, this.buildObserverOptions());
      window.VSC.logger.debug('Enabled style/class observation after first media element');
    }
  }

  /**
   * Queue mutation records and process them in one idle callback.
   * @param {Array<MutationRecord>} mutations - Mutation records
   * @private
   */
  scheduleMutationProcessing(mutations) {
    if (!this.active || typeof window === 'undefined') {
      return;
    }

    this.pendingMutations.push(...mutations);

    if (this.mutationCallbackScheduled) {
      return;
    }

    this.mutationCallbackScheduled = true;
    const callback = () => {
      this.mutationCallbackId = null;
      this.mutationCallbackType = null;
      this.mutationCallbackScheduled = false;
      if (!this.active || typeof window === 'undefined') {
        this.pendingMutations = [];
        return;
      }
      const queuedMutations = this.pendingMutations;
      this.pendingMutations = [];
      this.processMutations(queuedMutations);
    };

    if (typeof window !== 'undefined' && window.requestIdleCallback) {
      this.mutationCallbackType = 'idle';
      this.mutationCallbackId = window.requestIdleCallback(callback, { timeout: 1500 });
    } else {
      this.mutationCallbackType = 'timer';
      this.mutationCallbackId = setTimeout(callback, 100);
    }
  }

  /**
   * Process mutation events
   * @param {Array<MutationRecord>} mutations - Mutation records
   * @private
   */
  processMutations(mutations) {
    if (!this.active) {
      return;
    }

    let sawRemoval = false;
    for (const mutation of mutations) {
      // A document replacement (handled below) tears this observer down
      // mid-batch; bail out so we don't keep operating on stale state.
      if (!this.active) {
        return;
      }
      switch (mutation.type) {
        case 'childList':
          if (mutation.removedNodes && mutation.removedNodes.length > 0) {
            sawRemoval = true;
          }
          this.processChildListMutation(mutation);
          break;
        case 'attributes':
          this.processAttributeMutation(mutation);
          break;
      }
    }

    // Removed subtrees may have contained observed shadow roots; drop observers
    // whose host is no longer connected so they don't accumulate over an SPA
    // session (memory + wasted CPU on every mutation).
    if (sawRemoval && this.shadowObservers.size > 0) {
      this.pruneDetachedShadowObservers();
    }
  }

  /**
   * Process child list mutations (added/removed nodes)
   * @param {MutationRecord} mutation - Mutation record
   * @private
   */
  processChildListMutation(mutation) {
    // Handle added nodes
    mutation.addedNodes.forEach((node) => {
      // A prior node in this batch may have triggered a document-replacement
      // teardown; stop touching the (now stale) tree.
      if (!this.active) {
        return;
      }

      // Only process element nodes (nodeType 1)
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      if (node === document.documentElement) {
        // Document was replaced (e.g., watch.sling.com uses document.write)
        window.VSC.logger.debug('Document was replaced, reinitializing');
        this.onDocumentReplaced();
        return;
      }

      this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, true);
    });

    // Handle removed nodes
    mutation.removedNodes.forEach((node) => {
      // Only process element nodes (nodeType 1)
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }
      this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, false);
    });
  }

  /**
   * Process attribute mutations
   * @param {MutationRecord} mutation - Mutation record
   * @private
   */
  processAttributeMutation(mutation) {
    // Handle style and class changes that might affect video visibility
    if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
      this.handleVisibilityChanges(mutation.target);
    }

    // Handle special cases like Apple TV+ player. Keep this scoped to the
    // custom player element so generic aria-hidden changes do not trigger a
    // whole-page shadow traversal on busy apps.
    if (mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER') {
      if (
        mutation.target.attributes['aria-hidden'] &&
        mutation.target.attributes['aria-hidden'].value !== 'false'
      ) {
        return;
      }

      const flattenedNodes = window.VSC.DomUtils.getShadow(mutation.target);
      const videoNodes = flattenedNodes.filter((x) => x.tagName === 'VIDEO');

      for (const node of videoNodes) {
        // Only add vsc the first time for the apple-tv case
        if (node.vsc && mutation.target.nodeName === 'APPLE-TV-PLUS-PLAYER') {
          continue;
        }

        if (node.vsc) {
          node.vsc.remove();
        }

        this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, true);
      }
    }
  }

  /**
   * Handle visibility changes on elements that might contain videos
   * @param {Element} element - Element that had style/class changes
   * @private
   */
  handleVisibilityChanges(element) {
    // If the element itself is a video
    if (
      element.tagName === 'VIDEO' ||
      (element.tagName === 'AUDIO' && this.config.settings.audioBoolean)
    ) {
      this.recheckVideoElement(element);
      return;
    }

    // Recheck known controlled media under this element. Avoid broad
    // querySelectorAll() on arbitrary style/class churn from large SPA trees.
    const videos = window.VSC.stateManager
      ? window.VSC.stateManager
          .getControlledElements()
          .filter((video) => video === element || element.contains?.(video))
      : [];

    if (videos.length === 0 && !this.nodeMayContainMedia(element)) {
      return;
    }

    videos.forEach((video) => {
      this.recheckVideoElement(video);
    });
  }

  /**
   * Re-check if a video element should have a controller attached
   * @param {HTMLMediaElement} video - Video element to recheck
   * @private
   */
  recheckVideoElement(video) {
    if (!this.mediaObserver) {
      return;
    }

    if (video.vsc) {
      // Video already has controller, check if it should be removed or just hidden
      if (!this.mediaObserver.isValidMediaElement(video)) {
        window.VSC.logger.debug('Video became invalid, removing controller');
        video.vsc.remove();
        video.vsc = null;
      } else {
        // Video is still valid, update visibility based on current state
        video.vsc.updateVisibility();
      }
    } else {
      // Video doesn't have controller, check if it should get one
      if (this.mediaObserver.isValidMediaElement(video)) {
        window.VSC.logger.debug('Video became valid, attaching controller');
        this.onVideoFound(video, video.parentElement || video.parentNode);
      }
    }
  }

  /**
   * Check if node is or contains video elements
   * @param {Node} node - Node to check
   * @param {Node} parent - Parent node
   * @param {boolean} added - True if node was added, false if removed
   * @private
   */
  checkForVideoAndShadowRoot(node, parent, added) {
    // Only proceed with removal if node is missing from DOM
    if (!added && document.body?.contains(node)) {
      return;
    }

    if (
      node.nodeName === 'VIDEO' ||
      (node.nodeName === 'AUDIO' && this.config.settings.audioBoolean)
    ) {
      if (added) {
        this.onVideoFound(node, parent);
      } else {
        if (node.vsc) {
          this.onVideoRemoved(node);
        }
      }
    } else {
      this.processNodeChildren(node, parent, added);
    }
  }

  /**
   * Process children of a node recursively
   * @param {Node} node - Node to process
   * @param {Node} parent - Parent node
   * @param {boolean} added - True if node was added
   * @private
   */
  processNodeChildren(node, parent, added) {
    if (!this.nodeMayContainMedia(node)) {
      return;
    }

    let children = [];

    // Handle shadow DOM
    if (node.shadowRoot) {
      this.observeShadowRoot(node.shadowRoot);
      children = Array.from(node.shadowRoot.children);
    }

    // Handle regular children
    if (node.children) {
      children = [...children, ...Array.from(node.children)];
    }

    // Process all children
    for (const child of children) {
      this.checkForVideoAndShadowRoot(child, child.parentNode || parent, added);
    }
  }

  /**
   * Fast preflight for expensive subtree walks.
   * @param {Node} node - Candidate node
   * @returns {boolean} True when node or descendants might include media
   * @private
   */
  nodeMayContainMedia(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const mediaSelector = this.config.settings.audioBoolean ? 'video,audio' : 'video';
    if (node.matches?.(mediaSelector) || node.querySelector?.(mediaSelector)) {
      return true;
    }

    if (node.shadowRoot) {
      return true;
    }

    return Boolean(Array.from(node.children || []).some((child) => child.shadowRoot));
  }

  /**
   * Set up observer for shadow root
   * @param {ShadowRoot} shadowRoot - Shadow root to observe
   * @private
   */
  observeShadowRoot(shadowRoot) {
    if (this.shadowObservers.has(shadowRoot)) {
      return; // Already observing
    }

    const shadowObserver = new MutationObserver((mutations) => {
      this.scheduleMutationProcessing(mutations);
    });

    const observerOptions = {
      attributeFilter: ['aria-hidden', 'data-focus-method'],
      childList: true,
      subtree: true,
    };

    shadowObserver.observe(shadowRoot, observerOptions);
    this.shadowObservers.set(shadowRoot, shadowObserver);

    window.VSC.logger.debug('Shadow root observer added');
  }

  /**
   * Disconnect observers for shadow roots whose host has left the DOM.
   * @private
   */
  pruneDetachedShadowObservers() {
    for (const [shadowRoot, shadowObserver] of this.shadowObservers) {
      const host = shadowRoot.host;
      if (!host || host.isConnected === false) {
        shadowObserver.disconnect();
        this.shadowObservers.delete(shadowRoot);
        window.VSC.logger.debug('Pruned shadow observer for detached host');
      }
    }
  }

  /**
   * Handle document replacement (e.g. a site that rewrites the page via
   * document.write). The previous observers, listeners, controllers, and CSS
   * were all bound to the now-detached document, so trigger a full
   * reinitialization on the new document via the injected callback.
   * @private
   */
  onDocumentReplaced() {
    window.VSC.logger.warn('Document replacement detected - triggering reinitialization');
    if (typeof this.onDocumentReplacedCallback === 'function') {
      this.onDocumentReplacedCallback();
    }
  }

  /**
   * Stop observing and clean up
   */
  stop() {
    this.active = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.mutationCallbackScheduled) {
      if (this.mutationCallbackType === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.mutationCallbackId);
      } else {
        clearTimeout(this.mutationCallbackId);
      }
      this.mutationCallbackId = null;
      this.mutationCallbackType = null;
    }

    // Clean up shadow observers
    this.shadowObservers.forEach((shadowObserver) => {
      shadowObserver.disconnect();
    });
    this.shadowObservers.clear();
    this.pendingMutations = [];
    this.mutationCallbackScheduled = false;

    window.VSC.logger.debug('Video mutation observer stopped');
  }
}

// Create singleton instance
window.VSC.VideoMutationObserver = VideoMutationObserver;

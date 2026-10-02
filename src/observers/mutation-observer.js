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
    this.pendingMutationIndex = 0;
    this.pendingWalks = [];
    this.pendingRepairs = null;
    this.needsControllerReconciliation = false;
    this.pendingAttributeTargets = new Map();
    this.scannedAdded = new WeakSet();
    this.scannedRemoved = new WeakSet();
    this.mutationStats = {
      queued: 0,
      processed: 0,
      coalesced: 0,
      slices: 0,
      maxSliceMs: 0,
      maxQueueSize: 0,
    };
    this.mutationCallbackScheduled = false;
    this.mutationCallbackId = null;
    this.mutationCallbackType = null;
    this.active = true;
    // style/class attribute churn is only worth watching once a media element
    // exists on the page. Until then we observe a minimal attribute set to
    // avoid processing constant SPA style/class mutations on media-less pages.
    this.attributeObservationEnabled = false;
    this.attachShadowPrototype = null;
    this.originalAttachShadow = null;
    this.attachShadowWrapper = null;
    this.mediaReadyHandler = (event) => {
      const media = event.target;
      if (
        !this.active ||
        !media?.isConnected ||
        media.ownerDocument !== this.observedDocument ||
        media.vsc ||
        media.readyState < 2 ||
        !(
          media.tagName === 'VIDEO' ||
          (media.tagName === 'AUDIO' && this.config.settings.audioBoolean)
        )
      ) {
        return;
      }
      // Infinite-scroll players can become ready before their queued DOM
      // mutations run. Discover just this media, even with older controllers
      // present, without rescanning the feed or waiting for an idle slot.
      this.onVideoFound(media, media.parentElement || media.parentNode);
    };
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
    this.listenForReadyMedia(document);
    this.setupAttachShadowHook();
    window.VSC.logger.debug('Video mutation observer started');
  }

  /** Capture non-bubbling media readiness events on a document or shadow root. */
  listenForReadyMedia(root) {
    // Feed recovery must not change readiness-event ordering on other sites.
    // YouTube/Polymer needs its player handlers to finish before DOM insertion.
    if (!window.VSC.EventManager.isTwitterHost(window.location.hostname)) {
      return;
    }
    for (const type of VideoMutationObserver.MEDIA_READY_EVENTS) {
      root.addEventListener(type, this.mediaReadyHandler, true);
    }
  }

  unlistenForReadyMedia(root) {
    for (const type of VideoMutationObserver.MEDIA_READY_EVENTS) {
      root.removeEventListener(type, this.mediaReadyHandler, true);
    }
  }

  /**
   * Observe open roots created after their host is already connected. Creating
   * a shadow root does not itself emit a MutationObserver record, so without
   * this guarded hook late custom-element upgrades are invisible.
   * @private
   */
  setupAttachShadowHook() {
    try {
      const prototype = window.Element?.prototype;
      const original = prototype?.attachShadow;
      if (typeof original !== 'function' || this.attachShadowWrapper) {
        return;
      }

      const owner = this;
      const wrapper = function (init) {
        const shadowRoot = Reflect.apply(original, this, [init]);
        if (init?.mode === 'open' && owner.active) {
          owner.observeShadowRoot(shadowRoot);
        }
        return shadowRoot;
      };

      prototype.attachShadow = wrapper;
      this.attachShadowPrototype = prototype;
      this.originalAttachShadow = original;
      this.attachShadowWrapper = wrapper;
    } catch (error) {
      window.VSC.logger.debug(`Could not hook attachShadow: ${error.message}`);
    }
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
      for (const [shadowRoot, shadowObserver] of this.shadowObservers) {
        shadowObserver.observe(shadowRoot, this.buildObserverOptions());
      }
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
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        let names = this.pendingAttributeTargets.get(mutation.target);
        if (!names) {
          names = new Set();
          this.pendingAttributeTargets.set(mutation.target, names);
        }
        if (names.has(mutation.attributeName)) {
          this.mutationStats.coalesced++;
          continue;
        }
        names.add(mutation.attributeName);
      }
      this.pendingMutations.push(mutation);
      this.mutationStats.queued++;
    }
    this.mutationStats.maxQueueSize = Math.max(
      this.mutationStats.maxQueueSize,
      this.getPendingWorkCount()
    );
    this.scheduleSlice(false);
  }

  getPendingWorkCount() {
    return (
      this.pendingMutations.length -
      this.pendingMutationIndex +
      this.pendingWalks.length +
      (this.pendingRepairs || this.needsControllerReconciliation ? 1 : 0)
    );
  }

  scheduleSlice(continuation) {
    if (
      !this.active ||
      typeof window === 'undefined' ||
      this.mutationCallbackScheduled ||
      !this.getPendingWorkCount()
    ) {
      return;
    }
    this.mutationCallbackScheduled = true;
    const callback = () => {
      this.mutationCallbackId = null;
      this.mutationCallbackType = null;
      this.mutationCallbackScheduled = false;
      this.drainSlice();
    };
    if (window.requestIdleCallback) {
      this.mutationCallbackType = 'idle';
      this.mutationCallbackId = window.requestIdleCallback(callback, {
        timeout: continuation ? 50 : 1500,
      });
    } else {
      this.mutationCallbackType = 'timer';
      this.mutationCallbackId = setTimeout(callback, continuation ? 0 : 100);
    }
  }

  drainSlice() {
    if (!this.active || typeof window === 'undefined') {
      return;
    }
    const started = performance.now();
    let units = 0;
    this.deferSubtreeTraversal = true;
    this.visibilityChecked = new Set();
    try {
      while (this.active && this.getPendingWorkCount() && units++ < 500) {
        if (units > 1 && performance.now() - started >= 4) {
          break;
        }
        try {
          if (this.pendingMutationIndex < this.pendingMutations.length) {
            const mutation = this.pendingMutations[this.pendingMutationIndex];
            this.pendingMutations[this.pendingMutationIndex++] = null;
            if (mutation.type === 'attributes') {
              const names = this.pendingAttributeTargets.get(mutation.target);
              names?.delete(mutation.attributeName);
              if (names?.size === 0) {
                this.pendingAttributeTargets.delete(mutation.target);
              }
            }
            this.processMutations([mutation]);
            this.mutationStats.processed++;
          } else if (this.needsControllerReconciliation || this.pendingRepairs) {
            if (this.needsControllerReconciliation) {
              this.needsControllerReconciliation = false;
              this.pendingRepairs =
                window.VSC.stateManager?.controllers?.values() || [][Symbol.iterator]();
            }
            const next = this.pendingRepairs.next();
            if (next.done) {
              this.pendingRepairs = null;
            } else {
              this.reconcileController(next.value);
            }
          } else {
            const job = this.pendingWalks[this.pendingWalks.length - 1];
            if (!this.stepWalk(job)) {
              this.pendingWalks.pop();
            }
          }
        } catch (error) {
          window.VSC.logger.warn(`Mutation work failed: ${error.message}`);
        }
      }
    } finally {
      this.deferSubtreeTraversal = false;
      this.visibilityChecked = null;
      this.mutationStats.slices++;
      this.mutationStats.maxSliceMs = Math.max(
        this.mutationStats.maxSliceMs,
        performance.now() - started
      );
    }
    // Release processed records even when subtree work spans many slices.
    if (this.pendingMutationIndex === this.pendingMutations.length) {
      this.pendingMutations = [];
      this.pendingMutationIndex = 0;
    }
    if (!this.getPendingWorkCount()) {
      this.pendingAttributeTargets.clear();
      this.scannedAdded = new WeakSet();
      this.scannedRemoved = new WeakSet();
    }
    this.scheduleSlice(true);
  }

  createWalk(node, parent, added, depth = 0) {
    const seen = added ? this.scannedAdded : this.scannedRemoved;
    if (seen.has(node)) {
      return null;
    }
    const walker = (node.ownerDocument || document).createTreeWalker(
      node,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (candidate) =>
          seen.has(candidate) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      }
    );
    return { walker, next: node, parent, added, depth, seen };
  }

  stepWalk(job) {
    if (job.mutation) {
      const mutation = job.mutation;
      const added = job.addedIndex < mutation.addedNodes.length;
      const node = added
        ? mutation.addedNodes[job.addedIndex++]
        : mutation.removedNodes[job.removedIndex++];
      if (!node) {
        return false;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        this.checkForVideoAndShadowRoot(node, node.parentNode || mutation.target, added);
      }
      return true;
    }
    const node = job.next;
    if (!node) {
      return false;
    }
    if (job.seen.has(node)) {
      // Another queued subtree may have covered this node while this walker
      // yielded. Continue to its siblings; dropping the walker loses media.
      job.next = job.walker.nextNode();
      return Boolean(job.next);
    }
    job.seen.add(node);
    // Advance before callbacks can move/remove the current node.
    job.next = job.walker.nextNode();
    if (!job.added && node.isConnected && node.ownerDocument === document) {
      return Boolean(job.next);
    }
    if (node.shadowRoot && job.depth < 10 && node.tagName !== 'VSC-CONTROLLER') {
      if (job.added) {
        this.observeShadowRoot(node.shadowRoot);
      }
      const shadowJob = this.createWalk(node.shadowRoot, node, job.added, job.depth + 1);
      if (shadowJob) {
        this.pendingWalks.unshift(shadowJob);
      }
    }
    if (
      node.nodeName === 'VIDEO' ||
      (node.nodeName === 'AUDIO' && this.config.settings.audioBoolean)
    ) {
      if (job.added) {
        this.onVideoFound(node, node.parentNode || job.parent);
      } else {
        this.onVideoRemoved(node);
      }
    }
    return Boolean(job.next);
  }

  reconcileController(info) {
    const controller = info.controller;
    const video = controller?.video || info.element;
    if (video?.ownerDocument !== document) {
      return;
    }
    if (video.isConnected) {
      controller?.repairDOMPlacement?.();
    } else {
      this.onVideoRemoved(video);
    }
  }

  reconcileControllers() {
    for (const info of window.VSC.stateManager?.controllers?.values() || []) {
      try {
        this.reconcileController(info);
      } catch (error) {
        window.VSC.logger.warn(`Controller recovery failed: ${error.message}`);
      }
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
    let sawChildren = false;
    for (const mutation of mutations) {
      // A document replacement (handled below) tears this observer down
      // mid-batch; bail out so we don't keep operating on stale state.
      if (!this.active) {
        return;
      }
      switch (mutation.type) {
        case 'childList':
          sawChildren = true;
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

    if (sawChildren && this.active) {
      if (this.deferSubtreeTraversal) {
        this.needsControllerReconciliation = true;
      } else {
        this.reconcileControllers();
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
    if (this.deferSubtreeTraversal) {
      // Document replacement takes precedence over traversing any stale subtrees.
      if (Array.prototype.includes.call(mutation.addedNodes, document.documentElement)) {
        this.onDocumentReplaced();
      } else {
        this.pendingWalks.push({ mutation, addedIndex: 0, removedIndex: 0 });
      }
      return;
    }
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
          .filter((video) => video === element || this.isShadowIncludingAncestor(element, video))
      : [];

    if (videos.length === 0) {
      return;
    }

    videos.forEach((video) => {
      this.recheckVideoElement(video);
    });
  }

  /**
   * Check ancestry across open shadow-root host boundaries.
   * @param {Element} ancestor - Candidate ancestor/host
   * @param {Element} node - Candidate descendant
   * @returns {boolean}
   * @private
   */
  isShadowIncludingAncestor(ancestor, node) {
    let current = node;
    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = current.parentNode || current.getRootNode?.().host || null;
    }
    return false;
  }

  /**
   * Re-check if a video element should have a controller attached
   * @param {HTMLMediaElement} video - Video element to recheck
   * @private
   */
  recheckVideoElement(video) {
    if (this.visibilityChecked?.has(video)) {
      return;
    }
    this.visibilityChecked?.add(video);
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
        video.vsc.repairDOMPlacement?.();
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
    if (!added && node.isConnected && node.ownerDocument === document) {
      return;
    }
    const job = this.createWalk(node, parent, added);
    if (!job) {
      return;
    }
    if (this.deferSubtreeTraversal) {
      this.pendingWalks.push(job);
    } else {
      // Direct callers retain synchronous semantics without retaining their nodes.
      const previous = this.pendingWalks;
      this.pendingWalks = [job];
      try {
        while (this.active && this.pendingWalks.length) {
          const current = this.pendingWalks[this.pendingWalks.length - 1];
          if (!this.stepWalk(current)) {
            this.pendingWalks.pop();
          }
        }
      } finally {
        this.pendingWalks = previous;
        this.scannedAdded = new WeakSet();
        this.scannedRemoved = new WeakSet();
      }
    }
  }

  processNodeChildren(node, parent, added) {
    this.checkForVideoAndShadowRoot(node, parent, added);
  }

  /**
   * Observe every existing open shadow root below a document/root. Called only
   * when the comprehensive scan's media-indicator gate has already passed.
   * @param {Document|ShadowRoot|Element} root - Root to inspect
   * @param {number} depth - Current shadow nesting depth
   */
  observeOpenShadowRoots(root, depth = 0) {
    if (!root || depth > 10) {
      return;
    }
    for (const element of root.querySelectorAll?.('*') || []) {
      if (element.shadowRoot) {
        this.observeShadowRoot(element.shadowRoot);
        this.observeOpenShadowRoots(element.shadowRoot, depth + 1);
      }
    }
  }

  /**
   * Set up observer for shadow root
   * @param {ShadowRoot} shadowRoot - Shadow root to observe
   * @private
   */
  observeShadowRoot(shadowRoot) {
    if (shadowRoot.host?.tagName === 'VSC-CONTROLLER' || this.shadowObservers.has(shadowRoot)) {
      return; // Already observing
    }

    const shadowObserver = new MutationObserver((mutations) => {
      this.scheduleMutationProcessing(mutations);
    });

    shadowObserver.observe(shadowRoot, this.buildObserverOptions());
    this.listenForReadyMedia(shadowRoot);
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
        this.unlistenForReadyMedia(shadowRoot);
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
    if (this.observedDocument) {
      this.unlistenForReadyMedia(this.observedDocument);
      this.observedDocument = null;
    }

    if (
      this.attachShadowPrototype &&
      this.attachShadowWrapper &&
      this.attachShadowPrototype.attachShadow === this.attachShadowWrapper
    ) {
      this.attachShadowPrototype.attachShadow = this.originalAttachShadow;
    }
    this.attachShadowPrototype = null;
    this.originalAttachShadow = null;
    this.attachShadowWrapper = null;

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
    this.shadowObservers.forEach((shadowObserver, shadowRoot) => {
      shadowObserver.disconnect();
      this.unlistenForReadyMedia(shadowRoot);
    });
    this.shadowObservers.clear();
    this.pendingMutations = [];
    this.pendingMutationIndex = 0;
    this.pendingWalks = [];
    this.pendingRepairs = null;
    this.needsControllerReconciliation = false;
    this.pendingAttributeTargets.clear();
    this.scannedAdded = new WeakSet();
    this.scannedRemoved = new WeakSet();
    this.mutationCallbackScheduled = false;

    window.VSC.logger.debug('Video mutation observer stopped');
  }
}

VideoMutationObserver.MEDIA_READY_EVENTS = ['loadeddata', 'canplay', 'play'];

// Create singleton instance
window.VSC.VideoMutationObserver = VideoMutationObserver;

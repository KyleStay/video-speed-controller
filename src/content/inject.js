/**
 * Video Speed Controller — Main Content Script
 */

class VideoSpeedExtension {
  constructor() {
    this.config = null;
    this.actionHandler = null;
    this.eventManager = null;
    this.mutationObserver = null;
    this.mediaObserver = null;
    this.initialized = false;
    this.eventListenersInitialized = false;
    this.teardownRequested = false;
    this.pendingVideoAttachments = new WeakMap();
    this.pendingVideoElements = new Set();
    this.cssLiveUpdateHandler = null;
    this.spaNavigationHandler = null;
    this.spaNavigationDocument = null;
    this.scheduledWork = new Set();
    this.documentReplacementInProgress = false;
  }

  /**
   * Initialize the extension
   */
  async initialize() {
    try {
      this.teardownRequested = false;

      // Access global modules
      this.VideoController = window.VSC.VideoController;
      this.ActionHandler = window.VSC.ActionHandler;
      this.EventManager = window.VSC.EventManager;
      this.logger = window.VSC.logger;
      this.initializeWhenReady = window.VSC.DomUtils.initializeWhenReady;
      this.siteHandlerManager = window.VSC.siteHandlerManager;
      this.VideoMutationObserver = window.VSC.VideoMutationObserver;
      this.MediaElementObserver = window.VSC.MediaElementObserver;
      this.MESSAGE_TYPES = window.VSC.Constants.MESSAGE_TYPES;

      this.logger.info('Video Speed Controller starting...');

      this.config = window.VSC.videoSpeedConfig;
      await this.config.load();

      if (this.config.settings._abort) {
        this.logger.debug('Extension disabled on this site — aborting init');
        return;
      }

      this.setupEventPipeline(document);

      // Defer DOM work so page frameworks finish init before we mutate.
      this.deferDOMWork(document);
    } catch (error) {
      this.logger.error(`Failed to initialize Video Speed Controller: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
    }
  }

  /**
   * Initialize for a specific document
   * @param {Document} document - Document to initialize
   */
  initializeDocument(document) {
    try {
      if (this.teardownRequested) {
        return;
      }

      if (window.VSC.initialized) {
        return;
      }

      window.VSC.initialized = true;

      if (!this.eventListenersInitialized) {
        this.eventManager.setupEventListeners(document);
        this.eventListenersInitialized = true;
      }

      this.deferExpensiveOperations(document);
      this.logger.debug('Document initialization completed');
    } catch (error) {
      this.logger.error(`Failed to initialize document: ${error.message}`);
    }
  }

  /**
   * Defer expensive operations to avoid blocking page load
   * @param {Document} document - Document to defer operations for
   */
  deferExpensiveOperations(document) {
    const callback = () => {
      try {
        // Start mutation observer — catches dynamically added media elements
        if (this.mutationObserver) {
          this.mutationObserver.start(document);
          this.logger.debug('Mutation observer started for document');
        }

        // Defer media scanning to avoid blocking page load
        this.deferredMediaScan(document);
      } catch (error) {
        this.logger.error(`Failed to complete deferred operations: ${error.message}`);
      }
    };

    this.scheduleDeferredWork(callback, { idle: true, delay: 100 });
  }

  /**
   * Perform media scanning in a non-blocking way
   * @param {Document} document - Document to scan
   */
  deferredMediaScan(document) {
    // Split media scanning into smaller chunks to avoid blocking
    const performChunkedScan = () => {
      try {
        // Use a lighter initial scan - avoid expensive shadow DOM traversal initially
        const lightMedia = this.mediaObserver.scanForMediaLight(document);

        lightMedia.forEach((media) => {
          this.onVideoFound(media, media.parentElement || media.parentNode);
        });

        this.logger.info(
          `Attached controllers to ${lightMedia.length} media elements (light scan)`
        );

        // Schedule a bounded comprehensive scan for shadow DOM, site-specific
        // containers, and same-document late media. This is delayed so the
        // lightweight path still wins first paint and avoids wasteful polling.
        this.scheduleComprehensiveScan(document);
      } catch (error) {
        this.logger.error(`Failed to scan media elements: ${error.message}`);
      }
    };

    this.scheduleDeferredWork(performChunkedScan, { idle: true, delay: 200 });
  }

  /**
   * Synchronous, one-off rescan triggered by a keypress when no controlled
   * media exists yet (EventManager.requestMediaRescan). Lets a late-loaded
   * video be attached and acted on by the SAME keypress: a ready video
   * (readyState >= 2) attaches+registers synchronously here; a still-loading
   * one is primed via the existing deferred path (onVideoFound) and acted on a
   * beat later. Mirrors the gating of the deferred/comprehensive scans so
   * media-less frames stay cheap, and relies on onVideoFound being idempotent
   * (skips media that already has a controller).
   * @returns {boolean} True if controlled media exists after the rescan.
   */
  rescanForMediaSync() {
    try {
      if (this.teardownRequested || !this.mediaObserver) {
        return false;
      }

      const lightMedia = this.mediaObserver.scanForMediaLight(document);
      lightMedia.forEach((media) => {
        this.onVideoFound(media, media.parentElement || media.parentNode);
      });

      // Escalate to the heavier multi-walk scan only if the light scan attached
      // nothing and the frame actually has a media signal (covers shadow-DOM-only
      // players). Mirrors scheduleComprehensiveScan's hasMediaIndicators gate so
      // media-less frames stay cheap.
      const stateManager = window.VSC.stateManager;
      if (
        (!stateManager || stateManager.getControlledElements().length === 0) &&
        this.mediaObserver.hasMediaIndicators(document)
      ) {
        const comprehensiveMedia = this.mediaObserver.scanAll(document);
        comprehensiveMedia.forEach((media) => {
          if (!media.vsc) {
            this.onVideoFound(media, media.parentElement || media.parentNode);
          }
        });
      }

      return Boolean(stateManager && stateManager.getControlledElements().length > 0);
    } catch (error) {
      this.logger.error(`Keypress-triggered media rescan failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Schedule a comprehensive scan if the light scan didn't find anything
   * @param {Document} document - Document to scan comprehensively
   */
  scheduleComprehensiveScan(document) {
    this.scheduleDeferredWork(
      () => {
        try {
          if (this.teardownRequested || !this.mediaObserver) {
            return;
          }

          // Skip the heavier multi-walk scan on frames with no media signal at
          // all (common case: text pages, ad/tracking iframes). Never skips when
          // a shadow host exists, so encapsulated players are still found.
          if (!this.mediaObserver.hasMediaIndicators(document)) {
            this.logger.debug('Skipping comprehensive scan — no media indicators in frame');
            return;
          }

          const comprehensiveMedia = this.mediaObserver.scanAll(document);

          comprehensiveMedia.forEach((media) => {
            // Skip if already has controller
            if (!media.vsc) {
              this.onVideoFound(media, media.parentElement || media.parentNode);
            }
          });

          this.logger.info(
            `Comprehensive scan found ${comprehensiveMedia.length} additional media elements`
          );
        } catch (error) {
          this.logger.error(`Failed comprehensive media scan: ${error.message}`);
        }
      },
      { delay: 1000 }
    ); // Wait 1 second before comprehensive scan
  }

  /**
   * Defer DOM work via requestIdleCallback to yield to site frameworks
   * before injecting CSS, controllers, and observers.
   */
  deferDOMWork(document) {
    const doWork = () => {
      if (this.teardownRequested) {
        return;
      }

      this.injectControllerCSS();
      this.setupCSSLiveUpdates();
      this.siteHandlerManager.initialize(document);

      this.setupEventPipeline(document);

      this.setupObservers();

      this.setupSpaNavigationRecovery();

      this.initializeWhenReady(document, (doc) => {
        this.initializeDocument(doc);
      });

      this.logger.info('Video Speed Controller initialized successfully');
      this.initialized = true;
    };

    this.scheduleDeferredWork(doWork, { idle: true, delay: 0 });
  }

  /**
   * Schedule idle/timer work and make it cancellable during teardown.
   * @param {Function} callback - Work to run
   * @param {Object} options - Scheduling options
   * @param {boolean} options.idle - Prefer requestIdleCallback when available
   * @param {number} options.delay - Fallback timer delay
   * @returns {Object} Scheduled work handle
   */
  scheduleDeferredWork(callback, { idle = false, delay = 0 } = {}) {
    const useIdle = idle && typeof window.requestIdleCallback === 'function';
    const work = { id: null, type: useIdle ? 'idle' : 'timer' };

    const run = () => {
      this.scheduledWork.delete(work);
      if (this.teardownRequested) {
        return;
      }
      callback();
    };

    this.scheduledWork.add(work);
    work.id = useIdle ? window.requestIdleCallback(run) : setTimeout(run, delay);
    return work;
  }

  /**
   * Cancel deferred startup/scan callbacks.
   */
  clearScheduledWork() {
    for (const work of this.scheduledWork) {
      if (work.type === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(work.id);
      } else {
        clearTimeout(work.id);
      }
    }
    this.scheduledWork.clear();
  }

  /**
   * Set up shortcut/rate event handlers as soon as settings are available.
   * DOM mutations and media scanning stay deferred, but capture listeners need
   * early registration so page-level shortcut handlers cannot claim VSC keys
   * first on sites such as YouTube.
   * @param {Document} document - Document to attach events to
   */
  setupEventPipeline(document) {
    if (!this.eventManager) {
      this.eventManager = new this.EventManager(this.config, null);
      this.actionHandler = new this.ActionHandler(this.config, this.eventManager);
      this.eventManager.actionHandler = this.actionHandler;
      // Reactive safety net: a VSC-bound keypress with no controlled media asks
      // for a synchronous rescan so a late-loaded video is acted on by the same
      // keypress. Local wiring (mirrors actionHandler) keeps EventManager
      // decoupled from the extension/mediaObserver.
      this.eventManager.requestMediaRescan = () => this.rescanForMediaSync();
    }

    if (!this.eventListenersInitialized) {
      this.eventManager.setupEventListeners(document);
      this.eventListenersInitialized = true;
    }
  }

  /**
   * Resolve domain-based CSS selectors for the current hostname.
   * Matching domains: selector stripped (rule applies unconditionally).
   * Non-matching: entire rule removed. Stripping (vs neutering with a dead
   * selector) ensures perf-sensitive selectors like [style*=...] inside
   * non-matching rules never reach the browser's style invalidation engine.
   */
  preprocessDomainCSS(css) {
    const hostname = location.hostname.replace(/^www\./, '');
    return css.replace(
      /:root\[style\*='--vsc-domain:\s*"([^"]+)"'\]([^{]*)\{([^}]*)\}/g,
      (match, domain, selector, body) => (domain === hostname ? `${selector.trim()} {${body}}` : '')
    );
  }

  /**
   * Inject controller CSS via adoptedStyleSheets — pure CSSOM, zero DOM
   * mutations. <style> elements trigger page-level MutationObservers on
   * sites with complex frameworks, breaking their internal state.
   *
   * Two separate sheets: _controllerSheet (built-in defaults, domain-
   * preprocessed, never changes at runtime) and _customSheet (user
   * additions, injected raw, live-updatable). Keeps them separate so
   * user CSS edits don't re-preprocess the defaults.
   */
  injectControllerCSS() {
    try {
      if (this._controllerSheet) {
        return;
      }
      this._controllerSheet = new CSSStyleSheet();
      this._controllerSheet.replaceSync(
        this.preprocessDomainCSS(window.VSC.Constants.DEFAULT_CONTROLLER_CSS)
      );
      const toAdopt = [this._controllerSheet];

      const customCSS = this.config.settings.customCSS || '';
      if (customCSS) {
        this._customSheet = new CSSStyleSheet();
        this._customSheet.replaceSync(customCSS);
        toAdopt.push(this._customSheet);
      }

      document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...toAdopt];
    } catch (error) {
      this.logger.error(`Failed to inject controller CSS: ${error.message}`);
    }
  }

  /** Live-update the user's custom CSS when options are saved. */
  setupCSSLiveUpdates() {
    if (this.cssLiveUpdateHandler) {
      return;
    }

    this.cssLiveUpdateHandler = (e) => {
      if (e.detail?.customCSS?.newValue === undefined || !this._controllerSheet) {
        return;
      }
      const customCSS = e.detail.customCSS.newValue || '';
      if (customCSS) {
        if (!this._customSheet) {
          this._customSheet = new CSSStyleSheet();
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._customSheet];
        }
        this._customSheet.replaceSync(customCSS);
      } else if (this._customSheet) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (s) => s !== this._customSheet
        );
        this._customSheet = null;
      }
    };

    document.documentElement.addEventListener('VSC_STORAGE_CHANGED', this.cssLiveUpdateHandler);
  }

  /**
   * Set up observers for DOM changes and video detection
   */
  setupObservers() {
    // Media element observer
    this.mediaObserver = new this.MediaElementObserver(this.config, this.siteHandlerManager);

    // Mutation observer for dynamic content
    this.mutationObserver = new this.VideoMutationObserver(
      this.config,
      (video, parent) => this.onVideoFound(video, parent),
      (video) => this.onVideoRemoved(video),
      this.mediaObserver,
      () => this.handleDocumentReplaced()
    );
  }

  /**
   * Recover controllers after an in-app (SPA) navigation that swaps media
   * without replacing the document — YouTube's most common case. When the
   * `<video>` is swapped out, our controller is dropped; once that happens
   * EventManager.handleKeydown takes its no-media fast path and stops claiming
   * shortcut keys, so the site (e.g. YouTube) reclaims keys like `s`. Re-scanning
   * on navigation re-attaches the controller and restores shortcut claiming.
   *
   * No polling: we react to navigation events and defer the scan to idle so the
   * media-less common case stays cheap. onVideoFound is idempotent (skips media
   * that already has a controller), so a redundant scan is harmless.
   */
  setupSpaNavigationRecovery() {
    if (this.spaNavigationHandler) {
      return;
    }

    this.spaNavigationHandler = () => {
      if (this.teardownRequested || !this.mediaObserver) {
        return;
      }
      // Respect the media-less-frame perf priority (P2): only rescan when the
      // frame actually has a media signal. hasMediaIndicators never skips when a
      // shadow host exists, so encapsulated players still trigger recovery, and
      // when media is absent there is nothing to recover anyway.
      if (!this.mediaObserver.hasMediaIndicators(document)) {
        return;
      }
      this.logger.debug('SPA navigation detected — rescanning for media');
      // Defer: let the framework swap in the new player before we scan.
      this.scheduleDeferredWork(() => this.deferredMediaScan(document), {
        idle: true,
        delay: 200,
      });
    };

    // Capture the document we register on so teardown removes the listener from
    // the same object even if `document` is later replaced (handleDocumentReplaced).
    // yt-navigate-finish bubbles, so listening at the document catches it.
    this.spaNavigationDocument = document;
    // YouTube's Polymer app fires this after in-app navigation.
    this.spaNavigationDocument.addEventListener('yt-navigate-finish', this.spaNavigationHandler);
    // Generic SPA fallback (history navigation) for other sites.
    window.addEventListener('popstate', this.spaNavigationHandler);
  }

  /**
   * Recover from a full document replacement (e.g. document.write). Everything
   * VSC attached lived on the now-detached document, so tear down and
   * reinitialize against the new one. Guarded so overlapping replacements
   * during page load don't stack reinitializations.
   */
  handleDocumentReplaced() {
    if (this.documentReplacementInProgress) {
      return;
    }
    this.documentReplacementInProgress = true;
    this.logger.info('Reinitializing after document replacement');
    try {
      this.teardown();
    } catch (error) {
      this.logger.error(`Teardown during document-replacement recovery failed: ${error.message}`);
    }
    this.initialize()
      .catch((error) => {
        this.logger.error(`Reinitialization after document replacement failed: ${error.message}`);
      })
      .finally(() => {
        this.documentReplacementInProgress = false;
      });
  }

  /**
   * Handle newly found video element
   * @param {HTMLMediaElement} video - Video element
   * @param {HTMLElement} parent - Parent element
   */
  onVideoFound(video, parent, options = {}) {
    try {
      // A media element exists on the page (even if not yet valid/attachable) —
      // start watching style/class mutations so a later visibility/validity
      // change on it is observed. No-op after the first call. Done before the
      // validity gate so hidden/deferred/temporarily-invalid media still arms
      // observation. (Truly media-less frames never reach onVideoFound, so
      // P3's "don't watch until media exists" win is preserved.)
      if (this.mutationObserver) {
        this.mutationObserver.enableAttributeObservation();
      }

      if (this.mediaObserver && !this.mediaObserver.isValidMediaElement(video)) {
        this.logger.debug('Video element is not valid for controller attachment');
        this.clearPendingVideoAttachment(video);
        return;
      }

      if (video.vsc) {
        this.logger.debug('Video already has controller attached');
        this.clearPendingVideoAttachment(video);
        return;
      }

      // Defer until readyState >= HAVE_CURRENT_DATA — inserting a controller
      // too early can trigger the site's internal MutationObservers.
      if (video.readyState < 2 && !options.forceAttach) {
        this.logger.debug(
          'Deferring controller until loadeddata (readyState=%d)',
          video.readyState
        );
        this.deferVideoAttachment(video, parent);
        return;
      }

      this.clearPendingVideoAttachment(video);

      // Check if controller should start hidden based on video visibility/size
      const shouldStartHidden = this.mediaObserver
        ? this.mediaObserver.shouldStartHidden(video)
        : false;

      this.logger.debug(
        'Attaching controller to new video element',
        shouldStartHidden ? '(starting hidden)' : ''
      );
      video.vsc = new this.VideoController(
        video,
        parent,
        this.config,
        this.actionHandler,
        shouldStartHidden
      );
    } catch (error) {
      this.logger.error(`Failed to attach controller to video: ${error.message}`);
    }
  }

  /**
   * Defer controller attachment for media that exists before the player has
   * enough data. The WeakMap prevents duplicate listeners during mutation bursts.
   * @param {HTMLMediaElement} video - Media element
   * @param {HTMLElement} parent - Parent element
   */
  deferVideoAttachment(video, parent) {
    if (this.pendingVideoAttachments.has(video)) {
      return;
    }

    const attach = () => {
      this.clearPendingVideoAttachment(video);
      if (this.teardownRequested || video.vsc || !video.isConnected) {
        return;
      }
      this.onVideoFound(video, parent, { forceAttach: true });
    };

    const events = ['loadeddata', 'canplay', 'play'];
    events.forEach((eventName) => {
      video.addEventListener(eventName, attach, { once: true });
    });

    const fallbackTimer = setTimeout(() => {
      if (this.teardownRequested) {
        return;
      }
      // If the element left the DOM while we waited, release its listeners and
      // drop it from the pending set so a detached node isn't retained.
      if (!video.isConnected) {
        this.clearPendingVideoAttachment(video);
        return;
      }
      // Metadata-only and custom-player media can stay at readyState 1 for a
      // long time. Attach after a bounded wait once a source exists.
      if (video.readyState >= 1 || video.currentSrc || video.src) {
        attach();
      }
      // Still connected but no source yet — leave the once-listeners in place;
      // they fire (and self-clean) if/when the element finally loads.
    }, 1500);

    this.pendingVideoAttachments.set(video, { attach, events, fallbackTimer });
    this.pendingVideoElements.add(video);
  }

  /**
   * Remove deferred attachment listeners/timer for a media element.
   * @param {HTMLMediaElement} video - Media element
   */
  clearPendingVideoAttachment(video) {
    const pending = this.pendingVideoAttachments.get(video);
    if (!pending) {
      return;
    }

    pending.events.forEach((eventName) => {
      video.removeEventListener(eventName, pending.attach);
    });
    clearTimeout(pending.fallbackTimer);
    this.pendingVideoAttachments.delete(video);
    this.pendingVideoElements.delete(video);
  }

  /**
   * Tear down the extension: remove all controllers, stop observers, clean up listeners.
   * Counterpart to initialize() — leaves the page as if VSC was never active.
   */
  teardown() {
    if (!this.initialized && !this.eventListenersInitialized && !this.eventManager) {
      return;
    }

    this.teardownRequested = true;
    this.logger.info('Tearing down Video Speed Controller');

    this.clearScheduledWork();

    for (const video of this.pendingVideoElements) {
      this.clearPendingVideoAttachment(video);
    }

    // Remove all controllers from tracked media elements
    const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];
    for (const video of videos) {
      if (video.vsc) {
        video.vsc.remove();
      }
    }

    // Stop observing DOM for new videos
    if (this.mutationObserver) {
      this.mutationObserver.stop();
      this.mutationObserver = null;
    }

    // Remove SPA navigation recovery listeners — from the same document we
    // registered on, not the live global (which may have been replaced).
    if (this.spaNavigationHandler) {
      const navDoc = this.spaNavigationDocument || document;
      navDoc.removeEventListener('yt-navigate-finish', this.spaNavigationHandler);
      window.removeEventListener('popstate', this.spaNavigationHandler);
      this.spaNavigationHandler = null;
      this.spaNavigationDocument = null;
    }

    // Remove keyboard/ratechange listeners
    if (this.eventManager) {
      this.eventManager.cleanup();
      this.eventManager = null;
    }
    this.eventListenersInitialized = false;

    // Clean up site-specific handlers
    if (this.siteHandlerManager) {
      this.siteHandlerManager.cleanup();
    }

    if (this.cssLiveUpdateHandler) {
      document.documentElement.removeEventListener(
        'VSC_STORAGE_CHANGED',
        this.cssLiveUpdateHandler
      );
      this.cssLiveUpdateHandler = null;
    }

    // Remove adopted controller CSS (both default and custom sheets)
    if (document.adoptedStyleSheets) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (s) => s !== this._controllerSheet && s !== this._customSheet
      );
    }
    this._controllerSheet = null;
    this._customSheet = null;

    this.actionHandler = null;
    this.mediaObserver = null;
    this.initialized = false;
    window.VSC.initialized = false;
  }

  /**
   * Handle removed video element
   * @param {HTMLMediaElement} video - Video element
   */
  onVideoRemoved(video) {
    try {
      this.clearPendingVideoAttachment(video);
      if (video.vsc) {
        this.logger.debug('Removing controller from video element');
        video.vsc.remove();
      }
    } catch (error) {
      this.logger.error(`Failed to remove video controller: ${error.message}`);
    }
  }

  /**
   * Summarize controlled media state for popup responses.
   * @param {Array<HTMLMediaElement>} videos - Controlled media elements
   * @returns {Object} Status payload
   */
  getMediaStatus(videos) {
    const rates = videos
      .map((video) => (typeof video.playbackRate === 'number' ? video.playbackRate : null))
      .filter((rate) => rate !== null);
    const speeds = [...new Set(rates.map((rate) => Number(rate.toFixed(2))))];

    return {
      mediaCount: videos.length,
      currentSpeed: speeds.length === 1 ? speeds[0] : null,
      speeds,
    };
  }
}

(function () {
  const extension = new VideoSpeedExtension();

  // Lifecycle commands from bridge (popup, background, storage changes)
  document.documentElement.addEventListener('VSC_MESSAGE', (event) => {
    const message = event.detail;

    // Handle namespaced VSC message types
    if (typeof message === 'object' && message.type && message.type.startsWith('VSC_')) {
      // Use state manager for complete media element discovery (includes shadow DOM)
      const videos = window.VSC.stateManager ? window.VSC.stateManager.getAllMediaElements() : [];
      let handled = true;

      switch (message.type) {
        case window.VSC.Constants.MESSAGE_TYPES.SET_SPEED:
          if (message.payload && typeof message.payload.speed === 'number') {
            const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
            const targetSpeed = Math.min(Math.max(message.payload.speed, MIN), MAX);
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, targetSpeed);
              } else {
                video.playbackRate = targetSpeed;
              }
            });

            // Log the successful operation
            window.VSC.logger?.debug(
              `Set speed to ${targetSpeed} on ${videos.length} media elements`
            );
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.ADJUST_SPEED:
          if (message.payload && typeof message.payload.delta === 'number') {
            const delta = message.payload.delta;
            videos.forEach((video) => {
              if (video.vsc) {
                extension.actionHandler.adjustSpeed(video, delta, { relative: true });
              } else {
                // Fallback for videos without controller
                const { MIN: sMin, MAX: sMax } = window.VSC.Constants.SPEED_LIMITS;
                const newSpeed = Math.min(Math.max(video.playbackRate + delta, sMin), sMax);
                video.playbackRate = newSpeed;
              }
            });

            window.VSC.logger?.debug(
              `Adjusted speed by ${delta} on ${videos.length} media elements`
            );
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.RESET_SPEED:
          videos.forEach((video) => {
            if (video.vsc) {
              extension.actionHandler.resetSpeed(video, 1.0);
            } else {
              video.playbackRate = 1.0;
            }
          });

          window.VSC.logger?.debug(`Reset speed on ${videos.length} media elements`);
          break;

        case window.VSC.Constants.MESSAGE_TYPES.TOGGLE_DISPLAY:
          if (extension.actionHandler) {
            extension.actionHandler.runAction('display', null, null);
          }
          break;

        case window.VSC.Constants.MESSAGE_TYPES.GET_STATUS: {
          message._status = extension.getMediaStatus(videos);
          break;
        }

        case window.VSC.Constants.MESSAGE_TYPES.TEARDOWN:
          extension.teardown();
          break;

        case window.VSC.Constants.MESSAGE_TYPES.REINIT:
          extension.initialize();
          break;

        default:
          handled = false;
      }

      if (message.requestId) {
        const status = message._status || extension.getMediaStatus(videos);
        document.documentElement.dispatchEvent(
          new CustomEvent('VSC_MESSAGE_RESULT', {
            detail: {
              requestId: message.requestId,
              ok: handled,
              mediaCount: status.mediaCount,
              currentSpeed: status.currentSpeed,
              speeds: status.speeds,
            },
          })
        );
      }
    }
  });

  // Prevent double injection
  if (window.VSC_controller && window.VSC_controller.initialized) {
    window.VSC.logger?.info('VSC already initialized, skipping re-injection');
    return;
  }

  // Auto-initialize
  extension.initialize().catch((error) => {
    window.VSC.logger.error(`Extension initialization failed: ${error.message}`);
  });

  // Export only what's needed with consistent VSC_ prefix
  window.VSC_controller = extension; // The initialized instance
})();

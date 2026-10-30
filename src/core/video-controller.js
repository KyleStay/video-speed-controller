/**
 * Video Controller class for managing individual video elements
 *
 */

window.VSC = window.VSC || {};

class VideoController {
  constructor(
    target,
    parent,
    config,
    actionHandler,
    shouldStartHidden = false,
    initialSpeed = null
  ) {
    // Return existing controller if already attached
    if (target.vsc) {
      return target.vsc;
    }

    this.video = target;
    this.parent = target.parentElement || parent;
    this.config = config;
    this.actionHandler = actionHandler;
    this.controlsManager = new window.VSC.ControlsManager(actionHandler, config);
    this.shouldStartHidden = shouldStartHidden;

    // Generate unique controller ID for badge tracking
    this.controllerId = this.generateControllerId(target);

    // Transient reset memory (not persisted, instance-specific)
    this.speedBeforeReset = null;
    this.positionBeforeJump = null;
    this.initMetadataHandler = null;

    // Live frame-rate detection state (used by the frame-step shortcuts).
    // null = not yet measured; frame-step falls back to the binding's fps value.
    this.detectedFps = null;
    this.vfcHandle = null;
    this.fpsSamples = [];
    this.lastVfcMeta = null;
    this.handleFpsReset = null;
    this.vfcCallbackCount = 0;
    // Set once in remove(): a rVFC callback already in flight must not touch the
    // detached video or re-arm itself after teardown.
    this.disposed = false;

    try {
      window.VSC.recordVideoDiagnostic?.('before-controller', target);
      // Attach controller to video element first (needed for adjustSpeed)
      target.vsc = this;

      // Register with state manager immediately after controller is attached
      if (window.VSC.stateManager) {
        window.VSC.stateManager.registerController(this);
      } else {
        window.VSC.logger.error('StateManager not available during VideoController initialization');
      }

      // Initialize speed
      this.initializeSpeed(initialSpeed);

      // Create UI
      this.div = this.initializeControls();
      window.VSC.recordVideoDiagnostic?.('after-controller', target);

      // Set up event handlers
      this.setupEventHandlers();

      // Set up mutation observer for src changes
      this.setupMutationObserver();

      // Start measuring the real frame rate (video-only, zero steady-state cost).
      this.setupFpsDetection();

      if (target.localName === 'video' && window.VSC.IOSSiteControls) {
        this.siteControls = new window.VSC.IOSSiteControls(target);
        this.updateSiteControlsMode();
      }

      // Assign before attach so constructor rollback can restore native state.
      if (window.VSC.IOSPlayer?.isSupported(target)) {
        window.VSC.recordVideoDiagnostic?.('before-inline-policy', target);
        this.iosPlayer = new window.VSC.IOSPlayer(this);
        this.iosPlayer.attach();
        window.VSC.recordVideoDiagnostic?.('after-inline-policy', target);
      }
      this.refreshSiteControls();
    } catch (error) {
      // Construction must be transactional. A page-owned DOM/media API can
      // throw in the MAIN world; never leave a stale expando or registered,
      // half-initialized controller that blocks all future scans.
      this.remove();
      throw error;
    }

    window.VSC.logger.info('VideoController initialized for video element');
  }

  /**
   * Begin detecting the media's real frame rate for the frame-step shortcuts.
   *
   * Uses requestVideoFrameCallback, which exists on <video> only. If the API is
   * unavailable (older browsers, <audio>), we stay silent and frame-step uses
   * the binding's fallback fps. A short burst samples a few frames while the
   * video plays, snaps the estimate to the nearest common rate, then stops —
   * so there is no per-frame cost once fps is known.
   * @private
   */
  setupFpsDetection() {
    // Reliability priority #1: fps detection is a best-effort enhancement and
    // must never break controller attachment. The page runs in the MAIN world
    // and could have replaced/wrapped the media API, so guard the whole setup.
    try {
      if (typeof this.video.requestVideoFrameCallback !== 'function') {
        return;
      }

      this.startFpsBurst();

      // Re-arm on source change — a new media source can have a different fps.
      this.handleFpsReset = () => {
        this.detectedFps = null;
        this.startFpsBurst();
      };
      this.video.addEventListener('emptied', this.handleFpsReset);
      this.video.addEventListener('loadstart', this.handleFpsReset);
    } catch (e) {
      window.VSC.logger.warn(`fps detection setup failed: ${e?.message}`);
    }
  }

  /**
   * (Re)start the rVFC sampling burst. Idempotent — cancels any in-flight
   * callback first so re-arming never leaves two bursts running.
   * @private
   */
  startFpsBurst() {
    try {
      this.stopFpsBurst();
      this.fpsSamples = [];
      this.lastVfcMeta = null;
      this.vfcCallbackCount = 0;

      if (this.disposed || typeof this.video.requestVideoFrameCallback !== 'function') {
        return;
      }

      const sampler = (_now, metadata) => {
        this.vfcHandle = null;

        // Torn down while this callback was in flight (cancel unavailable/failed):
        // do not touch the detached video or re-arm. Hard stop against post-remove
        // leaks — the re-arm listeners are already gone and we must not resurrect.
        if (this.disposed) {
          return;
        }

        this.vfcCallbackCount += 1;
        this.collectFpsSample(metadata);

        // Bound the burst by callback count — NOT by useful-sample count — so
        // variable-frame-rate or looping media, whose frames may never yield a
        // valid sample, can't re-register forever. Once fps is known, or the cap
        // is hit, the burst stops and steady-state per-frame cost returns to zero.
        if (
          this.detectedFps === null &&
          this.vfcCallbackCount < VideoController.FPS_MAX_CALLBACKS &&
          typeof this.video.requestVideoFrameCallback === 'function'
        ) {
          try {
            this.vfcHandle = this.video.requestVideoFrameCallback(sampler);
          } catch (error) {
            this.vfcHandle = null;
            window.VSC.logger.warn(`fps detection re-arm failed: ${error?.message}`);
          }
        }
      };

      this.vfcHandle = this.video.requestVideoFrameCallback(sampler);
    } catch (error) {
      this.vfcHandle = null;
      window.VSC.logger.warn(`fps detection burst failed: ${error?.message}`);
    }
  }

  /**
   * Fold one rVFC metadata reading into the running fps estimate.
   * Estimates fps as ΔpresentedFrames / ΔmediaTime between successive frames,
   * which stays correct across dropped frames and playback-rate changes.
   * @param {VideoFrameCallbackMetadata} metadata
   * @private
   */
  collectFpsSample(metadata) {
    if (
      !metadata ||
      typeof metadata.mediaTime !== 'number' ||
      typeof metadata.presentedFrames !== 'number'
    ) {
      return;
    }

    const prev = this.lastVfcMeta;
    this.lastVfcMeta = {
      mediaTime: metadata.mediaTime,
      presentedFrames: metadata.presentedFrames,
    };

    if (!prev) {
      return; // Need two readings to form a delta.
    }

    const dt = metadata.mediaTime - prev.mediaTime;
    const df = metadata.presentedFrames - prev.presentedFrames;
    // Skip non-progress intervals (paused, seeked backward, repeated frame).
    if (dt <= 0 || df <= 0) {
      return;
    }

    const fps = df / dt;
    if (!Number.isFinite(fps) || fps <= 0 || fps > 1000) {
      return;
    }

    this.fpsSamples.push(fps);
    this.maybeFinalizeFps();
  }

  /**
   * Commit a detected fps once the recent samples agree, then end the burst.
   * @private
   */
  maybeFinalizeFps() {
    const samples = this.fpsSamples;
    if (samples.length < VideoController.FPS_MIN_SAMPLES) {
      return;
    }

    const recent = samples.slice(-VideoController.FPS_MIN_SAMPLES);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const stable = recent.every(
      (s) => Math.abs(s - avg) / avg <= VideoController.FPS_STABILITY_TOLERANCE
    );
    if (!stable) {
      return;
    }

    this.detectedFps = VideoController.snapToCommonFps(avg);
    window.VSC.logger.debug(`Detected frame rate: ${this.detectedFps} fps`);
    this.stopFpsBurst();
  }

  /**
   * Cancel any pending rVFC callback. Safe to call repeatedly.
   * @private
   */
  stopFpsBurst() {
    // The API lookup and call are both inside the try: this runs during
    // remove(), and a hostile/broken page-defined accessor on
    // cancelVideoFrameCallback must never throw out of teardown and abort the
    // rest of remove() (listener removal, observer disconnect, state unregister).
    // The disposed flag is the real leak guard; cancel is best-effort.
    try {
      if (this.vfcHandle !== null && typeof this.video.cancelVideoFrameCallback === 'function') {
        this.video.cancelVideoFrameCallback(this.vfcHandle);
      }
    } catch {
      // Handle already fired/invalid, or a page accessor threw — ignore.
    } finally {
      this.vfcHandle = null;
    }
  }

  /**
   * Initialize video speed based on settings.
   *
   * Uses source:'init' so setSpeed skips the lastSpeed update — during init
   * we don't want to arm fight-back with a stale/default value that could
   * conflict with the player's own initialization sequence.
   * @private
   */
  initializeSpeed(initialSpeed = null) {
    const targetSpeed =
      Number.isFinite(initialSpeed) && initialSpeed > 0 ? initialSpeed : this.getTargetSpeed();

    window.VSC.logger.debug(`Setting initial playbackRate to: ${targetSpeed}`);

    if (
      !this.actionHandler ||
      (this.video.readyState >= 1 &&
        targetSpeed === this.video.playbackRate &&
        !window.VSC.SafariHLSPlayback?.canSwitch?.(this, targetSpeed, 'init') &&
        !window.VSC.TwitterMP4Playback?.canBegin(this, targetSpeed, 'init'))
    ) {
      return;
    }

    // Defer until metadata is loaded — setting playbackRate before the player
    // has initialized can race with the site's own init sequence.
    if (this.video.readyState < 1) {
      window.VSC.logger.debug('Deferring initializeSpeed until loadedmetadata');
      const handler = () => {
        this.video.removeEventListener('loadedmetadata', handler);
        this.initMetadataHandler = null;
        if (this.disposed || this.video.vsc !== this) {
          return;
        }
        // Match lifecycle recovery: retain this media's current accepted rate,
        // but let an external preference revision supersede it.
        const local = this.actionHandler.eventManager?.getMediaRateState?.(this.video);
        const currentTargetSpeed =
          Number.isFinite(local?.lifecycleSpeed) &&
          (local.lifecycleSpeedRevision ?? 0) === (this.config.speedPreferenceRevision ?? 0)
            ? local.lifecycleSpeed
            : this.getTargetSpeed();
        // A pre-metadata rate command can already match numerically while HLS
        // still needs its supplied progressive rendition for fast playback.
        if (
          currentTargetSpeed !== this.video.playbackRate ||
          window.VSC.SafariHLSPlayback?.canSwitch?.(this, currentTargetSpeed, 'init')
        ) {
          this.actionHandler.adjustSpeed(this.video, currentTargetSpeed, { source: 'init' });
        }
      };
      this.initMetadataHandler = handler;
      this.video.addEventListener('loadedmetadata', handler);
    } else {
      this.actionHandler.adjustSpeed(this.video, targetSpeed, { source: 'init' });
    }
  }

  /**
   * Get target speed for video initialization and event restoration.
   *
   * lastSpeed semantics: null = "no user choice this session", any number
   * (including 1.0) = "user deliberately set this." setSpeed() writes a
   * real number on every user action; load() initializes to null when a
   * per-site rule exists or rememberSpeed is off.
   *
   * Fresh load priority:
   *   1. siteDefaultSpeed (per-site rule) — always wins if configured
   *   2. lastSpeed from storage (rememberSpeed=true, no per-site rule)
   *   3. 1.0 fallback
   * Mid-session: user's last setSpeed() call wins until next page load.
   *
   * @returns {number} Target speed
   * @private
   */
  getTargetSpeed() {
    const baseline = this.config.settings.siteDefaultSpeed ?? 1.0;
    const last = this.config.settings.lastSpeed;

    if (last !== null) {
      window.VSC.logger.debug(`Using lastSpeed ${last} (baseline=${baseline})`);
      return last;
    }

    window.VSC.logger.debug(`Using baseline ${baseline} (lastSpeed=${last})`);
    return baseline;
  }

  /**
   * Initialize video controller UI
   * @returns {HTMLElement} Controller wrapper element
   * @private
   */
  initializeControls() {
    window.VSC.logger.debug('initializeControls Begin');

    const document = this.video.ownerDocument;
    const speed = window.VSC.Constants.formatSpeed(this.video.playbackRate);

    window.VSC.logger.debug(`Speed variable set to: ${speed}`);

    // Create custom element wrapper to avoid CSS conflicts
    const wrapper = document.createElement('vsc-controller');

    // Apply all CSS classes at once to prevent race condition flash
    const cssClasses = ['vsc-controller'];

    // Only hide controller if video has no source AND is not ready/functional
    // This prevents hiding controllers for live streams or dynamically loaded videos
    if (!this.video.currentSrc && !this.video.src && this.video.readyState < 2) {
      cssClasses.push('vsc-nosource');
    }

    if (this.config.settings.startHidden || this.shouldStartHidden) {
      cssClasses.push('vsc-hidden');
      window.VSC.logger.debug('Starting controller hidden');
    }
    // When startHidden=false, use natural visibility (no special class needed)

    // Apply all classes at once to prevent visible flash
    wrapper.className = cssClasses.join(' ');

    // IMPORTANT: Wrapper gets z-index ONLY — no position, no top, no left.
    // Position is controlled by inject.css (default: absolute; site overrides: relative).
    // Adding inline position here would defeat CSS site overrides via specificity.
    wrapper.style.cssText = 'z-index: 9999999 !important;';

    // Create shadow DOM with placeholder position (set after insertion)
    const shadow = window.VSC.ShadowDOMManager.createShadowDOM(wrapper, {
      top: '0px',
      left: '0px',
      speed: speed,
      opacity: this.config.settings.controllerOpacity,
      buttonSize: this.config.settings.controllerButtonSize,
      gif: Boolean(window.VSC.GifPlayback?.get(this.video)),
    });

    // Set up control events
    this.controlsManager.setupControlEvents(shadow, this.video);

    // Store speed indicator reference
    this.speedIndicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    // Insert into DOM FIRST — position calculation needs the wrapper in the DOM
    this.insertIntoDOM(document, wrapper);
    this.insertionParent = wrapper.parentNode;
    this.mediaParentAncestor = this.parent?.parentNode;

    this.positionControls(wrapper);

    window.VSC.logger.debug('initializeControls End');
    return wrapper;
  }

  positionControls(wrapper) {
    const shadow = wrapper.shadowRoot;
    // THEN compute position based on actual DOM state.
    // If a CSS override sets the wrapper to position:relative (e.g. YouTube, Netflix),
    // the inner controller stays at (0,0) and the CSS nudge handles placement.
    // Otherwise (wrapper is absolute), compute coordinates for generic sites.
    const computedPosition = getComputedStyle(wrapper).position;
    if (computedPosition !== 'relative' || this.controlsManager.inlineIOS) {
      const position =
        computedPosition === 'relative'
          ? { top: '0px', left: '0px' }
          : window.VSC.ShadowDOMManager.calculatePosition(this.video);
      const innerController = window.VSC.ShadowDOMManager.getController(shadow);
      innerController.style.top = position.top;
      innerController.style.left = position.left;
    }

    // Establish final inline bounds before returning to the site's readiness
    // handlers; ResizeObserver runs too late for their synchronous measurements.
    if (this.controlsManager.inlineIOS) {
      this.controlsManager.positionInlineControls(shadow, this.video);
    }
  }

  /**
   * Insert controller into DOM with site-specific positioning
   * @param {Document} document - Document object
   * @param {HTMLElement} wrapper - Wrapper element to insert
   * @private
   */
  insertIntoDOM(document, wrapper) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(wrapper);

    // Get site-specific positioning information
    const positioning = window.VSC.siteHandlerManager.getControllerPosition(
      this.parent,
      this.video
    );

    const point = positioning.insertionPoint;
    const method = positioning.insertionMethod;

    // 'beforeParent'/'afterParent' need the insertion point's parentElement;
    // 'firstChild' needs the insertion point itself. A site handler can hand us
    // a null or detached node (e.g. parent.parentElement when the media sits
    // directly under <body>), which would throw and silently drop the
    // controller. Validate and fall back to a sane same-document anchor.
    const needsParent = method === 'beforeParent' || method === 'afterParent';
    const canUseRequested = point && (needsParent ? Boolean(point.parentElement) : true);

    if (canUseRequested) {
      switch (method) {
        case 'beforeParent':
          point.parentElement.insertBefore(fragment, point);
          break;
        case 'afterParent':
          point.parentElement.insertBefore(fragment, point.nextSibling);
          break;
        case 'firstChild':
        default:
          point.insertBefore(fragment, point.firstChild);
          break;
      }
      window.VSC.logger.debug(`Controller inserted using ${method} method`);
      return;
    }

    // Fallback: attach as a sibling of the media element so the controller still
    // appears, even when the handler's preferred anchor is unavailable.
    const fallbackParent = this.video.parentElement || this.parent;
    if (fallbackParent) {
      fallbackParent.insertBefore(fragment, fallbackParent.firstChild);
      window.VSC.logger.warn(
        `Controller insertion point unavailable for "${method}"; used media parent fallback`
      );
      return;
    }

    window.VSC.logger.error('Unable to insert controller: no valid insertion point or parent');
  }

  /** Restore a removed/moved overlay without recreating its state or listeners. */
  repairDOMPlacement() {
    if (this.iosPlayer?.active) {
      return false;
    }
    if (this.disposed || !this.div || !this.video.isConnected) {
      return false;
    }
    const parent = this.video.parentElement || this.video.parentNode;
    if (!parent) {
      return false;
    }
    // A moved ancestor can leave the direct media parent unchanged.
    try {
      const siteContainer = this.siteControls?.container;
      if (siteContainer && !siteContainer.contains(this.video)) {
        this.refreshSiteControls();
      }
    } catch {
      // Page-owned DOM access must not prevent ordinary placement recovery.
    }
    if (
      this.div.isConnected &&
      this.parent === parent &&
      this.mediaParentAncestor === parent.parentNode &&
      this.div.parentNode === this.insertionParent
    ) {
      return false;
    }
    try {
      this.parent = parent;
      this.insertIntoDOM(this.video.ownerDocument, this.div);
      this.insertionParent = this.div.parentNode;
      this.mediaParentAncestor = parent.parentNode;
      if (this.controlsManager.inlineIOS) {
        this.positionControls(this.div);
        this.refreshSiteControls();
      }
      return this.div.isConnected;
    } catch (error) {
      window.VSC.logger.warn(`Controller placement recovery failed: ${error.message}`);
      return false;
    }
  }

  /** Resolve the first matching rule in this media's own document. */
  updateSiteControlsMode() {
    let hide = false;
    try {
      const rule = window.VSC.matchSiteRule?.(
        this.config.settings.siteRules,
        this.video.ownerDocument.URL
      );
      hide =
        this.config.settings.enabled !== false &&
        rule?.enabled !== false &&
        rule?.hideSiteControls === true;
    } catch {
      // Invalid or inaccessible site metadata must leave page controls available.
    }
    this.siteControls?.setHideAllButtons(hide);
    return hide;
  }

  refreshSiteControls() {
    if (this.disposed || !this.siteControls) {
      return;
    }
    if (this.iosPlayer) {
      this.iosPlayer.refreshSiteControls();
    } else if (this.updateSiteControlsMode() && this.video.isConnected) {
      this.siteControls.acquire();
    } else {
      this.siteControls.release();
    }
  }

  /**
   * Set up event handlers for media events
   * @private
   */
  setupEventHandlers() {
    const mediaEventAction = (event) => {
      const local = this.actionHandler.eventManager?.getMediaRateState?.(event.target);
      const speedPreferenceRevision = this.config.speedPreferenceRevision ?? 0;
      const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
      const targetSpeed = Math.min(
        MAX,
        Math.max(
          MIN,
          Number.isFinite(local?.lifecycleSpeed) &&
            (local.lifecycleSpeedRevision ?? 0) === speedPreferenceRevision
            ? local.lifecycleSpeed
            : this.getTargetSpeed()
        )
      );
      // Resuming/seeking must not retry a source's refused request or renew
      // cooldown, dispatch synthetic events and flash an already-correct UI.
      try {
        if (event.target.playbackRate === targetSpeed) {
          if (
            window.VSC.SafariHLSPlayback?.canSwitch?.(this, targetSpeed, 'init') ||
            window.VSC.TwitterMP4Playback?.canBegin(this, targetSpeed, 'init')
          ) {
            this.actionHandler.adjustSpeed(event.target, targetSpeed, { source: 'init' });
            return;
          }
          if (local) {
            // Adopt a replacement that already matches without a native write.
            local.lifecycleSpeed = targetSpeed;
            local.lifecycleSpeedRevision = speedPreferenceRevision;
            if (Number.isFinite(this.config.settings.lastSpeed)) {
              local.acceptedSpeed = targetSpeed;
              local.acceptedSpeedRevision = speedPreferenceRevision;
            }
          }
          return;
        }
      } catch {
        // A page-owned getter must not break the media lifecycle callback.
        return;
      }

      // Lifecycle restore, not a user choice — don't persist to lastSpeed.
      window.VSC.logger.info(`Media event ${event.type}: restoring speed to ${targetSpeed}`);
      this.actionHandler.adjustSpeed(event.target, targetSpeed, { source: 'init' });
    };

    // Bind event handlers
    this.handlePlay = mediaEventAction.bind(this);
    // Don't restore speed on seeked if the video hasn't loaded data yet —
    // the player may still be initializing.
    this.handleSeek = (event) => {
      if (event.target.readyState < 2) {
        return;
      }
      mediaEventAction.call(this, event);
    };

    // Add essential event listeners for speed restoration
    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('seeked', this.handleSeek);
    this.handleRateSourceReset = () => {
      if (!this.safariPlayback?.ownsTransition()) {
        this.actionHandler.eventManager?.releaseMediaState?.(this.video);
      }
    };
    this.video.addEventListener('emptied', this.handleRateSourceReset);
    this.video.addEventListener('loadstart', this.handleRateSourceReset);

    // Native ratechange events are not composed: a shadow root prevents them
    // from reaching EventManager's document capture listener. Forward only
    // events whose path excludes the document, avoiding duplicate processing
    // for light-DOM media and composed events.
    this.handleShadowRateChange = (event) => {
      if (!event.composed && !event.composedPath().includes(this.video.ownerDocument)) {
        this.actionHandler.eventManager?.handleRateChange(event);
      }
    };
    this.video.addEventListener('ratechange', this.handleShadowRateChange);

    window.VSC.logger.debug('Added essential media event handlers: play, seeked');
  }

  /**
   * Set up mutation observer for src attribute changes
   * @private
   */
  setupMutationObserver() {
    this.handleSourceVisibility = () => {
      if (this.disposed) {
        return;
      }
      this.div.classList.toggle(
        'vsc-nosource',
        !this.video.src && !this.video.currentSrc && this.video.readyState < 2
      );
    };
    // A <source> child can become playable without changing the video's src
    // attribute. Reconcile readiness as well as explicit attribute writes.
    for (const event of ['loadeddata', 'loadstart', 'emptied']) {
      this.video.addEventListener(event, this.handleSourceVisibility);
    }
    this.targetObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc')
        ) {
          window.VSC.logger.debug('Mutation of A/V element detected');
          this.handleSourceVisibility();
        }
      });
    });

    this.targetObserver.observe(this.video, {
      attributeFilter: ['src', 'currentSrc'],
    });
  }

  /**
   * Remove controller and clean up
   */
  remove() {
    window.VSC.recordVideoDiagnostic?.('controller-remove', this.video);
    window.VSC.logger.debug('Removing VideoController');
    this.iosPlayer?.cleanup();
    this.siteControls?.release();
    this.controlsManager?.cleanup();
    this.actionHandler?.eventManager?.releaseMediaState?.(this.video);

    // Remove DOM element
    if (this.div?.flashTimer !== undefined) {
      clearTimeout(this.div.flashTimer);
      this.div.flashTimer = undefined;
    }

    if (this.div && this.div.parentNode) {
      this.div.remove();
    }

    // Remove event listeners
    if (this.initMetadataHandler) {
      this.video.removeEventListener('loadedmetadata', this.initMetadataHandler);
      this.initMetadataHandler = null;
    }

    if (this.handlePlay) {
      this.video.removeEventListener('play', this.handlePlay);
    }
    if (this.handleSeek) {
      this.video.removeEventListener('seeked', this.handleSeek);
    }
    if (this.handleRateSourceReset) {
      this.video.removeEventListener('emptied', this.handleRateSourceReset);
      this.video.removeEventListener('loadstart', this.handleRateSourceReset);
      this.handleRateSourceReset = null;
    }
    if (this.handleShadowRateChange) {
      this.video.removeEventListener('ratechange', this.handleShadowRateChange);
      this.handleShadowRateChange = null;
    }

    // Stop fps detection: mark disposed first (a rVFC callback already in flight
    // must not re-arm even if cancel is unavailable), cancel any pending callback,
    // and remove the re-arm listeners. Nothing may leak across teardown /
    // document replacement.
    this.disposed = true;
    this.stopFpsBurst();
    if (this.handleFpsReset) {
      this.video.removeEventListener('emptied', this.handleFpsReset);
      this.video.removeEventListener('loadstart', this.handleFpsReset);
      this.handleFpsReset = null;
    }

    // Disconnect mutation observer
    if (this.handleSourceVisibility) {
      for (const event of ['loadeddata', 'loadstart', 'emptied']) {
        this.video.removeEventListener(event, this.handleSourceVisibility);
      }
      this.handleSourceVisibility = null;
    }
    if (this.targetObserver) {
      this.targetObserver.disconnect();
    }

    // Remove from state manager
    if (window.VSC.stateManager) {
      window.VSC.stateManager.removeController(this.controllerId);
    }

    // Restore the original rendition after our lifecycle listeners are gone;
    // continuing an already-playing clip must not initialize another fallback.
    this.safariPlaybackPending?.cleanup();
    this.safariPlayback?.cleanup();
    window.VSC.GifPlayback?.get(this.video)?.cleanup();

    // Remove reference from video element
    delete this.video.vsc;
    window.VSC.CustomWebMObserver?.get(this.video)?.cleanup();
    window.VSC.TwitterMP4Playback?.controllerRemoved(this.video);

    window.VSC.logger.debug('VideoController removed successfully');
  }

  /**
   * Generate unique controller ID for badge tracking
   * @param {HTMLElement} target - Video/audio element
   * @returns {string} Unique controller ID
   * @private
   */
  generateControllerId(target) {
    const timestamp = Date.now();
    const src = target.currentSrc || target.src || 'no-src';
    const tagName = target.tagName.toLowerCase();

    // Create a simple hash from src for uniqueness
    const srcHash = src.split('').reduce((hash, char) => {
      hash = (hash << 5) - hash + char.charCodeAt(0);
      return hash & hash; // Convert to 32-bit integer
    }, 0);

    const sequence = VideoController.nextControllerId++;
    return `${tagName}-${Math.abs(srcHash)}-${timestamp}-${sequence}`;
  }

  /**
   * Check if the video element is currently visible
   * @returns {boolean} True if video is visible
   */
  isVideoVisible() {
    // Check if video is still connected to DOM
    if (!this.video.isConnected) {
      return false;
    }

    // Check computed style for visibility
    const style = window.getComputedStyle(this.video);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // Check if video has reasonable dimensions
    const rect = this.video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return true;
  }

  /**
   * Update controller visibility based on video visibility
   * Called when video visibility changes
   */
  updateVisibility() {
    const isVisible = this.isVideoVisible();
    const isCurrentlyHidden = this.div.classList.contains('vsc-hidden');

    // Special handling for audio elements - don't hide controllers for functional audio
    if (this.video.tagName === 'AUDIO') {
      // For audio, only hide if manually hidden or if audio support is disabled
      if (!this.config.settings.audioBoolean && !isCurrentlyHidden) {
        this.div.classList.add('vsc-hidden');
        window.VSC.logger.debug('Hiding audio controller - audio support disabled');
      } else if (
        this.config.settings.audioBoolean &&
        isCurrentlyHidden &&
        !this.div.classList.contains('vsc-manual')
      ) {
        // Show audio controller if audio support is enabled and not manually hidden
        this.div.classList.remove('vsc-hidden');
        window.VSC.logger.debug('Showing audio controller - audio support enabled');
      }
      return;
    }

    // Original logic for video elements
    if (
      isVisible &&
      isCurrentlyHidden &&
      !this.div.classList.contains('vsc-manual') &&
      !this.config.settings.startHidden
    ) {
      // Video became visible and controller is hidden (but not manually hidden and not set to start hidden)
      this.div.classList.remove('vsc-hidden');
      window.VSC.logger.debug('Showing controller - video became visible');
    } else if (!isVisible && !isCurrentlyHidden) {
      // Video became invisible and controller is visible
      this.div.classList.add('vsc-hidden');
      window.VSC.logger.debug('Hiding controller - video became invisible');
    }
  }
}

// --- Frame-rate detection tunables ---

// Common broadcast/film frame rates. A raw estimate within FPS_SNAP_TOLERANCE
// of one of these snaps to it; otherwise the raw value is kept.
VideoController.COMMON_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

// Consecutive agreeing samples required before committing a detected fps.
VideoController.FPS_MIN_SAMPLES = 3;
VideoController.nextControllerId = 1;

// Hard cap on rVFC callbacks per burst before giving up. Bounds the burst by
// callbacks (not useful samples) so variable-frame-rate or looping media, whose
// frames may never produce a valid sample, can't re-register forever. ~60
// callbacks is a second or two of playback — ample to converge on real fps.
VideoController.FPS_MAX_CALLBACKS = 60;

// Recent samples must agree within this relative spread to be considered stable.
VideoController.FPS_STABILITY_TOLERANCE = 0.05;

// Snap a raw estimate to a common rate only when within this relative distance.
VideoController.FPS_SNAP_TOLERANCE = 0.05;

/**
 * Snap a raw fps estimate to the nearest common frame rate when close enough,
 * else return the raw value unchanged.
 * @param {number} raw - Raw fps estimate
 * @returns {number} Snapped or raw fps
 */
VideoController.snapToCommonFps = function (raw) {
  let best = raw;
  let bestDelta = Infinity;
  for (const candidate of VideoController.COMMON_FPS) {
    const delta = Math.abs(candidate - raw);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return bestDelta / raw <= VideoController.FPS_SNAP_TOLERANCE ? best : raw;
};

// Create singleton instance
window.VSC.VideoController = VideoController;

// Global variables available for both browser and testing

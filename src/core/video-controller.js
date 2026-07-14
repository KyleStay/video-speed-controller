/**
 * Video Controller class for managing individual video elements
 *
 */

window.VSC = window.VSC || {};

class VideoController {
  constructor(target, parent, config, actionHandler, shouldStartHidden = false) {
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

    // Attach controller to video element first (needed for adjustSpeed)
    target.vsc = this;

    // Register with state manager immediately after controller is attached
    if (window.VSC.stateManager) {
      window.VSC.stateManager.registerController(this);
    } else {
      window.VSC.logger.error('StateManager not available during VideoController initialization');
    }

    // Initialize speed
    this.initializeSpeed();

    // Create UI
    this.div = this.initializeControls();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up mutation observer for src changes
    this.setupMutationObserver();

    // Start measuring the real frame rate (video-only, zero steady-state cost).
    this.setupFpsDetection();

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
        this.vfcHandle = this.video.requestVideoFrameCallback(sampler);
      }
    };

    this.vfcHandle = this.video.requestVideoFrameCallback(sampler);
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
  initializeSpeed() {
    const targetSpeed = this.getTargetSpeed();

    window.VSC.logger.debug(`Setting initial playbackRate to: ${targetSpeed}`);

    if (!this.actionHandler || targetSpeed === this.video.playbackRate) {
      return;
    }

    // Defer until metadata is loaded — setting playbackRate before the player
    // has initialized can race with the site's own init sequence.
    if (this.video.readyState < 1) {
      window.VSC.logger.debug('Deferring initializeSpeed until loadedmetadata');
      const handler = () => {
        this.video.removeEventListener('loadedmetadata', handler);
        this.initMetadataHandler = null;
        if (targetSpeed !== this.video.playbackRate) {
          this.actionHandler.adjustSpeed(this.video, targetSpeed, { source: 'init' });
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
    });

    // Set up control events
    this.controlsManager.setupControlEvents(shadow, this.video);

    // Store speed indicator reference
    this.speedIndicator = window.VSC.ShadowDOMManager.getSpeedIndicator(shadow);

    // Insert into DOM FIRST — position calculation needs the wrapper in the DOM
    this.insertIntoDOM(document, wrapper);

    // THEN compute position based on actual DOM state.
    // If a CSS override sets the wrapper to position:relative (e.g. YouTube, Netflix),
    // the inner controller stays at (0,0) and the CSS nudge handles placement.
    // Otherwise (wrapper is absolute), compute coordinates for generic sites.
    const computedPosition = getComputedStyle(wrapper).position;
    if (computedPosition !== 'relative') {
      const position = window.VSC.ShadowDOMManager.calculatePosition(this.video);
      const innerController = window.VSC.ShadowDOMManager.getController(shadow);
      innerController.style.top = position.top;
      innerController.style.left = position.left;
    }

    window.VSC.logger.debug('initializeControls End');
    return wrapper;
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

  /**
   * Set up event handlers for media events
   * @private
   */
  setupEventHandlers() {
    const mediaEventAction = (event) => {
      const targetSpeed = this.getTargetSpeed(event.target);

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

    window.VSC.logger.debug('Added essential media event handlers: play, seeked');
  }

  /**
   * Set up mutation observer for src attribute changes
   * @private
   */
  setupMutationObserver() {
    this.targetObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'currentSrc')
        ) {
          window.VSC.logger.debug('Mutation of A/V element detected');
          const controller = this.div;
          if (!mutation.target.src && !mutation.target.currentSrc) {
            controller.classList.add('vsc-nosource');
          } else {
            controller.classList.remove('vsc-nosource');
          }
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
    window.VSC.logger.debug('Removing VideoController');

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
    if (this.targetObserver) {
      this.targetObserver.disconnect();
    }

    // Remove from state manager
    if (window.VSC.stateManager) {
      window.VSC.stateManager.removeController(this.controllerId);
    }

    // Remove reference from video element
    delete this.video.vsc;

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

    const random = Math.floor(Math.random() * 1000);
    return `${tagName}-${Math.abs(srcHash)}-${timestamp}-${random}`;
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

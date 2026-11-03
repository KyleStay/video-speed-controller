/**
 * Action handling system for Video Speed Controller
 *
 */

window.VSC = window.VSC || {};
const nativeRelativeRate = Object.getOwnPropertyDescriptor(
  window.HTMLMediaElement?.prototype || {},
  'playbackRate'
);

class ActionHandler {
  constructor(config, eventManager) {
    this.config = config;
    this.eventManager = eventManager;
  }

  /**
   * Execute an action on media elements
   * @param {string} action - Action to perform
   * @param {*} value - Action value
   * @param {Event} e - Event object (optional)
   */
  runAction(action, value, e) {
    // Use state manager for complete media discovery (includes shadow DOM)
    const mediaTags = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : []; // No fallback - state manager should always be available

    // Hardware shortcuts belong to the video in the active owned player.
    // Eventless popup commands and individual controller clicks keep their scope.
    let ownedVideo = null;
    try {
      if (e?.type === 'keydown') {
        const owner = window.VSC.IOSPlayer?.activePlayers?.get(document);
        const current = owner?.presentationCurrent;
        if (typeof current === 'function' && current.call(owner) !== true) {
          return;
        }
        ownedVideo = owner?.video;
      }
    } catch {
      return;
    }

    // Get the controller that was used if called from a button press event
    let targetController = null;
    if (e && !ownedVideo) {
      targetController = e.target.getRootNode().host;
    }

    mediaTags.forEach((v) => {
      if (ownedVideo && v !== ownedVideo) {
        return;
      }

      const controller = v.vsc?.div;

      if (!controller) {
        return;
      }

      // Don't change video speed if the video has a different controller
      // Only apply this check for button clicks (when targetController is set)
      if (e && targetController && !(targetController === controller)) {
        return;
      }

      if (!v.classList.contains('vsc-cancelled')) {
        this.executeAction(action, value, v, e);
      }
    });
  }

  /**
   * Execute specific action on a video element
   * @param {string} action - Action to perform
   * @param {*} value - Action value
   * @param {HTMLMediaElement} video - Video element
   * @param {Event} e - Event object (optional)
   * @private
   */
  executeAction(action, value, video, e) {
    switch (action) {
      case 'rewind':
        window.VSC.logger.debug('Rewind');
        this.seek(video, -value);
        break;

      case 'advance':
        window.VSC.logger.debug('Fast forward');
        this.seek(video, value);
        break;

      case 'rewindFrame':
        window.VSC.logger.debug('Step back one frame');
        this.stepFrame(video, -1, value);
        break;

      case 'advanceFrame':
        window.VSC.logger.debug('Step forward one frame');
        this.stepFrame(video, 1, value);
        break;

      case 'faster': {
        window.VSC.logger.debug('Increase speed');
        this.adjustSpeed(video, value, { relative: true });
        break;
      }

      case 'slower': {
        window.VSC.logger.debug('Decrease speed');
        this.adjustSpeed(video, -value, { relative: true });
        break;
      }

      case 'reset':
        window.VSC.logger.debug('Reset speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('fast'));
        break;

      case 'display': {
        window.VSC.logger.debug('Display action triggered');
        const controller = video.vsc.div;

        if (!controller) {
          window.VSC.logger.error('No controller found for video');
          return;
        }

        // Clear any pending flash timer before toggling
        if (controller.flashTimer !== undefined) {
          clearTimeout(controller.flashTimer);
          controller.flashTimer = undefined;
        }

        controller.classList.toggle('vsc-hidden');
        // vsc-manual means "user has expressed intent about this controller's
        // visibility." Set on first toggle, never cleared for the lifetime of
        // the controller. This protects against YouTube autohide overriding
        // the user's show intent, and prevents flash from overriding hide intent.
        controller.classList.add('vsc-manual');

        if (controller.classList.contains('vsc-hidden')) {
          // User is hiding — also remove any pending flash override
          controller.classList.remove('vsc-show');
        }
        break;
      }

      case 'blink':
        window.VSC.logger.debug('Showing controller momentarily');
        this.flashController(video.vsc.div, value);
        break;

      case 'drag':
        window.VSC.DragHandler.handleDrag(video, e);
        break;

      case 'fast':
        window.VSC.logger.debug('Preferred speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('reset'));
        break;

      case 'pause':
        this.pause(video);
        break;

      case 'muted':
        this.muted(video);
        break;

      case 'louder':
        this.volumeUp(video, value);
        break;

      case 'softer':
        this.volumeDown(video, value);
        break;

      case 'mark':
        this.setMark(video);
        break;

      case 'jump':
        this.jumpToMark(video);
        break;

      case 'SET_SPEED':
        window.VSC.logger.info('Setting speed to:', value);
        this.adjustSpeed(video, value, { source: 'internal' });
        break;

      case 'ADJUST_SPEED':
        window.VSC.logger.info('Adjusting speed by:', value);
        this.adjustSpeed(video, value, { relative: true, source: 'internal' });
        break;

      case 'RESET_SPEED': {
        window.VSC.logger.info('Resetting speed');
        const preferredSpeed = this.config.getKeyBinding('fast') || 1.0;
        this.adjustSpeed(video, preferredSpeed, { source: 'internal' });
        break;
      }

      default:
        window.VSC.logger.warn(`Unknown action: ${action}`);
    }
  }

  /**
   * Seek video by specified seconds
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   */
  seek(video, seekSeconds) {
    if (window.VSC.GifPlayback?.get(video)) {
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seekSeconds));
      return;
    }
    // Use site-specific seeking (handlers return true if they handle it)
    window.VSC.siteHandlerManager.handleSeek(video, seekSeconds);
  }

  /**
   * Step the video by exactly one frame.
   *
   * Product rules encoded here:
   *   - Only while paused. Frame-stepping a playing video fights the play loop
   *     and isn't useful, so it's a silent no-op (we never auto-pause).
   *   - Video only. Frames are meaningless for <audio> — no-op.
   *
   * Frame size = detected fps (measured by the controller's rVFC burst sampler)
   * when available, else the binding's configurable fallback fps. Step amount is
   * `1 / fps` seconds, routed through the normal seek path so site handlers'
   * bounds-checking applies (finite duration or the current native live window).
   *
   * This writes `currentTime`, not `playbackRate`, so it never touches the
   * ratechange cooldown / fight-back machinery.
   *
   * @param {HTMLMediaElement} video - Media element
   * @param {number} direction - -1 to step back, +1 to step forward
   * @param {number} fallbackFps - Binding value: fps used when none is detected
   */
  stepFrame(video, direction, fallbackFps) {
    const gif = window.VSC.GifPlayback?.get(video);
    if (gif) {
      gif.stepFrame(direction);
      return;
    }
    if (video.tagName !== 'VIDEO') {
      window.VSC.logger.debug('stepFrame ignored: not a video element');
      return;
    }
    if (!video.paused) {
      window.VSC.logger.debug('stepFrame ignored: only steps while paused');
      return;
    }

    // Sanitize: a detected 0/NaN falls through to the fallback; a malformed
    // fallback (e.g. an imported binding value of -30, which is truthy and would
    // reverse the step direction) falls through to 30. fps must be finite and > 0.
    const candidate = video.vsc?.detectedFps || fallbackFps || 30;
    const fps = Number.isFinite(candidate) && candidate > 0 ? candidate : 30;
    this.seek(video, direction * (1 / fps));
  }

  /**
   * Toggle pause/play
   * @param {HTMLMediaElement} video - Video element
   */
  pause(video) {
    if (video.paused) {
      window.VSC.logger.debug('Resuming video');
      video.play();
    } else {
      window.VSC.logger.debug('Pausing video');
      video.pause();
    }
  }

  /**
   * Reset speed with memory toggle functionality.
   *
   * Behavior:
   *   - Not at target → remember current speed, jump to target.
   *   - At target with memory → restore remembered speed, clear memory.
   *   - At target without memory → cross-toggle to the other action's speed
   *     (e.g. reset at 1.0x jumps to preferred speed, preferred at 1.8x jumps to reset speed).
   *
   * @param {HTMLMediaElement} video - Video element
   * @param {number} target - Target speed for this action
   * @param {number} [crossTarget] - Target speed of the paired action (for cross-toggle)
   */
  resetSpeed(video, target, crossTarget) {
    if (!video.vsc) {
      window.VSC.logger.warn('resetSpeed called on video without controller');
      return;
    }

    const currentSpeed = video.playbackRate;

    if (currentSpeed === target) {
      if (video.vsc.speedBeforeReset !== null) {
        // Restore remembered speed
        window.VSC.logger.info(`Restoring remembered speed: ${video.vsc.speedBeforeReset}`);
        const rememberedSpeed = video.vsc.speedBeforeReset;
        video.vsc.speedBeforeReset = null;
        this.adjustSpeed(video, rememberedSpeed);
      } else if (crossTarget && crossTarget !== target) {
        // Cross-toggle: jump to the paired action's target
        window.VSC.logger.info(`Cross-toggle from ${target} to ${crossTarget}`);
        video.vsc.speedBeforeReset = currentSpeed;
        this.adjustSpeed(video, crossTarget);
      }
    } else {
      // Remember current speed and jump to target
      window.VSC.logger.info(`Remembering speed ${currentSpeed} and resetting to ${target}`);
      video.vsc.speedBeforeReset = currentSpeed;
      this.adjustSpeed(video, target);
    }
  }

  /**
   * Toggle mute
   * @param {HTMLMediaElement} video - Video element
   */
  muted(video) {
    video.muted = video.muted !== true;
  }

  /**
   * Increase volume
   * @param {HTMLMediaElement} video - Video element
   * @param {number} value - Amount to increase
   */
  volumeUp(video, value) {
    video.volume = Math.min(1, (video.volume + value).toFixed(2));
  }

  /**
   * Decrease volume
   * @param {HTMLMediaElement} video - Video element
   * @param {number} value - Amount to decrease
   */
  volumeDown(video, value) {
    video.volume = Math.max(0, (video.volume - value).toFixed(2));
  }

  /**
   * Set time marker
   * @param {HTMLMediaElement} video - Video element
   */
  setMark(video) {
    window.VSC.logger.debug('Adding marker');
    video.vsc.mark = video.currentTime;
  }

  /**
   * Jump to time marker, or jump back to previous position if already at marker
   * @param {HTMLMediaElement} video - Video element
   */
  jumpToMark(video) {
    if (
      video.vsc.mark === null ||
      video.vsc.mark === undefined ||
      typeof video.vsc.mark !== 'number'
    ) {
      return;
    }

    const currentTime = video.currentTime;

    if (video.vsc.positionBeforeJump !== null && Math.abs(currentTime - video.vsc.mark) < 0.05) {
      // At the marker — toggle back to where we came from
      window.VSC.logger.debug('Jumping back to pre-marker position');
      video.currentTime = video.vsc.positionBeforeJump;
      video.vsc.positionBeforeJump = null;
    } else {
      // Jump to marker, remembering current position
      window.VSC.logger.debug('Jumping to marker');
      video.vsc.positionBeforeJump = currentTime;
      video.currentTime = video.vsc.mark;
    }
  }

  /**
   * Flash controller briefly for visual feedback.
   * Single entry point for all temporary visibility — replaces both
   * blinkController and EventManager.showController.
   * @param {HTMLElement} controller - Controller element
   * @param {number} duration - Duration in ms (default 2000)
   */
  flashController(controller, duration) {
    // startHidden is a hard preference — never flash, regardless of V toggle.
    if (this.config.settings.startHidden) {
      window.VSC.logger.debug('flashController skipped: startHidden is a hard preference');
      return;
    }

    // User explicitly hid this controller (V key) — respect that choice.
    if (
      controller.classList.contains('vsc-manual') &&
      controller.classList.contains('vsc-hidden')
    ) {
      window.VSC.logger.debug('flashController skipped: user manually hid controller');
      return;
    }

    const isAudioController = this.isAudioController(controller);

    // Always clear any existing timer first (timer invariant: one per controller)
    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }

    // Add vsc-show class to temporarily show controller
    // This overrides vsc-hidden and vsc-autohide via CSS source order
    controller.classList.add('vsc-show');
    window.VSC.logger.debug('Showing controller temporarily with vsc-show class');

    // For audio controllers, don't set timeout to hide again
    if (!isAudioController) {
      controller.flashTimer = setTimeout(() => {
        controller.classList.remove('vsc-show');
        controller.flashTimer = undefined;
        window.VSC.logger.debug('Removing vsc-show class after flash timeout');
      }, duration || 2000);
    } else {
      window.VSC.logger.debug('Audio controller flash - keeping vsc-show class');
    }
  }

  /**
   * Check if controller is associated with an audio element
   * @param {HTMLElement} controller - Controller element
   * @returns {boolean} True if associated with audio element
   * @private
   */
  isAudioController(controller) {
    // Find associated media element using state manager
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    for (const media of mediaElements) {
      if (media.vsc && media.vsc.div === controller) {
        return media.tagName === 'AUDIO';
      }
    }
    return false;
  }

  /**
   * Adjust video playback speed (absolute or relative)
   * Simplified to use proven working logic from setSpeed method
   *
   * @param {HTMLMediaElement} video - Target video element
   * @param {number} value - Speed value (absolute) or delta (relative)
   * @param {Object} options - Configuration options
   * @param {boolean} options.relative - If true, value is a delta; if false, absolute speed
   * @param {string} options.source - 'internal' (user action) or 'external' (site/other)
   */
  adjustSpeed(video, value, options = {}) {
    return window.VSC.logger.withContext(video, () => {
      // Validate input
      if (!video || !video.vsc) {
        window.VSC.logger.warn('adjustSpeed called on video without controller');
        return;
      }

      if (typeof value !== 'number' || !Number.isFinite(value)) {
        window.VSC.logger.warn('adjustSpeed called with invalid value:', value);
        return;
      }

      return this._adjustSpeedInternal(video, value, options);
    });
  }

  /**
   * Internal adjustSpeed implementation (context already set)
   * @private
   */
  _adjustSpeedInternal(video, value, options) {
    const { relative = false, source = 'internal' } = options;
    const playbackSession = window.VSC.TwitterMP4Playback?.get(video);
    const nativeRelative = this.eventManager?.getMediaRateState(video)?.nativeRelative;
    const nativeCurrent = nativeRelative?.current();
    if (nativeRelative && !nativeCurrent) {
      nativeRelative.cancel();
    }

    // Calculate target speed
    let targetSpeed;
    if (relative) {
      // Compose every relative input with pending source preparation or X playback input.
      const pendingSpeed =
        source !== 'external' && source !== 'init'
          ? (window.VSC.TwitterCaptionPlayback?.requestedSpeed?.(video.vsc) ??
            playbackSession?.requestedSpeed?.(video.vsc) ??
            (nativeCurrent ? nativeRelative.target : null))
          : null;
      const baseSpeed = Number.isFinite(pendingSpeed) ? pendingSpeed : video.playbackRate;
      const currentSpeed = baseSpeed < 0.1 ? 0.0 : baseSpeed;
      targetSpeed = currentSpeed + value;

      // Snap to 1.0x when crossing the 1.0 boundary
      if ((currentSpeed > 1.0 && targetSpeed < 1.0) || (currentSpeed < 1.0 && targetSpeed > 1.0)) {
        targetSpeed = 1.0;
      }

      window.VSC.logger.debug(
        `Relative speed calculation: currentSpeed=${currentSpeed} + ${value} = ${targetSpeed}`
      );
    } else {
      // For absolute changes, use value directly
      targetSpeed = value;
      window.VSC.logger.debug(`Absolute speed set: ${targetSpeed}`);
    }

    // Clamp to valid range
    targetSpeed = Math.min(
      Math.max(targetSpeed, window.VSC.Constants.SPEED_LIMITS.MIN),
      window.VSC.Constants.SPEED_LIMITS.MAX
    );

    // Round to 2 decimal places to avoid floating point issues
    targetSpeed = Number(targetSpeed.toFixed(2));

    if (relative && playbackSession?.queueRelative?.(video.vsc, targetSpeed, source)) {
      return false;
    }

    if (relative && source !== 'external' && source !== 'init' && nativeCurrent) {
      nativeRelative.queue(targetSpeed, source);
      return false;
    }

    // Fight detection is enforced upstream in event-manager.js.
    // External changes that reach here have already been approved (fight surrendered or speed matched).
    return relative
      ? this.setSpeed(video, targetSpeed, source, true)
      : this.setSpeed(video, targetSpeed, source);
  }

  armNativeRelative(video) {
    let hint;
    try {
      const controller = video.vsc,
        doc = video.ownerDocument,
        view = doc.defaultView;
      const state = this.eventManager?.getMediaRateState(video);
      if (
        !state ||
        !window.VSC.IOSPlayer?.isSupported(video) ||
        video.localName !== 'video' ||
        !video.currentSrc ||
        video.childNodes.length > 16 ||
        controller.twitterCaptionPending ||
        controller.safariPlaybackPending ||
        controller.safariPlayback ||
        window.VSC.TwitterMP4Playback?.get(video) ||
        window.VSC.TwitterMP4Playback?.getPending(video)
      ) {
        return;
      }
      const config = this.config,
        settings = config.settings,
        root = doc.documentElement,
        url = doc.URL;
      const source = video.currentSrc,
        src = video.getAttribute('src'),
        poster = video.getAttribute('poster');
      const children = [...video.childNodes],
        setSpeed = this.setSpeed,
        applySpeed = this.applySpeed;
      const preference = settings.lastSpeed,
        revision = config.speedPreferenceRevision ?? 0,
        rate = video.playbackRate;
      const rateDescriptor = () => {
        let prototype = video;
        for (
          let depth = 0;
          prototype && depth < 8;
          depth++, prototype = Object.getPrototypeOf(prototype)
        ) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'playbackRate');
          if (descriptor) {
            return { prototype, descriptor };
          }
        }
        return {};
      };
      const { prototype, descriptor } = rateDescriptor();
      if (
        prototype !== window.HTMLMediaElement.prototype ||
        descriptor?.get !== nativeRelativeRate?.get ||
        descriptor?.set !== nativeRelativeRate?.set
      ) {
        return;
      }
      const commandRevision = this.speedCommandRevision ?? 0;
      const observer = new view.MutationObserver(() => hint.cancel());
      hint = {
        rate,
        commandRevision,
        target: null,
        current: (expectedPreference = preference, expectedRate = rate) => {
          try {
            if (hint.cancelled) {
              return false;
            }
            const current = rateDescriptor(),
              currentDescriptor = current.descriptor;
            const valid =
              (this.speedCommandRevision ?? 0) === commandRevision &&
              !observer.takeRecords().length &&
              video.vsc === controller &&
              !controller.disposed &&
              controller.actionHandler === this &&
              this.setSpeed === setSpeed &&
              this.applySpeed === applySpeed &&
              controller.config === config &&
              this.config === config &&
              config.settings === settings &&
              settings.enabled !== false &&
              settings.lastSpeed === expectedPreference &&
              (config.speedPreferenceRevision ?? 0) === revision &&
              video.isConnected &&
              video.ownerDocument === doc &&
              doc.documentElement === root &&
              doc.URL === url &&
              video.currentSrc === source &&
              video.getAttribute('src') === src &&
              video.getAttribute('poster') === poster &&
              !video.srcObject &&
              !video.mediaKeys &&
              !video.webkitKeys &&
              nativeRelativeRate.get.call(video) === expectedRate &&
              current.prototype === prototype &&
              currentDescriptor?.get === descriptor?.get &&
              currentDescriptor?.set === descriptor?.set &&
              currentDescriptor?.writable === descriptor?.writable &&
              video.childNodes.length === children.length &&
              children.every((child, i) => video.childNodes[i] === child) &&
              this.eventManager.getMediaRateState(video) === state &&
              !controller.twitterCaptionPending &&
              !controller.safariPlaybackPending &&
              !controller.safariPlayback &&
              !window.VSC.TwitterMP4Playback?.get(video) &&
              !window.VSC.TwitterMP4Playback?.getPending(video);
            if (!valid) {
              hint.cancel();
            }
            return valid;
          } catch {
            hint.cancel();
            return false;
          }
        },
        cancel: () => {
          hint.cancelled = true;
          view.clearTimeout(hint.timer);
          observer.disconnect();
          if (state.nativeRelative === hint) {
            state.nativeRelative = null;
          }
        },
        queue: (target, source) => {
          view.clearTimeout(hint.timer);
          hint.target = target;
          hint.timer = view.setTimeout(() => {
            if (state.nativeRelative !== hint) {
              return;
            }
            hint.flushing = true;
            try {
              if (hint.current()) {
                applySpeed.call(this, video, target, source, hint);
              }
            } catch {
              // An inaccessible page API cancels this pending command.
            } finally {
              hint.cancel();
            }
          }, 100);
        },
      };
      observer.observe(video, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['src', 'poster', 'type', 'media', 'kind', 'srclang', 'label', 'default'],
      });
      if (!hint.current()) {
        hint.cancel();
        return;
      }
      state.nativeRelative = hint;
      hint.timer = view.setTimeout(hint.cancel, 100);
    } catch {
      hint?.cancel();
    }
  }

  /**
   * Get user's preferred speed, respecting rememberSpeed setting.
   * @returns {number} Preferred speed (lastSpeed when remembering, 1.0 otherwise)
   */
  getPreferredSpeed() {
    if (this.config.settings.rememberSpeed) {
      return this.config.settings.lastSpeed || 1.0;
    }
    return 1.0;
  }

  /**
   * Set video playback speed with complete state management
   * Unified implementation with all functionality - no fragmented logic
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   * @param {string} source - Change source: 'internal' (user/extension) or 'external' (site)
   */
  setSpeed(video, speed, source = 'internal', relative = false) {
    return this.applySpeed(video, speed, source, null, relative);
  }

  applySpeed(video, speed, source, nativeHint = null, relative = false) {
    if (!Number.isFinite(speed)) {
      return false;
    }
    if (nativeHint && !nativeHint.current()) {
      return false;
    }
    const priorState = this.eventManager?.getMediaRateState(video);
    if (!nativeHint) {
      this.speedCommandRevision = (this.speedCommandRevision ?? 0) + 1;
    }
    if (!nativeHint) {
      priorState?.nativeRelative?.cancel();
    }
    window.VSC.TwitterMP4Playback?.get(video)?.cancelRelative?.();
    let previousPlaybackRate;
    try {
      previousPlaybackRate = nativeHint ? nativeRelativeRate.get.call(video) : video.playbackRate;
    } catch {
      return false;
    }
    const { MIN, MAX } = window.VSC.Constants.SPEED_LIMITS;
    let numericSpeed = Number(Math.min(MAX, Math.max(MIN, speed)).toFixed(2));
    const commandConfig = this.config,
      commandSettings = commandConfig.settings;
    const previousSpeed = commandSettings.lastSpeed;
    const speedPreferenceRevision = this.config.speedPreferenceRevision ?? 0;

    const rejectNative = () => {
      if (
        (this.speedCommandRevision ?? 0) === nativeHint.commandRevision &&
        commandConfig.settings === commandSettings &&
        (commandConfig.speedPreferenceRevision ?? 0) === speedPreferenceRevision &&
        commandSettings.lastSpeed === numericSpeed
      ) {
        commandSettings.lastSpeed = previousSpeed;
      }
      return false;
    };

    // 1. Update lastSpeed BEFORE touching playbackRate. The playbackRate
    //    assignment (step 3) fires a synchronous native ratechange event.
    //    The cooldown handler reads lastSpeed as the "authoritative" speed
    //    to restore during fight-back. If lastSpeed is stale, the handler
    //    undoes the very change we're making.
    //    'init' source: skip — don't arm fight-back with the initialization
    //    default; let the first real user/site action establish authority.
    if (source !== 'external' && source !== 'init') {
      this.config.settings.lastSpeed = numericSpeed;
    }

    // 2. Start cooldown — the playbackRate assignment below triggers a
    //    native ratechange event synchronously. Without cooldown active,
    //    handleRateChange would misclassify it as an external site change.
    if (this.eventManager) {
      this.eventManager.refreshCoolDown(video, undefined, nativeHint);
    }

    // 3. Set the actual playback rate via site handler (native ratechange fires here, blocked by cooldown)
    const mediaRateState = this.eventManager?.getMediaRateState?.(video);
    if (mediaRateState) {
      mediaRateState.applyingSpeed = true;
    }
    let playbackTransition;
    try {
      playbackTransition = nativeHint
        ? null
        : window.VSC.TwitterCaptionPlayback?.begin(video.vsc, numericSpeed, source, {
            previousSpeed,
          }) ||
          window.VSC.TwitterMP4Playback?.begin(video.vsc, numericSpeed, source) ||
          window.VSC.SafariHLSPlayback?.begin(video.vsc, numericSpeed, source);
      if (playbackTransition?.deferred) {
        // Preparing a source transition has not accepted a new media rate yet.
        // Retain only local command intent; leave the displayed
        // and accepted rate unchanged until the coordinated source command.
        if (mediaRateState) {
          const acceptedRevision = mediaRateState.acceptedSpeedRevision ?? 0;
          const expectedPreference =
            source !== 'external' && source !== 'init' ? numericSpeed : previousSpeed;
          if (
            (this.config.speedPreferenceRevision ?? 0) === speedPreferenceRevision &&
            this.config.settings.lastSpeed === expectedPreference &&
            acceptedRevision <= speedPreferenceRevision
          ) {
            mediaRateState.lifecycleSpeed = numericSpeed;
            mediaRateState.lifecycleSpeedRevision = speedPreferenceRevision;
            if (
              Number.isFinite(previousPlaybackRate) &&
              previousPlaybackRate > 0 &&
              (!Number.isFinite(mediaRateState.acceptedSpeed) ||
                acceptedRevision < speedPreferenceRevision)
            ) {
              mediaRateState.acceptedSpeed = previousPlaybackRate;
              mediaRateState.acceptedSpeedRevision = speedPreferenceRevision;
            }
          }
        }
        return false;
      }
      if (nativeHint) {
        if (!nativeHint.current(numericSpeed, previousPlaybackRate)) {
          return rejectNative();
        }
        nativeRelativeRate.set.call(video, numericSpeed);
      } else {
        window.VSC.siteHandlerManager.handleSpeedChange(video, numericSpeed);
      }
      const acceptedSpeed = nativeHint ? nativeRelativeRate.get.call(video) : video.playbackRate;
      if (!Number.isFinite(acceptedSpeed) || acceptedSpeed <= 0) {
        playbackTransition?.abort();
        this.config.settings.lastSpeed = previousSpeed;
        return false;
      }
      if (nativeHint && !nativeHint.current(numericSpeed, acceptedSpeed)) {
        return rejectNative();
      }
      // Safari can accept a request yet clamp it for a particular source (e.g.
      // an HLS quirk), or ignore it for MediaStream. Reflect that readback; it
      // describes the accepted request, not measured decoding throughput.
      numericSpeed = acceptedSpeed;
      if (source !== 'external' && source !== 'init') {
        this.config.settings.lastSpeed = numericSpeed;
      }
      if (mediaRateState) {
        mediaRateState.lifecycleSpeed = numericSpeed;
        mediaRateState.lifecycleSpeedRevision = speedPreferenceRevision;
      }
      if (mediaRateState && (source !== 'init' || Number.isFinite(previousSpeed))) {
        // Each source can accept a different rate for the same command.
        // A sibling's readback must not invalidate this media's authority.
        mediaRateState.acceptedSpeed = numericSpeed;
        mediaRateState.acceptedSpeedRevision = speedPreferenceRevision;
      }
    } catch (error) {
      if (nativeHint) {
        let actual;
        try {
          actual = nativeRelativeRate.get.call(video);
        } catch {
          /* Lost native receiver. */
        }
        if (!nativeHint.current(numericSpeed, actual)) {
          return rejectNative();
        }
      }
      playbackTransition?.abort();
      let restoredSpeed =
        this.config.settings.lastSpeed === numericSpeed
          ? previousSpeed
          : this.config.settings.lastSpeed;
      try {
        const actual = nativeHint ? nativeRelativeRate.get.call(video) : video.playbackRate;
        if (Number.isFinite(actual) && actual > 0 && actual !== previousPlaybackRate) {
          // A custom setter can mutate then throw. Retain its local readback
          // even during init, without replacing an existing saved preference.
          if (source !== 'external' && source !== 'init') {
            restoredSpeed = actual;
          }
          if (mediaRateState) {
            mediaRateState.lifecycleSpeed = actual;
            mediaRateState.lifecycleSpeedRevision = speedPreferenceRevision;
          }
          if (mediaRateState && (source !== 'init' || Number.isFinite(previousSpeed))) {
            mediaRateState.acceptedSpeed = actual;
            mediaRateState.acceptedSpeedRevision = speedPreferenceRevision;
          }
        }
      } catch {
        // Preserve the last established authority when the page getter fails.
      }
      this.config.settings.lastSpeed = restoredSpeed;
      window.VSC.logger?.debug?.(
        `Playback speed request rejected: ${error?.message ?? String(error)}`
      );
      return false;
    } finally {
      if (mediaRateState) {
        mediaRateState.applyingSpeed = false;
      }
    }
    const speedValue = numericSpeed.toFixed(2);

    // 4. Dispatch synthetic event with source tracking
    video.dispatchEvent(
      new CustomEvent('ratechange', {
        bubbles: true,
        composed: true,
        detail: {
          origin: 'videoSpeed',
          speed: speedValue,
          source: source,
        },
      })
    );

    if (nativeHint && !nativeHint.current(numericSpeed, numericSpeed)) {
      return rejectNative();
    }

    // A same-video format change resumes only in this command's call stack.
    // Its asynchronous callbacks never start playback or revive a stale source.
    if (playbackTransition?.finish({ speedCommand: true }) === false) {
      this.config.settings.lastSpeed = previousSpeed;
      return false;
    }

    // 5. Update UI indicator
    const speedIndicator = video.vsc?.speedIndicator;
    if (!speedIndicator) {
      window.VSC.logger.warn(
        'Cannot update speed indicator: video controller UI not fully initialized'
      );
      return true;
    }
    const shadow = video.vsc?.div?.shadowRoot;
    if (shadow) {
      window.VSC.ShadowDOMManager.updateSpeedDisplay(shadow, numericSpeed);
    } else {
      speedIndicator.textContent = numericSpeed.toFixed(2);
      speedIndicator.setAttribute?.(
        'aria-label',
        `Playback speed ${numericSpeed.toFixed(2)}. Press Enter to reset speed.`
      );
    }

    if (nativeHint && !nativeHint.current(numericSpeed, numericSpeed)) {
      return rejectNative();
    }

    // 6. Persist to storage only if rememberSpeed is enabled
    if (source !== 'external' && source !== 'init' && this.config.settings.rememberSpeed) {
      this.config.save({ lastSpeed: numericSpeed });
    }

    // Crossing 2× must still run rendition selection in the current input call stack.
    if (
      relative &&
      numericSpeed > 2 &&
      !playbackTransition &&
      source !== 'external' &&
      source !== 'init'
    ) {
      this.armNativeRelative(video);
    }

    // 7. Flash controller briefly for visual feedback
    if (video.vsc?.div) {
      this.flashController(video.vsc.div);
    }
    return true;
  }
}

// Create singleton instance
window.VSC.ActionHandler = ActionHandler;

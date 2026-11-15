/**
 * Control button interactions and event handling
 */

window.VSC = window.VSC || {};

class ControlsManager {
  static canStepFrame(video) {
    try {
      if (
        (video?.tagName !== 'VIDEO' && !window.VSC.GifPlayback?.get(video)) ||
        !video.isConnected ||
        !video.paused ||
        !Number.isFinite(video.currentTime)
      ) {
        return false;
      }
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        return true;
      }
      const ranges = video.seekable;
      const index = ranges.length - 1;
      if (index < 0) {
        return false;
      }
      const start = ranges.start(index);
      const end = ranges.end(index);
      return Number.isFinite(start) && Number.isFinite(end) && end > start;
    } catch {
      return false;
    }
  }

  constructor(actionHandler, config) {
    this.actionHandler = actionHandler;
    this.config = config;
    this.cleanupHandlers = [];
    this.closeTouchControls = null;
    this.touchMode = false;
    this.video = null;
  }

  /**
   * Set up control button event listeners
   * @param {ShadowRoot} shadow - Shadow root containing controls
   * @param {HTMLVideoElement} video - Associated video element
   */
  setupControlEvents(shadow, video) {
    this.video = video;
    this.setupTouchControls(shadow);
    this.setupDragHandler(shadow);
    this.setupButtonHandlers(shadow, video);
    this.setupWheelHandler(shadow, video);
    this.setupClickPrevention(shadow);
  }

  /** Coarse-pointer controls use explicit open and close state. */
  setupTouchControls(shadow) {
    const ownerDocument = shadow.host.ownerDocument;
    const view = ownerDocument.defaultView;
    const indicator = shadow.querySelector('.draggable');
    try {
      const query = view.matchMedia('(pointer: coarse)');
      this.setTouchMode(shadow, query.matches);
      const onChange = () => this.setTouchMode(shadow, query.matches);
      query.addEventListener('change', onChange);
      this.cleanupHandlers.push(() => query.removeEventListener('change', onChange));
    } catch {
      // A genuine touch pointer also enables this interface, without UA sniffing.
    }

    indicator.addEventListener('click', (event) => {
      if (this.touchMode) {
        event.stopPropagation();
        this.setTouchExpanded(shadow, !shadow.host.classList.contains('vsc-touch-open'));
      }
    });
  }

  setTouchMode(shadow, enabled) {
    this.touchMode = enabled;
    shadow.host.toggleAttribute('data-vsc-touch', enabled);
    if (!enabled) {
      this.setTouchExpanded(shadow, false);
    }
    const indicator = shadow.querySelector('.draggable');
    if (enabled) {
      indicator.setAttribute(
        'aria-expanded',
        String(shadow.host.classList.contains('vsc-touch-open'))
      );
      indicator.setAttribute('aria-controls', 'controls');
    } else {
      indicator.removeAttribute('aria-expanded');
      indicator.removeAttribute('aria-controls');
    }
    window.VSC.ShadowDOMManager.updateSpeedDisplay(
      shadow,
      Number(indicator.dataset.speed ?? indicator.textContent)
    );
  }

  setTouchExpanded(shadow, expanded, restoreFocus = false) {
    this.closeTouchControls?.();
    if (!expanded || !this.touchMode) {
      if (restoreFocus) {
        shadow.querySelector('.draggable').focus({ preventScroll: true });
      }
      return;
    }

    const host = shadow.host;
    const ownerDocument = host.ownerDocument;
    const view = ownerDocument.defaultView;
    const indicator = shadow.querySelector('.draggable');
    const panel = shadow.querySelector('#controls');
    host.classList.add('vsc-touch-open');
    indicator.setAttribute('aria-expanded', 'true');

    // Clamp the panel when a narrow player is near the edge of a zoomed viewport.
    // Layout reads happen only while opening/resizing an expanded panel.
    const positionPanel = () => {
      panel.style.removeProperty('transform');
      const viewport = view.visualViewport;
      const width = viewport?.width || view.innerWidth;
      const height = viewport?.height || view.innerHeight;
      panel.style.maxWidth = `${Math.max(44, width - 16)}px`;
      panel.style.maxHeight = `${Math.max(44, height - 16)}px`;
      panel.style.setProperty('--vsc-touch-columns', width < 240 ? '2' : '4');
      const left = (viewport?.offsetLeft || 0) + 8;
      const right = left + width - 16;
      const bottom = (viewport?.offsetTop || 0) + height - 8;
      const rect = panel.getBoundingClientRect();
      const shiftX = Math.max(left - rect.left, Math.min(0, right - rect.right));
      const shiftY = Math.max(
        (viewport?.offsetTop || 0) + 8 - rect.top,
        Math.min(0, bottom - rect.bottom)
      );
      panel.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
    };
    this.positionTouchPanel = positionPanel;
    const onOutside = (event) => {
      if (!event.composedPath().includes(host)) {
        this.setTouchExpanded(shadow, false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.setTouchExpanded(shadow, false, true);
      }
    };
    const onPageHide = () => this.setTouchExpanded(shadow, false);
    ownerDocument.addEventListener('pointerdown', onOutside, true);
    shadow.addEventListener('keydown', onKey);
    view.addEventListener('resize', positionPanel);
    view.addEventListener('pagehide', onPageHide);
    view.visualViewport?.addEventListener('resize', positionPanel);
    view.visualViewport?.addEventListener('scroll', positionPanel);
    this.closeTouchControls = () => {
      host.classList.remove('vsc-touch-open');
      indicator.setAttribute('aria-expanded', 'false');
      ownerDocument.removeEventListener('pointerdown', onOutside, true);
      shadow.removeEventListener('keydown', onKey);
      view.removeEventListener('resize', positionPanel);
      view.removeEventListener('pagehide', onPageHide);
      view.visualViewport?.removeEventListener('resize', positionPanel);
      view.visualViewport?.removeEventListener('scroll', positionPanel);
      panel.style.removeProperty('transform');
      panel.style.removeProperty('max-width');
      panel.style.removeProperty('max-height');
      panel.style.removeProperty('--vsc-touch-columns');
      this.positionTouchPanel = null;
      this.closeTouchControls = null;
    };
    positionPanel();
  }

  cleanup() {
    this.closeTouchControls?.();
    for (const cleanup of this.cleanupHandlers) {
      cleanup();
    }
    this.cleanupHandlers = [];
  }

  /**
   * Set up drag and double-click-to-reset handlers for speed indicator
   * Uses pointer events for unified mouse + touch support
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupDragHandler(shadow) {
    const draggable = shadow.querySelector('.draggable');

    // Pointer-based drag (unified mouse + touch)
    draggable.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') {
          this.setTouchMode(shadow, true);
        }
        if (this.touchMode) {
          e.stopPropagation();
          return;
        }
        this.actionHandler.runAction(e.target.dataset['action'], false, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );

    // Double-click / double-tap to reset speed
    draggable.addEventListener(
      'dblclick',
      (e) => {
        if (this.touchMode) {
          return;
        }
        const resetTarget = this.config.getKeyBinding('reset') || 1.0;
        this.actionHandler.runAction('reset', resetTarget, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );

    draggable.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
          return;
        }

        if (this.touchMode) {
          this.setTouchExpanded(shadow, !shadow.host.classList.contains('vsc-touch-open'));
          e.stopPropagation();
          e.preventDefault();
          return;
        }

        const resetTarget = this.config.getKeyBinding('reset') || 1.0;
        this.actionHandler.runAction('reset', resetTarget, e);
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  }

  /**
   * Set up button click handlers
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupButtonHandlers(shadow, video = this.video) {
    const frameButtons = shadow.querySelectorAll('.frame-step');
    const updateFrameButtons = () => {
      const disabled = !ControlsManager.canStepFrame(video);
      for (const button of frameButtons) {
        if (button.disabled !== disabled) {
          button.disabled = disabled;
        }
      }
      const pause = shadow.querySelector('[data-action="pause"]');
      if (pause && window.VSC.GifPlayback?.get(video)) {
        const label = video.paused ? 'Play animation' : 'Pause animation';
        pause.textContent = video.paused ? '▶' : 'Ⅱ';
        pause.setAttribute('aria-label', label);
        pause.setAttribute('title', label);
      }
    };
    updateFrameButtons();
    if (video) {
      for (const type of [
        'play',
        'playing',
        'pause',
        'ended',
        'emptied',
        'loadstart',
        'loadedmetadata',
        'durationchange',
        'progress',
      ]) {
        video.addEventListener(type, updateFrameButtons);
        this.cleanupHandlers.push(() => video.removeEventListener(type, updateFrameButtons));
      }
    }
    shadow.querySelectorAll('button').forEach((button) => {
      // Click handler
      const click = (e) => {
        const action = button.dataset.action;
        if (button.classList.contains('frame-step') && !ControlsManager.canStepFrame(video)) {
          updateFrameButtons();
          e.stopPropagation();
          return;
        }
        if (action === 'close') {
          this.setTouchExpanded(shadow, false, true);
          e.stopPropagation();
          return;
        }
        const absoluteSpeed = action === 'setSpeed' || action === 'preferredSpeed';
        const value =
          action === 'preferredSpeed'
            ? this.config.getKeyBinding('fast') || 1
            : action === 'setSpeed'
              ? Number(button.dataset.value)
              : this.config.getKeyBinding(action);
        this.actionHandler.runAction(absoluteSpeed ? 'SET_SPEED' : action, value, e);
        e.stopPropagation();
      };
      button.addEventListener('click', click, true);

      // Touch handler to prevent conflicts
      const touch = (e) => e.stopPropagation();
      button.addEventListener('touchstart', touch, true);
      if (button.classList.contains('frame-step')) {
        this.cleanupHandlers.push(() => {
          button.removeEventListener('click', click, true);
          button.removeEventListener('touchstart', touch, true);
        });
      }
    });
  }

  /**
   * Set up mouse wheel handler for speed control with touchpad filtering
   *
   * Cross-browser wheel event behavior:
   * - Chrome/Edge: ALL devices use DOM_DELTA_PIXEL (mouse wheels ~100px, touchpads ~1-15px)
   * - Firefox: Mouse wheels use DOM_DELTA_LINE, touchpads use DOM_DELTA_PIXEL
   *
   * Detection strategy: Use magnitude threshold in DOM_DELTA_PIXEL mode to distinguish
   * mouse wheels (±100px typical) from touchpads (±1-15px typical). Threshold of 50px
   * provides safety margin based on empirical browser testing.
   *
   * @param {ShadowRoot} shadow - Shadow root
   * @param {HTMLVideoElement} video - Video element
   * @private
   */
  setupWheelHandler(shadow, video) {
    const controller = shadow.querySelector('#controller');

    // Hover dwell gate: only allow wheel events after the cursor has rested on the
    // controller for HOVER_DWELL_MS. This prevents accidental speed changes when
    // scrolling through feed-based sites (Twitter, Reddit) where the cursor briefly
    // passes over the controller. See #1352.
    const HOVER_DWELL_MS = 300;
    let hoverStart = 0;

    controller.addEventListener('mouseenter', (e) => {
      hoverStart = e.timeStamp;
    });

    controller.addEventListener('mouseleave', () => {
      hoverStart = 0;
    });

    controller.addEventListener(
      'wheel',
      (event) => {
        // Reject wheel events before hover dwell threshold is met
        if (event.timeStamp - hoverStart < HOVER_DWELL_MS) {
          window.VSC.logger.debug('Wheel ignored: hover dwell threshold not met');
          return;
        }

        // Detect and filter touchpad events to prevent interference during page scrolling
        if (event.deltaMode === event.DOM_DELTA_PIXEL) {
          // Chrome/Edge: Use magnitude to distinguish mouse wheel (>50px) from touchpad (<50px)
          const TOUCHPAD_THRESHOLD = 50;
          if (Math.abs(event.deltaY) < TOUCHPAD_THRESHOLD) {
            window.VSC.logger.debug(
              `Touchpad scroll detected (deltaY: ${event.deltaY}) - ignoring`
            );
            return;
          }
        }
        // Firefox: DOM_DELTA_LINE events are typically legitimate mouse wheels, allow them

        event.preventDefault();

        const delta = Math.sign(event.deltaY);
        const step = 0.1;
        const speedDelta = delta < 0 ? step : -step;

        this.actionHandler.adjustSpeed(video, speedDelta, { relative: true });

        window.VSC.logger.debug(
          `Wheel control: adjusting speed by ${speedDelta} (deltaMode: ${event.deltaMode}, deltaY: ${event.deltaY})`
        );
      },
      { passive: false }
    );
  }

  /**
   * Set up click prevention for controller container
   * @param {ShadowRoot} shadow - Shadow root
   * @private
   */
  setupClickPrevention(shadow) {
    const controller = shadow.querySelector('#controller');

    // Prevent clicks from bubbling up to page
    controller.addEventListener('click', (e) => e.stopPropagation(), false);
    controller.addEventListener('mousedown', (e) => e.stopPropagation(), false);
  }
}

// Create singleton instance
window.VSC.ControlsManager = ControlsManager;

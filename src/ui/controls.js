/**
 * Control button interactions and event handling
 */

window.VSC = window.VSC || {};

class ControlsManager {
  static inlineScrollGroups = new WeakMap();

  static canStepFrame(video) {
    try {
      if (
        video?.tagName !== 'VIDEO' ||
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
    this.inlineIOS = false;
    this.inlinePlayer = null;
    this.inlineHideTimer = null;
    this.inlineTimerView = null;
    this.inlinePointerActivity = false;
    this.video = null;
    this.inlineIntersectionSupported = false;
    this.inlineIntersects = null;
  }

  /**
   * Set up control button event listeners
   * @param {ShadowRoot} shadow - Shadow root containing controls
   * @param {HTMLVideoElement} video - Associated video element
   */
  setupControlEvents(shadow, video) {
    this.video = video;
    try {
      this.inlineIOS = Boolean(window.VSC.IOSPlayer?.isSupported(video));
    } catch {
      this.inlineIOS = false;
    }
    shadow.host.toggleAttribute('data-vsc-ios-inline', this.inlineIOS);
    this.setupTouchControls(shadow, video);
    if (this.inlineIOS) {
      this.setupInlineControls(shadow, video);
    }
    this.setupDragHandler(shadow);
    this.setupButtonHandlers(shadow, video);
    this.setupWheelHandler(shadow, video);
    this.setupClickPrevention(shadow);
  }

  /** Touch controls use explicit state, rather than Safari's sticky hover. */
  setupTouchControls(shadow, video) {
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

    if (this.inlineIOS && !this.touchMode) {
      this.setTouchMode(shadow, true);
    }

    indicator.addEventListener('click', (event) => {
      if (this.touchMode) {
        event.stopPropagation();
        this.setTouchExpanded(shadow, !shadow.host.classList.contains('vsc-touch-open'));
      }
    });

    // Native video presentation cannot contain page DOM. Leave the site's
    // presentation choice intact and restore the pill when it returns inline.
    const onPresentationChange = () => {
      let nativePresentation = false;
      try {
        nativePresentation =
          video.webkitDisplayingFullscreen === true ||
          ['fullscreen', 'picture-in-picture'].includes(video.webkitPresentationMode);
      } catch {
        // Page-defined media accessors must not interrupt controls.
      }
      shadow.host.classList.toggle('vsc-native-presentation', nativePresentation);
      this.setTouchExpanded(shadow, false);
    };
    const onBeginFullscreen = () => {
      shadow.host.classList.add('vsc-native-presentation');
      this.setTouchExpanded(shadow, false);
    };
    const onEndFullscreen = () => {
      shadow.host.classList.remove('vsc-native-presentation');
    };
    for (const [type, listener] of [
      ['webkitpresentationmodechanged', onPresentationChange],
      ['webkitbeginfullscreen', onBeginFullscreen],
      ['webkitendfullscreen', onEndFullscreen],
      ['enterpictureinpicture', onBeginFullscreen],
      ['leavepictureinpicture', onEndFullscreen],
    ]) {
      video.addEventListener(type, listener);
      this.cleanupHandlers.push(() => video.removeEventListener(type, listener));
    }
  }

  /** Keep the primary pair inside its own media without polling page layout. */
  setupInlineControls(shadow, video) {
    const host = shadow.host;
    const view = host.ownerDocument.defaultView;
    this.inlineTimerView = view;
    if (window.VSC.IOSInlinePlayer) {
      this.inlinePlayer = new window.VSC.IOSInlinePlayer(this, shadow, video);
    }
    const position = () => {
      this.positionInlineControls(shadow, video);
      this.positionTouchPanel?.();
    };
    const onPlayback = () => {
      host.classList.toggle('vsc-inline-playing', !video.paused && !video.ended);
      this.scheduleInlineCollapse(shadow);
    };
    const onPointer = (event) => {
      if (event.type === 'pointerdown') {
        this.inlinePointerActivity = event.pointerType === 'touch';
      } else if (event.detail === 0) {
        return;
      }
      this.scheduleInlineCollapse(shadow);
    };
    const onKey = () => {
      this.inlinePointerActivity = false;
      this.clearInlineCollapse();
    };
    const stopTouch = (event) => event.stopPropagation();
    for (const type of ['playing', 'pause', 'ended', 'emptied']) {
      video.addEventListener(type, onPlayback);
      this.cleanupHandlers.push(() => video.removeEventListener(type, onPlayback));
    }
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      shadow.addEventListener(type, stopTouch, { capture: true, passive: true });
      this.cleanupHandlers.push(() => shadow.removeEventListener(type, stopTouch, true));
    }
    shadow.addEventListener('pointerdown', onPointer, true);
    shadow.addEventListener('click', onPointer);
    shadow.addEventListener('keydown', onKey, true);
    view.addEventListener('resize', position);
    this.cleanupHandlers.push(() => {
      shadow.removeEventListener('pointerdown', onPointer, true);
      shadow.removeEventListener('click', onPointer);
      shadow.removeEventListener('keydown', onKey, true);
      view.removeEventListener('resize', position);
    });
    try {
      const observer = new view.ResizeObserver(position);
      observer.observe(video);
      this.cleanupHandlers.push(() => observer.disconnect());
    } catch {
      // Playback/resize events still keep a usable primary surface on older engines.
    }
    try {
      const observer = new view.IntersectionObserver(
        (entries) => {
          if (entries?.length) {
            this.inlineIntersects = entries.some((entry) => entry.isIntersecting);
          }
          position();
        },
        { threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1] }
      );
      observer.observe(video);
      this.inlineIntersectionSupported = true;
      this.cleanupHandlers.push(() => observer.disconnect());
    } catch {
      // Readiness and resize still position controls when this API is unavailable.
    }
    this.trackInlineScroll(shadow, position);
    for (const type of ['loadedmetadata', 'canplay']) {
      video.addEventListener(type, position);
      this.cleanupHandlers.push(() => video.removeEventListener(type, position));
    }
    position();
    onPlayback();
  }

  /** One frame per scrolling window, with layout work only for visible players. */
  trackInlineScroll(shadow, position) {
    const doc = shadow.host.ownerDocument;
    const view = doc.defaultView;
    let group = ControlsManager.inlineScrollGroups.get(view);
    if (!group) {
      group = { entries: new Set(), frame: null, viewport: view.visualViewport };
      group.queue = () => {
        if (group.frame !== null) {
          return;
        }
        const refresh = () => {
          group.frame = null;
          for (const entry of Array.from(group.entries)) {
            const manager = entry.manager;
            if (
              !group.entries.has(entry) ||
              !entry.host.isConnected ||
              entry.host.ownerDocument !== entry.doc ||
              manager.video?.ownerDocument !== entry.doc ||
              (manager.inlineIntersectionSupported && manager.inlineIntersects === false)
            ) {
              continue;
            }
            try {
              entry.position();
            } catch {
              // One page-owned layout API must not strand the other players.
            }
          }
        };
        try {
          group.frame = view.requestAnimationFrame(refresh);
        } catch {
          group.frame = null;
        }
      };
      try {
        view.addEventListener('scroll', group.queue, { capture: true, passive: true });
        group.viewport?.addEventListener('scroll', group.queue, { passive: true });
      } catch {
        view.removeEventListener('scroll', group.queue, true);
        group.viewport?.removeEventListener('scroll', group.queue);
        if (group.frame !== null) {
          view.cancelAnimationFrame(group.frame);
        }
        return;
      }
      ControlsManager.inlineScrollGroups.set(view, group);
    }
    const entry = { manager: this, host: shadow.host, doc, position };
    group.entries.add(entry);
    this.cleanupHandlers.push(() => {
      group.entries.delete(entry);
      if (!group.entries.size) {
        view.removeEventListener('scroll', group.queue, true);
        group.viewport?.removeEventListener('scroll', group.queue);
        if (group.frame !== null) {
          view.cancelAnimationFrame(group.frame);
          group.frame = null;
        }
        ControlsManager.inlineScrollGroups.delete(view);
      }
    });
  }

  positionInlineControls(shadow, video) {
    // Detached geometry is zero, so using it would double the media offset
    // after insertion and temporarily enlarge a virtualized feed's scroll range.
    if (!shadow.host.isConnected) {
      return;
    }
    const controller = shadow.querySelector('#controller');
    const view = shadow.host.ownerDocument.defaultView;
    const media = this.getInlineMediaBounds(video);
    try {
      video.vsc?.iosPlayer?.setInlineAvailability?.(media.width >= 52 && media.height >= 52);
    } catch {
      // A disappearing site player cannot strand the other inline controls.
    }
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || view.innerWidth);
    const bottom = top + (viewport?.height || view.innerHeight);
    const visibleWidth = Math.min(media.right, right) - Math.max(media.left, left);
    const visibleHeight = Math.min(media.bottom, bottom) - Math.max(media.top, top);
    const visible = visibleWidth > 0 && visibleHeight > 0;
    const availableWidth = visible ? visibleWidth : media.width;
    const availableHeight = visible ? visibleHeight : media.height;
    const unavailable = availableWidth < 52 || availableHeight < 52;
    shadow.host.toggleAttribute('data-vsc-inline-unavailable', unavailable);
    shadow.host.toggleAttribute(
      'data-vsc-inline-tiny',
      availableWidth < 180 || availableHeight < 96
    );
    this.inlinePlayer?.position({
      bounds: media,
      clipped: {
        left: Math.max(media.left, left),
        top: Math.max(media.top, top),
        right: Math.min(media.right, right),
        bottom: Math.min(media.bottom, bottom),
      },
      width: availableWidth,
      height: availableHeight,
      visible,
      unavailable,
    });
    if (unavailable) {
      this.setTouchExpanded(shadow, false);
      return;
    }
    controller.style.removeProperty('transform');
    const rect = controller.getBoundingClientRect();
    const anchor = (start, end, viewportStart, viewportEnd, size) => {
      const low = Math.max(start, viewportStart) + 4;
      const high = Math.min(end, viewportEnd) - size - 4;
      return visible && high >= low ? low : start + 4;
    };
    const placement = {
      x: anchor(media.left, media.right, left, right, rect.width),
      y: this.inlinePlayer?.owned
        ? media.top + 4
        : anchor(media.top, media.bottom, top, bottom, rect.height),
      width: rect.width,
      height: rect.height,
      right: Math.min(media.right, right) - 4,
      bottom: Math.min(media.bottom, bottom) - 4,
    };
    const anchoredY = placement.y;
    if (visible && placement.y >= top) {
      this.avoidInlineOcclusion(shadow, video, placement);
    }
    if (this.inlinePlayer?.owned) {
      // Keep transport attached to the picture as its top scrolls away. A
      // header may hide that strip, but must not push it down across the video.
      const hidden =
        anchoredY < top || anchoredY + rect.height > bottom || placement.y !== anchoredY;
      placement.y = anchoredY;
      shadow.host.toggleAttribute('data-vsc-inline-strip-hidden', hidden);
      if (hidden) {
        this.setTouchExpanded(shadow, false);
      }
    } else {
      shadow.host.removeAttribute('data-vsc-inline-strip-hidden');
    }
    const scale = this.inlinePlayer?.owned ? this.inlinePlayer.scale : null;
    controller.style.transform = `translate(${(placement.x - rect.left) / (scale?.x || 1)}px, ${(placement.y - rect.top) / (scale?.y || 1)}px)`;
    if (this.inlinePlayer?.owned) {
      // The transport stays compact at the top. Its independently positioned
      // seek target follows the visible video's bottom, including clipped feeds
      // and transformed ancestors, without a full-video controller hit box.
      const railLeft = (visible ? Math.max(media.left, left) : media.left) + 4;
      const railBottom = (visible ? Math.min(media.bottom, bottom) : media.bottom) - 4;
      const railWidth = Math.max(44, (visible ? visibleWidth : media.width) - 8);
      for (const [property, value] of [
        ['--vsc-inline-timeline-left', `${(railLeft - placement.x) / (scale?.x || 1)}px`],
        ['--vsc-inline-timeline-top', `${(railBottom - 44 - placement.y) / (scale?.y || 1)}px`],
        ['--vsc-inline-timeline-width', `${railWidth / (scale?.x || 1)}px`],
      ]) {
        if (controller.style.getPropertyValue(property) !== value) {
          controller.style.setProperty(property, value);
        }
      }
    }
    const player = video.vsc?.iosPlayer;
    if (player) {
      const button = shadow.querySelector('.inline-fullscreen');
      button.disabled = player.disposed || !video.isConnected;
      button.title = 'Open StayFast fullscreen player';
    }
  }

  /** A fixed site header can cover a geometrically valid corner of the video. */
  avoidInlineOcclusion(shadow, video, placement) {
    try {
      const doc = video.ownerDocument;
      const player =
        video.closest('[data-testid="videoPlayer"], .html5-video-player, .video-js, .plyr') ||
        video.parentElement;
      for (let attempt = 0; attempt < 3; attempt++) {
        const hit = doc
          .elementsFromPoint(placement.x + placement.width / 2, placement.y + placement.height / 2)
          .find((node) => node !== shadow.host && !node.closest?.('vsc-controller'));
        if (!hit || hit === video || player?.contains(hit) || hit.contains(video)) {
          break;
        }
        const cover = hit.getBoundingClientRect();
        if (cover.bottom + 4 + placement.height <= placement.bottom) {
          placement.y = Math.max(placement.y, cover.bottom + 4);
        } else if (cover.right + 4 + placement.width <= placement.right) {
          placement.x = Math.max(placement.x, cover.right + 4);
        } else {
          break; // A modal owns the viewport; never move outside the video to evade it.
        }
      }
    } catch {
      // Hit testing is optional; cropped-media bounds remain the safe fallback.
    }
  }

  /** Fit the painted player, including a site's cropped-video wrapper. */
  getInlineMediaBounds(video) {
    const rect = video.getBoundingClientRect();
    const bounds = {
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    };
    const doc = video.ownerDocument;
    let ancestor = video.parentElement || video.getRootNode()?.host;
    for (let depth = 0; ancestor && depth < 24; depth++) {
      if (ancestor === doc.body || ancestor === doc.documentElement) {
        break;
      }
      try {
        const style = doc.defaultView.getComputedStyle(ancestor);
        const x = style.overflowX || style.overflow;
        const y = style.overflowY || style.overflow;
        // Scrolling viewports move independently; retain the media's own anchor.
        if (/^(auto|scroll|overlay)$/.test(x) || /^(auto|scroll|overlay)$/.test(y)) {
          break;
        }
        if (/^(hidden|clip)$/.test(x) || /^(hidden|clip)$/.test(y)) {
          const clip = ancestor.getBoundingClientRect();
          const scaleX = ancestor.offsetWidth > 0 ? clip.width / ancestor.offsetWidth : 1;
          const scaleY = ancestor.offsetHeight > 0 ? clip.height / ancestor.offsetHeight : 1;
          const left = clip.left + ancestor.clientLeft * scaleX;
          const top = clip.top + ancestor.clientTop * scaleY;
          if (/^(hidden|clip)$/.test(x) && clip.width > 0) {
            bounds.left = Math.max(bounds.left, left);
            bounds.right = Math.min(
              bounds.right,
              left + (ancestor.clientWidth > 0 ? ancestor.clientWidth * scaleX : clip.width)
            );
          }
          if (/^(hidden|clip)$/.test(y) && clip.height > 0) {
            bounds.top = Math.max(bounds.top, top);
            bounds.bottom = Math.min(
              bounds.bottom,
              top + (ancestor.clientHeight > 0 ? ancestor.clientHeight * scaleY : clip.height)
            );
          }
        }
      } catch {
        break;
      }
      ancestor = ancestor.parentElement || ancestor.getRootNode()?.host;
    }
    bounds.width = Math.max(0, bounds.right - bounds.left);
    bounds.height = Math.max(0, bounds.bottom - bounds.top);
    return bounds;
  }

  clearInlineCollapse() {
    if (this.inlineHideTimer !== null) {
      this.inlineTimerView?.clearTimeout(this.inlineHideTimer);
      this.inlineHideTimer = null;
    }
  }

  scheduleInlineCollapse(shadow) {
    this.clearInlineCollapse();
    if (this.inlinePlayer?.owned) {
      this.inlinePlayer.scheduleIdleHide();
      return;
    }
    if (
      !this.inlineIOS ||
      !this.inlinePointerActivity ||
      this.video.paused ||
      !shadow.host.classList.contains('vsc-touch-open')
    ) {
      return;
    }
    this.inlineHideTimer = this.inlineTimerView.setTimeout(() => {
      this.inlineHideTimer = null;
      if (!this.video.paused && this.inlinePointerActivity) {
        const focused = shadow.activeElement;
        if (focused && shadow.querySelector('#controls').contains(focused)) {
          focused.blur();
        }
        this.setTouchExpanded(shadow, false);
      }
    }, 4000);
  }

  setTouchMode(shadow, enabled) {
    enabled = enabled || this.inlineIOS;
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
      if (this.inlineIOS) {
        this.positionInlinePanel(shadow);
        return;
      }
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
    if (this.inlineIOS) {
      panel.setAttribute('popover', 'manual');
      try {
        panel.showPopover?.();
      } catch {
        // Fixed placement remains available if a site/platform refuses top-layer UI.
      }
    }
    const onOutside = (event) => {
      if (!event.composedPath().includes(host)) {
        if (this.inlinePlayer?.owned && this.inlinePlayer.isPictureInteraction(event)) {
          return; // The picture click dismisses the menu without hiding the transport.
        }
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
      this.clearInlineCollapse();
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
      if (this.inlineIOS) {
        try {
          panel.hidePopover?.();
        } catch {
          /* The browser may already dismiss it. */
        }
        for (const property of ['width', 'left', 'top']) {
          panel.style.removeProperty(property);
        }
        panel.removeAttribute('popover');
      }
      this.positionTouchPanel = null;
      this.closeTouchControls = null;
      this.inlinePlayer?.scheduleIdleHide();
    };
    positionPanel();
    this.scheduleInlineCollapse(shadow);
  }

  positionInlinePanel(shadow) {
    const panel = shadow.querySelector('#controls');
    const view = shadow.host.ownerDocument.defaultView;
    const viewport = view.visualViewport;
    const viewportLeft = (viewport?.offsetLeft || 0) + 8;
    const viewportTop = (viewport?.offsetTop || 0) + 8;
    const width = Math.max(44, (viewport?.width || view.innerWidth) - 16);
    const height = Math.max(44, (viewport?.height || view.innerHeight) - 16);
    const media = this.getInlineMediaBounds(this.video);
    const fontSize = Number.parseFloat(view.getComputedStyle(panel).fontSize) || 14;
    const readableFloor = Math.max(176, Math.min(280, fontSize * 8 + 24));
    const panelWidth = Math.min(width, Math.max(readableFloor, Math.min(280, media.width - 8)));
    panel.style.width = `${panelWidth}px`;
    panel.style.maxWidth = `${width}px`;
    panel.style.maxHeight = `${height}px`;
    const cellWidth = Math.max(44, Math.ceil(fontSize * 3 + 14));
    const columns = Math.max(1, Math.min(4, Math.floor((panelWidth - 14) / (cellWidth + 4))));
    panel.style.setProperty('--vsc-touch-columns', String(columns));
    panel.style.left = '0px';
    panel.style.top = '0px';
    const rect = panel.getBoundingClientRect();
    const left = Math.max(
      viewportLeft,
      Math.min(media.left + 4, viewportLeft + width - rect.width)
    );
    const primary = shadow.querySelector('#controller').getBoundingClientRect();
    const below = primary.top + primary.height + 6;
    const above = primary.top - rect.height - 6;
    const top =
      below + rect.height <= viewportTop + height
        ? below
        : above >= viewportTop
          ? above
          : Math.max(viewportTop, Math.min(below, viewportTop + height - rect.height));
    panel.style.left = `${left - rect.left}px`;
    panel.style.top = `${top - rect.top}px`;
  }

  cleanup() {
    this.inlinePlayer?.cleanup();
    this.inlinePlayer = null;
    this.clearInlineCollapse();
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
      if (button.dataset.inlineAction) {
        return; // The owned inline transport owns its media-local actions.
      }
      // Click handler
      const click = (e) => {
        const action = button.dataset.action;
        if (button.classList.contains('frame-step') && !ControlsManager.canStepFrame(video)) {
          updateFrameButtons();
          e.stopPropagation();
          return;
        }
        if (action === 'ownedFullscreen') {
          this.setTouchExpanded(shadow, false);
          try {
            const player = video?.vsc?.iosPlayer;
            player?.open({ fullscreen: true });
          } catch {
            /* A site can replace media or presentation APIs. */
          }
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
   * - Chrome/Safari/Edge: ALL devices use DOM_DELTA_PIXEL (mouse wheels ~100px, touchpads ~1-15px)
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
          // Chrome/Safari/Edge: Use magnitude to distinguish mouse wheel (>50px) from touchpad (<50px)
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

/**
 * Site handler factory and manager
 */

window.VSC = window.VSC || {};

class SiteHandlerManager {
  constructor() {
    this.currentHandler = null;
    this.availableHandlers = [
      window.VSC.NetflixHandler,
      window.VSC.YouTubeHandler,
      window.VSC.FacebookHandler,
      window.VSC.AmazonHandler,
      window.VSC.AppleHandler,
      window.VSC.DailymotionHandler,
      window.VSC.FrameHandler,
    ];
  }

  /**
   * Get the appropriate handler for the current site
   * @returns {BaseSiteHandler} Site handler instance
   */
  getCurrentHandler() {
    if (!this.currentHandler) {
      this.currentHandler = this.detectHandler();
    }
    return this.currentHandler;
  }

  /**
   * Detect which handler to use for the current site
   * @returns {BaseSiteHandler} Site handler instance
   * @private
   */
  detectHandler() {
    for (const HandlerClass of this.availableHandlers) {
      if (HandlerClass.matches()) {
        window.VSC.logger.info(`Using ${HandlerClass.name} for ${location.hostname}`);
        return new HandlerClass();
      }
    }

    window.VSC.logger.debug(`Using BaseSiteHandler for ${location.hostname}`);
    return new window.VSC.BaseSiteHandler();
  }

  /**
   * Initialize the current site handler
   * @param {Document} document - Document object
   */
  initialize(document) {
    const handler = this.getCurrentHandler();
    handler.initialize(document);
  }

  /**
   * Get controller positioning for current site
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, video) {
    const handler = this.getCurrentHandler();
    return handler.getControllerPosition(parent, video);
  }

  /**
   * Handle speed change for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   */
  handleSpeedChange(video, speed) {
    const handler = this.getCurrentHandler();
    handler.handleSpeedChange(video, speed);
  }

  /**
   * Handle seeking for current site
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled
   */
  handleSeek(video, seekSeconds) {
    const handler = this.getCurrentHandler();
    return handler.handleSeek(video, seekSeconds);
  }

  /**
   * Check if a video should be ignored
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(video) {
    const handler = this.getCurrentHandler();
    if (handler.shouldIgnoreVideo(video)) {
      return true;
    }

    // Muted loops can be either decorative animations or real clips with custom
    // transport. Nearby playback controls distinguish the latter without a
    // hostname exception or a scan of the entire feed.
    if (
      video.tagName === 'VIDEO' &&
      video.loop &&
      video.muted &&
      !video.controls &&
      !video.vsc?.iosPlayer?.attached &&
      !this.hasCustomPlaybackControls(video)
    ) {
      window.VSC.logger.debug('Video ignored: gif-video pattern (loop + muted + no controls)');
      return true;
    }

    return false;
  }

  isPlaybackControl(node) {
    try {
      if (!node.matches?.('button, [role="button"], input[type="range"], [role="slider"]')) {
        return false;
      }
      let label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
      if (!label) {
        // Read only bounded direct text, never an arbitrary button subtree.
        for (let index = 0; index < Math.min(node.childNodes.length, 8); index++) {
          const child = node.childNodes[index];
          if (child.nodeType === 3) {
            label += child.data.slice(0, 160 - label.length);
          }
          if (label.length >= 160) {
            break;
          }
        }
      }
      const slider = node.matches('input[type="range"], [role="slider"]');
      return (
        slider
          ? /\b(seek|timeline|playback|volume)\b/i
          : /\b(play|pause|mute|unmute|sound|volume|full[ -]?screen)\b/i
      ).test(label.slice(0, 160));
    } catch {
      return false;
    }
  }

  hasCustomPlaybackControls(video) {
    return this.findCustomPlayer(video) === video;
  }

  findCustomPlayer(anchor) {
    try {
      let remaining = 128;
      let scope = anchor.parentElement;
      for (let depth = 0; scope && depth < 4; depth++, scope = scope.parentElement) {
        if (scope === anchor.ownerDocument.body || scope === anchor.ownerDocument.documentElement) {
          break;
        }
        const walker = anchor.ownerDocument.createTreeWalker(scope, 1);
        let node = scope;
        let video = null;
        let playbackControl = false;
        while (node) {
          if (remaining-- <= 0) {
            return null;
          }
          if (node.tagName === 'VIDEO') {
            if (video) {
              return null;
            }
            video = node;
          } else if (/^(AUDIO|IFRAME)$/.test(node.tagName)) {
            return null;
          }
          playbackControl ||= this.isPlaybackControl(node);
          node = walker.nextNode();
        }
        if (video && playbackControl) {
          return video;
        }
      }
    } catch {
      // A page-controlled DOM API cannot prevent the rest of media discovery.
    }
    return null;
  }

  /**
   * Get video container selectors for current site
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    const handler = this.getCurrentHandler();
    return handler.getVideoContainerSelectors();
  }

  /**
   * Detect special videos for current site
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(document) {
    const handler = this.getCurrentHandler();
    return handler.detectSpecialVideos(document);
  }

  /**
   * Cleanup current handler
   */
  cleanup() {
    if (this.currentHandler) {
      this.currentHandler.cleanup();
      this.currentHandler = null;
    }
  }

  /**
   * Force refresh of current handler (useful for SPA navigation)
   */
  refresh() {
    this.cleanup();
    this.currentHandler = null;
  }
}

// Create singleton instance
window.VSC.siteHandlerManager = new SiteHandlerManager();

/**
 * Base class for site-specific handlers
 */

window.VSC = window.VSC || {};

class BaseSiteHandler {
  constructor() {
    this.hostname = location.hostname;
  }

  /**
   * Check if this handler applies to the current site
   * @returns {boolean} True if handler applies
   */
  static matches() {
    return false; // Override in subclasses
  }

  /**
   * Get the site-specific positioning for the controller
   * @param {HTMLElement} parent - Parent element
   * @param {HTMLElement} video - Video element
   * @returns {Object} Positioning information
   */
  getControllerPosition(parent, _video) {
    return {
      insertionPoint: parent,
      insertionMethod: 'firstChild', // 'firstChild', 'beforeParent', 'afterParent'
      targetParent: parent,
    };
  }

  /**
   * Handle site-specific speed change.
   * Called whenever the extension sets playback speed (user action, fight-back, etc.).
   * Override to sync with a site's custom player API.
   * @param {HTMLMediaElement} video - Video element
   * @param {number} speed - Target speed
   */
  handleSpeedChange(video, speed) {
    // Avoid re-entering the media pipeline when accepting an unchanged rate.
    if (video.playbackRate !== speed) {
      video.playbackRate = speed;
    }
  }

  /**
   * Handle site-specific seeking functionality
   * @param {HTMLMediaElement} video - Video element
   * @param {number} seekSeconds - Seconds to seek
   * @returns {boolean} True if handled, false for default behavior
   */
  handleSeek(video, seekSeconds) {
    try {
      const position = video.currentTime;
      const target = position + seekSeconds;
      if (!Number.isFinite(position) || !Number.isFinite(seekSeconds) || !Number.isFinite(target)) {
        return true;
      }
      let start = 0;
      let end = video.duration;
      if (!Number.isFinite(end) || end <= 0) {
        // Live timelines move; use the newest complete native window per input.
        const ranges = video.seekable;
        const index = ranges.length - 1;
        if (index < 0) {
          return true;
        }
        start = ranges.start(index);
        end = ranges.end(index);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
          return true;
        }
      }
      video.currentTime = Math.max(start, Math.min(end, target));
    } catch {
      // A source can lose native timing between the read and the seek write.
      return false;
    }
    return true;
  }

  /**
   * Handle site-specific initialization
   * @param {Document} document - Document object
   */
  initialize(_document) {
    window.VSC.logger.debug(`Initializing ${this.constructor.name} for ${this.hostname}`);
  }

  /**
   * Handle site-specific cleanup
   */
  cleanup() {
    window.VSC.logger.debug(`Cleaning up ${this.constructor.name}`);
  }

  /**
   * Check if video element should be ignored
   * @param {HTMLMediaElement} video - Video element
   * @returns {boolean} True if video should be ignored
   */
  shouldIgnoreVideo(_video) {
    return false;
  }

  /**
   * Get site-specific CSS selectors for video containers
   * @returns {Array<string>} CSS selectors
   */
  getVideoContainerSelectors() {
    return [];
  }

  /**
   * Handle special video detection logic
   * @param {Document} document - Document object
   * @returns {Array<HTMLMediaElement>} Additional videos found
   */
  detectSpecialVideos(_document) {
    return [];
  }
}

// Create singleton instance
window.VSC.BaseSiteHandler = BaseSiteHandler;

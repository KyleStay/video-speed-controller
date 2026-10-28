/**
 * Test module loader - loads all common dependencies for unit tests
 * This avoids the need for long import lists in individual test files
 */

/**
 * Load all core modules required for most tests
 * This mimics the global module loading pattern used in the extension
 */
export async function loadCoreModules() {
  // Core utilities (order matters due to dependencies)
  await import('../../src/utils/constants.js');
  await import('../../src/utils/logger.js');
  await import('../../src/utils/dom-utils.js');
  await import('../../src/utils/event-manager.js');
  await import('../../src/utils/bridge-events.js');
  await import('../../src/utils/video-load-diagnostics.js');

  // Site pattern matching — must come before settings.js (mirrors inject-entry.js).
  // The module self-registers on window.VSC.matchSiteRule.
  await import('../../src/utils/site-pattern.js');

  // Storage and settings
  await import('../../src/core/storage-manager.js');
  await import('../../src/core/settings.js');

  // State management
  await import('../../src/core/state-manager.js');
  await import('../../src/core/gif-decoder.js');
  await import('../../src/core/gif-playback.js');

  // Site handlers
  await import('../../src/site-handlers/base-handler.js');
  await import('../../src/site-handlers/netflix-handler.js');
  await import('../../src/site-handlers/youtube-handler.js');
  await import('../../src/site-handlers/facebook-handler.js');
  await import('../../src/site-handlers/amazon-handler.js');
  await import('../../src/site-handlers/apple-handler.js');
  await import('../../src/site-handlers/dailymotion-handler.js');
  await import('../../src/site-handlers/frame-handler.js');
  await import('../../src/site-handlers/index.js');

  // Core controllers
  await import('../../src/site-handlers/twitter-media-source.js');
  await import('../../src/site-handlers/twitter-player.js');
  await import('../../src/site-handlers/progressive-media-source.js');
  await import('../../src/core/safari-hls-playback.js');
  await import('../../src/core/twitter-mp4-playback.js');
  await import('../../src/core/action-handler.js');
  await import('../../src/core/video-controller.js');

  // UI components
  await import('../../src/ui/ios-inline-player.js');
  await import('../../src/ui/ios-site-controls.js');
  await import('../../src/ui/ios-player-takeover.js');
  await import('../../src/ui/controls.js');
  await import('../../src/ui/drag-handler.js');
  await import('../../src/ui/shadow-dom.js');
  await import('../../src/ui/ios-player-view.js');
  await import('../../src/ui/ios-player-scroll.js');
  await import('../../src/ui/ios-player-frames.js');
  await import('../../src/ui/ios-player-scrubber.js');
  await import('../../src/ui/ios-player-gestures.js');
  await import('../../src/ui/ios-player-fullscreen.js');
  await import('../../src/ui/ios-player.js');
  await import('../../src/ui/vsc-controller-element.js');

  // Observers
  await import('../../src/observers/mutation-observer.js');
  await import('../../src/observers/media-observer.js');
  await import('../../src/observers/gif-observer.js');
  await import('../../src/observers/custom-webm-observer.js');
}

/**
 * Load injection script modules (includes core modules + inject.js)
 */
export async function loadInjectModules() {
  await loadCoreModules();
  await import('../../src/content/inject.js');
}

/**
 * Load minimal modules for lightweight tests
 */
export async function loadMinimalModules() {
  await import('../../src/utils/constants.js');
  await import('../../src/utils/logger.js');
  await import('../../src/core/storage-manager.js');
  await import('../../src/core/settings.js');
}

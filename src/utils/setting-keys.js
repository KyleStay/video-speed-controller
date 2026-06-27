/**
 * Single source of truth for the chrome.storage.sync keys the content script
 * reads. Imported by content-bridge.js (ISOLATED world) so its storage fetch
 * can be bounded to exactly these keys instead of pulling the entire sync store
 * with get(null) on every frame.
 *
 * RELIABILITY CONTRACT: this list MUST cover every key in
 * Constants.DEFAULT_SETTINGS, otherwise a newly-added setting would silently
 * never reach the MAIN world. tests/unit/utils/setting-keys.test.js enforces
 * this — update both together.
 */
export const SYNCED_SETTING_KEYS = [
  'schemaVersion',
  'lastSpeed',
  'enabled',
  'rememberSpeed',
  'exclusiveKeys',
  'audioBoolean',
  'startHidden',
  'controllerOpacity',
  'controllerButtonSize',
  'customCSS',
  'keyBindings',
  'siteRules',
  'blacklist',
  'defaultLogLevel',
  'logLevel',
  // Legacy key (not in DEFAULT_SETTINGS) — fetched so the one-time
  // controllerCSS → customCSS migration can still detect old data.
  'controllerCSS',
];

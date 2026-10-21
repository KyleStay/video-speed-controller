const BROWSERS = Object.freeze(['chrome', 'firefox', 'safari']);
const RELEASE_READY_BROWSERS = Object.freeze(['chrome', 'firefox']);

const BUILD_TARGETS = Object.freeze({
  chrome: 'chrome114',
  firefox: 'firefox140',
  safari: 'safari18.4',
});

function assertBrowser(browser) {
  if (!BROWSERS.includes(browser)) {
    throw new Error(`Unsupported browser "${browser}". Expected one of: ${BROWSERS.join(', ')}`);
  }
}

function clone(value) {
  return structuredClone(value);
}

/**
 * Generate the smallest browser-specific manifest from the shared Chrome MV3
 * source. Content-script declarations are intentionally left untouched: the
 * ISOLATED bridge and MAIN controller must keep their ordering, all-frames
 * behavior, and document_start timing on every platform.
 */
function createBrowserManifest(baseManifest, browser, version) {
  assertBrowser(browser);

  const manifest = clone(baseManifest);
  manifest.version = version;

  if (browser === 'firefox') {
    delete manifest.minimum_chrome_version;
    manifest.background = {
      scripts: ['background.js'],
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'stayfast-video@staytech.co',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    };
  }

  if (browser === 'safari') {
    delete manifest.minimum_chrome_version;
    // App Store validation limits Safari extension descriptions to 112 characters.
    manifest.description =
      'Private video and audio speed controls, custom shortcuts, precise seeking, site rules, and frame stepping.';
    // Safari opens options in its own tab and does not support this key.
    if (manifest.options_ui) {
      delete manifest.options_ui.open_in_tab;
    }
    manifest.background = {
      service_worker: 'background.js',
    };
  }

  return manifest;
}

function getBuildDefines(browser) {
  assertBrowser(browser);
  return { __VSC_BROWSER__: JSON.stringify(browser) };
}

function getBuildTarget(browser) {
  assertBrowser(browser);
  return BUILD_TARGETS[browser];
}

export { BROWSERS, RELEASE_READY_BROWSERS, createBrowserManifest, getBuildTarget, getBuildDefines };

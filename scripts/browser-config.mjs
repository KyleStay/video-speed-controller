const BROWSERS = Object.freeze(['chrome', 'firefox', 'safari']);

const BUILD_TARGETS = Object.freeze({
  chrome: 'chrome114',
  firefox: 'firefox128',
  safari: 'safari18',
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
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    };
  }

  if (browser === 'safari') {
    delete manifest.minimum_chrome_version;
    manifest.background = {
      service_worker: 'background.js',
    };
  }

  return manifest;
}

function getBuildTarget(browser) {
  assertBrowser(browser);
  return BUILD_TARGETS[browser];
}

export { BROWSERS, createBrowserManifest, getBuildTarget };

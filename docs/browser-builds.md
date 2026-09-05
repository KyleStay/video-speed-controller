# Browser builds

The checked-in `manifest.json` is the shared Chrome MV3 source. The build
generates only the small platform differences that are required; content
scripts remain identical so the ISOLATED bridge, MAIN-world controller,
`document_start` timing, and `all_frames` behavior do not drift by browser.

## Commands

| Command                          | Output                                                 |
| -------------------------------- | ------------------------------------------------------ |
| `npm run build`                  | Development Chrome build in `dist/`                    |
| `npm run build:chrome`           | Chrome build in `dist/chrome/`                         |
| `npm run build:firefox`          | Firefox build in `dist/firefox/`                       |
| `npm run build:safari`           | Experimental Safari conversion input in `dist/safari/` |
| `npm run build:browsers`         | Chrome and Firefox development builds                  |
| `npm run build:release:browsers` | Minified Chrome and Firefox builds                     |
| `npm run release:browsers`       | Release-ready Chrome and Firefox ZIPs in `release/`    |

Release-ready browser ZIPs can be recreated from existing builds with
`npm run package:chrome` or `npm run package:firefox`. New per-browser archives
are named `stayfast-video-<browser>-<version>.zip`. The historical
`npm run release` workflow intentionally retains its `videospeed-<version>.zip`
Chrome archive name for compatibility.

## Platform notes

### Chrome

The default `npm run build` path is unchanged. Chrome uses an MV3 service
worker and retains `minimum_chrome_version` from the shared manifest.

### Firefox

Firefox uses an MV3 background event page (`background.scripts`) because it
does not support `background.service_worker`. Firefox 140 is the minimum
because the manifest's `data_collection_permissions` metadata begins there.
The generated manifest includes the extension ID required for MV3 signing and
declares that the extension transmits no data.

The build is an unsigned AMO input. Test it with a current Firefox release and
run Mozilla's current linter before submission; the build does not imply AMO
approval or signing.

### Safari

`dist/safari/` is experimental conversion input only. It is not included in
aggregate builds or release packages and is not an App Store submission
artifact. Safari's converter currently reports the manifest `world` and
`match_about_blank` content-script keys as unsupported, so this output cannot
yet preserve StayFast Video's required ISOLATED-bridge/MAIN-controller
architecture or blank-frame behavior.

Safari must remain experimental until it has a tested MAIN-world bootstrap and
blank-frame strategy. Then convert/import the resources into the native
containing app, configure Apple identifiers and signing in Xcode, and test
MAIN-world execution, cross-origin frames, storage sync, popup/options pages,
and enable/disable lifecycle on every supported macOS and iOS Safari version.
Safari does not support local `file://` playback for this extension.

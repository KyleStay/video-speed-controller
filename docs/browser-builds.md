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
| `npm run build:safari`           | Safari web-extension input in `dist/safari/`           |
| `npm run build:browsers`         | All three development builds                           |
| `npm run build:release:browsers` | Minified builds for all browsers                       |
| `npm run release:browsers`       | Minified builds plus one ZIP per browser in `release/` |

Individual browser ZIPs can be recreated from existing builds with
`npm run package:chrome`, `npm run package:firefox`, or
`npm run package:safari`.

## Platform notes

### Chrome

The default `npm run build` path is unchanged. Chrome uses an MV3 service
worker and retains `minimum_chrome_version` from the shared manifest.

### Firefox

Firefox uses an MV3 background event page (`background.scripts`) because it
does not support `background.service_worker`. Firefox 128 is the minimum
because the extension depends on declarative MAIN-world content scripts. The
generated manifest includes the extension ID required for MV3 signing and
declares that the extension transmits no data.

The build is an unsigned AMO input. Test it with a current Firefox release and
run Mozilla's current linter before submission; the build does not imply AMO
approval or signing.

### Safari

`dist/safari/` and its ZIP contain web-extension resources only. They are input
for Apple's Safari Web Extension Converter or an Xcode Safari Extension App
target; they are not an App Store app, signed product, or submission artifact.

Before distribution, convert/import the resources into the native containing
app, configure Apple identifiers and signing in Xcode, then test MAIN-world
execution, cross-origin frames, file URLs, storage sync, popup/options pages,
and enable/disable lifecycle on each supported macOS and iOS Safari version.

# StayFast Video for Safari

The checked-in Xcode project contains iPhone/iPad and Mac apps and their Safari
Web Extensions. It references the shared extension build at `dist/safari/` rather
than maintaining a second JavaScript copy. The minimum is iOS/iPadOS 18.4 or
macOS 15.4 with Safari 18.4. This preserves MAIN/ISOLATED worlds and blank-frame
injection without a script-tag fallback.

## Build locally

Install npm dependencies and Xcode with the iOS 26.2 SDK or newer (verified
with Xcode 26.3), then run from the repository root. The newer SDK builds the
guarded Safari Settings shortcut; the app still deploys to iOS 18.4+.

```sh
npm run build:safari:ios       # Release resources + ad hoc signed simulator app
npm run build:safari:macos     # Release resources + unsigned Mac app
npm run build:safari:native -- --platform=ios # unsigned physical-device compile
```

Artifacts are in `build/safari/<platform>/Build/Products/`. These commands do not
install apps, change Safari settings, use Apple signing credentials, upload, or publish anything. The simulator app is
ad hoc signed so it can run locally. An
unsigned physical-device build cannot be installed on an iPhone.

To run on your device, run `npm run build:release:safari`, open
`StayFast Video/StayFast Video.xcodeproj`, select the iOS app scheme and your
Apple Development team for both app and extension, then build/run on the device.
Rebuild web resources after JavaScript/CSS changes before building in Xcode. The
CLI native builds always rebuild them and use the version from `package.json`.

Enable the extension in Settings → Apps → Safari → Extensions on iOS, or Safari
Settings → Extensions on Mac, and grant the websites you want. Reload existing
tabs after granting access. Enablement and access are user decisions; the build
scripts do not alter them.

During simulator development, replacing an ad hoc app can reset website access
and leave an old Settings detail view stale. Close Safari and Settings, reopen
the currently installed extension, and recheck enablement and website access
before testing the updated build.

## iOS TestFlight

The signed Release archive and App Store Connect IPA use the existing Apple
team and are kept separately from unsigned local builds. Run:

```sh
npm run testflight:safari -- --build=1         # Signed archive + local IPA export
npm run testflight:safari:upload -- --build=1 # Explicit App Store Connect upload
```

Use a new build number after Apple accepts a build. The upload command requires
a prior local export and records attempts to prevent blind duplicate uploads.
See [the TestFlight release packet](../docs/testflight.md) for the exact artifact
paths, app record values, beta copy, Apple sign-in, and tester steps.

## Compatibility and verification

Apple's converter in Xcode 26.3 still reports `world` and `match_about_blank` as
unsupported. Keep them: Safari supports MAIN/ISOLATED worlds from Safari 18, and
Safari 18.4 added blank-frame matching. `options_ui.open_in_tab` is omitted only
from Safari's manifest. Sources:

- [WebKit manifest parser](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Extensions/WebExtension.cpp)
- [Safari 18.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes)
- [Apple Safari extension packaging](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

A successful compile is not Safari runtime verification. Before distribution,
exercise the real extension on physical iPhone/iPad and Safari: enablement,
permissions, inline media, cross-origin and blank frames, popup aggregation,
mobile controls, navigation, app switching, fullscreen transitions, and PiP.
Use the [Safari acceptance guide](../docs/safari.md). Native fullscreen and PiP are owned
by Safari: an on-page controller cannot render inside those system interfaces.
Playback-rate persistence there depends on Safari and the site/player.

Settings use WebExtension storage in the current Safari installation. Safari's
`storage.sync` does not provide cross-device preference synchronization. The
native wrapper does not collect data or expose a native messaging API.

## Native privacy and artwork

The app and extension bundles include `PrivacyInfo.xcprivacy`: no tracking,
collected data, or required-reason API access. Native code only hosts the bundled
welcome page and presents Safari settings; it has no analytics SDK, persistent
native preferences, or network client. App/extension Info plists declare no
non-exempt encryption. Reassess these declarations when adding native APIs/SDKs.
The iOS 1024px icon is opaque; all native icon sizes render the existing vector
mark. Regenerate them from the root with:

```sh
swift -module-cache-path /tmp/stayfast-native-icon-cache scripts/generate-safari-icons.swift
```

On iOS/iPadOS 26.2 or later the welcome page can open Safari's extension detail
settings through Apple's public `SFSafariSettings` API; older supported systems
show the manual instructions. Website access still requires the person's choice.

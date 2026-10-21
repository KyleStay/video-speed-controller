# Native iPhone Safari regression check

This standalone XCTest harness exercises the installed Safari extension through
native taps. It was verified on the dedicated **StayFast Safari QA** iPhone 17 Pro
simulator running iOS 26.2. It does not establish compatibility with every OS,
physical iPhone/iPad, or live video site.

Use Qorvex as the primary iOS interaction tool when an isolated session is
available. This background-safe XCTest fallback was needed because the installed
Qorvex 0.2.14 agent port was occupied by another simulator. It does not change
global Qorvex configuration, interact with another simulator, activate the macOS
Simulator window, or use desktop mouse/keyboard input.

## Prepare a disposable simulator

Requires Xcode with the iOS 26.2 SDK or newer, XcodeGen, npm dependencies, and an
explicitly chosen disposable simulator. Run from the repository root. Replace the value below with that
simulator's UDID; never use an unrelated simulator or a personal device.

```sh
export STAYFAST_SIMULATOR_UDID="YOUR_DISPOSABLE_SIMULATOR_UDID"
npm run build:safari:ios
xcrun simctl bootstatus "$STAYFAST_SIMULATOR_UDID" -b
```

Before installing a replacement, terminate Safari and Settings on that simulator
if running. Then install once and leave the artifact unchanged during the run:

```sh
xcrun simctl terminate "$STAYFAST_SIMULATOR_UDID" com.apple.mobilesafari
xcrun simctl terminate "$STAYFAST_SIMULATOR_UDID" com.apple.Preferences
xcrun simctl install "$STAYFAST_SIMULATOR_UDID" "build/safari/ios-simulator/Build/Products/Release-iphonesimulator/StayFast Video.app"
mkdir -p build/safari-ios-qa test-results/safari-ios
cp tests/safari-ios/project.yml tests/safari-ios/SafariQATests.swift tests/safari-ios/OwnedPlayerQATests.swift tests/safari-ios/ScrollQATests.swift tests/safari-ios/InlinePlaybackQATests.swift tests/safari-ios/FeedPlaybackQATests.swift tests/safari-ios/LayoutFeedQATests.swift tests/safari-ios/DiagnosticCaptureQATests.swift build/safari-ios-qa/
xcodegen generate --spec build/safari-ios-qa/project.yml
```

`simctl terminate` can report that an app was not running. Ad hoc app replacement
may reset website permission to Ask and leave an already-open Settings detail
page referring to an old, disabled plugin. The activation test restarts Settings,
enumerates the new extension, and verifies its actual switch and Allow selection.

Start the fixture in a separate terminal and retain its reported PID:

```sh
node tests/safari-ios/fixture-server.mjs --port 62938
```

It serves a moving 15-second H.264 Baseline/AAC clip with HTTP byte ranges. DOM
status reports real playback rate, readiness, pause/time state, controller count,
page/media errors, native fullscreen, and initialization. Add `&owned` for original-video
identity/source, ownership, native controls, inline restoration, HUD and select touch-target
diagnostics inside the modal player. Event-driven updates
and one bounded diagnostic timer support native assertions; there is no polling.

The checked-in clip is a synthetic FFmpeg test pattern with silent audio. To
regenerate it (FFmpeg is needed only for this optional step):

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 -t 15 -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -preset veryfast -crf 27 -threads 1 -c:a aac -b:a 48k -movflags +faststart -shortest -y tests/safari-ios/sample.mp4
```

## Activate, open a fresh page, and verify

Use normal ad hoc simulator signing. Run these commands sequentially, waiting for
each test to finish. Result bundle paths must be new for each run.

For a release, first verify the containing app's offline policy, return navigation,
and deliberate Support link opening the system browser:

```sh
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/links.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -only-testing:StayFastSafariQATests/SafariQATests/testContainingAppLinks test
```

Then activate the extension and exercise media:

```sh
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/activation.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -only-testing:StayFastSafariQATests/SafariQATests/testActivation test
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/mobile.html?mp4&owned&native-qa=$(date +%s)"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/owned-runtime.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 360 -maximum-test-execution-time-allowance 420 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/OwnedPlayerQATests/testOwnedPlayerRuntime test
```

The activation phase verifies the containing app, enabled extension, and website
access. The owned runtime first requires ordinary Play to remain inline, then explicitly opens
Custom player from the speed panel. It checks the original decoded video, advancing playback time, one
controller, and zero page/media errors. It checks play/pause, range and 10-second
seeking, distance-based fine scrubbing with genuine near/far finger drags, mute,
fit/fill buttons and pinch, remaining/total time, repeated absolute 1×, default
preferred speed 1.8×, native speed-menu selections through 32× and a custom 64× entry, 44px controls, landscape layout, app switching, Done,
explicit reopen, and More → Use site player. Done restores the original position while
restoring native controls and keeping the explicit Custom player entry available; Use site player restores native controls
and leaves playback in the site player. The flow then verifies native fullscreen
and explicit custom-player reopening after this handback. Use default key bindings for this test;
the preferred-speed assertion deliberately expects the default 1.8× binding.

This runtime verifies browser-viewport expansion. Native fullscreen must remain
false while the owned player is active. It does not establish physical-device,
DRM, live-site, AirPlay receiver, or Picture in Picture acceptance.

WebKit exposes aria-pressed quick actions as accessibility Switches. Its native
HTML select accessibility proxy can be smaller than the DOM touch target; the
test asserts the fixture-reported DOM height. The range uses a genuine tap on its
observed bounds because XCTest's native-slider helper lacks WebKit scrubber
attributes. Kept attachments remain available with verbose system diagnostics
disabled, avoiding lengthy collection after a failed exploratory assertion.

For the primary native-system-fullscreen check, open another fresh
fixture document, then run this mode. It verifies ordinary inline playback,
the compact 44px fullscreen target, native fullscreen and inline return without
opening the custom player:

```sh
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/mobile.html?mp4&owned&native-direct=$(date +%s)"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/native-direct.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/SafariQATests/testRuntime test
```

For scroll restoration, run the same test on three fresh fixture documents after
activation. The test first uses genuine Play/Pause taps to require decoded readiness.
The trusted fixture buttons prepare and remember nonzero document
and nested scroll offsets; assertions never scroll the page. The frame case adds
both parent-document and parent-container offsets. Each mode checks Custom player
→ Done, direct native fullscreen → return, and Custom player → native fullscreen
→ return, including the original video's visible position within two CSS pixels.

```sh
for mode in page nested frame; do
  if [ "$mode" = frame ]; then
    fixture_url="http://127.0.0.1:62938/scroll-frame.html"
    scroll_test=testFramePreservesScroll
  else
    fixture_url="http://127.0.0.1:62938/mobile.html?mp4&owned&scroll=$mode"
    scroll_test=testPreservesScroll
  fi
  xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "$fixture_url"
  xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath "test-results/safari-ios/scroll-$mode.xcresult" -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/ScrollQATests/$scroll_test test
done
```

For sites whose original markup omits both inline-playback attributes, open the
source-level omission fixture and run this focused regression after activation:

```sh
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/mobile.html?mp4&owned&scroll=page&no-playsinline"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/inline-playback.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 240 -maximum-test-execution-time-allowance 300 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/InlinePlaybackQATests/testInlineUntilExplicitFullscreen test
```

It verifies ordinary Play and genuine native-control Play stay inline, decoded
time advances without an owned host, explicit native fullscreen still works,
and native/custom return retains inline flags and the measured scroll position.
Explicit Use site player restores the original absent attributes. The response
omits both attributes before the video is parsed; this is not a script removing
them after attachment.

For synthetic feed timing diagnostics, use `/feed-playback.html` on a fresh document
for each test. `FeedPlaybackQATests/testSynchronousFeedInsertion` starts at page Y720
with an older controlled video, then a genuine button appends a fresh video without
inline attributes, sets its source and calls Play in the same gesture.
`testSourceReuse` removes both flags and changes the source on an already controlled
video before Play. `testBackgroundAutoplayObservation` schedules muted autoplay
outside the immediate gesture; inspect paused/readiness/time before claiming
actual autoplay playback. `testActiveCustomSourceRecycle` replaces the original
video's source while Custom Player is active, then switches apps and returns.

The fixture preserves a bounded event trace with exact before/after Play flags,
controller readiness, native presentation, page scroll and visibility. It does
not stub product APIs. These are localhost synthetic feeds; they do not reproduce
X's hostname-specific recovery path or establish live-X acceptance.

```sh
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/feed-playback.html?case=synchronous"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/feed-synchronous.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/FeedPlaybackQATests/testSynchronousFeedInsertion test
```

For optional native speed capability diagnostics, serve a longer moving clip. This
measures requested/read-back rates, time progress and presented-frame callbacks
separately; it does not promise the same throughput or decoding fidelity on other
media or devices. The fixture keeps this video in a closed shadow root so extension
rate guards cannot influence the platform measurement.

```sh
ffmpeg -stream_loop 19 -i tests/safari-ios/sample.mp4 -t 300 -c copy -movflags +faststart /private/tmp/stayfast-rate-probe-300s.mp4
STAYFAST_RATE_PROBE_MP4=/private/tmp/stayfast-rate-probe-300s.mp4 node tests/safari-ios/fixture-server.mjs --port 62938
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/rate-probe.html"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/native-rates.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 90 -maximum-test-execution-time-allowance 120 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/SafariQATests/testNativeRateProbe test
```

Use one fixture server at a time and stop its exact process before restarting with
another clip. The probe records detached video/audio setter acceptance separately
from playback. Inspect the JSON attachment; successful test completion means the
diagnostic finished, not that every requested rate achieved its target.

Inspect the kept screenshots and hierarchy attachments, including owned portrait/landscape, the restored inline state, and explicit
site-player hand-back:

```sh
xcrun xcresulttool export attachments --path test-results/safari-ios/owned-runtime.xcresult --output-path test-results/safari-ios/attachments
```

An unavailable decode, skipped interaction, missing permission, or automation
failure leaves the corresponding check incomplete. The older shared 1fps High
profile sample is useful for other browser fixtures; use this moving Baseline
sample for the native Safari playback assertions.

Stop the exact fixture PID with SIGTERM (or Ctrl-C in its terminal), verify its
listener exits, and shut down only the chosen simulator after exporting evidence:

```sh
xcrun simctl shutdown "$STAYFAST_SIMULATOR_UDID"
```

The installed app and simulator data remain available for later inspection.

## Transformed-feed geometry diagnostic

`/layout-feed.html` is a synthetic offscreen, transformed flex cell inside a nested
scroller. Its diagnostics stay outside document flow. `LayoutFeedQATests/testTransformedOffscreenInsertion`
genuinely prepares page Y720 and nested X70/Y650, loads the video, and captures
controller geometry at insertion and the first two animation frames. Inspect the
attached JSON for transient overflow, scroll offsets, focus and presentation;
a successful test means the diagnostic completed, not that a live-site jump was reproduced.
For a corrected build, run `LayoutFeedQATests/testTransformedOffscreenStableInsertion`
on a fresh fixture document. It additionally requires insertion and settled
controller top/scroll extent to agree within 1px and verifies the saved page and
nested offsets at every mandatory checkpoint.

`LayoutFeedQATests/testPublicNASAInspection` captures the current public NASA page
after a genuine swipe. Navigate the dedicated simulator to `https://x.com/NASA`
first. Login walls, unavailable media and unready content are diagnostic blockers,
not passing playback checks.

`/responsive-inline.html` exposes genuine fixture buttons for 360×203,180×102,
120×68,80×60,80×45 and a cropped 120×68 wrapper with a larger offset video.
`LayoutFeedQATests/testResponsiveInlineControls` checks independent DOM rectangles:
visible primary controls must be at least 44px and stay inside the visible
video/wrapper intersection. Expected primary target counts are 2,2,1,1,0,1.
It then checks the compact 1/1.8/16/64 labels through genuine fixture rate buttons,
records 64×, and resets to 1×. These fixture buttons test label/layout synchronization;
they are not a substitute for the owned player's custom-speed entry test.

## Diagnostic capture/export acceptance

The diagnostic fixture is `/diagnostic-feed.html`. It is independent of live X:
a genuine Prepare button sets page Y720 and nested X70/Y220; Load and Reuse
exercise an original video's source lifecycle; the explicitly labeled Jump
button intentionally moves both scroll positions to zero. This intentional
fixture action is not a reproduction or attribution of a real site's jump.

Use a frozen diagnostic app built with `STAYFAST_DIAGNOSTICS=1`, verified against
its expected resource hashes. The flag enables automatic X/Twitter capture; manual popup capture remains available without it.
After normal activation and a fresh fixture navigation, run
`DiagnosticCaptureQATests/testDiagnosticCaptureAndExport` through the same native
XCTest command above. It uses the actual Safari Page Menu extension action,
starts capture from the product popup, exercises the fixture, then verifies the
prepared JSON's numeric before/after scroll evidence and original media loads.
It taps Copy report and opens the native Share / save sheet, then cancels without
sending anything. The popup's readonly report remains available for manual copy.

After the genuine Copy action, `xcrun simctl pbpaste "$STAYFAST_SIMULATOR_UDID"`
can independently verify the copied sanitized JSON on this disposable simulator.
Save it as a QA artifact; do not read a personal device's or unrelated simulator's
clipboard. Capture native popup/share accessibility when a selector differs.
The final diagnostic candidate passed this flow in actual iOS 26.2 Safari,
including the native JSON preview and Save to Files activity. The share sheet is
canceled through its observed topmost dismissal region. Cold remote share-sheet
loading is bounded separately from the popup's report preparation.

For automatic-host acceptance, navigate to a fresh public X document and run
`DiagnosticCaptureQATests/testAutomaticPublicXCapture`. It genuinely swipes the
feed, restores Safari's collapsed toolbar through its native Address element,
and opens Stop/report without ever pressing Start. Require a diagnostic-build
(or preserved suspected-top-jump) reason and capture-start evidence. Unsigned
access/promotion UI may limit live media; do not present unavailable playback as
a pass. Manual capture on the local fixture remains separate from this host test.

# Native iPhone Safari regression check

This standalone XCTest harness exercises the installed Safari extension through
native taps. It was verified on the dedicated **StayFast Safari QA** iPhone 17 Pro
simulator running iOS 26.2. It does not establish compatibility with every OS,
physical iPhone/iPad, or live video site.

For timeline reveal, open `/mobile.html?mp4&owned&takeover&precision&reveal-overlay`
and run `InlinePlaybackQATests/testTimelineRevealsWithInterface`. It verifies
that picture taps toggle the buttons and seek rail together while playback
continues, and an open speed menu prevents idle hiding until dismissed. On a fresh `/mobile.html?mp4&owned&takeover&precision`, run
`OwnedPlayerQATests/testInlineBottomPrecisionAndFrames` to verify the precision
bands, blank normal-rate feedback, fractional labels and paused frame controls.

For picture swipes, open
`/mobile.html?mp4&owned&takeover&reveal-overlay&surface-scrub` and run
`OwnedPlayerQATests/testPictureSurfaceScrubbing`. It observes genuine native
pointer paths, checks horizontal inline/fullscreen swipes and fullscreen diagonal
precision, verifies numeric feedback and paused-state preservation, then scrubs a playing
video while its inline interface is hidden and checks resumed playback. The
fixture observer reads state after dispatch and never drives the media. XCTest
provides a single straight drag; Safari may take an inline diagonal-from-start as
page scrolling before DOM input. Inline horizontal-then-vertical precision is
covered by the browser counterpart; its exact native multiphase path remains a
manual device check. Run
`STAYFAST_EXTENSION_DIR=dist/chrome node tests/e2e/run-isolated.js ios-surface`
for the built Chrome fixture counterpart, including real vertical page scrolling.
Omit `takeover` to exercise the same native test through an unknown full-picture
button instead of a recognized player; add `feed-overlay` for a zero-height
tracking wrapper with the cover on the outer picture container. The browser
counterpart also checks an unknown non-button overlay and real vertical scrolling
through it. These local fixtures do not establish live-site or physical-device
compatibility.
For a site-expanded viewer with its touch overlay outside the recognized inner
player, open `/mobile.html?mp4&owned&takeover&theater-overlay&surface-scrub` and run
`OwnedPlayerQATests/testTheaterPictureSurfaceScrubbing`. It opens the site viewer
through a genuine tap, then runs the same inline, fullscreen and resumed-playback
assertions. This is a local structural regression, not live authenticated X proof.

## Synthetic custom-player feed

The [local custom-player fixtures](../e2e/CUSTOM-PLAYER-FIXTURES.md) provide
account-free feed, overlay, metadata, site-viewer, caption and recycled-media
variants using generated local media. `CustomFeedQATests/testCustomFeedControlsAndReturn`
checks genuine inline playback/mute/seek, picture swipes, speed/frame/Lock controls,
two owned fullscreen returns inside the site viewer, feed restoration and the next
clip. Open `/custom-feed.html?mp4` on a freshly activated extension; use
`late-controls` or `recycle` for those variants. The browser matrix also verifies
that no off-origin HTTP request occurs.

## Build 13 takeover acceptance — r4 (historical)

Build 13, now Testing, owns iOS inline controls by default and routes
supported synchronous video/container fullscreen API requests during the active
trusted click/keydown into StayFast, once per event. Test
plain video and recognized single-video YouTube/Video.js/Plyr/JW/X fixtures;
require 44px responsive play/pause, skip, mute, timeline, speed and fullscreen
controls, preserved captions/unknown buttons, and original media/source/DRM state.
Attachment must leave playback, source, parent and scroll unchanged while
replacing native controls. Test readiness/source reuse, nested/frame scrolling,
Done returning inline, explicit Apple bypass, Use site player passthrough, and
cleanup/toggle restoring only StayFast-owned hooks, attributes and chrome.
Loading, playback and API requests without current trusted user input must not
open the owned fullscreen view. A prior click, later task or microtask must not
provide carried authorization. Test synchronous trusted video/container requests plus
missing/throwing/previously patched APIs and newer site patches at cleanup.
Actual clipped media below 52px on either axis must restore native/site controls;
opening owned fullscreen must acquire controls independently of inline fit.

Frozen r4 resources passed native inline/site fullscreen (38.999s), primary
entry (71.567s) and full owned-player acceptance (230.672s) on the dedicated
iPhone 17 Pro/iOS 26.2 simulator. Additional scroll, missing-inline-attribute and
appearance phases are recorded in [the result record](../../test-results/takeover/r4-native-acceptance.json)
and local release ledger; only completed phases count as passed.
Chrome passed owned **43/43**, mobile **11/11**, basic
**22/22**, dynamic-player ambiguity/class recovery and 0.75×/2× target-scaling
checks. Native physical-device double-tap remains unverified; Chrome/units do
not close the simulator touch-delivery gap. A separate genuine YouTube content
playback check passed; the original **11/12** suite and initial ad-gate failure
remain recorded. See [the r4 scope and remaining gates](../../docs/safari.md#build-13-takeover-candidate--r4-verification).
Build 12 results below do not verify takeover.
Chrome/Firefox behavior must remain unchanged. Extension-inaccessible media,
closed shadow trees, private/unsupported embeds, captured APIs and unknown CSS
fullscreen may bypass takeover; asynchronous site routing is not guaranteed.
Apple's protected UI cannot be modified.

## Build 12 source-freeze acceptance — historical

**0.11.4 (12)** is Testing for two existing testers. It changed the primary **Full screen** action
to open StayFast's owned player around the original video. **Custom Player**
remains an explicit alternate entry. The player may request container DOM
fullscreen where supported; iPhone Safari bars may remain. Apple's native video
presentation is a separate **More → Apple player** action, where available.
StayFast cannot change Apple's controls or add controls inside that interface.

The frozen candidate passed native owned-player acceptance (`accept-owned-reveal`),
primary entry, page/nested scroll checks, and the final activation, clean
appearance and containing-app links batch on the dedicated iPhone 17 Pro/iOS 26.2
simulator. Evidence remains under `test-results/owned-fullscreen/`, including
earlier failed runs. The final frame-boundary run passed in 67 seconds, preserving
true pre-entry child/parent offsets within 2 CSS pixels through all three phases,
source identity and zero page/media errors. Missing-`playsinline` passed in 90
seconds; final portrait, Lock and inline screenshots were inspected. Quiet paired
baseline/owned rate runs passed functional validation at all seven rates through
16×, with original media/source/ownership preserved in every owned sample.
Strict cadence still failed baseline 1×/2.5×/3× and owned 1×/2.5×/4×. At 16×,
baseline/owned callback rates were 53.1/53.7Hz, p95 gaps 17/18ms and maximum gaps
131/123ms. Buffered baseline network-stall warnings remain recorded with no
`waiting` events. This is not an all-green smoothness result; see the
[paired measurement and raw reports](../../docs/safari.md#final-paired-rate-measurement).

Native touch double-tap is **unverified**. XCTest delivered one DOM touch pair
even on a plain standalone no-extension control, so invoking its double-tap API
cannot establish the gesture works. Chrome touch pairs and unit tests pass;
physical-device follow-up remains required.

Acceptance must cover primary entry, optional container
fullscreen and exit, edge double-tap ±10-second skips without center seeking or
duplicate `dblclick` seeks, Lock/Unlock, brief feedback, Apple-player handoff and
return, Done, Use site player, source reuse and cleanup. Lock must leave an
accessible 44px Unlock target, cancel queued seeking, suppress feedback and block
playback keys/gestures while preserving keyboard navigation/Unlock. Check that
light-DOM video/container `touch-action` restores at session end. A refused
explicit Apple request may restore the same-source owned viewport without play
or fullscreen; fresh input (including wheel), navigation, source/session changes
and cleanup must cancel this recovery. Native fullscreen events must never open the player.
Require the same
original media/source/tracks, accepted rate through 16×, advancing playback,
stable intentional page/nested scroll positions and zero page/media errors.
Ordinary Play must stay inline without automatically opening a player.

The commands below identify the harnesses and fixtures. Runs predating build 12
used the previous primary-native-fullscreen policy and do not verify its changes.
Record source/build identity, actual assertions and artifacts from each new run;
unavailable or skipped checks remain incomplete. Neither these functional checks
nor numeric rate acceptance establish smooth playback on phones or streams.

Use Qorvex as the primary iOS interaction tool when an isolated session is
available. This background-safe XCTest fallback was needed because the installed
Qorvex 0.2.14 agent port was occupied by another simulator. It does not change
global Qorvex configuration, interact with another simulator, activate the macOS
Simulator window, or use desktop mouse/keyboard input.

## Feed-position regression without a physical device

`FeedPositionQATests/testNearEndFeedPosition` uses the same natural-flow fixture
as the built Chrome `twitter-feed-position` suite. Open
`/feed-position.html?native&margin` and then `?native&margin&nested` in separate
runs. Require decoded/readied media, page or nested position at a nonzero scroll
maximum, two genuine Full screen → Close transitions, the same post/video and
unchanged post/neighbor geometry and offsets within two CSS pixels. Retain the
JSON trace and screenshots from each result bundle. A fixed-height article or a
long empty tail would hide the original margin/clamping regression.

The native harness includes a documented coordinate fallback only when WebKit's
accessibility rectangle for the inline fullscreen button incorrectly extends
far above the visible button in a nested scroller; the visible 44px target is at
that rectangle's bottom. This is background device-level XCTest input, without
macOS desktop clicks. It must still produce the observed before/open/closed
trace and pass all geometry assertions. A successful tap alone is insufficient.

These are controlled Safari simulator checks; live Twitter acceptance remains
separate. Include `FeedPositionQATests.swift` when copying the QA sources below.

## X playback above 2× — current regression fixture

`TwitterPlaybackQATests` uses `/twitter-playback.html` with the public X clip
reported by the user. The installed extension’s resolver, coordinator, rate pipeline and presentation
code run unchanged, including the real iOS matcher. CDN playback requires the fixture's no-referrer policy.
This is a native Safari fixture check, separate from live X or physical-device
acceptance. It checks same-node HLS-to-MP4 switching, 4× decoded progress,
paused playback, owned-player return, saved-speed next clips and stable scroll.
Keep failed runs and inspect page/media errors alongside frame cadence.
`testFastCommandBeforeMetadataSelectsRendition` issues 4× while the clip is still
loading, then requires the supplied same-clip 720p MP4, preserved Play promise,
4× decoded progress and no page/media errors. It covers a speed command that
already matches `playbackRate` when metadata arrives.

For SF-TW-1, open `/twitter-playback.html?accessory-variants` and run
`TwitterPlaybackQATests/testInlineRenditionChange`, then open a fresh fixture and
run `testJustAboveTwoSelectsPlayerRendition`. This reproduces the recorded X
`timeRemainingAccessory.props.media.video_info.variants` beside its 1080p
`downloadUrl`, and requires the supplied 720p rendition at 4× and 2.1× with
presented frames, correct media-time progress and no page/media errors. Do not
replace the download URL with 720p in the fixture: that would bypass the resolver
regression. These controlled checks do not close the affected-post/device report.

`HLSPlayerQATests/testPlayerRenditionSwitch` uses `/hls-players.html?provider=html`,
`provider=videojs` or `provider=jwplayer`. The latter fixtures load real public
publisher SDKs. Brightcove uses its published video and source metadata; JW
uses an explicit same-clip HLS/MP4 playlist supplied by the project fixture.
No metadata resolver or site matcher is mocked. Require a native-HLS baseline,
matching MP4 at 4×, advancing presented frames/media time, stable scroll, same
node, inline presentation and zero page/media errors. A configured SDK fixture
does not imply every publisher offers MP4.

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
cp tests/safari-ios/project.yml tests/safari-ios/CustomFeedQATests.swift tests/safari-ios/SafariQATests.swift tests/safari-ios/OwnedPlayerQATests.swift tests/safari-ios/ScrollQATests.swift tests/safari-ios/FeedPositionQATests.swift tests/safari-ios/InlinePlaybackQATests.swift tests/safari-ios/FeedPlaybackQATests.swift tests/safari-ios/LayoutFeedQATests.swift tests/safari-ios/DiagnosticCaptureQATests.swift tests/safari-ios/TwitterPlaybackQATests.swift tests/safari-ios/HLSPlayerQATests.swift build/safari-ios-qa/
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

Then activate the extension and exercise media. These runners have build 12
history; build 13 assertions must use StayFast's owned inline transport before
claiming takeover acceptance:

```sh
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/activation.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -only-testing:StayFastSafariQATests/SafariQATests/testActivation test
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/mobile.html?mp4&owned&native-qa=$(date +%s)"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/owned-runtime.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 360 -maximum-test-execution-time-allowance 420 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/OwnedPlayerQATests/testOwnedPlayerRuntime test
```

The activation phase verifies the containing app, enabled extension, and website
access. The owned runtime requires ordinary Play to remain inline, then explicitly opens
Custom player from the speed panel. It checks the original decoded video, advancing playback time, one
controller, and zero page/media errors. It checks play/pause, range and 10-second
seeking, distance-based fine scrubbing with genuine near/far finger drags, mute,
fit/fill buttons and pinch, remaining/total time, repeated absolute 1×, default
preferred speed 1.8×, native speed-menu selections through 16×, rejection above 16×, and a custom 12× entry, 44px controls, landscape layout, app switching, Done,
explicit reopen, and More → Use site player. In build 13, Done restores the original
position with owned inline controls and the Custom player entry; Use site player restores native controls
and leaves playback in the site player. The flow then verifies native fullscreen
and explicit custom-player reopening after this handback. Use default key bindings for this test;
the preferred-speed assertion deliberately expects the default 1.8× binding.

This runtime exercises browser-viewport expansion. Apple's native video
presentation must remain off while StayFast owns the player; container DOM
fullscreen may be active where supported. It does not establish physical-device,
DRM, live-site, AirPlay receiver, or Picture in Picture acceptance.

WebKit exposes aria-pressed quick actions as accessibility Switches. Its native
HTML select accessibility proxy can be smaller than the DOM touch target; the
test asserts the fixture-reported DOM height. The range uses a genuine tap on its
observed bounds because XCTest's native-slider helper lacks WebKit scrubber
attributes. Kept attachments remain available with verbose system diagnostics
disabled, avoiding lengthy collection after a failed exploratory assertion.

For the primary-entry harness, open another fresh fixture document, then run
this mode. Build 13 acceptance requires owned inline playback, the responsive
44px Full screen target opening StayFast, and return to the original inline
video. Older results from this harness checked direct Apple fullscreen and must
retain their original labels:

```sh
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/mobile.html?mp4&owned&native-direct=$(date +%s)"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/native-direct.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/SafariQATests/testRuntime test
```

For scroll restoration, run the same test on three fresh fixture documents after
activation. The test first uses genuine Play/Pause taps to require decoded readiness.
The trusted fixture buttons prepare and remember nonzero document
and nested scroll offsets; assertions never scroll the page. The frame case adds
both parent-document and parent-container offsets. Build 13 coverage must check
Full screen → Done, optional container fullscreen → return, and More → Apple
player → return, including the original video's visible position within two CSS
pixels. Historical runs used the previous direct-native entry; rerun matching
updated assertions before claiming coverage of the new policy.

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

Require StayFast inline Play to advance decoded time without a fullscreen-owned
host. Test native-control Play separately after Use site player. Explicit Full screen must open StayFast;
More → Apple player must hand off where supported. Both returns must retain
inline flags and the measured scroll position.
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
rate guards cannot influence the platform measurement. Open the same URL with
`?controlled` for the paired extension measurement. Run both modes on a quiet
host, then repeat in reverse order with fresh documents.

```sh
ffmpeg -stream_loop 19 -i tests/safari-ios/sample.mp4 -t 300 -c copy -movflags +faststart /private/tmp/stayfast-rate-probe-300s.mp4
STAYFAST_RATE_PROBE_MP4=/private/tmp/stayfast-rate-probe-300s.mp4 node tests/safari-ios/fixture-server.mjs --port 62938
xcrun simctl openurl "$STAYFAST_SIMULATOR_UDID" "http://127.0.0.1:62938/rate-probe.html"
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/safari-ios/native-rates.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/SafariQATests/testNativeRateProbe test
```

Use one fixture server at a time and stop its exact process before restarting with
another clip. The probe records detached video/audio setter acceptance separately
from playback. Inspect the JSON attachment; the test requires all seven rates (1×, 2×, 2.5×, 3×, 4×, 8×, 16×) to sustain
requested media-time progress within 10% for six seconds after a one-second
warmup, with no waiting, underbuffered stalls, pause/end/error, hidden document
or ownership change. A download `stalled` notice is a separate warning only
when its captured ready state is at least 3 and buffered data covers at least
one wall-clock second at that rate; missing/truncated state fails closed.
The [HTML standard](https://html.spec.whatwg.org/multipage/media.html#event-media-stalled)
defines this notice in terms of fetching.
Cadence has a separate verdict: at least 24 callbacks/second (20 at 1×),
95th-percentile gaps at most 50ms and maximum gap at most 150ms. Functional
success alone does not satisfy that cadence target or prove physical-device
smoothness. Raw playback-quality counters stay separate from callback cadence.

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

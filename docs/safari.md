# Safari development and acceptance

The Safari edition shares the Chrome/Firefox media engine and adds an Apple
containing app plus an interface for coarse pointers. The target is Safari
18.4+, iOS/iPadOS 18.4+, and macOS 15.4+. Build and runtime verification are
separate: the native project and resources are development inputs until the
acceptance checks below pass on the intended devices.
For signed iOS distribution and ready-to-use App Store Connect metadata, see
[the TestFlight release packet](testflight.md).

## Build and activate

See [the Apple project guide](../apple/README.md) for Xcode setup, signing,
installation, and generated artifact locations. From the repository root:

```sh
npm run build:safari          # Development extension resources
npm run build:release:safari  # Minified resources for Xcode
npm run build:safari:ios      # Resources + ad hoc signed simulator app
npm run build:safari:macos    # Resources + unsigned Mac app
```

The Xcode project references `dist/safari/` directly. Rebuild those resources
after web-code changes before building from Xcode; the native CLI does this
automatically. The simulator app uses local ad hoc signing; Mac and physical
device compile checks are unsigned. These do not produce a physical-device
installable or App Store-signed release. On a physical device, select the Apple
Development team for both app and extension targets before running.

After installing and opening the containing app, enable StayFast Video in
Safari's extension settings and allow access to the websites being tested.
Reload existing tabs after granting access. The app explains this activation;
build scripts leave Safari preferences and website permissions to the user.

## Capturing video-load diagnostics

The diagnostic TestFlight variant builds with `STAYFAST_DIAGNOSTICS=1`. It starts
one local capture at document start on X/Twitter, before settings and controller
attachment finish. Ordinary builds require **Start new capture** in the popup.
Capture and exports use memory only; MAIN still writes only `lastSpeed` to
storage through the existing bridge.

On an affected iPhone:

1. Install the diagnostic build, then open a fresh Twitter/X Safari tab.
2. Scroll the feed and reproduce the loading jump. Keep the tab open.
3. Open Safari's page menu → **StayFast Video → Video diagnostics**.
4. Tap **Stop & prepare report**, then **Share / save report** or **Copy report**.
   If sharing or clipboard access is unavailable, select the prepared report in
   the text box and copy it manually. Send that JSON report with the feedback.

**Start new capture** replaces the old trace. **Clear capture** stops recording
and discards it. Reloading or closing the page loses the trace, so export first.
No report is transmitted automatically. Captured values exclude website/media
URLs, page text, account details and typed keys.

Each frame keeps up to 240 events for a session of at most ten minutes. Ordinary
scroll/input samples are limited to eight per second; media load and presentation
events include immediate measurements and at most two coalesced animation-frame
follow-ups. A page or nested scroller moving from at least 400px to at most 80px
records before/after snapshots, takes two context frames and stops to retain the
incident. This is a suspected jump, including intentional scrolling to the top;
the trace's input timing helps distinguish those cases.

The report records relative timing, anonymous media/scroller identities, numeric
page/nested-scroll extents, media/host/inner-controller bounds, visual viewport,
focused element type, inline/native/custom state and load/playback events.
StayFast's own presentation-scroll restoration has explicit before/after markers.
The popup aggregates up to eight responding frames within a bounded 350ms window.
The ISOLATED bridge and popup both apply the shared allowlisted schema, with a
512KiB per-frame and under-1MiB prepared-report limit. Cross-origin frames reply
through their own extension instance; capture never grants parent access to them.

Capture is passive and event driven. It neither wraps page scrolling/focus APIs
nor restores scroll position, and it does not poll. Stop/cleanup cancels the
original window's timer, frames and listeners while retaining the bounded report.
Diagnostic timing can affect a race, so this build gathers evidence rather than
establishing a cause by itself. Full page navigation destroys its in-memory trace.

## Feed source replacement and scrolling

StayFast treats `emptied` and `loadstart` as the end of the previous
resource's presentation. Reused video elements return inline, discard old PiP and
history resume flags, and invalidate pending native failures and scroll snapshots.
Closing an active Custom Player preserves the current page position. A native
fullscreen notification never creates a scroll target from its post-entry position;
StayFast captures that target before its explicit fullscreen request.

The controlled X-host browser regression covers newly inserted media with an older
controller present, source reuse, rerendering, and stale presentation callbacks.
It serves project-owned media and does not verify the live X player. Native Safari
feed verification and release status are recorded below.

The `twitter-pristine` browser regression also loads and autoplays media in fresh
documents without user activation. It covers first media, older controlled media,
source reuse and rerendering, requiring advancing decoded frames and stable page
and nested scroll positions throughout its bounded observation. Run it with
`node tests/e2e/run-isolated.js twitter-pristine twitter-inline` against matching
built resources. These controlled Chrome checks do not establish Safari's native
policy before controller attachment or reproduce the signed-in X feed incident.

## Inline control fit

On iPhone/iPad, inline controls use two separate 44px targets for speed and
direct native fullscreen. The cluster fits the video's visible, clipped bounds
and avoids overlapping site headers where space permits. Scrolling refreshes
visible controllers through one shared listener and one coalesced animation
frame per window; it does not write page scroll offsets.

When the available video area is narrower than 180px or shorter than 96px,
only the fullscreen target remains. If either dimension is below 52px, the
inline controls hide because a 44px target plus its insets cannot fit. Expanded
controls remain within the visual viewport. Compact speed labels retain the full
accepted rate in their accessible label and state.

Initial placement waits until the controller is connected, then computes its
final coordinates before returning to the site's readiness handlers. This avoids
the transient overflow found in transformed Twitter/X feed cells. A connected
iOS controller also refreshes placement immediately when the site reparents its
video, while desktop controllers retain their manually dragged position.

## Build 6 inline-playback policy

On iPhone/iPad, StayFast adds `playsinline` and `webkit-playsinline` when it
attaches to a video, including sites that omitted both attributes. Ordinary
Play stays on the page; the site's controls and native fullscreen APIs remain unchanged.
The primary **Full screen** action is explicit native presentation, while
**Custom Player** remains a separate choice. Custom close and native exit retain
the inline policy.

A separate per-video observer watches only the two inline attributes and stops
enforcement after eight conflicts with site code. **Use site player** and
cleanup restore the latest site intent. A new source or explicit Custom Player
can re-enable the policy. This bounded handback prevents a mutation fight.
Build 6 explicitly tests initially absent flags; earlier fixtures already
contained inline flags, so build 5's passes do not verify this case.

## Build 5 scroll preservation

Presentation entry and exit preserve the page's position and nested scroll
containers, including composed shadow-DOM ancestry. Native fullscreen also
preserves accessible same-origin parent-frame scrolling; custom frame expansion
uses the existing validated same-origin protocol. Cross-origin boundaries remain
in place. On Custom Player close, an intentional page scroll made while the view
was open is retained rather than replaced with the original entry offset.
When an already validated same-origin frame session closes, its upstream layout
is released synchronously before native fullscreen captures scroll state.
Pending opens still use the queued, validated protocol; synchronous close grants
no authority over a new or cross-origin session.

The helper performs an immediate restoration and at most two animation-frame
corrections for deferred focus/layout work. Wheel, touch, pointer or keyboard
input, pagehide/popstate, navigation, a new presentation session and cleanup
cancel or invalidate correction. It does not continually lock the page's scroll.
Build 5 native verification and upload are complete; distribution availability
remains unverified. Build 4
evidence below does not verify this change.

## Build 4 mobile behavior

- Normal video playback stays inline. A compact speed pill opens its controls;
  the adjacent 44px **Full screen** action requests Apple's video fullscreen
  directly in that tap, retaining the original video and source. It skips the
  custom-player intermediate view. **Custom Player** is the separate, explicit
  entry to StayFast's webpage viewing surface. Native API availability,
  readiness, and gesture restrictions still apply.
- The compact controller follows the current media bounds and its popover fits
  the visual viewport. Touch controls collapse after 2.5 seconds idle while
  playing; pause and keyboard interaction keep them available. Size adjustments
  preserve 44px touch targets. Close, outside tap, and Escape collapse the panel.
  Very small players retain the direct 44px fullscreen target instead of
  overflowing a speed pill. The popover uses compact, non-stretching rows and
  can collapse to one column with wrapped labels.
- The viewing surface provides play/pause/replay, ±10-second seek, a timeline,
  speed selection, absolute **1×**/**Pref**, Fit/Fill, and mute. **More** reveals
  available caption/audio-language choices, supported system controls, and
  **Use site player**. Escape closes More before dismissing the player. It keeps
  the original media element and sources, including an existing streaming session. Known
  single-video player containers stay together to preserve site-rendered
  captions where possible. Caption changes leave metadata/chapter tracks alone.
- Drag the timeline horizontally to seek. Moving farther above or below it
  changes sensitivity to half, quarter, then tenth speed without jumping the
  selected position. Scrubbing pauses playback; release resumes only if the
  video was playing before the gesture and the current view is still visible.
  Cancellation restores the starting position. Decoder writes are coalesced and
  seek targets stay inside the current finite/live seek range. Keyboard range
  controls remain available.
- Fit shows the whole video; Fill crops its edges. Use the button or a two-finger
  pinch on the video. Tap the duration to alternate total and remaining media
  time. A live stream shows **LIVE** and offers **Go live** when it exposes a
  seekable window. Audio-language selection appears only for multiple native
  audio tracks; site-only streaming catalogs are not exposed by that API.
- Volume appears only when Safari supports detecting an unlocked media volume.
  iPhone system/hardware volume remains available. PiP/AirPlay controls require
  the corresponding system capability and honor disabled-presentation flags,
  including changes made after the player opens.
- **Done** returns the video to the page while keeping the inline StayFast
  controls. Tap **Custom Player** to reopen. **Use site player** restores the
  site's attributes and native API methods.
  If a site moves the playing video itself, StayFast returns presentation control
  while retaining the same controller and playback state; Custom Player opts back in.
  Removed videos stay removed, and site replacement videos survive cleanup.
- The custom iPhone presentation fills Safari's webpage viewport. Browser address/tab
  bars may remain; it is not native system fullscreen. Where container
  fullscreen is supported, a genuine tap can request it, with viewport fallback.
  Method wrapping is limited to an active custom-player session. Ordinary
  attachment leaves native fullscreen available. Apple's fullscreen uses system
  controls; an extension cannot add webpage buttons inside it or guarantee every
  site's presentation.
- PiP uses the system interface: the owned viewport closes during PiP and can
  reopen on return inline. The original media and remote-playback setup stay
  intact; optional AirPlay invokes the original media's system picker.
- Same-origin embedded players may expand their owning iframe and ancestor
  layout through a reversible, validated frame protocol. Cross-origin and
  opaque/sandboxed frames stay frame-local. A child-provided token does not
  authorize control of a cross-origin parent.
- A coarse pointer, or a real touch on the indicator, selects touch controls.
  Tap the speed pill to expand; tap Close, outside the controller, or Escape to
  collapse it. Touching the pill does not start a drag.
- Speed and seek buttons have at least 44px touch targets. Presets select 1×,
  1.25×, 1.5×, or 2×; the active preset follows the current speed. The expanded
  panel is clamped to the visual viewport as it resizes or scrolls.
- Safari's candidate speed choices add 6×, 8×, 12×, 16×, and 32× plus a custom
  finite rate from 0.07×, bounded by the target media/native floating-point API.
  Safari has no universal 16× playback ceiling; Chrome/Firefox retain the
  extension's 16× limit. High-rate assignment or readback does not establish
  decoded playback at that rate. Device, codec, streaming engine, audio and
  site restrictions may limit the result. A separate native probe below observes
  decoded/presented progress above 16× for one clip and simulator. Native product
  controls separately pass 32× selection and custom 64× entry while paused. See
  [WebKit's rate implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp),
  which includes media-specific restrictions rather than a universal 16× cap.
- Popup and settings layouts adapt to narrow screens. Hardware keyboard
  shortcuts remain available on iPad and Mac.
- Visible-tab and persisted-history events coalesce a deferred media recovery
  scan. The extension uses events and bounded work instead of background
  discovery polling.

## Platform contracts

Keep the ISOLATED storage bridge and MAIN controller, `document_start`,
`all_frames`, and blank-frame injection. Each frame owns its media. The Safari
manifest drops `minimum_chrome_version` and `options_ui.open_in_tab`; it keeps
the shared world and frame declarations. Older converter warnings about those
keys are not a reason to replace this architecture with script-tag injection:
Safari 18 added `world` and Safari 18.4 added blank-frame matching.
See [WebKit's Safari 18 features](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/)
and [Safari 18.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes).

Safari's `storage.sync` stores preferences without cross-device synchronization;
the wrapper adds no iCloud preference service. Website access controls still
apply to embedded frames. Extension access does not extend to media playing in
other native apps, and local `file://` pages are outside the Safari target.
See [Apple's compatibility guide](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).

## Repeatable checks

Run the repository's lint, tests, and release build gate. Build both native
targets to catch packaging/resource errors. For touch behavior in the real
built Chrome extension:

```sh
npm run test:e2e:mobile
npm run test:e2e:ios-player
```

This uses disposable Chrome with genuine browser touch input. It checks speed
and seek actions, target size, panel geometry, dismissal, rotation, and new feed
media, and records a screenshot. Chrome's mobile emulation is useful regression
coverage; it does not verify Safari, iOS media behavior, or Apple permissions.

For actual desktop Safari extension automation on Safari 26+:

```sh
npm run test:e2e:safari
```

This uses SafariDriver's extension-loading endpoint in an automation session.
Safari Remote Automation must already be enabled; the runner does not change
browser preferences. It unloads test extensions, closes the session and owned
driver, and stops its fixture server. A successful extension-load response
alone is insufficient: content scripts must execute and playback assertions must
pass. If even the minimal diagnostic extension fails to inject, report the
automation-environment blocker and leave desktop Safari verification incomplete.

For installed-extension checks in iPhone Safari, use the
[native simulator harness](../tests/safari-ios/README.md). It verifies activation,
touch presets, decoded playback, native fullscreen, and app-switch recovery on an
explicitly selected disposable simulator. Screenshots and native accessibility
hierarchies are retained in the test result bundles.

## Verification evidence

### Build 9 — video-load diagnostic variant

The `STAYFAST_DIAGNOSTICS=1` variant starts local capture automatically in fresh
Twitter/X pages and adds popup report preparation, Copy, Share/save and Clear.
The capture instructions and limits are [above](#capturing-video-load-diagnostics).
Final lint, formatting, release builds and **1,080 unit/integration tests across
69 files** pass (159.22s). Final Chrome checks pass **110/110** in one sequential
command: diagnostics 6, layout 8, controlled X-host 9, owned player 32, mobile 11,
basic 22, responsive visual 10 and real YouTube playback/navigation 12.
The artificial-jump export retains the same nested scroller before the jump and
in both follow-up frames, with no page URLs/text or typed input. All owned browser
processes, profiles and fixture servers are closed. See the
[browser report](../test-results/video-diagnostics/browser-summary.md).

Native iPhone 17 Pro/iOS 26.2 simulator checks pass on all 25 exact resources with
strict signatures. Genuine popup capture/export passes (68.279s): two decoded
source loads, intentional page Y720→0, preserved same-ID nested 70/220→0/0 in
both context frames, independently read Copy output and a native JSON share sheet
with Save to Files. Inline/native/custom playback, scroll restoration and site
handback pass (89.409s); strict insertion geometry passes (5.395s). Public X
automatic capture passes (23.998s) without a Start tap and exports 125 events,
including 60 media snapshots over page Y0–1355. These controlled and unsigned
public-site results do not reproduce the user's authenticated-feed jump or verify
a physical iPhone. All eight executed harness files and both served fixtures match
their saved bytes; fixture PID5698 exited, port62938 is free and the dedicated
simulator is shut down. See the
[native report](../test-results/safari-ios/diagnostic-e8cba6a6/report.md).

Frozen inject SHA-256 is Chrome
`d174eab703f8640bdc91e2e6e4b2c241576f4be03e9c1c24d6ac2089100d9cec`
and Safari
`e8cba6a6aceebff850b7a1e7a53fa667d84d131f39f0e92ae7d79c82dfa56d44`.
The signed `0.11.3 (9)` archive/export passes all 25 resource comparisons,
signatures, versions, privacy and distribution entitlements. Earlier unsubmitted
artifacts are preserved separately; the final package is the corrected variant.
See the [release ledger](../test-results/video-diagnostics/release-verification.json)
and [TestFlight packet](testflight.md) for Apple processing and tester availability.

### Build 8 — adaptive inline controls and stable feed insertion

Final lint, formatting and **1,026 unit/integration tests across 66 files** pass
(146.67s); default/Chrome/Safari release builds pass. Frozen Chrome inject SHA-256
is `86489a33b066122ac917ea89700ff4789903a6f52d410526bec3fa1629abe651`;
Safari is `1603b981a7697e4cfc70f073a125e8ffe4feb1385d855afa83de79ebfa0036c8`.
Built Chrome passes **92/92** checks: layout 8, controlled X-host 9, owned player
32, mobile 11, basic 22 and responsive visual 10. These include genuine scroll
with unchanged intersection ratio, header avoidance, clipped/undersize video,
compact rate labels, and native/custom fullscreen scroll returns. No uncaught
page errors or owned processes/profiles remain. See the
[browser report](../test-results/twitter-layout/summary.md).

The native iPhone 17 Pro/iOS 26.2 simulator passes activation, strict transformed
cell insertion, six responsive video/crop cases, compact rate labels and the
complete decoded inline/native/custom playback flow. From insertion through two
animation frames, the controller remains 4px below its video and scroll extent
stays 4000; the build 7 baseline briefly expanded it to 5180. Page and nested
scroll offsets remain unchanged. Actual 44×44px target counts are 2/2/1/1/0/1 for
360×203, 180×102, 120×68, 80×60, 80×45 and a cropped 120×68 wrapper. Public NASA
videos also play inline during genuine swipes with correctly fitting controls.
The recurring unsigned X app-promotion prompt limits exploration. The literal
reported Twitter jump was not reproduced; this evidence establishes removal of
the measured layout fault, not a definitive cure for that incident. See the
[native report](../test-results/safari-ios/final-responsive-1603b981/report.md).
Fixture processes exited, port 62938 is free and the dedicated simulator is shut
down. Physical-device verification remains outstanding.

Signed `0.11.3 (8)` archive/export verification passes all 25 resources, strict
signatures, privacy, versions and distribution entitlements. See the
[release ledger](../test-results/twitter-layout/release-verification.json) and
[TestFlight packet](testflight.md) for upload/processing and tester availability.

### Build 7 — feed source and scroll correction

Final lint, formatting and **986 unit/integration tests across 66 files** pass
(112.77s); release and native simulator builds pass. The exact frozen inject hashes
are Chrome `bfeb4e734044c0e06923888102669e5438e0165bd7e1af40c8f81cc8d8a9c025`
and Safari `af41c4ade4598b9b04dbf90e74ca2f2d08592b02156e92ed3f5d016c3da3dc2a`.
Built Chrome passes **74/74** checks, including **9/9** controlled X-host checks,
with no uncaught page errors or remaining owned browser processes/profiles.
See the [browser summary](../test-results/twitter-inline/summary.md) and
[unit/integration log](../test-results/twitter-inline/unit-integration.log).

The dedicated iPhone 17 Pro/iOS 26.2 simulator passes activation, newly inserted
and reused feed-video playback, active Custom Player source replacement followed
by a real app switch/return, and the full inline/native/custom transition check.
Feed playback advances while retaining page Y720, no native entries and no owned
hosts. Explicit fullscreen still works and preserves scroll on return. The
historical build 6 baseline did not reproduce fresh-load fullscreen in this
synthetic Safari feed; these checks do not establish the cause of the live X report.
See the [native report](../test-results/safari-ios/final-feed-af41c4ad/report.md).

The `0.11.3 (7)` archive/export passes 25 exact web resources, strict signatures,
privacy, app/extension versions and distribution-entitlement verification. See the
[release ledger](../test-results/twitter-inline/release-verification.json) and
[TestFlight packet](testflight.md) for Apple upload and tester availability.

### Build 6 — native verified and uploaded

Final lint and **971 unit/integration tests across 66 files** pass in 30.55s;
release resources, Chrome and the simulator app build successfully. Evidence:
[unit/integration log](../test-results/inline-player/unit-integration.log) and
[lint log](../test-results/inline-player/lint.log).

Frozen Chrome `inject.js` SHA-256 is
`dc6352a898983aa76f1afb1dc3f19e89645b2d3b206a352038695140df54513e`;
Safari is
`76c17bfed3fa492665781c9dfb9423013e460f49f78ffef4366811667cbe3bab`.
Final built Chrome checks pass **65/65**: player **32/32**, mobile **11/11**,
basic **22/22**. The source hash is stable, there are zero uncaught page errors,
and all owned processes/profiles are gone. A clean 32-check repeat confirms the
owned-player result after an earlier shutdown-deadline diagnostic. See the
[final browser summary](../test-results/inline-player/summary.md).

Signed `0.11.3 (6)` archive/export verification passes: all 25 exact Safari
resources, strict signatures, privacy manifests and app/extension `0.11.3 (6)`.
Distribution flags are `get-task-allow=false` and `beta-reports-active=true`.
The IPA is **3,823,392 bytes**. See the
[release ledger](../test-results/inline-player/release-verification.json) and
[prepare log](../test-results/inline-player/testflight-build6-prepare.log).

Native activation passes in **52.789s** and the complete final inline-policy
flow passes in **92.265s** (96.667s including orchestration). Genuine fixture
Play and native-control Play advance decoded time at ready
state 4 with both inline flags/properties true, native fullscreen false and
zero owned hosts. Explicit native and Custom Player → native returns preserve
inline flags and page Y720. Custom Done/replay stays inline; Use site player
restores the originally absent flags. The five saved/executed harness files
match byte for byte. The fixture exits successfully, port 62938 is free, the
task-owned Qorvex process is gone and the dedicated simulator is shut down.
See the [final native report](../test-results/safari-ios/final-inline-76c17bfe/report.md)
and its inline/native-fullscreen screenshots. This verifies local fixtures on
the simulator; physical-device, live Safari, DRM, PiP and AirPlay acceptance
remain outside this run.

Apple accepted `0.11.3 (6)`; Xcode reports “Uploaded package is processing” and
`EXPORT SUCCEEDED`. The marker records `submitted` at
`2026-10-17T21:30:14.766Z`. See the
[upload log](../test-results/inline-player/testflight-build6-upload.log).
Build 6 will not be uploaded again. Apple processing completion and Personal
Testing status remain unverified; the user is handling App Store Connect
authentication. The two existing testers are unchanged.

### Build 5 — native verified and uploaded

Current Chrome `inject.js` SHA-256 is
`3b97a5a221e42b3bc7e85072ac935c3f09c6d0e7981aa4780042642e6c1e9b78`;
Safari is
`edef00a636bae99da9db3983220bbcefa913ba6683913811e2788455d68ed7b6`.
Final lint and **962 unit/integration tests across 66 files** pass in 42.26s.
Default release resources, Chrome and the simulator app build successfully.
See the [unit/integration log](../test-results/scroll-player/unit-integration.log)
and [lint log](../test-results/scroll-player/lint.log).

Corrected built Chrome checks pass **61/61** with stable pre/post source hashes,
zero uncaught page errors and zero owned processes/profiles. The same-origin
iframe Custom Player → native transition now releases parent overflow before
native entry and restores parent nested offsets to 70/220 on return. See the
[corrected runtime summary](../test-results/scroll-player/summary.md) and its
`chrome-scroll-fixed-*` logs.

Exact-source native Safari checks pass on iPhone 17 Pro / iOS 26.2 simulator:
activation **54.199s**, page scrolling **67.678s**, nested scrolling **65.427s**
and same-origin frame scrolling **68.379s**. Each scroll case verifies native
fullscreen, Custom Player return and Custom Player → native transitions. Parent
and child frame documents retain page Y720 and nested X70/Y220 with zero errors;
the parent assertions executed. See the
[final native scroll report](../test-results/safari-ios/final-scroll-edef00a6/report.md).
An additional strict frame replay passes in **70.694s** with explicit
parent-existence and non-null guards executed. The saved and executed four-file
harness matches byte for byte. The fixture exits successfully, port 62938 is
free, the task-owned Qorvex process is gone and the dedicated simulator is shut down.
These local-fixture simulator checks do not verify physical devices, live Safari
sites, DRM, PiP or AirPlay.

The corrected build 5 archive/IPA passes final verification with all 25 resources
matching Safari, strict signatures/privacy/versions and distribution entitlements.
The IPA is **3,823,054 bytes**. See the
[release ledger](../test-results/scroll-player/release-verification.json) and
[prepare log](../test-results/scroll-player/testflight-build5-prepare.log).
Apple accepted `0.11.3 (5)` on October 17, 2026. Xcode reports “Uploaded package
is processing” and `EXPORT SUCCEEDED`; the upload marker records `submitted`
at `2026-10-17T17:03:08.650Z`. See the
[upload log](../test-results/scroll-player/testflight-build5-upload.log).
Build 5 will not be uploaded again.

The prior `91db2a…` Chrome / `56ce4c…` Safari candidate passed 952 tests and
61 browser checks, but a newly exercised iframe Custom Player → native
fullscreen transition lost parent nested-scroll positions (70/220 became 0/0).
That failure invalidated final acceptance. The fix synchronously releases an
already validated upstream frame session before native scroll capture. The
earlier failure remains superseded diagnostic history.

The earlier `56ce4c…` build 5 archive/export was superseded without upload.
Apple processing and tester availability remain unverified. App Store Connect
login is still failed/expired; the two existing Personal testers are unchanged.
Build 4 evidence below does not verify the scroll-preservation changes.

### Build 4 — native verified and uploaded, October 17

Build 4 passes the repository, built-browser and native iPhone-simulator gates
and has been uploaded to Apple. Processing completion and Personal-group
assignment require restored App Store Connect authentication.

- Final lint and all **926 unit/integration tests across 65 files** pass
  (`npm test -- --maxWorkers=4`, 37.68 seconds).
- Final Chrome owned-player checks pass **22/22**, mobile **11/11**, and basic
  fixtures **22/22**, with zero uncaught page errors and zero owned
  processes/profiles after cleanup. The exact tested `inject.js` SHA-256 is
  `16245302d9748531e1b92afb2c0bc91db62bfd40b347bc0af8a12a0816ae776a`.
  Genuine taps verify direct fullscreen without a custom-player portal, natural
  popover height, tiny/clipped/offscreen geometry, and original-window timer
  cleanup after inert-document adoption. See the
  [final build 4 Chrome summary](../test-results/owned-player/build4/summary.md).
  Live YouTube **12/12** passed on the preceding `b986f159…` candidate.
- Final Safari `inject.js` SHA-256 is
  `b7597ad9347247cef5c6092e222645de518ca82ab4a6792cec3b4e61ed27890b`.
  The final signed build 4 archive/IPA contains all 25 exact resources and
  passes strict signature/privacy/version checks. Both distribution bundles
  have `get-task-allow=false` and `beta-reports-active=true`; IPA size is
  3,821,808 bytes. See the
  [release verification ledger](../test-results/intuitive-player/release-verification.json).
- Final installed Safari checks pass **3/3** with no skipped assertions on
  iPhone 17 Pro / iOS 26.2 simulator: activation (50.467s), direct native
  fullscreen/return (44.081s), and the complete clean custom-player replay
  (219.778s). Genuine input verifies a compact 254px panel with 44px rows,
  direct fullscreen without a portal, 32× selection/custom 64× entry while
  paused, precision/pinch, rotation, app switching, Done/reopen, and native
  fullscreen plus Custom Player after site handback. Original identity/source,
  one controller and zero page/media errors are preserved. The dedicated
  simulator is shut down and the fixture/process/port are released. See the
  [final native report](../test-results/safari-ios/final-b7597ad9/report.md),
  [compact panel](../test-results/safari-ios/final-b7597ad9/safari-paused-panel.png),
  and [native fullscreen](../test-results/safari-ios/final-b7597ad9/safari-native-fullscreen.png).
- Apple accepted the `0.11.3 (4)` upload on October 17, 2026; Xcode reports
  “Uploaded package is processing” and `EXPORT SUCCEEDED`. See the
  [upload log](../test-results/intuitive-player/testflight-build4-upload.log).
  Apple processing completion and Personal-group assignment remain unverified.
  The App Store Connect browser session expired and login failed; restored
  authentication is required to verify distribution. The user has been asked
  to sign in. The submitted build will not be uploaded again.
  Published build 3 evidence below does not verify build 4.

Physical-device, live-Safari-site, DRM, PiP and AirPlay acceptance remain
unverified. Simulator controls and the separate rate probe do not establish
universal media compatibility or high-rate audio quality.

An independent native Safari probe used an extension-inaccessible closed-shadow
video on iPhone 17 Pro / iOS 26.2 simulator: a local 300-second H.264 Baseline/AAC
MP4. In approximately 400ms windows, requests of 1×/16×/32×/64× produced measured
media-time slopes of **0.894×/13.057×/31.958×/64.035×**, with **9/17/23/19**
presented-frame callbacks. All stayed playing with zero media errors. This
demonstrates actual progress above 16× on that fixture, separate from product
controls; it does not establish a universal maximum, audio quality, or parity
across devices/codecs/live/DRM media. See the
[native rate report](../test-results/safari-ios/native-rates/report.md) and
[raw presented-frame evidence](../test-results/safari-ios/native-rates/presented-frames/manifest.json).

### Published internal TestFlight — build 3

Build 3 introduced precision scrubbing, More, Fit/Fill/pinch, remaining time,
live-edge seeking, native audio selection, feature-gated volume, and Replay.

- Lint and all **883 unit/integration tests across 63 files** pass, including
  player **32/32**, scrubber **35/35**, and gestures **10/10**.
- Final built Chrome owned-player checks pass **16/16** with genuine touch and
  keyboard input: playback, speed, precision bands, pinch Fit/Fill, More,
  remaining time, HUD, site-touch isolation, lifecycle and frame restoration.
  Visible targets measure at least 44px. There are zero uncaught page errors,
  and cleanup leaves zero owned Chrome processes and disposable profiles.
- Final Chrome and signed build 3 resources share `inject.js` SHA-256
  `0336507b5faee3cc4c1a3682bfbe9aa014e72dc61c2eaa0fe68fc70e8156dcfd`.
  The archive/IPA contain all 25 matching extension files, privacy manifests,
  verified distribution signatures, and TestFlight entitlements.
- The checked-in native owned-player harness passes on iPhone 17 Pro / iOS 26.2
  simulator using the exact final resources. Genuine interaction verifies
  fine scrubbing (equal finger drags seek 4.32s near the timeline and 1.95s
  farther away), pinch both ways, HUD hide/wake, 1×/Pref 1.8×, the 1.5× system
  selector, portrait/landscape, app switching, Done/reopen, and More/Use site
  player. Selects measure 46px. Handback restores the original video/source and
  native controls with zero owned hosts, one controller, ready state 4, and zero
  errors; decoded playback advances from 2.45s to 4.33s at 1.5×. The complete
  harness exits successfully after 156.5 seconds.
- More → Use site player also passes the native fullscreen/return harness in
  40.4 seconds. The dedicated simulator is shut down, and the fixture process
  and listener are closed.
- Apple processed `0.11.3 (3)` on October 16, 2026. The existing **Personal**
  group now shows build 3 as **Testing**, expiring in 90 days, with its two
  existing testers retained. The expanded Beta App Description and What to Test
  instructions are saved. No external group or public invitation was created.
  Physical-device, mobile live-site, PiP/AirPlay, and protected-media acceptance
  remain incomplete. Chrome emulation does not establish Safari acceptance.

Evidence: [final Chrome summary](../test-results/owned-player/chrome-final-summary.md),
[runtime log](../test-results/owned-player/chrome-expanded-final.log), and
[matching hashes](../test-results/owned-player/chrome-final-hashes.log).
Inspected primary/More portrait and landscape screenshots are beside these logs.
Native evidence is in the
[final iPhone simulator report](../test-results/safari-ios/final033650/report.md),
with [portrait](../test-results/safari-ios/final033650/owned-portrait.png),
[landscape](../test-results/safari-ios/final033650/owned-landscape.png), and
[site handback](../test-results/safari-ios/final033650/site-handback.png) screenshots.
Publication evidence:
[Personal build 3 Testing](../test-results/owned-player/testflight-build3-testing.jpg)
and [saved beta details](../test-results/owned-player/testflight-build3-details-saved.jpg).
Earlier neighboring checks passed mobile **11/11**, basic fixtures **22/22**,
and live YouTube **12/12** with a separate **10/10** content-playback check;
those runs predate the final expanded candidate.

A platform foundation probe used actual Safari in an iPhone 17 Pro simulator
running iOS 26.2, with StayFast temporarily disabled for isolation. Generic
container fullscreen and atomic `moveBefore` were unavailable. Ordinary
same-document moves into a modal dialog/fixed layer and fixed styling in place
preserved the original MP4's identity, source, 1.5× rate, decoded time progress,
and unpaused playback; restoration continued without a recovery `play()` call.
A synthetic fragmented H.264/AAC `ManagedMediaSource` session likewise survived
modal movement/restoration with continuing playback and zero errors. Safari's
browser chrome remained. This is platform evidence, not built-extension or DRM
proof. See the [foundation report](../test-results/safari-ios/foundation/report.md).

### Previous release baseline — 0.11.3 (2)

These results precede the owned-player changes:

| Check                                   | Result                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository checks                       | Lint, all **780 unit/integration tests**, and the Chrome release build pass.                                                                                                                                                                                                                                                                              |
| Built Chrome extension, mobile fixtures | **10/10 passed:** genuine taps/swipes, active presets, playback/seek, 320px layout, rotation, 2× visual-viewport zoom, and new feed media. Popup and all settings tabs/generated rows fit 320px; visible targets measure at least 44px and editable fields use 16px text.                                                                                 |
| Chrome local basic fixtures             | **21/21 passed.**                                                                                                                                                                                                                                                                                                                                         |
| Live YouTube in Chrome                  | **12/12 passed:** actual playback, controller buttons, shortcuts, and navigation to another video.                                                                                                                                                                                                                                                        |
| Firefox reliability fixtures            | **12/12 passed** on cached Firefox 155: bridge startup, frame ownership, feed readiness, lifecycle, controller repair, shadow media, and document replacement.                                                                                                                                                                                            |
| Browser cleanup                         | No uncaught page errors; Chrome and Firefox runs left **0 owned processes and 0 disposable profiles**. SafariDriver sessions and owned drivers were released.                                                                                                                                                                                             |
| Native builds                           | Simulator, physical iOS arm64, and Mac Release builds pass. The simulator app is ad hoc signed; physical iOS and Mac apps are unsigned. All 25 embedded extension files match the final Safari resources.                                                                                                                                                 |
| Safari 27 desktop automation            | **Blocked:** extension loading succeeds, but neither StayFast nor a minimal diagnostic extension injects content scripts. No desktop Safari automation pass is claimed. Browser preferences remain unchanged.                                                                                                                                             |
| iOS extension runtime                   | **Passed on iPhone 17 Pro simulator, iOS 26.2:** activation/site access, genuine touch preset selection, decoded moving-video playback at 1.5× with time advancement, native fullscreen entry/exit, inline control restoration, and app switching. Exactly one controller and zero page/media errors. Physical iPhone/iPad acceptance remains incomplete. |

Reproduce Safari's diagnostic check with
`STAYFAST_SAFARI_DIAGNOSE=1 npm run test:e2e:safari`.
Chrome screenshots are saved under `tests/e2e/screenshots/`, including
`mobile-controls-expanded.png`, `mobile-popup.png`, `mobile-options-settings.png`,
`mobile-options.png`, and `youtube-spa-next-video.png`.

## Safari device acceptance

Exercise the installed extension on Safari for Mac, an iPhone, and an iPad.
Record OS/Safari versions, site/fixture URLs, observed media speed, controller
state, screenshots, and page errors. Unavailable playback or skipped assertions
leave the corresponding check incomplete.

| Area            | Required behavior                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Activation      | Enable extension, grant/revoke site access, reload, and verify controls track access.                      |
| Startup         | Settings load before actions; MAIN/ISOLATED startup order never strands initialization.                    |
| Inline playback | Plain video and audio, mobile YouTube, and cross-origin/blank-frame players accept speed and seek actions. |
| Touch           | Pill, presets, buttons, dismissal, portrait/landscape, page zoom, and browser bars keep controls usable.   |
| Navigation      | New feed media, player replacement, YouTube navigation, and browser back/forward recover controls once.    |
| Suspension      | Switch apps and return; missed settings and removed controllers reconcile without duplicate listeners.     |
| Native media    | Enter/exit fullscreen and PiP; record speed retention and confirm controller returns inline.               |
| Extension UI    | Popup aggregates media across frames; settings, import/export, and enable/disable work.                    |
| Cleanup         | Repeated toggle, navigation, and removal leave no duplicate overlays, pending callbacks, or page errors.   |

Physical-device Safari checks are required before describing this edition as
release-ready. Simulator compilation, Chrome touch checks, and WebKit without
the installed extension each provide narrower evidence.

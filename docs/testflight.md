# StayFast Video — iOS TestFlight

Release packet updated October 28, 2026. Target: iPhone and iPad on iOS/iPadOS
18.4+. Archive/export, Apple upload/processing and tester availability are
separate verification steps.

## Current release preparation — custom WebM on iOS

The next candidate adds native playback and StayFast controls for recognized
expanded OGV WebM players on iOS. It probes the site's exact source before
replacing presentation, retains unsupported clips and restores the original
renderer on handback. Reentrant site actions, source replacement, queued decoder
events and shadow-root changes have regression coverage. Controlled browser and
native Safari checks remain separate from physical-device acceptance. The open
X fast-playback report is not resolved by this change.

Record final reviewed source, local CI, native Safari/decoder compatibility,
signed archive/export, Apple processing and existing Personal Auto availability
under `build/safari/testflight/` before claiming tester rollout.

## Previous release — GIF and WebM controls

Build 0.11.6 (31) adds controls to muted looping MP4/WebM clips, including
clips without site controls, and supported multi-frame GIF images. GIFs retain
their original image node and source while gaining speed, pause/play, seek and
exact frame stepping. Still GIFs remain unchanged. Cross-origin images require
CORS; unreadable, CSP-blocked, unsupported and over-budget images retain native
rendering. GIF source changes, removal and disable release the owned animation
and frame URLs. Removed/reinserted feed images must regain controls, and
offscreen candidates must not block visible images.

Record final reviewed source, local CI, Chrome GIF/loop regressions and native
Safari GIF controls, signed archive/export, Apple processing, What to Test and
existing Personal Auto availability before claiming distribution. Use the
existing TestFlight runner and its one-upload-attempt receipt for the next
available build; retain evidence under `build/safari/testflight/`.

## Previous release — current-track MP4 selection

The next candidate repairs MP4 selection for X's current selected-track metadata,
including its observed HLS transport marker and the expanded viewer's absent
availability field. Physical iPhone testing selects the original live clip's
supplied MP4 at 2.1×/4× in the normal feed and 2.1× in the viewer. Separate
microphone-off recordings reproduce native HLS 4× audio loss while MP4 4× stays
continuous; [the research note](research/ios-fast-playback.md) records scope and
limits. Captions, protected/live media and alternate tracks retain their original
streams. Record final reviewed source, local CI, resource/signing verification,
Apple upload/processing and existing Personal Auto availability before claiming
this candidate is distributed.

## Previous release — bottom progress bar

**0.11.6 (29)** keeps the inline progress bar at the clipped video's bottom edge.
Site metadata no longer shifts it upward. Record reviewed source, local verification,
archive/export, upload, notes and Personal Auto availability under
`build/safari/testflight/0.11.6-build29/` before claiming distribution.

## Previous custom-player candidate

**0.11.6 (27)** is the custom-player compatibility candidate. Muted looping
clips with nearby playback controls retain StayFast transport, including when
those controls arrive after the video. Picture swipes suppress the site's trailing
tap action, preserving the starting playback state. Inline timelines avoid local
metadata when a clear lane remains below the primary controls. Decorative loops,
independent site controls and vertical scrolling retain their existing behavior.
Neutral regression cases cover discovery, late controls, input cleanup and rail
placement. Record reviewed source, local verification, archive/export, upload,
notes and Personal Auto availability under
`build/safari/testflight/0.11.6-build27/` before claiming distribution. Existing
open Twitter acceptance reports remain tracked separately.

## Previous feed-position candidate

**0.11.6 (26)** is the feed-position candidate for SF-TW-4. The owned fullscreen
placeholder retains the original media's margins, preserving the scroll range
near the end of a page or nested feed. A delayed exit from an older owned
fullscreen container cannot end a newer Apple-player session or consume its
scroll snapshot, including after a feed reuses the video source. Device-free
browser and native Safari simulator regression coverage is documented in
[Safari acceptance](safari.md#open-twitter-regressions). This verifies controlled
layout/event failures; authenticated live Twitter acceptance remains separate.
Record reviewed source, archive/export, upload, notes and Personal Auto
availability under `build/safari/testflight/0.11.6-build26/` before claiming
distribution.

## Previous Twitter regression candidate

**0.11.6 (25)** is the Twitter regression candidate. It prefers the current
player's explicitly supplied 720p rendition over its 1080p download, restores
picture seeking through recognized focusable X surfaces inside navigable tweets,
and retains the 44px mute action on 240px-and-wider inline players. The existing
generic overlay/viewer gestures remain covered. SF-TW-1, SF-TW-2 and SF-TW-3 are
tracked in [Safari's open regression table](safari.md#open-twitter-regressions).
Controlled native 2.1×/4× and browser feed/mute checks pass; the original affected
live-post/device stutter remains open. Do not call that report resolved from
these fixture results. Record reviewed source, archive/export, upload, notes and
Personal Auto availability under `build/safari/testflight/0.11.6-build25/`.

## Previous release preparation

**0.11.6 (24)** is the startup-rendition candidate. Metadata initialization
rechecks an eligible same-clip MP4 when an earlier speed command already set the
numeric rate, so a loading native-HLS video can still select its supplied
progressive rendition above 2×. It includes the previously merged overlay gestures
and icon controls. Record reviewed source, local checks, archive/export, upload,
release notes and Personal Auto availability under
`build/safari/testflight/0.11.6-build24/` before claiming distribution.
The controlled native 720p startup case passed at 4×; physical-iPhone audio and
live authenticated X remain unverified. A separate 1080p fixture selected MP4 but
missed its cadence target, so this does not claim universal smoothness.

## Previous release preparation

**0.11.6 (23)** is the overlay-gesture candidate. Horizontal picture scrubbing
extends through unambiguous site overlays and expanded site viewers while
preserving independent controls, vertical swipes and pinch. Picture taps dismiss
the speed menu; focusable player/dialog roots retain their gestures. Fallback
ownership and the current hit target are checked again before a drag commits.
Archive/export, Apple processing, release notes and Personal Auto availability
must be recorded under `build/safari/testflight/0.11.6-build23/` before claiming
distribution. Live authenticated X and physical-device checks remain separate
from controlled browser and native simulator acceptance.

## Previous release preparation

**0.11.6 (22)** is the next candidate. Primary inline and fullscreen controls use
borderless icons while retaining accessible labels and 44px touch targets. Speed
and time remain numeric; the star selects preferred speed, the padlock locks
controls, the ellipsis opens More, and the close icon returns to the page.
It also includes picture-swipe precision scrubbing from build 21. Archive/export,
upload and tester availability must be recorded under
`build/safari/testflight/0.11.6-build22/` before claiming distribution.
Physical-device and live Safari site checks remain separate acceptance checks.

**0.11.6 (21)** is confirmed Testing in Personal Auto for both existing testers;
its local rollout record is
`build/safari/testflight/0.11.6-build21/rollout-verification.json`.

## Earlier release preparation

**0.11.6 (19)** was the candidate for the following changes. Inline controls and the timeline reveal
together on picture/control input, keyboard focus and pointer movement, including
recognized single-video site overlays. Playing controls use a four-second idle
delay; paused media and active scrubbing retain the timeline. The top transport
stays anchored to the video as it scrolls offscreen. Precision feedback is blank
at normal sensitivity and shows `×1/2`, `×1/4` or `×1/10` at slower sensitivities.
Dependency updates are verified through local CI; hosted workflows stay inactive.

Record the merged source, checks, archive/export, upload receipt, processing and
Personal Auto tester availability under `build/safari/testflight/0.11.6-build19/`.
Preparation alone does not establish upload or Testing. Physical-device and live
Safari site checks remain separate from simulator and controlled-fixture proof.

**0.11.4 (18)** is the next candidate. Delayed media initialization now reads
current speed preferences when metadata arrives and preserves a newer command
for that video. A removed or replaced controller cannot apply its old callback.
Build 17 is confirmed Testing in Personal Auto for both existing testers.
Record build 18 archive, export, upload, processing and tester availability in
`build/safari/testflight/0.11.4-build18/`; preparation alone does not prove Testing.

**0.11.4 (17)** is the inline-player candidate. It places the thin inline
timeline at the video's bottom and shares distance-sensitive precision seeking
with fullscreen. Moving away selects half, quarter or fine sensitivity; selected
fractional time and mode stay visible. Recognized X picture taps reveal controls
without changing playback, while explicit fullscreen opens StayFast. Paused-video
frame buttons are available in expanded controls, the popup and fullscreen More.

Native iPhone 17 Pro/iOS 26.2 simulator checks pass for inline precision and
frame stepping in portrait and landscape, plus the fullscreen bottom timeline
and More controls. Controlled Chrome X routing passes; authenticated live X
and physical-device behavior remain separate acceptance checks. Reproduce the
browser matrix with `npm run test:e2e:player-controls -- all` and the native
cases in `tests/safari-ios/OwnedPlayerQATests.swift`.
Archive/export/upload/processing and automatic Personal Auto assignment must be
verified in the build 17 local release ledger before claiming Testing.

**0.11.4 (16)** was confirmed **Testing** for both Personal Auto testers on
October 22. Automatic assignment is enabled for Xcode uploads. It corrected
diagonal fullscreen precision seeking and final-release coordinate handling;
build 17 extends the shared gesture to the inline timeline.

## Earlier native-HLS and takeover builds

**0.11.4 (14)** introduced the native-HLS playback candidate. It adds matching
MP4 selection above 2× for X/Twitter, HTML source alternatives and supported
Video.js/Brightcove/JW Player metadata. It preserves position, paused state and
inline/owned presentation, waits for a new clip’s initial Play promise before
automatic selection, and yields to newer site/user intent. Caption, DRM, live,
MSE/blob and unavailable-alternative limits are documented in [Safari playback](safari.md#playback-above-2).
Archive/export/upload/processing and automatic Personal Auto assignment must be
verified in the build 14 local release ledger before claiming Testing.

**0.11.4 (13)** was confirmed **Testing** in Personal Auto for two testers on October 21. Controlled iOS HTML5 videos receive StayFast inline
play/pause, skip, mute, timeline, speed and fullscreen controls by default.
Recognized single-video site chrome is reversibly hidden while captions and
unknown buttons remain. Video/container fullscreen API requests made synchronously
during the active trusted click/keydown route to StayFast, once per event.
Requests outside that event are suppressed; asynchronous site routing is not guaranteed.
Use site player restores native passthrough; More → Apple player explicitly
bypasses interception. The original media/source stays in use, and attachment
does not load, play, move the video into a portal, open fullscreen or scroll.
Closed/private/unsupported players, captured APIs and unknown CSS fullscreen
can bypass takeover. Apple's protected UI cannot be changed; Safari bars may
remain. Actual clipped media below 52px on either axis uses native/site controls;
active owned fullscreen acquires its controls independently of inline fit.
Chrome/Firefox behavior is unchanged. The r4 resources passed Chrome owned
**43/43**, mobile **11/11**, basic **22/22**, dynamic-player recovery and scaled
44px-target checks. Native inline/site fullscreen, primary entry and full owned-player
acceptance passed. A separate genuine live YouTube content-playback check passed;
the original suite's **11/12** and initial ad-gate failure remain recorded.
Physical-device double-tap remains unverified. Additional native phases, final
full-suite output and release verification are recorded in the result record and
local ledger. See [the scoped r4 record](safari.md#build-13-takeover-candidate--r4-verification)
and the local build 13 release ledger for final acceptance and distribution;
the signed build 13 ledger records its completed distribution.

**0.11.4 (12)** is confirmed **Testing** for the two existing testers. The
following build 12 acceptance evidence does not verify build 13 takeover.

### Build 12 acceptance — historical

The primary Full screen action opens
StayFast's owned player, with optional container DOM fullscreen where supported.
Edge double-tap ±10-second seeking, Lock/Unlock and brief seek feedback are
available in that player; center taps do not seek. More → Apple
player explicitly opens Apple's native interface where available; StayFast
cannot add controls to Apple's UI. Ordinary Play stays inline. Safari's browser
bars may remain visible, especially on iPhone. A refused explicit Apple-player
request may restore the same-video StayFast viewport unless newer input,
navigation or a source/session change intervenes. Native fullscreen events never open it.
Source-freeze checks passed native owned-player acceptance, primary entry,
page/nested scrolling, activation, clean appearance and containing-app links.
Chrome passed owned **36/36**, mobile **11/11**, basic **22/22**, and an
instrumented live YouTube rerun **12/12** with unchanged assertions; the initial
YouTube SPA failure remains recorded. Native double-tap is unverified because
XCTest delivered one DOM touch pair even in the no-extension control.
Final frame-boundary (67s) and missing-inline-attribute (90s) checks passed;
portrait, Lock and inline appearance were inspected. Quiet baseline/owned rate
runs passed functional checks at all seven rates through 16×; both retained
strict cadence misses. At 16×, baseline/owned measured 53.1/53.7 callbacks/s,
17/18ms p95 and 131/123ms maximum gaps. Buffered baseline network-stall warnings
remain recorded; no all-green or universal smoothness result is claimed.
App Store Connect's beta description now reflects the owned
primary player, Lock, 16× cap, Apple-player escape and browser-bar limits.
See [the Safari acceptance record](safari.md#build-12-presentation-policy-and-source-freeze-acceptance)
for scope and limits. Final archive, upload, processing and Testing status are
recorded in the local ledger under `build/safari/testflight/0.11.4-build12/`;
this source acceptance record does not establish distribution.

**0.11.4 (11)** is confirmed **Testing** in **Personal Auto**. Its release ledger
and archive are retained under `build/safari/testflight/0.11.4-build11/`.
It contains the Safari playback refinements. Safari's supported request range is
0.07×–16×. Legacy larger absolute preferences are bounded to 16×. Play/seek
restoration retains each source's accepted rate without retrying refused requests;
external preference replacement invalidates this cache. Unchanged custom-player
controls avoid DOM writes during playback progress. These changes remove
avoidable work; actual decoding smoothness still depends on media and device.

**0.11.4 (10)** is confirmed **Testing** in Personal Auto, uploaded from the
reviewed October 21 integration. Its local release ledger and archive are retained
under `build/safari/testflight/0.11.4-build10/`.
App Store Connect inspection confirmed that builds 4–9 processed successfully but
were not assigned to Personal. Build 9 was assigned on October 21, and Apple now
records it installed. The new **Personal Auto** internal group contains the same
two existing testers and is verified as **Automatic for Xcode Builds**. The
original Personal group and its history remain. Future eligible Xcode uploads
are assigned automatically after processing; Xcode Cloud builds still need manual
assignment. Apple locks this choice when a group is created.

### Build 13 release preparation

Build 13 must be archived from the reviewed source. Record its source SHA,
resource hashes, signing/export checks, upload outcome and actual Testing status
in the local release ledger under `build/safari/testflight/0.11.4-build13/`.
An accepted upload alone does not prove tester availability. Never re-upload
accepted builds 1–13. Earlier evidence below is historical.

### Build 13 TestFlight draft copy

**Beta App Description**

StayFast Video provides inline playback controls for supported HTML5 videos in
iPhone/iPad Safari: play/pause, ten-second skips, mute, timeline, speed through
16× and fullscreen. Supported site fullscreen requests open StayFast's player,
with precision seeking, Fit/Fill and Lock/Unlock. More → Apple player opens
Apple's interface where available; Use site player restores the site's controls.
Safari bars may remain visible. Compatibility depends on extension access and
the player; Apple's protected UI cannot be changed. No account is required.

**What to Test**

Check inline controls on plain videos and supported site players. Loading or
attaching a video must not start playback, open fullscreen or move the page.
Check play/pause, seeking, mute, speed, responsive 44px controls and preserved
captions. Try the site's fullscreen button and StayFast Full screen, then Done,
More → Apple player and Use site player. Verify source/playback/scroll retention
and restoration after disable, source reuse or site handback. Report device,
iOS version, site and installed build; private or unsupported players may bypass
takeover. Check physical-device edge double taps separately; simulator delivery
has not established native double-tap acceptance.

**Beta App Review Notes**

Enable StayFast Video in Safari settings, allow website access and reload the
page. iOS video controls are owned inline by default; supported fullscreen API
requests made synchronously in an active trusted click/keydown open StayFast.
Asynchronous site routing is not guaranteed. Use site player restores native controls/fullscreen
passthrough; More → Apple player explicitly opens Apple's interface. Chrome and
Firefox behavior is unchanged.

### Build 12 TestFlight draft copy — historical

**Beta App Description**

StayFast Video adds playback-speed and seek controls to HTML5 video and audio
in Safari. Enable the extension in Safari settings and allow access to your
video websites. Ordinary Play stays inline. Full screen opens StayFast's player
with speed, precision seeking, Fit/Fill and Lock/Unlock around the original
video. Optional container fullscreen depends on Safari support; browser bars
may remain. More → Apple player opens Apple's native interface where available.
Done returns to the page, and Use site player restores the site's controls.
Settings stay on this device; no account is required.

**What to Test**

On iPhone and iPad Safari, confirm ordinary Play stays inline. Tap StayFast's
Full screen control and check play/pause, speed through 16×, precision seeking,
brief seek feedback, edge double-tap ±10-second skips, unchanged center-tap
behavior, Fit/Fill and Lock/Unlock. While locked, check that playback gestures
and keys cannot act and Unlock remains usable. Check the player's fullscreen
button where available; Safari bars may remain visible. Try More → Apple player,
return to the page, reopen StayFast, then use Done and Use site player. Check that
the original video and speed survive each transition and that the page keeps
its intended scroll position. Report the device, iOS version, site and installed
build for any failure. Numeric speed acceptance alone does not establish smooth
playback; note visible or audible problems separately.

**Beta App Review Notes**

Enable StayFast Video in Safari's extension settings, allow access to the test
website and reload the page. The primary Full screen action opens StayFast's
controls around the original video. Optional container fullscreen depends on
Safari support and webpage permissions. More → Apple player is an explicit
handoff to Apple's native interface. No account or backend is required.

## Delivery status — October 19, 2026

**Build 3 is the only build confirmed as Testing in the existing Personal group.**
Apple accepted uploads of builds 4–9, with correct app and extension build numbers,
but their processing completion and tester rollout have not been verified. Upload
success does not establish that an update is available in TestFlight. During the October 19
inspection, the App Store Connect browser session was signed out; no alternative authenticated API
route was found in the bounded configuration checks.

The archived build 3 automatically opens the custom player when visible media
starts playing or is already playing at attachment. Build 9 removes those two
automatic entry paths. A phone still using build 3 therefore has the earlier
presentation behavior. The original Twitter/X scroll jump remains unreproduced;
build 9 provides diagnostic capture rather than proof that the incident is fixed.

An October 19 Safari simulator comparison using the exact archived scripts and
styles reproduces build 3's automatic custom-player takeover with zero document
input. The video moves from viewport Y180 to Y0. Under the same fixture, build 9
keeps it inline at Y180 while playback advances. Document Y remains 720 in both
cases, so this confirms the presentation difference without reproducing a literal
scroll-to-zero. See the [build 3 trace](../test-results/safari-ios/historical-playing-comparison/build3-trace.json)
and [build 9 trace](../test-results/safari-ios/historical-playing-comparison/build9-trace.json).

To complete delivery:

1. Sign in to App Store Connect and inspect **StayFast Video → TestFlight → iOS →
   0.11.3 (9)** for processing completion or any reported blocker.
2. Add build 9 to **Personal** if needed, then verify that the group shows it as
   **Testing**. Preserve the existing testers. Apple requires manual build
   assignment when automatic distribution is disabled; see
   [Apple's internal-testing instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).
3. On the iPhone, update StayFast Video through TestFlight and confirm **0.11.3
   (9)** before testing. Open a fresh Safari tab or reload the old page so its
   content scripts use the installed update.

Do not re-upload accepted build 9. Its verified archive and upload evidence are
recorded below; the remaining gate is actual App Store Connect distribution and
confirmation of the installed build.

## Build 9 — video-load diagnostics verified and uploaded

This is a diagnostic variant, built with `STAYFAST_DIAGNOSTICS=1`. A fresh
Twitter/X page starts one bounded local capture before controller attachment.
The report records media loading, page and nested scroll positions/extents,
controller geometry, focus type, input timing and presentation state. Suspected
near-top jumps preserve before/after evidence and two follow-up frames, including
the video's nested scrollers with their original anonymous IDs, then stop.
Ordinary builds capture only after explicit Start. No report is automatically
uploaded or stored in extension storage; page text, URLs, account details and
input contents are excluded. See [capture instructions and limits](safari.md#capturing-video-load-diagnostics).

The popup provides **Start new capture**, **Stop & prepare report**, **Clear
capture**, **Copy report**, **Share / save report** and a selectable readonly
fallback. The ISOLATED bridge and popup both validate the shared numeric/fixed-label
schema. Collection keeps up to eight frames within 350ms and prioritizes the
main page and media traces over empty ad frames, within count and byte budgets.

Final lint, release builds and **1,080 unit/integration tests across 69 files**
pass (159.22s). Built Chrome passes **110/110** in one sequential command:
diagnostics 6, layout 8, controlled X-host 9, owned player 32, mobile 11, basic 22,
responsive visuals 10 and live YouTube 12. The final artificial-jump report
preserves page Y800→0 and the same nested ID at Y220 before and Y0 in both
incident frames; that fixture does not reproduce the user's real feed incident.
Actual YouTube playback, buttons, shortcuts and SPA navigation pass. No uncaught
page errors or owned browsers/profiles/fixture servers remain. See the
[browser report](../test-results/video-diagnostics/browser-summary.md),
[exported JSON](../test-results/video-diagnostics/video-diagnostics-report.json)
and [unit/integration log](../test-results/video-diagnostics/unit-integration.log).

Frozen SHA-256 values:

| Resource          | Chrome                                                             | Safari                                                             |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| inject.js         | `d174eab703f8640bdc91e2e6e4b2c241576f4be03e9c1c24d6ac2089100d9cec` | `e8cba6a6aceebff850b7a1e7a53fa667d84d131f39f0e92ae7d79c82dfa56d44` |
| content-bridge.js | `fa8bcf7197fb4eb23add1ae8d118607ae63c3ca5e1ff1e23967c9b88eb2db397` | `69cb0c2a990f029aca653f496bcb37669fc84ed12cbbfe9e72290db09599f88d` |
| popup.js          | `620e20605431c49ca692102ec9d921f0d70ea1c2188527149d8c20eb46b769f0` | `765a9d3b1b50d68bb475cef3cf2ce8dd4a4f4d81fdf370b32f08cda2a430f5fe` |

On the dedicated iPhone 17 Pro/iOS 26.2 simulator, final resource/signature checks
and genuine Safari capture/Copy pass. The independently read clipboard contains
43 events, two source loadstarts, page Y720→0 and the same nested ID at 70/220
before the incident and 0/0 in both follow-up phases. The genuine capture/export
flow passes in 68.279s, including Copy and the native JSON share sheet with
**Save to Files** and cancellation. Full inline/native/custom playback and scroll
restoration pass (89.409s), as does strict insertion geometry (5.395s). Fresh
public X capture also passes without tapping Start: reason `diagnostic-build`,
125 events, 60 media snapshots and page Y0–1355. This was unsigned public X,
not the user's authenticated feed; the original literal jump remains unreproduced.
All eight saved/executed native harness files and both standalone fixtures match
byte-for-byte. Fixture PID5698 exited, port62938 is free and the dedicated simulator
is shut down; cleanup evidence is recorded in the native report. See the
[native evidence](../test-results/safari-ios/diagnostic-e8cba6a6/report.md).

The signed `0.11.3 (9)` archive and IPA pass strict signatures, all 25 exact
resources, privacy manifests, encryption declaration, versions and distribution
entitlements. The IPA is **3,835,311 bytes**, SHA-256
`54505cbd8cfb9d503ec54355e564bcbe6208bc83138210ee838af4df1c04f5f9`.
The earlier unsubmitted candidate is preserved locally under
`0.11.3-build9-pre-nested-context`; it was never uploaded. See the
[final ledger](../test-results/video-diagnostics/release-verification.json) and
[prepare log](../test-results/video-diagnostics/testflight-build9-prepare.log).

Apple accepted `0.11.3 (9)` once. Xcode reports **Uploaded package is processing**,
**Upload succeeded** and **EXPORT SUCCEEDED**. The submitted marker completed at
`2026-10-18T01:24:11.699Z` (October 17, 9:24:11pm EDT). The original verified IPA
hash is unchanged. See the
[upload log](../test-results/video-diagnostics/testflight-build9-upload.log).
Do not upload build 9 again. Apple processing completion and the existing
**Personal** group's Testing status remain unverified while the user handles
App Store Connect. Existing testers are unchanged. If build 9 is not assigned
automatically after processing, open **StayFast Video → TestFlight → Personal →
Builds** in App Store Connect and add it to that existing group.

After build 9 is processed and assigned to Personal:

1. Update **StayFast Video** in TestFlight and confirm **0.11.3 (9)**.
2. Open a fresh Twitter/X tab in Safari and reproduce the loading jump.
3. Open Safari's page menu → **StayFast Video → Video diagnostics**.
4. Tap **Stop & prepare report**, then **Share / save report** to export the JSON
   or **Copy report**. Send the exported report with the feedback.

Export before reloading or closing the tab. **Start new capture** retries after a
stopped or ten-minute session. Diagnostic timing can affect a race; the report
helps investigate the incident and is not a claim that the original jump is fixed.

Draft **What to Test** for App Store Connect (not yet saved):

> Diagnostic capture starts automatically in fresh Twitter/X Safari tabs. Scroll
> until videos load and reproduce the jump. Keep the tab open, open StayFast's
> Safari menu, choose Video diagnostics → Stop & prepare report, then Copy report
> or Share / save report and send the JSON with feedback. The report contains
> technical layout/playback events without page text or media URLs. Use Start new
> capture to retry; export before reloading the page.

## Build 8 — adaptive inline controls verified and uploaded

Inline controls now use compact 44px speed/fullscreen targets, with a smaller
visual label that preserves the full accepted rate. Small players retain only
fullscreen; players below 52px in either dimension hide the overlay. Controls
fit the visible, clipped video area and avoid overlapping site headers where
space permits. Visible controls refresh through one shared scroll listener and
one coalesced animation frame per window, without writing page scroll offsets.
The expanded panel anchors below the compact controls and fits the local visual
viewport. A child-frame panel remains confined by its iframe and parent clipping.

A separate insertion fix computes final connected coordinates before returning
to the site's media-readiness handlers. Build 7 briefly doubled controller
coordinates in transformed feed cells, expanding the nested scroll extent. That
fault was reproduced in Chrome on public X and in native Safari fixtures. The
final build removes the transient overflow from insertion onward. The user's
literal live Twitter scroll-to-top incident remains unreproduced; no definitive
cure is claimed.

Frozen inject SHA-256:

- Chrome: `86489a33b066122ac917ea89700ff4789903a6f52d410526bec3fa1629abe651`.
- Safari: `1603b981a7697e4cfc70f073a125e8ffe4feb1385d855afa83de79ebfa0036c8`.

Final lint, formatting and **1,026 unit/integration tests across 66 files** pass
(146.67s). Default, Chrome and Safari release builds pass. Built Chrome checks
pass **92/92**: transformed layout **8/8**, controlled X-host feed **9/9**, owned
player **32/32**, mobile **11/11**, basic **22/22**, responsive visual **10/10**.
Suites run sequentially with zero uncaught page errors and zero remaining owned
processes/profiles. The final owned-player replay updates obsolete panel geometry
and exposes a parent-clipped iframe target before recording scroll baselines;
all subsequent genuine fullscreen and scroll assertions remain mandatory.
See the [browser summary](../test-results/twitter-layout/summary.md),
[unit/integration log](../test-results/twitter-layout/unit-integration.log) and
[lint log](../test-results/twitter-layout/lint.log).

Native Safari passes on the dedicated iPhone 17 Pro/iOS 26.2 simulator with all
25 installed resources exact. Strict transformed-cell insertion preserves page
Y720, nested scroll offsets 70/650 and scroll extent 4000 from insertion through
two animation frames; build 7 briefly expanded it to 5180. Six video/crop cases
pass with 44×44px targets and visible target counts 2/2/1/1/0/1. Compact labels
1/1.8/16/64 pass; the paused 64× acceptance is a layout check, not decoded
throughput evidence. The complete decoded inline/native/custom playback and
scroll-return flow passes. Public NASA videos play inline with correctly fitting
controls during genuine swipes; X's recurring app-promotion prompt limits deeper
unsigned feed exploration. These simulator/live observations do not verify the
user's signed-in feed or a physical iPhone. See the
[native report](../test-results/safari-ios/final-responsive-1603b981/report.md).
Owned fixture processes exited, port 62938 is free, and the dedicated simulator
is shut down.

The signed `0.11.3 (8)` archive and IPA pass strict signatures, all 25 exact web
resources, app/extension versions, privacy manifests, encryption declaration and
distribution entitlements (`get-task-allow=false`, `beta-reports-active=true`).
The IPA is **3,825,066 bytes**, SHA-256
`6bbbb02a07ed9729b22bb5851342924c343c9ca8790b42bcc5911fdc45693a5d`.
See the [release ledger](../test-results/twitter-layout/release-verification.json)
and [prepare log](../test-results/twitter-layout/testflight-build8-prepare.log).

Apple accepted `0.11.3 (8)` once. Xcode reports **Uploaded package is processing**,
**Upload succeeded** and **EXPORT SUCCEEDED**. The submitted marker completed at
`2026-10-18T00:52:56.991Z` (October 17, 8:52:56pm EDT), and the verified IPA hash
remains unchanged. See the
[upload log](../test-results/twitter-layout/testflight-build8-upload.log).
Do not upload build 8 again. Apple processing completion and the existing
**Personal** group's Testing status remain unverified; the user handles those
App Store Connect steps. The two existing testers are unchanged.

To install after Apple processing:

1. In App Store Connect, open **StayFast Video → TestFlight → iOS → 0.11.3 (8)**.
2. Add build **8** to the existing **Personal** group if it is not already listed.
3. On the iPhone, open **TestFlight → StayFast Video → Update**, then open a fresh
   Twitter/X tab in Safari.

Draft **What to Test** for App Store Connect (not yet saved):

> Scroll a Twitter/X feed while new videos load. Check that inline controls fit
> small and cropped videos, stay clear of headers, and simplify to Full screen
> on small players. Videos should stay inline and retain your scroll position.
> Check Full screen and Custom Player entry/exit, then return to the feed.

## Build 7 — feed presentation correction verified and uploaded

Build 7 clears the previous resource's PiP/history resume state, pending
native callbacks and scroll snapshots on `emptied`/`loadstart`. Reusing a feed
video returns it inline while preserving the current page position. Native
fullscreen notifications observe presentation without inventing a post-entry
scroll target.

The frozen Chrome inject hash is
`bfeb4e734044c0e06923888102669e5438e0165bd7e1af40c8f81cc8d8a9c025`;
Safari is
`af41c4ade4598b9b04dbf90e74ca2f2d08592b02156e92ed3f5d016c3da3dc2a`.
Built browser verification passes **74/74**: controlled X-host feed **9/9**,
owned player **32/32**, mobile **11/11**, basic **22/22**. Uncaught errors and
remaining owned processes/profiles are zero. The feed lifecycle events are
simulated and the media is project-owned; this is not live Twitter verification.
See the [browser evidence](../test-results/twitter-inline/summary.md).
Final lint, formatting and **986 unit/integration tests across 66 files** pass
(112.77s). Release resources and the iOS simulator app build successfully.
The signed `0.11.3 (7)` archive and exported IPA pass strict signatures, 25 exact
Safari resources, app/extension versions, privacy manifests and distribution
entitlements (`get-task-allow=false`, `beta-reports-active=true`). The IPA is
**3,823,529 bytes**. See the
[release ledger](../test-results/twitter-inline/release-verification.json),
[prepare log](../test-results/twitter-inline/testflight-build7-prepare.log),
[unit/integration log](../test-results/twitter-inline/unit-integration.log) and
[lint log](../test-results/twitter-inline/lint.log).
Native verification passes on the dedicated iPhone 17 Pro/iOS 26.2 simulator:
activation, four feed cases, and the complete inline/native/custom transition
flow. New and reused videos advance playback inline at page Y720, while active
Custom Player source replacement plus a real app switch/return retains the same
video/controller and page position without reopening. Explicit native fullscreen
and scroll restoration remain functional. See the
[native report](../test-results/safari-ios/final-feed-af41c4ad/report.md).
Activation takes 47.838s and the complete transition flow 96.833s. All six
executed harness files match saved sources; the fixture processes exited,
port 62938 is free and the dedicated simulator is shut down.
These are local Safari fixtures; live Twitter and a physical iPhone remain
unverified.

Apple accepted `0.11.3 (7)` once. Xcode reports **Uploaded package is processing**
and **EXPORT SUCCEEDED**; the submitted marker is
`2026-10-17T23:54:26.919Z`. See the
[upload log](../test-results/twitter-inline/testflight-build7-upload.log).
Do not upload build 7 again. Processing completion and the existing **Personal**
group's Testing status remain unverified while the user handles App Store Connect.
The two existing testers are unchanged.

To install after Apple processing:

1. In App Store Connect, open **StayFast Video → TestFlight → iOS → 0.11.3 (7)**.
2. Add build **7** to the existing **Personal** group if it is not already listed.
3. On the iPhone, open **TestFlight → StayFast Video → Update**, then reload the
   Twitter/X tab in Safari.

Draft **What to Test** for App Store Connect (not yet saved):

> Scroll down a Twitter/X feed and let new videos load. Videos should remain on
> the page and retain your scroll position. Check source changes, returning from
> another app, and entering/exiting Full screen. Full screen opens only when
> selected; Custom Player remains a separate option.

## Build 6 — native verified and uploaded

Build 6 prepares iOS videos with `playsinline` and `webkit-playsinline` even
when the site omitted both. Ordinary Play stays inline while the site's controls
and native fullscreen APIs remain unchanged. Explicit Full screen requests Apple's
presentation; Custom Player remains separate. Inline policy survives custom
close/native exit, yields after eight attribute conflicts, and restores the
latest site intent on Use site player/cleanup. A new source or explicit Custom
Player can re-enable it.

Final lint and **971 unit/integration tests across 66 files** pass in 30.55s;
release resources, Chrome and the simulator app build successfully. Evidence:
[unit/integration log](../test-results/inline-player/unit-integration.log) and
[lint log](../test-results/inline-player/lint.log).

Frozen Chrome `inject.js` SHA-256 is
`dc6352a898983aa76f1afb1dc3f19e89645b2d3b206a352038695140df54513e`;
Safari is
`76c17bfed3fa492665781c9dfb9423013e460f49f78ffef4366811667cbe3bab`.
Final built Chrome checks pass **65/65**: player **32/32**, mobile **11/11**,
basic **22/22**, with a stable source hash, zero uncaught page errors and zero
owned processes/profiles. The clean player repeat resolves an earlier
shutdown-deadline diagnostic. See the
[browser summary](../test-results/inline-player/summary.md).

Signed `0.11.3 (6)` archive/IPA verification passes: 25 exact Safari resources,
strict signatures, privacy manifests and app/extension `0.11.3 (6)`.
Distribution flags are `get-task-allow=false` and `beta-reports-active=true`.
The IPA is **3,823,392 bytes**. See the
[release ledger](../test-results/inline-player/release-verification.json) and
[prepare log](../test-results/inline-player/testflight-build6-prepare.log).

Native activation passes in **52.789s**; the complete final inline-policy flow
passes in **92.265s** (96.667s including orchestration). Both genuine Play
variants advance decoded time at ready state 4,
with inline flags true, native fullscreen false and zero owned hosts. Explicit
native/custom-to-native return preserves inline flags and page Y720; Custom
Done/replay stays inline, and Use site player restores originally absent flags.
The five saved/executed harness files match byte for byte. Fixture/Qorvex
processes are gone, the fixture port is free and the dedicated simulator is
shut down. See the
[native report](../test-results/safari-ios/final-inline-76c17bfe/report.md) and
its inline/native-fullscreen screenshots. Physical-device, live Safari, DRM,
PiP and AirPlay acceptance are outside this local-fixture simulator run.

Apple accepted `0.11.3 (6)`; Xcode reports “Uploaded package is processing” and
`EXPORT SUCCEEDED`. The marker records `submitted` at
`2026-10-17T21:30:14.766Z`. See the
[upload log](../test-results/inline-player/testflight-build6-upload.log).
Build 6 will not be uploaded again. Apple processing completion and **Personal**
Testing status remain unverified while the user handles App Store Connect
authentication. The two existing testers are unchanged. Build 5's fixtures had
inline flags and do not verify this case.

## Build 5 — native verified and uploaded

Build 5 preserves page and composed nested-scroller positions across native
fullscreen and Custom Player transitions, including accessible same-origin
parent frames. Custom close retains the current intentional page position.
Corrections are limited to two animation frames and yield to user input,
navigation and cleanup. An already validated same-origin frame session now
releases upstream layout synchronously before native fullscreen captures scroll;
pending opens remain queued through the validated protocol.

Current Chrome `inject.js` SHA-256 is
`3b97a5a221e42b3bc7e85072ac935c3f09c6d0e7981aa4780042642e6c1e9b78`;
Safari is
`edef00a636bae99da9db3983220bbcefa913ba6683913811e2788455d68ed7b6`.
Final lint and **962 unit/integration tests across 66 files** pass in 42.26s;
default release resources, Chrome and the simulator app build successfully.
Evidence: [unit/integration log](../test-results/scroll-player/unit-integration.log)
and [lint log](../test-results/scroll-player/lint.log).

Corrected built Chrome checks pass **61/61** with stable hashes, zero uncaught
page errors and zero owned processes/profiles. The iframe Custom Player → native
case now restores parent nested offsets to 70/220. See the
[corrected browser summary](../test-results/scroll-player/summary.md) and its
`chrome-scroll-fixed-*` logs.

Native Safari on the exact source passes activation **54.199s**, page scroll
**67.678s**, nested scroll **65.427s**, and same-origin frame scroll **68.379s**
on iPhone 17 Pro / iOS 26.2 simulator. All three presentation transitions pass;
parent/child page Y720 and nested X70/Y220 remain intact with zero errors and
executed parent assertions. See the
[native scroll report](../test-results/safari-ios/final-scroll-edef00a6/report.md).
An additional strict frame replay passes in **70.694s** with mandatory
parent-existence and non-null guards; all four saved/executed harness files
match byte for byte. The fixture exits successfully, its port is free, the
task-owned Qorvex process is gone and the dedicated simulator is shut down.
Physical-device/live-Safari/DRM/PiP/AirPlay acceptance is outside these local
simulator checks.

Corrected signed `0.11.3 (5)` archive/IPA verification passes: all 25 resources
match final Safari; strict signatures/privacy/versions and distribution
entitlements verify. The IPA is **3,823,054 bytes**. See the
[release ledger](../test-results/scroll-player/release-verification.json) and
[prepare log](../test-results/scroll-player/testflight-build5-prepare.log).
Apple accepted `0.11.3 (5)` on October 17, 2026. Xcode reports “Uploaded package
is processing” and `EXPORT SUCCEEDED`. The marker records `submitted` at
`2026-10-17T17:03:08.650Z`. See the
[upload log](../test-results/scroll-player/testflight-build5-upload.log).
Build 5 will not be uploaded again.

The previous candidate's 952 tests / 61 browser checks did not cover an iframe
Custom Player → native transition that reset parent nested scrolling from
70/220 to 0/0. That discovered failure invalidated prior final acceptance.
The `56ce4c…` build 5 archive/export was superseded without upload. Apple
processing and Personal-group assignment remain unverified while App Store
Connect login is failed/expired. The two existing testers are unchanged.
Uploaded build 4 does not verify this change.

## Build 4 — native verified and uploaded

Build 4 passes all local gates and has been uploaded to Apple. Apple processing
completion and Personal-group assignment remain unverified because App Store
Connect authentication expired; the user has been asked to sign in.

Build 4 changes normal playback to inline, with a compact speed pill and a
44px direct native **Full screen** action. **Custom Player** remains a separate
explicit choice. The inline controller follows media bounds, uses a viewport
popover, and collapses after 2.5 seconds of touch inactivity while playing;
pause/keyboard interaction keeps controls available.

Safari speed controls add 6×/8×/12×/16×/32× and custom finite rates from 0.07×
within the target media/native Float32 numeric bound. Chrome/Firefox retain
16×. This request range is separate from achievable decoding speed.

- Final lint and all **926 unit/integration tests across 65 files** pass
  (`npm test -- --maxWorkers=4`, 37.68 seconds).
- Final Chrome owned-player **22/22**, mobile **11/11**, and basic **22/22**
  pass with zero uncaught page errors and clean owned process/profile exit.
  Tested `inject.js` SHA-256 is
  `16245302d9748531e1b92afb2c0bc91db62bfd40b347bc0af8a12a0816ae776a`.
  Evidence: [final Chrome summary](../test-results/owned-player/build4/summary.md).
  Live YouTube **12/12** is prior-candidate evidence (`b986f159…`).
- Final Safari `inject.js` SHA-256 is
  `b7597ad9347247cef5c6092e222645de518ca82ab4a6792cec3b4e61ed27890b`.
  Installed iPhone 17 Pro / iOS 26.2 simulator checks pass **3/3**, no skips:
  activation 50.467s, direct native fullscreen 44.081s, and clean complete
  custom-player replay 219.778s. They verify compact non-stretching controls,
  genuine 32× selection/custom 64× entry while paused, precision/pinch, rotation,
  app switching, and native/custom reopening after site handback with original
  identity/source and zero errors. The simulator and fixture are cleaned up.
  See the [final native report](../test-results/safari-ios/final-b7597ad9/report.md).
- Signed `0.11.3 (4)` archive/IPA at
  `build/safari/testflight/0.11.3-build4/` is verified: 25 exact resources,
  strict signatures, privacy manifests, app/extension build 4, and distribution
  entitlements `get-task-allow=false` / `beta-reports-active=true`. The IPA is
  3,821,808 bytes. See the
  [release verification ledger](../test-results/intuitive-player/release-verification.json).
- **Uploaded:** Apple accepted `0.11.3 (4)` on October 17, 2026. Xcode reports
  “Uploaded package is processing” and `EXPORT SUCCEEDED`. The upload marker
  records `submitted` at `2026-10-17T16:40:04Z`. See the
  [upload log](../test-results/intuitive-player/testflight-build4-upload.log).
  Apple processing completion and assignment to **Personal** remain unverified.
  The App Store Connect browser session expired and login failed; the user has
  been asked to sign in before distribution can be verified. Build 4 will not
  be uploaded again. The two existing Personal testers remain unchanged.

A separate native MP4 probe measured time/presented-frame progress at requests
above 16× on the iPhone 17 Pro / iOS 26.2 simulator; it excludes extension control
and complements the product UI checks without proving audio quality or a
universal maximum. Physical-device, live Safari, DRM, PiP and AirPlay acceptance
remain unverified. See the [rate report](../test-results/safari-ios/native-rates/report.md).
The copy below is a build 6 draft; the saved TestFlight metadata still describes
published build 3 until an explicit metadata update is verified.

## Published internal TestFlight — build 3

Build 3 used automatic custom-player expansion. Its source added precision
scrubbing, More, Fit/Fill/pinch, remaining time, Replay, live-edge seeking, and
native audio/volume capability controls.
Lint and all **883 unit/integration tests across 63 files** pass. Final built
Chrome touch/keyboard checks pass **16/16**, including fine-scrub sensitivity,
pinch, More, 44px targets, site-touch isolation, and lifecycle restoration.
There are zero uncaught page errors; owned Chrome processes/profiles are cleaned.
The checked-in native owned-player harness passes on iPhone 17 Pro / iOS 26.2
simulator with these exact resources: fine scrubbing, pinch, HUD hide/wake,
speed quick actions/system selection, rotation, app switching, and page/site
handback retain the original media/source and decoded playback with zero
page/media errors. Visible native selects measure 46px. Physical-device,
mobile live-site, PiP/AirPlay, and protected-media checks remain incomplete.
The separate More → Use site player/native fullscreen return check also passes;
the dedicated simulator and fixture have been cleaned up.
Apple accepted build 3 on October 16, 2026. Xcode reports
“Uploaded package is processing” and `EXPORT SUCCEEDED` with exit status 0.
Apple processing is complete. The existing **Personal** group shows
`0.11.3 (3)` as **Testing**, expiring in 90 days, with both existing testers
retained. The accepted build will not be uploaded again. See the
[upload log](../test-results/owned-player/testflight-build3-upload.log).
Publication evidence: [build 3 Testing](../test-results/owned-player/testflight-build3-testing.jpg)
and [saved beta details](../test-results/owned-player/testflight-build3-details-saved.jpg).
See the [final native report](../test-results/safari-ios/final033650/report.md)
and its portrait/landscape/site-handback screenshots.

Final signed `0.11.3 (3)` archive and IPA are prepared at
`build/safari/testflight/0.11.3-build3/`. Both app and extension pass strict
distribution-signature verification and include privacy manifests. TestFlight
entitlements have `get-task-allow=false` and `beta-reports-active=true`.
All 25 embedded extension files match the frozen minified resources;
`inject.js` SHA-256 is
`0336507b5faee3cc4c1a3682bfbe9aa014e72dc61c2eaa0fe68fc70e8156dcfd`.
Chrome runtime evidence is in
[`chrome-expanded-final.log`](../test-results/owned-player/chrome-expanded-final.log)
and [`chrome-final-hashes.log`](../test-results/owned-player/chrome-final-hashes.log).

The new player retains the original video/source and adds full-viewport playback,
precision scrubbing, speed selection, absolute 1×/Pref actions, mute, available
captions/audio languages, and feature-gated PiP/AirPlay. Done restores the page; Use site player releases
ownership for that video. Safari browser chrome and cross-origin frame boundaries
remain platform limits. The expanded Beta App Description and What to Test
precision-scrubbing instructions/feature guide are saved in App Store Connect.
No external group or public invitation was created.

## Previous published result — build 2, October 16, 2026

- **App record:** StayFast Video exists in App Store Connect, Apple ID
  `6823759661`, bundle `co.staytech.stayfast`.
- **Archived / exported:** corrected signed Release archive and App Store
  Connect IPA `0.11.3` build `2` succeeded. IPA:
  `build/safari/testflight/0.11.3-build2/Export/StayFast Video.ipa`.
- Archive/export signatures and TestFlight entitlements verify for both app
  and embedded extension. Both are `0.11.3 (2)` and contain the privacy files.
- **Validation correction:** Apple explicitly rejected build `1` before
  acceptance because its Safari manifest description was 114 characters.
  The Safari build now uses a 106-character description; a regression test
  enforces Apple's 112-character limit. Other browser descriptions are unchanged.
- **Repository gate:** lint, all **780 unit/integration tests**, and Chrome
  and Safari release builds pass.
- **Uploaded:** Apple accepted `0.11.3 (2)` on October 16, 2026 at
  4:41 p.m. America/New_York. Xcode reported “Uploaded package is processing”
  and “Upload succeeded.” Apple processing has completed; no duplicate upload
  was attempted.
- **Internal testing at publication:** Personal showed `0.11.3 (2)` with
  status **Testing**. The beta description, feedback address and public
  privacy/marketing links were saved. External testing was not enabled.
  Evidence: `test-results/testflight-personal-testing.jpg`.
- **Native runtime:** the simulator app matches all 25 extension resources
  in the uploaded build `2`. On iPhone 17 Pro / iOS 26.2, activation, decoded
  1.5× playback, fullscreen return, app switching, and the current normal /
  preferred-speed buttons pass. The preferred button sets 1.8×; repeated
  normal-speed taps set 1×. Targets measure at least 44px, with one controller
  and zero errors. Screenshots/results are under `test-results/safari-ios/build2-*`.
- **Browser access:** the temporary Chrome automation blocker cleared.
  App Store Connect processing, group assignment and invitation were verified.

## App record

| Field                          | Value                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Platform                       | iOS                                                                                     |
| Name                           | StayFast Video                                                                          |
| Primary language               | English (U.S.)                                                                          |
| Bundle ID                      | `co.staytech.stayfast`                                                                  |
| Embedded extension             | `co.staytech.stayfast.Extension`                                                        |
| Suggested SKU for a new record | `STAYFAST-VIDEO-IOS`                                                                    |
| Version                        | `0.11.3` from `package.json`                                                            |
| Build                          | Positive integer passed as `--build=N`; increment after Apple accepts an earlier build. |
| Category                       | Productivity                                                                            |
| Subtitle                       | Safari video speed control                                                              |
| Support URL                    | <https://github.com/KyleStay/video-speed-controller/issues>                             |
| Privacy policy URL             | <https://github.com/KyleStay/video-speed-controller/blob/main/PRIVACY.md>               |
| Marketing URL                  | Optional; <https://github.com/KyleStay/video-speed-controller>                          |

The repository and existing public privacy file were verified through GitHub's
API. Keep these URLs public. The browser-store title is 32 characters and must
not be copied into Apple's 30-character name field; the name above is 14 and
subtitle is 26. Preserve an existing app record/SKU if one is already registered
for this bundle ID. [Apple's app-record guide](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
describes the creation fields.

## Local archive, export, and upload

The checked-in export options use the existing Apple team `TF2BG2VDPD` and
automatic App Store Connect signing. Use an unrestricted signing context for
Xcode credentials/provisioning; sandbox account errors alone do not establish
that the account needs repair.

```sh
npm run testflight:safari -- --build=13          # Resources, archive, export locally
npm run testflight:safari:archive -- --build=13  # Archive only
npm run testflight:safari:export -- --build=13   # Export an existing archive
npm run testflight:safari:upload -- --build=13   # Explicit Apple upload
```

These examples target the next candidate; builds 1–12 have already been accepted.
Artifacts are under `build/safari/testflight/0.11.4-build13/`:
`StayFast Video.xcarchive`, `Export/` for the `.ipa`, and `Upload/` for upload
output. Change the directory's version/build to match the command. The archive
must embed the extension, complete minified Safari resources, `Privacy.html`,
and privacy manifests. Verify signatures and the built app/extension version
before uploading.

The upload action requires a prior local `.ipa` export. Its attempt marker
prevents automatic duplicate submissions. After an uncertain attempt, inspect
App Store Connect processing before retrying; never upload an already accepted
version/build again.

## Build 6 TestFlight draft copy — historical

**Beta App Description**

> StayFast Video adds playback-speed and seek controls to HTML5 video and audio
> in Safari. Enable the extension in Safari settings and allow access to your
> video websites. StayFast prepares inline playback while keeping the site's
> controls unchanged. Tap the compact speed pill for
> speed/seek controls, or Full screen to open Apple's video fullscreen directly.
> Presentation changes preserve your place on the webpage and in nested scroll areas.
> Custom Player opens StayFast's separate viewing surface with play/pause,
> precision scrubbing, Fit/Fill, remaining time, and available language/system
> controls. Move your finger above or below its timeline for finer scrubbing.
> More offers available captions/audio languages, supported system controls,
> and Use site player. Higher playback rates depend on the device and media.
> Preferences stay on this device;
> no StayFast account, advertising, or app analytics service is required.
>
> This beta requires iOS or iPadOS 18.4 or later. Done returns the custom player
> to the webpage; Use site player restores its original controls. Safari may
> keep browser bars visible in the custom player, and cross-origin embeds
> remain within their frame.
> Picture in Picture uses Apple's controls. Compatibility depends on the website and media player.

**What to Test**

> Enable StayFast Video under Settings → Apps → Safari → Extensions and allow
> access to your test websites. Reload an existing Safari tab after granting
> access. Start an HTML5 video and verify playback stays inline.
> Include a page that normally opens native fullscreen when Play is tapped;
> verify ordinary Play now stays on the page until you explicitly choose fullscreen.
> Tap Full screen and verify it enters Apple's video fullscreen without an intermediate custom
> view. Exit and check original source, position and speed.
> Start with a scrolled webpage and nested scrolling area; check their positions
> after native fullscreen and Custom Player entry/exit, including same-origin
> embedded players. An intentional page scroll while the custom view is open
> should be retained on close. Begin a new scroll during a transition and verify
> the page follows your input. Check inline size, hide/recovery, panel placement,
> 2.5-second idle collapse while playing, and
> paused/keyboard access. Try available higher speeds and report actual playback
> progress or rejection/clamping rather than only the displayed requested rate.
> Open Custom Player explicitly. Select 1.5× and check decoded playback.
> Try play/pause, scrubbing, ten-second
> skips, and mute. Drag farther above/below the timeline for half, quarter, and
> tenth-speed precision; check that playing video pauses and resumes on release.
> Test More/Escape, Fit/Fill/pinch, duration/remaining time, Replay, Go live, and
> any available captions/audio languages, volume, PiP, and AirPlay. Try
> hiding/waking controls, Done/reopen, More → Use site player, portrait/landscape,
> and scrolling to another video. Switch
> apps and return, and navigate back/forward. Report the site URL, device/iOS
> version, expected result, and observed result. Avoid sharing private page
> content in feedback.

**Beta Review Notes**

> This app contains a Safari Web Extension; the native app provides activation
> instructions, an offline privacy policy, and support. No sign-in or purchase
> is required. Open the app once after installation. In Settings → Apps →
> Safari → Extensions, enable StayFast Video and allow website access. Return
> to Safari and reload a page containing an inline HTML5 video. Start playback
> inline, tap the speed pill, and select 1.5×. Full screen requests Apple's
> native video presentation directly; Custom Player opens the optional StayFast
> viewing surface. Done returns that view to the page; Use site player restores
> site controls. The extension
> runs only on websites permitted by the user. Its overlay is part of the
> webpage and does not appear inside Safari's native fullscreen/PiP interface.
> Preferences and page processing stay on the device.

Select **Sign-in required: No**. Enter a real monitored **Feedback Email** and
the review contact's real name, email, and telephone in App Store Connect; these
values are not fabricated in this packet. External testing requires beta test
information and Beta App Review. Screenshots for a full App Store product page
are separate from the local archive and internal TestFlight setup.
[Apple's TestFlight information guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/)
and [TestFlight overview](https://developer.apple.com/testflight/).

## Privacy and export answers

- **Data collection:** No data is collected by the app or integrated SDKs.
  Native code loads bundled pages and opens Safari settings/support; there are
  no analytics, ads, account, or backend SDKs. Browser media/page processing and
  extension settings stay local. The source privacy manifest declares no
  tracking, collected data, or required-reason API use; direct native-source
  inspection found no UserDefaults/file-timestamp API use requiring a reason.
- **Tracking:** No. No tracking domains or advertising identifiers.
- **Encryption:** `ITSAppUsesNonExemptEncryption=false` is present in app and
  extension metadata. The app adds no custom encryption implementation.
- **Permissions:** Safari extension website access and storage; no native
  camera, microphone, photo-library, or location permission is used.
- **Policy access:** The containing app includes an offline policy and support
  links. TestFlight diagnostics/voluntary feedback are identified separately
  from the app's local processing. Apple operates TestFlight under its terms.
- Complete Apple's age-rating and other current questionnaires from the actual
  app behavior. This app supplies no media catalog, chat, subscriptions, ads,
  or in-app purchases. Third-party web playback occurs in Safari.

[Apple's app-privacy guide](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
requires a policy URL and published accurate answers. The native in-app policy
link addresses [App Review guideline 5.1.1](https://developer.apple.com/app-store/review/guidelines/#privacy).

## Screenshots for the eventual App Store listing

Capture the actual iOS extension in Safari, not Chrome emulation. Suggested
screens: expanded inline speed controls, popup, preferences, and activation
instructions. Use the owned synthetic media fixture to avoid third-party media
rights or private account content. The native QA guide is
[tests/safari-ios/README.md](../tests/safari-ios/README.md).

Apple currently requires an iPhone Dynamic Island medium-display screenshot
and a 13-inch iPad screenshot for this universal app; use an accepted size such
as **1206×2622** and **2064×2752** respectively. Provide at least one image per
required set; images must have no alpha/transparency. Confirm the current
accepted sets in [Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
before submission. Store screenshots do not replace device acceptance tests.

## Install the internal beta

1. On your iPhone/iPad, install Apple's TestFlight app if needed.
2. Open the invitation sent to the account-holder address. Tap **View in
   TestFlight**, accept the invitation, then **Install** StayFast Video.
3. Open StayFast Video once. In Settings → Apps → Safari → Extensions →
   StayFast Video, enable the extension and allow the desired website access.
   Reload your Safari video page and tap the speed pill.
4. Complete physical iPhone/iPad and live-site checks from
   [Safari acceptance](safari.md) before broader rollout. Simulator evidence
   is narrower than physical-device verification.

External testers require a separate group, actual review contact information,
and Apple's Beta App Review. The prepared description/review copy above can
be reused for that workflow. No external group or public invitation was created;
the two existing Personal testers are retained.

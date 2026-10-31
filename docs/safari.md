# Safari development and acceptance

The Safari edition shares the Chrome/Firefox media engine and adds an Apple
containing app plus an interface for coarse pointers. The target is Safari
18.4+, iOS/iPadOS 18.4+, and macOS 15.4+. Build and runtime verification are
separate: the native project and resources are development inputs until the
acceptance checks below pass on the intended devices.
For signed iOS distribution and ready-to-use App Store Connect metadata, see
[the TestFlight release packet](testflight.md).

The owned fullscreen timeline sits below the playback options at the bottom safe
edge. Its visible track is 3px with a 12px thumb; the slider retains a 44px touch
region and distance-based precision scrubbing. Progress follows both playback and
the pending scrub preview, including nonzero live seek bounds.

Primary inline and fullscreen actions use borderless icons with accessible names
and at least 44px touch targets. Speed and time stay numeric; additional options
retain descriptive labels. The star sets preferred speed, the padlock locks
controls, the ellipsis opens More, and the close (×) icon returns to the page.
Icon shadows preserve contrast over the picture.

## Custom WebM decoders

On iOS, an expanded OGV surface with one custom renderer and an explicit HTTP(S)
WebM source can use native decoding and the owned inline/fullscreen interface.
The adapter probes that exact source off DOM and waits for `loadeddata` before
pausing or hiding the original renderer. A native decode/play failure leaves or
restores the original player. No source URL construction or extension fetch is
involved. The adapter does not claim arbitrary canvas players.

Discovery shares the existing bounded mutation/shadow walk and captured decoder
readiness events. It allows eight simultaneous probes, a ten-second loading
deadline and one attempt per renderer/source until removal or a new source.
Site Play/Pause yields ownership before calling the original method; Stop cancels
even a pending probe. Source/document/root changes, removal, disable and Use site
player remove the native video and restore owned methods, markers and chrome.
Only the exact renderer and its recognized transport are hidden by scoped CSS.

`node tests/e2e/run-isolated.js custom-webm` covers the built extension with a
neutral local decoder surface and a real native WebM. Native Safari coverage is
`CustomWebMQATests/testNativeTakeoverAndReturn` against `/custom-webm.html` from
the iOS fixture server. These fixtures simulate the original decoder API;
compatibility with a deployed decoder and physical-device behavior are separate
runtime checks.

## Open Twitter regressions

These October 26, 2026 reports remain open after TestFlight 0.11.6 (25).
Keep the original report separate from a passing controlled fixture. A fix must
retain repeatable regression coverage and record the exact browser, device,
source build and observed result before its status becomes verified.

| ID      | Reported behavior                                                                                                         | Required acceptance                                                                                                                                                                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SF-TW-1 | Picture freezes or stutters and audio cuts out at speeds above 2× in iPhone Safari Twitter videos.                        | Check 2×, 2.1× and 4× on an affected post, decoded frame cadence and media-time progress, audible output, same-clip rendition selection, scroll/pause retention and the next feed clip. Measure audible continuity independently from video cadence and speed readback; a numeric playback rate or one 720p fixture alone is insufficient. | Physical iPhone reproduction found a new X current-track metadata path and an appended HLS transport marker that bypassed MP4 selection. The resolver candidate now selects the same live clip’s MP4 at 2.1×/4× in the normal feed. Independent phone recordings confirm continuous MP4 4× audio versus rate-dependent HLS silence. The expanded viewer also passes at 2.1×; final release verification remains open. See [research and device evidence](research/ios-fast-playback.md#physical-iphone-comparison--october-26-2026). |
| SF-TW-2 | Picture-swipe seeking regressed for videos embedded in tweets in the normal feed, after overlay/viewer support was added. | A navigable tweet wrapper and focusable X picture trigger must allow a genuine horizontal seek. Retain vertical page scrolling, pinch, small buttons/links, normal playback and the existing generic overlay/expanded-viewer cases.                                                                                                        | The physical iPhone exposed another rejected target: the legacy `video-player-mini-ui-<post>` picture beneath a focusable `videoComponent` wrapper. Exact-target recognition now has a matching swipe regression and negative tests for independent controls, ambiguous media and incorrect geometry; final phone/release acceptance remains open.                                                                                                                                                                                   |
| SF-TW-3 | Twitter's mute action is difficult to reach.                                                                              | A 300px embedded player must expose a visible mute/unmute action with a measured 44px target, without seeking, opening fullscreen or changing playback. Verify responsive boundaries and keep independent site controls usable.                                                                                                            | Candidate fix retains mute at 240px width/96px height. Controlled 300px mute/unmute taps pass with 44px targets; live acceptance remains open.                                                                                                                                                                                                                                                                                                                                                                                       |
| SF-TW-4 | Opening a video fullscreen must not lose the user's place in the normal Twitter feed.                                     | Enter fullscreen from a partially visible embedded video well down the feed, then return using StayFast Close and any available browser exit. Keep the same tweet and its visible offset on entry and return, including repeated transitions and rotation. Check page and nested scrolling; preserve deliberate navigation or scrolling.   | Candidate fixes preserve placeholder margins and isolate document-video fullscreen exits. Natural-flow page/nested browser and iOS simulator checks pass; live normal-feed acceptance remains open.                                                                                                                                                                                                                                                                                                                                  |

The resolver and inline-player unit suites cover the candidate changes for
SF-TW-1 through SF-TW-3. SF-TW-4 has device-free layout and native-event regression
coverage described below. Native fixture and browser evidence belongs with the corresponding
test run; a prepared or uploaded build does not close the original live-site
report.

For SF-TW-2, the broad composed-path control exclusion added for overlay support
can reject a picture drag because a tweet ancestor or picture wrapper is focusable.
Build 25 covered the modern XDS picture trigger. A later authenticated physical
phone trace found the legacy feed's `video-player-mini-ui-<post>` surface inside
`videoComponent`: trusted horizontal pointer moves reached the picture but were
rejected before gesture commitment. Recognize only that exact hit target with its
observed wrapper structure, one video, full-picture bounds and an in-picture hit.
Descendant buttons/links and ambiguous or unrelated surfaces retain site input.
The retained tests cover both modern XDS and legacy mini-UI structures.

For SF-TW-4, record the tweet identity and its viewport position before entry,
while fullscreen is open, and after returning. Numeric scroll offsets alone do
not prove the same place in a dynamically laid-out feed. The owned player retains
a placeholder and bounded scroll snapshots; closing currently refreshes offsets
to preserve newer page/site movement. Investigate presentation-induced layout or
scroll changes separately from deliberate movement before changing that policy.
Device-free SF-TW-4 verification now uses a natural-flow feed near its page or
nested scroll-range end. The original placeholder omitted media margins: a 30px
margin on each vertical side shortened the feed by 60px, clamped scrolling and
left the tweet displaced after return. The placeholder now retains all four
margins. Native fullscreen events also distinguish an observed document-video
session from an older owned-container exit, resetting that distinction when a
feed reuses the video source. This prevents a delayed container exit from
consuming a newer Apple-player scroll snapshot.

In an owned source copy, build with `npm run build:release` and run
`node tests/e2e/run-isolated.js twitter-feed-position`. The built extension
checks tweet identity, viewport position, neighboring-post geometry and page/
nested offsets at the scroll-range end, twice per case and through a
portrait–landscape–portrait cycle. Zero-margin controls and 30px-margin
regressions are both required. The old source fails both margin cases by 60px;
the candidate passes all four. `FeedPositionQATests/testNearEndFeedPosition`
uses the same fixture geometry in native iOS Safari with an MP4; it requires
ready media, a nonzero range and a genuine near-end entry boundary. Page and
nested runs pass on the iPhone 17 Pro/iOS 26.2 simulator. Source-reset and
delayed-exit event ordering are covered by ownership unit tests.

These controlled checks establish repeatable regressions without physical
hardware. The authenticated live Twitter feed and other site-induced layout/
virtualization changes remain separate acceptance checks; neither this fixture
nor a TestFlight upload closes that original report. Evidence is retained under
`test-results/twitter-feed-position/`, with the simulator result bundles in the
owned QA copy recorded there.

## Inline timeline and precision gestures

The inline seek rail is independently positioned at the clipped video's bottom,
with a 3px track, 12px thumb and 44px touch target. The speed/transport strip
remains compact at the top; the controller does not grow into a video-sized
hit box. Existing placement events update rail coordinates after occlusion and
ancestor scaling, without writing scroll or polling.
Site metadata and controls do not move the rail upward.
By default, unknown site controls can overlap it and retain their input priority;
uncovered rail input, keyboard seeking and picture swipes remain available.
The popup's **Hide site video buttons** option and **Advanced → Site rules →
Hide buttons** opt into broader suppression for a matching site rule. It applies
live to playing, paused and newly inserted HTML controls in a validated player
scope. Captions, media and StayFast controls remain visible. Unbounded or ambiguous
player containers retain site controls. The popup offers Settings for arbitrary
path/regex rules so a quick toggle cannot extend their speed or disable policy
to other pages. Turning the preference off restores the default suppression;
**Use site player** releases iOS ownership even while the preference is on.
The top transport retains its vertical position relative to the video as the page
scrolls. When its anchor passes the viewport edge or under a header, that strip
hides instead of sliding down over the picture; the bottom rail remains independent.
Inline and fullscreen controls use one visibility state for their buttons and
timeline, with a four-second idle delay while playing. Tap the picture to toggle
the interface; recognized single-video site overlays share this behavior without
consuming unrelated site actions. Mouse movement and control/keyboard input reveal
it. Paused playback, active scrubbing, held pointers, keyboard focus and open menus
prevent idle hiding; release or menu dismissal starts a fresh interval. A picture
tap dismisses an open menu first, keeping the transport visible. Explicit taps can
hide paused controls, and progress updates preserve that choice. Hidden inline
controls retain their geometry and keyboard access while ignoring pointer input. Inline players below 240px wide
or 144px high retain visible fallback buttons because their picture offers too
little reliable space for reveal taps. Scrolling may still clip the top strip
independently, without waking an idle timeline.

Swipe horizontally anywhere on the picture to scrub, including when controls
are hidden. Once the swipe is horizontal, move your finger up or down from its
starting position for finer precision. Vertical-only movement does not jump the
selected time. A vertical swipe before scrubbing begins still scrolls an inline
page. Taps retain interface visibility behavior; pinch remains available. The
video pauses only after the scrub begins and resumes only if it was playing.

Unknown site overlays also forward horizontal drags when they share a
picture-sized container with exactly one video. This gesture-only fallback
leaves the overlay visible and preserves independent buttons, links, editable
controls, unrelated dialogs, vertical scrolling and browser pinch. A site's
expanded video viewer can forward drags from an overlay outside its recognized
inner player; a dialog containing that video remains eligible within its picture
boundary. It checks at most eight ancestors and revalidates media ownership on
input; existing composition recovery
refreshes the scope without polling. Zero-sized wrappers with visible overflow
or `display: contents` may be crossed within that bound, covering feed layouts
with a tracking wrapper between the video and sibling overlays. Larger page
regions, ambiguous media,
extension-inaccessible frames and overlays outside that container remain outside
the fallback. StayFast's **Full screen** player provides a separate scrub surface
for those layouts. Local fixtures do not establish all-site or live X
expanded-viewer acceptance.
Fallback picture taps also dismiss an open speed menu and toggle the interface.
Before a fallback drag commits, one hit test at the original touch point checks
that the same single-video scope remains exposed; a new modal, control or second
media element prevents the scrub. Once committed, precision movement may leave
the picture. Focusable player and video-dialog roots retain picture gestures.

Inline and owned fullscreen timelines share `IOSPlayerScrubber`. Hold the
playhead, move upward into the video to select half, quarter or fine sensitivity,
then drag horizontally. The selected fractional time remains visible; modified
sensitivity is labeled `×1/2`, `×1/4` or `×1/10`. Normal (1×) scrubbing has no rate label.
Vertical-only movement and return toward the rail do not jump the selected time; release consumes the final coordinates. Cancellation, source
changes, handback, presentation changes and cleanup cannot resume stale playback.
The shipped gains remain 1, 0.5, 0.25 and 0.1; these are StayFast choices.
[Apple's documented gesture and known limits](research/ios-precision-scrubbing.md)
distinguish iOS 5/6 manuals from unspecified private thresholds and return rules.

On exact, unambiguous recognized X players, a lazy click listener reveals owned
inline controls on a genuine picture tap without toggling playback. Only an
explicit recognized fullscreen button or same-post video link opens StayFast.
Modern X recognition requires its direct-video/XDS-trigger structure; captions,
unrelated elements, ambiguous players, site handback and unknown links remain
outside ownership. Fullscreen routing still requires the current trusted event;
no authorization is stored across events. Current live X's navigation link was
observed in Chrome; authenticated X theater behavior needs separate Safari proof.

**Frame back** and **Frame forward** are available in the expanded controller,
toolbar popup and owned fullscreen **More** panel. They seek using detected FPS
or the configured fallback, only while a seekable video is paused. They do not
pause playback automatically or write playback rate. Native Apple fullscreen
continues to use Apple's controls.
The popup refreshes status once after a frame command, preserving speed controls
when playback resumes before the click and retaining mixed rates across frames.

## Build 13 takeover candidate — r4 verification

**0.11.4 (13)** replaces controlled iOS HTML5 video controls inline by default:
responsive 44px play/pause, ten-second skips, mute, timeline, speed and fullscreen.
Attachment sets `controls=false` and inline flags on the original node without
portal movement, source changes, load/play calls, fullscreen entry or page-scroll
writes. Recognized single-video YouTube, Video.js, Plyr, JW Player and X chrome
is hidden through scoped, reversible selectors; captions and arbitrary unknown
buttons are preserved. Done returns to owned inline controls; **Use site player**
restores the site's controls and native fullscreen passthrough.

`IOSPlayerTakeover` installs lazy per-window prototype hooks only on iOS. Supported
controlled video/container fullscreen API requests made synchronously during
the current trusted click or keydown open StayFast's owned player. The native
current event must still be dispatching and can authorize only one request;
there is no stored gesture token or authorization timer. A separate lazy X-only
click listener handles recognized picture reveal and explicit fullscreen links. Requests
without that event are suppressed; asynchronous site requests have no routing guarantee.
Explicit **More → Apple player** uses the native bypass. Cleanup restores only
StayFast's own hooks and owned attributes/styles, preserving subsequent site edits.
Ordinary playback/loading does not trigger a portal or fullscreen takeover.

Scope is supported HTML5 videos in extension-accessible frames. Closed shadow
trees, private/unsupported embeds, previously captured native APIs and unknown
CSS fullscreen can bypass interception. Apple's protected player UI cannot be
modified, and iPhone Safari bars may remain. Chrome/Firefox behavior is unchanged.
Build 13 was confirmed **Testing** in Personal Auto for two testers on
October 21, 2026. Automatic assignment succeeded; the signed release ledger is
`build/safari/testflight/0.11.4-build13/release-ledger.json`. The frozen r4 resources passed Chrome owned-player
**43/43**, mobile **11/11** and basic **22/22** checks. Built-fixture checks also
passed dynamic player ambiguity/class recovery and 44px targets at 0.75×/2×
scaling. The native iPhone 17 Pro/iOS 26.2 simulator passed inline/site fullscreen
(38.999s), primary entry (71.567s) and full owned-player acceptance (230.672s).
Additional page/nested/frame scroll, missing-inline-attribute and appearance
acceptance is recorded phase by phase in [the native result record](../test-results/takeover/r4-native-acceptance.json)
and local release ledger; only completed phases count as passed.

Live YouTube initially passed **10/12**; an unchanged-assertion diagnostic run
passed **11/12**, retaining one play `AbortError` amid ad/source churn on the
same controlled video. The initial separate content probe's ad-gate timeout is
retained. A second separate probe passed after genuine Play and visible Skip,
then Pause/Play: time advanced 0.13549→1.270889s, decoded frames 7→35 and eight
presented callbacks were observed. Genuine D changed 1×→1.1× and R restored 1×;
the video/source remained the same, content was not an ad and its controller
stayed connected. It recorded zero page errors and cleaned up all owned Chrome
processes/profiles. This separate pass does not change the original suite's
**11/12** result. Final full-suite output belongs to the local release ledger.

Native physical-device double-tap remains unverified; the simulator's one-touch-pair
delivery gap is unchanged. No physical-device, all-site, audio, DRM or AirPlay
acceptance is claimed. Final acceptance/distribution belongs to the local build 13
release ledger and test results. The X playback change below is newer than build
13 and has not been uploaded.
The build 12 records below remain historical evidence for the earlier policy.

## Build 12 presentation policy and source-freeze acceptance

**0.11.4 (12)** is Testing for the two existing testers. Its primary **Full screen** action opens
StayFast's owned player around the original media. **Custom Player** remains an
explicit alternate entry. Ordinary Play stays inline; loading or playing media
does not automatically open the player or move the page.

The owned player includes edge double-tap ±10-second seeking and brief feedback;
center taps do not seek. **Lock** hides controls/feedback, cancels queued scrubbing
and blocks playback keys/gestures while preserving Unlock and keyboard navigation.
Light-DOM video/container `touch-action` ownership lasts only for that session.
Its optional
container fullscreen uses the DOM fullscreen API only where Safari and the
frame's permissions allow it. `ios-player-fullscreen` owns that target's
listeners and exit lifecycle, guards deferred completion against stale sessions,
and leaves the media's native APIs unchanged. iPhone Safari browser bars may
remain visible. **More → Apple player** is the explicit native-fullscreen escape
where supported; StayFast cannot change Apple's controls or place its own
controls inside Apple's player or Picture in Picture.
An explicit Apple-player denial may restore the same-source StayFast viewport
without play or fullscreen requests. Newer input (including wheel), navigation,
source/session changes or cleanup cancel recovery; native fullscreen events never open it.

The original media, source/srcObject, MediaSource, MediaKeys and tracks remain
in use. The 0.07×–16× range, source-generation invalidation and bounded page/nested
scroll restoration still apply. High-rate numeric acceptance does not establish
smooth decoding.

The frozen candidate passed native owned-player acceptance (`accept-owned-reveal`),
primary entry, page and nested scroll checks on the iPhone 17 Pro/iOS 26.2
simulator. The final containing-app batch passed activation, clean player
appearance and links. Chrome passed owned-player **36/36**, mobile **11/11** and
basic **22/22** checks. An instrumented live YouTube rerun passed **12/12** with
the same assertions; the initial SPA-navigation failure is retained in the evidence.
Native artifacts and resource identity are under `test-results/owned-fullscreen/`.
The final frame-boundary check passed in 67 seconds: all three presentation
phases preserved true pre-entry child/parent positions within 2 CSS pixels,
source identity and zero page/media errors. The missing-`playsinline` regression
passed in 90 seconds. Final portrait, locked-player and inline screenshots were
inspected successfully.

Native touch double-tap remains **unverified**: XCTest delivered only one DOM
touch pair even on a standalone control without the extension. Chrome touch-pair
checks and unit tests pass; physical-device follow-up is required. These results do not establish
physical-device, all-site, audio, DRM
or AirPlay acceptance. Final archive/upload/Testing status belongs to the local
build 12 release ledger described in [the release packet](testflight.md).
The records below describe earlier candidates.

### Final paired rate measurement

Quiet baseline and owned-player runs used the same 180-second 720p H.264/AAC
moving clip, one-second warmup and six measured seconds at 1×/2×/2.5×/3×/4×/8×/16×.
Both passed functional validation at all seven rates; every owned sample retained
the original media, source and ownership. Neither passed every strict cadence target.

| 16× mode     | Measured media-time rate | Frame callbacks/s | p95 gap | Maximum gap |
| ------------ | -----------------------: | ----------------: | ------: | ----------: |
| Baseline     |                 16.0004× |              53.1 |    17ms |       131ms |
| Owned player |                 16.0026× |              53.7 |    18ms |       123ms |

Owned cadence missed at 1× (p95 fractionally above 50ms), 2.5× (175ms maximum)
and 4× (160ms maximum). Baseline missed at 1× (169ms maximum), 2.5× (184ms)
and 3× (208ms). Baseline buffered network-`stalled` warnings at 1×/2×/2.5×/3×
remain recorded; neither run reported `waiting`. Callback cadence is separate
from decoding every source frame: 16× video-quality counters increased by
2,368 total/1,625 dropped frames in owned mode and 2,372 total/1,660 dropped in
baseline. This single simulator pair establishes no universal smoothness or
improvement claim. See the raw [owned](../test-results/owned-fullscreen/rate-owned-final.json)
and [baseline](../test-results/owned-fullscreen/rate-baseline-final.json) reports.

## October 21 Safari 16× verification — earlier candidate

The candidate caps requests at 16× and removes repeated lifecycle rate writes
and unchanged custom-control DOM writes. Four paired native iPhone Safari runs
(iPhone 17 Pro simulator, iOS 26.2) used a 180-second 1280×720 H.264/AAC moving
clip, one-second warmup and six measured seconds at 1×/2×/2.5×/3×/4×/8×/16×.
Every sample sustained media-time progress within 1% of its requested rate.

| 16× run           | Presented-frame callbacks/s | 95th-percentile gap | Maximum gap |
| ----------------- | --------------------------: | ------------------: | ----------: |
| Native baseline A |                        54.7 |                17ms |       101ms |
| Extension A       |                        54.7 |                18ms |       101ms |
| Extension B       |                        53.8 |                19ms |       106ms |
| Native baseline B |                        54.3 |                17ms |       113ms |

These are local simulator measurements, not physical-device or live-stream
smoothness guarantees. The strict cadence target did not pass every sample:
1× showed larger percentile gaps, native 2× had a 151ms maximum gap, and one
extension 2.5× sample had a 174ms gap. Original reports also failed the first
validator's blanket rejection of download `stalled` notices despite uninterrupted
progress. That evidence is retained; it is not counted as an all-green playback
run. The instrumented probe distinguishes buffered network notices using bounded
event-time state while keeping waiting, underbuffered stalls and cadence failures.
See [the native QA guide](../tests/safari-ios/README.md). Raw JSON, screenshots,
clip identity and XCTest bundles live under `test-results/safari-16x/`.

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

## Playback above 2×

A rate accepted by Safari is not a guarantee that every frame can be decoded or
presented at that speed. Apple documents choppy playback above 2× when the source's
processing requirements exceed AVFoundation's capacity; playback may fall back
to fewer frames. See [Apple QA1772](https://developer.apple.com/library/archive/qa/qa1772/_index.html).
WebKit also documents native HLS entering I-frame-only playback above 2×,
including stuttering when the stream lacks an I-frame rendition. See the
[WebKit HLS fix description](https://github.com/WebKit/WebKit/commit/d1cf1ce59abb8c7e1a1f64efdeb4f50d8c9f83ce).
StayFast accepts requested rates from 0.07× to 16× on Safari, matching Chrome
and Firefox. This is a product limit; an accepted rate does not establish smooth
decoding. Playback retains the site's original media, tracks, DRM session
and audio pitch policy. Native-HLS switching requires an explicit matching MP4
alternative. Current X MediaSource playback uses the separate retained-producer
adapter described below. StayFast avoids reassigning an unchanged native rate and
does not fight a source-specific initialization clamp.

On iPhone/iPad, a speed above 2× selects an explicitly supplied matching MP4
rendition. Resolution supports X/Twitter React props, direct HTML `<source>`
alternatives, Video.js/Brightcove `currentSources()` and JW Player’s current
playlist item. Both the active HLS and chosen MP4 must belong to that exact
media element or a verified single-video player scope. The
original video remains in place at its current time; playing videos continue,
paused videos stay paused, and presentation/scroll state stays intact. This also
applies to later feed videos using a saved or session speed. Existing progressive playback, including working Facebook videos, stays on its
current path. All browsers retain their 16× request limit.

The resolvers read bounded player/source lists, validate the exact active HLS
URL and select an explicitly supplied HTTPS MP4. X additionally validates the
same asset identity in official CDN URLs. Its current SDK track may append one
observed `variant_version=1` marker to the native HLS URL; only the SDK-selected
variant can match through this exception, with every other URL component retained.
Modern X native-HLS records use the same bound SDK identity, session and
capability checks as the retained-producer adapter. The declared HLS, content
and media IDs, supplied downloads and MP4 variants must agree. An absent SDK
does not gain the marker exception; generic React pairs and variant arrays
still require literal URL equality. This resolver coverage does not establish
that the reported live iPhone failure is fixed.
The current track’s caption/protection veto also blocks older React and HTML fallback. No global player registry is scanned. It never fetches
post data or invents a source URL. Owned fullscreen searches the retained media container and its validated,
connected original player scope, with at most twelve ancestor hops per root.
The nearest recognized SDK player’s ad, DRM, live and pending-caption restrictions
apply before any source route is accepted, including retained HTML alternatives.
Explicitly external SDK metadata tracks (such as thumbnail VTTs) remain on the
same player and do not block selection; caption and unknown declarations do.
Brightcove’s existing JavaScript-created `media-cues` track is allowed only through
its exact same-player proxy/native-track identity, never its label alone. It is
revalidated against the current video immediately before switching; other unknown
in-band metadata still blocks selection. JW’s current-item `allSources` retains
configured alternatives after its `sources` list is filtered to the active format.
See [JW playlist event fields](https://docs.jwplayer.com/players/reference/playlist-events)
and the [HTML text-track model](https://html.spec.whatwg.org/multipage/media.html#text-track-model). Blob/MSE, live, DRM, meaningful or unknown in-band
text tracks and alternate audio/video streams are excluded. Safari’s single
unnamed caption track with no cues is treated as an empty placeholder. That track
does not survive MP4 selection: captions arriving later in that dormant stream
will be unavailable until the original HLS resource is restored. Labeled,
language-tagged or populated tracks retain HLS. An unavailable rendition keeps the
original stream; smooth playback above 2× cannot be promised in that case.

Current X uses a blob-backed MediaSource player on some iOS sessions. Replacing
that video's source detaches the producer and its SourceBuffers; assigning the old
blob back does not restore them. `TwitterMP4Playback` instead pauses and retains
the original, then controls a native MP4 companion over the same picture. The
resolver binds the nearby React hook to the exact SDK media element, cached
state, content, session, source and supplied same-asset CDN variants. It selects
up to 720p when available. It reads no global registry, constructs no media URL
and fetches no post data. This adapter is iOS-only and leaves generic blob/MSE
source switching disabled.

The reported October 28 post exposed an XDS transport group inside one additional
chrome wrapper. Recognition accepts that exact bounded layout as well as the
direct group, while retaining ambiguity checks and unrelated controls/captions.
Known-media mutation reconciliation also queues the existing shared placement
frame for an already hidden inline strip. This repairs stale occlusion after
page chrome disappears without resizing the video; visible controls do not add
layout work. A failed handoff resumes the original only while its producer and
source identity remain owned.

A playing retained-MP4 handoff waits for its initial Play promise before
removing the original controller or committing presentation. Pause and newer
Play requests supersede older settlements. Rejected or synchronously thrown
Play requests release the companion, restore the producer's prior local rate
unless the site changed it, and refresh the displayed rate. The saved speed
preference remains available for other clips. A refused original-player resume
shows the existing playback error only for the current source/request. These
recovery regressions are distinct from the still-unverified live iPhone failure;
an audible saved-speed Safari policy rejection remains a hypothesis.

`twitter-live-mp4` tests the reported post through genuine inline 2.1×/4× controls
and independent 1× fullscreen entry followed by 4×. It requires the exact post's
media, actual hit targets, streaming decoded progress and original-source
preservation. These Chromium results do not establish physical iPhone Safari
acceptance, which remains a separate required check.

Explicit owned fullscreen or Custom player entry stages that same verified MP4
at the current accepted rate, including 1× and 2×, before any original-node
portal. Native verification found WebKit can discard MSE buffers when that node
is moved into the dialog. The companion opens the owned overlay after its first
frame; this callback requests neither Play nor browser DOM fullscreen. Pending
entry preserves pause unless the action explicitly requests Play, and a newer
presentation, hidden page, close or handback cancels its opening intent.
Controller transfer preserves the accepted local rate and lifecycle authority
without saving a new speed preference. Unsupported X blob streams remain inline;
the Custom player entry becomes an explicit Use site player escape. Apple-player
entry remains a separate user choice.

The adapter rejects captions, DRM, live/ad content, alternate native tracks,
ambiguous media scopes and unsupported SDK schemas. It validates bounded
metadata before loading and subscribes to the current SDK store while active.
The speed command pauses the original and requests companion Play in the same
call stack; loaded-data callbacks only transfer controls/presentation. Paused
commands retain pause. Handback copies time and current playback intent to the
unchanged producer through its verified seek API, then restores controls. A
seek's temporary drop to metadata-only readiness does not invalidate that exact
producer identity. Source/session changes, removal and teardown release the
companion and owned wrappers/listeners without a stale resume. A caption or
protection change returns to the same original producer.

The coordinator performs one synchronous source/load/start-time/rate transition.
It does not defer playback or seeking to metadata callbacks. Automatic saved-speed
selection first joins an already-requested Play promise, then checks the still-current
source and intent in the next task before starting that synchronous transition.
Metadata initialization also rechecks rendition eligibility when an earlier speed
command already set the requested numeric rate. Matching `playbackRate` alone
must not strand a loading native-HLS clip on its original stream above 2×.
X can initially leave its selected track’s caption status unknown, then explicitly
report no captions after playback starts. Later trusted native `playing` events
recheck full rendition eligibility, bounded to 32 events/ten seconds per source.
Unknown or enabled captions remain vetoes. The synchronous recheck preserves
current rate authority and revalidates source, document and playback intent after
resolver calls; it adds no polling or readiness timer. Source lifecycle resets
the budget and controller removal releases the listener.
Paused media is never started by this automatic path. Pending selection is bounded
to ten seconds and cancels on input, source/poster changes, hidden/navigation
state or disposal. Expected source
events retain the same custom view and rate authority; site replacement,
intervening writes, navigation, or disposal cancels ownership. Failures restore
only a still-owned resource and never automatically retry initialization.
Use site player retains the chosen MP4 without another reload. Full teardown
restores the original source only if it is still owned.

The October 21 investigation reproduced the same clip’s local HLS presentation
falling from 52.8Hz at 2× to 9.2Hz at 2.1× on iPhone 17 Pro/iOS 26.6.2; its MP4
presented at 56.6Hz at 2.1× and 60.2Hz at 4×. That HTTP comparison had an unrelated
injected-script error and is not a clean physical product acceptance check.
The built-extension iPhone 17 Pro/iOS 26.2 Safari fixture then passed inline,
paused, owned-player/return and remembered-speed-next-clip checks against the
official CDN video. At 4× it measured 48.2–49.8Hz, correct media-time progress,
unchanged scroll and no page/media failures; the next clip’s original Play promise
resolved. Only the document matcher is substituted for localhost. Actual live-X
physical-device verification remains incomplete. Raw failures, passing xcresults
and the result record are in `test-results/twitter-choppy/verification.json`.
This investigation predates the broader build 14 candidate. Its final source,
verification and delivery status belong to `build/safari/testflight/0.11.4-build14/`
and the current landing ledger; an archive alone does not establish tester availability.

The broader implementation also covers publisher sites using Video.js/Brightcove
or JW Player when their current item includes both formats, and plain HTML
source alternatives. The official Brightcove sample for video `5842800655001`
exposes native HLS plus a 720p MP4 in `currentSources()`. The inspected Vimeo
`76979871` and JW `EwJonN6F` embeds expose no progressive alternative in their
current player metadata, so StayFast leaves those streams alone.
This is capability-based selection; every publisher does not necessarily expose
MP4. Generic lists prefer the best supplied resolution up to 720p, then the
smallest known higher resolution. Active Video.js ad breaks, declared DRM/SSAI/live
metadata and pending publisher caption tracks retain their original source.
No extra network lookup, permissions or URL construction are added. Native SDK
fixtures use public Brightcove and JW scripts; HTML and X fixtures run the
production resolver without a site-matcher override.

References: [Video.js currentSources](https://docs.videojs.com/player#currentSources),
[Brightcove source fields](https://apis.support.brightcove.com/playback/references/playback-api-video-fields-reference.html),
and [JW source configuration](https://docs.jwplayer.com/players/reference/playlists).

Older finite absolute preferences above 16× are lowered to 16× when loaded or
received from storage. Safari imports apply the same normalization to remembered
speed, site-rule speeds and absolute Reset/Preferred shortcut values. Null
authority, relative speed increments, seek intervals and frame rates retain
their meaning. New popup and custom-player entries above 16× are rejected.

The native `/rate-probe.html` fixture compares 1×, 2×, 2.5×, 3×, 4×, 8× and 16×
using one second of warmup and six measured seconds per rate. Add
`?controlled` to measure an extension-controlled video; the default closed-root
video measures Safari without controller ownership. Higher setter-acceptance
probes remain separate. Frame counts, cadence gaps, readiness, errors and actual
rate readback must be inspected together; simulator results do not establish
physical-device or streaming-site performance.

## Inline control fit

On iPhone/iPad, build 13's owned inline transport adapts play/pause, skips, mute,
timeline, speed and fullscreen to available space with 44px targets. Compact
layouts progressively reduce controls. The surface fits the video's visible, clipped bounds
and avoids overlapping site headers where space permits. Scrolling refreshes
visible controllers through one shared listener and one coalesced animation
frame per window; it does not write page scroll offsets.

The compact speed/fullscreen pair and fullscreen-only layout remain fallbacks.
If the actual clipped media is below 52px on either axis, inline controls hide
and native/site controls return because the touch targets cannot fit. Active
owned fullscreen acquires controls independently of this inline-fit fallback. Expanded
controls remain within the visual viewport. Compact speed labels retain the full
accepted rate in their accessible label and state.

Initial placement waits until the controller is connected, then computes its
final coordinates before returning to the site's readiness handlers. This avoids
the transient overflow found in transformed Twitter/X feed cells. A connected
iOS controller also refreshes placement immediately when the site reparents its
video, while desktop controllers retain their manually dragged position.

## Build 6 inline-playback policy — historical

This section records build 6's presentation behavior; build 12's entry policy
is described above. On iPhone/iPad, StayFast adds `playsinline` and `webkit-playsinline` when it
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
  speed selection, absolute **1×**/preferred speed (star), Fit/Fill, and mute. **More** reveals
  available caption/audio-language choices, supported system controls, and
  **Use site player**. Escape closes More before dismissing the player. It keeps
  the original media element and sources, including an existing streaming session. Known
  single-video player containers stay together to preserve site-rendered
  captions where possible. Caption changes leave metadata/chapter tracks alone.
- Drag the timeline horizontally to seek. Moving farther above or below it
  changes sensitivity to half, quarter, then tenth speed without jumping the
  selected position. Keep the finger down as you move away and back; the
  sensitivity changes within the same gesture. Diagonal movement accounts for
  every crossed band, even when Safari groups touch updates, and release includes
  the final finger position. Scrubbing pauses playback; release resumes only if the
  video was playing before the gesture and the current view is still visible.
  Cancellation restores the starting position. Decoder writes are coalesced and
  seek targets stay inside the current finite/live seek range. Keyboard range
  controls remain available.
  This follows the distance-controlled scrubbing described in Apple's
  [iOS 3.1 user guide](https://cdsassets.apple.com/live/6GJYWVAV/user/ma616_iphone_ios3_1_user_guide.pdf);
  the four gain levels and no-jump return are StayFast's explicit behavior.
- Fit shows the whole video; Fill crops its edges. Use the button or a two-finger
  pinch on the video. Tap the duration to alternate total and remaining media
  time. A live stream shows **LIVE** and offers **Go live** when it exposes a
  seekable window. Audio-language selection appears only for multiple native
  audio tracks; site-only streaming catalogs are not exposed by that API.
- Volume appears only when Safari supports detecting an unlocked media volume.
  iPhone system/hardware volume remains available. PiP/AirPlay controls require
  the corresponding system capability and honor disabled-presentation flags,
  including changes made after the player opens.
- The close (×) icon returns the video to the page while keeping the inline StayFast
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
- Safari speed choices include 6×, 8×, 12× and 16×, plus custom finite rates
  from 0.07× to 16×. Device, codec, streaming engine, audio and site restrictions
  may reduce smoothness within that range. The historical build 4 controls and
  raw native probe below accepted 32×/64×; those results describe the earlier
  build and native fixture, not the current product range.
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

A historical independent native Safari probe used an extension-inaccessible closed-shadow
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

| Area            | Required behavior                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activation      | Enable extension, grant/revoke site access, reload, and verify controls track access.                                                            |
| Startup         | Settings load before actions; MAIN/ISOLATED startup order never strands initialization.                                                          |
| Inline playback | Plain video and audio, mobile YouTube, and cross-origin/blank-frame players accept speed and seek actions.                                       |
| Touch           | Pill, presets, buttons, dismissal, portrait/landscape, page zoom, and browser bars keep controls usable.                                         |
| Navigation      | New feed media, player replacement, YouTube navigation, and browser back/forward recover controls once.                                          |
| Suspension      | Switch apps and return; missed settings and removed controllers reconcile without duplicate listeners.                                           |
| Owned player    | Full screen opens the original media in StayFast; check optional container fullscreen, Lock/Unlock, seek feedback, Done, and scroll restoration. |
| Native media    | More → Apple player and PiP retain speed and return inline; Apple presentation contains no StayFast controls.                                    |
| Extension UI    | Popup aggregates media across frames; settings, import/export, and enable/disable work.                                                          |
| Cleanup         | Repeated toggle, navigation, and removal leave no duplicate overlays, pending callbacks, or page errors.                                         |

Physical-device Safari checks are required before describing this edition as
release-ready. Simulator compilation, Chrome touch checks, and WebKit without
the installed extension each provide narrower evidence.

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

Full screen uses StayFast's player on iPhone, including Twitter. Finite looping
and silent native renderers retain their existing playback policy without requiring
an alternate transport. For a verified retained renderer, unavailable or refused container fullscreen uses a manual
popover viewport with StayFast's controls. Stylesheets injected into the player
by another extension do not keep a closed panel on screen. The original video, source, parent
chain and native captions remain in place. The viewport owns only its markers,
styles, placeholder and UI, restoring them on close or certificate loss. An
existing site popover or unrelated fullscreen session is not acquired. Unsupported
presentation or transport remains inline with an unavailable message; it never
chooses the system player. More → Apple player is the explicit native bypass.

Recognized single-video feed containers can retain their original renderer for
StayFast fullscreen even when private SDK/session or alternate-source metadata
is unavailable. This DOM-only presentation checks the exact controller, source,
document, parent chain and bounded single-media scope, and closes on source or
ownership loss. It never grants transport takeover, moves the video or requests Play.
Recognized site chrome remains suppressed while the retained view is active.

The speed panel and StayFast fullscreen's More menu offer **Twitter video viewer**
when that exact player supplies an unambiguous same-origin, same-post video link.
It closes StayFast, follows the observed site link and preserves the site's
vertical swipe navigation. Full screen continues to mean StayFast; the separate
viewer action does not synthesize URLs or choose Apple's player. Missing, ambiguous
or stale links leave the action unavailable. Neutral fixtures cover feed MSE
without private SDK metadata and viewer source reuse; live/physical input
acceptance remains separate.

## Open Twitter regressions

The original cases and requirements remain separate from execution and delivery
records. The table preserves the reported acceptance scope. Historical candidate
status and investigation details are retained in [the original records](safari-history.md#open-twitter-regressions).
A build, fixture result or upload does not close these live-device cases. Current
delivery observations belong in [the generated ledger](generated/safari-release-status.json).

| ID      | Reported behavior                                                                                                         | Required acceptance                                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SF-TW-1 | Picture freezes or stutters and audio cuts out at speeds above 2× in iPhone Safari Twitter videos.                        | Check 2×, 2.1× and 4× on an affected post, decoded frame cadence and media-time progress, audible output, same-clip rendition selection, scroll/pause retention and the next feed clip. Measure audible continuity independently from video cadence and speed readback; a numeric playback rate or one 720p fixture alone is insufficient. |
| SF-TW-2 | Picture-swipe seeking regressed for videos embedded in tweets in the normal feed, after overlay/viewer support was added. | A navigable tweet wrapper and focusable X picture trigger must allow a genuine horizontal seek. Retain vertical page scrolling, pinch, small buttons/links, normal playback and the existing generic overlay/expanded-viewer cases.                                                                                                        |
| SF-TW-3 | Twitter's mute action is difficult to reach.                                                                              | A 300px embedded player must expose a visible mute/unmute action with a measured 44px target, without seeking, opening fullscreen or changing playback. Verify responsive boundaries and keep independent site controls usable.                                                                                                            |
| SF-TW-4 | Opening a video fullscreen must not lose the user's place in the normal Twitter feed.                                     | Enter fullscreen from a partially visible embedded video well down the feed, then return using StayFast Close and any available browser exit. Keep the same tweet and its visible offset on entry and return, including repeated transitions and rotation. Check page and nested scrolling; preserve deliberate navigation or scrolling.   |

For source selection, gestures or scroll preservation, read the corresponding
[historical regression analysis](safari-history.md#open-twitter-regressions)
alongside the current runtime contracts; it retains reproduction geometry,
negative cases and the distinction between simulator and authenticated feed proof.

## Inline timeline and precision gestures

The inline seek rail is independently positioned at the clipped video's bottom,
with a 3px track, 12px thumb and 44px touch target. The speed/transport strip
remains compact at the top; the controller does not grow into a video-sized
hit box. Existing placement events update rail coordinates after occlusion and
ancestor scaling, without writing scroll or polling.
Site metadata and controls do not move the rail upward.
For otherwise unrecognized players, recognizable play/pause/replay overlays in
a bounded, unambiguous picture container stay hidden while StayFast owns inline
playback, including replacements
inserted after seeking. Safari's native start/overlay play icons are also hidden
by rules scoped to the owned video. Handback restores the site controls and
removes those rules. Captions, media and unrelated actions remain visible.
Other unknown site controls can overlap the timeline and retain their input priority;
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
Native video capture transfers can report `lostpointercapture` on that same
video. Seeking continues while its surface still has capture; an actual loss or
pointer cancellation restores the starting position.

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
Expanded attachments may keep a full-picture file link over their video. Horizontal
drags also scrub through a download link when it points to the current media file;
ordinary taps and links to other downloads keep their page behavior. The neutral
`/media-patterns.html?attachment-link` fixture covers thumbnail expansion, seeking,
collapse and reopen in the built browser and native Safari harnesses.
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

Historical record: [candidate scope and evidence](safari-history.md#build-13-takeover-candidate--r4-verification).

## Build 12 presentation policy and source-freeze acceptance

Historical record: [candidate scope and evidence](safari-history.md#build-12-presentation-policy-and-source-freeze-acceptance).

### Final paired rate measurement

Historical record: [candidate scope and evidence](safari-history.md#final-paired-rate-measurement).

## Build 36 feed stutter investigation

Historical record: [candidate scope and evidence](safari-history.md#build-36-feed-stutter-investigation).

## October 21 Safari 16× verification — earlier candidate

Historical record: [candidate scope and evidence](safari-history.md#october-21-safari-16-verification--earlier-candidate).

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

On iPhone/iPad, X/Twitter prefers an explicitly supplied matching MP4 at every
speed, so a later speed increase can use the progressive source already loaded.
Other supported HLS players select their supplied MP4 above 2×.
Resolution supports X/Twitter React props, direct HTML `<source>`
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

When X omits its countdown accessory, the same post's renditions can instead
live in its SDK-local Relay cache. Follow only the bound post's media reference
through at most eight linked records, matching the current HLS, download, asset
and duration before using the existing up-to-720p ranking. This avoids selecting
a 4K download when X explicitly supplies a lighter rendition. A validated cache
binding also permits retaining one exact `<source>` child for automatic takeover.
Caption, protection, live and ambiguity vetoes still apply.
A countdown accessory may supply an opaque Relay
fragment instead of expanded video metadata. Require its exact own-data shape
and match its reference to that same current post before reading renditions.
Expanded/mixed fields, inherited claims, accessors and capability contradictions
still reject this route; no missing URL is synthesized.

The same-post cache route can use explicitly supplied playback renditions when
both metadata owners omit the download URL or hold it as an own undefined data
field. Exact current SDK HLS, media/post, session, cache environment and
same-asset MP4 variants still identify playback.
Inherited fields, accessors, invalid values, mixed owners and changes during a
read reject that snapshot. Countdown metadata and present download URLs retain
their existing checks.

Looping companions require unlimited intent, revalidated throughout ownership:
an own-data `loop === true` on the exact SDK-owning creator props, or absent/nullish
own-data `maxLoopCount` and `maxLoopingThresholdSeconds` on both creator and selected
SDK content. Inherited, accessor and non-null limits cannot certify the latter.
That path also rechecks each content object's own loop flags or finite duration
threshold; a paused producer's stored loop flag can outlive a policy change.
The SDK's current `shouldLoop` flag can describe a finite repeat policy whose
counter advances on the original video's `ended` events. A paused retained
producer cannot enforce that policy. Finite repeat policies remain with the site player.

Short finite X clips with explicit unlimited looping can use their supplied HLS
fMP4 fragments inside the same retained-producer companion. It requires one
enabled audio track, a 1–60 second clip and an AVC/AAC rendition within 1280×720
(including portrait
orientation). The exact supplied MP4 URL provides ordered dimensions; exactly
one master variant must match. The entire master is validated before selection,
with at most eight video/audio pairs, unique URLs/groups/dimensions, one-to-one
audio associations and identical audio semantics across groups. Invalid
unselected declarations also reject. It follows only explicit same-asset HTTPS
CDN references with CORS and omitted credentials, rejecting redirects, encryption,
caption/unknown tracks, live playlists, discontinuities, byte ranges and
unsupported tags. Preparation is limited to 12 seconds, 16 segments per track,
37 requests and 8 MiB. It constructs no post or media URL. Longer clips retain
the supplied MP4 path; this bounded candidate does not establish their loop
boundary performance.

The loop owner caches the complete clip once, reads the exact audio/video end
from native SourceBuffer ranges and appends whole cycles at that shared period.
The separate captioned-loop route requires the exact showing SDK/native subtitle
track and a complete finite caption certificate. Its live owner attests the same
raw master and subtitle group, preserves verified native IDs and settings, and
adds cue copies at multiples of the actual AV period. Those copies precede AV
appends and retire after both AV buffers. Ordinary caption vetoes remain intact.
Exact source positioning remains supported. For default source positioning, the
owner also recognizes X's documented per-cue line, snapping and line-alignment
adjustment, preserving the captured tuple on every owned cue. Other caption
fields and owned-track mutations retain their complete verification.
SDK caption-inset updates may replace the metadata container without changing
its tracks. Revalidation preserves track identity and every other metadata
field, rather than treating that layout-only container replacement as a new source.
The original keeps playing during verification; only full cue readiness permits
the guarded pause, latest-position seek and zero-rate release. Captioned failures
hand back to the original instead of continuing without proven captions.
A valid empty VTT source precedes caption-track insertion because iOS may
automatically enable it immediately. Its empty load never certifies captions;
the supplied source and complete owned-track cue proof still gate release.
A user Pause during preparation cancels the pending handoff. A verified unlimited
captioned loop may wait through the original's natural end for the site's own
restart; actual playing and settled seeking must precede release. Initial binding
requires decoded data. A bound caption companion can retain full source and
caption authority while the original's seek temporarily leaves only loaded
metadata; protection and identity checks still apply. This never requests another
Play or resumes an original the session has not paused. Only
the exact pause issued for a verified release receives a one-event exemption.
Companion source writes permanently revoke that session's source lease, even if the page
restores the old URL before observer delivery; teardown must not unload it.
Preparation holds the actual native rate at zero after resource loading, while
the session retains the latest requested positive rate. One Play request occurs
in the original command stack. Once one complete cycle, native track timing and
the initial seek are verified, readiness releases the requested rate without
another Play. A newer Pause remains paused. Rate resets, unsupported zero,
clamped release, source loss or a changed command during release fail through
the same guarded fallback. Held zero never becomes a saved or handed-back rate.
The initial cycle and all zero-rate time count as startup in measurements.
It retains the previous/current cycles and bounded future playback, retiring
older buffers through playback and buffer events. Future playback targets a
quarter period with at least two wall seconds of runway. It does not seek the decoder
at each loop, trim the audio tail, change pitch or disable looping. Normal
controls retain clip-relative duration, seeking and handback; measurements must
use the captured native time getter and native frame timestamps as well.
Consecutive seeks retain the issued epoch when native readback rounds an exact
boundary within one microsecond. This affects the clip-relative control clock;
the captured native getter used for playback measurements remains unmodified.

An exact owned MMS source precedes the supplied HLS source alternative, with
remote playback enabled. Only an observed wireless route after commit may
retain native HLS selection. Preparation/codec failure before commit falls back
to the verified MP4 on the same element and latest request generation. Loaded
metadata never requests Play. A committed loop failure uses guarded original
handback, not the progressive MP4 reload helper. Caption, DRM, live, ambiguity
and original-source identity vetoes remain authoritative throughout preparation
and playback.

Both continuous-loop and ordinary X MP4 companions can stall after many rapid
native rate writes. Their shared owner retains relative input intent until
100 ms of quiet, then applies the final target through the normal speed handler.
Actual rate readback, UI acceptance and saved preference remain at the previous
rate until that write. A new source, document, controller or preference cancels
pending intent; a paused video stays paused.

For native iOS video playback, the first relative command still runs source selection
synchronously. Only a successful native command above 2× with no playback transition can
arm a source-bound burst queue. This path is shared across sites. Further relative inputs wait for 100 ms of quiet
before one native rate write. That flush cannot select a source or request Play.
Media-state release, source mutations, newer commands and preference changes
cancel it; accepted UI and storage follow actual native readback.

Two paired non-X MP4 runs measured whole-window native advancement improving
from 3.48×/3.47× to 3.88×/3.70× after nineteen genuine Faster inputs. The second
candidate run includes two buffering waits; recurring late frame gaps remain.
This verifies a scoped input-transition improvement, not smooth playback on every
source. All startup, backsteps and buffering intervals remain in the measurements.

This candidate's complete device acceptance remains open. Continuous fragments
removed recurring loop-boundary gaps in the measured runs. Coalescing all 19
genuine relative inputs improved whole-window playback from about 3.66× to
3.92× on the short loop, and from 3.53× to 3.88× on the long MP4. Each retained
one 265–317 ms transition gap. See the retained
[iteration evidence](../test-results/twitter-iphone-rate-repair/loop151/ITERATIONS.md).
Do not treat unit checks, a resource build or the passing prebuffered experiments
as full playback acceptance.

Supported finite X native-HLS clips with captions may use the supplied MP4 only
after the explicit complete subtitle rendition has been fetched and verified
against every native cue. The bounded three-request manifest/subtitle chain and
native parser must agree on the full text, timing and cue settings before any
source change. Unknown, incomplete, protected or mismatched captions retain HLS.
The generic caption veto remains unchanged for other streams. Preparation keeps
the previous displayed rate until the playback command is actually accepted.
Handback restores the original HLS source and current caption intent.

At 2.1× or faster, committed visible X MP4 sessions watch decoded frames, including
companions, HLS-switched MP4 and verified caption-preserving MP4. Three
seconds without frame progress, corroborated by a stopped native frame counter
and at least one second buffered, permits reloading that same MP4 while retaining
time, rate, audio intent and owned presentation. Two attempts are allowed; another
confirmed stall returns to the original player. Pause, seek, newer speed/source
or presentation intent, visibility changes and cleanup invalidate pending recovery.
Recovery waits for the full native caption certificate again after a captioned
reload. The retained MSE producer is never reloaded. Unit recovery checks do not establish
that an actual hardware stall has been recovered on the phone.

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
It does not defer playback or seeking to metadata callbacks. Verified paused X
media with autoplay off can prepare its MP4 without requesting Play. Autoplay
intent remains with the site. Playing initialization first joins an already-requested
Play promise, then checks the still-current
source and intent in the next task before starting that synchronous transition.
Metadata initialization also rechecks rendition eligibility when an earlier speed
command already set the requested numeric rate. Matching `playbackRate` alone
must not strand a loading native-HLS clip on its original stream above 2×.
X can initially leave its selected track’s caption status unknown, then explicitly
report no captions after playback starts. Later trusted native `playing` events
recheck full rendition eligibility, including the current X MSE adapter, bounded
to 32 events/ten seconds per source.
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

On iPhone/iPad, the owned inline transport adapts play/pause, skips, mute,
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

Historical record: [candidate scope and evidence](safari-history.md#build-6-inline-playback-policy--historical).

## Build 5 scroll preservation

Historical record: [candidate scope and evidence](safari-history.md#build-5-scroll-preservation).

## Build 4 mobile behavior

Historical record: [candidate scope and evidence](safari-history.md#build-4-mobile-behavior).

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

Historical record: [candidate scope and evidence](safari-history.md#verification-evidence).

### Build 9 — video-load diagnostic variant

Historical record: [candidate scope and evidence](safari-history.md#build-9--video-load-diagnostic-variant).

### Build 8 — adaptive inline controls and stable feed insertion

Historical record: [candidate scope and evidence](safari-history.md#build-8--adaptive-inline-controls-and-stable-feed-insertion).

### Build 7 — feed source and scroll correction

Historical record: [candidate scope and evidence](safari-history.md#build-7--feed-source-and-scroll-correction).

### Build 6 — native verified and uploaded

Historical record: [candidate scope and evidence](safari-history.md#build-6--native-verified-and-uploaded).

### Build 5 — native verified and uploaded

Historical record: [candidate scope and evidence](safari-history.md#build-5--native-verified-and-uploaded).

### Build 4 — native verified and uploaded, October 17

Historical record: [candidate scope and evidence](safari-history.md#build-4--native-verified-and-uploaded-october-17).

### Published internal TestFlight — build 3

Historical record: [candidate scope and evidence](safari-history.md#published-internal-testflight--build-3).

### Previous release baseline — 0.11.3 (2)

Historical record: [candidate scope and evidence](safari-history.md#previous-release-baseline--0113-2).

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

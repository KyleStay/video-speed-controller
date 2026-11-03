# Local custom-player fixtures

These synthetic fixtures exercise custom clip feeds without an account, remote
media, analytics, third-party scripts, or service-specific names. Example creator
text, generated media and local links are intentionally generic. The server binds
to loopback; the fixture's Content Security Policy restricts network access to
itself. The automated suite also blocks and fails any off-origin HTTP request.
Keep external service names, domains and identity lookup keys out of fixture IDs,
comments, documentation and reports. Maintain profiles by their behavior contracts.

## Local compatibility matrix

Run `npm run test:e2e:isolated -- site-mocks` to exercise neutral media patterns,
all seventeen behavior profiles, custom feeds, animated GIF images, custom WebM
renderers and silent loops. Each suite owns a fresh disposable browser and
releases it before the next suite.
The matrix contains no live-site suite or remote media. It models common behavior
families rather than copying a service's current DOM, branding or content.

### Behavior profiles

`npm run test:e2e:isolated -- site-mock-cases` runs these seventeen profiles. IDs name
the media mechanics and stay consistent across fixture code, tests and reports.
The contracts below provide enough detail to locate and upgrade each profile.

| Profile ID           | Contract                                                                                          | Review when changing                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `loop-feed`          | GIF/SD/HD rendition URLs, mute intent and one recycled video across five subsequent clips         | Source identity, selected rendition, resume behavior and rate/audio intent after a handoff                      |
| `adaptive-watch`     | Real local HLS, matching MP4, observed native capability, explicit fallback and retained captions | Manifest/segment layout, transport errors, file recovery and caption-node lifetime                              |
| `rendition-watch`    | Low/high file sources, adaptive alternative and delayed playback-rate resets                      | Reset timing, rate authority and cancellation after source replacement or disposal                              |
| `discussion-feed`    | Native clips, independent duplicates, comment typing and second-origin embeds                     | Per-document ownership, duplicate removal, editable input and frame-local shortcuts                             |
| `mixed-gallery`      | Still GIF, animated GIF, MP4 and WebM with forward/back navigation                                | Media-type transitions, old-owner disposal and preservation of unrelated controls                               |
| `source-embed`       | Embedded player, quality selection, viewer sizing and recreation with a new source                | Frame replacement, source identity, presentation changes and parent isolation                                   |
| `playlist-watch`     | Missing-media response, explicit recovery and playlist source reuse                               | Error recovery, chosen rate after Play and duplicate-controller prevention                                      |
| `post-viewer`        | Mixed animation/video posts, duplicates, local embeds and same-node viewer restoration            | Reparent/restore order, media and caption identity, and independent embedded ownership                          |
| `compact-embed`      | Small iframe, resize without replacement, removal and reinsertion                                 | Frame identity during resize, child cleanup and parent isolation                                                |
| `watch-navigation`   | Watch/short layouts, playlist entries and delayed player replacement                              | Latest navigation wins, old-owner disposal and chosen rate after replacement playback                           |
| `carousel-viewer`    | Retained mixed-media cards, active-clip selection and expanded viewer                             | Inactive clips pause, mute intent follows selection, original nodes and tracks survive returns                  |
| `command-feed`       | Cross-origin frame commands and rapid recycling of one clip                                       | Exact origin/window validation, latest source identity, mute/rate intent and frame ownership                    |
| `floating-feed`      | Inline, expanded and floating layouts with visibility-driven site pauses                          | Same media/controller/captions through reparenting; showing a paused player never implies Play                  |
| `live-window`        | Real decoded MediaSource segments, a moving seek window and recording handoff                     | Native infinite duration and seek ranges, window-clamped input, source-buffer/fetch/URL cleanup                 |
| `coordinated-embeds` | Two captioned frame players with optional coordinated pausing                                     | Frame-local rate controls, concurrent intent, source quality and caption-node lifetime                          |
| `attachment-thread`  | Mixed attachment grids, expanded media, expired-source recovery and message removal               | Typing isolation, source renewal, detached-message cleanup even while media is in a viewer                      |
| `staged-player`      | Visibility-gated startup, preview/content replacement and floating layout                         | Latest stage, original caption ownership after quality changes, stale visibility callbacks and decoder progress |

### Maintaining a profile

Use the behavior ID to locate its branch in `media-mock-fixture.js` or
`media-profile-fixture.js`, its browser checks in `site-mocks.e2e.js` or
`media-profiles.e2e.js`, and its DOM tests in
`tests/unit/e2e/media-mock-fixture.test.js`. The manifest's `contract` field is
also included in result rows, so incomplete runs still explain what each profile
was intended to exercise.

Keep IDs stable when extending an existing contract. Reproduce a new failure by
its media topology, transport and lifecycle transition, then update the matching
fixture, assertions and table row together. Add a new behavior ID only for a
distinct contract. Preserve genuine input, decoded-progress checks, explicit
unrun results and the local request boundary.

Names, comments, metadata, test titles and generated reports describe mechanics.
Keep product names, domains, upstream extractor links, logos and identity lookup
tables out of these profiles. Use synthetic markup and media for upgrades; do
not capture pages or fetch content from external services.

Open `/media-mocks.html?case=<case-id>` with the shared/native local server for
manual use. `&mp4` selects the local MP4 variant; `framePort` accepts only a
numbered loopback port. The automated run starts its own second server and blocks
all HTTP(S) requests except the two exact owned origins.

The manifest in `media-mock-fixture.js` lists each stable ID and behavior contract.
`test-results/site-mocks/results.json` retains all seventeen rows, including explicit
unrun rows and setup reasons if a server/browser cannot start. Case failures do
not skip independent cases. Cleanup errors remain failures. The browser checks
use real pointer/key input and observed decoded progression where applicable;
they do not measure full-window high-rate smoothness or audible continuity.

The [generated media](mock-media/README.md) is a six-second synthetic moving
pattern and tone, available as real fragmented-MP4 HLS, an MP4 counterpart and
WebM. Basic rendition URLs reuse those bytes to exercise source identity rather
than bitrate estimation. Unsupported native HLS exercises the observed error and
file-recovery path; it does not count as native HLS playback acceptance. Still and
animated GIF bytes come from the existing deterministic generator.

The live profile appends real H.264/AAC segments through native MediaSource,
sets an infinite source duration and moves the native live seek range while
removing expired buffered media. Its bounded 24-second asset set models an
eight-second DVR window. Tests require actual decoded progress, observed
`seekable` ranges and input through the built extension. No timing properties on
the video are fabricated. This covers MediaSource live-window behavior; native
live-HLS manifest handling, indefinite broadcasts and network adaptation remain
separate acceptance scopes. Unavailable decoding or APIs cannot count as a pass.

### Shared resilience coverage

These profiles exercise common media mechanics on loopback, using the generic
handler rather than domain detection. Reuse those mechanics for new pages:
source replacement must release old owners, same-node reparenting must preserve
controllers and captions, site Pause remains authoritative, and each frame owns
its own media. Fixtures use genuine page commands and native media APIs without
writing extension state.

The shared native seek handler clamps finite recordings to their full duration
and unbounded timelines to the latest valid native seek window on each input.
Missing ranges and non-finite input are no-ops; timing getter/setter failures
during source changes are contained. DOM regressions cover these boundaries,
while the live browser profile exercises the built handler against decoded
media with a moving native window. Fixture-only checks do not establish current
compatibility with any external service.

### General media patterns

The new `media-patterns` suite covers:

| Local layout | Modeled behavior                            | Assertions                                                                                                                                                 |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board`      | Collapsed attachments on a discussion board | Expand two clips, discover late media, isolate reply typing, preserve download links, collapse/rediscover and remove stale controllers                     |
| `watch`      | Video.js-style watch page                   | Preview-to-content replacement, real buttons/shortcuts, decoded progress, quality changes on a child source, caption preservation and next-clip navigation |
| `portal`     | JW-style watch page                         | The same transitions inside different player chrome                                                                                                        |
| `embed`      | Embedded video host                         | Second loopback origin, one controller in the child document, frame-local shortcuts, no parent ownership and iframe removal                                |

Watch/portal pages use neutral generated clips and a local caption. Previews are
synthetic media, with no advertising or tracker code. The HTML has a restrictive
CSP; the browser harness blocks and fails requests outside its two exact owned
loopback origins. No external page, account or remote script is required.
Results and setup/cleanup failures are retained in
`test-results/media-patterns/results.json`.

For manual checks with the shared/native fixture server, open
`/media-patterns.html?layout=board`, `?layout=watch`, `?layout=portal` or
`?layout=embed`. Add `&mp4` for native Safari. An optional `framePort` accepts only
a numbered loopback port; the automated embed check starts its own second server.
The existing custom-feed, GIF, loop and custom-renderer suites cover short-clip
feeds and image-host behavior without duplicating those fixtures.

DOM fixture tests verify the mock transitions and local-only URL construction.
Built-extension runs verify extension behavior against the mocks. Neither proves
compatibility with a live service, physical-device decoding, audio smoothness,
DRM, live adaptive streams or every third-party player version.

## Custom feed

Run the custom-feed browser matrix with the installed disposable Chrome runtime:

```sh
npm run test:e2e:isolated -- custom-feed
```

The matrix covers paused muted-loop discovery, controls arriving later, play/pause,
mute, speed presets and shortcuts, horizontal picture seeking, trailing site tap
isolation, real vertical scrolling, an occluding metadata link, a site-expanded
viewer, repeated owned fullscreen returns, frame controls, Fit/Fill, Lock/Unlock,
caption selection, PiP restriction gating, and replacement/recycled next clips.
Results are saved under `test-results/custom-feed/results.json`. Each control must
retain a 44px target and receive the real input. Media identity and feed geometry
must survive presentation changes. The timeline stays at the visible video bottom,
including beside overlapping metadata, while independent site links retain their input.

For manual browser or native Safari checks, start the shared local server:

```sh
node tests/safari-ios/fixture-server.mjs --port 62938
```

Use these routes; `mp4` selects the generated H.264/AAC sample for native Safari.
Omit it for the generated WebM browser sample.

| Route                                    | Scenario                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `/custom-feed.html?mp4`                  | Muted looping clip with custom transport, metadata and picture overlay |
| `/custom-feed.html?mp4&late-controls`    | Existing decorative loop becomes interactive after Show clip controls  |
| `/custom-feed.html?mp4&recycle`          | Next clip reuses the same video node and changes its source            |
| `/custom-feed.html?mp4&captions`         | Browser-native synthetic caption track, selectable in More             |
| `/custom-feed.html?mp4&recycle&captions` | Combined source recycling and caption coverage                         |

Open site viewer models same-document reparenting; it retains the video and leaves
a same-sized feed slot. Close site viewer restores it. Next clip either replaces
the video or recycles it, according to the query. The deliberate site touch-end
handler exposes regressions where a horizontal drag accidentally becomes Play.
The status line and `window.__customFeedState()` report only local fixture state.

For iPhone Simulator acceptance, follow [the native setup](../safari-ios/README.md),
including the dedicated UDID, signed app install and extension activation. Copy
`CustomFeedQATests.swift` with the other QA sources, open
`http://127.0.0.1:62938/custom-feed.html?mp4`, then run:

```sh
xcodebuild -project build/safari-ios-qa/StayFastSafariQA.xcodeproj -scheme StayFastSafariQA -destination "platform=iOS Simulator,id=$STAYFAST_SIMULATOR_UDID" -parallel-testing-enabled NO -derivedDataPath build/safari-ios-qa/DerivedData -resultBundlePath test-results/custom-feed/native.xcresult -test-timeouts-enabled YES -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 -collect-test-diagnostics never -only-testing:StayFastSafariQATests/CustomFeedQATests/testCustomFeedControlsAndReturn test
```

Use a fresh result path for repeats. The same test supports `late-controls` and
`recycle`; the browser matrix covers caption selection. Preserve failed evidence,
then inspect the native hierarchy before changing code or automation. These mocks
verify interaction, lifecycle and layout contracts. Decoder smoothness, live
network behavior, hardware audio routes, DRM and external AirPlay/PiP destinations
need separate runtime coverage.

### Native iPhone Safari validation

All 17 profiles also have native iPhone Safari tests in
[`MediaProfileQATests.swift`](../safari-ios/MediaProfileQATests.swift). Run
`tests/safari-ios/run-media-profiles.mjs` on an explicitly selected, activated,
disposable iPhone simulator; see the [native instructions](../safari-ios/README.md#neutral-media-profiles-on-iphone-safari).
The runner retains every profile, including failed and unrun cases. Genuine
native UI input and real decoded progress are mandatory; Chromium/mobile
emulation results do not substitute for this gate.

An opt-in, read-only `media-native-probe.js` reports native playback/caption/owner
identity and validated child-frame snapshots. Ordinary pages do not install it.
Safari media routes use the shared byte-range responder, including generated
MP4/WebM and fMP4 fragments. The live fixture supports native MediaSource and
ManagedMediaSource; it never replaces native timing or seekable ranges. Managed
playback disables remote playback on this synthetic element, following
[WebKit's API requirements](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/).
Retain actual WebM and HLS VOD decode checks on Safari instead of silently swapping
those formats for MP4. A missing codec or API remains incomplete.

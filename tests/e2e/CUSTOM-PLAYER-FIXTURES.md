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
all seventeen behavior profiles, custom feeds, animated GIF images and silent loops. Each suite owns a fresh disposable browser and
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

Open `/media-mocks.html?case=<case-id>` with the local server for
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

For manual checks with the local fixture server, open
`/media-patterns.html?layout=board`, `?layout=watch`, `?layout=portal` or
`?layout=embed`. Add `&mp4` to select the generated MP4. An optional `framePort` accepts only
a numbered loopback port; the automated embed check starts its own second server.
The custom-feed, GIF and loop suites cover additional short-clip and image patterns.

DOM fixture tests verify the mock transitions and local-only URL construction.
Built-extension runs verify extension behavior against the mocks. Neither proves
compatibility with a live service, physical-device decoding, audio smoothness,
DRM, live adaptive streams or every third-party player version.

## Custom feed

Run the custom-feed browser matrix with the installed disposable Chrome runtime:

```sh
npm run test:e2e:isolated -- custom-feed
```

The matrix covers paused native-loop discovery, delayed site controls, genuine
site Play and decoded progress, speed shortcuts, same-node viewer reparenting,
replacement and recycled source navigation, and cleanup after media removal.
It preserves the original source and controller through site layout changes.
Results are saved under `test-results/custom-feed/results.json`; requests outside
the owned loopback origin fail the suite. Chromium fixtures verify their stated
browser behavior. Hardware decoding, audio routes, DRM and indefinite broadcasts
require separate runtime evidence.

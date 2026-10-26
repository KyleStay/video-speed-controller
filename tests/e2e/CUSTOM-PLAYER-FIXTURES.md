# Local custom-player fixtures

These synthetic fixtures exercise custom clip feeds without an account, remote
media, analytics, third-party scripts, or service-specific names. Example creator
text, generated media and local links are intentionally generic. The server binds
to loopback; the fixture's Content Security Policy restricts network access to
itself. The automated suite also blocks and fails any off-origin HTTP request.

Run the browser matrix with the installed disposable Chrome runtime:

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
must survive presentation changes.

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

# StayFast Video

**Every video. Your speed.**

StayFast Video by StayTech adds powerful, precise playback controls to HTML5
video and audio across the web. It is free and open source, with no account,
advertising, analytics, or StayTech backend.

> StayFast Video is in active development. Official browser-store links will be
> added here after each listing is approved.

## Features

- **Control across sites** — works with HTML5 video and audio, including media
  inside supported embedded players and dynamic pages.
- **Fine-grained speed** — choose configurable increments and custom rates from
  0.07× to 16× in Chrome, Firefox, and Safari. The source and device determine
  how smoothly a requested rate plays.
- **Precise navigation** — seek by custom intervals, set and revisit markers,
  and step through video frame by frame while paused.
- **Custom keyboard control** — remap actions, use modifier chords, and create
  multiple preferred-speed shortcuts.
- **Per-site intelligence** — choose site-specific speeds or disable the
  controller where you do not want it.
- **Resilient playback preferences** — optionally remember your speed and
  reapply it when a player attempts to reset it.
- **Adaptable controller** — reposition the on-media indicator and customize
  its appearance. Use the overlay's **1×** and **Pref** buttons to set normal
  speed or your configured preferred speed directly. **Pref** uses the first
  Preferred speed shortcut's value, falling back to 1× if that shortcut is removed.
- **Touch controls** — on devices with a coarse pointer, tap the speed pill to
  open large speed/seek controls, 1×/1.25×/1.5×/2× presets, and an explicit close
  button. Touch interaction does not require hover.
- **iPhone/iPad presentation** — StayFast inline controls and an owned fullscreen player
  offering a thin bottom timeline with precision seeking, speed, Fit/Fill, Lock/Unlock, and language/system controls.
  Keep your finger down and move upward from the timeline for half, quarter,
  then tenth-speed scrubbing; moving back toward the bar restores sensitivity
  without jumping, and lifting commits the selected position. The same captured
  gesture works on inline and fullscreen timelines; fractional selected time and
  the active precision mode stay visible while dragging. The inline timeline
  sits at the video’s bottom, independently of the speed controls.
  The original video stays in use. For eligible native HLS videos, speeds above 2× can select the
  site’s matching MP4 rendition to avoid Safari's choppy HLS fast playback,
  preserving your position and play/pause state. Supported metadata includes
  X/Twitter, HTML source alternatives, Video.js/Brightcove and JW Player. Labeled or populated caption
  tracks retain HLS; Safari’s empty caption placeholder may be dropped. See
  [Safari playback limits](docs/safari.md#playback-above-2).
- **Private by design** — playback and page processing stay in your browser.
  See the [privacy policy](PRIVACY.md) for details.

Startup recovers if Chrome starts the page controller before the settings bridge,
including when the bridge arrives after the initial timeout.
Controls recover when a page replaces its document. Players inside open shadow
DOM keep the speed indicator synchronized with native player speed changes.
Returning to a suspended tab or restoring a page from browser history also
triggers a bounded, deferred recovery scan.
Restoration refreshes missed settings changes and prevents queued speed saves
from undoing a reset. Newer settings changes take priority over delayed reads.
Videos loaded further down X/Twitter's infinite-scroll feeds get
controls as soon as they become ready or start playing, even on busy pages.
Speed changes following a real click or unhandled keypress are accepted as your
choice. Programmatic clicks and keyboard events do not authorize a speed reset.

Site rules and legacy blacklist entries written as a domain, such as
`youtube.com`, match that host and its subdomains, regardless of capitalization.
A domain mentioned in another site's path or query does not match. Regex rules
and other text patterns still match the full URL. Port-qualified rules match the
effective port, including HTTPS port 443 and HTTP port 80 when omitted.

## Default keyboard shortcuts

| Key | Action                                         |
| --- | ---------------------------------------------- |
| `S` | Decrease playback speed                        |
| `D` | Increase playback speed                        |
| `R` | Reset playback speed to 1.0×                   |
| `Z` | Rewind by 10 seconds                           |
| `X` | Advance by 10 seconds                          |
| `,` | Step back one frame while paused               |
| `.` | Step forward one frame while paused            |
| `G` | Toggle between the current and preferred speed |
| `V` | Show or hide the controller                    |
| `M` | Set a marker at the current position           |
| `J` | Return to the saved marker                     |

Use **Frame back** and **Frame forward** in the expanded controller or toolbar popup,
or **More** in the iPhone/iPad fullscreen player. Buttons enable while a seekable
video is paused and leave playback speed unchanged.

Frame stepping is video-only. StayFast Video uses the detected frame rate when
available and otherwise uses the configurable fallback (30 fps by default).
All shortcuts and their values can be changed in the extension settings.

The toolbar popup controls media across the current tab, including iframe
players. It shows when players use different speeds and disables speed controls
when the extension is off or no media is available. Turning it back on refreshes
the controls in the same popup.

Settings save automatically when changed; typing is saved after a short pause.
**Revert** undoes the latest saved edit while the settings page stays
open, or discards an invalid or pending edit. **Reset all** restores defaults;
the reset can also be reverted. Settings can be exported and imported as JSON.
Invalid shortcut values, site rules, and preference values are rejected before an
import changes your saved settings. If saving defaults fails, your existing
settings are preserved. Use Tab or Shift+Tab
to move out of a shortcut recorder without assigning that key.

## Install for local development

Requirements: Node.js 22.22.2+ on the 22.x line, 24.15.0+ on the 24.x
line, or 26+, npm, and a Chromium-based browser. `.nvmrc` selects the
minimum supported Node.js 22 release.

```sh
npm install
npm run build
```

In Chrome, open `chrome://extensions`, enable Developer mode, select **Load
unpacked**, and choose this repository's generated `dist/` directory.

For development rebuilds:

```sh
npm run watch
```

Reload the extension and the page under test after a rebuild. See
[CONTRIBUTING.md](CONTRIBUTING.md) for project checks and contribution guidance.

### Safari on iPhone, iPad, and Mac

To investigate a video-loading problem, open StayFast's Safari menu and use
**Video diagnostics → Start new capture**. Reproduce the issue in the same tab,
then select **Stop & prepare report** and **Share / save report** or **Copy report**.
The report contains technical timing, scroll, layout and playback state, without
page text, media URLs or account details. It stays in memory until you choose to
export it; **Clear capture** discards it. Prepare the report before reloading or
closing the page. Special diagnostic builds start capture automatically on
Twitter/X. See the [Safari guide](docs/safari.md) for capture limits.

The Safari edition targets iOS/iPadOS 18.4+ and macOS 15.4+ with Safari 18.4+.
It shares the extension engine and includes a native containing app. Current
verification, uploads and TestFlight availability are tracked in the
[release packet](docs/testflight.md). See [Safari development](docs/safari.md)
for builds, activation, verification status, and device testing.

The unreleased build 13 candidate gives controlled HTML5 videos StayFast's
inline play/pause, ten-second skips, mute, timeline, speed and fullscreen controls.
Controls adapt to the visible video area with 44px targets. The original video
stays in its site DOM; attachment does not load, play, open fullscreen or scroll
the page. StayFast prepares inline playback even when the site omitted inline flags.
Recognized single-video YouTube, Video.js, Plyr, JW Player and X controls are
hidden while StayFast owns playback; captions and unrecognized buttons remain.

**Full screen**, **Custom Player**, and supported site video/container fullscreen
API requests made synchronously during the active trusted click or keydown open
StayFast's player around that video. Controlled requests outside that active
event are suppressed; asynchronous site requests are not guaranteed to route.
**Use site player** restores the site's controls and fullscreen behavior.
Where Safari permits it,
the player can also expand its container using webpage fullscreen. On iPhone,
Safari's browser bars may remain visible. **More → Apple player** explicitly
opens Apple's native video fullscreen when available.
StayFast also clears old presentation and scroll state when a
feed reuses a video for a new source, so PiP/history return and old fullscreen
callbacks cannot reopen the previous view or replay its scroll position. See the
[Safari guide](docs/safari.md) for current evidence and release status.

StayFast preserves the page and nested scrolling positions when
entering or leaving the StayFast player or Apple player. It keeps intentional
page movement made while the custom view is open. Verification and release
status are tracked in the [Safari guide](docs/safari.md).

Inline controls use the video's connected layout for placement as a player
loads or moves. This avoids temporarily oversized controller geometry during
insertion. Controls stay at least 44px; small or cropped players progressively
reduce the transport controls. When the actual clipped video is smaller than
52px on either axis, the surface hides and native/site controls return. An active
owned fullscreen player acquires controls independently of inline fit.
The expanded speed panel fits the viewport with readable text. Placement accounts
for clipping and nearby page chrome where space permits. Verification limits
and current site issues are recorded in the
[Safari guide](docs/safari.md).

The custom player includes **1×** and **Pref** quick actions alongside speed selection,
play/pause, ten-second skips, scrubbing, and mute. While dragging the timeline,
move your finger farther above or below it for half, quarter, or tenth-speed
precision. Double-tap the left or right edge to skip back or forward ten seconds;
center taps keep their ordinary controls behavior. Native Safari double-tap
verification remains incomplete; see the [Safari acceptance record](docs/safari.md#build-12-presentation-policy-and-source-freeze-acceptance).
Skips show brief seek feedback.
Use the primary Fit/Fill button or pinch the video to change its fit. **Lock**
hides the controls and blocks playback gestures/keys; **Unlock** restores them.
**More** contains available captions/audio languages, **Apple player**, system controls, and
**Use site player**. Tap the duration to show remaining time. Live streams offer
**Go live** when a seek window exists.
**Done** returns to the page; **Use site player** hands that video back to its
original controls. StayFast's player fills the webpage viewport, with optional
container fullscreen where supported. Apple player uses Apple's controls;
StayFast cannot change that interface or add buttons inside it or Picture in Picture.
If an explicit Apple-player request is refused, StayFast can restore its viewing
surface for the same video when no newer input, navigation or player session intervenes.

On recognized X/Twitter players, tapping the picture reveals StayFast controls
without changing playback. Use Play/Pause explicitly, and Full screen to open
StayFast. Current X player links and older fullscreen buttons are recognized.

Takeover applies to supported HTML5 videos in frames where the extension has
access. Same-origin embedded players can expand their owning iframe; cross-origin
players remain inside their frame. Closed shadow trees, private/unsupported
embeds, previously captured native APIs and custom CSS fullscreen may bypass it.
Apple's protected player UI remains outside extension control. Chrome/Firefox
behavior is unchanged. Build 13 runtime verification is pending; build 12 evidence
does not verify takeover. Safari settings stay on this device;
this edition does not add iCloud settings sync. Current owned-player runtime
verification is tracked separately in the [Safari guide](docs/safari.md).

## Privacy

StayFast Video stores its settings in browser extension storage. It does not
send browsing activity, page content, or playback history to StayTech. It has no
StayTech account, ads, analytics, or external service. Read the complete
[privacy policy](PRIVACY.md).

## Open-source lineage

StayFast Video is an independently developed and maintained StayTech edition of
the open-source
[Video Speed Controller](https://github.com/igrigorik/videospeed) project,
originally created by Ilya Grigorik.

StayTech is not affiliated with or endorsed by the original project or its
contributors. The original copyright and MIT license are preserved. See
[Open-source acknowledgments](docs/ATTRIBUTION.md) for details.

## License

Licensed under the [MIT License](LICENSE).

- Copyright © 2014 Ilya Grigorik
- Copyright © 2026 StayTech for modifications

The StayFast Video product and branding are maintained by StayTech.

### Reliability and performance verification

StayFast repairs controls removed by a site's DOM updates using the existing
controller, and each iframe controls its own media. Speed cooldown and reset
fight state belong to each video independently. Large DOM changes are processed
in bounded slices, with duplicate visibility updates and overlapping scans
coalesced.

Run `npm run test:e2e:browsers` for deterministic Chrome and Firefox coverage of
feed discovery, SPA replacement, source changes, enable toggles, shadow DOM,
controller repair and iframe ownership. Install Firefox with
`npx puppeteer browsers install firefox`, or set `FIREFOX_BIN`.

Run `npm run test:performance` for paired enabled/disabled Chrome workloads:
media-less DOM churn, media feeds and frames. It records attachment latency,
main-thread work, mutation queue/slice metrics, heap measurements and controller
retention after teardown. Results describe the measured machine; compare repeated
runs before setting performance budgets. Live YouTube verification is available
through `npm run test:e2e:isolated` on macOS with the disposable test runner.

### Focus Peek zoom shortcuts

With the updated Focus Peek extension installed, an open preview takes priority
for its zoom and pan shortcuts (`Z` and `Shift+Z` by default). StayFast skips
rewind for those presses, even with exclusive shortcuts enabled. Closing the
preview returns rewind immediately. Customized and disabled Focus Peek bindings
are respected; loading/error previews leave StayFast shortcuts available.

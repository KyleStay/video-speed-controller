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
- **Fine-grained speed** — choose speeds from 0.07× to 16× in configurable
  increments.
- **Precise navigation** — seek by custom intervals, set and revisit markers,
  and step through video frame by frame while paused.
- **Custom keyboard control** — remap actions, use modifier chords, and create
  multiple preferred-speed shortcuts.
- **Per-site intelligence** — choose site-specific speeds or disable the
  controller where you do not want it.
- **Resilient playback preferences** — optionally remember your speed and
  reapply it when a player attempts to reset it.
- **Adaptable controller** — reposition the on-media indicator and customize
  its appearance.
- **Private by design** — playback and page processing stay in your browser.
  See the [privacy policy](PRIVACY.md) for details.

Controls recover when a page replaces its document. Players inside open shadow
DOM keep the speed indicator synchronized with native player speed changes.
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

Frame stepping is video-only. StayFast Video uses the detected frame rate when
available and otherwise uses the configurable fallback (30 fps by default).
All shortcuts and their values can be changed in the extension settings.

The toolbar popup controls media across the current tab, including iframe
players. It shows when players use different speeds and disables speed controls
when the extension is off or no media is available. Turning it back on refreshes
the controls in the same popup.

Settings can be exported and imported as JSON. Invalid shortcut values, site
rules, and preference values are rejected before an import changes your saved
settings. If saving defaults fails, your existing settings are preserved. Use Tab or Shift+Tab
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

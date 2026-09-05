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

## Install for local development

Requirements: a current Node.js release compatible with the version in
`.nvmrc`, npm, and a Chromium-based browser.

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

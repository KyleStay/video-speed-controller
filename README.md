# StayFast Video

Video/audio playback speed, precise seeking, frame steps, shortcuts, site rules
and supported animated GIF controls for Chrome and Firefox.

## Development

Install the project dependencies, then use `npm run build` for Chrome or
`npm run build:firefox`. See [browser builds](docs/browser-builds.md),
[agent contracts](docs/agent-contracts.md) and [local CI](docs/LOCAL-CI.md).
Run `python3 scripts/local-ci.py` and applicable built-browser checks before a PR.
All CI is local; hosted workflows remain inactive.

## Safari

Safari, iPhone/iPad, the native Mac containing app, SF Symbols, device QA and
TestFlight delivery now live in the private `KyleStay/stayfast-safari` repository.
This checkout no longer builds or packages Safari. Shared legacy compatibility
code remains here so Chrome/Firefox behavior and regression coverage are preserved.
The split does not remove historical source or revoke previous MIT grants.

## Attribution and license

StayFast incorporates Video Speed Controller by Ilya Grigorik. StayTech maintains
this edition independently. See [attribution](docs/ATTRIBUTION.md).
This Chrome/Firefox repository remains licensed under the [MIT License](LICENSE).

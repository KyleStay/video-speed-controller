# Agent guide — StayFast Video

`CLAUDE.md` imports this file. Keep this entry point and linked contracts accurate
in the same change that invalidates them. For interface copy, follow Default
taste in `/Users/kyle/.codex/AGENTS.md`.

StayFast is a Manifest V3 extension for HTML5 video/audio and supported animated
GIF images, with no backend. Source is in `src/`; esbuild resources are in
`dist/` or `dist/<browser>/`. Safari has a native containing app under `apple/`
and targets Safari/iOS 18.4+.

## Essential invariants

1. Reliability comes first, then performance, then collaboration. Guard browser
   APIs, cross-origin access and site DOM assumptions. Every frame receives the
   script at `document_start`; frames without media need near-zero work. Use
   bounded, deferred work and events, without discovery polling.
2. ISOLATED `content-bridge` owns content-side `chrome.*` access. MAIN owns page
   logic and may persist only `lastSpeed` through the bridge. Each document owns
   only its own media. Background memory is not durable.
3. Modules register on `window.VSC`. Keep entry-point order and
   `tests/helpers/module-loader.js` synchronized. Every listener, observer, timer,
   animation, frame callback and owned DOM/property change needs matching cleanup
   across removal, toggle, document replacement and source changes.
4. Accepted playback and decoded progress support rate claims. Requested-rate
   readback, a fixture, compilation or an upload supplies only its own evidence.
   Preserve the original acceptance scope and retain explicit incomplete results.
5. Preserve unrelated work, protected worktrees, production storage boundaries,
   branch protection and security settings. Stage, commit, push, merge, publish
   or upload only within the user's requested scope.
6. CI runs locally. Never dispatch, rerun, enable or add hosted workflows, consume
   Actions credits, register runners or create CI credentials. Archived workflow
   references stay outside `.github/workflows`; report generated control gaps.

## Read before changing

| Work                                                                  | Required reference                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Content worlds, bridge, startup, storage or popup commands            | [Execution model and bridge protocol](docs/agent-contracts.md#execution-model-read-this-before-touching-content-script-code)     |
| Media, GIFs, source selection, captions, controllers or observers     | [Module contracts](docs/agent-contracts.md#module-map-src) and [invariants](docs/agent-contracts.md#conventions--invariants)     |
| Shortcuts, rate authority, settings, lifecycle, touch or presentation | [Runtime invariants](docs/agent-contracts.md#conventions--invariants)                                                            |
| Safari packaging, touch UI, source/clock/handback or diagnostics      | [Safari contracts and acceptance](docs/safari.md); native setup in [apple/README.md](apple/README.md)                            |
| Browser/native verification, device experiments or cleanup            | [Verification workflow](docs/agent-workflow.md) and [native QA guide](tests/safari-ios/README.md)                                |
| CI migration, dependency audit or local verification                  | [Local CI policy](docs/LOCAL-CI.md), [scripts/local-ci.py](scripts/local-ci.py) and [package.json](package.json)                 |
| Authorized landing or TestFlight delivery                             | [Delivery authorization](docs/agent-workflow.md#authorized-landing-and-testflight-work) and [release packet](docs/testflight.md) |
| Behavior evidence, scope substitutions or completion reports          | [Acceptance and reviewer guidance](docs/acceptance-review.md)                                                                    |
| Historical candidate measurements or build narratives                 | [Safari history](docs/safari-history.md) and [TestFlight history](docs/testflight-history.md)                                    |
| Current upload, processing or tester availability                     | [Generated release ledger](docs/generated/safari-release-status.json); preserve observation timestamps and unknown states        |

## Verification

Run focused repeatable regressions first, then the repository's lint, test and
release-resource build gate. [scripts/local-ci.py](scripts/local-ci.py) performs
isolated offline checks without overwriting retained products. For UI or
site-specific changes, run applicable built-browser/native checks from the
[verification workflow](docs/agent-workflow.md#definition-of-done-pre-pr-gate).
Media discovery, controller insertion, readiness, shortcut and lifecycle changes
require real built-extension verification; jsdom and builds alone do not satisfy
that gate. Report unavailable platforms, interactive gates and skipped assertions
as incomplete. Keep reads/output bounded and full logs in run artifacts.

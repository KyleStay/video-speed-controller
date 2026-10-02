# Agent guide — StayFast Video

Guidance for AI agents and contributors working in this repo. `CLAUDE.md`
imports this file (`@AGENTS.md`). Keep it accurate; update it in the same PR as
any change that invalidates it.

## What this is

A Manifest V3 browser extension that adds speed/seek controls to any HTML5
`<video>`/`<audio>` element on any site. Pure browser extension — no backend.
Source in `src/`, bundled by esbuild into a default Chrome `dist/` or explicit
browser resource builds under `dist/<browser>/`. Chrome and Firefox are
release-ready; Safari is experimental conversion input only.

## Project priorities (in order)

1. **Reliability** — it runs in every frame of every page for many users. A
   crash, leak, or dropped controller is the worst outcome. Guard every
   `chrome.*` call, every cross-origin frame access, and every site-handler
   assumption about the DOM.
2. **Performance** — the content script is injected at `document_start` into
   **every frame** (`all_frames: true`). The common case is a frame with **no
   media**. Per-frame and per-mutation work on media-less pages must stay near
   zero. Defer expensive work; don't poll.
3. **Organized for effective agent collaboration** — this file, clear module
   boundaries, and tests that encode the non-obvious invariants.

When two priorities conflict, the lower number wins (e.g. don't take a perf
optimization that can silently drop media — see `hasMediaIndicators`).

## Execution model (read this before touching content-script code)

Three JS contexts, isolated by design:

- **ISOLATED world** — `src/entries/content-bridge.js`. Has `chrome.*` APIs, no
  access to page JS. It is the _only_ content-side code that talks to
  `chrome.storage`/`chrome.runtime`. Bridges to the MAIN world via
  `CustomEvent`s dispatched on `document.documentElement`.
- **MAIN world** — `src/entries/inject-entry.js` → bundled to `dist/inject.js`.
  Runs in page context: can read the page's own globals (e.g. `window.netflix`)
  and media elements, but has **no** `chrome.*` APIs. All the real controller
  logic lives here.
- **Background context** — `src/background.js`. Migrations, toolbar icon state,
  enable/disable lifecycle. Chrome uses an MV3 service worker; Firefox uses an
  MV3 event page. Neither context is durable — never assume
  in-memory state survives.

UI pages (`src/ui/popup`, `src/ui/options`) run in normal extension contexts
with direct `chrome.*` access.

### Bridge protocol (CustomEvents on `document.documentElement`)

- `utils/bridge-events.js` owns the event subscriptions in each world and
  rebinds them when the document root changes, including after `document.open()` /
  `document.write()`. Its observer watches only direct document children. Bridge
  and lifecycle subscriptions persist through enable toggles; temporary response
  and CSS subscriptions are removed through the same transport.

- Firefox's ISOLATED world uses `cloneInto(payload, document.defaultView)` for
  outbound object payloads (`dispatchPageEvent` in `content-bridge.js`). Page
  scripts otherwise cannot read CustomEvent details from that realm. Keep
  filtering and validation before cloning; never clone extension functions/APIs.
- Settings handshake: MAIN fires `VSC_REQUEST_SETTINGS`; the persistent bridge
  listener replies `VSC_SETTINGS_READY` from a fresh bounded storage read (or
  `{abort:true}` for disabled/blacklisted sites and read failures). This supports
  enable-toggle/document-replacement reinitialization without stale defaults.
  The bridge fetches a **bounded** key set
  (`src/utils/setting-keys.js`), not `get(null)`.
- Storage changes: bridge relays `VSC_STORAGE_CHANGED`; the `enabled` toggle
  alone drives lifecycle `VSC_MESSAGE` `VSC_TEARDOWN`/`VSC_REINIT`.
- Popup/background → content: `chrome.runtime.onMessage` → `VSC_MESSAGE` →
  MAIN handles → `VSC_MESSAGE_RESULT`.
- Popup commands include a `commandId`. Each ISOLATED bridge also returns its
  result via `VSC_FRAME_RESULT` to the popup, which aggregates replies for a
  bounded 350ms window. This avoids `tabs.sendMessage`'s first-response race
  when the parent has no media and an iframe does. Replies are scoped to the
  command, extension, tab, and frame; popup close removes pending listeners
  and timers. Ordinary commands retain the single-response protocol.
  Popup response generations prevent stale replies from changing the UI;
  separate lifecycle generations cancel pending dispatch only on power changes
  or popup close, so rapid relative-speed clicks each reach the media.
- **Trust boundary**: the MAIN world may write **only `lastSpeed`** back to
  storage (`VSC_WRITE_STORAGE`); everything else is read-only from MAIN.

## Module map (`src/`)

- `entries/` — esbuild entry points only (`content-bridge`, `inject-entry`).
- `content/inject.js` — `VideoSpeedExtension`: lifecycle (initialize/teardown),
  deferred scanning, controller attach/detach, document-replacement recovery,
  SPA-navigation recovery (`setupSpaNavigationRecovery` re-scans on
  `yt-navigate-finish`/`popstate` so a media swap that drops the controller
  doesn't permanently surrender shortcut keys to the site).
- `core/`
  - `settings.js` — `VideoSpeedConfig`: load/save, debounced speed writes,
    migrations, self-echo guard.
  - `storage-manager.js` — context-aware storage (chrome vs bridge).
  - `state-manager.js` — registry of controlled media elements.
  - `action-handler.js` — executes shortcut actions (speed/seek/mark/frame-step/…).
    `stepFrame` (the `,`/`.` frame-step actions) seeks by `1/fps` **video-only**
    and **only while paused**; it writes `currentTime` via the seek path, never
    `playbackRate`, so it never touches the ratechange cooldown/fight machinery.
  - `video-controller.js` — per-media controller + DOM insertion. Also runs a
    **frame-rate detection burst** (`requestVideoFrameCallback`) that measures
    real fps while the video plays, snaps to a common rate, caches it on
    `controller.detectedFps`, then stops (zero steady-state cost). Frame-step
    uses `detectedFps`, falling back to the binding's configurable fps value.
- `observers/`
  - `media-observer.js` — light/comprehensive media scanning (incl. shadow DOM,
    depth-capped); `hasMediaIndicators` gate.
  - `mutation-observer.js` — detects dynamically added/removed media; tracks
    ready/playing X/Twitter media through capture listeners on the document and
    observed open shadow roots, so busy feeds attach without waiting for
    idle mutation processing; removes those listeners on stop/root pruning;
    other sites retain deferred insertion so page player handlers finish first;
    existing and late-created open shadow roots (guarded `attachShadow` hook);
    deferred `style`/`class` watching; document-replace detection.
- `site-handlers/` — `base-handler` + per-site (`netflix`, `youtube`, …),
  `index.js` is the manager/selector. `scripts/netflix.js` is a MAIN-world seek
  listener bundled for all pages (must be robust on non-Netflix sites).
- `ui/` — `controls`, `drag-handler`, `shadow-dom`, `vsc-controller-element`,
  `popup/`, `options/`.
  `popup/tab-command.js` aggregates frame replies in the popup extension context
  only; it is not part of the MAIN-world module loader.
- `utils/` — `constants` (+ `key-maps`), `logger`, `dom-utils`, `event-manager`,
  `blacklist`, `site-pattern`, `setting-keys`, `debug-helper`.
- `styles/` — `inject.css`, `controller-css-defaults.js`.

## Conventions & invariants

- **Global namespace**: modules self-register on `window.VSC` and run as side
  effects. Load order matters and is defined by `src/entries/inject-entry.js`
  (and mirrored in `tests/helpers/module-loader.js`). If you add a module,
  update both.
- **World rules**: ISOLATED code must not import page modules that populate
  `window.VSC`; MAIN code must not call `chrome.*`. Cross only via the bridge.
- **Teardown discipline**: anything you register (DOM listener, `MutationObserver`,
  `setTimeout`/`requestIdleCallback`, shadow observer, adopted stylesheet,
  `requestVideoFrameCallback`) must be removed in the matching
  `teardown()`/`cleanup()`/`stop()`. The extension is fully torn down and
  re-initialized on enable-toggle and on document replacement. Specifically,
  `VideoController.remove()` must `cancelVideoFrameCallback` any pending fps-burst
  handle and remove the `emptied`/`loadstart` re-arm listeners — the fps burst
  must never leak across teardown / re-init / document replacement.
  Removed media must clear pending attachment listeners even if it never received
  a controller. A sourceless element can outlive its attachment fallback timer.
- **Shadow media rate changes**: keep document capture for light-DOM media and
  forward non-composed shadow events through each controller's media listener.
  Forward only when the event path excludes the owner document, so composed and
  light-DOM events are handled once. `remove()` unregisters this listener.
- **Native speed controls**: only trusted clicks and unhandled key events open
  the user-gesture window for accepting a site's rate change. Programmatic
  clicks and dispatched keyboard events must not authorize a page speed reset.
- **Reliability guards**: wrap `chrome.*` and page-API access in try/catch;
  treat cross-origin frames as inaccessible; never assume `parentElement`
  exists — site handlers fall back to the media's own parent
  (`VideoController.insertIntoDOM`).
- **Shortcut capture**: the keydown listener attaches on `window` (capture
  phase), not `document` — `window` is the top of the capture chain, so a
  `document_start` listener stays ahead of page-level handlers a site
  (e.g. YouTube's Polymer app) adds later. `handleKeydown` only claims a key
  when there is controlled media, so a dropped controller silently surrenders
  keys; SPA-navigation recovery (above) re-attaches it. As a reactive safety net
  for media that loads _after_ the initial scans, a VSC-bound keypress with no
  controlled media triggers a one-off, throttled, **synchronous** rescan
  (`EventManager.requestMediaRescan` → `inject.js` `rescanForMediaSync`): a ready
  video (`readyState >= 2`) attaches synchronously and the same keypress acts on
  it; a still-loading one is primed (not force-attached) and handled a beat later.
  Every iframe is a separate context owned by its own `all_frames` VSC instance;
  parent frames do not claim same-origin child media. X/Twitter may
  act on `keypress` or `keyup` after VSC claims `keydown`, so its window-capture
  listeners suppress only follow-up events associated with a keydown VSC
  actually claimed. They never run the VSC action again, and `cleanup()` removes
  the listeners and clears the remembered keys.
- **Shift-exclusive frame-step keys**: `rewindFrame` (`,`) and `advanceFrame`
  (`.`) carry an explicit **all-false `modifiers` object** in `DEFAULT_BINDINGS`.
  That routes them through `findMatchingBinding`'s chord tier (exact modifier
  match), so bare `,`/`.` fire but `Shift+,`/`Shift+.` (`<`/`>`) do **not** — they
  fall through to YouTube's decrease/increase-speed keys. The options recorder
  re-stamps this all-false object when a bare key is re-recorded for these
  actions (`SHIFT_EXCLUSIVE_ACTIONS` in `options.js`), so re-recording can't
  silently downgrade them to a shift-catching simple binding.
- **Controller recovery**: site DOM churn may remove the overlay while leaving
  its media connected. Mutation reconciliation and media rediscovery call
  `VideoController.repairDOMPlacement()` to reinsert the same wrapper, preserving
  position, visibility and listeners. Detached media is disposed instead. Each
  document owns only its own media; YouTube embeds use their own `all_frames`
  instance, never a parent controller.
- **Rate state**: cooldown, fight count and timers are per-media in
  `EventManager.mediaRateStates`. Arm cooldown before writing `playbackRate`;
  synchronous ratechange must not recurse. `VideoController.remove()` releases
  that media's state; manager cleanup cancels every remaining timer.
- **Mutation budget**: deferred work coalesces repeated target/attribute records
  and deduplicates overlapping subtrees per mutation delivery with TreeWalker,
  including open roots. Later deliveries must rediscover reinserted media even
  while old work remains queued. A removed/reparented paused cursor restarts
  traversal at its root, skipping visited elements but entering their children.
  Slices yield after 4ms or 500 work units, with a 50ms continuation timeout.
  Individual browser operations can exceed the time budget; report measured
  `mutationStats.maxSliceMs`, not an assumed guarantee. Removals and document
  replacement remain explicit work. Stop clears records, walkers and repair
  iterators. Style/class changes only recheck known media, never scan arbitrary
  page subtrees. Do not introduce polling for discovery or repair.
- **Performance guards**: prefer `scheduleDeferredWork`/`requestIdleCallback`;
  idle callbacks use a bounded timeout so busy pages cannot stall startup; don't
  watch `style`/`class` mutations until the first media element exists
  (`MutationObserver.enableAttributeObservation`); skip the comprehensive scan on
  frames with no media signal (`hasMediaIndicators`); guard expensive log-string
  construction on hot paths with `logger.canLog(level)`.
- **Settings keys**: the bridge's bounded fetch (`SYNCED_SETTING_KEYS`) must
  cover every key in `DEFAULT_SETTINGS`. A test enforces this
  (`tests/unit/utils/setting-keys.test.js`) — add new settings to both.
  Removing a stored key restores its default in existing config instances and
  deletes it from the MAIN-world cache. Removing `customCSS` also removes its
  adopted sheet; removing `lastSpeed` cancels any pending stale speed write.
  Reset/import writes replacement settings first, then removes and restores an
  explicit `lastSpeed` so unchanged speeds still invalidate pending config and
  bridge saves. Never clear all storage before the replacement write succeeds.
  Imports omitting `lastSpeed` create and remove it to guarantee cancellation
  even when the key was already absent; its final stored state remains absent.
- **Logging**: use `window.VSC.logger` (levels in `Constants.LOG_LEVELS`), not
  `console.*`, in content/UI code.
- **Formatting**: Prettier + ESLint are enforced via Husky pre-commit and CI;
  run `npm run lint` / `npm run format`.

## Commands

```sh
npm run build          # dev build → dist/
npm run build:browsers # Chrome + Firefox builds → dist/<browser>/
npm run build:safari   # experimental conversion input → dist/safari/
npm run watch          # rebuild on change (dev)
npm run build:release  # minified release build
npm run release:browsers # minified Chrome + Firefox builds and ZIPs
npm test               # full vitest suite (unit + integration)
npm run test:unit      # unit only
npm run test:integration
npm run test:e2e       # builds, then Puppeteer E2E (needs Chrome)
npm run test:e2e:isolated # release build, disposable macOS Chrome fixtures + live YouTube
npm run test:e2e:browsers # deterministic Chrome + Firefox regression matrix
npm run test:performance # paired enabled/disabled Chrome measurements
npm run lint           # eslint src + tests
npm run format         # prettier write
```

Tests use vitest + jsdom. Shared setup in `tests/helpers/` preloads all modules
onto `window.VSC` (`vitest-setup.js`) and provides a chrome mock
(`chrome-mock.js`) and DOM/media helpers (`test-utils.js`).

## Definition of done (pre-PR gate)

A change is done when **all** of the following hold:

1. `npm run lint` passes.
2. `npm test` passes, and the change is covered by **new or updated repeatable
   tests** (unit/integration) that encode the behavior — especially any
   reliability invariant or perf gate you relied on.
3. `npm run build:release` succeeds.
4. For UI or site-specific behavior, exercise `npm run test:e2e` or the manual
   guide in `tests/e2e/manual-test-guide.md`.
5. Docs are updated and accurate — this file when architecture/invariants change,
   `README.md` for user-facing behavior.

### Browser verification for media/controller changes

Changes to media discovery, controller insertion, readiness-event ordering,
shortcuts, or lifecycle must be exercised in the real built extension before
claiming a fix. Passing jsdom tests or building successfully is not browser
verification. Keep early readiness recovery scoped to X/Twitter; other sites,
especially YouTube/Polymer, must retain deferred controller insertion.

On macOS, run `npm run test:e2e:isolated` (or append `-- basic` / `-- youtube`
for a focused run) using the `chrome-extension-test-runner` skill. The default
runner path is under `~/.codex/skills`; `STAYFAST_CHROME_RUNNER` can override it.
If sandbox restrictions block localhost/CDP, request narrowly scoped escalation
for this disposable browser QA through the normal approval mechanism. This repo
authorizes that verification; do not change the user's browser profile or bypass
an approval rejection.
For the full hardening matrix, use
`node tests/e2e/run-isolated.js fixtures benchmarks youtube`. This builds browser
resources, runs both fixture browsers, records performance evidence, then tests
live YouTube. Firefox requires `npx puppeteer browsers install firefox` or a
`FIREFOX_BIN` runtime. Install disposable test runtimes in `/tmp` when needed.
Batch browser work in this reusable command and reuse its scoped approval when
available. Do not interrupt the user with separate permission requests for each
read, screenshot, click, or diagnostic step within the authorized QA run.

Verify the reported failure and neighboring behavior: newly loaded feed videos
with older controlled media present; actual YouTube playback, buttons, shortcut
keys, and navigation to another video. Check playbackRate and controller state,
inspect a screenshot, and record any page errors. Uncaught page errors fail
the active runtime check; network/ad console diagnostics alone do not. Use genuine browser clicks and
keystrokes for interaction checks, not only dispatched events or `.click()` in
page JavaScript. Do not count skipped assertions or unavailable playback as a
pass. Label local fixtures and live-site checks separately in the final report.

Close each disposable browser through `Browser.close`, verify its owned
process tree exited, then remove its profile. If a required runtime check remains
blocked, report the exact blocker and leave browser verification incomplete;
do not present the change as a verified fix.

CI (`.github/workflows/ci.yml`) runs audit → lint → Chrome/Firefox release builds
→ test → Chrome/Firefox deterministic fixtures → Chrome/Firefox packages
→ local-fixture Chrome E2E on pushes/PRs to
`main`. Keep the branch list in sync with the default branch.

## Codex usage — context-window efficiency

When driving this repo through Codex (or any token-metered agent), keep reads
and command output bounded:

- Prefer bounded reads over dumping whole files: `sed -n '1,120p' file.log`,
  `rg -n "error" src --max-count 20`, `head -n 40 README.md`, `tail -n 25 diagnostics.log`.
- Cap listings: `ls src --color=never | head -n 50`; avoid open-ended directory traversals.
- Query telemetry summarized first — counts, aggregates, and top-N before wide rows:
  `SELECT error_code, COUNT(*) FROM telemetry GROUP BY error_code ORDER BY COUNT(*) DESC LIMIT 10;`,
  then fetch a single id only if needed.
- After edits, scope re-checks: `git diff --name-only` then `rg -n "TODO|FIXME" <changed file>`;
  batch nearby checks in one pass (`rg -n "TODO|FIXME|XXX" src --max-count 80`).
- Keep output small: pipe to `head`/`tail`/line limits; replace broad logs with summaries
  (`tail -n 200 app.log | rg -c "ERROR"`). Summarize prior findings in one short list rather
  than copying long command history or whole transcripts across turns.

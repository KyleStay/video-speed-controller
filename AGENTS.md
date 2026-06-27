# Agent guide — Video Speed Controller

Guidance for AI agents and contributors working in this repo. `CLAUDE.md`
imports this file (`@AGENTS.md`). Keep it accurate; update it in the same PR as
any change that invalidates it.

## What this is

A Manifest V3 Chrome extension that adds speed/seek controls to any HTML5
`<video>`/`<audio>` element on any site. Pure browser extension — no backend.
Source in `src/`, bundled by esbuild into `dist/`.

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
- **Service worker** — `src/background.js`. Migrations, toolbar icon state,
  enable/disable lifecycle. MV3 workers are killed and restarted — never assume
  in-memory state survives.

UI pages (`src/ui/popup`, `src/ui/options`) run in normal extension contexts
with direct `chrome.*` access.

### Bridge protocol (CustomEvents on `document.documentElement`)

- Settings handshake: MAIN fires `VSC_REQUEST_SETTINGS`; bridge replies
  `VSC_SETTINGS_READY` once `chrome.storage` resolves (or `{abort:true}` for
  disabled/blacklisted sites). The bridge fetches a **bounded** key set
  (`src/utils/setting-keys.js`), not `get(null)`.
- Storage changes: bridge relays `VSC_STORAGE_CHANGED`; the `enabled` toggle
  alone drives lifecycle `VSC_MESSAGE` `VSC_TEARDOWN`/`VSC_REINIT`.
- Popup/background → content: `chrome.runtime.onMessage` → `VSC_MESSAGE` →
  MAIN handles → `VSC_MESSAGE_RESULT`.
- **Trust boundary**: the MAIN world may write **only `lastSpeed`** back to
  storage (`VSC_WRITE_STORAGE`); everything else is read-only from MAIN.

## Module map (`src/`)

- `entries/` — esbuild entry points only (`content-bridge`, `inject-entry`).
- `content/inject.js` — `VideoSpeedExtension`: lifecycle (initialize/teardown),
  deferred scanning, controller attach/detach, document-replacement recovery.
- `core/`
  - `settings.js` — `VideoSpeedConfig`: load/save, debounced speed writes,
    migrations, self-echo guard.
  - `storage-manager.js` — context-aware storage (chrome vs bridge).
  - `state-manager.js` — registry of controlled media elements.
  - `action-handler.js` — executes shortcut actions (speed/seek/mark/…).
  - `video-controller.js` — per-media controller + DOM insertion.
- `observers/`
  - `media-observer.js` — light/comprehensive media scanning (incl. shadow DOM,
    depth-capped); `hasMediaIndicators` gate.
  - `mutation-observer.js` — detects dynamically added/removed media; shadow-root
    observers; deferred `style`/`class` watching; document-replace detection.
- `site-handlers/` — `base-handler` + per-site (`netflix`, `youtube`, …),
  `index.js` is the manager/selector. `scripts/netflix.js` is a MAIN-world seek
  listener bundled for all pages (must be robust on non-Netflix sites).
- `ui/` — `controls`, `drag-handler`, `shadow-dom`, `vsc-controller-element`,
  `popup/`, `options/`.
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
  `setTimeout`/`requestIdleCallback`, shadow observer, adopted stylesheet) must be
  removed in the matching `teardown()`/`cleanup()`/`stop()`. The extension is
  fully torn down and re-initialized on enable-toggle and on document replacement.
- **Reliability guards**: wrap `chrome.*` and page-API access in try/catch;
  treat cross-origin frames as inaccessible; never assume `parentElement`
  exists — site handlers fall back to the media's own parent
  (`VideoController.insertIntoDOM`).
- **Performance guards**: prefer `scheduleDeferredWork`/`requestIdleCallback`;
  don't watch `style`/`class` mutations until the first media element exists
  (`MutationObserver.enableAttributeObservation`); skip the comprehensive scan on
  frames with no media signal (`hasMediaIndicators`); guard expensive log-string
  construction on hot paths with `logger.canLog(level)`.
- **Settings keys**: the bridge's bounded fetch (`SYNCED_SETTING_KEYS`) must
  cover every key in `DEFAULT_SETTINGS`. A test enforces this
  (`tests/unit/utils/setting-keys.test.js`) — add new settings to both.
- **Logging**: use `window.VSC.logger` (levels in `Constants.LOG_LEVELS`), not
  `console.*`, in content/UI code.
- **Formatting**: Prettier + ESLint are enforced via Husky pre-commit and CI;
  run `npm run lint` / `npm run format`.

## Commands

```sh
npm run build          # dev build → dist/
npm run watch          # rebuild on change (dev)
npm run build:release  # minified release build
npm test               # full vitest suite (unit + integration)
npm run test:unit      # unit only
npm run test:integration
npm run test:e2e       # builds, then Puppeteer E2E (needs Chrome)
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

CI (`.github/workflows/ci.yml`) runs lint → build:release → test → package on
pushes/PRs to `main`. Keep the branch list in sync with the default branch.

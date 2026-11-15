# Runtime architecture and contracts

Read the applicable sections before changing content scripts, media handling,
controllers, settings, presentation or lifecycle. These contracts were moved
from `AGENTS.md` without weakening their requirements. Paths in code spans are
relative to the repository root. Update this reference with changes that
invalidate it; use [the entry guide](../AGENTS.md) for workflow navigation.

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
- Startup supports either script-world order: bridge announces
  `VSC_BRIDGE_READY` after installing listeners; a pending MAIN settings request
  retries on that event and removes both response listeners when settled.
  MAIN also retains a lifecycle readiness listener so a bridge arriving after
  the bounded settings timeout can restart failed startup; it does not restart
  an initialized/pending instance or undo explicit teardown. Verify both orders
  and arrival after timeout with `npm run test:e2e:startup` on macOS.
  On visible-tab/persisted-history restoration, the bridge coalesces a fresh
  bounded settings read to reconcile missed storage changes and enabled state.
  Async reads merge newer storage events per key, preserve removals, and never
  let a late older read replace a newer completed snapshot. Resume pauses queued
  bridge speed persistence: unchanged stored speed preserves the pending user
  choice; changed/removed speed cancels it before persistence restarts.
  `npm run test:e2e:resume` exercises these races in real built worlds using a
  disposable, instrumented bridge copy that drops notifications or holds reads.
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
  Frame-step completion triggers one bounded status read, without repeating the
  action, so stale eligibility and rejected frames cannot disable speed controls
  or hide mixed playback rates.
- **Trust boundary**: the MAIN world may write **only `lastSpeed`** back to
  storage (`VSC_WRITE_STORAGE`); everything else is read-only from MAIN.
  Popup `VSC_GET_SITE_INFO` targets frame 0 and reads its HTTP(S) URL directly
  in ISOLATED, without a page event or new tab/host permissions. Site-rule writes
  stay in extension UI contexts.

## Module map (`src/`)

- `entries/` — esbuild entry points only (`content-bridge`, `inject-entry`).
- `content/inject.js` — `VideoSpeedExtension`: lifecycle (initialize/teardown),
  deferred scanning, controller attach/detach, document-replacement recovery,
  SPA-navigation recovery (`setupSpaNavigationRecovery` re-scans on
  `yt-navigate-finish`/`popstate` so a media swap that drops the controller
  doesn't permanently surrender shortcut keys to the site).
  Persisted `pageshow` and visible `visibilitychange` use the same coalesced,
  media-gated deferred recovery path after tab suspension or history restoration;
  teardown removes these listeners along with navigation listeners.
- `core/`
  - `gif-decoder.js` — bounded GIF89a framing and native single-frame patch decoding,
    transparency/disposal compositing and PNG snapshots. No third-party decoder.
  - `gif-playback.js` — media-shaped properties on the original `<img>` and an owned
    Web Animation of its `content` image; shared speed/seek/pause/frame-step actions.
    Cancelling that animation restores native rendering without changing `src`,
    wrapping/replacing the image or writing its layout styles.
  - `settings.js` — `VideoSpeedConfig`: load/save, debounced speed writes,
    migrations, self-echo guard.
  - `storage-manager.js` — context-aware storage (chrome vs bridge).
  - `state-manager.js` — registry of controlled media elements.
  - `action-handler.js` — executes shortcut actions (speed/seek/mark/frame-step/…).
    `stepFrame` (the `,`/`.` frame-step actions) seeks by `1/fps` **video-only**
    and **only while paused**; confirmed GIF images use their actual frame
    boundaries instead. It writes `currentTime`, never
    `playbackRate`, so it never touches the ratechange cooldown/fight machinery.
    Expanded controllers and the toolbar popup expose Frame back/Frame forward
    buttons through this same paused-video action.
  - `video-controller.js` — per-media controller + DOM insertion. Also runs a
    **frame-rate detection burst** (`requestVideoFrameCallback`) that measures
    real fps while the video plays, snaps to a common rate, caches it on
    `controller.detectedFps`, then stops (zero steady-state cost). Frame-step
    uses `detectedFps`, falling back to the binding's configurable fps value.
    Reconcile source visibility on `loadeddata`, `loadstart` and `emptied`:
    a child `<source>` can become ready without a video `src` attribute mutation.
    Removal releases these listeners with the source observer.
- `observers/`
  - `gif-observer.js` — visible GIF candidates only, captured image loads and the
    existing bounded mutation/shadow walk. One decode at a time; byte, frame and
    document memory limits; same-origin/CORS fetches with no new permissions.
    Source writes/removal/disable/document replacement abort pending work and
    release owned properties, animations, listeners and frame URLs.
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
  `video-load-diagnostics` owns bounded, opt-in in-memory load/scroll traces;
  `diagnostic-report` projects their schema at the ISOLATED and popup boundaries.
  MAIN writes only `lastSpeed`; diagnostic reports travel through request/reply
  and remain in memory until the user explicitly copies or shares them.
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
- **Generic native seeking**: retain the full `[0, duration]` timeline for finite
  recordings. For unbounded or unavailable duration, read the latest valid native
  `seekable` range on each input and clamp to that window. Never invent a target
  without finite current time, finite input and usable bounds. Contain timing
  getter/setter failures during source changes. Domain-specific seek bridges
  retain their own contracts. The local media-profile suite covers real decoded
  MediaSource playback with a moving window and subsequent recording handoff.
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
- **Focus Peek zoom cooperation**: before claiming or rescanning for a bound
  key, ask the `focus-peek-overlay` host in the keyboard event's own document
  via cancelable `focuspeek:claim-zoom-shortcut` (string normalized chord detail).
  Cancellation means the live preview owns zoom/pan: do not run the VSC action,
  consume the original event, or remember X/Twitter follow-ups. Closed, loading,
  unavailable, disabled, and native-control-interacting previews do not claim it.
  Custom bindings are negotiated by the preview; never hard-code a `KeyZ` bypass
  or let a parent preview steal a child's shortcuts. No polling or observers.
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
- **GIF-style videos**: muted, looping MP4/WebM videos qualify for controls even
  without native or custom transport. Apply only the existing site-specific
  vetoes.
- **GIF images**: confirm multiple image descriptors before taking over an `<img>`.
  Gate discovery on GIF paths/format hints, GIF data URLs, blobs or selected picture
  sources; ordinary still-image URLs cause no fetch. Keep native rendering on
  unreadable/CSP-blocked/unsupported or over-budget input. `GifDecoder.limits`
  owns byte/frame/pixel budgets; active GIFs share the frame-pixel budget and
  `GifObserver` limits player count per document. Preserve GIF delays, transparency, disposal and finite
  loop counts. Never use video-site SDKs for GIF playback. Frame-step uses actual
  GIF boundaries while paused. Offscreen/hidden suspension preserves an explicit
  pause. `node tests/e2e/run-isolated.js gif-images` verifies the built extension.
- **Touch controls**: coarse pointers or a touch on the pill select explicit
  expand/collapse state with 44px targets; hover does not control touch state.
  Keep the panel inside the visual viewport and preserve readable button labels.
  Opening, resize, outside-input and cleanup paths own their listeners and timers.
  Keep the accepted numeric rate and preset pressed states synchronized through
  `ShadowDOMManager.updateSpeedDisplay`.
- **Rate state**: cooldown, fight count and timers are per-media in
  `EventManager.mediaRateStates`. Arm cooldown before writing `playbackRate`;
  synchronous ratechange must not recurse. `VideoController.remove()` releases
  that media's state; manager cleanup cancels every remaining timer.
  Accepted rates are scoped to each media until its next explicit rate change;
  a clamped initialization must not overwrite the saved preference or recursively
  fight its own accepted readback. Cached accepted/lifecycle rates carry an
  external-preference revision: storage replacements/removals invalidate them;
  self-echo and sibling commands preserve the revision. `emptied`/`loadstart`
  release the source's rate state. Fight-back writes guard synchronous events
  and retain accepted rates. Unset (`null`) authority stays unset. Native
  assignments skip unchanged rates. Initialization never persists a speed.
  `utils/speed-limits.js` owns the 0.07×–16× product request range for every
  browser. Normalize legacy finite absolute rates above 16× on settings load,
  storage changes and settings import; preserve null authority, relative speed
  increments, seek intervals and frame rates. Playback commands, restoration
  and bridge persistence retain the same cap.
  Accepted playback state drives display/persistence; requested-rate readback
  alone does not prove high-rate decoded playback. Keep browser acceptance
  media-specific and record decoded progress before claiming support.
- **Mutation budget**: deferred work coalesces repeated target/attribute records
  and deduplicates overlapping subtrees per mutation delivery with TreeWalker,
  including open roots. Later deliveries must rediscover reinserted media even
  while old work remains queued. Removing/reordering a paused cursor or its
  ancestor restarts traversal at its root. Visited elements still consume a
  work unit during recovery; do not skip them in an unbounded TreeWalker filter.
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
- **Options autosave**: the options page serializes automatic writes, revert,
  reset and import. Typing coalesces for 400ms; committed changes save immediately.
  Ordinary writes and their single-step undo touch only changed fields. Reset/import
  retain a full replacement snapshot for undo until the next successful save or page close.
  Invalid/pending drafts can be discarded without undoing an earlier saved edit.
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

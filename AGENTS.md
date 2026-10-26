# Agent guide — StayFast Video

Guidance for AI agents and contributors working in this repo. `CLAUDE.md`
imports this file (`@AGENTS.md`). Keep it accurate; update it in the same PR as
any change that invalidates it.

## What this is

A Manifest V3 browser extension that adds speed/seek controls to any HTML5
`<video>`/`<audio>` element on any site. Pure browser extension — no backend.
Source in `src/`, bundled by esbuild into a default Chrome `dist/` or explicit
browser resource builds under `dist/<browser>/`. Chrome and Firefox are
release-ready; Safari targets Safari 18.4+/iOS 18.4+ with a native containing app
under `apple/`. Read `docs/safari.md` when changing Safari packaging, touch UI,
or Safari verification; successful compilation alone is not runtime verification.

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
  - `settings.js` — `VideoSpeedConfig`: load/save, debounced speed writes,
    migrations, self-echo guard.
  - `storage-manager.js` — context-aware storage (chrome vs bridge).
  - `state-manager.js` — registry of controlled media elements.
  - `action-handler.js` — executes shortcut actions (speed/seek/mark/frame-step/…).
    `stepFrame` (the `,`/`.` frame-step actions) seeks by `1/fps` **video-only**
    and **only while paused**; it writes `currentTime` via the seek path, never
    `playbackRate`, so it never touches the ratechange cooldown/fight machinery.
    Expanded controllers, the toolbar popup and owned-player More panel expose
    Frame back/Frame forward buttons through this same paused-video action.
  - `video-controller.js` — per-media controller + DOM insertion. Also runs a
    **frame-rate detection burst** (`requestVideoFrameCallback`) that measures
    real fps while the video plays, snaps to a common rate, caches it on
    `controller.detectedFps`, then stops (zero steady-state cost). Frame-step
    uses `detectedFps`, falling back to the binding's configurable fps value.
  - `safari-hls-playback.js` — bounded, same-video HLS→MP4 transitions for
    iOS native-HLS playback above 2×. `progressive-media-source.js` resolves same-item
    HTML alternatives and recognized Video.js/Brightcove/JW Player metadata;
    `twitter-media-source.js` resolves X’s nearby React props and current SDK track.
    All require an exact active HLS match and an explicitly supplied MP4; the
    current X SDK alone permits its observed appended `variant_version=1` marker
    when its selected HLS variant otherwise matches exactly. SDK caption/protection
    vetoes cannot fall back to older metadata or HTML alternatives.
    No fetches, new permissions, polling, or source URL construction.
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
  `ios-player` owns iOS video presentation/lifecycle; `ios-player-view` builds its
  accessible shadow-DOM dialog; `ios-player-scroll` preserves scroll around
  presentation changes and loads before `ios-player-frames`, which expands permitted
  same-origin iframe ancestors; `ios-player-scrubber` owns shared inline/fullscreen precision seeking;
  `ios-player-gestures` owns stage touch gestures. `ios-player-fullscreen` owns
  optional container DOM fullscreen, scoped to the active UI/session and target.
  `ios-inline-player` owns responsive inline transport; `ios-site-controls`
  reversibly hides exact recognized chrome; `ios-player-takeover` owns lazy,
  per-window iOS fullscreen hooks and the explicit Apple-player bypass. Existing
  child-list reconciliation and known-media class/style rechecks refresh site
  chrome recognition and ambiguity; scroll placement does not reacquire it.
  Read `docs/safari.md` before changing these.
  `popup/tab-command.js` aggregates frame replies in the popup extension context
  only; it is not part of the MAIN-world module loader.
- `utils/` — `constants` (+ `key-maps`), `logger`, `dom-utils`, `event-manager`,
  `blacklist`, `site-pattern`, `setting-keys`, `debug-helper`.
  `video-load-diagnostics` owns bounded, opt-in in-memory load/scroll traces;
  `diagnostic-report` projects their schema at the ISOLATED and popup boundaries.
  Read `docs/safari.md` before changing capture or diagnostic export. MAIN still
  writes only `lastSpeed`; diagnostic reports travel through request/reply and
  remain in memory until the user explicitly copies or shares them. Automatic
  X/Twitter capture requires the separate `STAYFAST_DIAGNOSTICS=1` build flag.
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
- **Touch controls**: coarse pointers or a touch on the pill select explicit
  expand/collapse state with 44px targets; hover does not control mobile state.
  Position the compact controller from the current media bounds; clamp its
  popover to the visual viewport. Measure inline geometry only when the host is
  connected. `VideoController.positionControls()` finishes generic coordinates
  and inline placement after insertion, before returning to target readiness
  handlers; waiting for ResizeObserver exposes transient overflow, demonstrated
  in Chrome and native WebKit. iOS placement repair repositions the same
  controller after reparenting; desktop manual drag positions remain intact.
  Regression checks must measure inside the readiness handler as well as after
  observer settling. iOS-owned inline transport adapts play/pause, seek, mute,
  timeline, speed and fullscreen to the available area, retaining 44px targets.
  The compact speed/fullscreen pair remains the fallback. Compact labels retain the accepted
  numeric rate in `dataset.speed` and full accessible text. Bounds account for
  scaled hidden/clip ancestors (at most 24 hops), stopping at scrolling ports.
  The legacy compact surface selects fullscreen-only below 180px wide or 96px
  high; owned transport uses its own responsive layout. Actual clipped media
  below 52px on either axis hides the surface, closes its popover and restores
  native/site controls. Active owned fullscreen acquires controls independently
  of inline fit. Owned inline top buttons retain their media-relative vertical
  anchor while scrolling; hide that strip when clipped by the viewport or a
  header, leaving the independently positioned bottom timeline available.
  Legacy compact placement uses at most
  three hit-test passes to avoid covering page chrome while staying within the
  clipped media/viewport; it does not escape blocking modals. Passive captured
  window scroll and visual-viewport scroll share one coalesced animation frame
  per window across known iOS controllers. Scroll work uses IO-intersecting
  entries, falling back to known entries without IO; resize/intersection events
  also refresh placement. Cleanup removes each entry and the last group's
  listeners/frame through its original window, including after document adoption.
  This schedules layout from events, without polling or page-scroll writes.
  Owned inline Play, speed and fullscreen retain stable ordering across responsive layouts.
  Idle visibility hides the entire root without changing child geometry; the root
  ignores pointer input while faded; keyboard focus can still reveal it.
  Popovers anchor beside the primary controls, clamp text to 13–18px, and make
  child buttons inherit that font rather than the configured global button size.
  Inline and fullscreen transport share a four-second idle delay while playing.
  Picture taps toggle the complete transport/timeline, including recognized
  single-video site overlays; a tap with an open menu dismisses that menu first.
  Paused media, active scrubbing, held pointers, open menus and keyboard focus
  prevent idle hiding. Dismissal/release starts a fresh interval. Explicit picture
  taps may hide paused controls; progress updates must not undo that choice.
  Inline layouts below 240px wide or 144px high keep their fallback controls
  available because the picture is too small for a reliable reveal target.
  Mouse movement and control/keyboard input reveal the interface. Size changes
  preserve minimum touch targets. Popover height/block-size stays intrinsic and
  grid rows use non-stretching 44px minima; narrow panels can use one column.
  Cleanup clears idle timers through the original scheduling window even after
  media adoption into an inert document, and releases placement listeners.
  The shared 1× preset and Pref buttons set absolute speeds through `SET_SPEED`;
  Pref reads the first `fast` binding at click time, falling back to 1× if absent.
  Route controller speed updates through `ShadowDOMManager.updateSpeedDisplay`
  so the pill label and preset pressed states stay synchronized.
  Expanded-panel viewport/outside listeners and media presentation listeners
  belong to `ControlsManager.cleanup()`, called by `VideoController.remove()`.
  Native fullscreen/PiP hides the on-page wrapper and returns it on exit;
  test these transitions in Safari. iOS owned-player behavior is below.
- **iOS presentation**: attachment separately owns the presence of `playsinline`
  and `webkit-playsinline`, including when the site originally omitted them, so
  ordinary Play stays inline. On iOS, attachment owns `controls=false` and inline
  transport without moving/loading/playing the media, opening fullscreen or
  writing page scroll. Exact known chrome is hidden only in unambiguous
  single-video YouTube/Video.js/Plyr/JW/X containers; captions and arbitrary
  unrecognized controls remain. Ownership is bounded and reversible.
  A per-media observer watches only these two attributes; after a bounded eight
  conflicts it hands back to the site. Cleanup/Use site player restores the
  latest site intent; a new source or explicit Custom Player re-enables inline
  ownership. Custom close and native exit retain inline policy. The primary
  Full screen action opens the owned player around the original media; Custom
  Player remains another explicit entry. `ios-player-fullscreen` requests DOM
  fullscreen only for the owned container where permitted. Guard asynchronous
  completion by UI/session/source generation; cleanup removes listeners and
  exits only its owned fullscreen target. More → Apple player explicitly invokes
  the original media's native presentation API through `withNative`. Lazy iOS-only
  per-window prototype hooks route controlled video/unambiguous container
  fullscreen requests synchronously during the current trusted click/keydown to
  the owned player. Authorize once using native `view.event` in dispatch phase
  1–3 and the available UserActivation guard. Keep no stored authorization,
  authorization timers; one lazy X-only click listener reveals inline controls on
  recognized picture taps and routes only explicit recognized fullscreen actions.
  Modern X recognition requires exact direct-video/XDS siblings and single-media
  ownership; navigation links are same-origin/post-scoped. The last owner removes
  that listener. Asynchronous requests have no routing
  guarantee. Requests without the current event are suppressed. Use site player restores controls
  and native passthrough. Last-owner cleanup restores only hooks still owned by
  StayFast, preserving later page patches. Captured APIs, inaccessible media and
  unknown CSS fullscreen can bypass interception. Chrome/Firefox remain unchanged.
  Native events alone never open the player or cause exit/reentry loops.
  Safari's bars may remain; webpage controls cannot modify Apple's UI.
  Inline-attribute ownership is separate and begins at attachment.
- **Recycled media sources**: both `emptied` and `loadstart` invalidate the old
  presentation generation, PiP/history resume flags and native/queued scroll
  snapshots. Close an active custom view using the current scroll position,
  then re-arm inline policy for the new resource. Deferred native failures must
  match the current generation; deferred play failures must match the active
  custom session/UI. A reused element must not inherit another source's view
  or scroll target. Native-begin events only observe presentation; they never
  create or refresh a post-entry scroll snapshot. Only an explicit native
  fullscreen request captures scrolling before invoking the browser API.
  The only exception is a verified pending `SafariHLSPlayback` transition
  between two supplied renditions of the same clip. It retains the owned presentation
  and local rate authority. An intervening site source/poster write, duplicate
  load, lost origin, document change, or disposal ends that exception. Never use
  a generic “source is changing” flag to bypass recycled-media protection.
  A denied explicit owned-to-Apple request may restore only its same-source
  viewport, with no play/fullscreen call; newer input (including wheel), URL/root,
  source, presentation or cleanup invalidates recovery. Native fullscreen events
  never open it.
- **Presentation scroll**: `IOSPlayerScrollState` captures page and composed
  nested-scroller offsets around native/custom entry and exit. Native transitions
  include accessible same-origin parents; frame expansion uses the validated
  same-origin protocol. Custom close preserves the current intentional page
  position rather than replaying a stale entry snapshot. Restore synchronously
  with at most two follow-up animation frames; wheel/touch/pointer/key input,
  pagehide/popstate, navigation/document changes, a new session and cleanup end
  correction. Cancel the original scheduling window's frames/listeners and
  retain cross-origin boundaries. This is bounded presentation repair, not
  scroll ownership or ongoing polling.
- **iOS player ownership**: retain the original media, source/srcObject,
  MediaSource/MediaKeys, and tracks. The source exception is eligible iOS native-HLS fast
  playback: a finite native-HLS clip may use the site's exact same-asset MP4
  rendition above 2×. Reject MSE/blob, DRM, live streams, meaningful/unknown in-band
  text tracks and alternate audio/video selections. SDK capability vetoes apply
  before every source route, including HTML children. JW `allSources` belongs to
  the current item; do not combine arrays or scan other items. Whole-player and
  video-only portals require bounded searches of retained and validated original
  scopes. External SDK metadata remains separate. Only Brightcove’s exact existing
  same-player `proxyTracks_.media.track_` identity may exempt its JavaScript-created
  metadata track; require current native membership, metadata kind, media-cues label
  and empty native dispatch type. Never call a track-creating SDK getter or trust
  a label alone. Revalidate immediately before load and verify native track/cue
  identity after switching. One unnamed empty captions
  placeholder may be dropped; MP4 cannot preserve text supplied later by HLS.
  Keep the original node, position, paused
  state and presentation. `load()`, pending start time, rate and any continuation
  `play()` run in one coordinated speed-command call stack, never metadata
  callbacks. Automatic init first joins only an already-requested Play promise;
  a bounded next-task check validates source/document/preferences/intent before
  issuing that command. It never starts paused media; cleanup/input/source/hidden
  state cancels the pending observer, listeners and ten-second deadline.
  Saved/session speeds also apply to subsequent feed clips; a failed
  source is not retried by initialization. Site changes always win. Teardown
  restores the original source only while still owned; Use site player retains
  the chosen rendition without another reload. A synchronous same-document portal move
  preserves known single-video player containers when possible; an anchor and
  placeholder own restoration. `repairDOMPlacement()` yields while active.
  Caption selection changes only subtitles/captions, preserving metadata tracks.
  Attribute enforcement has a bounded conflict budget and hands back to a
  competing site instead of sustaining a mutation loop. PiP temporarily closes
  ownership; cleanup cancels callbacks, restores owned attributes/styles/methods,
  and removes the view. Removed media stays removed; replacement media survives
  shell cleanup. Connected site reparenting releases presentation ownership while
  retaining the same controller/rate. Reopening remains explicit. Missing
  origins dispose the stale controller.
  Frame expansion accepts only a validated direct same-origin child; cross-origin
  and opaque frames remain local. A child token alone grants no parent authority.
- **iOS player interaction**: inline and fullscreen share `IOSPlayerScrubber`; an
  inline adapter scopes activity to ownership/source generation and releases it
  on handback, source changes, fullscreen and cleanup. Its absolute 44px timeline
  sits at the clipped video bottom, independent of the compact top strip; placement
  applies final occlusion and scale before rail offsets. Fractional selected time
  stays visible while scrubbing; rate feedback is empty at 1× and uses `×1/2`,
  `×1/4`, `×1/10` for modified sensitivity. Precision seeking captures one pointer
  and applies incremental horizontal movement at normal/half/quarter/tenth sensitivity as
  vertical distance from the timeline increases in either direction. Average
  gain across each delivered diagonal segment so event grouping cannot skip
  bands; consume the pointer-up endpoint before committing the final seek. It pauses
  during the gesture, clamps to current seek bounds, coalesces decoder writes,
  restores the starting time on cancellation, and resumes only an originally
  playing, still-current visible session. Close/cleanup cancels capture, timers,
  and gesture listeners without a stale resume. Edge touch double taps seek ±10s;
  center taps do not seek, and touch-derived `dblclick` never runs a second seek.
  A one-finger picture swipe commits only after more than 10px of horizontal-dominant
  movement; vertical intent keeps inline page scrolling. It reuses the shared
  scrubber, starts relative to current time, and measures precision from the
  finger's starting Y in either direction. The rail stays anchored to its own Y.
  Source/session checks run again at commitment. Capture begins only after intent;
  its synthesized click is suppressed. Two fingers before commitment retain owned
  fullscreen pinch or inline browser pinch; a second finger after commitment
  cancels the scrub and blocks further action until both lift. Scoped inline
  touch-action rules permit pan-y and pinch-zoom without changing media inline
  styles; handback/cleanup restores marker intent and removes the style/listeners.
  Unknown inline overlays use a separate gesture-only scope: at most eight
  picture-sized ancestors, exactly one video and no audio/iframe. Revalidate on
  input; preserve independent controls, unrelated dialogs, links, vertical scroll
  and pinch. A site's video dialog may own its picture; theater overlays outside
  a recognized player use the enclosing validated gesture scope.
  Fallback picture taps share menu dismissal/reveal with the video. Recheck the
  same scope, media uniqueness and current hit at the original touch point before
  committing a fallback drag; source/session checks run again afterward. Player
  and dialog focusability does not make the picture an independent control.
  Refresh through existing composition/placement recovery; never hide unknown
  chrome or add discovery polling. Handback/cleanup releases the scope.
  Fullscreen keeps its separate touch-action ownership. Lost capture on a slotted
  descendant during transfer to the stage must not cancel the stage's gesture.
  Gesture runtime proof requires two observed DOM touch pairs; an XCTest
  double-tap invocation that delivers only one pair is incomplete coverage.
  Pinch Fit/Fill owns stage touches separately. Active sessions own and restore
  `touch-action` on the light-DOM video and distinct portal container.
  Stage touch capture stops site-player handlers while preserving
  Safari's default synthesized click; cleanup removes these guards. More/Escape
  stays inside the dialog; keyboard range input remains usable. Lock hides the
  HUD and seek feedback, cancels queued scrubbing and blocks playback keys/gestures
  while preserving Escape, navigation and Unlock activation. Its separate Unlock
  target remains at least 44px; unlock refreshes controls. Seek feedback is transient, session-scoped, and
  cleared with its timer on close/cleanup. Native audio
  selection and captions stay separate; volume, PiP and
  AirPlay are capability-gated and honor the media's restriction flags.
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
  storage changes and Safari import; preserve null authority, relative speed
  increments, seek intervals and frame rates. Playback commands, restoration
  and bridge persistence retain the same cap.
  Accepted playback state drives display/persistence; requested-rate readback
  alone does not prove high-rate decoded playback. Keep Safari acceptance
  media/device-specific and record decoded progress before claiming support.
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

## Authorized landing and TestFlight work

When Kyle requests landing and a TestFlight update, carry both outcomes through
the installed `land-all-branches` and `testflight-release` workflows without
separate confirmation for recovery snapshots, reviews, routine repairs, PRs,
compliant merges, verified branch/worktree cleanup, archive/export, upload,
release notes, and the existing tester group's rollout. Preserve their review,
recovery, required-check, and upload-idempotency gates.

Use the [Complete Authorized Work skill](/Users/kyle/.codex/skills/complete-authorized-work/SKILL.md)
for command approval reuse. Run approved tools directly with the tool's `workdir`
set, and batch independent reads; avoid compound shell strings that turn each
already-approved operation into a new approval identity. Use this repo's existing
local CI, browser, Safari native, and TestFlight runners. Keep hosted CI inactive.
Use existing permissions and saved approvals. If an operation needs a new
interactive approval, cancel or skip it and continue independent permitted work.
Report required delivery steps left incomplete without asking Kyle to unblock
them; keep sandbox restrictions and approval policy intact.

## Commands

```sh
npm run build          # dev build → dist/
npm run build:browsers # Chrome + Firefox builds → dist/<browser>/
npm run build:safari   # Safari 18.4+ resources → dist/safari/
npm run watch          # rebuild on change (dev)
npm run build:release  # minified release build
npm run release:browsers # minified Chrome + Firefox builds and ZIPs
npm test               # full vitest suite (unit + integration)
npm run test:unit      # unit only
npm run test:integration
npm run test:e2e       # builds, then Puppeteer E2E (needs Chrome)
npm run test:e2e:ios-player # built owned iOS player in disposable mobile-emulated Chrome
npm run test:e2e:player-controls -- all # Chrome/Firefox frame buttons + controlled X touch routing
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

Use the owned lifecycle in `tests/e2e/browser-runtime.js` for Puppeteer suites;
await `cleanupFixtureBrowsers()` on failure and signals, including interruption
while launch or extension installation is pending. The isolated runner passes
`--owner-pid` so its detached Chrome is watched if the test owner disappears.
Close each disposable browser through `Browser.close`, verify its owned
process tree exited with retained start identities, then remove its profile.
Reuse installed browser versions; put any one-off download inside the run's owned
workspace and remove it after shutdown. Retain shared versions required by other
projects or active jobs. Historical recovery uses exact reviewed paths and Trash,
with allocated bytes and restore locations recorded; preserve source, releases,
required evidence, personal Chrome and unknown code-sign clones. If a required runtime check remains
blocked, report the exact blocker and leave browser verification incomplete;
do not present the change as a verified fix.

CI runs locally to conserve GitHub Actions credits. Use
`python3 scripts/local-ci.py` for isolated offline lint/build/test/package checks;
read `docs/LOCAL-CI.md` before CI changes, dependency audits or browser/native
validation. Keep GitHub-hosted workflows disabled: do not dispatch, rerun,
re-enable or push changes that start hosted CI. Report unavailable platforms as
unrun. The former workflow and Dependabot configuration remain recoverable in
`docs/ci-archive/`, outside active GitHub configuration paths.

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

# Verification and delivery workflow

Commands and configuration are authoritative in [package.json](../package.json),
[the local CI runner](../scripts/local-ci.py), and each owning executable.
Paths in code spans are relative to the repository root. This reference records
requirements and gotchas; consult those files for command
options rather than copying historical invocation examples.

## Device experiments

Assign one device owner per bounded experiment. Record that owner, the original
case ID, target device/window/source, authorized actions and stop/deadline before
collection. The owner completes setup, input, collection, settings restoration
and owned-resource cleanup within that authorization, without coordinator
approval for each click. Other agents may investigate independently, add
meaningful regressions or review the retained evidence; they do not operate the
same device concurrently. Return one concise result linked to the run artifact,
including missing input, incomplete criteria and cleanup failures. A changed
acceptance scope remains a reviewer decision.

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
5. Docs are updated and accurate — the [runtime contracts](agent-contracts.md) when architecture/invariants change,
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

# Acceptance scope and evidence review

The original case definitions live in
[`tests/safari-ios/acceptance-cases.js`](../tests/safari-ios/acceptance-cases.js),
separate from execution results. They retain the original long-post matrix,
short-loop contexts, feed persistence and reported interface regressions, with
stable IDs and links to the retained source records. They are a conservative
reconstruction of those records, not a new claim that historical runs passed.
The deleted/unavailable post remains visible. Its authorized NewsHour replacement
is recorded in `loop151/measurement-reuse-and-remaining-acceptance190.json`;
a reviewer must bind any substitution to its exact scenario and evidence.

Use `node scripts/validate-acceptance.mjs --scope` to export the definitions and
their digest. Keep that digest in each run record. Validate a run with
`node scripts/validate-acceptance.mjs run.json report.json`. Exit 1 means acceptance
is incomplete, including an authorized partial delivery. The generated report
always includes every original case and any proposed changes/removals. Use it as
the completion report; preserve any delivery receipts alongside it. Local checks,
builds and uploads describe delivery milestones and cannot close the issue.

A run records `revision`, `owner`, `scopeDigest`, `delivery`, and `caseResults`.
Each result names `caseId`, `evidence` and `review`; artifact references contain
`path` (relative to the repository) and `sha256`. The CLI reads the actual bytes
and verifies hashes, including reviewer and acoustic evidence. It does not trust
`passed`, `verified`, or `issueClosed` fields as proof. Keep raw observations
unaltered; generate summaries from them. Historical summaries and cached upload
receipts remain historical evidence with their original timestamps/revisions.

Raw evidence has `kind: live-observation`, recorder/timestamp, original measured
revision, platform/environment/navigation/presentation, exact source identity,
packaged resource hashes, distinct assets, requested rate, startup/transition
coverage, and the expected trusted input receipt bound to the source identity.
Rate cases carry the existing probe's `live-case` measurement. Subsequent-feed
cases carry a separate measurement per distinct asset and disclose intervening
speed input. Audio-enabled flags are configuration only. Audible cases require
a recording or a timestamped human-listening artifact attesting audible, smooth
output for that exact run, reviewed independently. Muted cases retain muted state.

The shared live probe is armed **before** the genuine input. Its full command-to-end
window includes preparation, handoff, startup, initial and trailing gaps. Long clips
need at least twenty seconds; short loops need five observed wraps and subsequent
advancement. Native prototype clocks, UI time, frame timestamps/counters, source/seek
epochs and handoff positions remain separate. Callback holes alone do not prove a
decoder stall, and near-requested endpoint averages do not establish smooth output.
Callback gaps of 150 ms or more remain incomplete unless sampled counters show
progress. Post-wrap frame advancement must belong to that wrap's source and epochs.
The six-second seven-rate fixture remains a structural regression only.
Cached-head exclusion is available only to a caller that independently verifies
the prior raw tail. The acceptance CLI currently supplies no such certificate;
it preserves those observations and conservatively leaves ambiguous cached-head
measurements incomplete rather than trusting an artifact name inside the report.
Finite native restarts also need independently verified complete input coverage
to distinguish a natural loop from manual Replay. The built-in collector's
document input log is best-effort because earlier page/extension handlers can
stop events; the CLI cannot certify that route. Continuous native timelines with
observed clip-relative seams retain their separate wrap accounting.

An independent review artifact has `kind: independent-review`, reviewer, case ID,
`evidenceDigest`, verdict and reason. The reviewer must differ from the recorder
and run owner. This identity check detects accidental self-review; it does not
authenticate a human or prove independence. The accountable reviewer must inspect
the raw artifact, rather than accept a self-authored summary. Review notes should
explain these judgment calls:

- Whether source replacement preserves the reported scenario, captions, lifecycle,
  presentation and affected media route. Record `sourceSubstitution` with original,
  observed and reason; authorization and equivalence are separate questions.
- Whether the picture was actually visible, the intended interaction occurred,
  and acoustic evidence establishes continuous output. Bind `audioEvidence` to
  the exact listening/recording artifact hash.
- Whether native/decoded progress, lag, resets and gaps support the claimed
  behavior throughout startup and transitions. Preserve unexplained failures.
- Whether prior measurements apply to a different revision. Require complete source
  **and** packaged-resource manifests bound to their actual revisions/builds. The
  current tooling cannot independently establish that historical equivalence, so
  it conservatively leaves cross-revision evidence incomplete, even when a summary
  or reviewer claims equivalence. Preserve the measured revision; use older runs
  as context until an authoritative equivalence verifier exists.

Direct-post navigation cannot meet a feed-scrolling requirement. Chromium,
simulators and controlled fixtures cannot meet physical live-Safari requirements.
A reviewer cannot silently waive those mechanical mismatches or duration/wrap
requirements. A changed product requirement needs an explicit scope decision;
retain the original and proposed criteria in the report. Report incomplete or
unavailable cases even when the authorized upload succeeds.

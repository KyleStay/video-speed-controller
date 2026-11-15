# Browser acceptance and evidence review

Keep acceptance cases separate from execution results. Each case needs a stable
ID, reported scenario, browser/version, exact source or item, expected behavior
and evidence requirements. Record changed or unavailable cases explicitly; a
successful build, package or upload does not close a playback or interface issue.
Use [the verification workflow](agent-workflow.md) for the owning local checks.

## Run records

Record the measured source revision, built-resource hashes, browser version,
platform, navigation/presentation context, settings, requested action and actual
result. Bind each artifact to its case and retain its path and checksum. Raw
observations remain unchanged; summaries link back to them. Historical evidence
keeps its original revision and observation timestamp.

Fixtures establish repeatable structural and behavior regressions. Live-site
checks establish only the observed site, item and navigation path. Direct-post
navigation does not establish feed-scrolling behavior; an injected page script
does not establish installed-extension worlds or permissions. Label fixtures,
actual built-extension runs and live checks separately. Report unavailable
browsers and skipped assertions as incomplete.

## Playback and input evidence

Arm measurement before genuine browser input. Record trusted click or keyboard
receipts and verify that they reached the intended media/control. Programmatic
`.click()` and dispatched events do not establish real browser interaction.
Capture startup, transitions and the final state rather than selecting only a
successful middle interval.

Requested-rate readback is insufficient. Require accepted playback plus media
time and decoded progress from an identified native metric. Keep frame callbacks,
frame counters, media clocks and UI time separate; never combine or reset them
to manufacture progress. Disclose callback gaps, seeks, source epochs, waits and
loop seams. An average close to the requested rate does not establish smooth
output throughout the run. Measure subsequent-feed items independently and
record any intervening speed commands.

Muted output remains a muted result. Audio-enabled configuration alone does not
establish audible continuity. Claims about continuous sound require a recording
or timestamped listening evidence for that exact run and output route, reviewed
independently. Preserve unexplained failures and incomplete observations.

## Reviewer responsibilities

A review identifies its reviewer, measured case, evidence artifacts and verdict.
The reviewer inspects raw observations and differs from the run recorder for an
independent review. An identity field alone does not prove independence.

Reviewers assess:

- Whether source substitutions preserve the reported item, captions, navigation,
  lifecycle and presentation. Record the original, observed source and reason;
  authorization and scenario equivalence are separate questions.
- Whether the picture was visible, the intended real input occurred and the
  evidence supports the claimed behavior throughout startup and transitions.
- Whether an earlier revision's evidence applies. Preserve the measured source
  and resource hashes; a newer summary or successful compilation does not prove
  cross-revision equivalence.
- Whether cleanup closed only the owned browser/session and removed its
  disposable profile, or retained an explicit cleanup blocker.

Keep delivery receipts separate from behavior acceptance. A changed requirement
needs an explicit scope decision with the original and proposed criteria retained.
An authorized partial delivery must still list unmet cases and required evidence.

# Local CI

Kyle requires all CI to run locally to conserve GitHub Actions credits. Keep
GitHub-hosted workflows disabled. Do not dispatch, rerun, re-enable or push a
change that would start hosted CI. Do not register a self-hosted runner or create
credentials as a substitute.

Run `python3 scripts/local-ci.py --plan` to inspect the offline checks, then
`python3 scripts/local-ci.py`. Existing installed Node/Python dependencies are
required; the runner does not download dependencies or browsers. Each run copies
the current tracked and nonignored untracked source into a unique directory
under `test-results/local-ci/`, verifies copied inputs, and keeps build output,
packages, caches and logs there. Registered `dist/`, existing `release/` artifacts
and the Git index are untouched. `--output-root /absolute/owned/path` changes the
parent of the unique run directory. Avoid editing source while the copy is made.

The runner checks lint, minified Chrome/Firefox and Safari resource builds, the
full unit/integration suite, Python process-ownership tests and Chrome/Firefox
packaging. Every result and command is recorded in `results.json`; failed checks
produce a nonzero exit. A report still marked `running` or lacking `finished_at`
is incomplete and must never be counted as passed. An interruption during
preflight copying can leave only console evidence. A missing dependency is a
blocker, not permission to install it automatically.

Browser fixtures, player controls, performance, basic/options UI and native
Safari/phone acceptance remain explicit unrun rows until separately executed
through an existing permitted local route. For exact commands, consult the
recoverable former workflow in `docs/ci-archive/ci.yml.disabled`; omit its hosted
setup/upload steps and browser-download step. Run browser commands only inside
an owned disposable working copy and retain the existing cleanup/permission
rules in AGENTS.md. Prior localhost/CDP or phone denials remain in force.
Resource compilation alone does not validate browser behavior or native UI.

`npm audit --audit-level=high` requires a fresh advisory service response and is
not an offline check. Run it locally only when network access is permitted;
otherwise report it unrun. Dependency updates are a local review task. The former
Dependabot schedule is retained as `docs/ci-archive/dependabot.yml.disabled`.

This migration removes active workflow and Dependabot version-update
configuration from the default branch. Keep archived YAML inactive. GitHub can
retain historical or generated workflow records after source removal; verify
source triggers and run state rather than inferring execution from the listing.
The generated Dependabot Updates workflow rejected API disablement with HTTP 422;
keep security settings unchanged rather than using them as a workaround. Preserve
existing GitHub logs and artifacts when disabling workflows or cancelling runs.

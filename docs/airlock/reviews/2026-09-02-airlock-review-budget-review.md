# Review: Airlock 4.0.1 advisory review budget spec

Date: 2026-09-02
Subject: `docs/airlock/specs/2026-09-02-airlock-review-budget.md` (initial draft)
Method: spec read against `scripts/airlock.mjs`, `scripts/airlock.test.mjs`, the host shims, version files, and the 4.0 spec; empirical checks of git numstat behaviour; `npm test` on the baseline (39 tests, 38 pass, 1 skip).

## Findings

**F1 (blocker) — version bump incomplete.** The draft moved only `package.json` and `plugin.json` to 4.0.1. `.claude-plugin/marketplace.json` also carries `4.0.0`, and the existing "prompt surface" test pins `"4.0.0"` for all three files plus `#v4\.0\.0` for the shim. Left as written, `npm test` fails, contradicting the spec's own requirement. The 4.0 spec explicitly requires all version-bearing surfaces to move together.

**F2 (blocker) — empty pathspec measures everything.** `git diff --cached --numstat --` with no paths after `--` means "no restriction" and reports every staged change in the repository. A task can reach the measurement step with an empty in-scope set (an evidence-only task whose owned path was not written). Under `--parallel`, or after a failed commit left product paths staged, another task's lines would be attributed to this task's `diffLines`.

**F3 (should-fix) — rename invariant overstated.** Numstat pairs a rename only when both endpoints are inside the pathspec. Under `--parallel` a rename can straddle two tasks' ownership (one side lands in `foreign`), so the stated invariant against `git show --numstat <sha>` does not hold unconditionally.

**F4 (should-fix) — bare flag parses as 1.** `parseCli` records a valueless `--review-lines` as boolean `true`; `Number(true) === 1` passes the positive-integer check, so `--review-lines` alone would silently set a budget of 1 instead of failing.

**F5 (nit) — redundant plan-file filtering.** The draft said to stage "`inScope` minus the plan file". `dirtyProductPaths` already excludes coordinator paths before ownership filtering, so `inScope` can never contain the plan; the wording invites dead code.

**F6 (should-fix) — `taskCommit` refactor unstated.** `taskCommit` re-runs `auditTask` and re-stages. The draft did not say whether it is refactored or called as-is after the new steps. It has no other callers, so either is safe, but the spec must choose.

**F7 (nit) — README style.** The README `Authoring tasks` section is one prose paragraph; appending the template's bullet block verbatim would break its style.

**F8 (nit) — Commands section shape.** The README `Commands` section documents no `init` flags today, so "list `--review-lines` under `init`" had no pattern to extend.

## Verdict

Structure, order-of-operations description, stderr contract, `render`/`statusText` reuse, and the 4.0.0 shim hash (independently recomputed, matches) were accurate. F1 and F2 must be fixed before implementation; the rest are real but lower stakes.

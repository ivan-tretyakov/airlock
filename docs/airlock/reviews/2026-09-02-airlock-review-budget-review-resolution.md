# Resolution: Airlock 4.0.1 advisory review budget spec review

Date: 2026-09-02
Review: `2026-09-02-airlock-review-budget-review.md`
Spec revised in place: `docs/airlock/specs/2026-09-02-airlock-review-budget.md`

| Finding | Resolution |
| --- | --- |
| F1 version bump incomplete | Decision table and "Host shims and version" now list `package.json`, `plugin.json`, `marketplace.json`, and the pinned test assertions together. The existing prompt-surface test moves to `4.0.1` / `#v4\.0\.1` and its not-matched regex grows to include `#v4\.0\.0`. |
| F2 empty pathspec | Measurement step 3 now requires `diffLines = 0` without invoking `git diff` when `inScope` is empty, with the reason stated. Test 3 gains a `--parallel` scenario where task A's change is staged and task B has an empty in-scope set; B must record 0, commit only the plan, and leave A's staged change alone. |
| F3 rename invariant | Invariant now holds "whenever the task owns both endpoints of any rename". Cross-task renames under `--parallel` are named as an accepted, untested edge case. |
| F4 bare flag | `init` section rejects a valueless `--review-lines` explicitly. Test 2 covers it. |
| F5 plan-file filtering | Step 1 states `inScope` never contains the plan and that no filtering is needed or wanted. |
| F6 `taskCommit` refactor | Measurement section states `taskCommit` is split so the audit runs exactly once; the new commit helper must not call `auditTask`; the "no changes to commit" guard is kept. Noted that `taskCommit` has no other callers. |
| F7 README style | Guidance section says the template gets bullets and the README gets the same content reworded as prose appended to the existing paragraph. |
| F8 Commands section | Spec now gives the exact sentence to add to the `Utilities` line. |

All eight findings are resolved in the spec. No finding was rejected.

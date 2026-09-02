# Airlock 4.0.1 — Advisory review budget and plan series

Status: proposed
Date: 2026-09-02
Target release: Airlock 4.0.1 (plugin, npm package, and `v4.0.1` tag)
Schema: `airlock.plan/v4` unchanged (one optional field added)

## Motivation

A plan that executes cleanly can still produce a pull request nobody can review. Per-task commits with `Airlock-Task` trailers make commit-by-commit review possible, but the whole-change coherence review breaks past a few hundred changed lines. Today Airlock offers no signal about how large the accumulated change has become, and no authoring guidance on when a piece of work should become several plans.

Two design constraints from the 4.0 slim-down carry over:

1. Airlock must not learn about pull requests, review state, or merges. The human merge is the boundary between plans and stays outside Airlock.
2. The dispatch loop must not gain a new blocking condition. `BUDGET REACHED` keeps its two existing causes (`maxTasks`, `maxExpensive`).

The answer is therefore split in two: a planning-time rule (one plan per pull request, a numbered plan series when the work is larger than one review), and a runtime advisory that measures the real diff and tells the operator when the budget the plan declared has been passed.

## Decision summary

| Topic | Decision |
| --- | --- |
| Where the budget lives | `budget.reviewLines`, optional, positive safe integer. Absent means the check is off. |
| How it is set | `airlock init … --review-lines <n>`. Omitted flag leaves the field absent. |
| What is measured | Added plus deleted lines of the product paths committed by each task commit. The plan file is excluded. Binary files count 0. |
| Where it is stored | `task.diffLines` (non-negative safe integer) written on `done`. |
| Cumulative usage | Sum of `diffLines` over tasks with `status: "done"`. Tasks without the field count 0. |
| When it is reported | `done` (stderr) and `status` (stdout line). Only when `budget.reviewLines` is set. |
| What it never does | Block `next`, `start`, or `done`. Never emits `BUDGET REACHED`. Never touches `budgetState` or `selectNext`. |
| Base commit tracking | None. Measurement is per task commit, so rebases and squashes do not invalidate it. |
| Version | 4.0.1 on every version-bearing surface (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the pinned test assertions), plus `v4.0.1` install references. The 4.0.0 packaged shim hash joins the legacy set so existing projects upgrade silently. |

## Plan schema

`budget` gains one optional field:

```json
"budget": { "maxTasks": 8, "maxExpensive": 2, "reviewLines": 600 }
```

Validation in `validatePlan`:

- If `budget.reviewLines` is present it must be a safe integer greater than 0. Any other value (0, negative, float, string, null) is rejected with `budget.reviewLines must be a positive integer`.
- Absent is valid and means the check is off.

Each task may carry `diffLines`:

- Written by `done`. If present it must be a non-negative safe integer; anything else is rejected with `task <id> diffLines must be a non-negative integer`.
- Authors never set it. A `todo` task carrying `diffLines` is not an error (the plan may have been hand-edited or rolled back), but `done` always overwrites it.

The schema identifier stays `airlock.plan/v4`. Existing v4 plans validate unchanged. `upgradePlan` (v3 to v4) is untouched and never adds `reviewLines`.

## `init`

New flag `--review-lines <n>`:

- Parsed as an integer. Present but unparseable, zero, or negative fails with the same `AirlockError` text as validation, before any file is written.
- A bare `--review-lines` with no value (which `parseCli` records as boolean `true`) is rejected explicitly with the same message. Do not let `Number(true) === 1` slip through.
- Present and valid writes `budget.reviewLines`.
- Absent leaves the field out entirely (not `null`, not `0`).

Defaults for `--max-tasks` (8) and `--max-expensive` (2) are unchanged.

## Measurement in `done`

Current order in `done`: audit, mutate task, `writePlan`, `taskCommit` (which runs a second `auditTask`, stages in-scope paths plus the plan, and commits), rollback on failure. `taskCommit` has no other callers.

New order, with `taskCommit` split so the audit runs exactly once:

1. Audit once in `done`, as today. Out-of-scope paths still fail before anything is written. The audit's `inScope` never contains the plan file (`dirtyProductPaths` excludes coordinator paths before ownership filtering), so no extra filtering is needed or wanted.
2. Stage the in-scope product paths with `git add -- <inScope>`.
3. Measure. If `inScope` is empty, set the sum to 0 and do not invoke `git diff` at all: an empty pathspec after `--` means "no restriction" and would report every staged change in the repository, including another parallel task's staged files or residue from an earlier failed commit. Otherwise run `git diff --cached --numstat -- <inScope>` and sum added plus deleted. Binary rows (`-\t-`) contribute 0. Deleted paths count their deleted lines.
4. Set `task.diffLines` to the sum, then mutate status, evidence, `finishedAt`, `note` as today.
5. `writePlan`, stage the plan, commit with the existing message and trailers, restricted to `inScope` plus the plan (`git commit … -- <paths>`). This replaces the old `taskCommit`; the new helper must not call `auditTask` again and must not re-add `inScope` (re-adding an already staged deletion fails). The "no changes to commit" guard stays: the committed set is `inScope` plus the plan, which is never empty. The path restriction is new: 4.0.0 committed the whole index, so under `--parallel` a second task's staged files could be swept into the wrong task commit. Restricting the commit to the audited paths closes that and is what test 3's parallel scenario asserts.
6. On commit failure: restore the plan file bytes and reset the plan path from the index, exactly as today. Product paths staged in step 2 stay staged, which is the current behaviour after a failed commit. `task.diffLines` is discarded with the restored plan bytes.

Invariant the tests pin: for a completed task with commit `<sha>`, `task.diffLines` equals the added-plus-deleted total of `git show --numstat --format= <sha>` with the plan file row removed. This holds whenever the task owns both endpoints of any rename it performs. A rename whose other endpoint belongs to a different concurrently running `--parallel` task is measured one-sided (numstat cannot pair the rename inside a restricted pathspec) and may over-count; this is an accepted edge case and is not tested.

The commit message and trailers are unchanged. No `Review-Lines` trailer.

## Output shapes

### `done`

stdout is unchanged. The first line stays `DONE <id> <sha>`, so the Claude Code command and the OpenCode shim keep parsing it.

When `budget.reviewLines` is set, `done` also writes to stderr, in every mode including `--json`:

```text
REVIEW 612/600 lines
REVIEW BUDGET EXCEEDED: open the pull request now and start the next plan.
```

The first line always appears when the budget is set. The second appears only when `used > budget`. `used == budget` is not exceeded. When the budget is absent, nothing is written to stderr.

`--json` output gains `diffLines` on the returned `task` (already present through the task object) and a top-level `review` object when the budget is set:

```json
"review": { "used": 612, "budget": 600, "exceeded": true }
```

When the budget is absent, `review` is omitted.

### `status`

When `budget.reviewLines` is set, `statusText` emits one line after the `GOAL` line and before `NEEDS YOU`:

```text
REVIEW  612/600 lines (exceeded)
```

The `(exceeded)` suffix appears only when `used > budget`. When the budget is absent, no `REVIEW` line is emitted. `--json` for `status` gains the same `review` object as `done`.

### `next`, `start`, `render`

Unchanged. The task brief does not mention the review budget. `render` may show the `REVIEW` line if it already reuses `statusText`; no separate work.

### `BUDGET REACHED`

Unchanged. Only `maxTasks` and `maxExpensive` produce it. The review budget never causes `NOTHING TO DO`.

## Authoring guidance (text)

Add the following content to `PROJECT-CONVENTIONS.template.md` as bullets in its `Authoring tasks` list, and to `README.md` reworded as prose appended to the existing `Authoring tasks` paragraph (the README paragraph has no bullets; keep its style). The two must say the same things:

- Decide the review budget per pull request before authoring tasks. One plan is one pull request. Pass the budget as `--review-lines` so `done` and `status` report against it.
- When the work is larger than one review, author a numbered plan series (`Export: 1 of 3`, `Export: 2 of 3`, …), each with its own testable `--done` criteria. Tasks that cannot be split safely, such as a migration and the code that depends on it, stay in the same plan.
- Every plan in a series must leave the base branch green on its own. Decide feature flags or backward-compatible schema steps during design, before the first plan is written.
- The review budget is advisory. When it is exceeded, stop adding tasks, open the pull request, and start the next plan. Airlock never tracks whether the pull request was reviewed or merged.

Add one worked example to the `Workflows` section of `README.md`, after `Ambiguous multi-week work`, titled `Work that is too large for one pull request`: a three-plan series, each plan one branch and one pull request, showing the `--review-lines` flag, the `REVIEW` status line, and the human merge as the boundary between plans. Keep it to one short paragraph and one plan-series listing. Do not add a full plan JSON.

The `Commands` section of `README.md` does not document `init` flags today. Extend its `Utilities: `init`, `render`.` line with one sentence: "`init` takes `--done "a|b"`, `--max-tasks`, `--max-expensive`, and the advisory `--review-lines`." Update the `Validation` paragraph to mention the review budget among the covered behaviours.

## Host shims and version

- `package.json`, `.claude-plugin/plugin.json`, and the plugin entry in `.claude-plugin/marketplace.json` move to `4.0.1`, together, as the 4.0 spec requires for every version bump.
- The existing "prompt surface contains only the slim roles and two shims" test pins `"4.0.0"` for all three files and `#v4\.0\.0` for the shim. Those assertions move to `4.0.1` / `#v4\.0\.1`, and the not-matched legacy-tag regex grows to `#v3\.0\.0|#v3\.1\.0|#v4\.0\.0`.
- `README.md` install line and `.opencode/command/airlock.md` install line move from `#v4.0.0` to `#v4.0.1`. Both `commands/airlock.md` and the OpenCode shim are otherwise unchanged.
- The packaged 4.0.0 OpenCode shim (content hash `4b4d5b3a87bca1afd8b8bdcd2c1acc35960d62ac0d200c0373e881782fc792ca` as computed by `contentHash`) is added to `LEGACY_OPENCODE_COMMAND_HASHES`, so a project that ran `init --host opencode` on 4.0.0 is refreshed silently on 4.0.1. A verbatim snapshot is committed as `scripts/fixtures/opencode-command-4.0.0-packaged.md` and a test pins its hash, following the 3.1.0 pattern.
- The existing shim-upgrade test asserts `airlock#v4\.0\.0` in the refreshed content; it moves to `v4\.0\.1` and gains the 4.0.0 packaged fixture in its legacy loop.
- The 5,000-byte prompt-surface ceiling test must still pass for both command files.

## Tests

Add to `scripts/airlock.test.mjs`:

1. Schema: `reviewLines` absent, positive integer accepted; 0, negative, float, string rejected with the stated message. `diffLines` non-negative integer accepted; negative and non-integer rejected.
2. `init --review-lines 600` writes the field; `init` without the flag omits it; `--review-lines 0`, `--review-lines abc`, and a bare `--review-lines` with no value all fail before writing.
3. `done` records `diffLines` equal to the numstat of the task commit excluding the plan file, across a task that adds a file, edits a file, and deletes a file. Include a binary file in one task and assert it counts 0. Include a `--parallel` scenario: tasks A and B are both `doing`, A's owned file is modified and staged, B's owned path is untouched (empty `inScope`); `done B` must record `diffLines` 0, commit only the plan, and leave A's staged change in the index. (Unowned dirty paths cannot be used for this test because the audit rejects them as out of scope.)
4. `done` stderr: with a budget, the `REVIEW used/budget lines` line appears; over budget, the `REVIEW BUDGET EXCEEDED` line appears; without a budget, stderr is empty. stdout first line is `DONE <id> <sha>` in all three cases. `--json` carries `review` only when the budget is set.
5. After the budget is exceeded, `next` still returns the next runnable task and `status` never shows `BUDGET`. `status` shows `REVIEW  used/budget lines (exceeded)`.
6. Legacy plan without `reviewLines` and with done tasks lacking `diffLines`: `status` has no `REVIEW` line; `done` on a new task works and records `diffLines`.
7. Shim upgrade: the 4.0.0 packaged fixture hash matches the constant, and `init --host opencode` refreshes it to content containing `airlock#v4.0.1`.

`npm test` must pass. `claude plugin validate .claude-plugin/plugin.json --strict` must pass.

## Versioning and migration

- 4.0.1 is a patch release: one optional plan field, one optional task field, one `init` flag, stderr advisories, one `status` line. No schema bump.
- No migration for existing plans. Plans without `reviewLines` behave exactly as on 4.0.0.
- Existing OpenCode projects: `airlock init --host opencode` refreshes the shim through the legacy hash. Projects with a customised shim are untouched as long as it still contains `AGENT airlock-`.
- The release tags `v4.0.1` on the merged commit. The install references in the README and shim point at that tag.

## Out of scope

- Blocking dispatch on review size.
- Tracking pull request, review, or merge state.
- Recording a base commit or measuring against the branch base.
- Estimating diff size at planning time. Estimates are unreliable before code exists; the advisory measures reality.
- Per-task line caps or per-task warnings.
- Changes to `extensions/herdr`.

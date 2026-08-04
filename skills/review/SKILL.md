---
name: review
description: Turns feedback on shipped work into triaged, evidenced changes and resumes prior work from its ledger. Use for user, PR, CI, or reviewer feedback after a commit; when asked where work landed or what remains; or when returning to work after time away. Requires a ledger, reconstructing unknown fields explicitly when necessary.
---

# Review — the far door

Make feedback an artifact, not a conversation. Triage every item, get the user's decision, and resolve accepted work against checkable evidence.

## 1. Load state from disk

Identify the ledger from the requested topic, plan, work ID, or PR. If more than one ledger could apply, ask instead of guessing. Read its plan and design, then reconcile it with:

- `git log --oneline <base-sha>..HEAD`
- `git status --short`
- the review surface configured in the project's instructions
- for a PR, `gh pr view`, `gh pr diff`, and `gh pr checks`; use `gh api graphql` when addressable review threads are needed

If GitHub CLI access is unavailable, report that source as uncollected rather than implying the review is complete.

If the ledger is missing or stale, reconstruct only what git and the plan prove. Mark historical evidence, approval, or deviation details as `unknown`, include the reconstruction date, and never present reconstructed entries as contemporaneous records.

The user's current prompt is a valid feedback source. Persist it during triage; do not rely on unrecorded context from an earlier session.

## 2. Triage before repair

Collect all available feedback and classify each item:

- **MUST_FIX** — wrong, broken, or violates a project invariant.
- **SHOULD_FIX** — a real, in-scope improvement worth doing now.
- **PARK** — legitimate but deferred; requires a reason and backlog home.
- **OUT_OF_SCOPE** — outside this work's approved contract.

Present a numbered draft triage and stop for approval before editing the ledger or implementation. After approval, write the rows to the ledger, preserving stable source URLs or IDs so later sessions can deduplicate them.

## 3. Establish the baseline

Run the project's test command and record the result. If it is red, determine whether the failure is the reviewed defect:

- An attributable failure becomes evidence for its MUST_FIX item and may be repaired.
- An unrelated or unexplained failure is a blocker; stop and report it rather than layering review changes on top.

Before committing approved triage, set the ledger to `resolving` if any rows remain open or `cleared` if every row is already parked or rejected. When the baseline is green, commit that triage as a ledger-only crossing through `ship` before repairs begin. When an attributable failure makes the baseline red, include the triage in the first fixing crossing instead; do not ask `ship` to commit a red baseline.

## 4. Resolve in order

Resolve MUST_FIX items before SHOULD_FIX items. For each item, make the smallest change, show evidence, and update its state and resolution in the same commit as the fix.

The scope contract still binds. For a necessary path outside it, propose a scope amendment with the path and reason, get approval, and update the plan and ledger before proceeding. Invoke `brainstorm` when the feedback changes the design, not merely because one path was omitted.

Pushback is a valid resolution when feedback conflicts with an invariant. Record the reason. A `done` item requires a checkable commit reference; use `this commit` when the ledger row and fix are committed together, then locate it with `git blame` on that row.

## 5. Close the loop

- Before each resolution commit, set the ledger to `resolving` if open items remain or `cleared` if every row is terminal.
- Invoke `ship` for every resolution commit so it receives evidence and a crossing; `ship` preserves review lifecycle states.
- Reply to and resolve PR threads with `gh api graphql` when authenticated tooling supports it; otherwise report the unresolved remote action.
- Report resolved, rejected, parked, and uncollected items separately.

## Stop conditions

- A fix is about to start before complete triage approval.
- The relevant ledger or scope is ambiguous.
- An unrelated baseline failure exists.
- A change exceeds the contract without an approved amendment.
- A row is about to be marked done without evidence and a checkable commit reference.

Next skill: **`ship`**.

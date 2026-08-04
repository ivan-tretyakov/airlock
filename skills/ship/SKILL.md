---
name: ship
description: Completion gate — verify with evidence, then commit safely. Use when an implementation task is finished and about to be committed, or when the user asks to wrap up / commit work. Enforces a green suite, evidence over assertion, protection of irreplaceable local state, and the project's commit discipline.
---

# Ship — evidence, then commit

Nothing is "done" on assertion. Show the evidence, then commit the way this project requires.

## 1. Verify with evidence

- **Suite is green.** Run the test command from the project's instructions and paste the pass/fail summary. Red = not done.
- **The feature actually works.** Show the concrete artifact: test output, a bounded-foreground validation run, or a screenshot — not a claim. If a step was skipped or something failed, say so plainly.
- **For stochastic or tuning-sensitive behavior, never conclude from one run.** Use an N-run distribution (fixed seeds) so the signal is real and regressions are detectable.
- If anything is still failing or unverified, stop here and fix it. Do not commit red.

## 2. Protect irreplaceable local state

If the work touched local state that cannot be regenerated — save files, local databases, user profiles, credentials, generated caches the user depends on — back it up **before** the run and restore it after. Confirm it's restored before committing. Check the project's instructions for protected paths.

## 3. Audit the candidate commit

- `git pull --rebase --autostash` before committing when sessions may share the working tree.
- **Scoped `git add` only** — stage exactly the files for this crossing, including the plan and ledger process artifacts. Never `git add -A` / `git add .`.
- Use `git diff --cached --name-status` for **Touched**. Do not use `git status` as the crossing's path list: a shared worktree may contain another lane's unstaged changes.
- Compare every staged path against the plan's owned paths and process artifacts. If anything is outside them, unstage it and surface it rather than silently committing or reverting it.
- If the project has provenance or disclosure requirements for generated assets, confirm their rows or sidecars are staged with the artifacts.

## 4. Record the crossing

Append one entry to the work's ledger, whose exact path must be named in the plan. For the first crossing, use `LEDGER.template.md` beside this skill file.

```markdown
### Crossing `<work-id>-<sequence>` — Phase <n>: <name> — <YYYY-MM-DD>

- **Commit:** this commit (locate with `git log -S '<work-id>-<sequence>' --oneline -- <ledger-path>`)
- **Owned:** `<paths from the plan's file contract>`
- **Touched:** `<paths from git diff --cached --name-status, including process artifacts>`
- **Evidence:** `<test command>` → `<pass/fail summary>`
- **Deviations:** none
```

The entry cannot contain its own SHA: changing the entry would change that SHA. Give every crossing a unique ID so `git log -S` identifies the containing commit exactly. Record approved deviations explicitly; only write `none` after the staged-diff audit is clean.

Stage the updated ledger explicitly and rerun `git diff --cached --name-status`. The final staged paths must match the crossing.

For implementation crossings, set the ledger status to `awaiting-review` on the final planned crossing and `in-progress` otherwise. For commits made by `review`, preserve the review workflow's `resolving` or `cleared` status.

## 5. Commit and report

- Follow the project's commit-message convention, including any required `Co-Authored-By` trailer.
- Commit the ledger entry with the work, not separately. Verify the result with `git show --stat --oneline HEAD`.
- Respect the project's branch and push policy. Push only when it allows or the user asks.
- State what shipped, the commit SHA, the evidence, and anything deferred or skipped. Point at the ledger entry rather than restating it.

Feedback on the committed work goes through **`review`**.

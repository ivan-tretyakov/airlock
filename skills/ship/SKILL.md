---
name: ship
description: Completion gate — verify with evidence, then commit safely. Use when an implementation task is finished and about to be committed, or when the user asks to wrap up / commit work. Enforces a green suite, evidence over assertion, protection of irreplaceable local state, and the project's commit discipline.
allowed-tools: Bash(git status:*) Bash(git add:*) Bash(git commit:*) Bash(git pull:*) Bash(git log:*) Bash(git diff:*) Bash(git rebase:*)
---

# Ship — evidence, then commit

Nothing is "done" on assertion. Show the evidence, then commit the way this project requires.

## 1. Verify with evidence

- **Suite is green.** Run the project's test command (see `CLAUDE.md`) and paste the pass/fail summary. Red = not done.
- **The feature actually works.** Show the concrete artifact: test output, a bounded-foreground validation run, or a screenshot — not a claim. If a step was skipped or something failed, say so plainly.
- **For stochastic or tuning-sensitive behavior, never conclude from one run.** Use an N-run distribution (fixed seeds) so the signal is real and regressions are detectable.
- If anything is still failing or unverified, stop here and fix it. Do not commit red.

## 2. Protect irreplaceable local state

If the work touched local state that cannot be regenerated — save files, local databases, user profiles, credentials, generated caches the user depends on — back it up **before** the run and restore it after. Confirm it's restored before committing. Check `CLAUDE.md` for the project's list of protected paths.

## 3. Commit discipline

- `git pull --rebase --autostash` before committing when sessions may share the working tree.
- **Scoped `git add` only** — add exactly the files this session owns per its plan's file contract. Never `git add -A` / `git add .`.
- **Audit the diff against the contract** before staging: if anything changed outside the declared paths, surface it to the user rather than silently committing it or silently leaving it behind.
- Follow the project's commit-message convention, including any `Co-Authored-By` trailer it requires.
- Respect the project's branch and push policy (see `CLAUDE.md`). A common one: commit as part of the task, **push only when the user asks.**
- If the project has provenance or disclosure requirements for generated assets (e.g. an AI-generation log), confirm those rows/sidecar files are committed alongside the artifacts.

## 4. Report

State what shipped, the evidence, and anything deferred or skipped — honestly.

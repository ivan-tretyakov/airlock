---
name: debug
description: Systematic debugging for non-trivial bugs — reproduce, isolate, hypothesize, fix, and lock in with a regression test, instead of guessing. Use when a test fails for an unclear reason, behavior is wrong, something regressed, or a fix didn't hold. Skip for obvious one-line typos.
---

# Debug — reproduce before you fix

Guessing at fixes wastes runs and hides the real cause. Move by evidence.

## Loop

1. **Reproduce deterministically.** Write a failing test (or a fixed-seed run) that shows the bug. If you can't reproduce it, you can't confirm a fix — get reproduction first. Same inputs + same seed = identical results; rely on that.
2. **Isolate.** Narrow to the smallest input/state that triggers it. **Read the actual runtime output** — run the thing and look at the real error rather than reasoning about the source as text.
3. **Hypothesize, one at a time.** State the suspected cause and the single change that should fix it, and *why*. Change one thing.
4. **Verify.** Rerun the failing case → it passes; rerun the full suite → still green. If it didn't fix it, revert and form a new hypothesis — don't stack speculative changes.
5. **Lock it in.** Keep the reproduction as a regression test so the same failure can't return after a refactor, dependency bump, or model change.

## Watch for

- **Confounds** before concluding — leftover local state, caches, a stale build, an unrelated config flag. An apparent logic bug is often a measurement artifact. Check the project's known confounds in `CLAUDE.md`.
- **Never conclude from one run** for anything stochastic, timing-dependent, or tuning-related. Use an N-run distribution.
- **Don't widen scope while debugging.** If the fix needs files outside the current work's contract, stop and surface it.

If the root cause reveals a design problem rather than a code bug, stop and invoke **`brainstorm`**.

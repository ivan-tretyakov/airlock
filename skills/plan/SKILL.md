---
name: plan
description: Turns an approved design into a phased, test-first implementation plan with a disjoint file contract and a per-task subagent/model execution table, then asks whether to run it inline or via subagents and drives the implementation under TDD. Use after design/scope approval and before writing production code, or when starting an implementation session for an approved piece of work. Requires an approved scope — if there isn't one, invoke brainstorm first.
---

# Plan — approved design → verifiable implementation

Precondition: an approved design or scope contract exists (usually in the project's specs directory). If not, stop and invoke **`brainstorm`**.

## Write the plan file

Write the plan to the project's plans directory (default `docs/plans/YYYY-MM-DD-<topic>.md`). It must be self-contained — a fresh session with no prior context implements from it alone. Include:

- **Goal** — one paragraph. What "done" looks like.
- **Architecture** — how it fits the project's architecture invariants (see `CLAUDE.md`). Name the ones this work touches.
- **File contract (required — this is what makes parallel sessions on one checkout safe):**
  - **Owns** — the exact files/globs this session may create or modify.
  - **Must NOT touch** — load-bearing files and files owned by other lanes.
  - **STOP-and-handoff** — if the work needs a must-not-touch file, stop and surface it rather than edit it.
- **Phased tasks**, each 2–15 min, in checkbox (`- [ ]`) form, each with:
  1. Write the failing test first. Run it, **see it fail (RED)** — state the expected failure.
  2. Implement the minimum to pass. Run it, **see it pass (GREEN)**.
  3. Refactor if needed; suite stays green.
- **Bounded-foreground validation** — any long-running validation (integration runs, harnesses, screenshots) is a bounded foreground run inside the turn. Subagent-launched background processes die when the agent's turn ends.
- **End-to-end verification step** — the concrete check that proves the whole thing works, not just the units.
- **Execution table (required — always plan for subagents, even if the user later picks inline).**

## Always plan for subagents

Every plan is written so it *could* be handed to subagents. For each task, decide and record: who runs it, on which model, and what can run at the same time.

| Task | Model | Parallel group | Owns (files) |
|---|---|---|---|
| 1. … | Haiku | A | `tests/test_x` |
| 2. … | Sonnet | A | `src/x` |
| 3. … | Opus | B (after A) | `src/main` |

**Model tiering** — pick per task, and say *why* in one clause:
- **Haiku** — mechanical, fully specified, low judgment: boilerplate, data/content authoring, renames, repetitive scaffolding.
- **Sonnet** — the default for standard implementation: a clear test, a clear contract, contained blast radius. Most TDD tasks.
- **Opus** — architecture and interface design, cross-cutting changes, tuning/judgment calls, gnarly debugging, anything where a wrong call is expensive to unwind.

**Rules that make subagent execution safe:**
- Tasks in the same parallel group **must have disjoint `Owns` sets** — parallel sessions share one working tree. If two tasks want the same file, they are not the same group.
- Each subagent task must be **self-contained**: it gets a fresh context and cannot see this conversation. Restate the goal, its slice of the file contract, the RED→GREEN steps, and the STOP-and-handoff rule in the task prompt.
- Subagents run **bounded foreground** validation only, and report **evidence** (test output), never just a claim.
- Serialize anything touching a shared file, an entry point / composition root, or project-wide config.

## Dispatch protocol — before, during, after

**Before dispatching any file-writing subagent**, there must be an approved scope contract (from `brainstorm`, full or lite lane). No signed-off scope → no coding subagent. If one doesn't exist, stop and get one.

**In every subagent prompt, restate the contract verbatim** — a contract that lives only in a plan doc does not bind a fresh context. Include:

> **You may create or modify ONLY:** `<exact paths>`
> **You must NOT touch:** `<exclusions — runtime code, entry points, other lanes>`
> **Integration stance:** `<standalone — do not wire into the application or modify existing generators / integrated with X>`
> **STOP rule:** if this task appears to require any file outside the list above — including existing runtime code, or extending an existing generator — **STOP and report back. Do not edit it.** A blocked task reported honestly is a success; a widened one is not.

**After the subagents return, audit the diff before accepting the work.** Run `git status --short` and compare every changed path against the contract. Anything outside it: surface it to the user (and revert it unless they want it). Do this even when the subagent reports success — the audit is what catches an ignored instruction.

## Ask before executing

When the plan file is written, **stop and ask the user how to run it** — always, every time. Use `AskUserQuestion`: **inline in this session** vs **dispatch to subagents**, with your own recommendation and the reason (typically: subagents when there are disjoint parallel groups or cheap mechanical tasks to farm out; inline when the work is one tight serial thread or needs continuous judgment). Include the proposed model mix in the option description. Do not start implementing until they answer.

## Then implement

Work the tasks top to bottom under TDD, inline or via subagents per the user's answer. Keep the test suite green at every commit (use the project's test command from `CLAUDE.md`). Write the test and see it fail before writing the code it tests — do not design tests around code you're about to write. Turn every diagnosed bug into a regression test.

When the work is complete and verified, invoke **`ship`**.

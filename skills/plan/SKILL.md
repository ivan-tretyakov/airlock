---
name: plan
description: Turns an approved design into a phased, test-first implementation plan with a disjoint file contract and a per-task subagent/model execution table, then asks whether to run it inline or via subagents and drives the implementation under TDD. Use after design/scope approval and before writing production code, or when starting an implementation session for an approved piece of work. Requires an approved scope — if there isn't one, invoke brainstorm first.
---

# Plan — approved design → verifiable implementation

Precondition: an approved design or scope contract exists (usually in the project's specs directory). If not, stop and invoke **`brainstorm`**.

## Write the plan file

Write the plan to the project's plans directory (default `docs/plans/YYYY-MM-DD-<topic>.md`). It must be self-contained — a fresh session with no prior context implements from it alone. Include:

- **Goal** — one paragraph. What "done" looks like.
- **Architecture** — how it fits the architecture invariants in the project's instructions. Name the ones this work touches.
- **File contract (required — this is what makes parallel sessions on one checkout safe):**
  - **Owns** — the exact files/globs this session may create or modify.
  - **Process artifacts** — the exact plan and ledger paths. These are owned by the orchestrator at every phase and must not be assigned to parallel subagents.
  - **Must NOT touch** — load-bearing files and files owned by other lanes.
  - **STOP-and-handoff** — if the work needs a must-not-touch file, stop and surface it rather than edit it.
- **Phased tasks**, each 2–15 min, in checkbox (`- [ ]`) form, each with:
  1. Write the failing test first. Run it, **see it fail (RED)** — state the expected failure.
  2. Implement the minimum to pass. Run it, **see it pass (GREEN)**.
  3. Refactor if needed; suite stays green.
  4. Before its planned commit, tick the checkbox in this file. Progress must live on disk, not only in the conversation.
- **Commit boundaries** — group related tasks into named commits. Invoke `ship` at every commit boundary so every commit gets the same evidence gate and one ledger crossing.
- **Review checkpoints** — mark phase boundaries where the user should inspect the diff before it is committed. Checkpoint feedback is part of execution; feedback on an already shipped commit goes through `review`.
- **Bounded-foreground validation** — any long-running validation (integration runs, harnesses, screenshots) is a bounded foreground run inside the turn. Subagent-launched background processes die when the agent's turn ends.
- **End-to-end verification step** — the concrete check that proves the whole thing works, not just the units.
- **Execution table (required — always plan for subagents, even if the user later picks inline).**

## Always plan for subagents

Every plan is written so it *could* be handed to subagents. For each task, decide and record: who runs it, on which model, and what can run at the same time.

| Task | Runner | Tier | Selected model | Why | Parallel group | Checkpoint | Owns (files) |
|---|---|---|---|---|---|---|---|
| 1. … | subagent | Fast | `<host/model>` | mechanical | A | no | `tests/test_x` |
| 2. … | subagent | Balanced | `<host/model>` | contained TDD | A | yes | `src/x` |
| 3. … | inline | Deep | `<host/model>` | architecture | B (after A) | yes | `src/main` |

**Model tiering** — pick a capability tier per task, map it to an available host model, and say *why* in one clause:
- **Fast** — mechanical, fully specified, low judgment: boilerplate, data/content authoring, renames, repetitive scaffolding.
- **Balanced** — the default for standard implementation: a clear test, a clear contract, contained blast radius. Most TDD tasks.
- **Deep** — architecture and interface design, cross-cutting changes, tuning/judgment calls, gnarly debugging, anything where a wrong call is expensive to unwind.

**Rules that make subagent execution safe:**
- Tasks in the same parallel group **must have disjoint `Owns` sets** — parallel sessions share one working tree. If two tasks want the same file, they are not the same group.
- Each subagent task must be **self-contained**: it gets a fresh context and cannot see this conversation. Restate the goal, its slice of the file contract, the RED→GREEN steps, and the STOP-and-handoff rule in the task prompt.
- Subagents run **bounded foreground** validation only, and report **evidence** (test output), never just a claim.
- Serialize anything touching a shared file, an entry point / composition root, or project-wide config.

## Decide where the user sees the work

A plan that presents everything only after the last phase is expensive to correct. Mark checkpoints in the execution table with a `Checkpoint` column. Stop, show the diff and evidence since the previous checkpoint, and wait before committing or continuing.

Default to a checkpoint when a parallel group closes, an architecture invariant is touched, or a later phase depends on an earlier judgment call. Cheap mechanical phases do not need one.

## Dispatch protocol — before, during, after

**Before dispatching any file-writing subagent**, there must be an approved scope contract (from `brainstorm`, full or lite lane). No signed-off scope → no coding subagent. If one doesn't exist, stop and get one.

**In every subagent prompt, restate the contract verbatim** — a contract that lives only in a plan doc does not bind a fresh context. Include:

> **You may create or modify ONLY:** `<exact paths>`
> **You must NOT touch:** `<exclusions — runtime code, entry points, other lanes>`
> **Integration stance:** `<standalone — do not wire into the application or modify existing generators / integrated with X>`
> **STOP rule:** if this task appears to require any file outside the list above — including existing runtime code, or extending an existing generator — **STOP and report back. Do not edit it.** A blocked task reported honestly is a success; a widened one is not.

**After the subagents return, audit the diff before accepting the work.** Run `git status --short` and compare every changed path against the contract. Anything outside it: surface it to the user (and revert it unless they want it). Do this even when the subagent reports success — the audit is what catches an ignored instruction.

## Ask before executing

When the plan file is written, **stop and ask the user how to run it** — always, every time. Use the host's structured question tool (`AskUserQuestion` in Claude Code, `question` in OpenCode): **inline in this session** vs **dispatch to subagents**, with your own recommendation and the reason (typically: subagents when there are disjoint parallel groups or cheap mechanical tasks to farm out; inline when the work is one tight serial thread or needs continuous judgment). Include the proposed capability tiers and selected models in the option description. Do not start implementing until they answer.

## Then implement

Work the tasks top to bottom under TDD, inline or via subagents per the user's answer. Keep the test suite green at every commit using the test command from the project's instructions. Write the test and see it fail before writing the code it tests — do not design tests around code you're about to write. Turn every diagnosed bug into a regression test.

Invoke **`ship`** at each planned commit boundary. When all crossings are recorded and the work is complete, feedback on shipped commits goes through **`review`**.

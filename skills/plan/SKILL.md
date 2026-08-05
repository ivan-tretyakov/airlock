---
name: plan
description: Turns an approved design into a test-first Delivery Pack plan with contiguous scope-audited Crossings, disjoint file contracts, portable work classes and host roles, host-routing mappings, and planner-selected gates. Gets per-pack routing and gate approval before implementation. Requires approved scope; otherwise invoke brainstorm.
---

# Plan — approved design → verifiable Delivery Packs

Precondition: an approved design or scope contract exists. If not, stop and invoke **`brainstorm`**.

## Core units and lifecycle

- A **Crossing** is one scope-audited, buildable commit with focused evidence.
- A **Delivery Pack** is one coherent outcome delivered by one or more contiguous Crossings. Finish its Crossing sequence before committing a Crossing from another pack.
- A multi-Crossing Delivery Pack records why one Crossing is insufficient, dependencies, and a pack-level rollback strategy. Dependent Crossings are not promised to remain independently revertible.
- Pack lifecycle is `planned → active → candidate → accepted`. `blocked`, `abandoned`, and `reverted` are exceptional terminal outcomes. Post-ship review lifecycle is orthogonal and never substitutes for pack lifecycle.

## Write the self-contained plan

Write to the project’s plans directory (default `docs/plans/YYYY-MM-DD-<topic>.md`). A fresh session must be able to execute it alone. Include:

1. **Goal and architecture** — what done means and which project invariants are involved.
2. **File contract:**
   - **Owns** — exact files/globs this work may create or modify.
   - **Process artifacts** — exact design, plan, and ledger paths, owned only by the orchestrator.
   - **Candidate-bearing paths** — substantive code, tests, configuration, generated artifacts, and cited specs whose changes stale affected final evidence. Exclude only ledger bookkeeping and purely administrative plan progress.
   - **Must NOT touch** — load-bearing paths and other lanes’ files.
   - **STOP-and-handoff** — surface a needed unowned path; never edit it without approval.
3. **Delivery Pack table:**

| Pack ID | Outcome / acceptance | Crossing range | Lifecycle | Dependencies | Multi-Crossing reason | Rollback strategy | Pack/routing/gates approval |
|---|---|---|---|---|---|---|---|
| `<pack-id>` | `<coherent result>` | `<first>…<last>, contiguous` | planned | `<packs/external>` | `<required if >1; otherwise “single Crossing”>` | `<pack-level>` | proposed |

4. **Crossing/task mapping.** Give every task a checkbox and every Crossing a buildable result:

| Crossing ID | Pack ID | Tasks | Buildable result | Depends on | Owns |
|---|---|---|---|---|---|
| `<crossing-id>` | `<pack-id>` | `1–3` | `<working state at this commit>` | `<crossing IDs>` | `<exact paths>` |

Keep checkbox tasks small (typically 2–15 minutes). For behavior changes, follow RED → GREEN → refactor: write the failing test, run it and state the expected failure, implement the minimum, then rerun it. Tick tasks before their Crossing ships; progress lives on disk. A Crossing must not intentionally leave the build broken.

5. **Checkpoints and end-to-end proof.** Mark user diff checkpoints when a parallel group closes, an architecture invariant is touched, or later work depends on a judgment call. Keep long-running validation bounded and foreground. State the final proof of the outcome, not only unit checks.

## Portable execution and host routing

Record the route per pack/task; do not make one global “all inline” or “all subagents” choice.

| Pack / Crossing / task | Work class | Host role | Mode | Why | Parallel group | Checkpoint | Owns |
|---|---|---|---|---|---|---|---|
| `<IDs>` | Standard | implementer | inline/subagent | `<one clause>` | A | yes/no | `<exact paths>` |

Portable work classes describe risk and judgment, not a vendor model:

- **Light** — mechanical or tightly contained, low-risk work with an obvious check.
- **Standard** — normal contained implementation with clear contracts and tests.
- **Complex** — cross-cutting behavior, architecture, or difficult diagnosis.
- **Critical** — safety-sensitive, irreversible, public-contract, or expensive-to-unwind work.

Use portable host roles such as `orchestrator`, `implementer`, `investigator`, `verifier`, `independent-reviewer`, `browser-verifier`, and `visual-verifier`. Then map the roles to what the active host actually offers:

| Host role / work class | Selected host agent or runtime | Selected available model | Independence / rationale |
|---|---|---|---|
| `<role> / <class>` | `<configured agent, subagent, or inline>` | `<host-selected model>` | `<why; note any independence limitation>` |

Do not bake host-specific model IDs into the canonical workflow. The plan records the selected mapping; gate evidence records the effective agent and model that actually ran.

Parallel tasks must have disjoint `Owns` sets. Serialize shared files, entry points, and project-wide configuration.

## Select gates with discretion

The planner chooses gates from the outcome’s risks; Airlock does not demand every gate. Explicitly decide pre-ship independent code review, browser-functional, visual-fidelity, live-integration, and external-state cleanup whenever each is plausibly relevant. Do not add a row for every imaginable `not-required` gate.

Give detailed rows only to required gates:

| Gate ID | Pack ID | Gate | Applicability | Initial gate state | Executor host role | Command / MCP tool | Environment / target | Pass condition / artifact |
|---|---|---|---|---|---|---|---|---|
| `<gate-id>` | `<pack-id>` | `<technical/review/browser/...>` | required | pending | verifier | `<exact invocation>` | `<where/what>` | `<observable result>` |

For a plausibly relevant gate that is omitted, record one compact decision:

| Pack ID | Considered gate | Applicability | Reason |
|---|---|---|---|
| `<pack-id>` | `<gate>` | not-required | `<risk-based reason>` |

Applicability (`required` or `not-required`), runtime gate state (`pending`, `running`, `passed`, `failed`, `blocked`, `stale`), and an approved waiver are separate facts. A waiver needs approver, reason, and date; it never changes applicability or fabricates a `passed` state.

Implementers run focused RED/GREEN and Crossing checks. After code freeze, an independent verifier context or specialized gate role runs the required final pack gates against one exact candidate without editing source during gate execution. A pre-ship independent-review gate is part of acceptance; post-ship feedback belongs to Airlock **`review`**.

Each final gate will record either a full commit/tree or `base SHA + staged product-diff hash`, plus timestamp, effective agent/model, command or MCP tool, environment, result, and artifact. Substantive changes to candidate-bearing paths make affected evidence `stale`.

## Per-pack approval before execution

When the plan is written, stop and ask the user to approve or amend **each Delivery Pack’s** outcome, Crossing split, route, and gates. Use the host’s structured question tool when available and give a recommendation. One pack may mix inline and subagent tasks. Do not ask for a global inline/subagent choice, and do not execute a pack until its row, routing, and gates are approved.

A Light, single-Crossing pack may use one compact route row and only its genuinely required gates. Explicit risk decisions still apply, but ceremony should not outweigh the work.

## Dispatch protocol

Before any file-writing subagent, confirm the approved scope. Restate this contract **verbatim** in every fresh-context prompt:

> **You may create or modify ONLY:** `<exact paths>`
>
> **You must NOT touch:** `<load-bearing exclusions and other lanes>`
>
> **Integration stance:** `<standalone or integrated with named seam>`
>
> **STOP rule:** if the task appears to require any path outside the allowlist, **STOP and report back. Do not edit it.** A blocked task reported honestly is a success; widened scope is not.

Also include the task’s Pack/Crossing IDs, host role, RED/GREEN steps, bounded validation, and evidence expected. After return, audit `git status --short` against the contract before accepting the work; surface out-of-contract paths instead of silently keeping or reverting them.

## Implement

Activate one approved Delivery Pack and work its contiguous Crossings in order. Tasks may run in parallel only under disjoint ownership. Keep required per-Crossing checks green, turn diagnosed bugs into regression tests, and stop at planned checkpoints.

Invoke **`ship`** at every Crossing. The final Crossing can accept the Delivery Pack only when all unwaived required gates have fresh evidence for its exact candidate. Feedback after a shipped commit goes through **`review`**.

If the input is a legacy 1.1 ledger, view its historical Crossings as one implicit `legacy:<work-id>` Delivery Pack and leave historical gates unknown. Plan new work as a 1.2 pack; do not retrofit gate evidence.

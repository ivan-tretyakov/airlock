---
description: Plan an approved Full Airlock delivery
---

# Plan — approved design → verifiable Delivery Packs

Precondition: an approved design or scope contract exists. If not, stop and invoke **`brainstorm`**. The Airlock base rules (Output, Delegation, Artifacts and cleanup) from `/airlock:start` or the orchestrator agent apply throughout.

## Right-size the plan: Full-lite first

Most Full work is one coherent outcome. Start every plan at the **Full-lite** shape and escalate only when the work actually demands more:

- **Full-lite** (default): goal and architecture, the file contract, **one** compact Delivery Pack row, the task checklist with Crossing mapping, one compact route row, and only genuinely required gates. Prefer one `worker` per Crossing and keep the guideline at no more than three dispatches per Crossing, including required independent gates. Initialize the ledger at the first `ship` rather than up front; a single-Crossing pack may open and close its Resume checkpoint in one session.
- **Escalate to the full schema** only when the plan has multiple Delivery Packs, parallel lanes with disjoint ownership, an external-runtime route, or work that must span sessions. Add only the sections the escalation actually needs.

Explicit risk decisions still apply at every size; ceremony should not outweigh the work.

## Core units and lifecycle

Crossing, Delivery Pack, pack-lifecycle, gate-dimension, and Resume-checkpoint definitions live once in `${CLAUDE_PLUGIN_ROOT}/references/LIFECYCLE.md`; load it now and apply it throughout. Operational consequences: finish a pack's Crossing sequence before committing a Crossing from another pack; record why one Crossing is insufficient, dependencies, and pack-level rollback when a pack has more than one; never let review state masquerade as pack lifecycle.

## Write the self-contained plan

Write new Full plans to the canonical project plans directory (default `docs/airlock/plans/YYYY-MM-DD-<topic>.md`). Use `docs/airlock/ledger/YYYY-MM-DD-<topic>.md` for the new ledger and `docs/airlock/specs/` for its design; existing artifacts at legacy `docs/plans/`, `docs/ledger/`, and `docs/specs/` paths remain readable. A fresh session must be able to execute the plan alone. Include:

1. **Goal and architecture** — what done means and which project invariants are involved.
2. **File contract:**
   - **Owns** — exact files/globs this work may create or modify.
   - **Process artifacts** — exact `docs/airlock/specs/`, `docs/airlock/plans/`, `docs/airlock/ledger/`, and `docs/airlock/STATUS.md` paths, owned only by the orchestrator.
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
6. **Evidence and cleanup policy.** Name the project-configured evidence home. For tasks that may create non-product files or processes, state their ownership, retained-versus-temporary classification, exact-path/process cleanup, and cleanup gate.

## Resume checkpoint

The ledger is the only durable resume store. While work has an active pack, the orchestrator owns exactly one `## Resume checkpoint` section in the ledger. Replace its contents in place; never append checkpoint snapshots or create a parallel checkpoint file, message log, or state system. The guard hook denies a second checkpoint and ledger writes past the line cap (see LIFECYCLE.md).

Maintain `docs/airlock/STATUS.md` from `${CLAUDE_PLUGIN_ROOT}/references/STATUS.template.md` as the replace-in-place human dashboard. It links the design, plan, and ledger but never replaces the ledger Resume checkpoint as machine resume state.

Keep the checkpoint bounded to the canonical field list in `${CLAUDE_PLUGIN_ROOT}/references/LIFECYCLE.md`.

Refresh it after every subagent return, gate result, human checkpoint, and scope amendment, as well as before likely context compaction and before ending with unfinished work. A fresh session reads the approved design, plan, the ledger's single Resume checkpoint, and only the sections the checkpoint names (active pack, open gates, relevant Crossings) — never the whole ledger — before acting. Reference Crossing, gate, evidence, and Debug rows instead of copying history or long logs into the checkpoint.

At pack acceptance, replace the checkpoint once more, set **State** to `closed`, and identify the final Crossing; do not delete it. A Light single-Crossing pack may initialize and close the same compact checkpoint in one session. A legacy ledger without this section remains valid; add it only when work is actively resumed or repaired, without retrofitting historical state.

Refresh STATUS at package acceptance, review-round close, before compaction, and before ending an unfinished session. Replace it in place, never append snapshots, and retain only the five newest Recently closed rows.

## Portable execution and host routing

Full implementation routes are subagent-only. Record the route per pack/task; do not make one global agent choice for the whole plan.

| Pack / Crossing / task | Work class | Host role | Mode | Why | Parallel group | Checkpoint | Owns |
|---|---|---|---|---|---|---|---|
| `<IDs>` | Standard | implementer | subagent | `<one clause>` | A | yes/no | `<exact paths>` |

Portable work classes describe risk and judgment, not a vendor model:

- **Light** — mechanical or tightly contained, low-risk work with an obvious check.
- **Standard** — normal contained implementation with clear contracts and tests.
- **Complex** — cross-cutting behavior, architecture, or difficult diagnosis.
- **Critical** — safety-sensitive, irreversible, public-contract, or expensive-to-unwind work.

Use portable host roles such as `orchestrator`, `implementer`, `investigator`, `verifier`, `independent-reviewer`, `browser-verifier`, and `visual-verifier`. Then map the roles to what the active host actually offers:

| Host role / work class | Selected host agent or runtime | Selected available model | Independence / rationale |
|---|---|---|---|
| `<role> / <class>` | `<configured subagent or external runtime>` | `<host-selected model>` | `<why; note any independence limitation>` |

Do not bake host-specific model IDs into the canonical workflow. The plan records the selected mapping; gate evidence records the effective runtime, agent, model, and variant that actually ran.

**Browser-role fallback.** Some hosts (Cowork in particular) defer MCP tool schemas and disable `ToolSearch` for restricted subagents, so a restricted browser agent such as `visual-review` receives no browser tools at all. When a dispatched browser-verifier or visual-verifier reports this capability gap, re-route that role to the host's all-tools general agent as a forced substitution, not a preference. The substitute dispatch must restate every permanent browser guardrail: it is read-only for source — no edit, stage, or commit during gate execution, which would invalidate the gate — and it is a leaf that must not invoke `Agent` or `Task`; never access credentials, tokens, cookies, local storage, or browser profiles; request console and network evidence only through filtered output; and never echo token-bearing URLs. Record the substitution and its independence limitation in the route row and gate evidence. If no all-tools agent exists either, the gate is `blocked`, never simulated.

Prefer `worker` over an investigate -> code-* -> verify sequence unless the investigation output is a user decision input, the work is Critical, or a gate requires independence. Use specialist leaves for those exceptions. If a route exceeds its dispatch budget, require one PROGRESS line with the reason.

Parallel read-only tasks may run concurrently when useful. Serialize all file-writing workers while the session-global v2 contract is active, even when `Owns` sets are disjoint. Named per-worker contracts (`.airlock/contracts/<worker-id>.json`) are a 2.4 design note only and are not implemented here. Continue to serialize shared files, entry points, and project-wide configuration.

### Explicit external-runtime routes

Use an external runtime only when the approved route names it; never substitute one based on cost or work class. Before planning any external route, read `${CLAUDE_PLUGIN_ROOT}/references/EXTERNAL-RUNTIME.md`; it is the canonical contract for the complete route record, the pre-dispatch baseline, the strict `airlock.external-agent/v2` manifest schema, the closed permission policy, the single foreground dispatch of `${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs`, recovery classification, and the independent candidate audit. The plan records the complete route fields the reference names for each external run.

These invariants belong in every external plan row regardless: worker commit permission `none`; launcher sealing permission for one exact launcher-sealed candidate precursor under the pinned Crossing ID, message bytes/hash, and candidate path set; the orchestrator owns the independent candidate audit and the separate Crossing; external writers run foreground and serialized per target checkout while the orchestrator remains idle in that checkout.

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

Gate applicability, runtime state, waiver semantics, and the evidence-record field list are defined once in `${CLAUDE_PLUGIN_ROOT}/references/LIFECYCLE.md`; a waiver needs approver, reason, and date, never changes applicability, and never fabricates a `passed` state. A substantive change to a candidate-bearing path stales affected evidence; ledger-only bookkeeping does not.

If any task creates a temporary non-product artifact or process, cleanup is a required gate rather than a discretionary gate. Its pass condition names the exact task-owned paths/processes and proves they were removed or stopped. Add the gate through an approved plan/ledger amendment if the need is discovered during execution.

Implementers run focused RED/GREEN and Crossing checks. After code freeze, an independent verifier context or specialized gate role runs the required final pack gates against one exact candidate without editing source during gate execution. A pre-ship independent-review gate is part of acceptance; post-ship feedback belongs to Airlock **`review`**.

Each final gate records its evidence per the LIFECYCLE.md field list, including the exact candidate identity and the effective runtime/agent/model/variant that ran.

## Per-pack approval before execution

When the plan is written, stop and ask the user to approve or amend **each Delivery Pack’s** outcome, Crossing split, route, and gates. Use `AskUserQuestion` and give a recommendation. If the tool is unavailable, enter unattended mode: park the affected pack approval in `docs/airlock/DECISIONS.md`, mark that pack `blocked-on-user`, and continue planning other unblocked packs. Do not ask for a global agent choice, and do not execute a pack until its row, routing, and gates are approved.

A Light, single-Crossing pack may use one compact route row and only its genuinely required gates.

## Dispatch protocol

Before every dispatch, including a read-only subagent, confirm the approved scope. Restate this contract **verbatim** in every fresh-context prompt:

> **You may create or modify ONLY:** `<exact paths>`
>
> **You must NOT touch:** `<load-bearing exclusions and other lanes>`
>
> **Integration stance:** `<standalone or integrated with named seam>`
>
> **STOP rule:** if the task appears to require any path outside the allowlist, **STOP and report back. Do not edit it.** A blocked task reported honestly is a success; widened scope is not.

Also include the task’s Pack/Crossing IDs, host role, RED/GREEN steps, bounded validation, evidence expected, and the base-rules return contract. Every worker is a leaf: do not give it `Agent`, `Task`, workflow, or external-delegation tools. Never route a leaf to Fable without fresh user approval immediately before that individual dispatch; record the approval in the dispatch prompt.

When the host supports hooks, additionally write the canonical v2 contract to `.airlock/contract.json` before every dispatch:

    {
      "schema": "airlock.contract/v2",
      "actorMode": "agent-id",
      "root": "C:/work/product",
      "ownedPaths": ["src/**", "D:/shared/tests/**"],
      "processPaths": ["C:/work/project-docs/docs/airlock/**"],
      "expiresAt": "<ISO-8601 UTC timestamp no more than 2 hours after dispatch>",
      "allowDispatch": false
    }

Replace the example values with the task's absolute worker root, exact owned paths, explicit orchestrator bookkeeping paths, and an ISO-8601 UTC expiry no more than 2 hours after dispatch (for example, now + 2h). Keep `allowDispatch` false for a leaf. A read-only dispatch uses the minimal contract `ownedPaths: []` and `allowDispatch: false`. `actorMode` defaults to `agent-id`; if the session has never observed an `agent_id`-bearing hook input, explicitly select `single-actor`: worker rules apply to everyone and the guard fails closed if even the initiating dispatch cannot be distinguished. In that case, STOP and report the host incompatibility. While active, top-level calls may write only explicit `processPaths` and `.airlock/**`; worker calls may write only `ownedPaths` and are denied every process path and `.airlock/**`. The guard screens broad Git staging and obvious Bash/PowerShell writes. Serialize all file-writing workers while this session-global contract exists, parallelize only workers whose minimal read-only contracts are identical, and delete the contract after the return audit.

Require the agent to classify every non-product artifact it creates per the base Artifacts-and-cleanup rules, returning retained-evidence references or exact temporary paths/processes and their cleanup state.

**Reviewer context bundle.** For every independent-review or verification dispatch, build a deterministic review bundle with `scripts/build-review-bundle.mjs` and include it in the prompt instead of expecting the reviewer to sweep the repository. The bundle is generated **once from the frozen candidate** (never from an implementer summary), pinned to the exact candidate identity (commit/tree, or `base SHA + staged product-diff hash`), and contains the candidate-scoped diff, the changed-file list, focused evidence excerpts, and the relevant plan/spec sections — deterministically ordered and identified by a SHA-256 of its exact bytes. Cap the bundle at about 15K tokens (`--max-tokens`); if the mandatory diff plus changed-file list would overflow, the builder **fails closed** — narrow the candidate package rather than silently truncating evidence. Optional sections that overflow are recorded as explicit omissions in the bundle. Any candidate-bearing change makes the bundle stale: regenerate it, never patch it. The bundle is a task-owned temporary artifact: record its exact path and hash in the dispatch, and the orchestrator removes the artifact after the return audit per the base cleanup rules. Reviewers verify from these artifacts, not the implementer's conclusions; deeper file reads are allowed only inside the bundle's scope.

For a launcher-sealed external writer route, follow `references/EXTERNAL-RUNTIME.md` for the dispatch, permissions, summary, recovery, and audit; restate in the worker prompt that its commit permission is `none`, the launcher seals the one exact candidate, and it must make no candidate-commit claim.

## Implement

Activate one approved Delivery Pack and work its contiguous Crossings in order. Only read-only tasks may run in parallel while the session-global v2 contract exists; serialize all file-writing workers. Keep required per-Crossing checks green, turn diagnosed bugs into regression tests, and stop at planned checkpoints.

Invoke **`ship`** at every Crossing. The final Crossing can accept the Delivery Pack only when all unwaived required gates have fresh evidence for its exact candidate. Feedback after a shipped commit goes through **`review`**.

If the input is a legacy 1.1 ledger, view its historical Crossings as one implicit `legacy:<work-id>` Delivery Pack and leave historical gates unknown. Plan new work as a 1.2 pack; do not retrofit gate evidence or checkpoint history.

## Approval message

For each approval, use `AskUserQuestion` with concrete options and a recommendation in no more than three sentences of rationale. Link the existing written plan and its work-package table instead of streaming detail; the base interaction contract governs the rest of the user-facing message.

---
name: plan
description: Turns an approved design into a test-first Delivery Pack plan with contiguous scope-audited Crossings, disjoint file contracts, portable work classes and host roles, host-routing mappings, and planner-selected gates. Gets per-pack routing and gate approval before implementation. Requires approved scope; otherwise invoke brainstorm.
---

# Plan — approved design → verifiable Delivery Packs

Precondition: an approved design or scope contract exists. If not, stop and invoke **`brainstorm`**.

## Core units and lifecycle

- A **Crossing** is one scope-audited, buildable commit with focused evidence. Under an approved external handoff, the worker commit is a product candidate precursor, not a Crossing; the following orchestrator-owned process-artifact commit is the Crossing and references that candidate.
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
6. **Evidence and cleanup policy.** Name the project-configured evidence home. For tasks that may create non-product files or processes, state their ownership, retained-versus-temporary classification, exact-path/process cleanup, and cleanup gate.

## Resume checkpoint

The ledger is the only durable resume store. While work has an active pack, the orchestrator owns exactly one `## Resume checkpoint` section in the ledger. Replace its contents in place; never append checkpoint snapshots or create a parallel checkpoint file, message log, or state system.

Keep the checkpoint bounded to these fields:

- **State:** `active` or `closed`.
- **Updated:** ISO-8601 timestamp.
- **Active pack / Crossing:** exact IDs.
- **Completed:** concise completed tasks/Crossings.
- **Changed paths:** current attributable paths, not the whole worktree.
- **Fresh evidence:** current evidence IDs or concise command/tool references and results; for an external run, include its session ID, completion/classification, selected and effective route, and permission-policy identity/proof.
- **Blockers / decisions:** unresolved blockers and approved decisions.
- **Retained evidence:** exact stable paths in the configured evidence home and their ledger/gate references.
- **Temporary artifacts / processes:** exact task-owned paths/processes and cleanup state, including external sessions and processes when applicable.
- **Next action:** one exact executable action.

Refresh it after every subagent return, gate result, human checkpoint, and scope amendment, as well as before likely context compaction and before ending with unfinished work. A fresh session reads the approved design, plan, ledger, and Resume checkpoint before acting. Reference Crossing, gate, evidence, and Debug rows instead of copying history or long logs into the checkpoint.

At pack acceptance, replace the checkpoint once more, set **State** to `closed`, and identify the final Crossing; do not delete it. A Light single-Crossing pack may initialize and close the same compact checkpoint in one session. A legacy ledger without this section remains valid; add it only when work is actively resumed or repaired, without retrofitting historical state.

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

Do not bake host-specific model IDs into the canonical workflow. The plan records the selected mapping; gate evidence records the effective runtime, agent, model, and variant that actually ran.

Parallel tasks must have disjoint `Owns` sets. Serialize shared files, entry points, and project-wide configuration.

### Explicit external-runtime routes

Use an external runtime only when the approved route names it; never substitute one based on cost or work class. For each external run, record this complete route:

| Pack / Crossing / task | Runtime | Role | Selected agent | Model | Variant | Target directory | Approved branch | Exact file contract | Approved commands | Permission / containment policy identity and proof | Foreground timeout | Commit permission | Session / evidence / cleanup policy | Independence limits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `<IDs>` | `<runtime>` | `<host role>` | `<agent>` | `<model>` | `<variant>` | `<exact directory>` | `<branch>` | `<Owns, exclusions, STOP rule>` | `<exact allowlist>` | `<full policy or immutable source + hash; process guardrails; effective-policy proof>` | `<duration>` | `none` or `one scoped product candidate commit` | `<return, checkpoint, retention, exact cleanup>` | `<shared context/family or other limits>` |

External file-writing runs are foreground and serialized per checkout. Read-only external runs may overlap only when they cannot contend for mutable state. Immediately before dispatching a writer:

1. record the approved branch and prove `git branch --show-current` matches it;
2. record the full `HEAD` SHA;
3. prove `git diff --cached --name-status` is empty;
4. capture the complete, unfiltered `git status --short` baseline;
5. prove every task-owned path is clean; and
6. prove the route's complete closed permission/containment policy is loaded and effective under its recorded identity, including precedence over ambient defaults.

Preserve pre-existing unrelated status entries and exclude those paths from the worker contract. Stop if a precondition fails. From dispatch until the worker returns, the orchestrator performs no file or git operation in that checkout.

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

If any task creates a temporary non-product artifact or process, cleanup is a required gate rather than a discretionary gate. Its pass condition names the exact task-owned paths/processes and proves they were removed or stopped. Add the gate through an approved plan/ledger amendment if the need is discovered during execution.

Implementers run focused RED/GREEN and Crossing checks. After code freeze, an independent verifier context or specialized gate role runs the required final pack gates against one exact candidate without editing source during gate execution. A pre-ship independent-review gate is part of acceptance; post-ship feedback belongs to Airlock **`review`**.

Each final gate will record either a full commit/tree or `base SHA + staged product-diff hash`, plus timestamp, effective runtime/agent/model/variant, command or MCP tool, environment, result, and artifact. External evidence also records the effective route and full permission/containment policy identity and proof. Substantive changes to candidate-bearing paths make affected evidence `stale`.

## Per-pack approval before execution

When the plan is written, stop and ask the user to approve or amend **each Delivery Pack’s** outcome, Crossing split, route, and gates. Use the host’s structured question tool when available and give a recommendation. One pack may mix inline and subagent tasks. Do not ask for a global inline/subagent choice, and do not execute a pack until its row, routing, and gates are approved.

A Light, single-Crossing pack may use one compact route row and only its genuinely required gates. Explicit risk decisions still apply, but ceremony should not outweigh the work.

## Concise return contract

Use this exact five-bullet shape for every dispatch return and orchestrator report:

- **Status:** `done`, `partial`, or `blocked`, followed by one factual sentence.
- **Changes/findings:** exact changed paths or prioritized findings; `none` when applicable.
- **Evidence:** exact command/tool and result; name anything required but not run.
- **Artifacts/cleanup:** retained evidence paths/references and exact temporary paths/processes removed, still present, or blocked; `none` when applicable.
- **Action needed:** `none` or one exact decision, blocker, or next action.

Return only those bullets, using facts and actions. Do not restate the prompt, plan, or file contract, and do not include long logs unless requested or a concise failure excerpt is needed.

## Dispatch protocol

Before any file-writing subagent, confirm the approved scope. Restate this contract **verbatim** in every fresh-context prompt:

> **You may create or modify ONLY:** `<exact paths>`
>
> **You must NOT touch:** `<load-bearing exclusions and other lanes>`
>
> **Integration stance:** `<standalone or integrated with named seam>`
>
> **STOP rule:** if the task appears to require any path outside the allowlist, **STOP and report back. Do not edit it.** A blocked task reported honestly is a success; widened scope is not.

Also include the task’s Pack/Crossing IDs, host role, RED/GREEN steps, bounded validation, evidence expected, and the concise return contract above. When an external route grants commit permission, require the exact Crossing ID in the worker candidate commit message. Require the agent to classify every non-product artifact it creates:

- **Retained evidence:** move file-based evidence to the project-configured evidence home under a stable exact path when that path is allowlisted, and return the intended ledger/gate reference. Otherwise return the exact source path for an orchestrator-owned move without widening scope.
- **Temporary:** return every exact task-owned path/process and remove or stop it before returning when ownership is certain and cleanup is safe.

Never authorize broad-glob cleanup or deletion of unknown, pre-existing, user-owned, or another lane's artifacts. If ownership or safe cleanup cannot be established, leave the item in place and return `blocked` with its exact path/process and required decision. For Playwright/browser work, retain only required evidence and remove superseded task-created screenshots, downloads, traces, and logs; never clean credentials, browser profiles, cookies, localStorage, or other user state.

For every external run, supply a complete closed permission set for that invocation, with a final deny-by-default rule proven to override ambient defaults; do not inherit or leave any decision to ambient permissions. Allow only the route's exact reads, owned edits for a writing role, approved commands, target directory, and required evidence/runtime paths; read-only roles receive no edit permission. Explicitly deny automatic approval (`--auto` or equivalent), nested delegation, interactive questions, unowned edits, arbitrary shell commands, undeclared external paths, project or runtime configuration, credentials, and push/publish operations. The approved scoped git commands are the only git operations the worker may use. Disable interactive credential prompts, inherited SSH-agent access, and remote push capability. Policy identity is the full invocation policy or its immutable source plus content hash, together with these process guardrails and effective-policy proof.

These restrictions are guardrails for an honest agent, not containment of a hostile process. Deterministic return audits are the local-checkout correctness boundary; external side effects remain guardrail and self-report territory.

Require the worker or adapter to return the external session ID, completion state, selected and effective runtime/agent/model/variant, policy identity/proof, evidence summary, and every exact artifact/process. Record identity, route, and result under checkpoint **Fresh evidence**, and exact session/process cleanup under **Temporary artifacts / processes**. Resume an interrupted run only after verifying the checkout against its recorded branch, parent, index, status baseline, and attributable delta; fork instead when the failed session must remain intact. Clean accepted or abandoned runs only by exact session ID, path, and process according to the approved route and the artifact rules above.

If a return times out, is killed, or is indeterminate, make no checkout edit. Stop only the exact task-owned process when its identity is certain and doing so is safe. Once the checkout is quiescent, inspect branch, `HEAD`, index, and the complete `git status --short` before any edit; classify the state as `no-commit`, `one-commit`, or `indeterminate`, and complete the applicable return audit for a one-commit state. Then update the checkpoint fields above and resume or fork only when checkout verification passes. If verification fails, stop without cleanup or history mutation. If process ownership is uncertain, leave the process and checkout untouched and stop for a user decision; checkpointing waits until it cannot race that process.

After return, audit `git status --short` and the attributable changed-path delta against the contract before accepting the work; surface out-of-contract paths instead of silently keeping, deleting, or reverting them. Verify returned artifact paths/processes and cleanup state, then replace the ledger Resume checkpoint in place.

## Implement

Activate one approved Delivery Pack and work its contiguous Crossings in order. Tasks may run in parallel only under disjoint ownership. Keep required per-Crossing checks green, turn diagnosed bugs into regression tests, and stop at planned checkpoints.

Invoke **`ship`** at every Crossing. The final Crossing can accept the Delivery Pack only when all unwaived required gates have fresh evidence for its exact candidate. Feedback after a shipped commit goes through **`review`**.

If the input is a legacy 1.1 ledger, view its historical Crossings as one implicit `legacy:<work-id>` Delivery Pack and leave historical gates unknown. Plan new work as a 1.2 pack; do not retrofit gate evidence or checkpoint history.

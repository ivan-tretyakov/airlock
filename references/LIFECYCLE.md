# Airlock lifecycle, gates, and checkpoint reference

Shared definitions for `plan`, `ship`, and `review`. Each command loads this file once when it needs lifecycle, gate, or checkpoint field definitions instead of restating them.

## Core units

- A **Crossing** is one scope-audited, buildable commit with focused evidence. Under an approved external writer handoff, the launcher-sealed candidate precursor contains only exact product paths and is not a Crossing; the following orchestrator-owned process-artifact commit is the Crossing and references that candidate SHA/tree.
- A **Delivery Pack** is one coherent outcome delivered by one or more contiguous Crossings. Finish its Crossing sequence before committing a Crossing from another pack.
- A multi-Crossing Delivery Pack records why one Crossing is insufficient, dependencies, and a pack-level rollback strategy. Dependent Crossings are not promised to remain independently revertible.

## Pack lifecycle

`planned → active → candidate → accepted`, with `blocked`, `abandoned`, and `reverted` as exceptional terminal outcomes. Review lifecycle is a separate ledger field and never substitutes for pack lifecycle. A single-Crossing pack may move through `active` and `candidate` to `accepted` in one ship operation.

## Gate dimensions

Every gate has three independent dimensions:

- **Applicability:** `required` or `not-required`.
- **Gate state:** `pending`, `running`, `passed`, `failed`, `blocked`, or `stale`.
- **Waiver:** approver, reason, and date. A waiver does not change applicability or turn a gate state into `passed`.

Each evidence record identifies: gate ID, exact candidate (full commit/tree, or `base SHA + staged product-diff hash`), timestamp, executor host role and effective runtime/agent/model/variant, command or MCP tool, environment/target, result, and artifact reference. External evidence also records the additional fields required by `EXTERNAL-RUNTIME.md`. A substantive change to a candidate-bearing path (code, tests, configuration, generated artifacts, cited specs) stales every affected gate; a ledger-only bookkeeping edit does not.

The approved plan records each required gate's `Executed by` mode: `implementer`, `orchestrator-inline`, or `independent`. Deterministic checks are normally implementer or orchestrator-inline evidence; independent verification is pack-level by default and is reserved for judgment or final pack gates. A per-Crossing independent gate needs a stated reason in its plan row.

## Resume checkpoint fields

The orchestrator owns exactly one `## Resume checkpoint` section in the ledger, replaced in place — never appended, never duplicated (the guard hook denies a second checkpoint and enforces the ledger line cap). Keep it bounded to:

- **State:** `active` or `closed`.
- **Updated:** ISO-8601 timestamp.
- **Active pack / Crossing:** exact IDs.
- **Completed:** concise completed tasks/Crossings.
- **Changed paths:** current attributable paths, not the whole worktree.
- **Fresh evidence:** current evidence IDs or concise command/tool references and results; for an external run, the summary facts required by `EXTERNAL-RUNTIME.md`.
- **Blockers / decisions:** unresolved blockers and approved decisions.
- **Retained evidence:** exact stable paths in the configured evidence home and their ledger/gate references.
- **Temporary artifacts / processes:** exact task-owned paths/processes and cleanup state, including external sessions and processes when applicable.
- **Next action:** one exact executable action.

Reference Crossing, gate, evidence, and Debug rows instead of copying history or long logs into the checkpoint. At pack acceptance set **State** to `closed` and identify the final Crossing; do not delete the checkpoint. A legacy ledger without this section remains valid; add one only when work is actively resumed or repaired.

## Ledger hygiene (mechanically enforced)

The guard hook enforces ledger hygiene **globally** on the canonical `docs/airlock/ledger/**` and `docs/ledger/**` paths, independent of any dispatch contract (the orchestrator edits the ledger precisely when no worker contract is active). It denies: a full Write whose content contains more than one `## Resume checkpoint` heading; an Edit whose projected file would hold more than one checkpoint heading or would cross the 800-line cap; and any ledger write that keeps the ledger at or beyond the 800-line cap. An over-cap ledger accepts only a full shrink Write below the cap. When a ledger approaches the cap, archive `## Completed` blocks to `docs/airlock/archive/YYYY-MM/<work-id>-completed.md` at pack acceptance and leave one-line references; the shrink is performed as one full Write below the cap. Non-ledger paths, and Edits that cannot be modeled safely against the on-disk content, fail open.

## Reviewer context bundle (mechanically generated)

For every independent-review or verification dispatch, build a deterministic bundle with `scripts/build-review-bundle.mjs` (`--repo <checkout> --candidate <identity> --diff <file> --files <list> --evidence <file> --spec <file> --out <path> [--max-tokens 15000]`) and include it in the reviewer prompt. The builder derives the candidate diff and changed-file list from the repository and rejects supplied inputs that do not match. The candidate identity is the full commit/tree, or `base SHA + staged product-diff hash`. The bundle is generated once from the frozen candidate, deterministically ordered, hash-identified (SHA-256 over its exact bytes), and capped at ~15K tokens. A mandatory diff-plus-file-list overflow fails closed; optional evidence/spec overflow is recorded as an explicit omission. Any candidate-bearing change stales the whole bundle — regenerate, never patch. The bundle is a task-owned temporary artifact: record its path and hash, and the orchestrator removes it after the return audit.

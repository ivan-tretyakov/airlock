# Airlock 1.2.1 concise reporting, checkpoints, and cleanup

- **Work ID:** `airlock-reporting-checkpoint-cleanup`
- **Scope version:** 1
- **Status:** approved
- **Approved by:** Ivan Tretyakov
- **Approved at:** 2026-08-05
- **Repairs:** `AIRLOCK-P01`

## Goal

Make orchestrator and subagent communication concise and uniform, preserve enough local state to resume safely after compaction or a fresh session, and prevent probes, screenshots, and temporary processes from accumulating after tasks and Delivery Packs.

## Scope contract

- **Deliverable:** Airlock 1.2.1 canonical workflow and aligned Claude Code/OpenCode agents.
- **Integration stance:** extend the accepted Delivery Pack workflow. The ledger remains the durable state authority; no second checkpoint store or cleanup daemon is introduced.
- **Extend or write fresh:** extend canonical plan/ship/review/debug and existing host agents. Add one bounded ledger section; do not add a separate checkpoint file.
- **May touch:** exact paths in `docs/plans/2026-08-05-concise-checkpoint-cleanup.md`.
- **Must not touch:** application code, credentials, plugin caches, unrelated host settings, or unlisted agent definitions.

## Decisions

### Uniform return contract

Every orchestrator and subagent response uses five concise bullet groups when applicable:

- **Status:** done, partial, or blocked plus one factual sentence.
- **Changes / findings:** exact paths or prioritized findings; `none` when applicable.
- **Evidence:** command/tool and result; explicitly state what was not run.
- **Artifacts / cleanup:** retained evidence paths and removed temporary paths/processes.
- **Action needed:** `none` or the exact decision/blocker/next action.

Do not restate the prompt, plan, file contract, or long logs unless the user requests them or a failure excerpt is needed. Omit empty detail, not the heading's factual value.

### Bounded resume checkpoint

Every active 1.2.1 pack has one orchestrator-owned `## Resume checkpoint` section in its ledger. It is replaced in place rather than appended and records:

- updated timestamp;
- active pack and Crossing;
- completed work;
- current changed paths;
- fresh evidence references;
- blockers/decisions;
- temporary and retained artifacts;
- exact next action.

Refresh it after every subagent return, gate, human checkpoint, scope amendment, and before likely compaction or ending a turn with unfinished work. A fresh session reads design, plan, ledger, and this checkpoint before acting. At pack acceptance, mark it closed and point to the final Crossing rather than deleting history.

### Artifact classification and cleanup

Agents classify every created non-product artifact as:

- **Retained evidence:** moved to the project-configured evidence home, given a stable name, and referenced by the ledger/gate.
- **Temporary:** exact paths/processes owned by the task and removed/stopped before return when safe.

Never use broad cleanup globs, delete pre-existing/unknown files, or remove another lane's artifacts. Report blocked cleanup. If a pack created temporary artifacts or processes, cleanup is a required gate and pack acceptance is blocked until exact-path cleanup is evidenced.

For Playwright/browser work, retain only screenshots/logs that are required evidence; remove superseded captures, downloads, traces, and temporary logs created by the task. Never clean credentials, browser profiles, cookies, local storage, or user-owned state.

## Compatibility

Legacy ledgers without a Resume checkpoint remain valid. New work adds the section when first resumed or repaired. Existing agents retain their role/model routing; only response and cleanup contracts change.

## Release

Patch version `1.2.1`. Publish and refresh both host installations after verification.

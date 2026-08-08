---
description: Activate Airlock for this session and route a task
argument-hint: "[--workflow auto|quick|compact|full] [--runtime native|opencode] <task>"
---

# Start Airlock

Activate Airlock for this session only. Installation and project configuration never activate it. Apply these instructions until the user invokes `/airlock:stop` or says to stop Airlock.

Task and optional overrides:

`$ARGUMENTS`

## Output

- Lead with the result, decision, or next action.
- Use numbered steps only when the user must perform more than one action.
- Keep lists to five items or fewer; split longer material by priority.
- Omit preambles, recaps, tangents, and closing pleasantries.
- During work, report only meaningful state changes. On success, state the outcome and verification. When blocked, state the cause and one next action.

These rules adapt the action-first principles of `ayghri/i-have-adhd`; task completeness and safety take precedence over brevity.

## Runtime

Resolve runtime in this order:

1. `--runtime` in this invocation.
2. `.airlock/config.json` in the project root.
3. `native`.

`native` uses only the current host and its leaf subagents. `opencode` uses the deterministic external launcher only on a local host with Node.js, Git, and OpenCode available. Cowork web/mobile and any host without those executables must stop with the missing capability; never silently fall back or install dependencies.

## Classify

Classify task complexity and workflow weight separately. State the result in one line: `Airlock: <Quick|Compact|Full> (<reason>), <native|opencode>.` Do not ask the user to approve `auto` classification; the user may override it.

| Workflow | Use when | Execution | Artifacts |
|---|---|---|---|
| Quick | Trivial or Light: mechanical, tightly contained, low risk, obvious verification | Exactly one leaf worker implements and validates end-to-end. The main session audits scope, changed paths, and result. | No design, plan, ledger, Crossing, or independent review. |
| Compact | Standard: contained implementation with clear seams and focused tests | One short in-chat scope, normally one leaf worker, and only risk-relevant verification. | No durable workflow files unless work must span sessions. |
| Full | Complex or Critical: cross-cutting design, difficult diagnosis, safety-sensitive, irreversible, public-contract, external-state, migration, or expensive-to-unwind work | Use explicit `/airlock:brainstorm`, `/airlock:plan`, `/airlock:ship`, `/airlock:review`, and `/airlock:debug` boundaries as applicable. | Design, plan, ledger, Crossings, and selected gates. |

Ambiguity about intent or blast radius escalates one level. Security, credentials, destructive actions, migrations, production/live mutations, external publication, and irreversible work always use Full. A user override cannot remove a required safety confirmation.

For an unambiguous Quick task, the user's request is the scope contract. Dispatch immediately rather than creating process work. The worker receives exact allowed paths when known, must preserve unrelated state, must stop before touching an unowned path, and must return changed paths plus actual validation.

## Delegation

Only this main session may delegate. Every worker is a leaf and must not invoke `Agent`, `Task`, another model, a workflow, or an external agent. Maximum delegation depth is one.

Use the configured non-Fable leaf for the work class. Never select, inherit, or override a leaf to Fable without asking the user immediately before that individual invocation. This approval is required for every Fable leaf, even when the main session uses Fable or the user approved an earlier Fable leaf. Record approval in the dispatch prompt. Do not treat selection of Fable for the main session as subagent approval.

For native Quick work, dispatch exactly one of `code-light` or `code-standard`; do not add investigator, reviewer, or verifier agents. The worker performs implementation and focused validation in one run. The main session may inspect and run a final deterministic check but may not delegate again.

For `opencode`, apply the deterministic launcher contract in the orchestrator agent directly. For Quick work, derive the exact manifest scope from the user's request, use task-owned Quick identifiers where the strict schema requires pack or Crossing identifiers, and create no workflow artifacts. For Full work, follow the canonical Full commands. The OpenCode worker remains a leaf with `task` and interactive questions denied. External execution is never selected merely because it is configured: use it only after Airlock is explicitly started for the task.

## Execute

If `$ARGUMENTS` contains a task, classify and execute it now. If it contains only options or is empty, report Airlock active, resolved runtime, and the one-line syntax for submitting the task. Do not start another workflow merely to activate the mode.

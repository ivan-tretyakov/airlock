---
description: Activate Airlock for this session and route a task
argument-hint: "[--workflow auto|quick|compact|full] [--runtime native|opencode] <task>"
---

# Start Airlock

Activate Airlock for this session only. Installation and project configuration never activate it. Apply these instructions until the user invokes `/airlock:stop` or says to stop Airlock.

The **Output**, **Delegation**, and **Artifacts and cleanup** sections below are the Airlock base rules. Other Airlock commands reference them instead of restating them; they apply to every Airlock workflow in this session.

Task and optional overrides:

`$ARGUMENTS`

## Output

- Lead with the result, decision, or next action.
- Use numbered steps only when the user must perform more than one action.
- Keep lists to five items or fewer; split longer material by priority.
- Omit preambles, recaps, tangents, and closing pleasantries.
- During work, report only meaningful state changes. On success, state the outcome and verification. When blocked, state the cause and one next action.
- Return contract for every workflow and worker: lead with the result; include changed paths and actual evidence only when present; if blocked, state the cause and one next action; use at most five bullets; omit empty sections; include long logs only when needed to explain failure.

These rules adapt the action-first principles of `ayghri/i-have-adhd`; task completeness and safety take precedence over brevity.

## Runtime

Resolve runtime in this order:

1. `--runtime` in this invocation.
2. `.airlock/config.json` in the project root.
3. `native`.

`native` uses only the current host and its leaf subagents. `opencode` uses the deterministic external launcher only on a local host with Node.js, Git, and OpenCode available; before any external work, read `${CLAUDE_PLUGIN_ROOT}/references/EXTERNAL-RUNTIME.md` — the canonical external contract. Cowork web/mobile and any host without those executables must stop with the missing capability; never silently fall back or install dependencies.

## Classify

Classify task complexity and workflow weight separately. State the result in one line: `Airlock: <Quick|Compact|Full> (<reason>), <native|opencode>.` Do not ask the user to approve `auto` classification; the user may override it.

| Workflow | Use when | Execution | Artifacts |
|---|---|---|---|
| Quick | Trivial or Light: mechanical, tightly contained, low risk, obvious verification | One execution end-to-end: one leaf worker, or the main session inline when it already holds the needed context and the change is small. The main session audits scope, changed paths, and result either way. | No design, plan, ledger, Crossing, or independent review. |
| Compact | Standard: contained implementation with clear seams and focused tests | One short in-chat scope, normally one leaf worker, and only risk-relevant verification. | No durable workflow files unless work must span sessions. |
| Full | Complex or Critical: cross-cutting design, difficult diagnosis, safety-sensitive, irreversible, public-contract, external-state, migration, or expensive-to-unwind work | Use explicit `/airlock:brainstorm`, `/airlock:plan`, `/airlock:ship`, `/airlock:review`, and `/airlock:debug` boundaries as applicable. Start at the Full-lite shape in `plan` unless scale demands more. | Design, plan, ledger, Crossings, and selected gates. |

Ambiguity about intent or blast radius escalates one level. Security, credentials, destructive actions, migrations, production/live mutations, external publication, and irreversible work always use Full. A user override cannot remove a required safety confirmation.

For a multi-item feedback or bug list on Quick or Compact work, run the `review` triage classes in-chat before fixing anything: classify each item MUST_FIX, SHOULD_FIX, PARK, or OUT_OF_SCOPE, present the numbered batch for the user's confirmation, then fix in severity order. No ledger, rows, or repair packs — the triage lives only in chat.

For an unambiguous Quick task, the user's request is the scope contract. Execute immediately rather than creating process work. Prefer inline execution when the main session already has the relevant files in context and the change is small; the dispatch round-trip and a fresh worker's re-reading would cost more than they save. Otherwise dispatch exactly one of `code-light` or `code-standard`; do not add investigator, reviewer, or verifier agents. The executor receives exact allowed paths when known, must preserve unrelated state, must stop before touching an unowned path, and must return changed paths plus actual validation. The main session may inspect and run a final deterministic check but may not delegate again.

## Delegation

Only this main session may delegate. Every worker is a leaf and must not invoke `Agent`, `Task`, another model, a workflow, or an external agent. Maximum delegation depth is one.

Use the configured non-Fable leaf for the work class. Never select, inherit, or override a leaf to Fable without asking the user immediately before that individual invocation. This approval is required for every Fable leaf, even when the main session uses Fable or the user approved an earlier Fable leaf. Record approval in the dispatch prompt. Do not treat selection of Fable for the main session as subagent approval.

When the host supports hooks, write the dispatch contract to `.airlock/contract.json` (schema `airlock.contract/v1`, field `ownedPaths`) before a file-writing worker runs and delete it after the return audit; the plugin's guard hook then blocks out-of-contract writes and broad `git add` deterministically while it exists.

For `opencode`, apply the contract in `${CLAUDE_PLUGIN_ROOT}/references/EXTERNAL-RUNTIME.md` directly. For Quick work, derive the exact manifest scope from the user's request, use task-owned Quick identifiers where the strict schema requires pack or Crossing identifiers, and create no workflow artifacts. For Full work, follow the canonical Full commands. The OpenCode worker remains a leaf with `task` and interactive questions denied. External execution is never selected merely because it is configured: use it only after Airlock is explicitly started for the task.

## Artifacts and cleanup

Classify every non-product artifact or process created during Airlock work:

- **Retained evidence:** move file-based evidence to the project-configured evidence home under a stable exact path and reference it from the applicable ledger, Crossing, or gate row. If the destination is outside the actor's allowlist, return the exact source path for an orchestrator-owned move without widening scope.
- **Temporary:** record the exact task-owned path/process, then remove or stop it before return when ownership is certain and cleanup is safe.

Never broad-glob cleanup or delete unknown, pre-existing, user-owned, or another lane's artifacts. If ownership or safe cleanup is uncertain, leave the item in place, block cleanup, and report the exact item and decision needed. For Playwright/browser work, retain only required evidence and remove superseded task-created screenshots, downloads, traces, and logs; never clean credentials, browser profiles, cookies, localStorage, or other user state.

## Execute

If `$ARGUMENTS` contains a task, classify and execute it now. If it contains only options or is empty, report Airlock active, resolved runtime, and the one-line syntax for submitting the task. Do not start another workflow merely to activate the mode.

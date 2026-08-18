---
description: Activate Airlock for this session and route a task
argument-hint: "[--workflow auto|quick|compact|full] [--runtime native|opencode] [--unattended] [--max-crossings N] [--max-wall-clock DURATION] <task>"
---

# Start Airlock

Activate Airlock for this session only. Installation and project configuration never activate it. Apply these instructions until the user invokes `/airlock:stop` or says to stop Airlock.

The **Output**, **Delegation**, and **Artifacts and cleanup** sections below are the Airlock base rules. Other Airlock commands reference them instead of restating them; they apply to every Airlock workflow in this session.

Task and optional overrides:

`$ARGUMENTS`

## Output

Every user-facing message is exactly one of three forms:

- **PROGRESS:** one line with the meaningful state change and next action. Final success is a PROGRESS message that states the outcome and actual verification.
- **DECISION:** in attended mode, use `AskUserQuestion` for every approval or design-changing choice, with concrete options and a recommendation in no more than three concise sentences linking the relevant specification or plan. If that tool is unavailable, enter unattended mode and apply Decision parking below instead of substituting an unstructured approval.
- **BLOCKED:** at most three lines: cause, impact, and one exact next action or decision needed.

Show status only at work-package or review-round boundaries. At each boundary, `Item | State | Next | Owner` is the explicit exception to one-line PROGRESS when it clarifies handoff; keep the whole message to about fifteen lines. Within any form, use at most five bullets, lead with the result, and omit preambles, recaps, tangents, and closing pleasantries.

Long logs are never user-facing; when detail is necessary, provide a stable artifact/link. Keep internal audit reasoning and deliberation never shown; state only actionable facts, useful changed paths, and actual evidence. Use plain language in user messages: work package (Delivery Pack), checkpoint commit (Crossing), check (gate), exact code being verified (candidate), approved skip (waiver), parallel workstream (lane), and test-fix-simplify (RED-GREEN-refactor). Artifacts retain canonical terms for grep-ability.
These rules adapt the action-first principles of `ayghri/i-have-adhd`; task completeness and safety take precedence over brevity.

## Runtime

Resolve runtime in this order:

1. `--runtime` in this invocation.
2. `.airlock/config.json` in the project root.
3. `native`.

Check whether `.airlock/config.json` exists before reading it. When absent, resolve to `native` without a visible read error.

`native` uses only the current host and its leaf subagents. `opencode` uses the deterministic external launcher only on a local host with Node.js, Git, and OpenCode available; before any external work, read `${CLAUDE_PLUGIN_ROOT}/references/EXTERNAL-RUNTIME.md` — the canonical external contract. Cowork web/mobile and any host without those executables must stop with the missing capability; never silently fall back or install dependencies.

## Host harness gate (guard-capable Full)

Full work — the Full workflow and any always-Full safety class — runs only on a **guard-capable host**. Claude Code qualifies when its PreToolUse guard hook is loaded. OpenCode qualifies only when the `airlock_guard_status` tool is available and reports `fullCapable: true`. Cowork web/mobile and any host without either mechanism are `BLOCKED`, never downgraded to Compact and never executed inline. State the cause (guard unavailable), the impact (Full ceremony enforcement is unavailable), and one exact next action. A user override cannot bypass a failed guard-capability check.

A Claude-hosted Full session may select `runtime: opencode` and dispatch OpenCode as an external **leaf worker**; that remains legal. The `runtime` option never changes which host runs the ceremony — only the leaf that executes the task. This gate is a host capability check, not a `runtime` routing decision.

## Classify

Classify task complexity and workflow weight separately. State the result in one line: `Airlock: <Quick|Compact|Full> (<reason>), <native|opencode>.` In unattended mode state `Airlock: <weight>, <native|opencode>, unattended.` Do not ask the user to approve `auto` classification; the user may override it.

If the task is exploratory, throwaway, or prototype-class work with no irreversible surface, recommend NOT using Airlock for it and stop after that recommendation: native execution without Airlock is cheaper and equally safe for that class. Airlock is a Full-work tool, not a way of working.

Before classification, if this task or its plan contains a browser gate, load the matching host config/overlay and run the stored backend and auth-signal preflight. A host mismatch is BLOCKED with `re-run /airlock:setup on this host`; any backend or auth failure is BLOCKED with the configured `refreshCommand` verbatim. Missing `browser` in a valid v1 or v2 config means no browser gates are configured.

| Workflow | Use when | Execution | Artifacts |
|---|---|---|---|
| Quick | Trivial or Light: mechanical, tightly contained, low risk, obvious verification | One execution end-to-end: one leaf worker, or the main session inline when it already holds the needed context and the change is small. The main session audits scope, changed paths, and result either way. | No design, plan, ledger, Crossing, or independent review. |
| Compact | Standard: contained implementation with clear seams and focused tests | One short in-chat scope, exactly one leaf worker (`worker`) for investigate + implementation + self-verification, with optional independent verify only when risk-relevant. | No durable workflow files unless work must span sessions. |
| Full | Complex or Critical: cross-cutting design, difficult diagnosis, safety-sensitive, irreversible, public-contract, external-state, migration, or expensive-to-unwind work | Use explicit `/airlock:brainstorm`, `/airlock:plan`, `/airlock:ship`, `/airlock:review`, and `/airlock:debug` boundaries as applicable. Start at the Full-lite shape in `plan` unless scale demands more. | Design, plan, ledger, Crossings, and selected gates. |

Escalate one level only when you can name the specific irreversible or cross-cutting surface at risk, and state it in the classification line. If uncertainty is about approach rather than blast radius, dispatch a cheap `investigate` or scoped read-only `worker` pass instead of a heavier implementer. Unnamed uncertainty is not grounds for escalation. Security, credentials, destructive actions, migrations, production/live mutations, and irreversible work always use Full. A user override cannot remove a required safety confirmation.

Class work by named criteria: Light is one file or a mechanical, fully specified change with an obvious check; Standard is contained implementation with clear seams and tests, and is the default; Complex requires at least one of three modules touched, a shared interface other code depends on, or an unknown fix location at plan time; Critical requires an irreversible change, credentials/secrets/security boundary, a published contract others consume, or expensive unwind. If you cannot name which criterion is met, the class is Standard.

A Full classification on a host without a verified guard is `BLOCKED` per the **Host harness gate**. Never downgrade Full to Compact as a workaround; Full work done without the guard is not done under Airlock.

Publication means directly mutating what users consume, such as pushing a tag consumers auto-pull, publishing to a marketplace or registry, or deploying. The mutating step always requires an explicit DECISION approval, while the surrounding work classifies on its own merits. A release PR merged by the user is Compact by default: version bumps, changelog/README updates, validation, and opening the PR use the merge as the approval gate. After merge, tag or publish only behind a second DECISION. A release containing migrations, credential changes, or irreversible external state remains Full.

Dispatch budgets are guidelines: Quick uses 0-1 dispatch; Compact uses 1-2 (the `worker` plus optional independent verify); Full-lite uses at most 3 dispatches per Crossing; Full uses the approved specialist plan. Prefer `worker` over an investigate -> code-* -> verify chain unless investigation output is a user decision input, the work class is Critical, or a gate requires independence. Specialist leaves remain correct for Critical work and genuinely separable phases. Exceeding a count budget is allowed only after one PROGRESS line states the reason.

Dispatch weight budget, per Delivery Pack: at most one `code-critical` and at most two `code-complex` dispatches by default. Exceeding either limit requires one PROGRESS line naming the applicable work-class criterion. Weight budgets are separate from, and additional to, per-workflow dispatch-count budgets.

Session budgets are the default for every Airlock session, attended or unattended: at most 5 Crossings (override with `--max-crossings N`) and any declared wall-clock limit. On exhaustion, refresh STATUS and the ledger Resume checkpoint, summarize state and next action, and recommend a fresh session instead of continuing. Mega-sessions are opt-in, never the ambient failure mode.

For a multi-item feedback or bug list on Quick or Compact work, run the `review` triage classes in-chat before fixing anything: classify each item MUST_FIX, SHOULD_FIX, PARK, or OUT_OF_SCOPE, present the numbered batch for the user's confirmation, then fix in severity order. No ledger, rows, or repair packs — the triage lives only in chat.

For an unambiguous Quick task, the user's request is the scope contract. Execute immediately rather than creating process work. Prefer inline execution when the main session already has the relevant files in context and the change is small; the dispatch round-trip and a fresh worker's re-reading would cost more than they save. Otherwise dispatch exactly one of `code-light` or `code-standard`, or use `worker` when investigation is inseparable from the change; do not add investigator, reviewer, or verifier agents. The executor receives exact allowed paths when known, must preserve unrelated state, must stop before touching an unowned path, and must return changed paths plus actual validation. The main session may inspect and run a final deterministic check but may not delegate again.

## Delegation

Only this main session may delegate. Every worker is a leaf and must not invoke `Agent`, `Task`, another model, a workflow, or an external agent. Maximum delegation depth is one.

Use the configured non-Fable leaf for the work class. Never select, inherit, or override a leaf to Fable without asking the user immediately before that individual invocation. This approval is required for every Fable leaf, even when the main session uses Fable or the user approved an earlier Fable leaf. Record approval in the dispatch prompt. Do not treat selection of Fable for the main session as subagent approval.

When the host supports hooks, write an `airlock.contract/v2` dispatch contract to `.airlock/contract.json` before every dispatch, including read-only investigation, verification, browser, and review leaves. Set `root` to the absolute worker root; put product scope in `ownedPaths`, exact orchestrator bookkeeping scope in `processPaths`, a bounded ISO-8601 lifetime in `expiresAt`, and `allowDispatch: false` for every leaf. A read-only dispatch uses the minimal contract `ownedPaths: []` and `allowDispatch: false`. `actorMode` is `agent-id` by default. If this session has never observed an `agent_id`-bearing hook input, explicitly choose `single-actor`: worker rules apply to everyone and the guard fails closed if even the initiating dispatch cannot be distinguished. In that case, STOP and report the host incompatibility. While v2 is active, top-level calls may write only explicit `processPaths` and `.airlock/**`; worker calls may write only `ownedPaths` and can never write process paths or `.airlock/**`. The guard applies broad Git staging and obvious write checks to Bash and PowerShell. Delete the contract after the return audit. Serialize all file-writing workers while the session-global contract is active; read-only workers may run in parallel because their minimal contracts are identical.

If a required agent type or delegation capability is unavailable, STOP and report the outage. Delegation being unavailable never authorizes inline implementation.

Inline execution is allowed only for Quick work. Browser driving, git history surgery, and environment repair are implementation work during Compact or Full work: delegate them or STOP.

For `opencode`, apply the contract in `${CLAUDE_PLUGIN_ROOT}/references/EXTERNAL-RUNTIME.md` directly. For Quick work, derive the exact manifest scope from the user's request, use task-owned Quick identifiers where the strict schema requires pack or Crossing identifiers, and create no workflow artifacts. For Full work directly on OpenCode, call `airlock_guard_status` first and follow canonical Full commands only when it reports `fullCapable: true`; otherwise the Host harness gate blocks the task. The OpenCode external worker remains a leaf with `task` and interactive questions denied. External execution is never selected merely because it is configured: use it only after Airlock is explicitly started for the task.

## Unattended mode

`--unattended` activates unattended mode. Also activate it when `AskUserQuestion` is unavailable. Declare a max Crossings budget (default 5) and/or max wall-clock budget at start.

At every attended or unattended session start, read `docs/airlock/DECISIONS.md` first when it exists. For each open row whose Status contains `decision: <option>` (or whose mirrored PR thread has a clear numbered answer), set Status to `answered`, record the approval in the ledger as if it were interactive, and unblock the named package before routing new work.

When an ordinary DECISION arises unattended:

1. Create `docs/airlock/DECISIONS.md` from `references/DECISIONS.template.md` if absent, then append one row: `| ID | Asked | Question | Options (2-4) | Recommendation | Blocks | Status |` with `Status` set to `open`.
2. Mark the affected package `blocked-on-user` in `docs/airlock/STATUS.md`, including the decision ID and age.
3. When a Git remote review surface exists, mirror numbered options as a PR comment; the file remains the source of truth.
4. Continue with the next unblocked package. Stop only when no unblocked work remains or the budget is exhausted.

Hard stops are never auto-proceeded: design approval for new scope, anything in the always-Full safety list, merges to main, and the publication DECISION. Park them and end the affected lane; list them last in the run summary.

On budget exhaustion, refresh STATUS and the ledger Resume checkpoint, write the summary below, and exit cleanly. The last act of every unattended run is replacing `## Last unattended run` in STATUS with no more than five lines in this order: `Completed`, `Parked decisions (IDs)`, `Blocked`, `Budget used`, `Next action`.
## Artifacts and cleanup

For new Full work, use the canonical layout `docs/airlock/STATUS.md`, `docs/airlock/ledger/`, `docs/airlock/plans/`, `docs/airlock/specs/`, and `docs/airlock/archive/YYYY-MM/`. Read existing artifacts from legacy `docs/ledger/`, `docs/plans/`, and `docs/specs/` paths when present, but do not create new Full artifacts there.

The ledger Resume checkpoint is the machine resume state; `docs/airlock/STATUS.md` is the replace-in-place human view. Refresh STATUS at package acceptance, review-round close, pre-compaction, and unfinished session end. Never append status snapshots, and keep only the five newest rows under Recently closed.

Classify every non-product artifact or process created during Airlock work:


- **Retained evidence:** move file-based evidence to the project-configured evidence home under a stable exact path and reference it from the applicable ledger, Crossing, or gate row. If the destination is outside the actor's allowlist, return the exact source path for an orchestrator-owned move without widening scope.
- **Temporary:** record the exact task-owned path/process, then remove or stop it before return when ownership is certain and cleanup is safe.

Never broad-glob cleanup or delete unknown, pre-existing, user-owned, or another lane's artifacts. If ownership or safe cleanup is uncertain, leave the item in place, block cleanup, and report the exact item and decision needed. For Playwright/browser work, retain only required evidence and remove superseded task-created screenshots, downloads, traces, and logs; never clean credentials, browser profiles, cookies, localStorage, or other user state.

## Execute

Read answered decisions first. If `$ARGUMENTS` contains a task, classify and execute it now. If it contains only options or is empty, report Airlock active, resolved runtime, attended/unattended state, and the one-line syntax for submitting the task. Do not start another workflow merely to activate the mode.

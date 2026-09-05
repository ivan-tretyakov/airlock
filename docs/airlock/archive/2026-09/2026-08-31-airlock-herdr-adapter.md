# Airlock Herdr Adapter

Status: Specification — optional extension, not yet implemented

Date: 2026-08-31

Airlock stays a two-host tool. This specification defines an optional adapter that lets [Herdr](https://herdr.dev/) supply persistent worker panes for the existing `opencode` host. It changes no Airlock runtime behavior, adds no third host, and is inert on machines without Herdr. A fuller Herdr-native replacement engine was evaluated and rejected in favor of this adapter; that analysis lives outside this repository with its owner.

## Decision

Airlock remains authoritative for plan validation, dependency scheduling, route pinning, fallback policy, ownership auditing, task completion, blocking, commits, and recovery. Herdr provides persistent panes, native agents, workspaces, and observation.

```text
Airlock CLI and plan state: authority
          |
airlock.herdr adapter: dispatch and correlation only
          |
Herdr session/panes/agents: execution substrate
```

## Packaging and Optionality

- The adapter lives in this repository under `extensions/herdr/` when implemented. It is a Herdr plugin plus a small Node CLI; it is not a host, a hook, or part of either command shim.
- The host surface remains exactly the two shims (`commands/airlock.md`, `.opencode/command/airlock.md`) and the three role files. The adapter contributes nothing to the 5,000-byte prompt-surface ceiling and must not alter those files.
- The npm package `files` allowlist does not include `extensions/` or `docs/`; shipping the adapter in the published package is a separate release decision. Until then, users run it from a checkout via `herdr plugin link`.
- Absence of Herdr is not an error anywhere in Airlock. The adapter's own preflight fails closed when Herdr is missing or too old; no Airlock command ever probes for Herdr.

## Invariants

These rules bind every adapter code path. A change to any of them is a design change requiring a recorded decision, not a patch.

1. Airlock's plan file and router state are the only authoritative task and route records. Adapter state is non-authoritative correlation data.
2. No Herdr lifecycle state (`working`, `blocked`, `idle`, `done`, `unknown`), pane focus, prompt-wait return, or timeout may complete, audit, fail, or fall back a task. Signals only schedule reconciliation.
3. Every Herdr wait has an explicit timeout. No unbounded wait exists anywhere in the adapter.
4. The adapter never sends input to a blocked worker. Permission and question prompts are surfaced to the human.
5. Every Herdr call targets the named session and explicit resource IDs returned by earlier calls. Focus-based or omitted-target calls are prohibited.
6. The adapter never runs `git push`, `merge`, `rebase`, `reset`, `clean`, `stash`, branch deletion, or worktree removal. Airlock `done` performs the only commit.
7. Dispatch fails closed if the exact Airlock-generated agent file is absent.
8. The adapter never calls `airlock fallback` automatically. Fallback is human-classified in this adapter version.
9. The worker result nonce is best-effort corroboration. Git evidence plus human inspection is the authoritative completion path; a missing nonce is normal, not an error.
10. State writes are atomic (write temp file, `rename`). A crash between any two steps must be recoverable by `reconcile` from persisted state plus live Airlock/Herdr/Git inspection.

## Airlock Compatibility

Requires the Airlock 3.1.0 runtime. The CLI contract below is verified against `scripts/airlock.mjs` as of the Airlock 3.2 authoring-guidance merge (PR #10); the 3.1 → 3.2 change is documentation-only, so the contract holds for both.

Every plan the adapter dispatches follows the 3.2 authoring guidance in the README: default to `standard` risk; builder-run acceptance suffices when one command captures acceptance; one consolidated checker only when it cannot; per-task checkers reserved for `complex` and `critical`.

## Airlock CLI Contract

The adapter shells out to the globally installed `airlock` binary. All calls use `--json --host opencode` and, when a repository holds more than one plan, `--plan <absolute path>`. All commands run with `cwd` set to the product repository root.

### Output and exit conventions

- Success: exit 0, one pretty-printed JSON object on stdout.
- Failure with `--json`: exit code ≥ 1 and `{"error": "<message>"}` on **stdout** (not stderr).
- `next --unattended` with an open blocking decision: exit code 2, `{"error": "PARKED: <decision ids>"}`.
- All other failures: exit code 1.

Parse rule: read stdout, `JSON.parse`, then branch on the presence of an `error` key before anything else.

### `airlock next --host opencode --json [--unattended]`

Returns `{ text, task, route, agent }`.

- `task` is the selected task id (string) or `null`.
- When `task` is `null`, `text` begins `NOTHING TO DO` with one of: `All tasks are done.`, `BUDGET REACHED: maxTasks|maxExpensive.`, `Waiting on <decision ids>.`, `All remaining tasks are blocked.` Record and display; create no pane.
- When `task` is set, `text` is the **complete TASK brief** — the only place it is emitted. Retain it verbatim. Line grammar, in order:

```text
TASK <id> · <role> · <model> · <effort>
ROUTE <state> · <window name> · evaluated <ISO timestamp>
CLOCK OVERRIDE · AIRLOCK_NOW=<ts>          (only when AIRLOCK_NOW is set)
GOAL  <plan goal>
DO    <task title>[ (resume)]
OWNS  <first owned path>
      <additional owned paths, one per line>
DONE  <acceptance statement>
AGENT <exact generated agent name>
FALLBACK <n> <agent> · <model> · <effort>   (zero, one, or two lines)
ASSUME <decision id>  <question> = <assumed>   (zero or more)
EVIDENCE <dep id>  <evidence or "none">        (checker tasks only)
DIFF <dep id>                                  (checker tasks only)
<unified diff, truncated at 12000 characters per dependency>
RULES Change only OWNS paths. If you need another path, stop and report it.
      Return: changed paths + the command you ran + its result. Nothing else.
```

- `agent` is the exact generated agent name, e.g. `airlock-builder-<model-slug>-<effort>`.
- `route` object fields: `model`, `effort`, `route` (window name, `default` or a configured window such as `weekday-peak`), `evaluatedAt`, `expiresAt` (offered-pin expiry, ISO or null), `agent`, `candidateIndex`, `candidates` (ordered `[{model, effort, agent}]`), `failures`, `state`, `pinned`, `previewed`, `recovered`, `clockOverride`.
- The offered route is pinned for five minutes (`expiresAt`). Dispatch promptly; if `start` later reports a different `agent` than `next` offered, abort and reconcile.

### `airlock start <id> --host opencode --json`

Returns `{ text, task, route }`. `text` contains only `STARTED <id>[ (resume)]`, a `ROUTE` line, `AGENT`, and `FALLBACK` lines — **it does not contain the task brief**. The adapter must use the `text` retained from `next`.

`start` fails (exit 1) when: the task is not `todo`/`doing`; dependencies are unfinished; a blocking decision is open; another `doing` task exists with overlapping ownership (or any `doing` task without `--parallel`); or the product worktree is dirty outside the plan and `.airlock/` (clean-boundary check). Surface the `error` string verbatim and do not create a pane.

### `airlock status --host opencode --json`

Returns `{ text, plan, routes }`. `plan` is the full plan object (each task has `id`, `title`, `role`, `risk`, `owns`, `dependsOn`, `acceptance`, `status`, `evidence[]`, `note`, timestamps). `routes` holds route output for `doing` tasks. Use `plan.tasks[].status` as the authoritative task state during reconciliation.

### `airlock audit <id> --host opencode --json`

Success: `{ text, inScope: [paths], outOfScope: [], foreign: [paths], recovery: null }`. Failure (any out-of-scope change): exit 1 with `{"error": "<text including the OUT OF SCOPE list>"}`. The adapter must never pass `--revert-out-of-scope`; out-of-scope recovery is a human decision.

### `airlock done <id> --host opencode --evidence "<command + result>" --json`

Returns `{ text: "DONE <id> <commit>", task, commit }`. Commits exactly the owned changes plus the plan with an `Airlock-Task` trailer. On commit failure Airlock restores the task to `doing`; treat exit 1 as retryable after inspection.

### `airlock block <id> --host opencode --reason "<safe cause>" --json`

Returns `{ text: "BLOCKED <id>: <reason>", task }`. For a `doing` task, changed paths are preserved under `refs/airlock/blocked/...` and the ref appears in `task.note`.

### `airlock fallback <id> --host opencode --class <auth|rate-limit|timeout|transport|model-unavailable> --reason "<cause>" --json`

Human-invoked only (Invariant 8). Returns `{ text, task, route }` where `text` is `FALLBACK <id> · candidate <i>/<n>` followed by a **fresh complete TASK brief** (unlike `start`, fallback re-emits it). Airlock refuses when the worktree changed, the task is not `doing`, or the chain is exhausted.

### Environment

- Never set or inherit `CLAUDE_CODE_SUBAGENT_MODEL` (Airlock refuses dispatch under it on the claude host; keep the adapter environment clean regardless).
- `AIRLOCK_NOW=<ISO>` forces deterministic route selection for tests; its presence adds the `CLOCK OVERRIDE` line.

## Herdr Contract and Preflight

Target Herdr `>= 0.8.2`. Commands the adapter uses:

```bash
herdr agent start <name> --kind opencode --pane <pane-id> -- <native opencode arguments>
herdr agent prompt <name> "<prompt>" --wait --until idle --until done --until blocked --timeout <ms>
```

plus pane creation, pane output read, agent/pane status, and `pane process-info` where available.

Because Herdr is pre-1.0 and its CLI surface moves, implementation begins with a mandatory preflight (`src/herdr-client.mjs` exports `preflight()`):

- V1. Record `herdr --version`; refuse below 0.8.2. Refuse cleanly, with a "Herdr not installed" message, when the binary is absent.
- V2. Enumerate the exact subcommands and flags for: pane creation in a named session/workspace, bounded pane output read, agent start/prompt/status, plugin link/enable/disable. Capture `herdr help` output to `evidence/herdr-cli-<version>.txt`. If a required verb or flag is missing or renamed, fail closed with the observed help text — do not guess.
- V3. Confirm whether interactive OpenCode accepts a launch-time agent selector (`opencode --agent <name>` or equivalent) by inspecting `opencode --help`. Record the answer:
  - Present → dispatch Path A (native interactive agent) is legal.
  - Absent → dispatch uses Path B (headless) only.
- V4. Resolve and record the OpenCode launch path and, where a wrapper `exec`s a real binary, the post-`exec` foreground path. Approved paths are adapter configuration, never hardcoded. Never read or log provider credential files.
- V5. Confirm the exact Airlock-generated agent file exists for a given agent name at `~/.config/opencode/agents/<AGENT>.md`; on absence, fail with: `run: airlock config --sync --host opencode, then restart OpenCode`.

Herdr states remain advisory (Invariant 2): `working` = UI appears active; `blocked` = a known input prompt was recognized; `idle`/`done` = UI appears settled; `unknown` = nothing provable.

## Plugin Shape

```toml
id = "airlock.herdr"
name = "Airlock Herdr Adapter"
version = "0.1.0"
min_herdr_version = "0.8.2"
platforms = ["linux"]

[[actions]]
id = "dispatch"
title = "Dispatch next Airlock task"
command = ["node", "bin/airlock-herdr.mjs", "dispatch"]

[[actions]]
id = "reconcile"
title = "Reconcile Airlock task"
command = ["node", "bin/airlock-herdr.mjs", "reconcile"]

[[actions]]
id = "status"
title = "Show Airlock and Herdr status"
command = ["node", "bin/airlock-herdr.mjs", "status"]

[[panes]]
id = "status"
title = "Airlock status"
placement = "tab"
command = ["node", "bin/airlock-herdr.mjs", "watch"]
```

Herdr actions are asynchronous launches: `plugin action invoke` proves only that Herdr launched the command. Every action therefore writes an idempotent operation record (below) and exits with a meaningful status; final results are read via `status`/`watch`.

### Extension layout

```text
extensions/herdr/
  herdr-plugin.toml
  bin/airlock-herdr.mjs      argv parsing, subcommand routing
  src/airlock-client.mjs     spawn airlock, parse the JSON contract above
  src/herdr-client.mjs       preflight + herdr CLI calls, all with timeouts
  src/state.mjs              atomic correlation records + operations log
  src/dispatch.mjs           dispatch algorithm
  src/reconcile.mjs          reconciliation algorithm + decision table
  src/render.mjs             status/watch text output
  tests/                     node:test; disposable repos under $TMPDIR
  evidence/                  preflight captures, experiment logs
```

Node >= 20 (matching the package engine floor), ESM, zero runtime dependencies (`node:child_process` `execFileSync`/`spawnSync`, `node:fs`, `node:crypto`), matching Airlock's own style.

### Adapter CLI

```text
airlock-herdr <dispatch|reconcile|status|watch>
  --session <name>        required; the explicitly named Herdr session
  --repo <absolute path>  required; product repository root
  [--plan <absolute path>]
  [--task <id>]           reconcile: limit to one task
  [--state-dir <path>]    default: $HERDR_PLUGIN_STATE_DIR, else fail
  [--timeout-ms <n>]      prompt wait, default 900000
  [--json]
```

When run as a plugin action, `HERDR_PLUGIN_STATE_DIR` is provided by Herdr. Outside a plugin context the caller must pass `--state-dir` explicitly; the adapter must not invent a default under `$HOME`.

## Adapter State

Non-authoritative correlation data under `<state-dir>/<session>/<workflowKey>/`, where `workflowKey = sha256(repoRoot + "\n" + planPath).slice(0, 16)`.

```text
<state-dir>/<session>/<workflowKey>/
  tasks/<taskId>.json     one correlation record per task (latest attempt)
  operations.jsonl        append-only log: every adapter operation and outcome
```

`tasks/<taskId>.json`:

```json
{
  "recordVersion": 1,
  "workflowKey": "…",
  "repoRoot": "/abs/path",
  "planPath": "/abs/path/airlock.plan.json",
  "sessionName": "…",
  "taskId": "T001",
  "attempt": 1,
  "host": "opencode",
  "agent": "airlock-builder-…",
  "agentName": "al-t001-a1",
  "route": { "model": "…", "effort": "…", "window": "default", "candidateIndex": 0, "evaluatedAt": "ISO" },
  "taskText": "<full TASK brief retained verbatim from next or fallback>",
  "nonce": "uuid-v4",
  "workspaceId": null,
  "paneId": null,
  "dispatchPath": "A-interactive | B-headless",
  "state": "offered | started | pane-created | agent-started | prompted | needs-reconcile | settled | failed",
  "startedAt": "ISO",
  "promptDeliveredAt": null,
  "settledAt": null,
  "settledAs": null,
  "lastError": null
}
```

Rules:

- Writes are temp-file + `rename` (Invariant 10). `operations.jsonl` records `{ts, op, taskId, attempt, outcome, detail}` for every state change, herdr call, and airlock call.
- `state` is adapter progress only; `airlock status` is the authority on the task itself. Display-only metadata (risk, route, model) may be shown but never drives lifecycle.
- A new attempt (after human `fallback`) increments `attempt`, regenerates `agentName` (`al-<taskid lowercase>-a<attempt>`, unique, short) and `nonce`, and replaces the record; the prior record's content is preserved in `operations.jsonl`.

## Dispatch Algorithm

`dispatch --session S --repo R [--plan P]`:

1. Preflight V1–V2 (cached per adapter process). Resolve plan path; verify `S` exists or create it explicitly by name.
2. Refuse if any record under this workflowKey is in state `started`…`prompted` or `needs-reconcile`: print `RECONCILE REQUIRED <taskId>` and exit 3. One in-flight task per workflow in this version.
3. Run `airlock next`. On `error` → print and exit with airlock's code. On `task: null` → record the `NOTHING TO DO` text in `operations.jsonl`, print it, exit 0.
4. Persist a record in state `offered` holding `taskId`, `agent`, `route`, the verbatim `text` as `taskText`, and a fresh `nonce`.
5. Preflight V5 for `agent` (generated agent file exists). On failure: no `start` was issued; delete the offered record, print the remedy, exit 4.
6. Run `airlock start <taskId>`. On `error` → delete the offered record, print, exit with airlock's code. Verify `route.agent` in the start response equals the offered `agent`; on mismatch run `airlock block <taskId> --reason "route changed between next and start"`, set record `failed`, exit 5.
7. Update record to `started`.
8. Create a workspace/pane for the task in session `S` with `cwd = R` using explicit names (`al-<taskid>-a<attempt>`); persist returned `workspaceId`/`paneId`; state `pane-created`. (Exact pane verbs per preflight V2.)
9. Start the worker:
   - Path A (V3 confirmed): `herdr agent start <agentName> --kind opencode --pane <paneId> -- --agent <AGENT>` then verify via `pane process-info` (when available) that the foreground process is the approved OpenCode path; mismatch → `airlock block` with reason, state `failed`, preserve the pane.
   - Path B: run in the pane `opencode run --agent <AGENT> "<prompt>"` as an ordinary process; structured output plus exit code are the observation channel.
   State `agent-started`.
10. Assemble the prompt: `taskText` + `\n` + `REPORT End your reply with exactly one line: AIRLOCK-RESULT <nonce> ok|blocked <one-line summary>`. Path A: deliver via `herdr agent prompt <agentName> "<prompt>" --wait --until idle --until done --until blocked --timeout <timeout-ms>`. Path B: the prompt is the `run` argument in step 9.
11. On prompt-delivery success, state `prompted` with `promptDeliveredAt`. Whatever the wait returns — `idle`, `done`, `blocked`, timeout, or error — set state `needs-reconcile` and print `RECONCILE <taskId>` (Invariant 2: the wait result schedules reconciliation, nothing more).
12. On prompt-delivery failure (herdr error before any worker output): the worker never received the task. If `git status --porcelain` in `R` shows no product change, this is a candidate for human-classified `airlock fallback` (class `transport` or `timeout`); print that suggestion and set state `needs-reconcile`. Never call fallback automatically.

Crash recovery: every step transition is persisted before the step runs, so `reconcile` can resume from any interruption by comparing the recorded state with `airlock status`, live pane/agent state, and `git status`.

## Reconciliation Algorithm

`reconcile --session S --repo R [--task T]`:

1. Load records (all, or one with `--task`). Load `airlock status` (authoritative task states) and a fresh Herdr session snapshot by explicit IDs. Never trust replayed events without corroborating against this snapshot and live Git state.
2. For each record, collect: airlock task status; pane/agent existence and state; bounded pane output (last 200 lines / 16 KB, whichever is smaller); presence of `AIRLOCK-RESULT <nonce>` in that output; `git status --porcelain` for the product worktree.
3. Apply the decision table:

| Airlock status | Worker signal | Git state | Action |
| --- | --- | --- | --- |
| `doing` | `AIRLOCK-RESULT <nonce> ok …` present | changes present | Show bounded output and diff summary to the human; on their confirmation run `audit`; on pass, run `done` with the human-supplied or human-approved evidence string; state `settled`/`settledAs: done`. |
| `doing` | nonce `ok` | no changes | Suspicious: worker claimed success without edits. Surface for human decision (a read-only acceptance may legitimately pass); never auto-`done`. |
| `doing` | `AIRLOCK-RESULT <nonce> blocked …` | any | Run `airlock block <T> --reason "<worker summary, sanitized>"`; preserve pane and worktree; state `settled`/`settledAs: blocked`. |
| `doing` | no nonce; pane idle/done/exited | changes present | Normal case (workers often ignore report instructions). Treat as result-candidate: human inspects output + diff, then audit → done or block as above. |
| `doing` | no nonce; pane idle/exited | no changes | Worker produced nothing. Human decides: retry prompt once, `block`, or classify an infrastructure failure and run `airlock fallback` themselves; adapter prints the exact fallback command line. |
| `doing` | Herdr `blocked` (permission/question prompt) | any | Print the recognized prompt text; never answer it (Invariant 4). Human either resolves it in the pane or asks the adapter to `block` the task. |
| `doing` | pane/agent missing (server restart, kill) | any | Orphan: report `ORPHANED <T>`; keep the task `doing`; require explicit human choice between resuming (re-`start` is legal for a `doing` task and re-emits nothing — reuse retained `taskText`), `block`, or fallback. |
| `blocked`/`done` (airlock) | any | any | Airlock already settled it (e.g. a human acted directly). Sync the record to `settled` and close only adapter-created panes. |
| audit fails at any point | — | out-of-scope changes | Run `airlock block <T> --reason "audit failed: <paths>"`; preserve the pane and worktree; never `--revert-out-of-scope`; state `settled`/`settledAs: blocked`. |

4. Close adapter-created panes only after a terminal Airlock state for their task; retain correlation history in `operations.jsonl` indefinitely.
5. `status` renders: `airlock status` text, plus per-record `taskId · attempt · adapter state · pane state · nonce seen?`. `watch` re-renders on an interval (default 5 s) with bounded reads.

## Design Gaps and Dispositions

| Gap | Disposition in this version |
| --- | --- |
| Airlock has no Herdr pane/agent/session locator | Plugin-owned correlation records (specified above); acceptable because they are advisory |
| Airlock has no structured worker-result protocol | `AIRLOCK-RESULT <nonce>` line as best-effort corroboration; Git evidence + human inspection is authoritative (Invariant 9) |
| Airlock has no provider-failure signal | Fallback stays human-classified; the adapter prints the ready-to-run command |
| Airlock has no Herdr host | Use the existing `opencode` host; no `--host herdr`, no host abstraction |
| Herdr status is heuristic | States only trigger reconciliation; OpenCode workers only in this version |
| Interactive OpenCode may lack a launch-time agent flag | Preflight V3 decides Path A vs Path B before any dispatch code assumes either |
| UTC-window routing | Fully preserved for free: Airlock resolves windows before the adapter ever sees a route |

## Build Plan

The adapter is itself built through Airlock, per 3.2 authoring guidance: all tasks `builder`/`standard`, each with a one-command acceptance, therefore no checker tasks and no per-task review.

```json
{
  "goal": "Implement the airlock.herdr dispatch/reconcile adapter per docs/airlock/specs/2026-08-31-airlock-herdr-adapter.md",
  "done": ["node --test extensions/herdr/tests/ passes", "the disposable end-to-end experiment below completes"],
  "budget": { "maxTasks": 8, "maxExpensive": 0 },
  "tasks": [
    { "id": "H1", "role": "builder", "risk": "standard", "owns": ["extensions/herdr/src/state.mjs", "extensions/herdr/tests/state.test.mjs"], "dependsOn": [], "acceptance": "node --test extensions/herdr/tests/state.test.mjs passes: atomic rename writes, workflowKey derivation, attempt replacement preserves history in operations.jsonl" },
    { "id": "H2", "role": "builder", "risk": "standard", "owns": ["extensions/herdr/src/airlock-client.mjs", "extensions/herdr/tests/airlock-client.test.mjs"], "dependsOn": [], "acceptance": "node --test extensions/herdr/tests/airlock-client.test.mjs passes against a disposable git repo with a real airlock plan: next/start/status/audit/done/block parsed per the CLI contract, error-key branch, exit code 2 PARKED" },
    { "id": "H3", "role": "builder", "risk": "standard", "owns": ["extensions/herdr/src/herdr-client.mjs", "extensions/herdr/tests/herdr-client.test.mjs"], "dependsOn": [], "acceptance": "node --test extensions/herdr/tests/herdr-client.test.mjs passes: preflight V1-V5 against recorded help fixtures, every call constructor includes an explicit timeout, fail-closed on missing verbs and on absent herdr binary" },
    { "id": "H4", "role": "builder", "risk": "standard", "owns": ["extensions/herdr/src/dispatch.mjs", "extensions/herdr/bin/airlock-herdr.mjs", "extensions/herdr/herdr-plugin.toml", "extensions/herdr/tests/dispatch.test.mjs"], "dependsOn": ["H1", "H2", "H3"], "acceptance": "node --test extensions/herdr/tests/dispatch.test.mjs passes with a fake herdr client: steps 1-12 in order, refusal on in-flight record, offered-record cleanup on start failure, agent mismatch blocks, crash at each step boundary leaves a reconcilable record" },
    { "id": "H5", "role": "builder", "risk": "standard", "owns": ["extensions/herdr/src/reconcile.mjs", "extensions/herdr/src/render.mjs", "extensions/herdr/tests/reconcile.test.mjs"], "dependsOn": ["H1", "H2", "H3"], "acceptance": "node --test extensions/herdr/tests/reconcile.test.mjs passes: every decision-table row exercised, no path calls done without human confirmation input, no path answers a blocked prompt, orphan never redispatches" },
    { "id": "H6", "role": "builder", "risk": "standard", "owns": ["extensions/herdr/tests/e2e.test.mjs", "extensions/herdr/evidence/"], "dependsOn": ["H4", "H5"], "acceptance": "node --test extensions/herdr/tests/e2e.test.mjs passes: disposable repo + disposable named herdr session, one real dispatch-prompt-reconcile-done cycle and one blocked cycle, then safe teardown leaves no live pane; skips cleanly when herdr is not installed" }
  ]
}
```

Implementation notes:

- Test doubles: H4/H5 test against an injected fake herdr client; H2 tests against the real `airlock` binary in a `$TMPDIR` repo (init a plan with `airlock init`, add tasks by editing the plan JSON, use `AIRLOCK_NOW` for deterministic routes). Do not mock the airlock CLI — its contract is the point.
- The fake herdr client and the real one share one interface: `{ preflight(), ensureSession(name), createPane(session, workspaceName, cwd), agentStart(...), agentPrompt(...), readPane(paneId, limits), paneInfo(paneId), closePane(paneId) }` — every method takes and returns explicit IDs.
- Sanitize anything interpolated into `--reason`/`--evidence`: strip newlines, cap at 300 chars, never include URLs with tokens or pane output verbatim.
- Bound all reads; never stream unbounded pane scrollback into a prompt or log.
- Because Herdr is optional, every test except H6's live portion must pass on a machine without Herdr; H6 detects absence and skips its live cycle with an explicit skip message.

## Risks

- Same-user Herdr panes are not a security boundary. The adapter supplies operational discipline, not containment.
- Airlock `start` requires a clean product worktree; this version serializes to one in-flight task per workflow. Worktree-per-task is out of scope.
- OpenCode route agents are generated globally; after any route change run `airlock config --sync --host opencode` and restart OpenCode, or dispatch fails closed at preflight V5.
- Herdr server restarts can interrupt agents. Keep `[session] resume_agents_on_restore = false` during the experiment; before adopting that globally long-term, check whether the installed Herdr version supports a per-session or per-workspace override, since the global setting disables Herdr's headline persistence feature for every other session.
- `herdr plugin disable` is not safe shutdown: reconcile and settle every record first.
- Herdr's CLI is pre-1.0; preflight V2 exists because verbs and flags may differ from this document. The captured help output in `evidence/` is the ground truth for the installed version.

## Acceptance Experiment

Run one low-risk task in a disposable repository and an explicitly named Herdr session:

1. Confirm routes and generated agents: `airlock config --sync --host opencode`, restart OpenCode, verify `~/.config/opencode/agents/` contains the expected `airlock-builder-*` files.
2. Link the adapter plugin, disabled by default; run preflight standalone and commit its `evidence/` capture.
3. Create a disposable repo with a 2-task plan authored per 3.2 guidance (two `builder`/`standard` tasks, one-command acceptances, no checker).
4. `airlock-herdr dispatch` for the first task; verify the TASK brief reaches the exact generated agent in the pane (read the pane, compare against the retained `taskText`).
5. Let the worker finish; `airlock-herdr reconcile`; inspect output and diff; provide the evidence string; confirm `DONE <id> <commit>` and the `Airlock-Task` trailer on the commit.
6. Repeat for the second task but kill the pane mid-run: verify `ORPHANED` handling — task stays `doing`, no redispatch, human resolution works.
7. Force an audit failure (edit a non-owned file in the pane): verify `block` with preserved changes under `refs/airlock/blocked/...`.
8. Safe teardown: reconcile all records, close adapter panes, `herdr plugin disable airlock.herdr`, verify no live plugin-owned process.

Success: Airlock's plan state and Git audit/commit semantics complete unchanged while Herdr supplies the worker pane; every decision-table row hit during the experiment behaved as specified. Any invariant violation is an experiment failure to record, not something to patch around silently.

## Evidence

- CLI contract verified against `scripts/airlock.mjs` at the PR #10 merge: output/exit handling (`output()`, `main().catch`), the `next`/`start`/`audit`/`done`/`block`/`fallback` handlers, `taskText` line grammar, `dispatchLines`, `routeOutput`, the five-minute offered pin, and the `CLAUDE_CODE_SUBAGENT_MODEL` refusal.
- Authoring guidance: `README.md` "Authoring tasks" and `PROJECT-CONVENTIONS.template.md`.
- Herdr plugin/action/agent APIs: <https://herdr.dev/docs/plugins/>, <https://herdr.dev/docs/agent-automation/>, <https://herdr.dev/docs/socket-api/> — subject to preflight V2 verification per installed version.

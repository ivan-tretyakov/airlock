# airlock

Airlock is plan-driven multimodel task orchestration with headless executor dispatch. One plan file gives each worker a goal, owned paths, an acceptance criterion, a role, and durable state. The coordinator validates the plan before dispatch rather than attempting to predict individual tool calls, and every accepted task lands as one audited commit with an `Airlock-Task` trailer and evidence.

## Quick Start

Install the CLI globally from the release tag:

```text
npm install --global github:ivan-tretyakov/airlock#v5.0.0
```

For local development, run `npm link` in a checkout.

Write `~/.airlock/routing.json` with one slot per role and tier (see [Running](#running)). Then create one delivery plan in a worktree of the repository:

```text
airlock init "Add an export command" --done "npm test passes|the command writes a valid export"
```

Add tasks to the plan, then run `airlock run`. The runner loops through runnable tasks, dispatches each one to its routed executor CLI, audits changed paths, commits each accepted task, and stops when no task remains runnable. From a Claude Code session with the plugin installed, `/airlock` drives the same loop.

## Plan File

`airlock.plan.json` is the only authored workflow artifact (`schema: "airlock.plan/v4"`). It holds the goal, testable done criteria, task contracts, decisions, evidence, and lifecycle state. `init` keeps it at `.airlock/plan.json`, excluded from git per clone through `.git/info/exclude`, so it never lands in a merge request and disappears with the worktree; the legacy locations, the repository root and `docs/airlock/`, keep working for a committed plan.

Each task requires an id, role (`builder`, `checker`, or `browser`), at least one repository-relative `owns` path/glob, dependencies, and one testable `acceptance` statement. A task is never dispatched without both ownership and acceptance. A task may declare `expensive: true`; absent or `expensive: false` means not expensive, and any non-boolean value is rejected. `budget.maxExpensive` caps how many expensive tasks may run or complete. Tasks never carry a `risk` or `model` field: `risk` was removed in v4, and model choice belongs to the routing file.

### Authoring tasks

Mark a task `expensive: true` only for irreversible, security-sensitive, or migration work; `budget.maxExpensive` caps it deliberately. Builder-run acceptance is sufficient for tasks whose acceptance one command captures: the builder runs it and `done --evidence` records the result. When acceptance cannot be captured in one command, prefer one consolidated checker near the end of the plan that `dependsOn` every builder task it verifies; Airlock supplies the checker with each dependency's scoped diff and evidence. Reserve per-task checkers for `expensive` tasks. A request that is one task with one obvious verification command does not need a plan at all; use Airlock when delivery spans multiple tasks with distinct ownership. Decide the review budget per pull request before authoring tasks — one plan is one pull request — and pass it as `--review-lines` so `done` and `status` report against it. When the work is larger than one review, author a numbered plan series (`Export: 1 of 3`, `Export: 2 of 3`, and so on), each with its own testable `--done` criteria; tasks that cannot be split safely, such as a migration and the code that depends on it, stay in the same plan. Every plan in a series must leave the base branch green on its own, so decide feature flags or backward-compatible schema steps during design, before the first plan is written. The review budget is advisory: when it is exceeded, stop adding tasks, open the pull request, and start the next plan, because Airlock never tracks whether the pull request was reviewed or merged.

## Workflows

### Below the threshold

One task with one obvious verification command needs no plan: just do the work and run the command. Airlock's own guidance applies to itself — use it only when delivery spans multiple tasks with distinct ownership.

### A well-understood multi-task feature

Resolve the open design questions first (an interrogation skill such as Matt Pocock's `/grill-me` works well), then `airlock init` with testable `--done` criteria and author tasks whose `acceptance` lines come from the resolved questions. Run `airlock run`. An export-feature plan typically looks like two builders plus one consolidated checker that `dependsOn` both:

```json
{
  "schema": "airlock.plan/v4",
  "goal": "Users can export a report as CSV from the CLI",
  "done": ["npm test passes", "npx report export --format csv writes a valid file"],
  "nonGoals": ["PDF export"],
  "created": "2026-09-01T09:00:00.000Z",
  "budget": { "maxTasks": 6, "maxExpensive": 1 },
  "tasks": [
    {
      "id": "T1",
      "title": "Implement the CSV serializer",
      "role": "builder",
      "owns": ["src/export/csv.js", "test/export/csv.test.js"],
      "dependsOn": [],
      "acceptance": "node --test test/export/csv.test.js passes",
      "status": "todo",
      "evidence": [],
      "startedAt": null,
      "finishedAt": null,
      "note": null
    },
    {
      "id": "T2",
      "title": "Wire the export command to the serializer",
      "role": "builder",
      "owns": ["src/cli/export.js", "test/cli/export.test.js"],
      "dependsOn": [],
      "acceptance": "node --test test/cli/export.test.js passes",
      "status": "todo",
      "evidence": [],
      "startedAt": null,
      "finishedAt": null,
      "note": null
    },
    {
      "id": "T3",
      "title": "Verify the export feature end to end",
      "role": "checker",
      "owns": ["docs/export-verification.md"],
      "dependsOn": ["T1", "T2"],
      "acceptance": "npx report export --format csv produces a file that npm test accepts",
      "status": "todo",
      "evidence": [],
      "startedAt": null,
      "finishedAt": null,
      "note": null
    }
  ],
  "decisions": []
}
```

### Ambiguous multi-week work

Keep a decision map upstream of Airlock — Wayfinder, or a plain markdown decision log. Convert each fog-free region of the map into one Airlock plan, execute it with `airlock run`, then note the resulting `Airlock-Task` commits back on the map. Airlock deliberately owns only the execution slice; it is not a discovery or roadmap tool.

### Work that is too large for one pull request

One plan is one pull request, so a delivery that no reviewer can read in one sitting becomes a numbered plan series. Size the review budget first, pass it to each plan as `--review-lines`, and author only as many tasks as that budget covers; `done` prints `REVIEW <used>/<budget> lines` on stderr and `status` shows the same line, with `(exceeded)` once the accumulated diff passes the budget. The advisory never blocks: when it fires, stop adding tasks, open the pull request, and let the human merge be the boundary before the next plan starts on a fresh branch. Every plan must leave the base branch green on its own, so feature flags or backward-compatible schema steps are design decisions made before the first plan is written.

```text
airlock init "Export: 1 of 3 — CSV serializer"     --done "node --test test/export/csv.test.js passes" --review-lines 600
airlock init "Export: 2 of 3 — CLI export command" --done "npx report export --format csv writes a valid file" --review-lines 600
airlock init "Export: 3 of 3 — docs and telemetry" --done "npm test passes" --review-lines 400
```

### Intake routing

Bugs and questions are not plan items. File bugs in the issue tracker with the exact repro command — that text later becomes an `acceptance` line when the fix is planned. Codebase questions are just conversation. Questions that arise mid-run are `airlock ask --assume <default>` (or `--blocking --case <case>` for the five allowed cases). Design unknowns that exist before any plan does belong in the upstream decision map, not in the plan file.

## Commands

Coordinator verbs: `next`, `start`, `run`, `done`, `block`, `ask`, `answer`, `status`, `audit`.

Utilities: `init`, `render`. `init` takes `--done "a|b"`, `--max-tasks`, `--max-expensive`, and the advisory `--review-lines`; it writes the plan to `.airlock/plan.json` (adding `.airlock/` to `.git/info/exclude`) unless `--plan` says otherwise, and the plan joins a task commit only when git already tracks it. `render --md` prints the plan as a markdown table with the role column.

All commands support `--json`; use `--plan <path>` when a repository has more than one delivery plan. Unknown flags are rejected on every verb.

`next` and `start` print the task brief with its `AGENT airlock-<role>` line naming the role; the runner reads the role body from `roles/` directly. `start` requires a clean product worktree, excluding Airlock's own plan and `.airlock/` configuration. After `audit` succeeds, `done --evidence "<command + result>"` commits the exact owned changes — plus the plan when git already tracks it — with an `Airlock-Task` trailer. A checker whose audit finds no in-scope changes completes through an empty commit carrying the same trailers. A failed commit restores the task to `doing` so it can be retried.

Blocked task deltas and `audit --revert-out-of-scope` recoveries are retained under `refs/airlock/blocked/...` and `refs/airlock/reverted/...`; they are never deleted. Recover with `git stash apply <reported-ref>`; inspect untracked recovery files through `<reported-ref>^3`.

## Running

`airlock run` is the only dispatch path. It executes the next runnable task end to end: it resolves the worker from routing, spawns the executor CLI headless with the role body plus the task brief as its prompt, waits for exit, parses one `EVIDENCE:` line from the worker's final message, then runs `audit` and `done --evidence` on `PASS` or `block --reason` on `FAIL`. One invocation runs one task so a driving session can steer between tasks; `--all` loops until nothing is runnable, one worker at a time. `--dry-run` prints the resolved executor command line and prompt length without launching anything. `run` stops with the same texts and exit codes the other verbs produce: `PARKED` (exit 2), `NOTHING TO DO`, `BUDGET REACHED`.

### Routing

Routing lives in `~/.airlock/routing.json` (override with `--routing <path>`), schema version 1: `bindings.<role>.<tier>` for each role (`builder`, `checker`, `browser`) and tier (`default`, `expensive` — `expensive` when the task says `expensive: true`), each slot exactly `{ "executor": "claude" | "codex" | "opencode", "model": "...", "effort": "..." }` with `effort` optional. Optional top-level `timeoutMinutes` defaults to 30. Unknown keys anywhere are rejected, and a missing slot for the selected role and tier fails closed with the JSON path named. Changing a model is a one-line edit.

The initial routing table this project was built around:

| role | default | expensive |
|---|---|---|
| builder | opencode · zai-coding-plan/glm-5.3 · high | claude · opus · high |
| checker | codex · gpt-5.6-sol · medium | codex · gpt-5.6-sol · high |
| browser | codex · gpt-5.6-sol · medium | claude · opus · high |

Executors run with the repository root as their working directory, the prompt on stdin, and the inherited environment minus `CLAUDE_CODE_SUBAGENT_MODEL`: `claude --print --model <m> [--effort <e>] --permission-mode bypassPermissions`, `codex exec -m <m> [-c model_reasoning_effort=<e>] --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --output-last-message <file>`, `opencode run -m <m> [--variant <e>] --auto`.

### The EVIDENCE contract

The last non-empty line of a worker's final message must read `EVIDENCE: PASS <command and result>` or `EVIDENCE: FAIL <reason or findings path>`. The three role bodies in `roles/` state the contract — they are the single source of role text, read by the runner with their frontmatter stripped — and the runner enforces it: `PASS` leads to `audit` then `done` with the worker's text as the commit's evidence; `FAIL` blocks the task with the reason. A worker whose final line matches neither blocks with `worker returned no EVIDENCE line`.

### Failure policy

Any executor failure — non-zero exit, missing binary, or timeout — blocks the task with the cause and stops the run, in single and `--all` mode alike. Nothing retries and nothing falls back: the most likely runtime failure is a rate limit on one vendor, and the operator is meant to edit one routing slot and rerun rather than let the runner silently drain a second subscription. An out-of-scope worker change blocks with the audit text, exactly as a hand-driven `audit` would refuse it.

### Driving a run from a model session

Open a terminal in a git worktree of the repository, run `airlock run`, read the one line it prints (`RAN <id> DONE <commit>` or `RAN <id> BLOCKED <reason>`), and rerun. Between tasks you can edit the plan, answer decisions, or fix a routing slot; the session's own context stays clean because every task runs in a fresh executor process that sees only its brief. Use `--all` for a proven plan you want to finish unattended, and plain single-task invocations while a plan is still taking shape. In a Claude Code session the bundled `/airlock` command drives the same loop through the plugin and never dispatches a subagent.

## Decisions

Airlock runs until truly blocked. `airlock ask` defaults to `--assume <option>`: it records a recommendation, lets work continue, and tracks tasks that consumed the assumption. Only irreversible work, external commitments, missing access, expensive balanced rework, or an untestable goal may use `--blocking --case <case>`.

At `NOTHING TO DO`, the driving session presents all open blocking decisions and assumptions once. If an answer overturns an assumption, `answer` atomically reopens every consuming task and reports `REWORK REQUIRED`.

## Validation

```text
npm test
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

The automated tests cover schema invariants, the v3 to v4 upgrade, lifecycle transitions, assumption rework, Git audits including shell-created writes, budget caps via `expensive`, the advisory review budget (`--review-lines`, recorded `diffLines`, the `REVIEW` advisory on `done` and `status`), routing validation and the runner cycle against fake executors, and the 5,000-byte prompt-surface ceiling.

`--unattended` forwards to `next`; a blocking decision returns `PARKED` and ends the run without prompting. `maxExpensive` caps tasks declared `expensive: true`. Parallel writers require `--parallel` and disjoint ownership; overlapping or ambiguous glob prefixes remain serialized.

## Migration

### Upgrading from 4.x

5.0.0 is a breaking release: dispatch moved entirely to `airlock run` and everything that served session-side dispatch is gone. Read `docs/airlock/releases/5.0.0.md` for the full migration and a machine-cleanup checklist. In short: install the CLI globally from the `v5.0.0` tag, write `~/.airlock/routing.json`, and drive plans with `airlock run`; the old bootstrap flag on `init` is now rejected as an unknown flag, and per-role model choice moves from agent files to the routing file.

### Upgrading from 3.x

Plans upgrade automatically: `readPlan` accepts `airlock.plan/v3`, maps `risk: "critical"` to `expensive: true` and drops the other risk levels, and the first state-mutating command (`start`, `done`, `block`, `ask`, `answer`) persists the v4 form. Read-only commands (`next`, `status`, `audit`, `render`) print an `UPGRADED` notice on stderr each run and leave the file at v3.

The 3.x routing artifacts are obsolete and ignored; you may delete them by hand: user and project `models.json`, `router-state.json`, and generated `airlock-<role>-<model>-<effort>` agents in your user-level agent directories. Per-role model preferences move into the routing file. The optional pane router extension shipped in 4.x was removed in 5.0; its design documents are archived under `docs/airlock/archive/2026-09/`.

### From 2.x

The `import` command was removed. Run a 3.x release once to import a 2.x ledger, or author the v4 plan by hand.

## License

Apache-2.0. See `LICENSE`.

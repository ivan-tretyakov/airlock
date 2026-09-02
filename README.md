# airlock

Airlock is plan-driven task orchestration for Claude Code and OpenCode. One `airlock.plan.json` gives each worker a goal, owned paths, acceptance criterion, role, and durable state. The coordinator validates that plan before dispatch rather than attempting to predict individual tool calls, and every accepted task lands as one audited commit with an `Airlock-Task` trailer and evidence.

## Quick Start

Create one delivery plan at the repository root:

```text
airlock init "Add an export command" --done "npm test passes|the command writes a valid export"
```

Add tasks to `airlock.plan.json`, then invoke `/airlock` on either host. The command loops through runnable tasks, dispatches each one to its static `AGENT airlock-<role>` from `airlock next`, audits changed paths, commits each accepted task, and stops only when no task remains runnable.

## Plan File

`airlock.plan.json` is the only authored workflow artifact (`schema: "airlock.plan/v4"`). It holds the goal, testable done criteria, task contracts, decisions, evidence, and lifecycle state. Store it at the repository root or under `docs/airlock/`.

Each task requires an id, role (`builder`, `checker`, or `browser`), at least one repository-relative `owns` path/glob, dependencies, and one testable `acceptance` statement. A task is never dispatched without both ownership and acceptance. A task may declare `expensive: true`; absent or `expensive: false` means not expensive, and any non-boolean value is rejected. `budget.maxExpensive` caps how many expensive tasks may run or complete. Tasks never carry a `risk` or `model` field: `risk` was removed in v4, and model choice belongs to the host agent files.

### Authoring tasks

Mark a task `expensive: true` only for irreversible, security-sensitive, or migration work; `budget.maxExpensive` caps it deliberately. Builder-run acceptance is sufficient for tasks whose acceptance one command captures: the builder runs it and `done --evidence` records the result. When acceptance cannot be captured in one command, prefer one consolidated checker near the end of the plan that `dependsOn` every builder task it verifies; Airlock supplies the checker with each dependency's scoped diff and evidence. Reserve per-task checkers for `expensive` tasks. A request that is one task with one obvious verification command does not need a plan at all; use Airlock when delivery spans multiple tasks with distinct ownership. Decide the review budget per pull request before authoring tasks — one plan is one pull request — and pass it as `--review-lines` so `done` and `status` report against it. When the work is larger than one review, author a numbered plan series (`Export: 1 of 3`, `Export: 2 of 3`, and so on), each with its own testable `--done` criteria; tasks that cannot be split safely, such as a migration and the code that depends on it, stay in the same plan. Every plan in a series must leave the base branch green on its own, so decide feature flags or backward-compatible schema steps during design, before the first plan is written. The review budget is advisory: when it is exceeded, stop adding tasks, open the pull request, and start the next plan, because Airlock never tracks whether the pull request was reviewed or merged.

## Workflows

### Below the threshold

One task with one obvious verification command needs no plan: just do the work and run the command. Airlock's own guidance applies to itself — use it only when delivery spans multiple tasks with distinct ownership.

### A well-understood multi-task feature

Resolve the open design questions first (an interrogation skill such as Matt Pocock's `/grill-me` works well), then `airlock init` with testable `--done` criteria and author tasks whose `acceptance` lines come from the resolved questions. Run `/airlock`. An export-feature plan typically looks like two builders plus one consolidated checker that `dependsOn` both:

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

Keep a decision map upstream of Airlock — Wayfinder, or a plain markdown decision log. Convert each fog-free region of the map into one Airlock plan, execute it with `/airlock`, then note the resulting `Airlock-Task` commits back on the map. Airlock deliberately owns only the execution slice; it is not a discovery or roadmap tool.

### Work that is too large for one pull request

One plan is one pull request, so a delivery that no reviewer can read in one sitting becomes a numbered plan series. Size the review budget first, pass it to each plan as `--review-lines`, and author only as many tasks as that budget covers; `done` prints `REVIEW <used>/<budget> lines` on stderr and `status` shows the same line, with `(exceeded)` once the accumulated diff passes the budget. The advisory never blocks: when it fires, stop adding tasks, open the pull request, and let the human merge be the boundary before the next plan starts on a fresh branch. Every plan must leave the base branch green on its own, so feature flags or backward-compatible schema steps are design decisions made before the first plan is written.

```text
airlock init "Export: 1 of 3 — CSV serializer"     --done "node --test test/export/csv.test.js passes" --review-lines 600
airlock init "Export: 2 of 3 — CLI export command" --done "npx report export --format csv writes a valid file" --review-lines 600
airlock init "Export: 3 of 3 — docs and telemetry" --done "npm test passes" --review-lines 400
```

### Intake routing

Bugs and questions are not plan items. File bugs in the issue tracker with the exact repro command — that text later becomes an `acceptance` line when the fix is planned. Codebase questions are just conversation. Questions that arise mid-run are `airlock ask --assume <default>` (or `--blocking --case <case>` for the five allowed cases). Design unknowns that exist before any plan does belong in the upstream decision map, not in `airlock.plan.json`.

## Commands

Coordinator verbs: `next`, `start`, `done`, `block`, `ask`, `answer`, `status`, `audit`.

Utilities: `init`, `render`. `init` takes `--done "a|b"`, `--max-tasks`, `--max-expensive`, and the advisory `--review-lines`.

All commands support `--json`; use `--plan <path>` when a repository has more than one delivery plan. `--host claude|opencode` is meaningful only on `init` (it selects the OpenCode bootstrap); on every other command it is accepted and ignored as a deprecated no-op, and the `AIRLOCK_HOST` environment variable is no longer read.

`next` and `start` print the task brief with a static `AGENT airlock-<role>` dispatch line. `start` requires a clean product worktree, excluding Airlock's own plan and `.airlock/` configuration. After `audit` succeeds, `done --evidence "<command + result>"` commits the exact owned changes and the plan state with an `Airlock-Task` trailer. A failed commit restores the task to `doing` so it can be retried. When a dispatch fails, the shim runs `block <id> --reason "<cause>"`.

Blocked task deltas and `audit --revert-out-of-scope` recoveries are retained under `refs/airlock/blocked/...` and `refs/airlock/reverted/...`; they are never deleted. Recover with `git stash apply <reported-ref>`; inspect untracked recovery files through `<reported-ref>^3`.

## Decisions

Airlock runs until truly blocked. `airlock ask` defaults to `--assume <option>`: it records a recommendation, lets work continue, and tracks tasks that consumed the assumption. Only irreversible work, external commitments, missing access, expensive balanced rework, or an untestable goal may use `--blocking --case <case>`.

At `NOTHING TO DO`, `/airlock` presents all open blocking decisions and assumptions once. If an answer overturns an assumption, `answer` atomically reopens every consuming task and reports `REWORK REQUIRED`.

## Hosts

Dispatch is static: `next`/`start` emit `AGENT airlock-<role>`, and the three role agents in `roles/` are the single source of role bodies and tools for both hosts. Airlock no longer mediates model choice; host-native fallback handles model failures.

**Claude Code** bundles the role agents through the plugin (`airlock-builder`, `airlock-checker`, `airlock-browser`); they inherit the session's model. To pin a model per role, create a same-named override agent — project `.claude/agents/airlock-<role>.md` or user `~/.claude/agents/airlock-<role>.md` — with the same `name:` and a `model:` line; the host resolves the override in preference to the plugin copy.

The Claude shim invokes its bundled CLI through `${CLAUDE_PLUGIN_ROOT}`. Install the OpenCode CLI globally from the release tag:

```text
npm install --global github:ivan-tretyakov/airlock#v4.0.1
```

For local development, run `npm link` in this checkout.

**OpenCode** projects bootstrap with:

```text
airlock init "Add an export command" --done "npm test passes" --host opencode
```

This writes the `/airlock` command under `.opencode/command/` and three agent files under `.opencode/agent/` (`airlock-builder.md`, `airlock-checker.md`, `airlock-browser.md`), generated from `roles/`. Edit those project-local agent files to set a model; they are hash-guarded, so re-running init preserves your edits, refreshes unmodified packaged files, and fails with a manual-merge instruction rather than overwriting a customized stale command shim.

The host surface is one command each: `commands/airlock.md` and `.opencode/command/airlock.md`. There are no hooks, guard plugins, external launchers, ledgers, or lifecycle templates.

## Extensions

Extensions are optional adapters that use the Airlock CLI without changing hosts or the prompt surface. One extension is available: a [Herdr](https://herdr.dev/) adapter that dispatches the `opencode` host's tasks into persistent Herdr panes. The Herdr adapter targets the 3.x CLI surface and requires Airlock 3.x (`v3.1.x` tag); it has not been ported to 4.0. See `docs/airlock/specs/2026-08-31-airlock-herdr-adapter.md` and `extensions/herdr/`.

## Validation

```text
npm test
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

The automated tests cover schema invariants, the v3 to v4 upgrade, lifecycle transitions, assumption rework, Git audits including shell-created writes, budget caps via `expensive`, the advisory review budget (`--review-lines`, recorded `diffLines`, the `REVIEW` advisory on `done` and `status`), and the 5,000-byte prompt-surface ceiling.

`--unattended` forwards to `next`; a blocking decision returns `PARKED` and ends the run without prompting. `maxExpensive` caps tasks declared `expensive: true`. Parallel writers require `--parallel` and disjoint ownership; overlapping or ambiguous glob prefixes remain serialized.

## Migration

### Upgrading from 3.x

Plans upgrade automatically: `readPlan` accepts `airlock.plan/v3`, maps `risk: "critical"` to `expensive: true` and drops the other risk levels, and the first state-mutating command (`start`, `done`, `block`, `ask`, `answer`) persists the v4 form. Read-only commands (`next`, `status`, `audit`, `render`) print an `UPGRADED` notice on stderr each run and leave the file at v3.

The 3.x routing artifacts are obsolete and ignored; you may delete them by hand: user and project `models.json`, `router-state.json`, and generated `airlock-<role>-<model>-<effort>` agents in `~/.claude/agents/` and the OpenCode user config directory. Per-role model preferences move into host agent files: edit `.opencode/agent/airlock-<role>.md` on OpenCode, or create a Claude override agent as described in Hosts.

The Herdr adapter requires Airlock 3.x (`v3.1.x` tag).

### From 2.x

The `import` command was removed. Run a 3.x release once to import a 2.x ledger, or author the v4 plan by hand.

## License

Apache-2.0. See `LICENSE`.

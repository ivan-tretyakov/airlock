# airlock

Airlock is plan-driven task orchestration for Claude Code and OpenCode. One `airlock.plan.json` gives each worker a goal, owned paths, acceptance criterion, role, risk, and durable state. The coordinator validates that plan before dispatch rather than attempting to predict individual tool calls.

## Quick Start

Create one delivery plan at the repository root:

```text
airlock init "Add an export command" --done "npm test passes|the command writes a valid export"
```

Add tasks to `airlock.plan.json`, then invoke `/airlock` on either host. The command loops through runnable tasks, dispatches the role/model from `airlock next`, audits changed paths, commits each accepted task, and stops only when no task remains runnable.

## Plan File

`airlock.plan.json` is the only authored workflow artifact. It holds the goal, testable done criteria, task contracts, decisions, evidence, and lifecycle state. Store it at the repository root or under `docs/airlock/`.

Each task requires an id, role (`builder`, `checker`, or `browser`), risk, at least one repository-relative `owns` path/glob, dependencies, and one testable `acceptance` statement. A task is never dispatched without both ownership and acceptance.

### Authoring tasks

Verification is proportional to risk. Default to `standard` when authoring a task; use `complex` only for cross-cutting or architectural work, and reserve `critical` for irreversible, security-sensitive, or migration work — `budget.maxExpensive` caps it deliberately. Builder-run acceptance is sufficient for `light` and `standard` tasks whose acceptance one command captures: the builder runs it and `done --evidence` records the result. When acceptance cannot be captured in one command, prefer one consolidated checker near the end of the plan that `dependsOn` every builder task it verifies; Airlock supplies the checker with each dependency's scoped diff and evidence. Reserve per-task checkers for `complex` and `critical` tasks. A request that is one task with one obvious verification command does not need a plan at all; use Airlock when delivery spans multiple tasks with distinct ownership.

Models and effort resolve from local role/risk routing. They are never stored in the plan or repository. A route can be static, use non-overlapping UTC windows, and carry an ordered fallback chain. Airlock resolves and pins the complete route before dispatch. Claude and OpenCode mappings are independent. Configure the routing before dispatching work:

```text
airlock config --host claude --role browser --risk light --model sonnet --effort low
```

The command writes user-local configuration by default. Add `--project` to write an override under the repository's Git common directory (`.git/airlock/models.json`), which is never a tracked worktree file. Project routes override user routes. A missing or ambiguous route fails with the exact host/role/risk combination; there are no bundled provider defaults. Run `airlock config --sync --host claude|opencode` after editing local routes to create the required agents. OpenCode mappings declare each model's legal variants under `catalog.opencode`; an unknown provider-specific effort fails closed instead of silently using a default. Discover a model's legal names with `opencode models <provider> --verbose`.

`next` pins an offered route for five minutes so the normal `next` to `start` loop is stable without holding a stale time-window route indefinitely. `status` shows the live offered pin; after expiry, both commands preview or select the current route. A doing task keeps its time-selected chain until `done` or `block`, including across schedule boundaries. When `AIRLOCK_NOW` is used for deterministic testing, route output includes an explicit `CLOCK OVERRIDE` marker.

Fallbacks require configuration version 3 and are complete per binding: a window does not inherit its default route's fallbacks. A binding may have at most two fallbacks, and Airlock tries none automatically. When a host dispatch errors before returning any child result, `airlock fallback <task-id> --host <host> --class <class> --reason "<cause>"` advances once and emits a fresh TASK block. Class must be `auth`, `rate-limit`, `timeout`, `transport`, or `model-unavailable`; it is retained with the local failure record. Airlock refuses changed worktrees, non-doing tasks, and exhausted chains.

```json
{
  "version": 3,
  "opencode": {
    "builder": {
      "standard": {
        "model": "provider/default-model",
        "effort": "low",
        "fallbacks": [
          { "model": "provider/fallback-model", "effort": "low" }
        ],
        "windows": [
          {
            "name": "weekday-peak",
            "days": ["mon", "tue", "wed", "thu", "fri"],
            "utc": "06:00-10:00",
            "model": "provider/peak-model",
            "effort": "low",
            "fallbacks": [
              { "model": "provider/fallback-model", "effort": "low" }
            ]
          }
        ]
      }
    }
  }
}
```

## Commands

Coordinator verbs: `next`, `start`, `fallback`, `done`, `block`, `ask`, `status`, `audit`.

Utilities: `init`, `answer`, `render`, `import`.

All commands support `--json`; use `--plan <path>` when a repository has more than one delivery plan, and `--host claude|opencode` when resolving models outside a host shim.

`start` requires a clean product worktree, excluding Airlock's own plan and `.airlock/` configuration. After `audit` succeeds, `done --evidence "<command + result>"` commits the exact owned changes and the plan state with an `Airlock-Task` trailer. A failed commit restores the task to `doing` so it can be retried. A successful commit moves its route and fallback history into the local router state's `completed` map, keyed by task, commit, and host; model assignments remain outside the repository.

Blocked task deltas and `audit --revert-out-of-scope` recoveries are retained under `refs/airlock/blocked/...` and `refs/airlock/reverted/...`; they are never deleted. Recover with `git stash apply <reported-ref>`; inspect untracked recovery files through `<reported-ref>^3`.

## Decisions

Airlock runs until truly blocked. `airlock ask` defaults to `--assume <option>`: it records a recommendation, lets work continue, and tracks tasks that consumed the assumption. Only irreversible work, external commitments, missing access, expensive balanced rework, or an untestable goal may use `--blocking --case <case>`.

At `NOTHING TO DO`, `/airlock` presents all open blocking decisions and assumptions once. If an answer overturns an assumption, `answer` atomically reopens every consuming task and reports `REWORK REQUIRED`.

## Hosts

Claude Code uses the three portable files in `roles/` as the source for generated local agents.

Both hosts use generated agents to make model and effort deterministic. `next` emits the exact `AGENT` to dispatch; host shims do not choose a model. OpenCode agents are generated under `~/.config/opencode/agents/`; restart OpenCode after syncing routes.

The Claude shim invokes its bundled CLI through `${CLAUDE_PLUGIN_ROOT}`. Install the OpenCode CLI globally from the release tag:

```text
npm install --global github:ivan-tretyakov/airlock#v3.1.0
```

For local development, run `npm link` in this checkout.

Bootstrap an OpenCode project without merging its existing configuration:

```text
airlock init "Add an export command" --done "npm test passes" --host opencode
```

This adds the model-neutral `/airlock` command under `.opencode/`. Configure OpenCode routes with `airlock config` and generate candidates with `airlock config --sync --host opencode`; agents are user-local. Re-run the same command after a global upgrade. Airlock upgrades an exact unmodified 3.1.0 command shim, preserves current shims, and fails with a manual-merge instruction rather than overwriting a customized stale command.

The host surface is one command each: `commands/airlock.md` and `.opencode/command/airlock.md`. There are no hooks, guard plugins, external launchers, ledgers, or lifecycle templates.

## Validation

```text
npm test
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

The automated tests cover schema invariants, lifecycle transitions, time windows and fallback chains, assumption rework, Git audits including shell-created writes, role-model binding consistency, and the 5,000-byte prompt-surface ceiling.

`--unattended` forwards to `next`; a blocking decision returns `PARKED` and ends the run without prompting. `maxExpensive` caps tasks declared with `risk: critical`; it deliberately does not infer provider cost from local routes or fallback candidates. Parallel writers require `--parallel` and disjoint ownership; overlapping or ambiguous glob prefixes remain serialized.

## Migration

### Upgrading from 3.0.x

Airlock 3.1 requires every OpenCode model used by a route to declare its legal variants in the local `models.json`. Existing 3.0.x files have no catalog and therefore fail closed after upgrade. Run `opencode models <provider> --verbose`, then add the reported names without changing the existing routes:

```json
{
  "version": 1,
  "catalog": {
    "opencode": {
      "provider/model": { "variants": ["low", "high"] }
    }
  }
}
```

Preserve the file's existing `claude` and `opencode` sections when adding `catalog`, then run `airlock config --sync --host opencode` and restart OpenCode.

### Adding ordered fallbacks

Version 3 adds up to two `fallbacks` to static routes and individual windows. Every candidate must declare a legal host effort or OpenCode variant. Airlock 3.0 and earlier 3.1 builds reject version 3 rather than silently dropping failover behavior. Router-state version 1 pins are read as one-candidate chains and are upgraded locally on the next state write.

### Importing from 2.x

`airlock import <ledger.md>` performs a conservative one-time conversion of a 2.x ledger. It exits non-zero rather than guessing when it cannot map a Crossing's ownership or acceptance criterion. Historical 2.x specifications and reviews live in `docs/airlock/archive/2026-08/`.

## License

Apache-2.0. See `LICENSE`.

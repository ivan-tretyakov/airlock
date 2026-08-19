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

Models and effort resolve from local role/risk routing. They are never stored in the plan or repository. Configure the routing before dispatching work:

```text
airlock config --host opencode --role browser --risk light --model openai/gpt-5.6-luna --effort low
```

The command writes user-local configuration by default. Add `--project` to write an override under the repository's Git common directory (`.git/airlock/models.json`), which is never a tracked worktree file. Project routes override user routes. A missing route fails with the exact host/role/risk combination; there are no bundled provider defaults.

## Commands

Coordinator verbs: `next`, `start`, `done`, `block`, `ask`, `status`, `audit`.

Utilities: `init`, `answer`, `render`, `import`.

All commands support `--json`; use `--plan <path>` when a repository has more than one delivery plan, and `--host claude|opencode` when resolving models outside a host shim.

`start` requires a clean product worktree, excluding Airlock's own plan and `.airlock/` configuration. After `audit` succeeds, `done --evidence "<command + result>"` commits the exact owned changes and the plan state with an `Airlock-Task` trailer. A failed commit restores the task to `doing` so it can be retried.

Blocked task deltas and `audit --revert-out-of-scope` recoveries are retained under `refs/airlock/blocked/...` and `refs/airlock/reverted/...`; they are never deleted. Recover with `git stash apply <reported-ref>`; inspect untracked recovery files through `<reported-ref>^3`.

## Decisions

Airlock runs until truly blocked. `airlock ask` defaults to `--assume <option>`: it records a recommendation, lets work continue, and tracks tasks that consumed the assumption. Only irreversible work, external commitments, missing access, expensive balanced rework, or an untestable goal may use `--blocking --case <case>`.

At `NOTHING TO DO`, `/airlock` presents all open blocking decisions and assumptions once. If an answer overturns an assumption, `answer` atomically reopens every consuming task and reports `REWORK REQUIRED`.

## Hosts

Claude Code uses the three portable files in `roles/` and supplies the resolved model with each `Agent` dispatch.

Claude Code receives the locally resolved model at dispatch. OpenCode's `task` API selects models from static agent configuration, so `airlock config --host opencode ...` generates the required role/model/effort agent in the user's OpenCode agent directory and `next --host opencode` emits its exact `AGENT` name. Restart OpenCode after changing local routes.

The Claude shim invokes its bundled CLI through `${CLAUDE_PLUGIN_ROOT}`. Install the OpenCode CLI globally from the release tag:

```text
npm install --global github:ivan-tretyakov/airlock#v3.0.1
```

For local development, run `npm link` in this checkout.

Bootstrap an OpenCode project without merging its existing configuration:

```text
airlock init "Add an export command" --done "npm test passes" --host opencode
```

This adds the model-neutral `/airlock` command under `.opencode/`. Configure OpenCode routes with `airlock config`; it writes generated model-bound agents only to the user's OpenCode configuration. Re-run the same command after a global upgrade to add a missing project command; existing plan and command files are not overwritten.

The host surface is one command each: `commands/airlock.md` and `.opencode/command/airlock.md`. There are no hooks, guard plugins, external launchers, ledgers, or lifecycle templates.

## Validation

```text
npm test
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

The automated tests cover schema invariants, lifecycle transitions, assumption rework, Git audits including shell-created writes, role-model binding consistency, and the 5,000-byte prompt-surface ceiling.

`--unattended` forwards to `next`; a blocking decision returns `PARKED` and ends the run without prompting. `maxExpensive` caps tasks using the host's critical model. Parallel writers require `--parallel` and disjoint ownership; overlapping or ambiguous glob prefixes remain serialized.

## Migration

`airlock import <ledger.md>` performs a conservative one-time conversion of a 2.x ledger. It exits non-zero rather than guessing when it cannot map a Crossing's ownership or acceptance criterion. Historical 2.x specifications and reviews live in `docs/airlock/archive/2026-08/`.

## License

Apache-2.0. See `LICENSE`.

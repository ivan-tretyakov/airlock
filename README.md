# airlock

Opt-in development orchestration for Claude Code, Claude Cowork, and OpenCode.

Airlock stays off after installation. Start it for one session with:

```text
/airlock:start <task>
```

## Workflow Weight

Airlock classifies task complexity separately from workflow weight.

| Workflow | Intended work | Execution |
|---|---|---|
| **Quick** | Trivial or Light | One execution end-to-end: one leaf worker, or the main session inline when the change is small and already in context. No design, plan, ledger, Crossing, or review artifacts. |
| **Compact** | Standard | Short in-chat scope, normally one leaf worker, and risk-relevant verification. |
| **Full** | Complex or Critical | Explicit design, plan, ledger, Crossing, and selected evidence gates. Starts at the Full-lite shape (one pack, required gates only) and escalates only when scale demands it. |

Ambiguous work escalates one level. Security-sensitive, destructive, migration, production/live, publication, and irreversible work always uses Full.

Override classification when needed:

```text
/airlock:start --workflow quick <task>
/airlock:start --workflow compact <task>
/airlock:start --workflow full <task>
```

## Commands

| Command | Purpose |
|---|---|
| `/airlock:start` | Activate Airlock for this session and route a task. |
| `/airlock:stop` | Return a command-activated session to normal behavior. |
| `/airlock:setup native|opencode` | Store the project runtime preference without activating Airlock. |
| `/airlock:brainstorm` | Approve scope and design for Full work. |
| `/airlock:plan` | Create Full Delivery Packs, Crossings, routing, and gates. |
| `/airlock:ship` | Seal one Full Crossing with exact-candidate evidence. |
| `/airlock:review` | Triage post-ship feedback before repair. |
| `/airlock:debug` | Reproduce and isolate non-trivial failures. |

The explicit commands live in `commands/`. They are not auto-discovered workflow skills.

## Runtime Setup

`/airlock:setup` writes `.airlock/config.json`:

```json
{
  "schema": "airlock.config/v1",
  "runtime": "native"
}
```

Runtime resolution is:

1. `/airlock:start --runtime ...`
2. Project `.airlock/config.json`
3. `native`

`native` uses the current host and its subagents. `opencode` uses the deterministic launcher and requires a local host with Node.js, Git, and OpenCode. Unsupported hosts fail closed; Airlock does not install dependencies or silently fall back. Cowork web/mobile uses native subagents.

## Delegation Safety

- Only the main session may delegate.
- Every worker is a leaf; native worker tool allowlists exclude `Agent`.
- OpenCode runs require `subagent_depth: 0` and deny `task` and interactive questions.
- Default leaf agents use Haiku, Sonnet, or Opus aliases, never Fable.
- Every individual Fable leaf requires fresh user approval, including under a Fable main session.

## Enforcement Hooks

The plugin ships a PreToolUse guard hook (`hooks/guard.mjs`) that is inert until the orchestrator writes a dispatch contract to `.airlock/contract.json` (schema `airlock.contract/v1`). While the contract exists, the hook deterministically blocks file writes outside `ownedPaths` and broad staging (`git add -A`, `git add --all`, `git add .`) for every actor in the session, then goes silent again when the contract is deleted after the return audit. The hook is fail-open: a missing or malformed contract never blocks anything.

## Context Discipline

Command prompts state each rule once: `/airlock:start` carries the base rules (output, delegation, artifacts/cleanup) that the other commands reference, and the entire external-runtime contract — route records, the strict `airlock.external-agent/v2` manifest, dispatch, recovery, and the candidate audit — lives only in `references/EXTERNAL-RUNTIME.md`, loaded on demand for external routes. Native-only sessions never pay for it.

## Concise Output

Airlock adapts the action-first principles of [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd): result first, no preamble or closing filler, one next action when blocked, no tangents, and at most five items per list. Airlock uses its own wording and workflow rules; no upstream code is bundled.

## Claude Code

Install once:

```text
/plugin marketplace add ivan-tretyakov/airlock
/plugin install airlock@airlock-marketplace
```

Start normal Claude Code sessions without a global `agent` setting. Invoke `/airlock:start` only when wanted. An explicit main-agent launch remains available for users who want Airlock from session start:

```text
claude --agent airlock:orchestrator
```

For local source development:

```text
claude --plugin-dir C:/path/to/airlock
```

## Claude Cowork

Upload or install the same plugin through **Customize**. Cowork supports the explicit commands and leaf agents. Use `/airlock:start`; do not spawn `airlock:orchestrator` as a Cowork subagent. Cowork account plugins are separate from the Claude Code CLI cache.

## OpenCode

OpenCode is supported in two roles:

- External worker selected by `runtime: opencode`.
- Direct host through the explicit `.opencode/command/airlock-*.md` commands in this source checkout.

The repository no longer registers auto-selected OpenCode skills. To expose commands in another project, install host-local command copies that reference this stable source checkout. The external worker source is `adapters/opencode/agents/airlock-worker.md`; install a byte-identical copy at `~/.config/opencode/agents/airlock-worker.md`.

The canonical external contract is `references/EXTERNAL-RUNTIME.md`; commands load it only when a route is external. The launcher is dependency-free:

```text
node --test scripts/run-external-agent.test.mjs
```

It consumes a hashed `airlock.external-agent/v2` manifest, validates the exact baseline and permission policy, runs one bounded worker, performs deterministic validation and Git sealing, emits one bounded summary, and removes only declared task-owned state. See `adapters/opencode/README.md` for the strict contract.

## Project Setup

Copy the concise block from `PROJECT-CONVENTIONS.template.md` into project instructions. Project instructions should state that Airlock is opt-in, plus only the commands, invariants, validation commands, protected state, artifact homes, and branch policy that can change execution.

The Full workflow ledger template is `references/LEDGER.template.md`.

## Validation

```text
node --test scripts/plugin-policy.test.mjs
node --test scripts/guard.test.mjs
node --test scripts/run-external-agent.test.mjs
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

## License

Apache-2.0. See `LICENSE`.

# airlock

Opt-in development orchestration for Claude Code, Claude Cowork, and OpenCode.

Airlock stays off after installation. Start it for one session with:

```text
/airlock:start <task>
```

## When to use Airlock

Airlock is a Full-work tool, not a way of working. Most sessions — prototypes, exploration, throwaway scripts — should not use it at all.

| Work type | Harness | Process |
|---|---|---|
| Prototype / throwaway / exploration | any harness, any model | **No Airlock.** Don't invoke `/airlock:start`. |
| Contained real change | either harness | Compact: one `worker`, 1–2 dispatches, no durable artifacts |
| Full / irreversible / production | **Guard-capable host only.** Claude Code qualifies with its PreToolUse hook; OpenCode qualifies with the reviewed guard plugin reporting `fullCapable: true`. OpenCode may also be an external worker. | Full, with mechanical enforcement (ledger hygiene, budgets, review-round cap) |

An OpenCode host without the reviewed guard plugin is prose-only and cannot run Full work. A user override never bypasses a failed guard-capability check.

## Workflow Weight

Airlock classifies task complexity separately from workflow weight.

| Workflow | Intended work | Execution |
|---|---|---|
| **Quick** | Trivial or Light | One execution end-to-end: one leaf worker, or the main session inline when the change is small and already in context. No design, plan, ledger, Crossing, or review artifacts. |
| **Compact** | Standard | Short in-chat scope, one multipurpose `worker` for investigation + implementation + self-verification, and only risk-relevant independent verification. |
| **Full** | Complex or Critical | Subagent-only implementation under explicit design, plan, ledger, Crossing, and selected evidence gates. Starts at the Full-lite shape (one pack, required gates only) and escalates only when scale demands it. |

Escalate only for a named irreversible or cross-cutting surface; approach uncertainty gets a cheap investigation, not a heavier implementer. Security-sensitive, destructive, migration, production/live, and irreversible work always uses Full.

Dispatch budgets are guidelines: Quick 0-1, Compact 1-2, Full-lite at most 3 per Crossing, and Full as planned. Airlock prefers `worker` over an investigate -> code-* -> verify chain unless a user decision, Critical work, or an independence gate requires specialists.

### Right-weighting

| Class | Testable rule |
|---|---|
| Light | One file or a mechanical, fully specified change with an obvious check. |
| Standard | Contained implementation with clear seams and tests. This is the default. |
| Complex | At least three modules, a shared interface other code depends on, or an unknown fix location. |
| Critical | Irreversible work, credentials/secrets/security boundaries, a published contract others consume, or expensive unwind. |

If no Complex or Critical criterion can be named, route the work as Standard. Per Delivery Pack, use at most one `code-critical` and two `code-complex` workers by default; exceeding either weight budget requires a PROGRESS line naming the criterion.

Required gate rows declare who runs each check: `implementer` for a worker's own evidence, `orchestrator-inline` for an orchestrator command, or `independent` for a separate frozen-candidate review. Deterministic tests, typecheck, lint, and builds use the first two modes by default. Independent verification is pack-level by default and is reserved for judgment or final-pack gates.

### Release lane

A release PR merged by the user is Compact by default: version bump, changelog/README, validation, and opening the PR. Publication is the direct mutation users consume - pushing an auto-consumed tag, publishing to a marketplace or registry, or deploying - and that mutating step requires DECISION. After the user merges, tag or publish only behind a second DECISION. Releases involving migrations, credential changes, or irreversible state remain Full.

Override classification when needed:

```text
/airlock:start --workflow quick <task>
/airlock:start --workflow compact <task>
/airlock:start --workflow full <task>
```

## Commands

| Command | Purpose |
|---|---|
| `/airlock:start` | Activate Airlock for this session and route an attended or `--unattended` task. |
| `/airlock:stop` | Return a command-activated session to normal behavior. |
| `/airlock:setup [native|opencode]` | Bootstrap runtime, one browser backend/auth state, host config, and selected-harness MCP registration without activating Airlock. |
| `/airlock:brainstorm` | Approve scope and design for Full work. |
| `/airlock:plan` | Create Full Delivery Packs, Crossings, routing, and gates. |
| `/airlock:ship` | Seal one Full Crossing with exact-candidate evidence. |
| `/airlock:review` | Triage post-ship feedback before repair. |
| `/airlock:debug` | Reproduce and isolate non-trivial failures. |

The explicit commands live in `commands/`. They are not auto-discovered workflow skills.

## Interaction Contract

Airlock keeps work messages compact and uses exactly three forms: one-line **PROGRESS** with the meaningful state change and next action; structured **DECISION** through `AskUserQuestion` with concrete options and a recommendation; or **BLOCKED** with cause, impact, and one exact next action in at most three lines. Final success is PROGRESS and states outcome plus actual verification. At work-package and review-round boundaries, a compact `Item | State | Next | Owner` table is the explicit exception to one-line PROGRESS.

Design and plan approval is always DECISION. Long logs and internal audit reasoning are never user-facing; when detail is needed, Airlock provides a stable artifact/link.

## Runtime Setup

`/airlock:setup` is an idempotent interactive bootstrap. It records runtime, selected Claude Code/OpenCode harnesses, host identity, one browser backend, absolute out-of-repo auth path, auth signal, exact backend launch commands, and the exact refresh command. It merges rather than overwrites `.mcp.json` and `opencode.json`/`opencode.jsonc`; conflicts stop with a diff.

```json
{
  "schema": "airlock.config/v2",
  "runtime": "native",
  "harnesses": ["claude", "opencode"],
  "host": { "os": "win32", "machine": "workstation" },
  "browser": {
    "backend": "playwright",
    "appUrl": "https://example.invalid",
    "authState": "C:/Users/me/.airlock/auth/project/state.json",
    "authSignal": { "url": "https://example.invalid/account", "selector": "[data-authenticated]" },
    "refreshCommand": "npx playwright open --save-storage=... https://example.invalid",
    "launch": {
      "claude": { "command": "cmd", "args": ["/c", "npx", "-y", "@playwright/mcp@latest", "--storage-state", "C:/Users/me/.airlock/auth/project/state.json"], "env": {} },
      "opencode": { "command": ["npx.cmd", "-y", "@playwright/mcp@latest", "--storage-state", "C:/Users/me/.airlock/auth/project/state.json"], "environment": {} }
    }
  }
}
```

The example shows native Windows launch forms; Linux and macOS store plain `npx` commands with POSIX absolute paths.

`airlock.config/v1` files remain valid for runtime-only use; a missing `browser` block means no browser gates are configured. Multi-host projects use `.airlock/config.<hostname>.json` browser overlays so Windows, Linux, and macOS never reuse incompatible commands or auth paths.

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
- Compact and low-risk Full work normally uses the all-round `worker`; independent review remains separate.

## Browser Verification

`/airlock:setup` pins exactly one browser backend and registers the same `browser` server and absolute auth state for every selected host harness. Playwright storage state is worktree-independent and parallel-safe; chrome-devtools uses either a persistent profile or a user-approved `browserUrl`. Browser leaves never read auth files. They preflight the backend and auth signal, return BLOCKED with `refreshCommand` verbatim on expiry, request only filtered console/network output, and never reproduce token-bearing URLs, credentials, cookies, local storage, or browser-profile data.

## Enforcement Hooks

The canonical guard is `hooks/guard.mjs`. Claude Code invokes it through a PreToolUse hook. OpenCode invokes the same policy through `.opencode/plugins/airlock-guard.js`, which maps `edit`, `write`, `apply_patch`, `bash`, and `task` calls into the canonical guard and exposes `airlock_guard_status`. Both are inert until the orchestrator writes an `airlock.contract/v2` dispatch contract to `.airlock/contract.json` before every dispatch. Read-only leaves use `ownedPaths: []` and `allowDispatch: false`. V2 supports an absolute worker `root`, relative or absolute `ownedPaths` across multiple roots, explicit `processPaths`, contract expiry, `allowDispatch`, and `actorMode`: `agent-id` (default) or `single-actor`. The safest fallback on a host that never emits `agent_id` is `single-actor`, which applies worker rules to everyone. README smoke test: write a contract, verify an orchestrator process-path edit and a worker owned-path edit both succeed under `agent-id`; repeat with `single-actor` expecting worker scope only.

While a valid active v2 contract exists, top-level calls may write only explicit `processPaths` and `.airlock/**`; subagent calls may write only `ownedPaths` and can never write process paths or `.airlock/**`. Serialize all file-writing workers while this session-global contract is active; parallelize only read-only workers until per-worker contracts exist. Bash and PowerShell both block broad staging (including unscoped update staging for v2) and obvious out-of-contract redirection or write-cmdlet targets. File and shell targets resolve through their nearest existing ancestor so symlink/junction escapes are denied, and write-bearing compound commands with an unsafe directory change are denied. This common screening of shell writes is not hostile-process containment. Contract v1 remains supported with its original owned-path and broad-staging behavior, including unscoped `git add -u` and `git add --update`. The hook stays fail-open: a missing, expired, unreadable, or malformed contract never blocks anything.

Ledger hygiene is the exception to contract-gated enforcement: it runs **globally** on the canonical `docs/airlock/ledger/**` and `docs/ledger/**` paths even when no dispatch contract exists, because the orchestrator edits the ledger precisely when no worker contract is active. It denies a Write with more than one `## Resume checkpoint` heading, an Edit whose projected file would hold more than one checkpoint or cross the 800-line cap, and any ledger write that keeps the file at or beyond the cap (an over-cap ledger accepts only a full shrink Write). Non-ledger paths, and Edits that cannot be modeled safely against the on-disk content, fail open.

## Context Discipline

Command prompts state each rule once: `/airlock:start` carries the base rules (output, delegation, artifacts/cleanup) that the other commands reference, and the entire external-runtime contract — route records, the strict `airlock.external-agent/v2` manifest, dispatch, recovery, and the candidate audit — lives only in `references/EXTERNAL-RUNTIME.md`, loaded on demand for external routes. Native-only sessions never pay for it. After compaction, the `SessionStart` matcher `compact` injects one conditional reminder: active Full work rereads its design, plan, ledger Resume checkpoint, and `docs/airlock/STATUS.md`; other sessions ignore it. Pre-compaction refresh remains a prompt rule.

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
- Direct host through the explicit `.opencode/command/airlock-*.md` commands and the reviewed `.opencode/plugins/airlock-guard.js` adapter in this source checkout.

The repository no longer registers auto-selected OpenCode skills. To expose commands in another project, install host-local command copies that reference this stable source checkout. The external worker source is `adapters/opencode/agents/airlock-worker.md`; install a byte-identical copy at `~/.config/opencode/agents/airlock-worker.md`.

The canonical external contract is `references/EXTERNAL-RUNTIME.md`; commands load it only when a route is external. The launcher is dependency-free:

```text
node --test scripts/run-external-agent.test.mjs
node --test scripts/opencode-guard.test.mjs
```

It consumes a hashed `airlock.external-agent/v2` manifest, validates the exact baseline and permission policy, runs one bounded worker, performs deterministic validation and Git sealing, emits one bounded summary, and removes only declared task-owned state. See `adapters/opencode/README.md` for the strict contract.

## Project Setup

Copy the concise block from `PROJECT-CONVENTIONS.template.md` into project instructions. Project instructions should state that Airlock is opt-in, plus only the commands, invariants, validation commands, protected state, artifact homes, and branch policy that can change execution.

New Full workflow artifacts use `docs/airlock/`: the human dashboard is `STATUS.md`, with machine resume state in `ledger/`, active plans in `plans/`, active specifications in `specs/`, and fully accepted plan/spec pairs in `archive/YYYY-MM/`. Legacy `docs/ledger/`, `docs/plans/`, and `docs/specs/` paths remain readable.

Reusable Full workflow templates are `references/STATUS.template.md` and `references/LEDGER.template.md`.

## Unattended mode

`/airlock:start --unattended` (or unavailable `AskUserQuestion`) parks ordinary decisions in `docs/airlock/DECISIONS.md`, marks the affected package `blocked-on-user`, and continues the next unblocked package until the declared Crossing/wall-clock budget. Answer with `decision: <option>` or a clear mirrored PR reply; the next session reads decisions first, records the approval, and unblocks the package.

Design approval, always-Full safety work, merges to main, and publication are hard stops and never auto-proceed. Every unattended run replaces a five-line `## Last unattended run` summary in STATUS.

`DECISIONS.md` means questions waiting for you; `references/DECISIONS.template.md` defines its source-of-truth table.

## Validation

```text
node --test scripts/plugin-policy.test.mjs
node --test scripts/guard.test.mjs
node --test scripts/opencode-guard.test.mjs
node --test scripts/run-external-agent.test.mjs
node --test scripts/build-review-bundle.test.mjs
python ~/.local/bin/ai-usage_test.py
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
```

## License

Apache-2.0. See `LICENSE`.

## Plain-language workflow

User messages use plain language while artifacts retain canonical terms for grep-ability.

| User message | Artifact term |
|---|---|
| work package | Delivery Pack |
| checkpoint commit | Crossing |
| check | gate |
| exact code being verified | candidate |
| approved skip | waiver |
| parallel workstream | lane |
| test-fix-simplify | RED-GREEN-refactor |
| all-round builder | worker |
| questions waiting for you | DECISIONS.md |
| production / irreversible work | Full work (guard-capable host only) |
| reviewer's starting context | review bundle |
| who runs the check | Executed by |
| expensive workers allowed per package | weight budget |

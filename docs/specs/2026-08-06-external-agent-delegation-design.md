# External Agent Delegation Design

## Goal

Let an expensive Claude Code orchestrator selected by the user (Opus or Fable) route approved Airlock tasks to multimodel external coding runtimes. Airlock 1.3.0 implements OpenCode first while keeping the canonical contract runtime-neutral.

The Claude orchestrator remains responsible for design, routing, scope, audit, ledger state, gates, push, and publication. External workers perform only the approved role and may create one scoped product candidate commit when the plan grants commit permission.

## Scope Contract

- **Deliverable:** Airlock 1.3.0 external-runtime delegation, an OpenCode worker adapter, and user-scoped activation.
- **Integration stance:** integrated at canonical plan/ship dispatch, Claude orchestration, and the OpenCode CLI adapter.
- **Extend or fresh:** extend existing routing, evidence, checkpoint, and cleanup semantics; add one Claude bridge agent, one OpenCode worker agent, and one deterministic launcher with built-in tests. Do not add an MCP/ACP service.
- **May touch:** `skills/plan/SKILL.md`, `skills/ship/SKILL.md`, `skills/ship/LEDGER.template.md`, `agents/orchestrator.md`, `agents/external-runner.md`, `scripts/run-external-agent.mjs`, `scripts/run-external-agent.test.mjs`, `adapters/opencode/agents/airlock-worker.md`, `adapters/opencode/README.md`, `README.md`, `PROJECT-CONVENTIONS.template.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, this design, its plan, the delivery ledger, and `~/.config/opencode/agents/airlock-worker.md`.
- **Must not touch:** existing specialist agents, `~/.config/opencode/opencode.jsonc`, credentials/auth files, plugin caches, application repositories, historical specs/plans, or canonical brainstorm/review/debug semantics.
- **STOP rule:** any additional source or configuration path requires an approved scope amendment before editing.

## Decisions

### Dedicated bridge, not direct orchestration or MCP

A new Claude plugin subagent, `external-runner`, invokes a bundled deterministic launcher in a separate cheap Claude context. The orchestrator writes one exact hashed dispatch manifest before delegation; the launcher validates it, invokes the external runtime, parses events, enforces timeout/result checks, and cleans exact session/temp state. Haiku relays the structured result rather than assembling shell/process lifecycle itself. This keeps event streams out of the expensive orchestrator context. Direct model-owned shell orchestration proved nondeterministic in `AIRLOCK-D01`; a custom MCP/ACP bridge would add maintenance without improving the foreground task flow.

The launcher is a dependency-free Node `.mjs` program addressed through `${CLAUDE_PLUGIN_ROOT}` and tested with Node's built-in test runner. Node availability is a documented OpenCode bridge prerequisite. A malformed manifest fails closed before runtime launch.

### User-selected Claude orchestrator model

The plugin orchestrator uses `model: inherit`. The user selects Opus or Fable for the Claude session; Airlock does not duplicate orchestrator prompts by model.

### Generic contract, OpenCode implementation

Canonical skills speak in terms of an external runtime, effective agent/model, session identity, and dispatch command. Version 1.3.0 implements and verifies only OpenCode through `opencode run --format json`.

OpenCode CLI cannot target the current `mode: subagent` specialists through `--agent`; it falls back to a primary agent. Airlock therefore supplies a dedicated `mode: primary` `airlock-worker`. Every dispatch still passes the approved model and variant explicitly.

### Plan-approved routing only

An external runtime is used only when the approved pack route names it. The route records runtime, role, model, variant, target directory, file contract, approved commands, commit permission, timeout, and cleanup expectations. Airlock never silently substitutes an external model based on cost or work class.

### Serialized active-checkout writers

Only one external file-writing run may operate in a checkout at a time. Read-only external runs may be parallel only when they do not contend for mutable state. From worker start until return, the Claude orchestrator performs no file or git operation in the target checkout.

Before dispatch, Claude records `HEAD`, an empty-index check, the complete status baseline, and clean task-owned paths. Pre-existing unrelated unstaged paths are preserved and excluded from the worker contract.

### Worker product commit, orchestrator Crossing commit

When the plan grants commit permission, the worker may create exactly one product candidate commit directly on the active branch after a scoped cached-diff audit. It may not edit the design, plan, or ledger.

Claude then verifies the recorded parent, commit count, commit paths, staged state, remaining status delta, evidence, and effective model. On mismatch it stops for a user decision and does not rewrite history. On success Claude creates the orchestrator-owned ledger Crossing commit that references the worker candidate SHA/tree and fresh gate evidence. Claude alone may push or publish.

This two-step sequence preserves the invariant that process artifacts are orchestrator-owned while honoring worker ownership of the product commit.

### Closed headless permissions

Each OpenCode run receives a complete per-invocation permission policy rather than inheriting the user's permissive interactive configuration. It explicitly:

- allows project reads except environment/credential patterns;
- allows edits only to exact owned paths for implementers and denies edits for read-only roles;
- allows only the plan-approved shell, validation, and scoped git commands;
- denies nested tasks, questions, arbitrary external directories, and writes to OpenCode/project configuration;
- allows only exact OpenCode tool-output and temporary homes needed by the runtime;
- never uses `--auto`.

The permission policy and git command denials are defence in depth for an honest coding agent, not an adversarial sandbox. The worker process also suppresses interactive git credentials, SSH-agent use, and remote push capability. Claude's deterministic post-return audit remains the correctness boundary.

The first execution step must empirically prove how inline OpenCode configuration and `OPENCODE_PERMISSION` override the current global `"*": "allow"`. If the closed policy cannot be demonstrated in a disposable repository, implementation stops before candidate source changes.

### Session, resume, evidence, and cleanup

The deterministic launcher parses OpenCode's JSON event stream and returns the session ID, effective route, worker state, completion state, evidence summary, and exact artifacts/processes. The bridge relays that bounded result; the orchestrator stores active session IDs in the ledger Resume checkpoint.

Failed or interrupted sessions may be resumed only against a verified checkout state, using a fork when preserving the original failed session matters. Accepted or abandoned sessions are deleted by exact ID after any required sanitized export. Temporary repos, permission/config files, logs, and processes are removed by exact path or ID; unknown or pre-existing state is never cleaned.

## Alternatives Rejected

1. **Direct orchestrator shell invocation:** fewer files, but expensive context absorbs event streams and safety logic is repeated.
2. **Custom MCP/ACP bridge:** structured streaming, but disproportionate implementation and operational cost for foreground CLI dispatch.
3. **Automatic work-class routing:** convenient but hides model/cost decisions and conflicts with Airlock's approved routing contract.
4. **Parallel active-checkout writers:** faster but attribution and git/index races are unacceptable without worktree integration.
5. **Worker-owned ledger:** impossible under the process-artifact ownership and evidence lifecycle.

## Delivery Pack and Verification Intent

One Delivery Pack, `AIRLOCK-P03`, spans four contiguous Crossings: canonical semantics, OpenCode worker, Claude bridge/release source, and publication/activation. Several Crossings are necessary because canonical workflow, host configuration, and release activation are independently auditable layers of one outcome.

Required evidence includes a disposable permission/config precedence probe, denied-operation checks, model/agent resolution, one-commit history audit, JSON session/resume/cleanup checks, strict Claude plugin validation, OpenCode configuration resolution, independent cross-family security review, and an installed Claude-to-OpenCode smoke in a disposable repository. Browser, visual, and live-application gates are not applicable.

The pack-level rollback removes or disables the global worker, reverts plugin activation, then reverts Claude bridge and canonical semantics in reverse order.

## Known Risk

An external process running as the user's account is not adversarially isolated. Active-branch execution is accepted by user decision. The design prevents and detects ordinary scope drift; it does not claim to contain malicious local code or a deliberately evasive process.

# OpenCode adapter

Airlock's canonical Full workflow lives in `commands/`. OpenCode uses explicit commands only; no Airlock skill is registered for automatic selection.

## External-runtime worker

The reviewed worker source is [`agents/airlock-worker.md`](agents/airlock-worker.md). Install a byte-identical copy at `~/.config/opencode/agents/airlock-worker.md`; no `opencode.jsonc` change is required. The worker is `mode: primary` because `opencode run --agent` cannot target a `mode: subagent` agent: OpenCode warns and falls back to its default primary. It deliberately has no fixed model or variant.

Quit and restart OpenCode after installing or changing the agent; configuration-time files are not hot-reloaded. Resolve configuration from the actual target directory and verify `agent.airlock-worker` is primary, has no `model` or `variant`, and denies `task` and `question`:

```text
opencode debug config
```

This proves only the installed agent's static resolution. It does not prove the merged per-run policy. Project and inline configuration can affect resolution, so repeat the static preflight for each target checkout and abort on an unexpected override or fallback warning. Separately, the approved denied-operation probe must prove that the exact per-run policy overrides ambient permissions.

### Deterministic launcher bridge

Node.js, a direct Git executable, and the OpenCode CLI with the selected provider/model are required. The Claude orchestrator never constructs an OpenCode command, launcher-internal Git command, validation command, policy, retry, cleanup operation, or process termination itself. It invokes the bundled launcher directly and exactly once:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs" \
  --manifest <absolute-manifest.json> --sha256 <lowercase-hex>
```

The orchestrator creates the secret-free manifest, hashes its exact bytes, and records it as task-owned temporary state. The launcher validates the hash and emits one bounded JSON summary with schema `airlock.external-agent-result/v1`, including status/classification/action, selected/effective route, session, process, event evidence, policy, validation, candidate, recovery, and cleanup facts.

The writer manifest schema is `airlock.external-agent/v2` and strictly pins the route, structured baseline, exact owned paths, ordered validations, launcher commit contract, artifacts, expected mutation, cleanup, retention, and policy fields. Unknown fields, secrets, non-lowercase SHA-256 values, shell command strings, checkout escapes, and omitted required fields fail closed. Every mandatory validation supplies a direct executable, argv array, checkout-contained working directory, timeout, output bounds, and expected exit; the launcher invokes it with `shell: false` and rejects any validation-created delta.

The launcher enforces the approved foreground timeout, serializes file-writing runs per checkout, and leaves the orchestrator idle in that checkout until return. Read-only runs may overlap only when they cannot contend for mutable state. On Windows it resolves only direct `opencode.exe` (including the supported npm-installed executable) and `git.exe`; PowerShell/npm command shims fail closed.

Run its dependency-free checks with:

```text
node --test scripts/run-external-agent.test.mjs
```

For each process, the launcher sets non-secret `OPENCODE_CONFIG_CONTENT` and `OPENCODE_PERMISSION` values from the manifest rather than relying on ambient defaults. The config must set `subagent_depth: 0`; the launcher rejects every other value. Route-specific model values must agree with the manifest route. `--pure` plus the total tool policy denies unapproved plugin, MCP, and custom tools.

Construct the last-match-wins permission policy in this order:

1. `OPENCODE_PERMISSION` is merged after ambient configuration; its top-level `"*": "deny"` therefore replaces a prior ambient wildcard allow. Put exact per-tool policies after that top-level deny.
2. Inside each granular tool policy, put `"*": "deny"` first, then exact approved allows, then explicit high-risk denies after any overlapping allows. High-risk final denies cover environment/auth/credential reads, configuration or unowned edits, undeclared external directories, arbitrary shell/network operations, and push/publish/history rewriting.
3. Keep the agent's static `task: deny` and `question: deny` as the final per-agent rules. They are the only static containment; edit, shell, fetch, external-directory, and every other tool restriction must come from the total per-run policy.

Record the full config and permission JSON, or immutable sources plus content hashes, as the orchestrator-owned policy identity. The manifest contains that immutable identity and a reference to the completed denied-operation precedence proof; the worker confirms their presence rather than re-proving precedence. The launcher disables interactive Git credential prompts and inherited SSH-agent access for the child process. The exact Bash allowlist and worker contract still deny every remote operation.

The manifest prompt must contain the approved Pack/Crossing IDs, selected and expected effective route, exact file contract and STOP rule, approved commands, timeout, commit permission, immutable policy identity plus precedence-proof reference, and artifact/session policy. The worker refuses an incomplete dispatch before tool use.

### JSON and session lifecycle

`--format json` emits newline-delimited JSON. The C01 probe observed top-level `type`, `timestamp`, and `sessionID` fields plus event-specific `part` data, with `step_start`, `tool_use`, `step_finish`, and `text` event types. It observed tool and terminal-state data under `tool_use.part`, return text under `text.part.text`, and reason/cost/token data under `step_finish.part` when supplied. The launcher parses this observed sub-schema defensively, validates required identity/completion evidence, and reports its single result summary; an error event, non-zero exit, missing terminal stop, or text-only result is blocked.

The launcher owns exact session export, deletion, and absence verification according to the manifest. The model bridge never resumes, forks, deletes, or otherwise manipulates a session. The orchestrator records the returned exact session and cleanup facts, then permits a new manifest only after its checkout audit; never use an ambiguous “last session”.

### Candidate commit and audit

Before dispatch, the orchestrator records the branch, full `HEAD`, empty real index, complete structured porcelain-v2 status, clean owned-path hashes, baseline-dirty-path hashes, and effective policy proof. The worker may make only scoped edits and approved exploratory checks; it cannot write Git state or claim a candidate. The launcher requires declared successful mutation evidence, then proves the delta is all and only the exact candidate paths while preserving baseline-dirty paths.

The launcher runs all mandatory validations after the worker and before staging. It resolves Git directly, rejects custom `filter` attributes on every owned path, creates and verifies an empty task-owned hooks directory, writes and round-trips the approved message file, stages exact modified/added/deleted paths, audits cached names and cached `diff --check`, and commits with the empty hooks path and signing disabled. It rechecks branch, `HEAD`, index, status, and hashes immediately before staging and commit, then proves one child commit, exact parent/message/tree/path set, empty index, and preserved status. It never uses broad pathspecs, resets, amends, rebases, cleans, or otherwise rewrites history.

After a bounded `done` summary, the orchestrator independently verifies the launcher-sealed candidate and all exact cleanup before it creates the separate ledger/Crossing commit, pushes, or publishes. For a missing or malformed summary, first prove the exact launcher process tree is quiescent, then inspect only against the recorded baseline: unchanged `HEAD` with confined owned edits is the no-commit state (`no_candidate_sealed`); one exact child with the manifest message/path set is the one-commit state (`candidate_sealed_requires_audit`); every other state is indeterminate and stops without cleanup or history rewriting. A cleanup failure after a commit preserves the commit and blocks acceptance.

### Security and cleanup boundary

The worker is a user-account process with advisory model instructions plus deterministic permissions and post-return audits. These guardrails limit and detect ordinary scope drift; they are not adversarial isolation. Never inspect credentials, authentication files, environment values, browser state, or unrelated user state. The launcher deletes and verifies only exact declared session, manifest, evidence, message, hooks, and temporary-directory paths after extracting its summary. On blocked, partial, unknown, or cleanup-failed runs, leave unknown or pre-existing state untouched and report it.

## Use this checkout

This repository's `.opencode/command/` directory supplies explicit commands that read the canonical command files:

- `/airlock-start` — OpenCode host; Quick and Compact only. Full-class tasks are `BLOCKED` per the Host harness gate.
- `/airlock-stop`
- `/airlock-setup`
- `/airlock-brainstorm` — blocked on OpenCode (Full work requires the Claude Code host)
- `/airlock-plan` — blocked on OpenCode (Full work requires the Claude Code host)
- `/airlock-ship` — blocked on OpenCode (Full work requires the Claude Code host)
- `/airlock-review` — blocked on OpenCode (Full work requires the Claude Code host)
- `/airlock-debug` — Quick/Compact debugging only; Full-class debugging is blocked

OpenCode never runs Full ceremony. Full work runs on the Claude Code host only (where the guard hook is loaded); OpenCode participates as a dispatched external leaf worker from a Claude-hosted Full session. The `airlock-*` commands here declare their host and block rather than downgrade.

Restart OpenCode after changing commands or configuration because they are loaded at startup. Airlock remains inactive until `/airlock-start` is invoked.

A registered source path loads current working-tree files, including uncommitted changes; it is not restricted to Git HEAD and does not fetch from remote. Keep the checkout reviewed and update it explicitly.

## Use Airlock in another project

Clone Airlock to a stable location, then install host-local copies of `.opencode/command/airlock-*.md` that reference that checkout's absolute `commands/` paths. Do not register an Airlock skill path globally: that would make the workflow eligible for automatic selection.

The commands inherit the active primary agent. Run `/airlock-start` from an orchestration-capable primary agent. External OpenCode workers are separate and always deny `task`.

## Project conventions

Put the completed [`PROJECT-CONVENTIONS.template.md`](../../PROJECT-CONVENTIONS.template.md) block in the consuming project's `AGENTS.md`. If the project is shared with Claude Code, either keep the same concise block in both `AGENTS.md` and `CLAUDE.md`, or configure one host to load the other file as instructions.

The shared skills use portable work classes and host roles rather than fixed model IDs:

- **Light** for mechanical or tightly contained low-risk work.
- **Standard** for normal contained implementation.
- **Complex** for cross-cutting behavior, architecture, and difficult diagnosis.
- **Critical** for safety-sensitive, irreversible, public-contract, or expensive-to-unwind work.

Plans also record host roles such as implementer, investigator, verifier, independent reviewer, browser verifier, and visual verifier. OpenCode's `task` tool selects a configured subagent rather than accepting an arbitrary model per call. Map these classes and roles to agents you already maintain:

```json
{
  "agent": {
    "code-light": {
      "mode": "subagent",
      "model": "provider/fast-model",
      "description": "Mechanical, fully specified Light tasks."
    },
    "code-standard": {
      "mode": "subagent",
      "model": "provider/balanced-model",
      "description": "Normal contained Standard implementation."
    },
    "code-complex": {
      "mode": "subagent",
      "model": "provider/deep-model",
      "description": "Complex cross-cutting implementation."
    }
  }
}
```

Replace placeholder IDs with enabled models. Plans record portable class/role plus the selected host agent/model; gate evidence records what actually ran. A material capability downgrade requires approval rather than a silent fallback.

For a visual gate, preflight Playwright/Chrome MCP and authentication. Prefer a read-only visual agent that captures fresh evidence and assesses it against the cited spec. If browser state cannot be shared, the primary captures evidence and the visual agent assesses it. Never read credentials or mutate external state without an approved throwaway target and cleanup plan.

# OpenCode adapter

Airlock's canonical workflow lives in `skills/`. The OpenCode adapter adds namespaced wrapper skills and explicit commands; it does not duplicate the workflow bodies.

## External-runtime worker

The reviewed worker source is [`agents/airlock-worker.md`](agents/airlock-worker.md). Install a byte-identical copy at `~/.config/opencode/agents/airlock-worker.md`; no `opencode.jsonc` change is required. The worker is `mode: primary` because `opencode run --agent` cannot target a `mode: subagent` agent: OpenCode warns and falls back to its default primary. It deliberately has no fixed model or variant.

Quit and restart OpenCode after installing or changing the agent; configuration-time files are not hot-reloaded. Resolve configuration from the actual target directory and verify `agent.airlock-worker` is primary, has no `model` or `variant`, and denies `task` and `question`:

```text
opencode debug config
```

This proves only the installed agent's static resolution. It does not prove the merged per-run policy. Project and inline configuration can affect resolution, so repeat the static preflight for each target checkout and abort on an unexpected override or fallback warning. Separately, the approved denied-operation probe must prove that the exact per-run policy overrides ambient permissions.

### Deterministic launcher bridge

Node.js is required. The Claude bridge never constructs an OpenCode command, policy, prompt, retry, cleanup operation, or process termination itself. It invokes the bundled launcher exactly once:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-external-agent.mjs" \
  --manifest <absolute-manifest.json> --sha256 <lowercase-hex>
```

The orchestrator creates the secret-free manifest, hashes its exact bytes, records it as task-owned temporary state, and supplies the path/hash plus approved route reference to the bridge. The launcher validates the hash and emits one JSON summary with schema `airlock.external-agent-result/v1`, including status/classification/action, selected/effective route, session, process, event evidence, policy, and cleanup facts. A bridge reports `done` only for a launcher `done`; it propagates a blocked classification and exact action without retrying.

The manifest schema is `airlock.external-agent/v1` and has exactly `schema`, `runtime`, `packId`, `crossingId`, `route`, `prompt`, `opencode`, `timeoutMs`, `evidencePath`, `expected`, `cleanup`, `retention`, and `policy`. Its nested route, expected, cleanup, retention, and policy fields are the approved launch contract; unknown fields, secrets, or a non-lowercase SHA-256 fail closed. The launcher owns foreground invocation, evidence parsing, effective-identity export, exact session/file cleanup, and absence verification.

The launcher enforces the approved foreground timeout, serializes file-writing runs per checkout, and leaves the orchestrator idle in that checkout until return. Read-only runs may overlap only when they cannot contend for mutable state. On Windows it resolves only a direct `opencode.exe`, including the supported npm-installed executable; PowerShell/npm command shims fail closed.

Run its dependency-free checks with:

```text
node --test scripts/run-external-agent.test.mjs
```

For each process, the launcher sets non-secret `OPENCODE_CONFIG_CONTENT` and `OPENCODE_PERMISSION` values from the manifest rather than relying on ambient defaults. The successful inline-config probe used exactly these non-secret keys: `$schema`, `autoupdate`, `snapshot`, `share`, `default_agent`, `model`, `small_model`, `subagent_depth`, `instructions`, `lsp`, `formatter`, and `compaction`. Route-specific model values must agree with the manifest route. That successful object did not include an `mcp` key; `--pure` plus the total tool policy denies unapproved plugin, MCP, and custom tools.

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

Before dispatch, the orchestrator records the branch, full `HEAD`, empty cached diff, complete `git status --short`, clean owned paths, and effective policy proof. With no commit permission the worker neither stages nor commits. With permission for one candidate, it may create at most one product commit, stages only explicit owned paths, audits `git diff --cached --name-status`, includes the exact Crossing ID in the message, and never edits process artifacts or pushes, publishes, amends, resets, rebases, or merges.

After return, the orchestrator verifies the recorded parent, exactly one commit, candidate/tree and message, complete changed-name set, empty index, full status delta, effective route, evidence, and exact cleanup. A mismatch stops without rewriting history. The orchestrator alone owns the ledger/Crossing commit and any push or publication.

### Security and cleanup boundary

The worker is a user-account process with advisory model instructions plus deterministic permissions and post-return audits. These guardrails limit and detect ordinary scope drift; they are not adversarial isolation. Never inspect credentials, authentication files, environment values, browser state, or unrelated user state. On blocked or partial runs, stop/remove only exact attributable owned processes and paths; leave unknown or pre-existing state untouched and report it.

## Use this checkout

This repository's [`opencode.json`](../../opencode.json) registers `adapters/opencode/skills/`. Those wrappers delegate to the canonical workflows in the root `skills/` directory, while `.opencode/command/` supplies:

- `/airlock-brainstorm`
- `/airlock-plan`
- `/airlock-ship`
- `/airlock-review`
- `/airlock-debug`

Restart OpenCode after changing skills, commands, or configuration because they are loaded at startup.

A registered source path loads current working-tree files, including uncommitted changes; it is not restricted to Git HEAD and does not fetch from remote. Keep the checkout reviewed and update it explicitly.

## Use Airlock in another project

Clone Airlock to a stable location, then add its absolute skill path to that project's `opencode.json` or the global `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": {
    "paths": [
      "C:/path/to/airlock/adapters/opencode/skills"
    ]
  }
}
```

OpenCode can auto-select the namespaced `airlock-*` skills from their descriptions. To install the explicit commands too, copy `.opencode/command/airlock-*.md` into the consuming project's `.opencode/command/` directory or the global OpenCode command directory.

The supplied commands inherit the active primary agent. Run them from an orchestration-capable primary agent. If one installation must guarantee a specific primary, add `agent: <name>` to host-local command copies or set `default_agent`; Airlock does not pin a non-portable global agent name in distributed commands.

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

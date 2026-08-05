# OpenCode adapter

Airlock's canonical workflow lives in `skills/`. The OpenCode adapter adds namespaced wrapper skills and explicit commands; it does not duplicate the workflow bodies.

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

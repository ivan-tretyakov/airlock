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

## Project conventions

Put the completed [`PROJECT-CONVENTIONS.template.md`](../../PROJECT-CONVENTIONS.template.md) block in the consuming project's `AGENTS.md`. If the project is shared with Claude Code, either keep the same concise block in both `AGENTS.md` and `CLAUDE.md`, or configure one host to load the other file as instructions.

The shared skills use capability tiers rather than fixed model IDs:

- **Fast** for mechanical, low-judgment work.
- **Balanced** for normal contained implementation.
- **Deep** for architecture, cross-cutting work, and difficult debugging.

OpenCode's `task` tool selects a configured subagent rather than accepting an arbitrary model per call. For real tiered dispatch, define subagents with the desired models in the consuming configuration:

```json
{
  "agent": {
    "airlock-fast": {
      "mode": "subagent",
      "model": "provider/fast-model",
      "description": "Mechanical, fully specified Airlock tasks."
    },
    "airlock-balanced": {
      "mode": "subagent",
      "model": "provider/balanced-model",
      "description": "Normal contained Airlock implementation."
    },
    "airlock-deep": {
      "mode": "subagent",
      "model": "provider/deep-model",
      "description": "Architecture and difficult Airlock work."
    }
  }
}
```

Replace the placeholder model IDs with enabled provider/model IDs. Plans record both the selected agent and actual model. If tier-specific agents are not configured, use an available agent or run inline and record the model actually used rather than claiming a tier mapping that did not happen.

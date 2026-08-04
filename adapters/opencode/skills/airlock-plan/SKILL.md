---
name: airlock-plan
description: Airlock implementation planning and execution. Use after design or scope approval to create a phased TDD plan, choose models, and run work inline or through subagents.
---

Read `../../../../skills/plan/SKILL.md` relative to this file and follow it as the canonical workflow. In OpenCode, use `question` for execution choices and `task` for subagents. The `task` tool selects a configured subagent, not an arbitrary model; map capability tiers to configured subagent names and record the actual agent and model used.

Map canonical skill handoffs to OpenCode names: `brainstorm` → `airlock-brainstorm`, `plan` → `airlock-plan`, `ship` → `airlock-ship`, `review` → `airlock-review`, and `debug` → `airlock-debug`.

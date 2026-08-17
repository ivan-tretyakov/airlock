---
description: BLOCKED on OpenCode — Full work requires the Claude Code host.
---

Full work runs **on the Claude Code host only**, where the PreToolUse guard hook is active. This is an OpenCode host, so this command is `BLOCKED`:

- Cause: this host does not load the Claude Code guard hook.
- Impact: Full ceremony enforcement (ledger hygiene, budgets, review-round cap) is unavailable here.
- Next action: rerun this task from Claude Code via `/airlock:start` and follow the Full workflow there.

Do not approximate, downgrade, or reimplement this workflow on OpenCode.

---
description: Debug a non-trivial problem on an OpenCode host (Quick/Compact only).
---

This command runs on an **OpenCode host**: the Claude Code PreToolUse guard hook is not loaded here. Read `commands/debug.md` from the Airlock source checkout and follow it for Quick and Compact debugging only.

If the debugging classifies as **Full** — safety-sensitive, irreversible, production, or expensive-to-unwind — stop with `BLOCKED` and rerun from Claude Code via `/airlock:start`. Do not downgrade Full debugging to Compact on this host.

$ARGUMENTS

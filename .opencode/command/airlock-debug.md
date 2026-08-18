---
description: Debug a non-trivial problem on an OpenCode host.
---

This command runs on an **OpenCode host**. Read `commands/debug.md` from the Airlock source checkout and follow it for Quick and Compact debugging.

If the debugging classifies as **Full** — safety-sensitive, irreversible, production, or expensive-to-unwind — call `airlock_guard_status`. Continue only when it reports `fullCapable: true`; otherwise stop with `BLOCKED`. Do not downgrade Full debugging to Compact.

$ARGUMENTS

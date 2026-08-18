---
description: Ship a Full Airlock Crossing on a verified OpenCode guard host.
---

This command runs on an **OpenCode host**. Before proceeding, call `airlock_guard_status`.

- If it reports `fullCapable: true`, read `commands/ship.md` from the Airlock source checkout and follow it.
- Otherwise this command is `BLOCKED`: Full ceremony enforcement is unavailable, so stop and report the failed status.

$ARGUMENTS

---
description: Activate Airlock on an OpenCode host and route one attended or unattended Quick/Compact task.
---

This command runs on an **OpenCode host**. Read `commands/start.md` from the Airlock source checkout and follow its base rules and classification. For a task that classifies as Full, call `airlock_guard_status` before any workflow action:

- **Quick and Compact** work may proceed here, following `commands/start.md`.
- A task that classifies as **Full** — or is in the always-Full safety class — may proceed only when the status reports `fullCapable: true`. Otherwise it is `BLOCKED`; do not downgrade it to Compact or execute it inline.

$ARGUMENTS

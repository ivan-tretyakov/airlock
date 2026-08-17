---
description: Activate Airlock on an OpenCode host and route one attended or unattended Quick/Compact task.
---

This command runs on an **OpenCode host**: the Claude Code guard hook is not loaded here. Read `commands/start.md` from the Airlock source checkout and follow its base rules and classification, but apply the **Host harness gate** for this host:

- **Quick and Compact** work may proceed here, following `commands/start.md`.
- A task that classifies as **Full** — or is in the always-Full safety class — is `BLOCKED`. Do not downgrade it to Compact, do not execute it inline, and do not invoke `brainstorm`, `plan`, `ship`, `review`, or Full `debug` from this host. Stop with the exact next action: rerun the task from Claude Code (`/airlock:start`).

$ARGUMENTS

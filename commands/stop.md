---
description: Stop command-activated Airlock for this session
---

Stop applying instructions loaded by `/airlock:start` and return to the host's normal behavior. Confirm in one line. Do not alter `.airlock/config.json`; it stores only a runtime preference and never activates Airlock.

If the session itself was launched with `--agent airlock:orchestrator` or a global main-agent setting, explain that a normal new session is required to remove that higher-priority main agent.

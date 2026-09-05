---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--all] [--dry-run] [--routing <path>]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" run $ARGUMENTS` and show the line it prints. Never dispatch a subagent: `run` resolves `~/.airlock/routing.json`, spawns the routed executor CLI itself, audits, and commits or blocks.

If it prints `RAN <id> DONE <commit>`, repeat. If it prints `RAN <id> BLOCKED <reason>`, stop and show the reason; fix the cause (usually one routing slot) and rerun. If it returns `PARKED` or `NOTHING TO DO`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" status`, present all open decisions and assumptions in one multiple-choice prompt, feed answers to `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" answer`, and resume if work becomes runnable.

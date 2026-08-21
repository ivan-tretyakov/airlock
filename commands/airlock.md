---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" next --host claude $ARGUMENTS`. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" status --host claude`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" answer` and resume if work becomes runnable.

Otherwise, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" start <id> --host claude`, then dispatch its TASK block verbatim with `Agent` to its exact `AGENT`; pass no model parameter. If `Agent` errors before returning any child result due to provider auth, rate limit, timeout, transport, or model availability, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" fallback <id> --host claude --reason "<short cause without credentials or quotes>"`; dispatch its TASK block to its `AGENT`. Never fallback after any child result, for cancellation, permission/configuration errors, or after Airlock refuses because changes exist. If dispatch cannot continue, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" block <id> --host claude --reason "<cause>"`. After a child result, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" audit <id> --host claude`; block on failure, otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" done <id> --host claude --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.

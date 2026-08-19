---
description: Drive the active Airlock plan until no task is runnable.
argument-hint: "[--unattended]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" next --host claude $ARGUMENTS`. If it returns `PARKED`, show it and stop. If it prints `NOTHING TO DO`, show it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" status --host claude`, and present all open decisions and assumptions in one multiple-choice prompt. Feed answers to `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" answer` and resume if work becomes runnable.

Otherwise, extract the task id, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" start <id>`, then dispatch the printed block verbatim to the role it names with `Agent`, using the model it names. If it stops, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" block <id> --reason "<cause>"`. If it returns, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" audit <id>`; on failure block the task and report its out-of-scope paths; on success run `node "${CLAUDE_PLUGIN_ROOT}/scripts/airlock.mjs" done <id> --evidence "<command + result>"`.

Repeat until `NOTHING TO DO` or `BUDGET REACHED`. Do not ask while work is runnable; use `airlock ask ... --assume <default>` unless the decision is truly blocking. Report one line per completed task, the status table, and one consolidated prompt only.
